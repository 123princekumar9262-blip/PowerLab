import type { Mat } from '../expm.ts'
import { exactPwl, simulatePwl, type PwlEvent, type PwlSystem } from '../pwl.ts'
import type { Run, RunEvent, RunParams } from '../types.ts'

/**
 * DEVICES — MOSFET switching in a DOUBLE-PULSE TEST (clamped inductive load).
 *
 *   Vdc ─┬─ L (current I0, constant over the ns-scale transient) ─┬─ drain
 *        └──────────────── freewheeling diode (anode at drain) ───┘
 *   gate driver Vg(t) ── Rg ── gate;   Cgs gate–source, Cgd gate–drain (Miller), Cds drain–source
 *   channel: i_ch = 0 (vgs ≤ Vth),  gm·(vgs − Vth) (saturation),  vds/Ron (ohmic)  — the smaller of the two
 *
 * State x = [vgs, vds]. Gate KCL: (Vg − vgs)/Rg = Cgs·dvgs/dt + Cgd·d(vgs − vds)/dt.
 * Drain KCL: I0 = i_ch + Cgd·d(vds − vgs)/dt + Cds·dvds/dt + i_diode; the diode clamps vds = Vdc while it
 * conducts (i_diode ≥ 0) and is open below Vdc. Each (channel region, diode) combination is a linear
 * system — a PWL hybrid system, simulated and solved exactly (converters/pwl.ts).
 */
export interface MosfetParams {
  vdc: number
  i0: number
  /** Gate driver high and low levels [V] and gate resistance [Ω]. */
  vdrv: number
  voff: number
  rg: number
  cgs: number
  cgd: number
  cds: number
  vth: number
  gm: number
  ron: number
  /** Turn-on and turn-off instants of the gate pulse, end of the window [s]. */
  ton: number
  toff: number
  tend: number
  steps: number
  view: 'steady' | 'startup'
  periods: number
  stepsPerPeriod: number
}

export interface ResolvedMosfet extends MosfetParams, RunParams {
  ciss: number
  vpl: number
}

export const MOSFET_DEFAULTS: MosfetParams = {
  vdc: 100,
  i0: 10,
  vdrv: 12,
  voff: 0,
  rg: 5,
  cgs: 1.5e-9,
  cgd: 0.1e-9,
  cds: 0,
  vth: 3,
  gm: 10,
  ron: 0.02,
  ton: 20e-9,
  toff: 120e-9,
  tend: 200e-9,
  steps: 8000,
  view: 'steady',
  periods: 1,
  stepsPerPeriod: 8000,
}

export const MOSFET_LIMITS = {
  vdc: { min: 5, max: 1000 },
  i0: { min: 0.1, max: 200 },
  vdrv: { min: 5, max: 20 },
  voff: { min: -10, max: 0 },
  rg: { min: 0.5, max: 100 },
  cgs: { min: 50e-12, max: 20e-9 },
  cgd: { min: 5e-12, max: 2e-9 },
  cds: { min: 0, max: 5e-9 },
  vth: { min: 1, max: 6 },
  gm: { min: 0.5, max: 200 },
  ron: { min: 1e-3, max: 2 },
}

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

export function resolveMosfet(input: Partial<MosfetParams>): { params: ResolvedMosfet; issues: string[] } {
  const p = { ...MOSFET_DEFAULTS, ...input }
  const issues: string[] = []
  const L = MOSFET_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, MOSFET_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const q = {
    vdc: c('vdc'),
    i0: c('i0'),
    vdrv: c('vdrv'),
    voff: c('voff'),
    rg: c('rg'),
    cgs: c('cgs'),
    cgd: c('cgd'),
    cds: c('cds'),
    vth: c('vth'),
    gm: c('gm'),
    ron: c('ron'),
  }
  const vpl = q.vth + q.i0 / q.gm
  if (vpl >= q.vdrv) issues.push('the gate drive cannot reach the plateau: the MOSFET never fully turns on')
  // The window scales with the gate time constant so every phase fits.
  const tau = q.rg * (q.cgs + q.cgd)
  const tvf = (q.rg * q.cgd * q.vdc) / Math.max(0.2, Math.min(q.vdrv - vpl, vpl - q.voff))
  const phase = Math.max(10 * tau, 3 * tvf)
  const ton = phase * 0.25
  const toff = ton + phase * 1.3
  const tend = toff + phase * 1.3
  const steps = 8000
  const params: ResolvedMosfet = {
    ...p,
    ...q,
    ton,
    toff,
    tend,
    steps,
    ciss: q.cgs + q.cgd,
    vpl,
    view: 'steady',
    periods: 1,
    stepsPerPeriod: steps,
    period: tend,
    dt: tend / steps,
    duration: tend,
  }
  return { params, issues }
}

