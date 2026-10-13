import { measureMosfet, MOSFET_LIMITS, simulateMosfet, type MosfetMeasurements, type MosfetParams, type MosfetRun } from './mosfet.ts'

/**
 * DEVICES — SiC MOSFET in the double-pulse test. The physics is the MOSFET model of converters/devices/mosfet.ts
 * (unchanged, imported); this module only supplies silicon-carbide device values and two static dependences
 * of the on-resistance that matter for SiC:
 *
 *   Ron(Tj, Vdrv) = Ron25 · (s + (1 − s)·(Vref − Vth)/(Vdrv − Vth)) · (1 + kT·(Tj − 25 °C))
 *
 *   – the channel part of Ron (share 1 − s at the rated drive Vref) falls as the gate overdrive Vdrv − Vth rises:
 *     SiC's channel mobility is low, so it needs a high gate voltage (+18 V) to reach its rated Ron;
 *   – Ron rises with the junction temperature (kT per kelvin).
 *
 * The capacitances are charge-equivalent values (Qgd/Vdc for Cgd, a Coss-equivalent for Cds): a real Cgd and Coss
 * fall steeply with vDS; constant values with the same charge give the same transition times on average.
 *
 * A "Si" material choice sets silicon's coefficients (a superjunction MOSFET: fully enhanced at +10 V, Ron doubles
 * from 25 to 150 °C) so the same test can be run on a silicon die of the same class.
 */
export type Material = 'sic' | 'si'

export interface SicParams {
  material: Material
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
  /** On-resistance at 25 °C at the rated gate drive [Ω]. */
  ron25: number
  /** Junction temperature [°C]. */
  tj: number
  view: 'steady' | 'startup'
  periods: number
  stepsPerPeriod: number
}

/** Material coefficients: rated drive Vref, the non-channel share s of Ron there, temperature coefficient kT. */
export const MATERIAL: Record<Material, { vref: number; share: number; kT: number; name: string }> = {
  sic: { vref: 18, share: 0.5, kT: 0.0032, name: 'SiC' },
  si: { vref: 10, share: 0.9, kT: 0.008, name: 'Si' },
}

/** A 1200 V, 75 mΩ-class SiC MOSFET at 800 V. */
export const SIC_DEFAULTS: SicParams = {
  material: 'sic',
  vdc: 800,
  i0: 20,
  vdrv: 18,
  voff: -4,
  rg: 5,
  cgs: 1.3e-9,
  cgd: 25e-12,
  cds: 50e-12,
  vth: 2.5,
  gm: 7,
  ron25: 0.075,
  tj: 25,
  view: 'steady',
  periods: 1,
  stepsPerPeriod: 8000,
}

/** A 900 V, 120 mΩ-class silicon superjunction MOSFET, driven +12/0 V (the swap used by the experiments). */
export const SI_PRESET: Partial<SicParams> = {
  material: 'si',
  vdrv: 12,
  voff: 0,
  cgs: 6.8e-9,
  cgd: 150e-12,
  cds: 300e-12,
  vth: 3.5,
  gm: 15,
  ron25: 0.12,
}

export const SIC_LIMITS = {
  vdc: { min: 5, max: 1000 },
  i0: { min: 0.5, max: 100 },
  vdrv: { min: 8, max: 20 },
  voff: { min: -8, max: 0 },
  rg: { min: 0.5, max: 50 },
  cgs: MOSFET_LIMITS.cgs,
  cgd: MOSFET_LIMITS.cgd,
  cds: MOSFET_LIMITS.cds,
  vth: { min: 1.5, max: 5 },
  gm: MOSFET_LIMITS.gm,
  ron25: { min: 0.005, max: 1 },
  tj: { min: -40, max: 175 },
}

const clamp = (x: number, lo: number, hi: number, d: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d)

export interface ResolvedSic extends SicParams {
  /** The on-resistance simulated (temperature and drive applied) and its two factors. */
  ron: number
  driveFactor: number
  tempFactor: number
}

