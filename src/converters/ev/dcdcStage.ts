import type { Element, NetlistSolution } from '../../circuits/netlist.ts'
import { segmentAverage, simulateCircuit, type CircuitModel } from '../engine.ts'
import { complementaryPair } from '../schedule.ts'
import type { Run, RunParams } from '../types.ts'

/**
 * EV DC-DC STAGE — the bidirectional boost between the traction battery and the inverter's DC link.
 *
 *   battery Voc ─ Rb ─┬─ L (+DCR) ─ sw ─┬─ S1 ∥ D1 (high side) ─ link ─┬─ C (+ESR) ─ 0
 *                     │                 └─ S2 ∥ D2 (low side) ─ 0     └─ inverter: Rinv ─ E ─ 0
 *
 * A synchronous half-bridge: S2 (the boost switch) is ON for D·Ts, S1 (the synchronous rectifier) for the rest,
 * with a dead time td before each turn-on, during which a body diode carries the inductor current. Because both
 * directions of current have a path, the same circuit boosts while motoring (iL > 0) and bucks energy back into
 * the battery while regenerating (iL < 0).
 *
 * The CONTROLLER sets D so that the average link voltage equals the target: D is found by iterating the
 * simulation itself (secant method on the simulated steady state), so D carries every loss and the dead time.
 *
 * The inverter and motor are represented on the link by a source E behind Rinv = 1 Ω, E chosen so that the
 * inverter takes the power P you set at the target voltage (negative P: it feeds power back — regeneration).
 *
 * Switching losses: the engine switches instantly. Each hard edge costs Eon/Eoff of a datasheet point
 * (600 V, 300 A), scaled by the simulated link voltage and the simulated current at that edge (a common
 * loss-calculator method). An edge is hard when the current must be taken away from the opposite diode
 * (S2 while iL > 0, S1 while iL < 0); the other switch turns on with its own diode already conducting (ZVS).
 */
export interface StageParams {
  /** Battery open-circuit voltage [V] and internal resistance [Ω]. */
  vbat: number
  rbat: number
  /** Link voltage target [V]. */
  vlink: number
  /** Power the inverter takes from the link [W]; negative = regeneration. */
  power: number
  fs: number
  l: number
  rl: number
  c: number
  esr: number
  /** MOSFET on-resistance [Ω], body-diode forward voltage [V], dead time [s]. */
  ron: number
  vf: number
  td: number
  /** Switching energies at 600 V / 300 A [J]. */
  eon: number
  eoff: number
  view: 'steady' | 'startup'
  periods: number
  stepsPerPeriod: number
}

export interface ResolvedStage extends StageParams, RunParams {
  ts: number
  /** Duty ratio of S2 (the boost switch's command) the controller found. */
  duty: number
  /** The ideal duty 1 − Vbat/Vlink (no losses, no dead time) for the same operating point. */
  dutyIdeal: number
  /** Inverter source E [V] behind Rinv [Ω]; diode on-resistance [Ω]. */
  einv: number
  rinv: number
  rd: number
  /** Controller iterations and the final |Vlink − target| [V]. */
  iterations: number
  vError: number
}

export const STAGE_DEFAULTS: StageParams = {
  vbat: 350,
  rbat: 0.05,
  vlink: 650,
  power: 60e3,
  fs: 20e3,
  l: 150e-6,
  rl: 0.005,
  c: 500e-6,
  esr: 0.001,
  ron: 0.004,
  vf: 3,
  td: 250e-9,
  eon: 5e-3,
  eoff: 2e-3,
  view: 'steady',
  periods: 3,
  stepsPerPeriod: 200,
}

