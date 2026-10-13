import type { Mat } from '../expm.ts'
import { exactPwl, simulatePwl, type PwlEvent, type PwlSystem } from '../pwl.ts'
import type { Run, RunEvent, RunParams } from '../types.ts'
import { cumulatives, type Cumulative } from './pwlEnergy.ts'

/**
 * DEVICES — GaN HEMT half-bridge in a double-pulse test, WITH DEAD TIME and NO BODY DIODE.
 *
 *   Vdc ─┬─ L (current I0) ─┬─ switch node (vDS of the low side)
 *        └── high-side HEMT ┘   (gate driven: ON = synchronous rectifier, OFF during the dead times)
 *   low-side HEMT: the switch under test — gate driver Vg(t) ── Rg ── gate;  Cgs, Cgd, Cds
 *
 * A GaN HEMT has no p-n body diode. Its channel is symmetric: with the gate OFF it still conducts in reverse
 * (third quadrant) as soon as the gate–DRAIN voltage exceeds Vth, i.e. when the source–drain voltage reaches
 *   V_SD = Vth − vGS(off)           (so a negative off-voltage makes the drop LARGER),
 * plus the channel resistance: v_SD = (Vth − vGS) + Ron·i_F. With its gate ON it is a resistor Ron both ways.
 * There are no minority carriers, so there is no reverse-recovery charge: when the low side takes the current
 * over, the high-side current simply falls to zero; what remains is the charge of its output capacitance.
 *
 * Low side: the MOSFET model (channel cut / saturation gm·(vGS − Vth) / ohmic vDS/Ron, constant capacitances).
 * Switch node: Cn = Cgd + Cds (low side) + Coss of the high side (= Cgd + Cds, identical device).
 * State x = [vGS, vDS] of the low side.  Gate KCL: (Vg − vGS)/Rg = Ciss·vGS' − Cgd·vDS'.
 * Node KCL: I0 − i_ch − i_F = −Cgd·vGS' + Cn·vDS',   i_F = high-side reverse current:
 *   HS gate ON:            i_F = (vDS − Vdc)/Ron
 *   HS gate OFF, reverse:  i_F = (vDS − Vdc − (Vth − Voff))/Ron   while i_F ≥ 0
 *   HS gate OFF, blocking: i_F = 0
 * Each (low-side region, high-side mode) is linear: a PWL hybrid system (converters/pwl.ts).
 *
 * Simplifications: constant capacitances (charge-equivalent values), the high-side gate switches ideally
 * (its own gate charge is not modelled), no stray inductance (no ringing), no current collapse (dynamic Ron).
 */
export interface GanParams {
  vdc: number
  i0: number
  vdrv: number
  voff: number
  rg: number
  cgs: number
  cgd: number
  cds: number
  vth: number
  gm: number
  ron: number
  /** Dead time between one device's gate-off and the other's gate-on [s]. */
  tdead: number
  view: 'steady' | 'startup'
  periods: number
  stepsPerPeriod: number
}

export interface ResolvedGan extends GanParams, RunParams {
  ciss: number
  /** High-side output capacitance and the switch-node capacitance. */
  chs: number
  cn: number
  vpl: number
  /** Reverse-conduction threshold of the high side with its gate off: Vth − Voff. */
  vf: number
  thsOff: number
  ton: number
  toff: number
  thsOn: number
  tend: number
  steps: number
}

/** A 650 V, 50 mΩ-class e-mode GaN HEMT at 400 V. */
export const GAN_DEFAULTS: GanParams = {
  vdc: 400,
  i0: 15,
  vdrv: 6,
  voff: 0,
  rg: 5,
  cgs: 250e-12,
  cgd: 4.5e-12,
  cds: 100e-12,
  vth: 1.7,
  gm: 23,
  ron: 0.05,
  tdead: 10e-9,
  view: 'steady',
  periods: 1,
  stepsPerPeriod: 8000,
}

