import type { Run, RunEvent, RunParams } from '../types.ts'

/**
 * EV — the electric drivetrain of a car on a drive cycle.
 *
 *   battery (Voc, Rb) ── inverter + motor (η, torque Tmax, power Pmax, regen limit) ── gear G ── wheel r
 *   vehicle: m·dv/dt = F − ½·ρ·Cd·A·v² − Crr·m·g·cos θ − m·g·sin θ
 *
 * The DRIVER follows the cycle's speed: F = m·a_ref + road load(v_ref) + m·Kp·(v_ref − v), clipped to the
 * motor's envelope F ≤ min(Tmax·G/r, Pmax/v) and, when braking, to the regenerative limit
 * F ≥ −min(Tmax·G/r, Pregen/v); friction brakes take the rest. Battery power Pb = P/η (motoring) or P·η
 * (regenerating) plus the auxiliary load; the current solves Pb = (Voc − Rb·I)·I.
 *
 * Constant efficiency and a constant open-circuit voltage are deliberate simplifications (labelled).
 * The drive cycles are SYNTHETIC piecewise-linear speed profiles shaped like common test cycles — not the
 * official ECE / WLTP data.
 */
export type CycleId = 'urban' | 'highway' | 'accel'

export interface EvParams {
  cycle: CycleId
  mass: number
  cd: number
  area: number
  crr: number
  /** Road gradient [%] (rise per 100 m). */
  grade: number
  wheel: number
  gear: number
  tmax: number
  pmax: number
  /** Most power the motor may recover while braking [W]. */
  pregen: number
  eta: number
  aux: number
  voc: number
  rb: number
  /** Battery capacity [Wh]. */
  capacity: number
  soc0: number
  view: 'steady' | 'startup'
  periods: number
  stepsPerPeriod: number
}

export interface ResolvedEv extends EvParams, RunParams {
  /** Speed profile vertices [s, m/s]. */
  profile: Array<[number, number]>
  /** Base speed where the torque limit meets the power limit [m/s]. */
  vBase: number
  /** Aerodynamic coefficient ½·ρ·Cd·A and the constant road forces (rolling + grade) [N]. */
  kAero: number
  fConst: number
  fTmax: number
  /**
   * The traction power limit at the wheels [W]: the motor's Pmax, or less when the battery cannot supply it —
   * its terminals deliver at most Voc²/(4·Rb) (at I = Voc/(2·Rb)); minus the auxiliaries, times η.
   */
  pDrive: number
}

export const RHO = 1.2
export const G = 9.81

export const EV_DEFAULTS: EvParams = {
  cycle: 'urban',
  mass: 1700,
  cd: 0.28,
  area: 2.3,
  crr: 0.01,
  grade: 0,
  wheel: 0.32,
  gear: 9,
  tmax: 300,
  pmax: 150e3,
  pregen: 60e3,
  eta: 0.9,
  aux: 500,
  voc: 400,
  rb: 0.08,
  capacity: 60e3,
  soc0: 0.9,
  view: 'startup',
  periods: 1,
  stepsPerPeriod: 0,
}

export const EV_LIMITS = {
  mass: { min: 600, max: 4000 },
  cd: { min: 0.15, max: 0.6 },
  area: { min: 1.2, max: 4 },
  crr: { min: 0.005, max: 0.03 },
  grade: { min: -8, max: 8 },
  wheel: { min: 0.2, max: 0.45 },
  gear: { min: 3, max: 15 },
  tmax: { min: 50, max: 1000 },
  pmax: { min: 20e3, max: 500e3 },
  pregen: { min: 0, max: 300e3 },
  eta: { min: 0.6, max: 0.98 },
  aux: { min: 0, max: 5000 },
  voc: { min: 100, max: 900 },
  rb: { min: 0.005, max: 0.5 },
  capacity: { min: 10e3, max: 150e3 },
  soc0: { min: 0.2, max: 1 },
}

