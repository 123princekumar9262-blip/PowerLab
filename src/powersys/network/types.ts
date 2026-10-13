/**
 * THE POWER-SYSTEM NETWORK MODEL — shared by every module. A network is buses (electrical nodes) and components
 * attached to them. It is the single source of truth: diagrams, tables, animations and explanations all derive
 * from the network and the results computed from it (network/solve.ts).
 *
 * Conventions:
 *  - Balanced three-phase, steady state, positive sequence (unless a module says otherwise).
 *  - Voltages are line-to-line kV (nominal) and per unit of the bus's base voltage = its nominal kV.
 *  - Powers are three-phase MW / Mvar. Load: positive P, Q are consumed (Q > 0 = inductive, lagging).
 *    Generator: positive P, Q are delivered into the network.
 *  - Electrical connectivity comes only from component terminals (`bus`, `from`, `to`) — never from positions.
 */

export interface Bus {
  id: string
  name: string
  /** Nominal line-to-line voltage [kV] — also the bus's base voltage. */
  kv: number
  /** Position in the single-line diagram (diagram units). */
  x: number
  y: number
}

interface Base {
  id: string
  name: string
}

/** A synchronous generator. `slack`: holds |V| and angle 0 (the reference); `pv`: holds P and |V|. */
export interface Generator extends Base {
  kind: 'generator'
  bus: string
  mode: 'slack' | 'pv'
  /** Voltage set-point [pu]. */
  vPu: number
  /** Active power set-point [MW] (pv only; the slack supplies what is needed). */
  pMw?: number
  qMinMvar?: number
  qMaxMvar?: number
  ratedMva: number
  /** Sequence reactances on the machine's own rating [pu] (fault studies): subtransient x″d, negative, zero. */
  x1Pu?: number
  x2Pu?: number
  x0Pu?: number
  /** Star point solidly earthed (zero-sequence path), with an optional neutral reactance [pu, machine base]. */
  grounded?: boolean
  xnPu?: number
  /** Inertia constant H [s] on the machine rating (dynamic studies). */
  hS?: number
}

/** An external grid / infinite bus: a stiff source behind its short-circuit impedance. */
export interface Grid extends Base {
  kind: 'grid'
  bus: string
  vPu: number
  /** Short-circuit level [MVA] and X/R ratio of the source impedance (fault studies). */
  scMva?: number
  xr?: number
}

export type Winding = 'Y' | 'YN' | 'D'

/** A two-winding transformer between buses `from` (HV side as rated `kvFrom`) and `to`. */
export interface Transformer extends Base {
  kind: 'transformer'
  from: string
  to: string
  ratedMva: number
  /** Rated winding voltages [kV] (line-to-line). A ratio that differs from the buses' nominal ratio acts as a tap. */
  kvFrom: number
  kvTo: number
  /** Short-circuit impedance [% on rating] and X/R ratio. */
  zPct: number
  xr: number
  connFrom?: Winding
  connTo?: Winding
}

/** An overhead line or cable: nominal-π model from per-km data. */
export interface Line extends Base {
  kind: 'line'
  from: string
  to: string
  lengthKm: number
  rOhmPerKm: number
  xOhmPerKm: number
  /** Shunt susceptance [µS/km] (0 = short-line model). */
  bUsPerKm: number
  /** Zero-sequence series impedance [Ω/km] (fault studies). */
  r0OhmPerKm?: number
  x0OhmPerKm?: number
  /** Thermal rating [MVA] (for loading %). */
  ratingMva?: number
}

/** A circuit breaker on one end of a branch, or on a load's feeder. Open = that element is out of service. */
export interface Breaker extends Base {
  kind: 'breaker'
  /** The component it switches (a line, a transformer or a load). */
  target: string
  closed: boolean
}

/** A balanced constant-power load. */
export interface Load extends Base {
  kind: 'load'
  bus: string
  pMw: number
  /** Positive = inductive (lagging), negative = capacitive (leading). */
  qMvar: number
  /** What it represents (display). */
  type?: 'residential' | 'industrial' | 'commercial' | 'mixed'
}

export type Component = Generator | Grid | Transformer | Line | Breaker | Load
export type Branch = Transformer | Line

export interface Network {
  id: string
  name: string
  /** Three-phase base power [MVA] of the per-unit system. */
  baseMva: number
  /** Nominal frequency [Hz]. */
  fHz: number
  buses: Bus[]
  components: Component[]
}

export const isBranch = (c: Component): c is Branch => c.kind === 'line' || c.kind === 'transformer'
export const isSource = (c: Component): c is Generator | Grid => c.kind === 'generator' || c.kind === 'grid'
