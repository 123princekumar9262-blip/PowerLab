import { fx } from '../../ui/format.ts'
import type { Choice } from '../../ui/kit.tsx'
import {
  coalTonnesPerDay,
  DEFAULT_NUCLEAR,
  DEFAULT_PUMPED,
  DEFAULT_THERMAL,
  hydroPowerW,
  nuclear,
  pumped,
  timesWords,
  withHeatRate,
  thermal,
  etaFromHeatRate,
  G,
  MEV_PER_FISSION,
  NA,
  RHO_W,
  type EnergyChain,
} from './calc.ts'
import { BASE_MVA, DEG, estimate, LAB0, labMeasurements, MEAS_IDS, measDefs, type LabState, type MeasId } from './se.ts'

/**
 * Predict-first experiments: change one thing, predict, then compare the computed before and after. The correct
 * answer is DECIDED from the computation (never written in advance) and every number in an explanation is read from
 * it.
 */

export interface ExpRow {
  label: string
  unit: string
  decimals: number
  before: number
  after: number
}
export interface ExpResult {
  answer: string
  rows: ExpRow[]
  explain: string[]
  /** Column headings when "before/after" is not the right description. */
  cols?: [string, string]
  /** An energy chain to draw (after the prediction). */
  chain?: EnergyChain
  /** A lab state whose estimate to draw. */
  lab?: LabState
}
export interface Experiment {
  id: string
  title: string
  change: string
  question: string
  options: Choice[]
  run(): ExpResult
}

const ok = <T extends { ok: boolean }>(o: T): Extract<T, { ok: true }> => {
  if (!o.ok) throw new Error('experiment inputs invalid')
  return o as Extract<T, { ok: true }>
}

/** Energy released by burning one carbon atom to CO₂ [eV] (393.5 kJ/mol). */
const EV_PER_C = 393.5e3 / NA / 1.602176634e-19

/** The option whose stated value is nearest (in log ratio) to the computed one. */
const nearest = (v: number, opts: Array<[string, number]>) => opts.reduce((b, o) => (Math.abs(Math.log(o[1] / v)) < Math.abs(Math.log(b[1] / v)) ? o : b))[0]