const KMH = 1 / 3.6
/** Synthetic cycles [s, km/h]. */
export const CYCLES: Record<Exclude<CycleId, 'accel'>, { name: string; points: Array<[number, number]> }> = {
  urban: {
    name: 'Urban (ECE-15-style, simplified)',
    points: [
      [0, 0],
      [11, 0],
      [15, 15],
      [23, 15],
      [28, 0],
      [49, 0],
      [61, 32],
      [85, 32],
      [96, 0],
      [117, 0],
      [143, 50],
      [155, 50],
      [163, 35],
      [176, 35],
      [188, 0],
      [195, 0],
    ],
  },
  highway: {
    name: 'Highway (synthetic)',
    points: [
      [0, 0],
      [30, 90],
      [150, 90],
      [170, 120],
      [300, 120],
      [330, 80],
      [400, 80],
      [440, 0],
      [450, 0],
    ],
  },
}
export const ACCEL_TIME = 25
export const CYCLE_NAME: Record<CycleId, string> = { urban: CYCLES.urban.name, highway: CYCLES.highway.name, accel: 'Full-throttle acceleration from rest' }

const DT = 0.02
/** Driver's speed-error gain [1/s]. */
export const KP = 5

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

export function resolveEv(input: Partial<EvParams>): { params: ResolvedEv; issues: string[] } {
  const p = { ...EV_DEFAULTS, ...input }
  const issues: string[] = []
  const L = EV_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, EV_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const q = {
    mass: c('mass'),
    cd: c('cd'),
    area: c('area'),
    crr: c('crr'),
    grade: c('grade'),
    wheel: c('wheel'),
    gear: c('gear'),
    tmax: c('tmax'),
    pmax: c('pmax'),
    pregen: c('pregen'),
    eta: c('eta'),
    aux: c('aux'),
    voc: c('voc'),
    rb: c('rb'),
    capacity: c('capacity'),
    soc0: c('soc0'),
  }
  const cycle: CycleId = p.cycle === 'highway' || p.cycle === 'accel' ? p.cycle : 'urban'
  const profile: Array<[number, number]> = cycle === 'accel' ? [[0, 0], [ACCEL_TIME, 0]] : CYCLES[cycle].points.map(([t, v]) => [t, v * KMH])
  const duration = profile[profile.length - 1][0]
  const steps = Math.round(duration / DT)
  const th = Math.atan(q.grade / 100)
  const fTmax = (q.tmax * q.gear) / q.wheel
  // the battery's maximum terminal power, less the auxiliaries, through the drivetrain efficiency
  const pBattMax = (q.voc * q.voc) / (4 * q.rb)
  const pDrive = Math.min(q.pmax, Math.max(0, (pBattMax - q.aux) * q.eta))
  if (pDrive < q.pmax)
    issues.push(`the battery limits the drive: at most ${(pBattMax / 1000).toFixed(1)} kW at its terminals (Voc²/4·Rb), so ${(pDrive / 1000).toFixed(1)} kW reach the wheels instead of the motor's ${(q.pmax / 1000).toFixed(0)} kW`)
  const params: ResolvedEv = {
    ...p,
    ...q,
    cycle,
    view: 'startup',
    periods: 1,
    stepsPerPeriod: steps,
    period: duration,
    dt: duration / steps,
    duration,
    profile,
    vBase: pDrive / fTmax,
    kAero: 0.5 * RHO * q.cd * q.area,
    fConst: q.mass * G * (q.crr * Math.cos(th) + Math.sin(th)),
    fTmax,
    pDrive,
  }
  return { params, issues }
}

/** Reference speed and acceleration at t (piecewise linear; at a vertex the next segment). */
export function refAt(p: ResolvedEv, t: number): { v: number; a: number } {
  const pr = p.profile
  for (let i = 0; i + 1 < pr.length; i++) {
    const [t0, v0] = pr[i]
    const [t1, v1] = pr[i + 1]
    if (t < t1 || i + 2 === pr.length) {
      const a = (v1 - v0) / (t1 - t0)
      return { v: v0 + a * (Math.min(Math.max(t, t0), t1) - t0), a }
    }
  }
  return { v: 0, a: 0 }
}

