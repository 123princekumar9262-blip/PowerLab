import type { Mat } from '../expm.ts'
import { exactPwl, type PwlSystem } from '../pwl.ts'
import { complementaryPair } from '../schedule.ts'
import { solveDense } from '../../solvers/linear.ts'
import { E_REF, stageSwitching, type ResolvedStage } from './dcdcStage.ts'

/**
 * DC-DC STAGE THEORY — independent of the time-stepping simulation.
 *
 * 1. EXACT: the same half-bridge as a piecewise-linear system x = [iL, vC]. In each mode (gates S1, S2 and the
 *    body diodes D1, D2 ON or OFF, the diodes decided by the state) the circuit is solved by hand
 *    (two nodal equations), giving x' = A·x + b. The periodic steady state is found by Newton on the EXACT
 *    one-period map (matrix exponentials, `exactPwl`), and every average, RMS and loss by 8-point Gauss–Legendre
 *    on each smooth piece of the exact solution. The duty that puts the link on its target is found on this
 *    exact model too (secant), independently of the simulation's controller.
 * 2. TEXTBOOK (ideal synchronous boost, CCM): Vlink = Vt/(1 − D), ΔiL = Vt·D/(L·fs), ΔVlink ≈ Ilink·D/(C·fs),
 *    conduction loss ≈ (I² + ΔiL²/12)·(Ron + DCR), switching ≈ fs·(Eon + Eoff)·(V/600 V)·(I/300 A).
 */

const GL8_X = [-0.9602898564975363, -0.7966664774136267, -0.525532409916329, -0.1834346424956498, 0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363]
const GL8_W = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.362683783378362, 0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763]

interface Sol {
  vsw: number
  vlink: number
  iHs: number
  iLs: number
  iS1: number
  iS2: number
  iD1: number
  iD2: number
  iC: number
  iInv: number
}

/** Solve the switch node and the link for a mode (g1, g2, d1, d2) at state (iL, vC). */
export function solveMode(p: ResolvedStage, g1: number, g2: number, d1: number, d2: number, iL: number, vC: number): Sol {
  const Glo = g2 / p.ron + d2 / p.rd
  const clo = (d2 * p.vf) / p.rd
  const Ghi = g1 / p.ron + d1 / p.rd
  const chi = (-d1 * p.vf) / p.rd
  let vsw: number
  let vlink: number
  if (Glo + Ghi === 0) {
    // nothing conducts at the switch node: the inductor current is zero (idle); the node floats at the battery
    vlink = (vC + (p.esr * p.einv) / p.rinv) / (1 + p.esr / p.rinv)
    vsw = p.vbat
  } else {
    const a11 = Glo + Ghi
    const a12 = -Ghi
    const a21 = -p.esr * Ghi
    const a22 = 1 + p.esr * Ghi + p.esr / p.rinv
    const r1 = iL - clo - chi
    const r2 = vC + p.esr * chi + (p.esr * p.einv) / p.rinv
    const det = a11 * a22 - a12 * a21
    vsw = (r1 * a22 - a12 * r2) / det
    vlink = (a11 * r2 - a21 * r1) / det
  }
  const iS1 = (g1 * (vsw - vlink)) / p.ron
  const iS2 = (g2 * vsw) / p.ron
  const iD1 = d1 ? (vsw - vlink - p.vf) / p.rd : 0
  const iD2 = d2 ? (-vsw - p.vf) / p.rd : 0
  const iHs = iS1 + iD1
  const iInv = (vlink - p.einv) / p.rinv
  return { vsw, vlink, iHs, iLs: iS2 - iD2, iS1, iS2, iD1, iD2, iC: iHs - iInv, iInv }
}

