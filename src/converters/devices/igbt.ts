import type { Mat } from '../expm.ts'
import { exactPwl, simulatePwl, type PwlEvent, type PwlSystem } from '../pwl.ts'
import type { Run, RunEvent, RunParams } from '../types.ts'
import { cumulative, cumulatives, type Cumulative } from './pwlEnergy.ts'
import { derived as mosDerived, mosfetSystem, resolveMosfet, switchingTimes as mosSwitchingTimes, type ResolvedMosfet, type SwitchingTimes } from './mosfet.ts'

/**
 * DEVICES — IGBT switching in a DOUBLE-PULSE TEST (clamped inductive load), with the bipolar TAIL.
 *
 *   Vdc ─┬─ L (current I0) ─┬─ collector;  freewheeling diode (anode at the collector, cathode at Vdc)
 *   gate driver Vg(t) ── Rg ── gate;  Cge, Cgc (Miller), Cce
 *
 * The IGBT is a MOSFET driving the base of a wide-base PNP transistor. Its collector current is carried by
 * electrons (the MOS channel current i_ch) and by holes (i_p, injected from the p+ collector):
 *
 *   collector current  iC = i_ch + i_p
 *   channel            cut (vGE ≤ Vth): i_ch = 0
 *                      active (the channel limits the current): i_ch = gm·(vGE − Vth)
 *                      on-state: iC = (vCE − V0)/r   — the knee V0 of the p+ junction and the drift resistance r
 *   stored charge      di_p/dt = (k·i_ch − i_p)/τ,   k = α/(1 − α)
 *     (charge control: the electron current is the PNP's base current; the holes it injects are stored in the
 *      drift region and recombine with the carrier lifetime τ. In a steady on-state i_p = α·iC.)
 *
 * When the channel turns off (i_ch = 0) nothing removes the stored holes but recombination: the collector keeps
 * conducting i_p(t) = i_p(t₆)·e^(−(t − t₆)/τ) at the full blocking voltage — the TAIL CURRENT.
 *
 * State x = [vGE, vCE, i_p]. Gate and collector KCL are the MOSFET's (converters/devices/mosfet.ts) with the
 * channel current replaced by iC; while the diode conducts it clamps vCE = Vdc. Each (region, diode) mode is
 * linear: a PWL hybrid system, simulated and solved exactly by converters/pwl.ts.
 *
 * Simplifications (stated in the topic): constant capacitances, no conductivity-modulation delay of r (no
 * "dynamic saturation"), an ideal freewheeling diode (no reverse recovery), no stray inductance.
 */
export interface IgbtParams {
  vdc: number
  i0: number
  vdrv: number
  voff: number
  rg: number
  cge: number
  cgc: number
  cce: number
  vth: number
  gm: number
  /** On-state: VCE(sat) = V0 + r·iC. */
  v0: number
  rce: number
  /** Hole (PNP) share of the on-state current α and the carrier lifetime τ [s]. */
  alpha: number
  tau: number
  /** On-resistance of the MOSFET compared at the same conditions (same gate, same die capacitances). */
  ronMos: number
  view: 'steady' | 'startup'
  periods: number
  stepsPerPeriod: number
}

export interface ResolvedIgbt extends IgbtParams, RunParams {
  ciss: number
  /** Turn-on plateau Vth + I0/gm and turn-off plateau Vth + (1 − α)·I0/gm (the holes carry α·I0). */
  vplOn: number
  vplOff: number
  ton: number
  toff: number
  tend: number
  steps: number
}

export const IGBT_DEFAULTS: IgbtParams = {
  vdc: 400,
  i0: 20,
  vdrv: 15,
  voff: -8,
  rg: 10,
  cge: 2e-9,
  cgc: 80e-12,
  cce: 50e-12,
  vth: 5.5,
  gm: 8,
  v0: 0.8,
  rce: 0.04,
  alpha: 0.3,
  tau: 200e-9,
  ronMos: 0.15,
  view: 'steady',
  periods: 1,
  stepsPerPeriod: 8000,
}

