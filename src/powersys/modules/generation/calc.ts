/*
 * Module 17 — Power Generation. Pure functions (no React) for the four kinds of station taught here:
 *  · thermal (coal): heat rate ↔ efficiency, fuel per hour, the efficiency chain boiler · steam cycle · generator and
 *    the energy balance, condenser heat and cooling water, an illustrative CO₂ estimate;
 *  · hydro: P = ρ g Q H η, the flow a megawatt needs, the energy stored in a reservoir;
 *  · nuclear: energy per U-235 fission (≈ 200 MeV), per kilogram (Avogadro) and fuel fissioned per day;
 *  · pumped storage: the round trip η_rt = η_motor·η_pump·η_turbine·η_generator, energy in and out, water moved.
 * Units are stated on every function. Physical constants are exact SI values (2019) or CODATA values.
 */

// ── constants ────────────────────────────────────────────────────────────────────────────────────────────────
/** Density of water [kg/m³] (the textbook value used for hydro calculations). */
export const RHO_W = 1000
/** Gravitational acceleration [m/s²] (the textbook value). */
export const G = 9.81
/** 1 MeV in joules (exact: e = 1.602176634 × 10⁻¹⁹ C). */
export const MEV_J = 1.602176634e-13
/** Avogadro constant [1/mol] (exact). */
export const NA = 6.02214076e23
/** Molar mass of U-235 [g/mol] (its relative atomic mass, 235.0439). */
export const M_U235 = 235.0439
/** Energy equivalent of one atomic mass unit [MeV] (CODATA 2018). */
export const U_MEV = 931.49410242
/** Speed of light [m/s] (exact). */
export const C_LIGHT = 299792458
/** Energy per U-235 fission [MeV] — the usual approximate (rounded) textbook figure. */
export const MEV_PER_FISSION = 200
/** Specific heat of water [kJ/(kg·K)] (≈ 4.18 near room temperature). */
export const CP_W = 4.18
/** 1 kWh = 3600 kJ; 1 MWh = 3.6 × 10⁹ J. */
export const KJ_PER_KWH = 3600
export const J_PER_MWH = 3.6e9

// ── shared ───────────────────────────────────────────────────────────────────────────────────────────────────

export type PlantType = 'thermal' | 'hydro' | 'nuclear' | 'pumped'
export const PLANT_LABEL: Record<PlantType, string> = { thermal: 'Thermal (coal)', hydro: 'Hydro', nuclear: 'Nuclear', pumped: 'Pumped storage' }

/** One stage of an energy chain: what is lost there, and what goes on. */
export interface ChainStep {
  /** Where the loss goes (e.g. "boiler losses (flue gas)"). */
  lossLabel: string
  loss: number
  /** What leaves the stage (e.g. "heat to steam"). */
  outLabel: string
  out: number
  /** The stage's efficiency out / in. */
  eta: number
}
/** An energy (or power) chain from one input through efficiencies to the useful output. */
export interface EnergyChain {
  unit: 'MW' | 'MWh'
  inLabel: string
  input: number
  steps: ChainStep[]
}

/** Build a chain: the input and each stage's efficiency. */
export function chain(unit: EnergyChain['unit'], inLabel: string, input: number, stages: Array<{ eta: number; lossLabel: string; outLabel: string }>): EnergyChain {
  let x = input
  const steps: ChainStep[] = stages.map((s) => {
    const out = x * s.eta
    const st = { lossLabel: s.lossLabel, loss: x - out, outLabel: s.outLabel, out, eta: s.eta }
    x = out
    return st
  })
  return { unit, inLabel, input, steps }
}
/** The useful output of a chain (its last stage's output). */
export const chainOutput = (c: EnergyChain) => (c.steps.length ? c.steps[c.steps.length - 1].out : c.input)
export const chainLosses = (c: EnergyChain) => c.steps.reduce((s, x) => s + x.loss, 0)

const finitePos = (x: number) => Number.isFinite(x) && x > 0
const isEta = (x: number) => Number.isFinite(x) && x > 0 && x <= 1

export type Outcome<T> = ({ ok: true } & T) | { ok: false; issues: string[] }

// ── thermal (coal) ──────────────────────────────────────────────────────────────────────────────────────────