/** The lab's measurement set with some measurements on. */
const only = (ids: MeasId[], extra?: Partial<LabState>): LabState => ({
  ...LAB0,
  enabled: Object.fromEntries(MEAS_IDS.map((id) => [id, ids.includes(id)])) as Record<MeasId, boolean>,
  ...extra,
})

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'heat-rate',
    title: 'Improve the heat rate',
    change: `A ${DEFAULT_THERMAL.pMw} MW coal station is upgraded: its heat rate improves from 10 500 to 9 500 kJ/kWh (better turbine blades). The output and the coal quality stay the same.`,
    question: 'By how much does the coal burnt per hour fall?',
    options: [
      { id: 'lt5', label: 'By less than 5 %' },
      { id: '5to15', label: 'By between 5 % and 15 %' },
      { id: 'gt15', label: 'By more than 15 %' },
    ],
    run() {
      const b = ok(thermal(withHeatRate(DEFAULT_THERMAL, 10500)))
      const a = ok(thermal(withHeatRate(DEFAULT_THERMAL, 9500)))
      const d = (1 - a.fuelKgH / b.fuelKgH) * 100
      return {
        answer: d < 5 ? 'lt5' : d <= 15 ? '5to15' : 'gt15',
        rows: [
          { label: 'Heat rate', unit: 'kJ/kWh', decimals: 0, before: b.heatRate, after: a.heatRate },
          { label: 'Station efficiency', unit: '%', decimals: 2, before: b.eta * 100, after: a.eta * 100 },
          { label: 'Fuel heat input', unit: 'MW', decimals: 1, before: b.qInMw, after: a.qInMw },
          { label: 'Coal burnt', unit: 't/h', decimals: 2, before: b.fuelKgH / 1000, after: a.fuelKgH / 1000 },
          { label: 'Heat to the condenser', unit: 'MW', decimals: 1, before: b.condenserMw, after: a.condenserMw },
        ],
        explain: [
          `Fuel per hour = P × HR / CV, so it is proportional to the heat rate: 9 500/10 500 = ${fx(a.heatRate / b.heatRate, 4)} — the coal falls ${fx(d, 2)} %, from ${fx(b.fuelKgH / 1000, 1)} to ${fx(a.fuelKgH / 1000, 1)} t/h.`,
          `The efficiency rises from ${fx(b.eta * 100, 2)} % to ${fx(a.eta * 100, 2)} % (η = 3600/HR). A ${fx(d, 1)} % saving of coal on every hour of every year is why stations chase heat rate.`,
          `Less heat in for the same output means less heat out: the condenser rejects ${fx(b.condenserMw - a.condenserMw, 0)} MW less.`,
        ],
      }
    },
  },
  {
    id: 'head',
    title: 'Double the head',
    change: 'A hydro turbine passes 100 m³/s at 50 m of head (overall efficiency 90 %). It is rebuilt at a site with 100 m of head, passing the same 100 m³/s at the same efficiency.',
    question: 'What happens to the power?',
    options: [
      { id: 'sqrt2', label: 'It rises about 1.4 times (√2)' },
      { id: 'x2', label: 'It doubles' },
      { id: 'x4', label: 'It rises four times' },
    ],
    run() {
      const b = hydroPowerW(100, 50, 0.9) / 1e6
      const a = hydroPowerW(100, 100, 0.9) / 1e6
      const ratio = a / b
      return {
        answer: nearest(ratio, [
          ['sqrt2', Math.SQRT2],
          ['x2', 2],
          ['x4', 4],
        ]),
        rows: [
          { label: 'Head H', unit: 'm', decimals: 0, before: 50, after: 100 },
          { label: 'Flow Q', unit: 'm³/s', decimals: 0, before: 100, after: 100 },
          { label: 'Power P = ρgQHη', unit: 'MW', decimals: 2, before: b, after: a },
          { label: 'Energy per m³ of water', unit: 'kWh', decimals: 4, before: (RHO_W * G * 50 * 0.9) / 3.6e6, after: (RHO_W * G * 100 * 0.9) / 3.6e6 },
        ],
        explain: [
          `P = ρgQHη is proportional to H at a fixed flow: ${fx(b, 1)} MW → ${fx(a, 1)} MW, × ${fx(ratio, 3)}.`,
          `Each cubic metre falls twice as far, so it gives up twice the energy. (Through a fixed opening the flow itself rises as √H, so the power would rise as H^1.5 — × ${fx(2 ** 1.5, 2)} for twice the head; here the flow is held fixed.)`,
        ],
      }
    },
  },
  {
    id: 'nuclear-coal',
    title: 'Nuclear or coal: the fuel for a day',
    change: `Two ${DEFAULT_NUCLEAR.pMw} MW stations run for one day: a nuclear one at ${fx(DEFAULT_NUCLEAR.etaTh * 100, 0)} % thermal efficiency and a coal one with a heat rate of 10 000 kJ/kWh burning coal of ${DEFAULT_THERMAL.cvKjKg.toLocaleString('en-GB')} kJ/kg.`,
    question: 'How many times more coal (by mass) does the coal station burn than the U-235 the nuclear station fissions?',
    options: [
      { id: 'e2', label: 'About a hundred times' },
      { id: 'e4', label: 'About ten thousand times' },
      { id: 'e6', label: 'Millions of times' },
    ],
    run() {
      const n = ok(nuclear(DEFAULT_NUCLEAR))
      const coalT = coalTonnesPerDay(DEFAULT_NUCLEAR.pMw, 10000, DEFAULT_THERMAL.cvKjKg)
      const ratio = (coalT * 1000) / n.kgPerDay
      return {
        answer: nearest(ratio, [
          ['e2', 1e2],
          ['e4', 1e4],
          ['e6', 3e6],
        ]),
        rows: [
          { label: 'Heat needed per day', unit: 'TJ', decimals: 1, before: (DEFAULT_NUCLEAR.pMw / etaFromHeatRate(10000)) * 0.0864, after: n.thermalMw * 0.0864 },
          { label: 'Fuel per day', unit: 'kg', decimals: 2, before: coalT * 1000, after: n.kgPerDay },
          { label: 'Energy per kg of fuel', unit: 'MJ/kg', decimals: 0, before: DEFAULT_THERMAL.cvKjKg / 1000, after: n.energyPerKgJ / 1e6 },
        ],
        cols: ['Coal', 'Nuclear (U-235 fissioned)'],
        explain: [
          `Coal: ${fx(DEFAULT_NUCLEAR.pMw, 0)} MW × 24 h × 10 000 kJ/kWh ÷ ${DEFAULT_THERMAL.cvKjKg.toLocaleString('en-GB')} kJ/kg = ${fx(coalT, 0)} t a day.`,
          `Nuclear: ${fx(n.thermalMw, 0)} MW of heat for a day is ${fx(n.thermalMw * 0.0864, 1)} TJ; at ${fx(n.energyPerKgJ / 1e12, 1)} TJ per kg fissioned that is ${fx(n.kgPerDay, 2)} kg — ${timesWords(ratio)} less by mass (${fx(ratio, 0)}).`,
          `Per atom: a fission releases about ${MEV_PER_FISSION} MeV, while burning one carbon atom to CO₂ releases ${fx(EV_PER_C, 2)} eV (393.5 kJ/mol) — ${timesWords((MEV_PER_FISSION * 1e6) / EV_PER_C)} more. (The reactor holds far more uranium than it fissions in a day, and its fuel is mostly U-238.)`,
        ],
      }
    },
  },
  {
    id: 'round-trip',
    title: 'Pumped storage: what comes back',
    change: `A pumped-storage scheme pumps 100 MWh of off-peak energy uphill. Motor ${fx(DEFAULT_PUMPED.etaMotor * 100, 0)} %, pump ${fx(DEFAULT_PUMPED.etaPump * 100, 0)} %, turbine ${fx(DEFAULT_PUMPED.etaTurbine * 100, 0)} %, generator ${fx(DEFAULT_PUMPED.etaGen * 100, 0)} %.`,
    question: 'How much energy does it give back at the peak?',
    options: [
      { id: '95', label: 'About 95 MWh' },
      { id: '78', label: 'About 78 MWh' },
      { id: '60', label: 'About 60 MWh' },
    ],
    run() {
      const r = ok(pumped({ ...DEFAULT_PUMPED, pMw: 100, hoursPumping: 1 }))
      return {
        answer: nearest(r.eOutMwh, [
          ['95', 95],
          ['78', 78],
          ['60', 60],
        ]),
        rows: [
          { label: 'Energy drawn from the grid', unit: 'MWh', decimals: 1, before: r.eInMwh, after: r.eInMwh },
          { label: 'Potential energy stored', unit: 'MWh', decimals: 2, before: r.eInMwh, after: r.storedMwh },
          { label: 'Energy returned', unit: 'MWh', decimals: 2, before: r.eInMwh, after: r.eOutMwh },
        ],
        cols: ['If lossless', 'Computed'],
        chain: r.chain,
        explain: [
          `η_rt = ${[DEFAULT_PUMPED.etaMotor, DEFAULT_PUMPED.etaPump, DEFAULT_PUMPED.etaTurbine, DEFAULT_PUMPED.etaGen].map((e) => fx(e, 2)).join(' × ')} = ${fx(r.etaRt, 4)}: ${fx(r.eOutMwh, 1)} MWh comes back.`,
          `Four machines each lose a little, and the losses multiply. Every stage looks efficient, yet ${fx(r.eInMwh - r.eOutMwh, 1)} MWh of every 100 is lost — so storing pays only when peak energy is worth more than ${fx(r.breakEven, 2)} × off-peak energy.`,
        ],
      }
    },
  },
  {
    id: 'redundancy',
    title: 'Add a redundant measurement',
    change: 'A state estimator uses three line-flow meters (1→2, 1→3 and 2→3) for two unknown angles. A fourth meter — the injection at bus 2 — is added. Meter accuracies are unchanged.',
    question: 'What happens to the uncertainty (standard deviation) of the estimated angle θ₂?',
    options: [
      { id: 'down', label: 'It falls' },
      { id: 'same', label: 'It stays the same' },
      { id: 'up', label: 'It rises — more meters, more errors' },
    ],
    run() {
      const b = estimate(labMeasurements(only(['P12', 'P13', 'P23'])))
      const a = estimate(labMeasurements(only(['P12', 'P13', 'P23', 'P2'])))
      if (!b.ok || !a.ok) throw new Error('unobservable')
      const defs = measDefs()
      const sb = [Math.sqrt(b.cov[0][0]) / DEG, Math.sqrt(b.cov[1][1]) / DEG]
      const sa = [Math.sqrt(a.cov[0][0]) / DEG, Math.sqrt(a.cov[1][1]) / DEG]
      const d = sa[0] - sb[0]
      return {
        answer: Math.abs(d) < 1e-9 ? 'same' : d < 0 ? 'down' : 'up',
        rows: [
          { label: 'Measurements m (unknowns n = 2)', unit: '', decimals: 0, before: 3, after: 4 },
          { label: 'Redundancy m − n', unit: '', decimals: 0, before: 1, after: 2 },
          { label: 'σ of θ̂₂', unit: '°', decimals: 4, before: sb[0], after: sa[0] },
          { label: 'σ of θ̂₃', unit: '°', decimals: 4, before: sb[1], after: sa[1] },
        ],
        explain: [
          `The covariance of the estimate is (HᵀWH)⁻¹. Adding a measurement adds a positive (semi-definite) term to HᵀWH, so its inverse can never grow: σ(θ̂₂) ${fx(sb[0], 4)}° → ${fx(sa[0], 4)}° (${fx((d / sb[0]) * 100, 1)} %).`,
          'More meters do add more errors — but independent errors partly cancel in a weighted average. This is the expected spread over many noise samples; a single sample can be luckier or unluckier.',
          `Redundancy also matters for bad data. With m − n = 1 an error can be detected but not located (every normalised residual comes out equal). More redundancy can locate it — unless the meter belongs to a critical pair: in this four-meter set ${
            a.pairs.length
              ? `${a.pairs.map(([x, y]) => `${defs[x].name} and ${defs[y].name}`).join('; ')} still cannot be told apart`
              : 'there is no critical pair, so a single large error on any meter can be located'
          }.`,
        ],
      }
    },
  },
  {
    id: 'bad-data',
    title: 'Inject a bad measurement',
    change: 'All six power meters are in use. The flow meter on line 2→3 develops a fault and reads 30 MW too high; the other meters have only their normal small errors.',
    question: 'Which measurement shows the largest normalised residual?',
    options: [
      { id: 'P23', label: 'Flow 2→3 — the faulty meter' },
      { id: 'P12', label: 'Flow 1→2 — the biggest flow' },
      { id: 'P2', label: 'Injection at bus 2 — next to the faulty line' },
      { id: 'none', label: 'None stands out: the estimator spreads the error evenly' },
    ],
    run() {
      const lab = { ...LAB0, bad: { id: 'P23' as MeasId, size: 30 } }
      const clean = estimate(labMeasurements(LAB0))
      const out = estimate(labMeasurements(lab))
      if (!out.ok || !clean.ok) throw new Error('unobservable')
      const defs = measDefs()
      const without = estimate(labMeasurements({ ...lab, enabled: { ...lab.enabled, P23: false } }))
      const top = out.largest
      const answer = top && out.flagged ? top.id : 'none'
      return {
        answer: ['P23', 'P12', 'P2'].includes(answer) ? answer : 'none',
        rows: out.meas.map((m) => ({ label: `r_N · ${defs[m.id].name}`, unit: '', decimals: 2, before: clean.meas.find((q) => q.id === m.id)?.rN ?? 0, after: m.rN ?? 0 })),
        cols: ['Normal meters', 'With the fault'],
        lab,
        explain: [
          `The largest normalised residual is ${top ? `${defs[top.id].name}, r_N = ${fx(top.rN, 2)}` : '—'} — above the threshold of 3, so it is flagged. J(x̂) = ${fx(out.J, 1)} against the χ² limit ${fx(out.chi2, 2)} (99 %, ${out.dof} degrees of freedom): bad data detected.`,
          `The raw residuals are spread over several meters (the estimate is pulled towards the wrong reading), but normalising each by its own expected spread √Ω_ii puts the faulty meter on top. The estimated flow on 2→3 is ${fx((out.meas.find((m) => m.id === 'P23')?.est ?? 0) * BASE_MVA, 1)} MW; the meter said ${fx((out.meas.find((m) => m.id === 'P23')?.z ?? 0) * BASE_MVA, 1)} MW.`,
          without.ok
            ? `Remove the flagged meter and estimate again: J = ${fx(without.J, 2)} against ${fx(without.chi2, 2)} (${without.dof} degrees of freedom) — ${without.detected ? 'still above the limit' : 'the remaining measurements are consistent'}, largest r_N ${fx(without.largest?.rN ?? 0, 2)}. (With only the three flow meters it could not be located — try it in Explore.)`
            : 'Without it the network would be unobservable.',
        ],
      }
    },
  },
]
