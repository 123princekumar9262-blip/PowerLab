import {
  DEFAULT_PLANTS,
  fissionEnergyPerKgJ,
  fissionMassDefect,
  G,
  hydro,
  J_PER_MWH,
  M_U235,
  MEV_J,
  MEV_PER_FISSION,
  NA,
  nuclear,
  pumped,
  RHO_W,
  thermal,
  type HydroIn,
  type HydroResult,
  type NuclearIn,
  type NuclearResult,
  type Plants,
  type PumpedIn,
  type PumpedResult,
  type ThermalIn,
  type ThermalResult,
} from './calc.ts'
import { estimate, LAB0, labMeasurements, measDefs, minimiseJ, trueState, type LabState, type MeasIn, type SeOutcome } from './se.ts'

/*
 * The Verify mode's checks, as pure functions — so the test can show that each holds for every valid input AND that
 * each can fail (a wrong model value is caught).
 *
 * Each check recomputes a model result by a DIFFERENT route (another physical path or another chain of arithmetic,
 * starting from the inputs), never by rearranging the model's own formula:
 *  · coal: the fuel from SI units (J/s of heat ÷ J/kg) — and, separately, a bookkeeping (consistency) check that the
 *    stage losses add up, labelled as such;
 *  · hydro: the power of a frictionless jet at the foot of the head, ½ρQv² with v = √(2gH);
 *  · nuclear: counting fissions (power ÷ energy per fission) and converting atoms to grams with N_A and M;
 *    and a genuine mass-defect example from atomic masses, compared with the ≈ 200 MeV figure (within 20 %);
 *  · pumped storage: the water volume from the pumping flow × time, and the energy returned from the time that
 *    volume takes to run back down at the generating flow;
 *  · state estimate: Newton steps on values of J only (no normal equations); exact meters → zero residuals.
 * Tolerances: arithmetic routes agree to rounding (relative 10⁻⁹); the WLS routes to 10⁻⁹ rad.
 */

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300)
const TOL = 1e-9

/** Coal: the fuel burnt, by SI units from the heat rate. */
export function checkCoal(i: ThermalIn, r: Pick<ThermalResult, 'fuelKgH' | 'heatRate' | 'qInMw' | 'boilerLossMw' | 'condenserMw' | 'genLossMw'>) {
  const heatW = (i.pMw * 1e6 * r.heatRate) / 3600 // W: (J/s out) × (kJ in per kJ out); HR/3600 is heat ÷ electricity
  const kgPerS = heatW / (i.cvKjKg * 1000)
  const fuelSi = kgPerS * 3600
  const balance = r.boilerLossMw + r.condenserMw + r.genLossMw + i.pMw
  return { heatW, kgPerS, fuelSi, balance, ok: rel(fuelSi, r.fuelKgH) < TOL && rel(heatW / 1e6, r.qInMw) < TOL, balanceOk: rel(balance, r.qInMw) < TOL }
}
/** Hydro: a frictionless jet at the foot of the head has v = √(2gH); its kinetic power ½ρQv², × η, is the output. */
export function checkHydro(i: HydroIn, r: Pick<HydroResult, 'qM3s' | 'eta'>) {
  const v = Math.sqrt(2 * G * i.headM)
  const jetW = 0.5 * RHO_W * r.qM3s * v * v
  const pMw = (jetW * r.eta) / 1e6
  return { v, jetW, pMw, ok: rel(pMw, i.pMw) < TOL }
}
/** Nuclear: count the fissions, then atoms → moles → grams. Also a genuine mass-defect example. */
export function checkNuclear(i: NuclearIn, r: Pick<NuclearResult, 'kgPerDay'>) {
  const heatW = (i.pMw * 1e6) / i.etaTh
  const perS = heatW / (MEV_PER_FISSION * MEV_J)
  const perDay = perS * 86400
  const moles = perDay / NA
  const kg = (moles * M_U235) / 1000
  const md = fissionMassDefect()
  const share = md.mev / MEV_PER_FISSION
  return { perS, perDay, moles, kg, md, share, ok: rel(kg, r.kgPerDay) < TOL, mdOk: share > 0.8 && share < 1 }
}
/** Pumped storage: the volume from the pumping flow and time; the energy back from the time it takes to run down. */
export function checkPumped(i: PumpedIn, r: Pick<PumpedResult, 'qPump' | 'qGen' | 'storedMwh' | 'eOutMwh' | 'eInMwh'> & { chain: PumpedResult['chain'] }) {
  const vol = r.qPump * i.hoursPumping * 3600
  const storedMwh = (RHO_W * G * vol * i.headM) / J_PER_MWH
  const hoursDown = vol / r.qGen / 3600
  const eOut = i.pMw * hoursDown
  const losses = r.chain.steps.reduce((s, x) => s + x.loss, 0)
  return { vol, storedMwh, hoursDown, eOut, losses, ok: rel(storedMwh, r.storedMwh) < TOL && rel(eOut, r.eOutMwh) < TOL, balanceOk: rel(losses + r.eOutMwh, r.eInMwh) < TOL }
}