/** Station efficiency from the heat rate [kJ/kWh]: η = 3600 / HR (1 kWh = 3600 kJ). */
export const etaFromHeatRate = (hrKjKwh: number) => KJ_PER_KWH / hrKjKwh
/** Heat rate [kJ/kWh] from the efficiency: HR = 3600 / η. */
export const heatRateFromEta = (eta: number) => KJ_PER_KWH / eta
/** Fuel burnt per hour [kg/h] = P [kW] × HR [kJ/kWh] / CV [kJ/kg]. */
export const fuelKgPerHour = (pMw: number, hrKjKwh: number, cvKjKg: number) => (pMw * 1000 * hrKjKwh) / cvKjKg
/** Carnot limit 1 − T_c/T_h for temperatures in °C. */
export const carnot = (tHotC: number, tColdC: number) => 1 - (tColdC + 273.15) / (tHotC + 273.15)

/** Illustrative steam and cooling temperatures for the Carnot comparison [°C]. */
export const T_STEAM_C = 565
export const T_COOL_C = 35

export interface ThermalIn {
  /** Electrical output [MW]. */
  pMw: number
  /** Boiler efficiency (heat to steam ÷ fuel heat). */
  etaBoiler: number
  /** Turbine-cycle efficiency (mechanical work ÷ heat to steam) — set by the Rankine cycle and the condenser. */
  etaCycle: number
  /** Generator efficiency (electrical ÷ mechanical). */
  etaGen: number
  /** Calorific value of the coal [kJ/kg]. */
  cvKjKg: number
  /** Illustrative CO₂ emission factor [kg CO₂ per GJ of fuel heat]. */
  co2KgPerGj: number
  /** Cooling-water temperature rise through the condenser [K]. */
  dTCondK: number
}

export interface ThermalResult {
  eta: number
  heatRate: number
  /** Fuel heat input [MW]. */
  qInMw: number
  fuelKgH: number
  fuelTDay: number
  co2TH: number
  co2KgPerMwh: number
  /** Heat into the steam [MW], rejected in the condenser [MW], turbine shaft power [MW]. */
  steamMw: number
  condenserMw: number
  mechMw: number
  boilerLossMw: number
  genLossMw: number
  /** Condenser cooling-water flow [m³/s] for the stated temperature rise. */
  coolingM3s: number
  /** Carnot limit at the illustrative temperatures. */
  carnot: number
  chain: EnergyChain
}

export function thermal(i: ThermalIn): Outcome<ThermalResult> {
  const issues: string[] = []
  if (!finitePos(i.pMw)) issues.push('The output must be a positive number of MW.')
  if (!isEta(i.etaBoiler) || !isEta(i.etaCycle) || !isEta(i.etaGen)) issues.push('Each efficiency must lie between 0 and 1 (0 % and 100 %).')
  if (!finitePos(i.cvKjKg)) issues.push('The calorific value must be a positive number of kJ/kg.')
  if (!Number.isFinite(i.co2KgPerGj) || i.co2KgPerGj < 0) issues.push('The emission factor cannot be negative.')
  if (!finitePos(i.dTCondK)) issues.push('The cooling-water temperature rise must be positive.')
  const cmax = carnot(T_STEAM_C, T_COOL_C)
  if (isEta(i.etaCycle) && i.etaCycle >= cmax)
    issues.push(`A steam-cycle efficiency of ${(i.etaCycle * 100).toFixed(1)} % is above the Carnot limit (${(cmax * 100).toFixed(1)} % between ${T_STEAM_C} °C and ${T_COOL_C} °C): impossible.`)
  if (issues.length) return { ok: false, issues }
  const eta = i.etaBoiler * i.etaCycle * i.etaGen
  const heatRate = heatRateFromEta(eta)
  const qInMw = i.pMw / eta
  const c = chain('MW', 'Fuel heat (coal)', qInMw, [
    { eta: i.etaBoiler, lossLabel: 'Boiler losses (flue gas, ash, radiation)', outLabel: 'Heat into steam' },
    { eta: i.etaCycle, lossLabel: 'Heat rejected in the condenser', outLabel: 'Turbine shaft power' },
    { eta: i.etaGen, lossLabel: 'Generator losses', outLabel: 'Electrical output' },
  ])
  const fuelKgH = fuelKgPerHour(i.pMw, heatRate, i.cvKjKg)
  const gjPerH = qInMw * 3.6 // MW × 3600 s = MJ/h → GJ/h
  const co2TH = (gjPerH * i.co2KgPerGj) / 1000
  const condenserMw = c.steps[1].loss
  return {
    ok: true,
    eta,
    heatRate,
    qInMw,
    fuelKgH,
    fuelTDay: (fuelKgH * 24) / 1000,
    co2TH,
    co2KgPerMwh: (co2TH * 1000) / i.pMw,
    steamMw: c.steps[0].out,
    condenserMw,
    mechMw: c.steps[1].out,
    boilerLossMw: c.steps[0].loss,
    genLossMw: c.steps[2].loss,
    coolingM3s: (condenserMw * 1000) / (CP_W * i.dTCondK) / RHO_W,
    carnot: cmax,
    chain: c,
  }
}