/** Limits: the gate and capacitance limits are the MOSFET's, so the MOSFET compared runs the same values. */
export const IGBT_LIMITS = {
  vdc: { min: 5, max: 1000 },
  i0: { min: 0.5, max: 200 },
  vdrv: { min: 8, max: 20 },
  voff: { min: -10, max: 0 },
  rg: { min: 0.5, max: 100 },
  cge: { min: 0.1e-9, max: 20e-9 },
  cgc: { min: 5e-12, max: 2e-9 },
  cce: { min: 0, max: 5e-9 },
  vth: { min: 2, max: 6 },
  gm: { min: 0.5, max: 200 },
  v0: { min: 0.3, max: 2 },
  rce: { min: 1e-3, max: 1 },
  alpha: { min: 0, max: 0.8 },
  tau: { min: 20e-9, max: 1e-6 },
  ronMos: { min: 1e-3, max: 2 },
}

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

export function resolveIgbt(input: Partial<IgbtParams>): { params: ResolvedIgbt; issues: string[] } {
  const p = { ...IGBT_DEFAULTS, ...input }
  const issues: string[] = []
  const L = IGBT_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, IGBT_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const q = {
    vdc: c('vdc'),
    i0: c('i0'),
    vdrv: c('vdrv'),
    voff: c('voff'),
    rg: c('rg'),
    cge: c('cge'),
    cgc: c('cgc'),
    cce: c('cce'),
    vth: c('vth'),
    gm: c('gm'),
    v0: c('v0'),
    rce: c('rce'),
    alpha: c('alpha'),
    tau: c('tau'),
    ronMos: c('ronMos'),
  }
  const ciss = q.cge + q.cgc
  const vplOn = q.vth + q.i0 / q.gm
  const vplOff = q.vth + ((1 - q.alpha) * q.i0) / q.gm
  if (vplOn >= q.vdrv) issues.push('the gate drive cannot reach the plateau: the IGBT never fully turns on')
  // Window: the edges scale with the gate time constant; the on-time lets the stored charge settle
  // (time constant τ·(1 − α)), the off-time lets the tail decay (τ).
  const tauG = q.rg * ciss
  const tvf = (q.rg * q.cgc * q.vdc) / Math.max(0.2, Math.min(q.vdrv - vplOn, vplOff - q.voff))
  const phase = Math.max(10 * tauG, 3 * tvf)
  const ton = phase * 0.25
  const toff = ton + Math.max(1.3 * phase, 0.3 * phase + 8 * q.tau * (1 - q.alpha))
  const tend = toff + Math.max(1.3 * phase, 0.3 * phase + 7 * q.tau)
  const steps = Math.min(40000, Math.max(8000, Math.ceil(tend / (phase / 400))))
  const params: ResolvedIgbt = {
    ...p,
    ...q,
    ciss,
    vplOn,
    vplOff,
    ton,
    toff,
    tend,
    steps,
    view: 'steady',
    periods: 1,
    stepsPerPeriod: steps,
    period: tend,
    dt: tend / steps,
    duration: tend,
  }
  return { params, issues }
}

export const igbtVg = (p: { ton: number; toff: number; vdrv: number; voff: number }, t: number) => (t >= p.ton && t < p.toff ? p.vdrv : p.voff)
const hk = (p: ResolvedIgbt) => p.alpha / (1 - p.alpha)

export type IgbtRegion = 'cut' | 'sat' | 'ohm'
/** Region and currents at a state: iC (collector, internal), i_ch (MOS channel), i_p (holes). */
export function igbtRegion(p: ResolvedIgbt, vge: number, vce: number, ip: number): { region: IgbtRegion; ic: number; ich: number } {
  if (vge <= p.vth) return { region: 'cut', ic: ip, ich: 0 }
  const sat = p.gm * (vge - p.vth) + ip
  const ohm = (vce - p.v0) / p.rce
  return sat <= ohm ? { region: 'sat', ic: sat, ich: sat - ip } : { region: 'ohm', ic: ohm, ich: ohm - ip }
}