/** Road load at speed v [N]: aerodynamic drag plus rolling resistance (only while moving) and grade. */
export function roadLoad(p: ResolvedEv, v: number): number {
  const moving = v > 1e-6
  const th = Math.atan(p.grade / 100)
  const roll = moving ? p.mass * G * p.crr * Math.cos(th) : 0
  return p.kAero * v * Math.abs(v) + roll + p.mass * G * Math.sin(th)
}

/** Motor envelope at the wheel [N]: traction (torque, then the motor's or the battery's power) and regenerative limits. */
export const tractionMax = (p: ResolvedEv, v: number) => Math.min(p.fTmax, p.pDrive / Math.max(v, 1e-9))
export const regenMax = (p: ResolvedEv, v: number) => Math.min(p.fTmax, p.pregen / Math.max(v, 1e-9))

/** Battery power for a wheel power and the current that delivers it. */
export function batteryPower(p: ResolvedEv, pWheel: number): number {
  return (pWheel >= 0 ? pWheel / p.eta : pWheel * p.eta) + p.aux
}
export function batteryCurrent(p: ResolvedEv, pb: number): number {
  const disc = p.voc * p.voc - 4 * p.rb * pb
  // beyond the maximum power transfer the battery cannot deliver: clip at Voc/(2·Rb)
  return disc <= 0 ? p.voc / (2 * p.rb) : (p.voc - Math.sqrt(disc)) / (2 * p.rb)
}

/** The driver and the drivetrain at (t, v): wheel force split into motor and friction brake. */
export function forces(p: ResolvedEv, t: number, v: number): { fMotor: number; fBrake: number; fReq: number; limited: boolean } {
  if (p.cycle === 'accel') {
    const f = tractionMax(p, v)
    return { fMotor: f, fBrake: 0, fReq: f, limited: true }
  }
  const ref = refAt(p, t)
  const fReq = p.mass * ref.a + roadLoad(p, ref.v) + p.mass * KP * (ref.v - v)
  if (fReq >= 0) {
    const lim = tractionMax(p, v)
    return { fMotor: Math.min(fReq, lim), fBrake: 0, fReq, limited: fReq > lim * (1 + 1e-9) }
  }
  // at standstill hold the car with the brakes (no creeping backwards)
  if (v <= 1e-6 && ref.v <= 1e-9) return { fMotor: 0, fBrake: Math.max(0, -fReq), fReq, limited: false }
  const lim = regenMax(p, v)
  const fMotor = Math.max(fReq, -lim)
  return { fMotor, fBrake: fMotor - fReq, fReq, limited: false }
}

export type EvRun = Run<ResolvedEv> & { limitedSteps: number }

/**
 * SIMULATION: classical fourth-order Runge–Kutta on the state [v, x, E_batt(terminal), E_chem, E_regen,
 * E_brake, E_loss_drive, Q(Ah·3600)], fixed step 20 ms (every cycle vertex is a step boundary).
 */