/** The PWL system of the stage at a duty. */
export function stageSystem(p: ResolvedStage): { sys: PwlSystem; edges: number[]; gates: (t: number) => [number, number] } {
  const [s1, s2] = complementaryPair('S1', 'S2', p.ts, [
    { t: p.duty * p.ts, rising: true },
    { t: 0, rising: false },
  ], p.td)
  const gates = (t: number): [number, number] => [s1.at(t) ? 1 : 0, s2.at(t) ? 1 : 0]
  const edges = [...new Set([0, p.td, p.duty * p.ts, p.duty * p.ts + p.td].map((t) => Math.min(t, p.ts)))].sort((a, b) => a - b)
  const consistent = (g1: number, g2: number, d1: number, d2: number, x: number[]) => {
    if (!g1 && !g2 && !d1 && !d2) return Math.abs(x[0]) < 1e-9
    const s = solveMode(p, g1, g2, d1, d2, x[0], x[1])
    const ok1 = d1 ? s.iD1 > 0 : s.vsw - s.vlink <= p.vf
    const ok2 = d2 ? s.iD2 > 0 : -s.vsw <= p.vf
    return ok1 && ok2
  }
  const sys: PwlSystem = {
    n: 2,
    breakpoints: [],
    mode(x, t, prev) {
      const [g1, g2] = gates(t)
      const pd = prev.length === 4 ? [Number(prev[2]), Number(prev[3])] : [0, 0]
      const order: Array<[number, number]> = [[pd[0], pd[1]], [1, 0], [0, 1], [0, 0], [1, 1]]
      for (const [d1, d2] of order) if (consistent(g1, g2, d1, d2, x)) return `${g1}${g2}${d1}${d2}`
      // no exactly consistent state (a boundary): keep the diodes the current needs
      return `${g1}${g2}${x[0] > 0 && !g1 ? 1 : 0}${x[0] < 0 && !g2 ? 1 : 0}`
    },
    sys(mode) {
      const [g1, g2, d1, d2] = mode.split('').map(Number)
      const f = (iL: number, vC: number): [number, number] => {
        if (!g1 && !g2 && !d1 && !d2) {
          const s = solveMode(p, 0, 0, 0, 0, 0, vC)
          return [0, s.iC / p.c]
        }
        const s = solveMode(p, g1, g2, d1, d2, iL, vC)
        return [(p.vbat - (p.rbat + p.rl) * iL - s.vsw) / p.l, s.iC / p.c]
      }
      const f0 = f(0, 0)
      const fi = f(1, 0)
      const fv = f(0, 1)
      const A: Mat = [
        [fi[0] - f0[0], fv[0] - f0[0]],
        [fi[1] - f0[1], fv[1] - f0[1]],
      ]
      return { A, b: [f0[0], f0[1]] }
    },
  }
  // breakpoints over a few periods (the solver needs them as absolute times)
  sys.breakpoints = []
  for (let k = 0; k < 2; k++) for (const e of edges) sys.breakpoints.push(k * p.ts + e)
  return { sys, edges, gates }
}

export interface StageExact {
  duty: number
  x0: number[]
  vlinkAvg: number
  vlinkPP: number
  vcPP: number
  ilAvg: number
  ilPP: number
  ilMax: number
  ilMin: number
  ilRms: number
  pBat: number
  pLink: number
  pS1: number
  pS2: number
  pD: number
  pDcr: number
  pEsr: number
  pCond: number
  pSw: number
  efficiency: number
  newton: number
}

