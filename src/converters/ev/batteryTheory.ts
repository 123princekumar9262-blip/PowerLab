import { expm, type Mat } from '../expm.ts'
import {
  behindR0,
  bmsBalance,
  cellCurrent,
  cellVoltage,
  chargeMode,
  guards,
  modeKey,
  ocv,
  ocvLine,
  ocvSeg,
  OCV_TABLE,
  packCurrent,
  pulseOnAt,
  segBounds,
  socAtOcv,
  type Mode,
  type ResolvedBattery,
} from './battery.ts'

/**
 * BATTERY THEORY — independent of the time-stepping simulation.
 *
 * 1. EXACT (any profile): between two BMS samples the pack is a LINEAR system on each piece where every cell
 *    whose OCV enters the dynamics (a bleeding cell, or the cell held at Vmax) stays on one segment of the OCV
 *    table. Each cell's [SOC, u, w] — coupled to the held cell in CV — is advanced by the matrix exponential
 *    (x(h) = e^{A·h}·x0 + ∫e^{A·τ}dτ·b). The instant a piece ends (an OCV breakpoint, the cut-off, CC → CV,
 *    the end of the charge) is found on the exact flow (Illinois root finding to 10⁻¹² s). The pack's charge,
 *    energy and bleed energy are integrated on every smooth piece by 5-point Gauss–Legendre (exact to
 *    ~10⁻¹³ for these exponentials). Same equations and BMS rules as the simulation, solved exactly.
 * 2. CLOSED FORM (constant-current discharge, pulses): the RC step response u = R1·I·(1 − e^(−t/τ1)),
 *    SOC by charge integration s = s0 − I·t/Q, V = OCV(s) − R0·I − u − w, its cut-off by bisection, and the
 *    energy ∫V·I dt integrated analytically (OCV is linear in t between breakpoints).
 * 3. TEXTBOOK: the instant drop N·R0·I; usable charge = min over the cells of Q·(SOC − SOC at cut-off) with
 *    the polarisation at its steady value (R0 + R1 + R2)·I.
 */

const GL5_X = [-0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664]
const GL5_W = [0.2369268850561891, 0.4786286704993665, 0.5688888888888889, 0.4786286704993665, 0.2369268850561891]
const GL_F = GL5_X.map((x) => 0.5 * (x + 1))
const GL_WT = GL5_W.map((w) => 0.5 * w)

export interface BatteryExact {
  /** State [s, u, w]·N at every tick boundary, with the pack current of the interval ending there. */
  t: number[]
  x: Float64Array[]
  I: number[]
  beta: Uint8Array[]
  /** Events; `v` = the pack voltage just before (with the current that flowed until then). */
  events: Array<{ t: number; device: string; cell?: number; v?: number }>
  spans: Array<{ index: number; t0: number; t1: number; q: number; e: number; eb: number }>
  /** Totals at the end [A·s, J, J]. */
  q: number
  e: number
  eb: number
  duration: number
  computeMs: number
}

type Desc = { what: 'cutoff' | 'cv' | 'cv-cell' | 'cc' | 'full' | 'seg'; cell: number }