// ── hydro ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Hydro power [W] = ρ g Q H η (Q in m³/s, H in m). */
export const hydroPowerW = (qM3s: number, headM: number, eta: number) => RHO_W * G * qM3s * headM * eta
/** The flow [m³/s] that gives P [MW] at head H [m] and overall efficiency η. */
export const flowForPower = (pMw: number, headM: number, eta: number) => (pMw * 1e6) / (RHO_W * G * headM * eta)
/** Potential energy of a volume V [m³] of water raised H [m]: E = ρ g V H [J]. */
export const reservoirEnergyJ = (volumeM3: number, headM: number) => RHO_W * G * volumeM3 * headM

export interface HydroIn {
  pMw: number
  headM: number
  etaTurbine: number
  etaGen: number
  /** Usable reservoir volume [million m³]. */
  volumeMm3: number
}
export interface HydroResult {
  eta: number
  qM3s: number
  /** Power in the falling water ρ g Q H [MW]. */
  waterMw: number
  mechMw: number
  /** Water used per MWh generated [m³/MWh]. */
  m3PerMwh: number
  /** Potential energy stored [MWh] and the electrical energy it can give [MWh]. */
  storedMwh: number
  electricalMwh: number
  /** Hours at the chosen output until the usable volume is used. */
  hours: number
  chain: EnergyChain
}
export function hydro(i: HydroIn): Outcome<HydroResult> {
  const issues: string[] = []
  if (!finitePos(i.pMw)) issues.push('The output must be a positive number of MW.')
  if (!finitePos(i.headM)) issues.push('The head must be a positive height in metres.')
  if (!isEta(i.etaTurbine) || !isEta(i.etaGen)) issues.push('Each efficiency must lie between 0 and 1.')
  if (!finitePos(i.volumeMm3)) issues.push('The reservoir volume must be positive.')
  if (issues.length) return { ok: false, issues }
  const eta = i.etaTurbine * i.etaGen
  const qM3s = flowForPower(i.pMw, i.headM, eta)
  const waterMw = hydroPowerW(qM3s, i.headM, 1) / 1e6
  const c = chain('MW', 'Power in the falling water (ρgQH)', waterMw, [
    { eta: i.etaTurbine, lossLabel: 'Turbine losses (friction, leakage, exit)', outLabel: 'Turbine shaft power' },
    { eta: i.etaGen, lossLabel: 'Generator losses', outLabel: 'Electrical output' },
  ])
  const storedMwh = reservoirEnergyJ(i.volumeMm3 * 1e6, i.headM) / J_PER_MWH
  const electricalMwh = storedMwh * eta
  return {
    ok: true,
    eta,
    qM3s,
    waterMw,
    mechMw: c.steps[0].out,
    m3PerMwh: (qM3s * 3600) / i.pMw,
    storedMwh,
    electricalMwh,
    hours: electricalMwh / i.pMw,
    chain: c,
  }
}

// ── nuclear ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Energy released by fissioning 1 kg of U-235 [J]: (1000 g / M) × N_A × E_f. */
export const fissionEnergyPerKgJ = (mevPerFission = MEV_PER_FISSION, molarMassG = M_U235) => (1000 / molarMassG) * NA * mevPerFission * MEV_J
/** The same from the mass converted: each fission turns E_f/931.494 u of its 235.04 u into energy, so per kg (E_f/931.494)/A_r × c². */
/**
 * One possible fission, from standard atomic-mass data (AME 2020, atomic masses in u, rounded to 7 decimals):
 * U-235 + n → Ba-141 + Kr-92 + 3 n. The mass lost, Δm, appears as the kinetic energy of the fragments and neutrons
 * (prompt). The rest of the ≈ 200 MeV usually quoted comes from prompt γ rays and the later radioactive decay of the
 * fission products; other fission pairs differ by a few MeV.
 */
