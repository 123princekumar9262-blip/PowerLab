/*
 * Kelvin's law for the most economical conductor cross-section a. Per km of route and per conductor:
 *   annual capital charge (the part proportional to a) = p · k · a          [₹/yr]
 *   annual cost of the energy lost                       = I² · (ρ·1000/a) · T · c / 1000   [₹/yr]
 * The first rises with a, the second falls as 1/a; their sum is least where they are EQUAL (Kelvin's law), at
 *   a* = I · √(ρ · T · c / (p · k)).
 * The law ignores voltage drop, the conductor's current rating (heating), corona and mechanical strength, and
 * assumes the capital cost is linear in a. Checked against a numerical minimisation of the total.
 */

export interface KelvinInput {
  /** Equivalent constant current: flowing for T hours a year, it gives the same annual I²·t as the real load [A]. */
  I: number
  /** Hours per year that this current flows [h/yr]. */
  T: number
  /** Price of energy [₹/kWh]. */
  c: number
  /** Resistivity [Ω·mm²/m]. */
  rho: number
  /** Cost of the conductor (and of its installation) that is proportional to its cross-section [₹ per mm² per km]. */
  k: number
  /** Annual rate of interest plus depreciation [fraction per year]. */
  p: number
}

export interface KelvinCost {
  capital: number
  energy: number
  total: number
}

export function validateKelvin(q: KelvinInput): string | null {
  const names: Array<[keyof KelvinInput, string]> = [
    ['I', 'The current'],
    ['T', 'The hours per year'],
    ['c', 'The energy price'],
    ['rho', 'The resistivity'],
    ['k', 'The cost per mm²'],
    ['p', 'The interest-and-depreciation rate'],
  ]
  for (const [key, name] of names) if (!(q[key] > 0) || !Number.isFinite(q[key])) return `${name} must be positive.`
  if (q.T > 8760) return 'A year has 8,760 hours: the hours per year cannot exceed that.'
  return null
}

/** Annual costs per km per conductor for a cross-section a [mm²]. */
export function kelvinCost(q: KelvinInput, a: number): KelvinCost {
  const capital = q.p * q.k * a
  const energy = (q.I * q.I * ((q.rho * 1000) / a) * q.T * q.c) / 1000
  return { capital, energy, total: capital + energy }
}

/** Kelvin's law: the cross-section at which the variable annual capital charge equals the annual cost of losses. */
export const kelvinArea = (q: KelvinInput) => q.I * Math.sqrt((q.rho * q.T * q.c) / (q.p * q.k))

/** The second method: golden-section search of the total annual cost over ln a (a from 0.01 to 10⁶ mm²). */
export function kelvinNumeric(q: KelvinInput, tol = 1e-12): { a: number; cost: number; iterations: number } {
  const f = (u: number) => kelvinCost(q, Math.exp(u)).total
  let lo = Math.log(0.01)
  let hi = Math.log(1e6)
  const g = (Math.sqrt(5) - 1) / 2
  let c = hi - g * (hi - lo)
  let d = lo + g * (hi - lo)
  let fc = f(c)
  let fd = f(d)
  let it = 0
  while (hi - lo > tol && it < 500) {
    if (fc < fd) {
      hi = d
      d = c
      fd = fc
      c = hi - g * (hi - lo)
      fc = f(c)
    } else {
      lo = c
      c = d
      fc = fd
      d = lo + g * (hi - lo)
      fd = f(d)
    }
    it++
  }
  const a = Math.exp((lo + hi) / 2)
  return { a, cost: kelvinCost(q, a).total, iterations: it }
}

/** Illustrative defaults (not from a specific utility or catalogue). */
export const DEFAULT_KELVIN: KelvinInput = { I: 150, T: 3000, c: 8, rho: 0.0282, k: 2000, p: 0.1 }
/** Illustrative cost per mm² per km for each material (copper is the dearer metal per unit area). */
export const K_ILLUSTRATIVE = { aluminium: 2000, copper: 5000 }