export const STAGE_LIMITS = {
  vbat: { min: 200, max: 450 },
  rbat: { min: 0, max: 0.2 },
  vlink: { min: 400, max: 800 },
  power: { min: -100e3, max: 150e3 },
  fs: { min: 5e3, max: 100e3 },
  l: { min: 50e-6, max: 1e-3 },
  rl: { min: 0, max: 0.02 },
  c: { min: 100e-6, max: 3e-3 },
  esr: { min: 0, max: 0.01 },
  ron: { min: 0.001, max: 0.05 },
  vf: { min: 1, max: 4.5 },
  td: { min: 50e-9, max: 1e-6 },
  eon: { min: 0, max: 30e-3 },
  eoff: { min: 0, max: 30e-3 },
  periods: { min: 1, max: 10 },
  stepsPerPeriod: { min: 100, max: 2000 },
}
/** Reference point of the switching energies. */
export const E_REF = { v: 600, i: 300 }
export const RINV = 1
export const RD = 0.002

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

export function resolveStage(input: Partial<StageParams> & { duty?: number }): { params: ResolvedStage; issues: string[] } {
  const p = { ...STAGE_DEFAULTS, ...input }
  const issues: string[] = []
  const L = STAGE_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, STAGE_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const q = Object.fromEntries((Object.keys(L) as Array<keyof typeof L>).map((k) => [k, c(k)])) as Record<keyof typeof L, number>
  // the link must sit clearly above the battery: a boost cannot go below its input
  const vMinLink = 1.1 * q.vbat
  if (q.vlink < vMinLink) {
    issues.push(`the link target was raised to ${vMinLink.toFixed(0)} V: a boost stage cannot hold the link below about 1.1 × Vbat`)
    q.vlink = vMinLink
  }
  // the battery must be able to deliver the power: P < Voc²/(4·Rb) with a margin
  if (q.rbat > 0 && q.power > 0.5 * (q.vbat * q.vbat) / (4 * q.rbat)) {
    const pm = 0.5 * (q.vbat * q.vbat) / (4 * q.rbat)
    issues.push(`power limited to ${(pm / 1000).toFixed(0)} kW: half of what the battery can deliver at all, Voc²/(4·Rb)`)
    q.power = pm
  }
  const periods = Math.round(q.periods)
  const stepsPerPeriod = Math.round(q.stepsPerPeriod)
  const ts = 1 / q.fs
  const iInv = q.power / q.vlink
  // battery terminal voltage for the ideal duty: Vt = Voc − Rb·I with I·Vt = P (lossless estimate)
  const disc = q.vbat * q.vbat - 4 * q.rbat * q.power
  const ib = q.rbat > 0 ? (q.vbat - Math.sqrt(Math.max(0, disc))) / (2 * q.rbat) : q.power / q.vbat
  const vt = q.vbat - q.rbat * ib
  const dutyIdeal = 1 - vt / q.vlink
  const duty = Number.isFinite(input.duty) ? Math.min(0.95, Math.max(0.0, input.duty as number)) : dutyIdeal
  const params: ResolvedStage = {
    ...p,
    ...q,
    periods,
    stepsPerPeriod,
    view: 'steady',
    ts,
    duty,
    dutyIdeal,
    einv: q.vlink - RINV * iInv,
    rinv: RINV,
    rd: RD,
    iterations: 0,
    vError: NaN,
    period: ts,
    dt: ts / stepsPerPeriod,
    duration: periods * ts,
  }
  return { params, issues }
}