/** The double-pulse test as a PWL hybrid system. Modes "<region>|<D or off>". */
export function igbtSystem(p: ResolvedIgbt): PwlSystem {
  const coss = p.cgc + p.cce
  const det = p.ciss * coss - p.cgc * p.cgc
  const K: Mat = [
    [coss / det, p.cgc / det],
    [p.cgc / det, p.ciss / det],
  ]
  const k = hk(p)
  const dvgeClamp = (vge: number, t: number) => (igbtVg(p, t) - vge) / (p.rg * p.ciss)
  return {
    n: 3,
    breakpoints: [p.ton, p.toff],
    mode(x, t, prev) {
      const [vge, vce, ip] = x
      const r = igbtRegion(p, vge, vce, ip)
      const prevDiode = prev.endsWith('|D')
      let diode: boolean
      if (prevDiode || prev === '') {
        const iD = p.i0 - r.ic + p.cgc * dvgeClamp(vge, t)
        diode = prev === '' ? vce >= p.vdc - 1e-9 && iD >= 0 : iD >= 0
      } else diode = vce > p.vdc * (1 + 1e-9)
      return `${r.region}|${diode ? 'D' : 'off'}`
    },
    sys(mode, t) {
      const [region, d] = mode.split('|')
      const vg = igbtVg(p, t)
      // stored charge: di_p/dt = (k·i_ch − i_p)/τ, i_ch linear in the state in every region
      let ipRow: number[]
      let ipB: number
      if (region === 'sat') {
        ipRow = [(k * p.gm) / p.tau, 0, -1 / p.tau]
        ipB = (-k * p.gm * p.vth) / p.tau
      } else if (region === 'ohm') {
        ipRow = [0, k / (p.rce * p.tau), -(1 + k) / p.tau]
        ipB = (-k * p.v0) / (p.rce * p.tau)
      } else {
        ipRow = [0, 0, -1 / p.tau]
        ipB = 0
      }
      if (d === 'D') {
        return {
          A: [[-1 / (p.rg * p.ciss), 0, 0], [0, 0, 0], ipRow],
          b: [vg / (p.rg * p.ciss), 0, ipB],
        }
      }
      // [vGE', vCE'] = K·(R·x + r0):  gate (Vg − vGE)/Rg,  collector I0 − iC(x)
      const R: number[][] = [[-1 / p.rg, 0, 0], region === 'sat' ? [-p.gm, 0, -1] : region === 'ohm' ? [0, -1 / p.rce, 0] : [0, 0, -1]]
      const r0 = [vg / p.rg, region === 'sat' ? p.i0 + p.gm * p.vth : region === 'ohm' ? p.i0 + p.v0 / p.rce : p.i0]
      const row = (i: number) => [0, 1, 2].map((j) => K[i][0] * R[0][j] + K[i][1] * R[1][j])
      return {
        A: [row(0), row(1), ipRow],
        b: [K[0][0] * r0[0] + K[0][1] * r0[1], K[1][0] * r0[0] + K[1][1] * r0[1], ipB],
      }
    },
  }
}

/** Derived quantities at a state: terminal currents, driver, power. */
export function igbtDerived(p: ResolvedIgbt, vge: number, vce: number, ip: number, t: number, mode: string) {
  const r = igbtRegion(p, vge, vce, ip)
  const vg = igbtVg(p, t)
  const ig = (vg - vge) / p.rg
  let idiode = 0
  if (mode.endsWith('|D')) idiode = Math.max(0, p.i0 - r.ic + p.cgc * ((vg - vge) / (p.rg * p.ciss)))
  const ic = p.i0 - idiode // collector terminal current (KCL at the collector)
  return { region: r.region, ich: r.ich, vg, ig, idiode, ic, p: vce * ic }
}