export interface VerifyData {
  /** The student's inputs were valid (else the defaults are checked). */
  own: boolean
  /** The student's lab was observable (else the default lab is used). */
  ownLab: boolean
  plants: Plants
  lab: LabState
  th: ThermalResult
  hy: HydroResult
  nu: NuclearResult
  pu: PumpedResult
  thermal: ReturnType<typeof checkCoal>
  hydro: ReturnType<typeof checkHydro>
  nuclear: ReturnType<typeof checkNuclear> & { ekA: number }
  pumped: ReturnType<typeof checkPumped>
  wls: {
    ms: MeasIn[]
    se: Extract<SeOutcome, { ok: true }>
    G: number[][]
    t: number[]
    det: number
    xHand: number[]
    grad: number[]
    gradScale: number
    direct: { x: [number, number]; sweeps: number }
    dx: number
    ok: boolean
  }
  exact: { se: Extract<SeOutcome, { ok: true }>; maxR: number; ok: boolean }
}

export function verifyData(plants: Plants, lab: LabState): VerifyData {
  const own = thermal(plants.thermal).ok && hydro(plants.hydro).ok && nuclear(plants.nuclear).ok && pumped(plants.pumped).ok
  const P = own ? plants : DEFAULT_PLANTS
  const ownLab = estimate(labMeasurements(lab)).ok
  const L = ownLab ? lab : LAB0
  const th = thermal(P.thermal)
  const hy = hydro(P.hydro)
  const nu = nuclear(P.nuclear)
  const pu = pumped(P.pumped)
  if (!th.ok || !hy.ok || !nu.ok || !pu.ok) throw new Error('default station data invalid')
  // the state estimate by hand
  const ms = labMeasurements(L)
  const se = estimate(ms)
  if (!se.ok) throw new Error('default lab unobservable')
  const defs = measDefs()
  const Gm = [
    [0, 0],
    [0, 0],
  ]
  const t = [0, 0]
  for (const m of ms) {
    const h = defs[m.id].row
    const w = 1 / (m.sigma * m.sigma)
    for (let a = 0; a < 2; a++) {
      t[a] += h[a] * w * m.z
      for (let b = 0; b < 2; b++) Gm[a][b] += h[a] * w * h[b]
    }
  }
  const det = Gm[0][0] * Gm[1][1] - Gm[0][1] * Gm[1][0]
  const xHand = [(Gm[1][1] * t[0] - Gm[0][1] * t[1]) / det, (Gm[0][0] * t[1] - Gm[1][0] * t[0]) / det]
  const grad = [0, 1].map((a) => ms.reduce((s, m) => s + (defs[m.id].row[a] / m.sigma ** 2) * (m.z - (defs[m.id].row[0] * se.x[0] + defs[m.id].row[1] * se.x[1])), 0))
  const gradScale = Math.max(...[0, 1].map((a) => ms.reduce((s, m) => s + Math.abs(defs[m.id].row[a] * m.z) / m.sigma ** 2, 0)))
  const direct = minimiseJ(ms)
  const dx = Math.max(Math.abs(direct.x[0] - se.x[0]), Math.abs(direct.x[1] - se.x[1]))
  const xScale = Math.max(Math.abs(se.x[0]), Math.abs(se.x[1]), 1e-3)
  const ex = estimate(labMeasurements({ ...L, noise: false, bad: null }))
  if (!ex.ok) throw new Error('exact lab unobservable')
  const xt = trueState()
  const maxR = Math.max(...ex.meas.map((m) => Math.abs(m.r)))
  return {
    own,
    ownLab,
    plants: P,
    lab: L,
    th,
    hy,
    nu,
    pu,
    thermal: checkCoal(P.thermal, th),
    hydro: checkHydro(P.hydro, hy),
    nuclear: { ...checkNuclear(P.nuclear, nu), ekA: fissionEnergyPerKgJ() },
    pumped: checkPumped(P.pumped, pu),
    wls: {
      ms,
      se,
      G: Gm,
      t,
      det,
      xHand,
      grad,
      gradScale,
      direct,
      dx,
      ok: dx < 1e-9 && Math.abs(xHand[0] - se.x[0]) < 1e-12 * xScale && Math.abs(xHand[1] - se.x[1]) < 1e-12 * xScale && Math.abs(grad[0]) < 1e-9 * gradScale && Math.abs(grad[1]) < 1e-9 * gradScale,
    },
    exact: { se: ex, maxR, ok: ex.J < 1e-12 && Math.abs(ex.x[0] - xt[0]) < 1e-12 && Math.abs(ex.x[1] - xt[1]) < 1e-12 && maxR < 1e-12 },
  }
}