export function resolveSic(input: Partial<SicParams>): { params: ResolvedSic; issues: string[] } {
  const p = { ...SIC_DEFAULTS, ...input }
  const issues: string[] = []
  const L = SIC_LIMITS
  const c = (k: keyof typeof L) => {
    const raw = p[k] as number
    const v = clamp(raw, L[k].min, L[k].max, SIC_DEFAULTS[k] as number)
    if (v !== raw) issues.push(`${k} limited to ${v}`)
    return v
  }
  const material: Material = p.material === 'si' ? 'si' : 'sic'
  const q = { vdc: c('vdc'), i0: c('i0'), vdrv: c('vdrv'), voff: c('voff'), rg: c('rg'), cgs: c('cgs'), cgd: c('cgd'), cds: c('cds'), vth: c('vth'), gm: c('gm'), ron25: c('ron25'), tj: c('tj') }
  const mat = MATERIAL[material]
  const driveFactor = mat.share + ((1 - mat.share) * (mat.vref - q.vth)) / Math.max(0.5, q.vdrv - q.vth)
  const tempFactor = 1 + mat.kT * (q.tj - 25)
  return { params: { ...p, ...q, material, ron: q.ron25 * driveFactor * tempFactor, driveFactor, tempFactor }, issues }
}

/** The MOSFET-model inputs for a device. */
export function sicToMosfet(p: ResolvedSic): Partial<MosfetParams> {
  return { vdc: p.vdc, i0: p.i0, vdrv: p.vdrv, voff: p.voff, rg: p.rg, cgs: p.cgs, cgd: p.cgd, cds: p.cds, vth: p.vth, gm: p.gm, ron: p.ron }
}

export type SicRun = MosfetRun & { sic: ResolvedSic }

/** SIMULATION: the MOSFET double-pulse model, run with the device's values. */
export function simulateSic(input: Partial<SicParams>): SicRun {
  const { params, issues } = resolveSic(input)
  const r = simulateMosfet(sicToMosfet(params))
  r.diagnostics.issues.push(...issues)
  return { ...r, kind: 'sic', sic: params }
}

export interface SicMeasurements extends MosfetMeasurements {
  /** Eon + Eoff, the on-resistance simulated, average dv/dt of the turn-off voltage rise. */
  etot: number
  ron: number
  dvdtOff: number | null
  /** Gate charge delivered by the driver during turn-on, ∫iG dt over the on-pulse (SIMULATION). */
  qg: number
  /** Switching loss at 100 kHz, (Eon + Eoff)·100 kHz, from the run. */
  psw100k: number
  /** On-resistance read from the run, vDS(on)/I0, and the rated one at this temperature (Ron25 at the rated drive). */
  ronSim: number
  ronRated: number
}

export function measureSic(r: SicRun): SicMeasurements {
  const m = measureMosfet(r)
  const p = r.params
  const s = r.signals
  // ∫ iG dt over the on-pulse (samples from the first at or after ton to the last before toff)
  const k0 = Math.ceil(p.ton / p.dt)
  const k1 = Math.floor(p.toff / p.dt) - 1
  // the gate current just after the edge: the gate still at its off level (it is a capacitor voltage)
  const ig0 = (p.vdrv - s.vgs[Math.max(0, k0 - 1)]) / p.rg
  let qg = 0.5 * (ig0 + s.ig[k0]) * (r.time[k0] - p.ton)
  for (let k = k0 + 1; k <= k1; k++) qg += 0.5 * (s.ig[k - 1] + s.ig[k]) * p.dt
  return {
    ...m,
    etot: m.eon + m.eoff,
    ron: p.ron,
    dvdtOff: m.trv !== null ? (p.vdc - m.vdsOn) / m.trv : null,
    qg,
    psw100k: (m.eon + m.eoff) * 1e5,
    ronSim: m.vdsOn / p.i0,
    ronRated: r.sic.ron25 * r.sic.tempFactor,
  }
}

/** THEORY: gate charge of linear capacitances, Qg = Cgs·(Vdrv − Voff) + Cgd·((Vdrv − Voff) + (Vdc − vDS,on)). */
export function gateChargeTheory(p: { cgs: number; cgd: number; vdrv: number; voff: number; vdc: number; i0: number; ron: number }) {
  return p.cgs * (p.vdrv - p.voff) + p.cgd * (p.vdrv - p.voff + p.vdc - p.i0 * p.ron)
}