export const GAN_LIMITS = {
  vdc: { min: 5, max: 650 },
  i0: { min: 0.5, max: 60 },
  vdrv: { min: 4, max: 7 },
  voff: { min: -4, max: 0 },
  rg: { min: 0.5, max: 50 },
  cgs: { min: 20e-12, max: 2e-9 },
  cgd: { min: 0.5e-12, max: 50e-12 },
  cds: { min: 5e-12, max: 1e-9 },
  vth: { min: 1, max: 3 },
  gm: { min: 1, max: 200 },
  ron: { min: 0.01, max: 1 },
  tdead: { min: 0, max: 100e-9 },
}

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

export function resolveGan(input: Partial<GanParams>): { params: ResolvedGan; issues: string[] } {
  const p = { ...GAN_DEFAULTS, ...input }
  const issues: string[] = []
  const L = GAN_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, GAN_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const q = { vdc: c('vdc'), i0: c('i0'), vdrv: c('vdrv'), voff: c('voff'), rg: c('rg'), cgs: c('cgs'), cgd: c('cgd'), cds: c('cds'), vth: c('vth'), gm: c('gm'), ron: c('ron'), tdead: c('tdead') }
  const ciss = q.cgs + q.cgd
  const chs = q.cgd + q.cds
  const cn = q.cgd + q.cds + chs
  const vpl = q.vth + q.i0 / q.gm
  if (vpl >= q.vdrv) issues.push('the gate drive cannot reach the plateau: the low side never fully turns on')
  if (q.vdrv > 6) issues.push('vGS above +6 V: beyond the recommended drive of an e-mode GaN gate (absolute maximum about +7 V)')
  const tauG = q.rg * ciss
  const tvf = (q.rg * q.cgd * q.vdc) / Math.max(0.2, q.vdrv - vpl)
  const phase = Math.max(10 * tauG, 3 * tvf, (2 * cn * q.vdc) / q.i0)
  const thsOff = 0.25 * phase
  const ton = thsOff + q.tdead
  const toff = ton + 1.3 * phase
  const thsOn = toff + q.tdead
  const tend = thsOn + Math.max(0.6 * phase, 1.3 * phase - q.tdead)
  const steps = Math.min(40000, Math.max(8000, Math.ceil(tend / (phase / 400))))
  return {
    params: {
      ...p,
      ...q,
      ciss,
      chs,
      cn,
      vpl,
      vf: q.vth - q.voff,
      thsOff,
      ton,
      toff,
      thsOn,
      tend,
      steps,
      view: 'steady',
      periods: 1,
      stepsPerPeriod: steps,
      period: tend,
      dt: tend / steps,
      duration: tend,
    },
    issues,
  }
}

export const ganVg = (p: ResolvedGan, t: number) => (t >= p.ton && t < p.toff ? p.vdrv : p.voff)
/** High-side gate command: ON except in the window around the low-side pulse (dead time included). */
export const hsGateOn = (p: ResolvedGan, t: number) => t < p.thsOff || t >= p.thsOn

export type GanRegion = 'cut' | 'sat' | 'ohm'
export type HsMode = 'on' | 'rev' | 'off'

export function lsChannel(p: ResolvedGan, vgs: number, vds: number): { region: GanRegion; i: number } {
  if (vgs <= p.vth) return { region: 'cut', i: 0 }
  const sat = p.gm * (vgs - p.vth)
  const ohm = vds / p.ron
  return sat <= ohm ? { region: 'sat', i: sat } : { region: 'ohm', i: ohm }
}

/** High-side reverse current for a mode (+ = from the switch node up to Vdc, the freewheeling direction). */
export function hsCurrent(p: ResolvedGan, hs: HsMode, vds: number): number {
  if (hs === 'on') return (vds - p.vdc) / p.ron
  if (hs === 'rev') return (vds - p.vdc - p.vf) / p.ron
  return 0
}