/** THEORY: the exact solution of the pack model (see above). */
export function exactBattery(p: ResolvedBattery): BatteryExact {
  const started = performance.now()
  const N = p.n
  let x: Float64Array = new Float64Array(3 * N)
  for (let i = 0; i < N; i++) x[3 * i] = p.s0[i]
  let beta: Uint8Array = new Uint8Array(N)
  const tick = p.tick

  // ── the linear system of one cell's block on a piece ──
  // local state: [s_i, u_i, w_i] — or, in CV for a cell other than the held one m, [s_m, u_m, w_m, s_i, u_i, w_i]
  interface Block {
    A: Mat
    b: number[]
    idx: number[]
    n: number
    /** Exact flow over h: x(h) = M·[x0; 1] (n × (n+1), row-major), per step length. */
    flows: Map<number, Float64Array>
  }
  const blockCache = new Map<string, Block>()
  let segs = new Int32Array(N)
  const block = (i: number, mode: Mode): Block => {
    const cv = mode.kind === 'cv'
    const m = cv ? mode.m : -1
    const key = `${mode.kind}|${m}|${i}|${segs[i]}|${m >= 0 ? segs[m] : -1}|${beta[i]}|${m >= 0 ? beta[m] : -1}`
    const hit = blockCache.get(key)
    if (hit) return hit
    const pair = cv && i !== m
    const n = pair ? 6 : 3
    const A: Mat = Array.from({ length: n }, () => new Array<number>(n).fill(0))
    const b = new Array<number>(n).fill(0)
    // pack current as a linear form over the local state
    const Ic = new Array<number>(n).fill(0)
    let Id = 0
    if (cv) {
      const L = ocvLine(segs[m])
      const cm = p.vmax * (1 + (beta[m] * p.r0) / p.rbal)
      Ic[0] = L.b / p.r0
      Ic[1] = -1 / p.r0
      Ic[2] = -1 / p.r0
      Id = (L.a - cm) / p.r0
    } else Id = packCurrent(p, mode, x, beta)
    const cellRows = (j: number, o: number) => {
      // i_j = κ·I + g·E_j,  E_j = a + b·s − u − w
      const L = ocvLine(segs[j])
      const g = beta[j] ? 1 / (p.rbal + p.r0) : 0
      const kap = beta[j] ? p.rbal / (p.rbal + p.r0) : 1
      const ic = Ic.map((c) => kap * c)
      let id = kap * Id
      ic[o] += g * L.b
      ic[o + 1] -= g
      ic[o + 2] -= g
      id += g * L.a
      for (let c = 0; c < n; c++) {
        A[o][c] = -ic[c] / p.q[j]
        A[o + 1][c] = (p.r1 * ic[c]) / p.tau1
        A[o + 2][c] = (p.r2 * ic[c]) / p.tau2
      }
      A[o + 1][o + 1] -= 1 / p.tau1
      A[o + 2][o + 2] -= 1 / p.tau2
      b[o] = -id / p.q[j]
      b[o + 1] = (p.r1 * id) / p.tau1
      b[o + 2] = (p.r2 * id) / p.tau2
    }
    if (pair) {
      cellRows(m, 0)
      cellRows(i, 3)
    } else cellRows(i, 0)
    const idx = pair ? [3 * m, 3 * m + 1, 3 * m + 2, 3 * i, 3 * i + 1, 3 * i + 2] : [3 * i, 3 * i + 1, 3 * i + 2]
    const B: Block = { A, b, idx, n, flows: new Map() }
    if (blockCache.size > 5000) blockCache.clear()
    blockCache.set(key, B)
    return B
  }
  let blocks: Block[] = []
  const flowOf = (B: Block, h: number): Float64Array => {
    let M = B.flows.get(h)
    if (!M) {
      const n = B.n
      const aug: Mat = Array.from({ length: n + 1 }, (_, r) => Array.from({ length: n + 1 }, (_, c) => (r < n ? (c < n ? B.A[r][c] * h : B.b[r] * h) : 0)))
      const E = expm(aug)
      M = new Float64Array(n * (n + 1))
      for (let r = 0; r < n; r++) for (let c = 0; c <= n; c++) M[r * (n + 1) + c] = E[r][c]
      if (B.flows.size > 400) B.flows.clear()
      B.flows.set(h, M)
    }
    return M
  }
  /** Cell i's [s, u, w] after h (from its own block), written into out at 3·i. */
  const cellInto = (i: number, h: number, out: Float64Array) => {
    const B = blocks[i]
    const M = flowOf(B, h)
    const n = B.n
    const o = n === 6 ? 3 : 0
    for (let r = 0; r < 3; r++) {
      let acc = M[(o + r) * (n + 1) + n]
      for (let c = 0; c < n; c++) acc += M[(o + r) * (n + 1) + c] * x[B.idx[c]]
      out[3 * i + r] = acc
    }
  }
  const cellAt = (i: number, h: number): [number, number, number] => {
    const z = new Float64Array(3 * N)
    cellInto(i, h, z)
    return [z[3 * i], z[3 * i + 1], z[3 * i + 2]]
  }
  const stateAt = (h: number): Float64Array => {
    const out = new Float64Array(3 * N)
    for (let i = 0; i < N; i++) cellInto(i, h, out)
    return out
  }
  /** Cells whose OCV enters the dynamics on this piece. */
  const ocvMatters = (i: number, mode: Mode) => beta[i] === 1 || (mode.kind === 'cv' && mode.m === i)
  /** One guard's value after h (positive = it fired), from the blocks it depends on. */
  const guardAt = (d: Desc, mode: Mode, h: number): number => {
    if (d.what === 'seg') {
      const s = cellAt(d.cell, h)[0]
      const [lo, hi] = segBounds(segs[d.cell])
      return Math.max(lo - s, s - hi)
    }
    const z = new Float64Array(3 * N)
    const put = (i: number) => {
      const c = cellAt(i, h)
      z[3 * i] = c[0]
      z[3 * i + 1] = c[1]
      z[3 * i + 2] = c[2]
    }
    put(d.cell)
    if (mode.kind === 'cv') put(mode.m)
    const all = guards(p, mode, z, beta)
    return all.find((g) => g.what === d.what && g.cell === d.cell)?.g ?? -1
  }
  const segGuards = (mode: Mode, z: Float64Array): Desc[] => {
    const out: Desc[] = []
    for (let i = 0; i < N; i++)
      if (ocvMatters(i, mode)) {
        const [lo, hi] = segBounds(segs[i])
        if (z[3 * i] < lo || z[3 * i] >= hi) out.push({ what: 'seg', cell: i })
      }
    return out
  }
  /** Freeze the OCV segments for a piece: the segment the SOC is moving into. */
  const freezeSegments = (mode: Mode) => {
    segs = new Int32Array(N)
    const I = packCurrent(p, mode, x, beta)
    for (let i = 0; i < N; i++) {
      const s = x[3 * i]
      const ic = cellCurrent(p, behindR0(s, x[3 * i + 1], x[3 * i + 2]), I, beta[i])
      segs[i] = ocvSeg(s - Math.sign(ic) * 1e-12)
    }
    blocks = Array.from({ length: N }, (_, i) => block(i, mode))
  }
  /** Smallest h in (0, H] where the guard turns positive (Illinois method on the exact flow). */
  const root = (d: Desc, mode: Mode, H: number): number => {
    let a = 0
    let fa = Math.min(guardAt(d, mode, 0), -1e-300)
    let b = H
    let fb = guardAt(d, mode, H)
    let side = 0
    for (let it = 0; it < 100 && b - a > 1e-13 * Math.max(1, H); it++) {
      let c = (a * fb - b * fa) / (fb - fa)
      if (!(c > a && c < b)) c = 0.5 * (a + b)
      const fc = guardAt(d, mode, c)
      if (fc > 0) {
        b = c
        fb = fc
        if (side === -1) fa /= 2
        side = -1
      } else {
        a = c
        fa = Math.min(fc, -1e-300)
        if (side === 1) fb /= 2
        side = 1
      }
    }
    return b
  }

  // ── bookkeeping ──
  const out: BatteryExact = { t: [], x: [], I: [], beta: [], events: [], spans: [], q: 0, e: 0, eb: 0, duration: 0, computeMs: 0 }
  let q = 0
  let e = 0
  let eb = 0
  const integrate = (mode: Mode, h: number) => {
    for (let k = 0; k < 5; k++) {
      const z = stateAt(h * GL_F[k])
      const I = packCurrent(p, mode, z, beta)
      let vp = 0
      let pb = 0
      for (let i = 0; i < N; i++) {
        const E = behindR0(z[3 * i], z[3 * i + 1], z[3 * i + 2])
        const v = cellVoltage(p, E, I, beta[i])
        vp += v
        pb += v * (cellCurrent(p, E, I, beta[i]) - I)
      }
      q += h * GL_WT[k] * I
      e += h * GL_WT[k] * I * vp
      eb += h * GL_WT[k] * pb
    }
  }
  let ph = 0
  let phT0 = 0
  let phEnd = ceilTo(p.phases[0].dur, tick)
  let span = { index: 0, t0: 0, q0: 0, e0: 0, eb0: 0 }
  let mode: Mode = { kind: 'rest' }
  let lastI = 0
  const startPhase = (t: number) => {
    phT0 = t
    phEnd = ceilTo(t + p.phases[ph].dur, tick)
    span = { index: ph, t0: t, q0: q, e0: e, eb0: eb }
    const k = p.phases[ph].kind
    if (k === 'dis' || k === 'pulse') out.events.push({ t, device: 'load-on' })
    if (k === 'charge') out.events.push({ t, device: 'charge-on' })
  }
  const vpackNow = (I: number) => {
    let v = 0
    for (let i = 0; i < N; i++) v += cellVoltage(p, behindR0(x[3 * i], x[3 * i + 1], x[3 * i + 2]), I, beta[i])
    return v
  }
  const endPhase = (t: number, device: string | null, cell = -1, iBefore = 0) => {
    out.spans.push({ index: span.index, t0: span.t0, t1: t, q: q - span.q0, e: e - span.e0, eb: eb - span.eb0 })
    if (device) out.events.push({ t, device, v: vpackNow(iBefore), ...(cell >= 0 ? { cell: cell + 1 } : {}) })
    ph++
    if (ph < p.phases.length) startPhase(t)
  }
  const modeFor = (t: number): Mode => {
    const k = p.phases[ph]?.kind
    if (k === 'dis') return { kind: 'load' }
    if (k === 'pulse') return pulseOnAt(p, phT0, t + 0.25 * tick) ? { kind: 'load' } : { kind: 'rest' }
    if (k === 'charge') return chargeMode(p, x, beta)
    return { kind: 'rest' }
  }
  const record = (t: number) => {
    out.t.push(t)
    out.x.push(Float64Array.from(x))
    out.I.push(lastI)
    out.beta.push(Uint8Array.from(beta))
  }
  record(0)
  const maxTicks = Math.ceil(p.phases.reduce((a, s) => a + s.dur, 0) / tick) + 10
  for (let k = 0; k < maxTicks && ph < p.phases.length; k++) {
    const t = k * tick
    while (ph < p.phases.length && t >= phEnd - 1e-9) {
      const P = p.phases[ph]
      endPhase(t, P.kind === 'rest' ? null : P.kind === 'pulse' ? 'pulses-done' : 'timer')
    }
    if (ph >= p.phases.length) break
    if (Math.abs(t / p.bmsT - Math.round(t / p.bmsT)) < 1e-9) {
      const nb = bmsBalance(p, x, lastI, beta, p.phases[ph].balance)
      for (let i = 0; i < N; i++) if (nb[i] !== beta[i]) out.events.push({ t, device: nb[i] ? 'bleed-on' : 'bleed-off', cell: i + 1 })
      beta = nb
    }
    const prev = mode
    mode = modeFor(t)
    if (p.phases[ph].kind === 'pulse' && modeKey(prev) !== modeKey(mode) && t > phT0 + 1e-9) out.events.push({ t, device: mode.kind === 'load' ? 'pulse-on' : 'pulse-off' })
    if (p.phases[ph].kind === 'charge' && modeKey(prev) !== modeKey(mode) && !(prev.kind === 'rest' && mode.kind === 'cc'))
      out.events.push({ t, device: mode.kind === 'cc' ? 'cc' : prev.kind === 'cv' ? 'cv-cell' : 'cv', ...(mode.kind === 'cv' ? { cell: mode.m + 1 } : {}) })
    let tt = t
    const tEnd = t + tick
    for (let guard = 0; guard < 64 && tt < tEnd - 1e-12 && ph < p.phases.length; guard++) {
      const H = tEnd - tt
      freezeSegments(mode)
      const g0 = guards(p, mode, x, beta).find((g) => g.g > 0)
      let fired: Desc | null = g0 ? { what: g0.what, cell: g0.cell } : null
      let hS = 0
      if (!fired) {
        const x1 = stateAt(H)
        const cands: Desc[] = [...guards(p, mode, x1, beta).filter((g) => g.g > 0).map((g) => ({ what: g.what, cell: g.cell })), ...segGuards(mode, x1)]
        if (!cands.length) {
          integrate(mode, H)
          x = x1
          tt = tEnd
          break
        }
        let best = Infinity
        for (const d of cands) {
          const r = root(d, mode, H)
          if (r < best) {
            best = r
            fired = d
          }
        }
        hS = best
        integrate(mode, hS)
        x = stateAt(hS)
      }
      tt += hS
      const f = fired!
      if (f.what === 'seg') continue
      if (f.what === 'cutoff') {
        lastI = 0
        endPhase(tt, 'cutoff', f.cell, packCurrent(p, mode, x, beta))
        mode = { kind: 'rest' }
      } else if (f.what === 'full') {
        endPhase(tt, 'charge-end')
        mode = { kind: 'rest' }
      } else {
        const next = chargeMode(p, x, beta)
        if (modeKey(next) === modeKey(mode)) continue
        mode = next
        out.events.push({ t: tt, device: next.kind === 'cc' ? 'cc' : f.what === 'cv' ? 'cv' : 'cv-cell', ...(next.kind === 'cv' ? { cell: next.m + 1 } : {}) })
      }
      if (ph < p.phases.length && p.phases[ph].kind === 'rest') mode = { kind: 'rest' }
    }
    lastI = packCurrent(p, mode, x, beta)
    record(tEnd)
  }
  out.q = q
  out.e = e
  out.eb = eb
  out.duration = out.t[out.t.length - 1]
  out.computeMs = performance.now() - started
  return out
}