/** The MOSFET compared: the same gate, capacitances, threshold, gm and test, an ohmic channel ronMos, no tail. */
export function mosfetTwin(p: ResolvedIgbt): ResolvedMosfet {
  const { params } = resolveMosfet({ vdc: p.vdc, i0: p.i0, vdrv: p.vdrv, voff: p.voff, rg: p.rg, cgs: p.cge, cgd: p.cgc, cds: p.cce, vth: p.vth, gm: p.gm, ron: p.ronMos })
  return { ...params, ton: p.ton, toff: p.toff, tend: p.tend, steps: p.steps, period: p.tend, dt: p.dt, duration: p.tend, stepsPerPeriod: p.steps }
}

export type IgbtRun = Run<ResolvedIgbt> & {
  pwlEvents: PwlEvent[]
  modes: string[]
  knots: Array<{ t: number; x: number[]; mode: string }>
  twin: { params: ResolvedMosfet; events: PwlEvent[] }
  /** Running integrals over the simulated solution (event points included): device energy, the MOSFET's, collector charge. */
  E: Cumulative
  Emos: Cumulative
  Q: Cumulative
}

/** SIMULATION: the double-pulse test of the IGBT (and of the MOSFET compared) integrated by the PWL simulator. */
export function simulateIgbt(input: Partial<IgbtParams>): IgbtRun {
  const started = performance.now()
  const { params: p, issues } = resolveIgbt(input)
  const res = simulatePwl(igbtSystem(p), [p.voff, p.vdc, 0], 0, p.tend, p.steps, 'cut|D')
  const tw = mosfetTwin(p)
  const resM = simulatePwl(mosfetSystem(tw), [tw.voff, tw.vdc], 0, tw.tend, tw.steps, 'cut|D')
  const n = p.steps + 1
  const names = ['vge', 'vce', 'vg', 'ig', 'ich', 'ip', 'ic', 'idiode', 'pdev', 'energy', 'vdsMos', 'idMos', 'pMos', 'energyMos']
  const s: Record<string, Float64Array> = Object.fromEntries(names.map((k) => [k, new Float64Array(n)]))
  const [E, Q] = cumulatives(
    res,
    (x, t, mode) => {
      const ic = igbtDerived(p, x[0], x[1], x[2], t, mode).ic
      return [x[1] * ic, ic]
    },
    [p.ton, p.toff],
  )
  const Emos = cumulative(resM, (x, t, mode) => mosDerived(tw, x[0], x[1], t, mode).p, [p.ton, p.toff])
  for (let k = 0; k < n; k++) {
    const vge = res.x[0][k]
    const vce = res.x[1][k]
    const ip = res.x[2][k]
    const d = igbtDerived(p, vge, vce, ip, res.t[k], res.modes[k])
    s.vge[k] = vge
    s.vce[k] = vce
    s.vg[k] = d.vg
    s.ig[k] = d.ig
    s.ich[k] = d.ich
    s.ip[k] = ip
    s.ic[k] = d.ic
    s.idiode[k] = d.idiode
    s.pdev[k] = d.p
    const dm = mosDerived(tw, resM.x[0][k], resM.x[1][k], resM.t[k], resM.modes[k])
    s.vdsMos[k] = resM.x[1][k]
    s.idMos[k] = dm.id
    s.pMos[k] = dm.p
  }
  s.energy.set(E.cum)
  s.energyMos.set(Emos.cum)
  const events: RunEvent[] = []
  let seq = 0
  const ev = (kind: RunEvent['kind'], t: number, device: string) => {
    const k = Math.min(n - 1, Math.max(0, Math.round(t / p.dt)))
    events.push({ id: `i${seq++}`, kind, time: t, device, values: { vge: s.vge[k], vce: s.vce[k], ic: s.ic[k], ip: s.ip[k] } })
  }
  ev('gate-on', p.ton, 'driver')
  ev('gate-off', p.toff, 'driver')
  for (const x of res.events) ev('mode', x.t, `${x.from}→${x.to}`)
  events.sort((a, b) => a.time - b.time)
  return {
    kind: 'igbt',
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
    twin: { params: tw, events: resM.events },
    E,
    Emos,
    Q,
    diagnostics: { computeMs: performance.now() - started, fallbacks: 0, steady: { method: 'direct', iterations: 0, residual: 0, converged: true }, issues },
  }
}