export const ATOMIC_MASS_U = { U235: 235.0439299, n: 1.0086649, Ba141: 140.9144033, Kr92: 91.9261731 }
export function fissionMassDefect(m = ATOMIC_MASS_U) {
  const before = m.U235 + m.n
  const after = m.Ba141 + m.Kr92 + 3 * m.n
  const dm = before - after
  return { before, after, dmU: dm, mev: dm * U_MEV, joules: dm * U_MEV * MEV_J }
}

export interface NuclearIn {
  pMw: number
  /** Net thermal efficiency: electrical output ÷ reactor heat. */
  etaTh: number
}
export interface NuclearResult {
  thermalMw: number
  rejectedMw: number
  fissionsPerS: number
  energyPerKgJ: number
  /** U-235 actually fissioned per day [kg]. */
  kgPerDay: number
  chain: EnergyChain
}
export function nuclear(i: NuclearIn): Outcome<NuclearResult> {
  const issues: string[] = []
  if (!finitePos(i.pMw)) issues.push('The output must be a positive number of MW.')
  if (!isEta(i.etaTh)) issues.push('The thermal efficiency must lie between 0 and 1.')
  if (issues.length) return { ok: false, issues }
  const thermalMw = i.pMw / i.etaTh
  const e = fissionEnergyPerKgJ()
  const c = chain('MW', 'Fission heat in the reactor', thermalMw, [{ eta: i.etaTh, lossLabel: 'Heat rejected (mostly in the condenser)', outLabel: 'Electrical output' }])
  return {
    ok: true,
    thermalMw,
    rejectedMw: thermalMw - i.pMw,
    fissionsPerS: (thermalMw * 1e6) / (MEV_PER_FISSION * MEV_J),
    energyPerKgJ: e,
    kgPerDay: (thermalMw * 1e6 * 86400) / e,
    chain: c,
  }
}

// ── pumped storage ──────────────────────────────────────────────────────────────────────────────────────────

export interface PumpedIn {
  /** Machine rating: the power drawn while pumping and delivered while generating [MW]. */
  pMw: number
  headM: number
  etaMotor: number
  etaPump: number
  etaTurbine: number
  etaGen: number
  /** Hours of pumping (off-peak). */
  hoursPumping: number
  /** What the machine is doing in the picture. */
  mode: 'pump' | 'generate'
}
export interface PumpedResult {
  etaRt: number
  /** Energy drawn from the grid, stored as potential energy, returned [MWh]. */
  eInMwh: number
  storedMwh: number
  eOutMwh: number
  /** Water raised [m³]. */
  volumeM3: number
  /** Flow while pumping and while generating at the rating [m³/s]. */
  qPump: number
  qGen: number
  /** Hours of generation at the rating from the stored water. */
  hoursGen: number
  /** The peak ÷ off-peak price ratio at which storing just pays for its losses: 1/η_rt. */
  breakEven: number
  chain: EnergyChain
}
export const roundTrip = (i: Pick<PumpedIn, 'etaMotor' | 'etaPump' | 'etaTurbine' | 'etaGen'>) => i.etaMotor * i.etaPump * i.etaTurbine * i.etaGen
export function pumped(i: PumpedIn): Outcome<PumpedResult> {
  const issues: string[] = []
  if (!finitePos(i.pMw)) issues.push('The machine rating must be a positive number of MW.')
  if (!finitePos(i.headM)) issues.push('The head must be a positive height in metres.')
  if (![i.etaMotor, i.etaPump, i.etaTurbine, i.etaGen].every(isEta)) issues.push('Each efficiency must lie between 0 and 1.')
  if (!finitePos(i.hoursPumping)) issues.push('The pumping time must be positive.')
  if (issues.length) return { ok: false, issues }
  const eInMwh = i.pMw * i.hoursPumping
  const c = chain('MWh', 'Energy drawn from the grid (off-peak)', eInMwh, [
    { eta: i.etaMotor, lossLabel: 'Motor losses', outLabel: 'Shaft energy to the pump' },
    { eta: i.etaPump, lossLabel: 'Pump losses', outLabel: 'Potential energy stored' },
    { eta: i.etaTurbine, lossLabel: 'Turbine losses', outLabel: 'Shaft energy from the turbine' },
    { eta: i.etaGen, lossLabel: 'Generator losses', outLabel: 'Energy returned (peak)' },
  ])
  const storedMwh = c.steps[1].out
  const rgh = RHO_W * G * i.headM
  const etaRt = roundTrip(i)
  const eOutMwh = chainOutput(c)
  return {
    ok: true,
    etaRt,
    eInMwh,
    storedMwh,
    eOutMwh,
    volumeM3: (storedMwh * J_PER_MWH) / rgh,
    qPump: (i.pMw * 1e6 * i.etaMotor * i.etaPump) / rgh,
    qGen: (i.pMw * 1e6) / (rgh * i.etaTurbine * i.etaGen),
    hoursGen: eOutMwh / i.pMw,
    breakEven: 1 / etaRt,
    chain: c,
  }
}

