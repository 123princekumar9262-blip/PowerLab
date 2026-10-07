import { isScrDevice } from '../circuits/devices.ts'
import { detectCommutations, type Commutation } from '../simulation/commutation.ts'
import { isThreePhase, type SimulationResult } from '../types/simulation.ts'

/**
 * Commutation overlap μ — MEASURED from the simulation's switching events, and compared with
 * the textbook overlap relation only where its assumptions hold.
 *
 * Theory (derived, not assumed): during a commutation from phase x to phase y in the same group
 * both phases are shorted through their source inductances, so 2·Ls·di/dt = v_yx with
 * v_yx = √2·VLL·sin θ measured from the natural commutation point. Integrating from α to α + μ
 * with the current transferring from 0 to Id:
 *
 *   cos α − cos(α + μ) = 2·ω·Ls·Id / (√2·VLL) = 2·ω·Ls·Id / (√6·Vph)
 *
 * (The commutating voltage is the LINE voltage √2·VLL = √6·Vph — writing VLL in place of Vph
 * in the last form would make μ about √3 times too small.) μ is solved numerically:
 * μ = acos(cos α − k) − α, k = 2ωLs·Id/(√6·Vph).
 */
export interface OverlapRow {
  c: Commutation
  /** Firing delay of the incoming device: α for an SCR, 0 for a diode [°]. */
  alphaDeg: number
  /** Theoretical μ for this commutation (with Id = the simulated current during it) [°]. */
  theoryMu: number | null
}

export interface OverlapAnalysis {
  /** Every commutation of the last (steady-state) cycle, with its measured μ. */
  rows: OverlapRow[]
  measuredMu: number | null
  theoryMu: number | null
  /** (measured − theory)/theory, only when the comparison is valid. */
  difference: number | null
  /** The comparison with theory is valid (all assumptions hold). */
  available: boolean
  /** Why it is not available (each violated assumption). */
  reasons: string[]
  assumptions: string[]
  formula: string
}

const RAD = Math.PI / 180

export function overlapAnalysis(result: SimulationResult): OverlapAnalysis | null {
  const p = result.params
  if (!isThreePhase(p.topology)) return null
  const all = detectCommutations(p, result.diodeIds, result.trace, result.events)
  const t0 = p.duration - p.period
  const last = all.filter((c) => c.tStart >= t0 - 1e-12 && c.tEnd <= p.duration)
  const α = p.control.alpha / RAD
  const Ls = p.threePhase.ls
  const vph = p.vrms
  const formula = 'cos α − cos(α + μ) = 2·ω·Ls·Id / (√6·Vph)   (√6·Vph = √2·VLL)'
  const assumptions = [
    'Three-phase rectifier fed by a balanced, healthy source (no missing phase, imbalance or device fault).',
    'Commutation inductance Ls per phase; no source resistance (Rs = 0).',
    'Devices: constant forward drop, no on-resistance (Ron = 0) — the drops of the two commutating devices cancel.',
    'The load current is continuous and nearly constant during the overlap (Id taken from the simulated current during each commutation; variation < 5 %).',
    'No freewheeling diode conduction during the overlap.',
  ]
  const reasons: string[] = []
  const f = p.faults
  if (f.missingPhase || f.imbalance || f.diode || f.vfOverride) reasons.push('A fault or imbalance is applied — the formula assumes a balanced, healthy source.')
  if (!(Ls > 0)) reasons.push('Ls = 0: with no commutation inductance the idealized model has no finite overlap (μ = 0) — there is nothing to compare.')
  if (p.threePhase.rs > 0) reasons.push(`Source resistance Rs = ${p.threePhase.rs} Ω — the overlap relation assumes a purely inductive commutation loop.`)
  if (p.diode.ron > 0) reasons.push(`Device on-resistance Ron = ${p.diode.ron} Ω adds resistance to the commutation loop.`)
  if (!last.length) reasons.push('No commutation was detected in the last cycle (the current may be discontinuous).')
  const fwK = result.diodeIds.indexOf('Dfw')
  const rows: OverlapRow[] = last.map((c) => {
    const a = isScrDevice(p, c.incoming) ? α : 0
    const k = (2 * p.omega * Ls * c.idMean) / (Math.sqrt(6) * vph)
    const x = Math.cos(a * RAD) - k
    const theoryMu = Ls > 0 && x >= -1 && x <= 1 ? Math.acos(x) / RAD - a : null
    return { c, alphaDeg: a, theoryMu }
  })
  if (last.some((c) => !(c.idMean > 0) || c.idVariation > 0.05)) reasons.push('The load current is not continuous and nearly constant during every overlap (the formula assumes a constant Id).')
  if (fwK >= 0 && last.some((c) => {
    const tr = result.trace.diodes[fwK]
    for (let i = Math.round(c.tStart / p.dt); i <= Math.round(c.tEnd / p.dt); i++) if (tr.on[i]) return true
    return false
  }))
    reasons.push('The freewheeling diode conducts during the overlap.')
  if (rows.some((r) => r.theoryMu === null) && Ls > 0) reasons.push('cos α − k < −1: the formula predicts commutation failure for this α and current.')
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null)
  const measuredMu = mean(last.map((c) => c.muDeg))
  const theoryMu = mean(rows.map((r) => r.theoryMu).filter((v): v is number => v !== null))
  const available = reasons.length === 0 && measuredMu !== null && theoryMu !== null && theoryMu > 0
  return {
    rows,
    measuredMu,
    theoryMu: available ? theoryMu : null,
    difference: available ? (measuredMu! - theoryMu!) / theoryMu! : null,
    available,
    reasons,
    assumptions,
    formula,
  }
}