export function ganSystem(p: ResolvedGan): PwlSystem {
  const det = p.ciss * p.cn - p.cgd * p.cgd
  const K: Mat = [
    [p.cn / det, p.cgd / det],
    [p.cgd / det, p.ciss / det],
  ]
  return {
    n: 2,
    breakpoints: [p.thsOff, p.ton, p.toff, p.thsOn].filter((t, i, a) => a.indexOf(t) === i),
    mode(x, t, prev) {
      const [vgs, vds] = x
      const ch = lsChannel(p, vgs, vds)
      let hs: HsMode
      if (hsGateOn(p, t)) hs = 'on'
      else {
        const over = vds - p.vdc - p.vf
        // conducting while its current is ≥ 0; a blocking device starts only once the node is above the threshold
        hs = prev.endsWith('|rev') ? (over >= 0 ? 'rev' : 'off') : over > 1e-12 * p.vdc ? 'rev' : 'off'
      }
      return `${ch.region}|${hs}`
    },
    sys(mode, t) {
      const [region, hs] = mode.split('|')
      const vg = ganVg(p, t)
      // gate row: (Vg − vGS)/Rg;  node row: I0 − i_ch − i_F
      const R: Mat = [
        [-1 / p.rg, 0],
        [region === 'sat' ? -p.gm : 0, (region === 'ohm' ? -1 / p.ron : 0) + (hs === 'off' ? 0 : -1 / p.ron)],
      ]
      const r0 = [vg / p.rg, p.i0 + (region === 'sat' ? p.gm * p.vth : 0) + (hs === 'on' ? p.vdc / p.ron : hs === 'rev' ? (p.vdc + p.vf) / p.ron : 0)]
      const A: Mat = [
        [K[0][0] * R[0][0] + K[0][1] * R[1][0], K[0][0] * R[0][1] + K[0][1] * R[1][1]],
        [K[1][0] * R[0][0] + K[1][1] * R[1][0], K[1][0] * R[0][1] + K[1][1] * R[1][1]],
      ]
      return { A, b: [K[0][0] * r0[0] + K[0][1] * r0[1], K[1][0] * r0[0] + K[1][1] * r0[1]] }
    },
  }
}

/** Derived quantities at a state: currents, powers (the node's dv/dt from the mode's own equations). */
export function ganDerived(p: ResolvedGan, sys: PwlSystem, vgs: number, vds: number, t: number, mode: string) {
  const [region, hs] = mode.split('|') as [GanRegion, HsMode]
  const ch = lsChannel(p, vgs, vds)
  const { A, b } = sys.sys(mode, t)
  const dvds = A[1][0] * vgs + A[1][1] * vds + b[1]
  const iF = hsCurrent(p, hs, vds)
  const vg = ganVg(p, t)
  // low-side drain terminal current: KCL at the node minus the high side's channel and output capacitance
  const id = p.i0 - iF - p.chs * dvds
  return { region, hs, ich: region === 'cut' ? 0 : ch.i, vg, ig: (vg - vgs) / p.rg, iF, id, vsd: vds - p.vdc, pls: vds * id, phs: (vds - p.vdc) * iF }
}

export type GanRun = Run<ResolvedGan> & {
  pwlEvents: PwlEvent[]
  modes: string[]
  knots: Array<{ t: number; x: number[]; mode: string }>
  /** Running integrals over the simulated solution (event points included). */
  Els: Cumulative
  Ehs: Cumulative
  /** ∫ (iD − I0) dt: the charge the low side delivers beyond the load current. */
  Qx: Cumulative
}