export const vgAt = (p: ResolvedMosfet, t: number) => (t >= p.ton && t < p.toff ? p.vdrv : p.voff)

/** Channel current and its region. */
export function channel(p: ResolvedMosfet, vgs: number, vds: number): { region: 'cut' | 'sat' | 'ohm'; i: number } {
  if (vgs <= p.vth) return { region: 'cut', i: 0 }
  const sat = p.gm * (vgs - p.vth)
  const ohm = vds / p.ron
  return sat <= ohm ? { region: 'sat', i: sat } : { region: 'ohm', i: ohm }
}

/** The double-pulse test as a PWL hybrid system. Modes "<region>|<D or off>". */
export function mosfetSystem(p: ResolvedMosfet): PwlSystem {
  const coss = p.cgd + p.cds
  const det = p.ciss * coss - p.cgd * p.cgd
  // K = inverse of [[Ciss, −Cgd], [−Cgd, Coss]]
  const K: Mat = [
    [coss / det, p.cgd / det],
    [p.cgd / det, p.ciss / det],
  ]
  const dvgsDiode = (vgs: number, t: number) => (vgAt(p, t) - vgs) / (p.rg * p.ciss)
  return {
    n: 2,
    breakpoints: [p.ton, p.toff],
    mode(x, t, prev) {
      const [vgs, vds] = x
      const ch = channel(p, vgs, Math.max(vds, 0))
      const prevDiode = prev.endsWith('|D')
      let diode: boolean
      if (prevDiode || prev === '') {
        // conducting while its current is ≥ 0:  i_D = I0 − i_ch + Cgd·dvgs/dt  (vds clamped)
        const iD = p.i0 - ch.i + p.cgd * dvgsDiode(vgs, t)
        diode = prev === '' ? vds >= p.vdc - 1e-9 && iD >= 0 : iD >= 0
      } else diode = vds > p.vdc * (1 + 1e-9) // hysteresis: leaving the clamp at vds = Vdc must not re-enter it at once
      return `${ch.region}|${diode ? 'D' : 'off'}`
    },
    sys(mode, t) {
      const [region, d] = mode.split('|')
      const vg = vgAt(p, t)
      if (d === 'D') {
        return {
          A: [
            [-1 / (p.rg * p.ciss), 0],
            [0, 0],
          ],
          b: [vg / (p.rg * p.ciss), 0],
        }
      }
      // [a, b] = K·(R·x + r0)
      const di_dvgs = region === 'sat' ? p.gm : 0
      const di_dvds = region === 'ohm' ? 1 / p.ron : 0
      const R: Mat = [
        [-1 / p.rg, 0],
        [-di_dvgs, -di_dvds],
      ]
      const r0 = [vg / p.rg, p.i0 + (region === 'sat' ? p.gm * p.vth : 0)]
      const A: Mat = [
        [K[0][0] * R[0][0] + K[0][1] * R[1][0], K[0][0] * R[0][1] + K[0][1] * R[1][1]],
        [K[1][0] * R[0][0] + K[1][1] * R[1][0], K[1][0] * R[0][1] + K[1][1] * R[1][1]],
      ]
      return { A, b: [K[0][0] * r0[0] + K[0][1] * r0[1], K[1][0] * r0[0] + K[1][1] * r0[1]] }
    },
  }
}

export type MosfetRun = Run<ResolvedMosfet> & { pwlEvents: PwlEvent[]; modes: string[] }