/** THEORY: the exact periodic steady state at the stage's duty. */
export function stageExact(p: ResolvedStage): StageExact {
  const { sys, edges, gates } = stageSystem(p)
  const period = (x: number[]) => exactPwl(sys, x, 0, [p.ts]).x[0]
  // Newton on the exact period map (affine for a fixed mode sequence: 1–3 iterations)
  const iG = p.power / (p.vlink * (1 - p.duty))
  let x = [iG, p.vlink]
  const scale = [Math.max(1, Math.abs(iG)), p.vlink]
  let it = 0
  for (; it < 20; it++) {
    const fx = period(x)
    const F = [fx[0] - x[0], fx[1] - x[1]]
    if (Math.abs(F[0]) / scale[0] + Math.abs(F[1]) / scale[1] < 1e-13) break
    const J = new Float64Array(4)
    for (let j = 0; j < 2; j++) {
      const xp = [...x]
      const h = 1e-6 * scale[j]
      xp[j] += h
      const fp = period(xp)
      for (let i = 0; i < 2; i++) J[i * 2 + j] = (fp[i] - xp[i] - F[i]) / h
    }
    const st = solveDense(J, Float64Array.from([-F[0], -F[1]]), 2)
    if (!st) break
    x = [x[0] + st[0], x[1] + st[1]]
  }
  // the pieces of one period: gate edges and the diode events of the exact solution
  const run = exactPwl(sys, x, 0, [p.ts])
  const cuts = [...new Set([...edges, ...run.events.map((e) => e.t), p.ts])].filter((t) => t >= 0 && t <= p.ts).sort((a, b) => a - b)
  const acc = { vl: 0, il: 0, il2: 0, pb: 0, pl: 0, s1: 0, s2: 0, d: 0, dcr: 0, esr: 0 }
  let ilMax = -Infinity
  let ilMin = Infinity
  let vMax = -Infinity
  let vMin = Infinity
  let cMax = -Infinity
  let cMin = Infinity
  const evalAt = (mode: string, xs: number[]) => {
    const [g1, g2, d1, d2] = mode.split('').map(Number)
    const s = solveMode(p, g1, g2, d1, d2, xs[0], xs[1])
    return { s, iL: xs[0] }
  }
  let xs = x
  let prevMode = sys.mode(x, 0.5 * (cuts[0] + cuts[1]), run.events.length ? run.events[run.events.length - 1].to : '')
  for (let c = 0; c + 1 < cuts.length; c++) {
    const a = cuts[c]
    const b = cuts[c + 1]
    if (b - a <= 1e-15 * p.ts) continue
    const tm = 0.5 * (a + b)
    const mode = sys.mode(xs, tm, prevMode)
    prevMode = mode
    // exact states at the Gauss nodes and on a fine grid of the piece (for the extremes)
    const nodes = GL8_X.map((g) => a + 0.5 * (b - a) * (g + 1))
    const grid = Array.from({ length: 33 }, (_, k) => a + ((b - a) * k) / 32)
    const times = [...nodes, ...grid].sort((u, v) => u - v)
    const flow = exactPwl({ ...sys, breakpoints: [], mode: () => mode }, xs, a, times, mode).x
    const at = new Map<number, number[]>()
    times.forEach((t, k) => at.set(t, flow[k]))
    nodes.forEach((t, k) => {
      const w = 0.5 * (b - a) * GL8_W[k]
      const { s, iL } = evalAt(mode, at.get(t)!)
      const vbt = p.vbat - p.rbat * iL
      acc.vl += w * s.vlink
      acc.il += w * iL
      acc.il2 += w * iL * iL
      acc.pb += w * vbt * iL
      acc.pl += w * s.vlink * s.iInv
      acc.s1 += w * p.ron * s.iS1 * s.iS1
      acc.s2 += w * p.ron * s.iS2 * s.iS2
      acc.d += w * (s.iD1 * (p.vf + p.rd * s.iD1) + s.iD2 * (p.vf + p.rd * s.iD2))
      acc.dcr += w * p.rl * iL * iL
      acc.esr += w * p.esr * s.iC * s.iC
    })
    for (const t of grid) {
      const { s, iL } = evalAt(mode, at.get(t)!)
      ilMax = Math.max(ilMax, iL)
      ilMin = Math.min(ilMin, iL)
      vMax = Math.max(vMax, s.vlink)
      vMin = Math.min(vMin, s.vlink)
      const vc = at.get(t)![1]
      cMax = Math.max(cMax, vc)
      cMin = Math.min(cMin, vc)
    }
    xs = at.get(grid[grid.length - 1])!
  }
  const T = p.ts
  const avg = (v: number) => v / T
  // switching: the inductor current and link voltage at each gate edge (exact states there)
  const edgeStates = exactPwl(sys, x, 0, edges.map((e) => e + 1e-18))
  const edgeList: Array<{ device: string; rising: boolean; il: number; vlink: number }> = []
  const [g0a, g0b] = gates(-1e-12 + p.ts)
  let prevG = [g0a, g0b]
  edges.forEach((e, k) => {
    const g = gates(e + 1e-12 * p.ts)
    const xe = edgeStates.x[k]
    // the diodes just after the edge (the simulation's events hold the values just after an edge)
    const after = sys.mode(xe, e + 1e-9 * p.ts, edgeStates.modes[k] ?? '')
    const [, , d1, d2] = after.split('').map(Number)
    const s = solveMode(p, g[0], g[1], d1, d2, xe[0], xe[1])
    if (g[0] !== prevG[0]) edgeList.push({ device: 'S1', rising: g[0] === 1, il: xe[0], vlink: s.vlink })
    if (g[1] !== prevG[1]) edgeList.push({ device: 'S2', rising: g[1] === 1, il: xe[0], vlink: s.vlink })
    prevG = g
  })
  const sw = stageSwitching(p, edgeList)
  const pSw = sw.e / T
  const pBat = avg(acc.pb)
  const pLink = avg(acc.pl)
  const pCond = avg(acc.s1 + acc.s2 + acc.d + acc.dcr + acc.esr)
  const motoring = pLink >= 0
  return {
    duty: p.duty,
    x0: x,
    vlinkAvg: avg(acc.vl),
    vlinkPP: vMax - vMin,
    vcPP: cMax - cMin,
    ilAvg: avg(acc.il),
    ilPP: ilMax - ilMin,
    ilMax,
    ilMin,
    ilRms: Math.sqrt(avg(acc.il2)),
    pBat,
    pLink,
    pS1: avg(acc.s1),
    pS2: avg(acc.s2),
    pD: avg(acc.d),
    pDcr: avg(acc.dcr),
    pEsr: avg(acc.esr),
    pCond,
    pSw,
    efficiency: motoring ? pLink / (pBat + pSw) : (-pBat - pSw) / -pLink,
    newton: it,
  }
}

/** THEORY: the duty that puts the exact model's average link voltage on the target (secant). */
export function exactDuty(p: ResolvedStage, d0: number): number {
  const f = (d: number) => stageExact({ ...p, duty: d }).vlinkAvg - p.vlink
  let a = d0
  let fa = f(a)
  let b = a - (fa * (1 - a)) / p.vlink
  let fb = f(b)
  for (let i = 0; i < 12 && Math.abs(fb) > 1e-9 * p.vlink && fb !== fa; i++) {
    const c = b - (fb * (b - a)) / (fb - fa)
    a = b
    fa = fb
    b = c
    fb = f(b)
  }
  return b
}

/** TEXTBOOK values (ideal synchronous boost in CCM). */
export function stageTextbook(p: ResolvedStage, vt: number, iL: number) {
  const D = p.duty
  const iLink = p.power / p.vlink
  const dI = (vt * D) / (p.l * p.fs)
  return {
    vlink: vt / (1 - D),
    dutyIdeal: 1 - vt / p.vlink,
    ilPP: dI,
    vlinkPP: (Math.abs(iLink) * D) / (p.c * p.fs),
    il: p.power / vt,
    pCond: (iL * iL + (dI * dI) / 12) * (p.ron + p.rl),
    pSw: p.fs * (p.eon + p.eoff) * (p.vlink / E_REF.v) * (Math.abs(iL) / E_REF.i),
  }
}