/** SIMULATION. */
export function simulateGan(input: Partial<GanParams>): GanRun {
  const started = performance.now()
  const { params: p, issues } = resolveGan(input)
  const sys = ganSystem(p)
  const res = simulatePwl(sys, [p.voff, p.vdc + p.ron * p.i0], 0, p.tend, p.steps, 'cut|on')
  // the dynamics depend on time only through the low-side gate level: reuse them for the derived quantities
  const memo = new Map<string, ReturnType<PwlSystem['sys']>>()
  const dsys: PwlSystem = {
    ...sys,
    sys: (mode, t) => {
      const key = `${mode}|${ganVg(p, t)}`
      let v = memo.get(key)
      if (!v) memo.set(key, (v = sys.sys(mode, t)))
      return v
    },
  }
  const n = p.steps + 1
  const names = ['vgs', 'vds', 'vg', 'ig', 'ich', 'id', 'iF', 'vsd', 'hsgate', 'pls', 'phs', 'els', 'ehs']
  const s: Record<string, Float64Array> = Object.fromEntries(names.map((k) => [k, new Float64Array(n)]))
  const der = (x: number[], t: number, mode: string) => ganDerived(p, dsys, x[0], x[1], t, mode)
  const [Els, Ehs, Qx] = cumulatives(
    res,
    (x, t, m) => {
      const d = der(x, t, m)
      return [d.pls, d.phs, d.id - p.i0]
    },
    sys.breakpoints,
  )
  let shoot = 0
  for (let k = 0; k < n; k++) {
    const d = der([res.x[0][k], res.x[1][k]], res.t[k], res.modes[k])
    s.vgs[k] = res.x[0][k]
    s.vds[k] = res.x[1][k]
    s.vg[k] = d.vg
    s.ig[k] = d.ig
    s.ich[k] = d.ich
    s.id[k] = d.id
    s.iF[k] = d.iF
    s.vsd[k] = d.vsd
    s.hsgate[k] = hsGateOn(p, res.t[k]) ? 1 : 0
    s.pls[k] = d.pls
    s.phs[k] = d.phs
    shoot = Math.min(shoot, d.iF)
  }
  s.els.set(Els.cum)
  s.ehs.set(Ehs.cum)
  if (shoot < -0.05 * p.i0) issues.push(`shoot-through: the high side conducts forward (${shoot.toFixed(1)} A) — the dead time is shorter than the low side's turn-off`)
  const events: RunEvent[] = []
  let seq = 0
  const ev = (kind: RunEvent['kind'], t: number, device: string) => {
    const k = Math.min(n - 1, Math.max(0, Math.round(t / p.dt)))
    events.push({ id: `g${seq++}`, kind, time: t, device, values: { vgs: s.vgs[k], vds: s.vds[k], id: s.id[k], iF: s.iF[k] } })
  }
  ev('gate-off', p.thsOff, 'high-side driver')
  ev('gate-on', p.ton, 'driver')
  ev('gate-off', p.toff, 'driver')
  ev('gate-on', p.thsOn, 'high-side driver')
  for (const x of res.events) if (x.from !== x.to) ev('mode', x.t, `${x.from}→${x.to}`)
  events.sort((a, b) => a.time - b.time)
  return {
    kind: 'gan',
    params: p,
    length: n,
    time: res.t,
    signals: s,
    devices: [],
    events,
    steadyFrom: 0,
    pwlEvents: res.events,
    modes: res.modes,
    knots: res.knots,
    Els,
    Ehs,
    Qx,
    diagnostics: { computeMs: performance.now() - started, fallbacks: 0, steady: { method: 'direct', iterations: 0, residual: 0, converged: true }, issues },
  }
}

export interface GanTimes {
  /** t1 channel on, t2 high side releases, t3 ohmic; t4 leaves ohmic, t5 high side starts reverse conduction, t6 channel off; tr0 first reverse conduction. */
  t: Array<number | null>
  tdOn: number | null
  tri: number | null
  tfv: number | null
  tdOff: number | null
  trv: number | null
  /** From the gate-off edge to the channel being cut. */
  tChOff: number | null
  /** Reverse conduction of the high side: in the dead time before turn-on, after turn-off. */
  trevOn: number | null
  trevOff: number | null
}

const first = (evs: PwlEvent[], after: number, before: number, test: (e: PwlEvent) => boolean) => evs.find((e) => e.t > after && e.t < before && test(e))?.t ?? null
const reg = (m: string) => m.split('|')[0]
const hsm = (m: string) => m.split('|')[1]

export function ganTimes(p: ResolvedGan, evs: PwlEvent[]): GanTimes {
  const tr0 = first(evs, p.thsOff - 1e-18, p.toff, (e) => hsm(e.from) !== 'rev' && hsm(e.to) === 'rev')
  const t1 = first(evs, p.ton, p.toff, (e) => reg(e.from) === 'cut' && reg(e.to) === 'sat')
  const t2 = first(evs, p.ton, p.toff, (e) => hsm(e.from) === 'rev' && hsm(e.to) === 'off')
  const t3 = first(evs, p.ton, p.toff, (e) => reg(e.from) === 'sat' && reg(e.to) === 'ohm')
  const t4 = first(evs, p.toff, p.tend, (e) => reg(e.from) === 'ohm' && reg(e.to) === 'sat')
  const t5 = first(evs, p.toff, p.thsOn, (e) => hsm(e.from) === 'off' && hsm(e.to) === 'rev')
  const t6 = first(evs, p.toff, p.tend, (e) => reg(e.from) !== 'cut' && reg(e.to) === 'cut')
  return {
    t: [t1, t2, t3, t4, t5, t6, tr0],
    tdOn: t1 !== null ? t1 - p.ton : null,
    tri: t1 !== null && t2 !== null ? t2 - t1 : null,
    tfv: t2 !== null && t3 !== null ? t3 - t2 : null,
    tdOff: t4 !== null ? t4 - p.toff : null,
    trv: t4 !== null && t5 !== null ? t5 - t4 : null,
    tChOff: t6 !== null ? t6 - p.toff : null,
    trevOn: tr0 !== null && t2 !== null ? t2 - tr0 : null,
    trevOff: t5 !== null ? p.thsOn - t5 : null,
  }
}