export interface IgbtTimes {
  /** t1…t6: channel on, diode releases, on-state reached; on-state left, diode clamps, channel off. */
  t: Array<number | null>
  tdOn: number | null
  tri: number | null
  tfv: number | null
  tdOff: number | null
  trv: number | null
  tfi: number | null
}

const first = (evs: PwlEvent[], after: number, test: (e: PwlEvent) => boolean) => evs.find((e) => e.t > after && test(e))?.t ?? null

/** Phase times from the mode changes (the same definition for the simulation and the theory). */
export function igbtTimes(p: ResolvedIgbt, evs: PwlEvent[]): IgbtTimes {
  const t1 = first(evs, p.ton, (e) => e.from.startsWith('cut') && e.to.startsWith('sat'))
  const t2 = first(evs, p.ton, (e) => e.from.endsWith('|D') && e.to.endsWith('|off'))
  const t3 = first(evs, p.ton, (e) => e.from.startsWith('sat') && e.to.startsWith('ohm'))
  const t4 = first(evs, p.toff, (e) => e.from.startsWith('ohm') && e.to.startsWith('sat'))
  const t5 = first(evs, p.toff, (e) => e.from.endsWith('|off') && e.to.endsWith('|D'))
  const t6 = first(evs, p.toff, (e) => e.from.startsWith('sat') && e.to.startsWith('cut'))
  const on = t3 !== null && t3 < p.toff
  return {
    t: [t1, t2, t3, t4, t5, t6],
    tdOn: t1 !== null ? t1 - p.ton : null,
    tri: t1 !== null && t2 !== null ? t2 - t1 : null,
    tfv: t2 !== null && t3 !== null && on ? t3 - t2 : null,
    tdOff: t4 !== null ? t4 - p.toff : null,
    trv: t4 !== null && t5 !== null ? t5 - t4 : null,
    tfi: t5 !== null && t6 !== null ? t6 - t5 : null,
  }
}

export interface IgbtMeasurements extends Omit<IgbtTimes, 't'> {
  /** Turn-on energy, the turn-off energy of the channel part (gate off → channel off), of the tail, and their sum. */
  eon: number
  eoffMos: number
  etail: number
  eoff: number
  /** Share of Eoff lost in the tail. */
  tailShare: number
  /** Tail: initial hole current, collector charge after the channel is off, 1/e decay time. */
  itail0: number | null
  qtail: number
  tauTail: number | null
  /** On-state voltage at I0 and the conduction loss V·I0. */
  vceSat: number
  pcond: number
  /** Gate voltage on the turn-on and turn-off plateaus. */
  plateauOn: number | null
  plateauOff: number | null
  dvdtOff: number | null
  /** The MOSFET compared, from its own simulation at the same conditions. */
  mos: { eon: number; eoff: number; vdsOn: number; pcond: number; tfi: number | null; trv: number | null }
  /** The same, as flat values (experiment tables). */
  mosEon: number
  mosEoff: number
  mosVon: number
  mosPcond: number
  /** Eoff(IGBT)/Eoff(MOSFET), Pcond(IGBT)/Pcond(MOSFET). */
  eoffRatio: number
  pcondRatio: number
}

/** Cumulative signal at time t (linear between samples). */
export function atTime(r: { params: { dt: number }; length: number }, sig: Float64Array, t: number): number {
  const u = Math.min(r.length - 1, Math.max(0, t / r.params.dt))
  const k = Math.min(r.length - 2, Math.floor(u))
  const f = u - k
  return sig[k] * (1 - f) + sig[k + 1] * f
}