/** The half-bridge as a netlist for the switched-circuit engine. */
export const stageModel: CircuitModel<Partial<StageParams> & { duty?: number }, ResolvedStage> = {
  kind: 'ev-dcdc',
  resolve: (input) => resolveStage(input),
  build(p) {
    // the command: S1 (upper) ON from D·Ts to Ts, S2 (lower) ON from 0 to D·Ts; each turn-on delayed by td
    const [s1, s2] = complementaryPair('S1', 'S2', p.ts, [
      { t: p.duty * p.ts, rising: true },
      { t: 0, rising: false },
    ], p.td)
    let n = 0
    const nB = ++n // battery + (inside Rb)
    const nT = p.rbat > 0 ? ++n : nB // battery terminal
    const nSw = ++n
    const nLink = ++n
    const nC = p.esr > 0 ? ++n : nLink
    const nE = ++n
    const els: Element[] = [{ kind: 'V', id: 'Vb', a: nB, b: 0, value: () => p.vbat }]
    if (p.rbat > 0) els.push({ kind: 'R', id: 'Rb', a: nB, b: nT, r: p.rbat })
    if (p.rl > 0) {
      const nx = ++n
      els.push({ kind: 'L', id: 'L', a: nT, b: nx, l: p.l }, { kind: 'R', id: 'RL', a: nx, b: nSw, r: p.rl })
    } else els.push({ kind: 'L', id: 'L', a: nT, b: nSw, l: p.l })
    els.push(
      { kind: 'S', id: 'S1', a: nSw, b: nLink, ron: p.ron, gate: s1.at },
      { kind: 'S', id: 'S2', a: nSw, b: 0, ron: p.ron, gate: s2.at },
      { kind: 'D', id: 'D1', a: nSw, b: nLink, vf: p.vf },
      { kind: 'D', id: 'D2', a: 0, b: nSw, vf: p.vf },
      { kind: 'C', id: 'C', a: nC, b: 0, c: p.c },
      { kind: 'R', id: 'Rinv', a: nLink, b: nE, r: p.rinv },
      { kind: 'V', id: 'E', a: nE, b: 0, value: () => p.einv },
    )
    if (p.esr > 0) els.push({ kind: 'R', id: 'ESR', a: nLink, b: nC, r: p.esr })
    const iL = els.findIndex((e) => e.id === 'L')
    const iC = els.findIndex((e) => e.id === 'C')
    const iR = els.findIndex((e) => e.id === 'Rinv')
    const ig = p.power / p.vlink / (1 - p.dutyIdeal)
    return {
      net: { nodes: n, elements: els },
      diode: { kind: 'real', vf: p.vf, ron: p.rd },
      schedules: [s1, s2],
      devices: ['S1', 'S2', 'D1', 'D2'],
      scale: [Math.max(Math.abs(ig), 1), p.vlink],
      initialGuess: [ig, p.vlink],
      read(sol: NetlistSolution) {
        const v = sol.v
        const il = sol.i[iL]
        const [q1, q2] = sol.switches
        const [d1, d2] = sol.diodes
        const vlink = v[nLink]
        const iinv = sol.i[iR]
        const vbt = v[nT]
        return {
          g1: q1.on ? 1 : 0,
          g2: q2.on ? 1 : 0,
          il,
          vsw: v[nSw],
          vlink,
          vc: sol.storage.vC[0],
          ic: sol.i[iC],
          iinv,
          vbt,
          is1: q1.current,
          is2: q2.current,
          id1: d1.current,
          id2: d2.current,
          ihs: q1.current + d1.current,
          pbat: vbt * il,
          plink: vlink * iinv,
          el: 0.5 * p.l * il * il,
          ec: 0.5 * p.c * sol.storage.vC[0] * sol.storage.vC[0],
        }
      },
    }
  },
}

export type StageRun = Run<ResolvedStage>

/**
 * SIMULATION with the controller: the duty that puts the average link voltage on its target, found by the secant
 * method on the simulated periodic steady state (one period per trial), then the displayed run at that duty.
 */
export function simulateStage(input: Partial<StageParams>): StageRun {
  const started = performance.now()
  const base = resolveStage(input).params
  const tol = 1e-5 * base.vlink
  const trial = (d: number) => {
    const r = simulateCircuit(stageModel, { ...input, duty: d })
    return { r, f: segmentAverage(r, 'vlink', r.length - 1 - r.params.stepsPerPeriod) - base.vlink }
  }
  // first guess: the ideal duty corrected for the resistive drops and the dead time (in the dead time the
  // current's own diode conducts: S1's while motoring, S2's while regenerating)
  const iL = base.power / (base.vlink * (1 - base.dutyIdeal))
  const sgn = Math.sign(base.power) || 1
  let d0 = 1 - (base.vlink * (1 - base.dutyIdeal) - (base.rl + base.ron) * iL) / base.vlink + sgn * base.td * base.fs
  let a = trial(d0)
  let best = a
  let it = 1
  if (Math.abs(a.f) > tol) {
    let d1 = d0 - (a.f * (1 - d0)) / base.vlink
    let b = trial(d1)
    it++
    if (Math.abs(b.f) < Math.abs(best.f)) best = b
    for (; it < 10 && Math.abs(b.f) > tol && b.f !== a.f; it++) {
      const d2 = Math.min(0.95, Math.max(0, d1 - (b.f * (d1 - d0)) / (b.f - a.f)))
      d0 = d1
      a = b
      d1 = d2
      b = trial(d1)
      if (Math.abs(b.f) < Math.abs(best.f)) best = b
    }
  }
  const r = best.r
  r.params = { ...r.params, iterations: it, vError: best.f }
  r.diagnostics.computeMs = performance.now() - started
  if (Math.abs(best.f) > 1e-4 * base.vlink) r.diagnostics.issues.push(`the controller could not reach the link target (off by ${best.f.toFixed(3)} V)`)
  return r
}