/**
 * Eoff ends when the high side turns on — if the low side's channel is already off by then. If it is still on,
 * the high side turns on into it (shoot-through) and that energy belongs to the low side's turn-off: to the end.
 */
export const eoffEnd = (p: ResolvedGan, t6: number | null) => (t6 !== null && t6 <= p.thsOn ? p.thsOn : p.tend)

export interface GanMeasurements extends Omit<GanTimes, 't'> {
  /** Low side: turn-on and turn-off energy (terminal v·i). */
  eon: number
  eoff: number
  /** High side: reverse-conduction energy in each dead time, and their sum per switching cycle. */
  erevOn: number
  erevOff: number
  edead: number
  /** Source–drain drop of the high side: reverse conduction (gate off) and synchronous (gate on), at I0. */
  vsdRev: number
  vsdSync: number
  /** Extra charge the low side delivers at turn-on (the high side's Coss — no reverse recovery). */
  qoss: number
  /** Lowest high-side current during the turn-on (0 = no reverse recovery; < 0 would be a recovery current). */
  iFmin: number
  /** Peak forward (shoot-through) current of the high side when the dead time is too short, else 0. */
  shootThrough: number
  vdsOn: number
  dvdtOn: number | null
  dvdtOff: number | null
  plateau: number | null
}

export function measureGan(r: GanRun): GanMeasurements {
  const p = r.params
  const s = r.signals
  const tm = ganTimes(p, r.pwlEvents)
  const [t1, t2, t3, t4, t5, t6, tr0] = tm.t
  const E = (a: number, b: number) => r.Els.at(b) - r.Els.at(a)
  const H = (a: number, b: number) => r.Ehs.at(b) - r.Ehs.at(a)
  const at = (sig: Float64Array, t: number) => {
    const u = Math.min(r.length - 1, Math.max(0, t / p.dt))
    const k = Math.min(r.length - 2, Math.floor(u))
    return sig[k] * (1 - (u - k)) + sig[k + 1] * (u - k)
  }
  const kon = Math.max(0, Math.floor(p.toff / p.dt) - 1)
  const vdsOn = s.vds[kon]
  let iFmin = Infinity
  if (t2 !== null) for (let k = Math.ceil(t2 / p.dt); k < Math.floor(p.toff / p.dt); k++) iFmin = Math.min(iFmin, s.iF[k])
  const erevOn = H(p.thsOff, p.toff)
  const erevOff = H(p.toff, p.thsOn)
  let iFneg = 0
  for (let k = 0; k < r.length; k++) iFneg = Math.min(iFneg, s.iF[k])
  return {
    ...tm,
    eon: t3 !== null ? E(p.ton, t3) : E(p.ton, p.toff),
    eoff: E(p.toff, eoffEnd(p, t6)),
    erevOn,
    erevOff,
    edead: erevOn + erevOff,
    vsdRev: tr0 !== null && t1 !== null ? at(s.vsd, 0.5 * (tr0 + t1)) : NaN,
    shootThrough: iFneg < -0.05 * p.i0 ? -iFneg : 0,
    vsdSync: at(s.vsd, 0.5 * p.thsOff),
    qoss: t2 !== null && t3 !== null ? r.Qx.at(t3) - r.Qx.at(t2) : 0,
    iFmin: Number.isFinite(iFmin) ? iFmin : 0,
    vdsOn,
    dvdtOn: t2 !== null && t3 !== null ? (p.vdc + p.vf - vdsOn) / (t3 - t2) : null,
    dvdtOff: t4 !== null && t5 !== null ? (p.vdc + p.vf - at(s.vds, t4)) / (t5 - t4) : null,
    plateau: t2 !== null && t3 !== null ? at(s.vgs, 0.5 * (t2 + t3)) : null,
  }
}