/** Derived quantities at a state (terminal currents, driver). */
export function derived(p: ResolvedMosfet, vgs: number, vds: number, t: number, mode: string) {
  const ch = channel(p, vgs, Math.max(vds, 0))
  const vg = vgAt(p, t)
  const ig = (vg - vgs) / p.rg
  let idiode = 0
  if (mode.endsWith('|D')) idiode = Math.max(0, p.i0 - ch.i + p.cgd * ((vg - vgs) / (p.rg * p.ciss)))
  const id = p.i0 - idiode // drain terminal current (KCL at the drain)
  return { ich: ch.i, region: ch.region, vg, ig, idiode, id, p: vds * id }
}

/** SIMULATION: the double-pulse test integrated by the PWL simulator. */
export function simulateMosfet(input: Partial<MosfetParams>): MosfetRun {
  const started = performance.now()
  const { params: p, issues } = resolveMosfet(input)
  const sys = mosfetSystem(p)
  const res = simulatePwl(sys, [p.voff, p.vdc], 0, p.tend, p.steps, `cut|D`)
  const n = p.steps + 1
  const names = ['vgs', 'vds', 'vg', 'ig', 'ich', 'id', 'idiode', 'pdev', 'energy']
  const signals: Record<string, Float64Array> = Object.fromEntries(names.map((k) => [k, new Float64Array(n)]))
  let e = 0
  for (let k = 0; k < n; k++) {
    const vgs = res.x[0][k]
    const vds = res.x[1][k]
    const d = derived(p, vgs, vds, res.t[k], res.modes[k])
    signals.vgs[k] = vgs
    signals.vds[k] = vds
    signals.vg[k] = d.vg
    signals.ig[k] = d.ig
    signals.ich[k] = d.ich
    signals.id[k] = d.id
    signals.idiode[k] = d.idiode
    signals.pdev[k] = d.p
    if (k > 0) e += 0.5 * (signals.pdev[k - 1] + d.p) * p.dt
    signals.energy[k] = e
  }
  const events: RunEvent[] = []
  let seq = 0
  const ev = (kind: RunEvent['kind'], t: number, device: string) => {
    const k = Math.min(n - 1, Math.max(0, Math.round(t / p.dt)))
    events.push({ id: `m${seq++}`, kind, time: t, device, values: { vgs: signals.vgs[k], vds: signals.vds[k], id: signals.id[k] } })
  }
  ev('gate-on', p.ton, 'driver')
  ev('gate-off', p.toff, 'driver')
  for (const x of res.events) ev('mode', x.t, `${x.from}→${x.to}`)
  events.sort((a, b) => a.time - b.time)
  return {
    kind: 'mosfet',
    params: p,
    length: n,
    time: res.t,
    signals,
    devices: [],
    events,
    steadyFrom: 0,
    pwlEvents: res.events,
    modes: res.modes,
    diagnostics: { computeMs: performance.now() - started, fallbacks: 0, steady: { method: 'direct', iterations: 0, residual: 0, converged: true }, issues },
  }
}

export interface SwitchingTimes {
  tdOn: number | null
  tri: number | null
  tfv: number | null
  tdOff: number | null
  trv: number | null
  tfi: number | null
  eon: number
  eoff: number
  /** Gate voltage during the turn-on voltage fall (the Miller plateau). */
  plateau: number | null
  dvdtOn: number | null
  didtOn: number | null
}

const first = (evs: PwlEvent[], after: number, test: (e: PwlEvent) => boolean) => evs.find((e) => e.t > after && test(e))?.t ?? null