const ceilTo = (t: number, qq: number) => Math.ceil(t / qq - 1e-9) * qq

// ── CLOSED FORM ──────────────────────────────────────────────────────────────────────────────────────

/** RC pair step response: u(t) = u0·e^(−t/τ) + R·I·(1 − e^(−t/τ)). */
export const rcStep = (u0: number, R: number, tau: number, I: number, t: number) => u0 * Math.exp(-t / tau) + R * I * (1 - Math.exp(-t / tau))
/** ∫₀ʰ of the same response. */
export const rcIntegral = (u0: number, R: number, tau: number, I: number, h: number) => R * I * h + (u0 - R * I) * tau * (1 - Math.exp(-h / tau))
/** ∫ OCV(s) ds from s1 to s2 (exact for the piecewise-linear table). */
export function ocvIntegral(s1: number, s2: number): number {
  if (s2 < s1) return -ocvIntegral(s2, s1)
  const cuts = [s1, ...OCV_TABLE.map((r) => r[0]).filter((s) => s > s1 && s < s2), s2]
  let a = 0
  for (let k = 0; k + 1 < cuts.length; k++) a += 0.5 * (ocv(cuts[k]) + ocv(cuts[k + 1])) * (cuts[k + 1] - cuts[k])
  return a
}

export interface CellCF {
  s: number
  u: number
  w: number
}
/** Closed-form state of a cell after h at a constant current I (no bleed). */
export function cellAfter(p: ResolvedBattery, i: number, c: CellCF, I: number, h: number): CellCF {
  return { s: c.s - (I * h) / p.q[i], u: rcStep(c.u, p.r1, p.tau1, I, h), w: rcStep(c.w, p.r2, p.tau2, I, h) }
}
export const cellV = (p: ResolvedBattery, c: CellCF, I: number) => ocv(c.s) - c.u - c.w - p.r0 * I