export function simulateEv(input: Partial<EvParams>): EvRun {
  const started = performance.now()
  const { params: p, issues } = resolveEv(input)
  const n = p.stepsPerPeriod + 1
  const names = ['vkmh', 'vref', 'f', 'fbrake', 'pwheel', 'pbatt', 'ibatt', 'soc', 'ebatt', 'pbrake', 'dist']
  const s: Record<string, Float64Array> = Object.fromEntries(names.map((k) => [k, new Float64Array(n)]))
  // derivative of the state
  const der = (t: number, y: number[]) => {
    const v = Math.max(0, y[0])
    const f = forces(p, t, v)
    const a = (f.fMotor - f.fBrake - roadLoad(p, v)) / p.mass
    const pw = f.fMotor * v
    const pb = batteryPower(p, pw)
    const i = batteryCurrent(p, pb)
    const dv = v <= 0 && a < 0 ? 0 : a
    return [dv, v, (p.voc - p.rb * i) * i, p.voc * i, pw < 0 ? -pw * p.eta : 0, f.fBrake * v, pw >= 0 ? pw * (1 / p.eta - 1) : -pw * (1 - p.eta), i]
  }
  let y = [0, 0, 0, 0, 0, 0, 0, 0]
  let limitedSteps = 0
  const store = (k: number, t: number) => {
    const v = Math.max(0, y[0])
    const f = forces(p, t, v)
    const pw = f.fMotor * v
    const pb = batteryPower(p, pw)
    const i = batteryCurrent(p, pb)
    s.vkmh[k] = v * 3.6
    s.vref[k] = p.cycle === 'accel' ? 0 : refAt(p, t).v * 3.6
    s.f[k] = f.fMotor
    s.fbrake[k] = f.fBrake
    s.pwheel[k] = pw
    s.pbatt[k] = (p.voc - p.rb * i) * i
    s.ibatt[k] = i
    s.soc[k] = 100 * (p.soc0 - (y[3] / 3600) / p.capacity)
    s.ebatt[k] = y[2]
    s.pbrake[k] = f.fBrake * v
    s.dist[k] = y[1]
    if (f.limited && p.cycle !== 'accel') limitedSteps++
  }
  store(0, 0)
  const h = p.dt
  for (let k = 1; k < n; k++) {
    const t = (k - 1) * h
    // evaluate the driver on this step's segment: stages at t + h use t + h − ε (vertex = next segment)
    const tEnd = t + h * (1 - 1e-9)
    const k1 = der(t, y)
    const k2 = der(t + h / 2, y.map((v, i) => v + (h / 2) * k1[i]))
    const k3 = der(t + h / 2, y.map((v, i) => v + (h / 2) * k2[i]))
    const k4 = der(tEnd, y.map((v, i) => v + h * k3[i]))
    y = y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]))
    if (y[0] < 0) y[0] = 0
    store(k, k * h)
  }
  const time = Float64Array.from({ length: n }, (_, k) => k * h)
  const events: RunEvent[] = []
  let seq = 0
  const ev = (t: number, device: string) => {
    const k = Math.min(n - 1, Math.max(0, Math.round(t / h)))
    events.push({ id: `e${seq++}`, kind: 'mode', time: t, device, values: { v: s.vkmh[k], p: s.pbatt[k], f: s.f[k] } })
  }
  if (p.cycle === 'accel') {
    const kb = s.vkmh.findIndex((v) => v / 3.6 >= p.vBase)
    if (kb > 0) ev(time[kb], 'base-speed')
    const k100 = s.vkmh.findIndex((v) => v >= 100)
    if (k100 > 0) ev(time[k100], '100kmh')
  } else {
    let kPk = 0
    for (let k = 0; k < n; k++) if (s.pbatt[k] > s.pbatt[kPk]) kPk = k
    ev(time[kPk], 'peak-power')
    let kRg = 0
    for (let k = 0; k < n; k++) if (s.pbatt[k] < s.pbatt[kRg]) kRg = k
    if (s.pbatt[kRg] < 0) ev(time[kRg], 'peak-regen')
    const kBr = s.pbrake.findIndex((x) => x > 1)
    if (kBr > 0) ev(time[kBr], 'friction-brake')
  }
  events.sort((a, b) => a.time - b.time)
  return {
    kind: 'ev',
    params: p,
    length: n,
    time,
    // the acceleration test has no cycle speed to show
    signals: { ...Object.fromEntries(Object.entries(s).filter(([k]) => !(k === 'vref' && p.cycle === 'accel'))), eChem: Float64Array.of(y[3]), eRegen: Float64Array.of(y[4]), eBrake: Float64Array.of(y[5]), eDrive: Float64Array.of(y[6]), q: Float64Array.of(y[7]) },
    devices: [],
    events,
    steadyFrom: 0,
    limitedSteps,
    diagnostics: { computeMs: performance.now() - started, fallbacks: 0, steady: { method: 'direct', iterations: 0, residual: 0, converged: true }, issues },
  }
}