/** Phase times from mode changes (the same definition for the simulation and the theory). */
export function switchingTimes(p: ResolvedMosfet, evs: PwlEvent[], energy: (a: number, b: number) => number, vgsAt: (t: number) => number): SwitchingTimes {
  const t1 = first(evs, p.ton, (e) => e.from.startsWith('cut') && e.to.startsWith('sat'))
  const t2 = first(evs, p.ton, (e) => e.from.endsWith('|D') && e.to.endsWith('|off'))
  const t3 = first(evs, p.ton, (e) => e.from.startsWith('sat') && e.to.startsWith('ohm'))
  const t4 = first(evs, p.toff, (e) => e.from.startsWith('ohm') && e.to.startsWith('sat'))
  const t5 = first(evs, p.toff, (e) => e.from.endsWith('|off') && e.to.endsWith('|D'))
  const t6 = first(evs, p.toff, (e) => e.from.startsWith('sat') && e.to.startsWith('cut'))
  const on = t3 !== null && t3 < p.toff
  return {
    tdOn: t1 !== null ? t1 - p.ton : null,
    tri: t1 !== null && t2 !== null ? t2 - t1 : null,
    tfv: t2 !== null && t3 !== null && on ? t3 - t2 : null,
    tdOff: t4 !== null ? t4 - p.toff : null,
    trv: t4 !== null && t5 !== null ? t5 - t4 : null,
    tfi: t5 !== null && t6 !== null ? t6 - t5 : null,
    eon: t3 !== null ? energy(p.ton, t3) : energy(p.ton, p.toff),
    eoff: t6 !== null ? energy(p.toff, t6) : energy(p.toff, p.tend),
    plateau: t2 !== null && t3 !== null ? vgsAt((t2 + t3) / 2) : null,
    dvdtOn: t2 !== null && t3 !== null ? -(p.vdc - p.i0 * p.ron) / (t3 - t2) : null,
    didtOn: t1 !== null && t2 !== null ? p.i0 / (t2 - t1) : null,
  }
}

export interface MosfetMeasurements extends SwitchingTimes {
  /** Conduction loss at I0 (on-state). */
  pcond: number
  vdsOn: number
}

export function measureMosfet(r: MosfetRun): MosfetMeasurements {
  const p = r.params
  const k = (t: number) => Math.min(r.length - 1, Math.max(0, Math.round(t / p.dt)))
  const energy = (a: number, b: number) => r.signals.energy[k(b)] - r.signals.energy[k(a)]
  const st = switchingTimes(p, r.pwlEvents, energy, (t) => r.signals.vgs[k(t)])
  const kon = k(p.toff - 1e-12) - 1
  return { ...st, vdsOn: r.signals.vds[kon], pcond: p.i0 * p.i0 * p.ron }
}

/** THEORY 1: the exact PWL solution (matrix exponential); energies from a dense exact sampling of each transition. */
export function exactMosfet(p: ResolvedMosfet): SwitchingTimes {
  const sys = mosfetSystem(p)
  // Energies need the fine resolution at the edges: refine with a dense exact run inside each window.
  const energyExact = (a: number, b: number) => {
    const M = 800
    const ts = Array.from({ length: M + 1 }, (_, i) => a + ((b - a) * i) / M)
    const e2 = exactPwl(sys, [p.voff, p.vdc], 0, ts, 'cut|D')
    let e = 0
    for (let i = 1; i <= M; i++) {
      const p0 = derived(p, e2.x[i - 1][0], e2.x[i - 1][1], ts[i - 1], e2.modes[i - 1]).p
      const p1 = derived(p, e2.x[i][0], e2.x[i][1], ts[i], e2.modes[i]).p
      e += 0.5 * (p0 + p1) * (ts[i] - ts[i - 1])
    }
    return e
  }
  const vg = exactPwl(sys, [p.voff, p.vdc], 0, [p.tend], 'cut|D')
  return switchingTimes(p, vg.events, energyExact, (t) => exactPwl(sys, [p.voff, p.vdc], 0, [t], 'cut|D').x[0][0])
}

/** THEORY 2: the textbook piecewise formulas (Mohan; Baliga) — with their simplifications. */
export function textbookMosfet(p: ResolvedMosfet) {
  const tau = p.rg * p.ciss
  const vpl = p.vpl
  const dv = p.vdc - p.i0 * p.ron
  const tdOn = tau * Math.log((p.vdrv - p.voff) / (p.vdrv - p.vth))
  const tri = tau * Math.log((p.vdrv - p.vth) / (p.vdrv - vpl))
  const tfv = (p.rg * p.cgd * dv) / (p.vdrv - vpl)
  const tdOff = tau * Math.log((p.vdrv - p.voff) / (vpl - p.voff))
  const trv = (p.rg * p.cgd * dv) / (vpl - p.voff)
  const tfi = tau * Math.log((vpl - p.voff) / (p.vth - p.voff))
  return {
    tdOn,
    tri,
    tfv,
    tdOff,
    trv,
    tfi,
    vpl,
    eon: 0.5 * p.vdc * p.i0 * (tri + tfv),
    eoff: 0.5 * p.vdc * p.i0 * (trv + tfi),
  }
}