// ── MEASUREMENTS ──────────────────────────────────────────────────────────────────────────────────────

export interface StageMeasurements {
  duty: number
  dutyIdeal: number
  vlinkAvg: number
  /** Link ripple: as the waveform shows it (samples and edges), and of the capacitor voltage alone (no ESR steps). */
  vlinkPP: number
  vcPP: number
  ilAvg: number
  ilPP: number
  ilMax: number
  ilMin: number
  ilRms: number
  vbtAvg: number
  /** Battery terminal power and inverter power [W] (+ = towards the link). */
  pBat: number
  pLink: number
  /** Conduction losses [W]: switches (Ron), body diodes, inductor DCR, capacitor ESR. */
  pS1: number
  pS2: number
  pD: number
  pDcr: number
  pEsr: number
  pCond: number
  /** Switching losses [W] from the simulated edges; and how many edges per period were hard. */
  pSw: number
  hardEdges: number
  pLoss: number
  /** Efficiency in the direction of the power flow. */
  efficiency: number
  direction: 'motoring' | 'regenerating'
  /** Does iL change sign within the period (both switches soft-switch then)? */
  reverses: boolean
  /** The body diode that carries the current in the dead times: 1 (D1), 2 (D2), 0 (none). */
  deadDiode: number
  /** Power the battery gives (+) or receives (−), Voc·I [W] (incl. its own Rb loss). */
  pChem: number
}

/** Average of p over the last period (exact for piecewise signals: the engine's quadrature). */
const avg = (r: StageRun, sid: string) => segmentAverage(r, sid, r.length - 1 - r.params.stepsPerPeriod)

export function stageSwitching(p: ResolvedStage, edges: Array<{ device: string; rising: boolean; il: number; vlink: number }>): { e: number; hard: number } {
  let e = 0
  let hard = 0
  for (const x of edges) {
    const isHard = (x.device === 'S2' && x.il > 0) || (x.device === 'S1' && x.il < 0)
    if (!isHard) continue
    hard++
    e += (x.rising ? p.eon : p.eoff) * (x.vlink / E_REF.v) * (Math.abs(x.il) / E_REF.i)
  }
  return { e, hard }
}