/**
 * Closed form of a CONSTANT-CURRENT discharge from rest (no bleeding): the first cell to reach Vmin (bisection on
 * V(t) = OCV(s0 − I·t/Q) − R0·I − u(t) − w(t)), the charge I·t and the energy ∫V·I dt (analytic).
 */
export function ccDischargeClosedForm(p: ResolvedBattery, start: CellCF[], I: number): { t: number; cell: number; q: number; e: number; end: CellCF[] } {
  const V = (i: number, t: number) => cellV(p, cellAfter(p, i, start[i], I, t), I)
  let best = Infinity
  let cell = 0
  for (let i = 0; i < p.n; i++) {
    if (V(i, 0) <= p.vmin) {
      best = 0
      cell = i
      break
    }
    let lo = 0
    let hi = 60
    while (V(i, hi) > p.vmin && hi < 1e7) hi *= 2
    for (let it = 0; it < 200 && hi - lo > 1e-12 * hi; it++) {
      const mid = 0.5 * (lo + hi)
      if (V(i, mid) > p.vmin) lo = mid
      else hi = mid
    }
    if (hi < best) {
      best = hi
      cell = i
    }
  }
  const t = best
  let e = 0
  const end: CellCF[] = []
  for (let i = 0; i < p.n; i++) {
    const c = start[i]
    const ce = cellAfter(p, i, c, I, t)
    end.push(ce)
    // ∫OCV(s(t))dt = (Q/I)·∫ OCV ds over [s_end, s0]
    const intOcv = (p.q[i] / I) * ocvIntegral(ce.s, c.s)
    e += I * (intOcv - p.r0 * I * t - rcIntegral(c.u, p.r1, p.tau1, I, t) - rcIntegral(c.w, p.r2, p.tau2, I, t))
  }
  return { t, cell, q: I * t, e, end }
}

/** Closed-form states after a sequence of constant-current intervals (no bleeding, no cut-off). */
export function piecewiseClosedForm(p: ResolvedBattery, start: CellCF[], pieces: Array<{ I: number; h: number }>): CellCF[][] {
  const out: CellCF[][] = [start]
  let cur = start
  for (const pc of pieces) {
    cur = cur.map((c, i) => cellAfter(p, i, c, pc.I, pc.h))
    out.push(cur)
  }
  return out
}

/**
 * TEXTBOOK usable charge from a state: every cell can give Q·(s − s_cut) with s_cut where OCV = Vmin plus the
 * steady polarisation (R0 + R1 + R2)·I; the pack gives the smallest of them.
 */
export function usableTextbook(p: ResolvedBattery, socs: number[], I: number): { q: number; cell: number } {
  const sCut = socAtOcv(p.vmin + (p.r0 + p.r1 + p.r2) * I)
  let q = Infinity
  let cell = 0
  socs.forEach((s, i) => {
    const qi = p.q[i] * (s - sCut)
    if (qi < q) {
      q = qi
      cell = i
    }
  })
  return { q: Math.max(0, q), cell }
}