export function measureIgbt(r: IgbtRun): IgbtMeasurements {
  const p = r.params
  const s = r.signals
  const tm = igbtTimes(p, r.pwlEvents)
  const [, t2, t3, t4, t5, t6] = tm.t
  const E = (a: number, b: number) => r.E.at(b) - r.E.at(a)
  const eon = t3 !== null ? E(p.ton, t3) : E(p.ton, p.toff)
  const eoffMos = t6 !== null ? E(p.toff, t6) : E(p.toff, p.tend)
  const etail = t6 !== null ? E(t6, p.tend) : 0
  // the tail: the state at the instant the channel turns off (the event's own knot), its charge and 1/e time
  const knot = t6 !== null ? r.knots.find((k) => k.t === t6 && k.mode.startsWith('cut')) : undefined
  const itail0 = knot ? knot.x[2] : null
  const qtail = t6 !== null ? r.Q.at(p.tend) - r.Q.at(t6) : 0
  let tauTail: number | null = null
  if (t6 !== null && itail0 !== null && itail0 > 1e-9) {
    const k0 = Math.ceil(t6 / p.dt)
    const target = itail0 / Math.E
    for (let k = k0; k < r.length; k++)
      if (s.ip[k] <= target) {
        const a = k === k0 ? itail0 : s.ip[k - 1]
        const ta = k === k0 ? t6 : r.time[k - 1]
        tauTail = ta + ((a - target) / (a - s.ip[k])) * (r.time[k] - ta) - t6
        break
      }
  }
  const kon = Math.max(0, Math.floor(p.toff / p.dt) - 1)
  const vceSat = s.vce[kon]
  const at = (sig: Float64Array, t: number) => atTime(r, sig, t)
  // the MOSFET compared, from its own simulation (same samples)
  const tw = r.twin.params
  const mt: SwitchingTimes = mosSwitchingTimes(tw, r.twin.events, (a, b) => r.Emos.at(b) - r.Emos.at(a), () => NaN)
  const mosVon = s.vdsMos[kon]
  const mos = { eon: mt.eon, eoff: mt.eoff, vdsOn: mosVon, pcond: mosVon * p.i0, tfi: mt.tfi, trv: mt.trv }
  const eoff = eoffMos + etail
  return {
    ...tm,
    eon,
    eoffMos,
    etail,
    eoff,
    tailShare: eoff > 0 ? etail / eoff : 0,
    itail0,
    qtail,
    tauTail,
    vceSat,
    pcond: vceSat * p.i0,
    plateauOn: t2 !== null && t3 !== null ? at(s.vge, (t2 + t3) / 2) : null,
    plateauOff: t4 !== null && t5 !== null ? at(s.vge, (t4 + t5) / 2) : null,
    dvdtOff: t4 !== null && t5 !== null ? (p.vdc - vceSat) / (t5 - t4) : null,
    mos,
    mosEon: mos.eon,
    mosEoff: mos.eoff,
    mosVon: mos.vdsOn,
    mosPcond: mos.pcond,
    eoffRatio: mos.eoff > 0 ? eoff / mos.eoff : NaN,
    pcondRatio: mos.pcond > 0 ? (vceSat * p.i0) / mos.pcond : NaN,
  }
}

export interface IgbtExact extends IgbtTimes {
  eon: number
  eoffMos: number
  etail: number
  eoff: number
  itail0: number | null
  qtail: number
  tauTail: number
  vceSat: number
  plateauOn: number | null
  plateauOff: number | null
}