export interface EvMeasurements {
  /** Distance [m], battery energy at the terminals and chemical [J], consumption [Wh/km]. */
  dist: number
  eBatt: number
  eChem: number
  consumption: number
  eRegen: number
  eBrake: number
  eDriveLoss: number
  eBattLoss: number
  dSoc: number
  range: number
  pPeak: number
  pRegenPeak: number
  iPeak: number
  trackErr: number
  /** Share of the cycle where the motor could not deliver the requested force. */
  limitedFrac: number
  /** Acceleration test. */
  t100: number | null
  vEnd: number
  /** Mean battery power on the longest cruise plateau [W] and its speed [km/h]. */
  pCruise: number | null
  vCruise: number | null
}

/** The longest constant-speed segment of a cycle with v > 0. */
export function cruisePlateau(p: ResolvedEv): [number, number, number] | null {
  let best: [number, number, number] | null = null
  for (let i = 0; i + 1 < p.profile.length; i++) {
    const [t0, v0] = p.profile[i]
    const [t1, v1] = p.profile[i + 1]
    if (v0 > 0 && Math.abs(v1 - v0) < 1e-9 && (!best || t1 - t0 > best[1] - best[0])) best = [t0, t1, v0]
  }
  return best
}

export function measureEv(r: EvRun): EvMeasurements {
  const p = r.params
  const s = r.signals
  const n = r.length
  const dist = s.dist[n - 1]
  const eBatt = s.ebatt[n - 1]
  const eChem = s.eChem[0]
  let pPeak = 0
  let pRegenPeak = 0
  let iPeak = 0
  let trackErr = 0
  for (let k = 0; k < n; k++) {
    pPeak = Math.max(pPeak, s.pbatt[k])
    pRegenPeak = Math.min(pRegenPeak, s.pbatt[k])
    iPeak = Math.max(iPeak, Math.abs(s.ibatt[k]))
    if (p.cycle !== 'accel') trackErr = Math.max(trackErr, Math.abs(s.vkmh[k] - s.vref[k]))
  }
  let t100: number | null = null
  if (p.cycle === 'accel')
    for (let k = 1; k < n; k++)
      if (s.vkmh[k] >= 100) {
        t100 = r.time[k - 1] + ((100 - s.vkmh[k - 1]) / (s.vkmh[k] - s.vkmh[k - 1])) * p.dt
        break
      }
  const consumption = dist > 1 ? eChem / 3600 / (dist / 1000) : NaN
  const plateau = p.cycle === 'accel' ? null : cruisePlateau(p)
  let pCruise: number | null = null
  if (plateau) {
    // skip the first 5 s of the plateau (the driver settles), average the battery power
    const k0 = Math.round((plateau[0] + 5) / p.dt)
    const k1 = Math.round(plateau[1] / p.dt)
    // samples strictly inside the plateau (the sample on the closing vertex already belongs to the next segment)
    let a = 0
    for (let k = k0; k < k1; k++) a += s.pbatt[k]
    pCruise = a / (k1 - k0)
  }
  return {
    dist,
    eBatt,
    eChem,
    consumption,
    eRegen: s.eRegen[0],
    eBrake: s.eBrake[0],
    eDriveLoss: s.eDrive[0],
    eBattLoss: eChem - eBatt,
    dSoc: s.soc[0] - s.soc[n - 1],
    range: Number.isFinite(consumption) && consumption > 0 ? (p.capacity * p.soc0) / consumption : NaN,
    pPeak,
    pRegenPeak,
    iPeak,
    trackErr,
    limitedFrac: r.limitedSteps / Math.max(1, n - 1),
    t100,
    vEnd: s.vkmh[n - 1],
    pCruise,
    vCruise: plateau ? plateau[2] * 3.6 : null,
  }
}