export function measureStage(r: StageRun): StageMeasurements {
  const p = r.params
  const s = r.signals
  const from = r.length - 1 - p.stepsPerPeriod
  const t0 = r.time[from]
  let ilMax = -Infinity
  let ilMin = Infinity
  let vMax = -Infinity
  let vMin = Infinity
  let cMax = -Infinity
  let cMin = Infinity
  for (let k = from; k < r.length; k++) {
    ilMax = Math.max(ilMax, s.il[k])
    ilMin = Math.min(ilMin, s.il[k])
    vMax = Math.max(vMax, s.vlink[k])
    vMin = Math.min(vMin, s.vlink[k])
    cMax = Math.max(cMax, s.vc[k])
    cMin = Math.min(cMin, s.vc[k])
  }
  // the extremes sit at the switching edges, between samples: the events hold the values just after them
  for (const e of r.events)
    if (e.time >= t0 - 1e-12 * p.ts) {
      ilMax = Math.max(ilMax, e.values.il)
      ilMin = Math.min(ilMin, e.values.il)
      vMax = Math.max(vMax, e.values.vlink)
      vMin = Math.min(vMin, e.values.vlink)
      cMax = Math.max(cMax, e.values.vc)
      cMin = Math.min(cMin, e.values.vc)
    }
  // instantaneous loss signals, averaged with the engine's quadrature
  const n = r.length
  const extra = (name: string, f: (k: number) => number) => {
    const a = new Float64Array(n)
    for (let k = 0; k < n; k++) a[k] = f(k)
    r.signals[name] = a
    return name
  }
  const sq = (x: number) => x * x
  const dev = (id: string) => r.devices.find((d) => d.id === id)!
  const S1 = dev('S1')
  const S2 = dev('S2')
  const D1 = dev('D1')
  const D2 = dev('D2')
  // event values carry the post-edge state: give them the derived quantities too
  for (const e of r.events) {
    const v = e.values
    v.ploss_s1 = p.ron * sq(v.is1 ?? 0)
    v.ploss_s2 = p.ron * sq(v.is2 ?? 0)
    v.ploss_d = (v.id1 ?? 0) * (p.vf + p.rd * (v.id1 ?? 0)) + (v.id2 ?? 0) * (p.vf + p.rd * (v.id2 ?? 0))
    v.ploss_dcr = p.rl * sq(v.il ?? 0)
    v.ploss_esr = p.esr * sq(v.ic ?? 0)
    v.il2 = sq(v.il ?? 0)
  }
  const pS1 = avg(r, extra('ploss_s1', (k) => p.ron * sq(S1.current[k])))
  const pS2 = avg(r, extra('ploss_s2', (k) => p.ron * sq(S2.current[k])))
  const pD = avg(r, extra('ploss_d', (k) => D1.current[k] * (p.vf + p.rd * D1.current[k]) + D2.current[k] * (p.vf + p.rd * D2.current[k])))
  const pDcr = avg(r, extra('ploss_dcr', (k) => p.rl * sq(s.il[k])))
  const pEsr = avg(r, extra('ploss_esr', (k) => p.esr * sq(s.ic[k])))
  const ilRms = Math.sqrt(avg(r, extra('il2', (k) => sq(s.il[k]))))
  const ilAvg = avg(r, 'il')
  const pBat = avg(r, 'pbat')
  const pLink = avg(r, 'plink')
  const edges = r.events
    .filter((e) => (e.kind === 'gate-on' || e.kind === 'gate-off') && e.time >= t0 - 1e-12 * p.ts && e.time < r.time[n - 1] - 1e-12 * p.ts)
    .map((e) => ({ device: e.device ?? '', rising: e.kind === 'gate-on', il: e.values.il, vlink: e.values.vlink }))
  const sw = stageSwitching(p, edges)
  const pSw = sw.e / p.ts
  const pCond = pS1 + pS2 + pD + pDcr + pEsr
  let on1 = 0
  let on2 = 0
  for (let k = from + 1; k < n; k++) {
    on1 += D1.on[k]
    on2 += D2.on[k]
  }
  const motoring = pLink >= 0
  // motoring: the battery supplies Pbat plus the switching energy; regenerating: the battery receives |Pbat| minus it
  const efficiency = motoring ? pLink / (pBat + pSw) : (-pBat - pSw) / -pLink
  return {
    duty: p.duty,
    dutyIdeal: p.dutyIdeal,
    vlinkAvg: avg(r, 'vlink'),
    vlinkPP: vMax - vMin,
    vcPP: cMax - cMin,
    ilAvg,
    ilPP: ilMax - ilMin,
    ilMax,
    ilMin,
    ilRms,
    vbtAvg: avg(r, 'vbt'),
    pBat,
    pLink,
    pS1,
    pS2,
    pD,
    pDcr,
    pEsr,
    pCond,
    pSw,
    hardEdges: sw.hard,
    pLoss: pCond + pSw,
    efficiency,
    direction: motoring ? 'motoring' : 'regenerating',
    reverses: ilMax > 0 && ilMin < 0,
    deadDiode: on1 === 0 && on2 === 0 ? 0 : on1 >= on2 ? 1 : 2,
    pChem: p.vbat * ilAvg,
  }
}