export interface GanExact extends GanTimes {
  eon: number
  eoff: number
  erevOn: number
  erevOff: number
  vsdRev: number
  vsdSync: number
  qoss: number
}

/** THEORY: the exact PWL solution (matrix exponential); energies by dense exact sampling of each interval. */
export function exactGan(p: ResolvedGan): GanExact {
  const sys = ganSystem(p)
  const x0 = [p.voff, p.vdc + p.ron * p.i0]
  const all = exactPwl(sys, x0, 0, [p.tend], 'cut|on')
  const tm = ganTimes(p, all.events)
  const [t1, t2, t3, , , t6, tr0] = tm.t
  const integral = (a: number, b: number, f: (d: ReturnType<typeof ganDerived>) => number, M = 1200) => {
    if (!(b > a)) return 0
    // the knots of the exact solution inside [a, b] (mode changes, breakpoints) are sampled on both sides
    const inner = [...all.events.map((e) => e.t), ...sys.breakpoints].filter((t) => t > a && t < b).sort((x, y) => x - y)
    const edges = [a, ...inner, b]
    let sum = 0
    for (let j = 1; j < edges.length; j++) {
      const lo = edges[j - 1]
      const hi = edges[j]
      const m = Math.max(4, Math.ceil((M * (hi - lo)) / (b - a)))
      // sample strictly inside the piece (its own mode and inputs), Simpson-free trapezoid at fine spacing
      const ts = Array.from({ length: m + 1 }, (_, i) => lo + ((hi - lo) * i) / m)
      const ex = exactPwl(sys, x0, 0, ts, 'cut|on')
      const mid = (lo + hi) / 2
      const modeIn = sys.mode(ex.x[Math.floor(m / 2)], mid, ex.modes[Math.floor(m / 2)])
      const val = (i: number) => {
        const tt = i === 0 ? lo + (hi - lo) * 1e-12 : i === m ? hi - (hi - lo) * 1e-12 : ts[i]
        return f(ganDerived(p, sys, ex.x[i][0], ex.x[i][1], tt, i === 0 || i === m ? modeIn : ex.modes[i]))
      }
      for (let i = 1; i <= m; i++) sum += 0.5 * (val(i - 1) + val(i)) * (ts[i] - ts[i - 1])
    }
    return sum
  }
  const sAt = (t: number) => exactPwl(sys, x0, 0, [t], 'cut|on').x[0]
  return {
    ...tm,
    eon: t3 !== null ? integral(p.ton, t3, (d) => d.pls) : integral(p.ton, p.toff, (d) => d.pls),
    eoff: integral(p.toff, eoffEnd(p, t6), (d) => d.pls),
    erevOn: integral(p.thsOff, p.toff, (d) => d.phs),
    erevOff: integral(p.toff, p.thsOn, (d) => d.phs),
    vsdRev: tr0 !== null && t1 !== null ? sAt(0.5 * (tr0 + t1))[1] - p.vdc : NaN,
    vsdSync: sAt(0.5 * p.thsOff)[1] - p.vdc,
    qoss: t2 !== null && t3 !== null ? integral(t2, t3, (d) => d.id - p.i0) : 0,
  }
}

/** THEORY 2: closed forms (static drops, dead-time loss with the full current for the whole dead time). */
export function textbookGan(p: ResolvedGan) {
  const vsdRev = p.vth - p.voff + p.ron * p.i0
  return {
    vsdRev,
    vsdSync: p.ron * p.i0,
    /** Reverse conduction for exactly one dead time at I0. */
    erevDead: vsdRev * p.i0 * p.tdead,
    /** The high side's output charge, swung from Vdc + V_SD to 0 (in the low side's on-state). */
    qoss: p.chs * (p.vdc + p.vf),
    tdOn: p.rg * p.ciss * Math.log((p.vdrv - p.voff) / (p.vdrv - p.vth)),
  }
}
