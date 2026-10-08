import type { ConverterKind, ConverterParams, ResolvedConverter } from './types.ts'

/**
 * Safe educational defaults — every one is a SIMULATION VALUE, not a recommended design.
 * 24 V → about 12 V at 2 A; L = 100 µH sits above the CCM/DCM boundary (75 µH at these values),
 * so CCM is the starting point and DCM is one experiment away.
 */
export const BUCK_DEFAULTS: ConverterParams = {
  vin: 24,
  fs: 20e3,
  duty: 0.5,
  l: 100e-6,
  c: 100e-6,
  r: 6,
  devices: 'ideal',
  ronQ: 0.05,
  vfD: 0.7,
  ronD: 0.02,
  rl: 0,
  esr: 0,
  view: 'steady',
  periods: 4,
  stepsPerPeriod: 200,
}

/**
 * Boost: 12 V → about 24 V at 1 A. Buck-boost: 12 V → about −12 V at 1 A. Both chosen so that, like
 * the buck, L = 100 µH sits just above the CCM/DCM boundary (75 µH).
 */
export const BOOST_DEFAULTS: ConverterParams = { ...BUCK_DEFAULTS, vin: 12, r: 24 }
export const BUCK_BOOST_DEFAULTS: ConverterParams = { ...BUCK_DEFAULTS, vin: 12, r: 12 }
export const DCDC_DEFAULTS: Record<ConverterKind, ConverterParams> = { buck: BUCK_DEFAULTS, boost: BOOST_DEFAULTS, 'buck-boost': BUCK_BOOST_DEFAULTS }

/** Allowed ranges (UI sliders and the clamp). */
export const BUCK_LIMITS = {
  vin: { min: 1, max: 400, step: 1 },
  fs: { min: 1e3, max: 500e3 },
  duty: { min: 0.1, max: 0.9, step: 0.01 },
  l: { min: 1e-6, max: 10e-3 },
  c: { min: 1e-6, max: 10e-3 },
  r: { min: 0.5, max: 1000 },
  ronQ: { min: 1e-3, max: 2 },
  vfD: { min: 0, max: 2 },
  ronD: { min: 1e-3, max: 2 },
  rl: { min: 0, max: 5 },
  esr: { min: 0, max: 5 },
  periods: { min: 1, max: 20 },
  stepsPerPeriod: { min: 50, max: 2000 },
} as const

/** Device values used for "ideal" devices: a 1 mΩ channel and a 0 V / 1 mΩ diode. */
export const IDEAL_RON = 1e-3

const clamp = (x: number, lo: number, hi: number, fallback: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback)

/** Clamp every parameter into its range and derive Ts, Δt and the run duration. */
export function resolveConverter(input: Partial<ConverterParams>, kind: ConverterKind = 'buck'): { params: ResolvedConverter; issues: string[] } {
  const defaults = DCDC_DEFAULTS[kind]
  const p = { ...defaults, ...input }
  const issues: string[] = []
  const L = BUCK_LIMITS
  const c = (key: keyof typeof L, label: string) => {
    const lim = L[key]
    const raw = p[key as keyof ConverterParams] as number
    const v = clamp(raw, lim.min, lim.max, defaults[key as keyof ConverterParams] as number)
    if (v !== raw) issues.push(`${label} limited to ${v}`)
    return v
  }
  const vin = c('vin', 'Vin')
  const fs = c('fs', 'fs')
  // PWM edges need not fall on the time grid: the engine splits a step at every gate edge.
  const duty = c('duty', 'D')
  const l = c('l', 'L')
  const cap = c('c', 'C')
  const r = c('r', 'R')
  const ronQ = c('ronQ', 'Ron(Q)')
  const vfD = c('vfD', 'Vf(D)')
  const ronD = c('ronD', 'Ron(D)')
  const rl = c('rl', 'DCR')
  const esr = c('esr', 'ESR')
  const periods = Math.round(c('periods', 'Periods'))
  const stepsPerPeriod = Math.round(c('stepsPerPeriod', 'Steps per period'))
  const ts = 1 / fs
  const dt = ts / stepsPerPeriod
  const ideal = p.devices === 'ideal'
  const params: ResolvedConverter = {
    ...p,
    kind,
    vin,
    fs,
    duty,
    l,
    c: cap,
    r,
    ronQ,
    vfD,
    ronD,
    rl,
    esr,
    periods,
    stepsPerPeriod,
    ts,
    period: ts,
    dt,
    duration: periods * ts, // start-up runs set their own duration (see engine)
    q: { ron: ideal ? IDEAL_RON : ronQ },
    d: { vf: ideal ? 0 : vfD, ron: ideal ? IDEAL_RON : ronD },
  }
  return { params, issues }
}