// ── the whole state, defaults and ranges ──────────────────────────────────────────────────────────────────

export interface Plants {
  type: PlantType
  thermal: ThermalIn
  hydro: HydroIn
  nuclear: NuclearIn
  pumped: PumpedIn
}

/** Illustrative default values (typical orders of magnitude, not a specific station). */
export const DEFAULT_THERMAL: ThermalIn = { pMw: 500, etaBoiler: 0.88, etaCycle: 3600 / (10000 * 0.88 * 0.985), etaGen: 0.985, cvKjKg: 17000, co2KgPerGj: 95, dTCondK: 10 }
export const DEFAULT_HYDRO: HydroIn = { pMw: 200, headM: 150, etaTurbine: 0.92, etaGen: 0.98, volumeMm3: 100 }
export const DEFAULT_NUCLEAR: NuclearIn = { pMw: 1000, etaTh: 0.33 }
export const DEFAULT_PUMPED: PumpedIn = { pMw: 250, headM: 300, etaMotor: 0.98, etaPump: 0.9, etaTurbine: 0.91, etaGen: 0.98, hoursPumping: 6, mode: 'generate' }
export const DEFAULT_PLANTS: Plants = { type: 'thermal', thermal: DEFAULT_THERMAL, hydro: DEFAULT_HYDRO, nuclear: DEFAULT_NUCLEAR, pumped: DEFAULT_PUMPED }

export const P_RANGE: Record<PlantType, [number, number]> = { thermal: [50, 1000], hydro: [10, 1000], nuclear: [200, 1600], pumped: [50, 1000] }

/** The steam-cycle efficiency range this module allows (the same as its η_cycle slider). */
export const ETA_CYCLE_RANGE: [number, number] = [0.3, 0.5]
/** The heat rates reachable by changing only the steam cycle within its range (boiler and generator held) [kJ/kWh]. */
export const heatRateBounds = (t: ThermalIn): [number, number] => [KJ_PER_KWH / (t.etaBoiler * t.etaGen * ETA_CYCLE_RANGE[1]), KJ_PER_KWH / (t.etaBoiler * t.etaGen * ETA_CYCLE_RANGE[0])]
/** Set the heat rate by changing the steam-cycle efficiency (boiler and generator held), kept within ETA_CYCLE_RANGE. */
export const withHeatRate = (t: ThermalIn, hr: number): ThermalIn => {
  const [lo, hi] = heatRateBounds(t)
  const h = Math.min(hi, Math.max(lo, hr))
  return { ...t, etaCycle: KJ_PER_KWH / (h * t.etaBoiler * t.etaGen) }
}

/** The coal a station with heat rate HR and calorific value CV would burn per day for the same electrical output [t/day]. */
export const coalTonnesPerDay = (pMw: number, hr: number, cv: number) => (fuelKgPerHour(pMw, hr, cv) * 24) / 1000

// ── computed wording ──────────────────────────────────────────────────────────────────────────────────────────

/** "about 3.7 million times" style: a ratio in words, rounded to two significant figures, with the number. */
export function timesWords(r: number): string {
  if (!Number.isFinite(r) || r <= 0) return '—'
  const two = (x: number) => Number(x.toPrecision(2)).toLocaleString('en-GB')
  if (r >= 1e9) return `about ${two(r / 1e9)} billion times`
  if (r >= 1e6) return `about ${two(r / 1e6)} million times`
  if (r >= 1e3) return `about ${two(r)} times`
  if (r >= 1.05) return `${two(r)} times`
  if (r > 0.95) return 'about the same as'
  return `${two(r)} times`
}
/** A percentage change in words with its sign: "falls 9.5 %", "rises 3.0 %", "does not change". */
export function changeWords(after: number, before: number, decimals = 1): string {
  const d = ((after - before) / Math.abs(before)) * 100
  if (Math.abs(d) < 0.5 * 10 ** -decimals) return 'does not change'
  return `${d > 0 ? 'rises' : 'falls'} ${Math.abs(d).toFixed(decimals)} %`
}