/**
 * THEORY: the exact PWL solution (matrix exponential) of the same circuit. Phase boundaries are found on the
 * exact flow; Eon and the channel part of Eoff come from a dense exact sampling of each transition; the tail
 * is closed form, because after the channel is off the hole current obeys di_p/dt = −i_p/τ exactly:
 *   i_p(t) = I_tail0·e^(−(t − t6)/τ),  Q_tail = I_tail0·τ·(1 − e^(−T/τ)) + Cgc·(Vth − vGE(tend)),
 *   E_tail = Vdc·Q_tail  (vCE is clamped at Vdc by the diode throughout the tail).
 * (The Cgc term is the gate–collector displacement current while vGE keeps falling below Vth.)
 */
export function exactIgbt(p: ResolvedIgbt): IgbtExact {
  const sys = igbtSystem(p)
  const x0 = [p.voff, p.vdc, 0]
  const all = exactPwl(sys, x0, 0, [p.tend], 'cut|D')
  const tm = igbtTimes(p, all.events)
  const [, t2, t3, t4, t5, t6] = tm.t
  const stateAt = (t: number) => exactPwl(sys, x0, 0, [t], 'cut|D')
  const energyExact = (a: number, b: number) => {
    const M = 800
    const ts = Array.from({ length: M + 1 }, (_, i) => a + ((b - a) * i) / M)
    const e2 = exactPwl(sys, x0, 0, ts, 'cut|D')
    let e = 0
    const pw = (i: number) => igbtDerived(p, e2.x[i][0], e2.x[i][1], e2.x[i][2], ts[i], e2.modes[i]).p
    for (let i = 1; i <= M; i++) e += 0.5 * (pw(i - 1) + pw(i)) * (ts[i] - ts[i - 1])
    return e
  }
  const eon = t3 !== null ? energyExact(p.ton, t3) : energyExact(p.ton, p.toff)
  const eoffMos = t6 !== null ? energyExact(p.toff, t6) : energyExact(p.toff, p.tend)
  let itail0: number | null = null
  let qtail = 0
  if (t6 !== null) {
    // the state at t6 is reached by the exact flow; just after it the channel is cut
    itail0 = stateAt(t6).x[0][2]
    const T = p.tend - t6
    const vgeEnd = all.x[0][0]
    qtail = itail0 * p.tau * (1 - Math.exp(-T / p.tau)) + p.cgc * (p.vth - vgeEnd)
  }
  const etail = p.vdc * qtail
  const vAt = (t: number) => stateAt(t).x[0][0]
  return {
    ...tm,
    eon,
    eoffMos,
    etail,
    eoff: eoffMos + etail,
    itail0,
    qtail,
    tauTail: p.tau,
    vceSat: p.v0 + p.rce * p.i0,
    plateauOn: t2 !== null && t3 !== null ? vAt((t2 + t3) / 2) : null,
    plateauOff: t4 !== null && t5 !== null ? vAt((t4 + t5) / 2) : null,
  }
}

/** THEORY 2: the textbook formulas (with their simplifications). */
export function textbookIgbt(p: ResolvedIgbt) {
  const tau = p.rg * p.ciss
  const dv = p.vdc - (p.v0 + p.rce * p.i0)
  const itail0 = p.alpha * p.i0
  return {
    tdOn: tau * Math.log((p.vdrv - p.voff) / (p.vdrv - p.vth)),
    tri: tau * Math.log((p.vdrv - p.vth) / (p.vdrv - p.vplOn)),
    tfv: (p.rg * p.cgc * dv) / (p.vdrv - p.vplOn),
    tdOff: tau * Math.log((p.vdrv - p.voff) / (p.vplOff - p.voff)),
    trv: (p.rg * p.cgc * dv) / (p.vplOff - p.voff),
    tfi: tau * Math.log((p.vplOff - p.voff) / (p.vth - p.voff)),
    vceSat: p.v0 + p.rce * p.i0,
    itail0,
    qtail: itail0 * p.tau,
    etail: p.vdc * itail0 * p.tau,
    /** Load current above which the IGBT conducts with less loss than the MOSFET: V0 + r·I = Ron·I. */
    iCross: p.ronMos > p.rce ? p.v0 / (p.ronMos - p.rce) : Infinity,
  }
}
