import { fx } from '../../ui/format.ts'
import type { Choice } from '../../ui/kit.tsx'
import {
  analyse,
  arrivalRatio,
  firstPeak,
  makeField,
  margin,
  MEDIA,
  MODEL0,
  PU_KV,
  SEP0,
  separationFormula,
  separationRun,
  steadyState,
  timeSeries,
  type Analysis,
  type Field,
  type WaveModel,
} from './waves.ts'

/**
 * Predict-first experiments. Each run() solves the model; the right option is DECIDED from the computed numbers and
 * every number in an explanation is read from the computation.
 */

export interface ExpRow {
  label: string
  value: number
  unit: string
  decimals: number
}
export interface ExpSeries {
  id: string
  label: string
  color: string
  points: Array<[number, number]>
  dashed?: boolean
}
export interface ExpResult {
  answer: string
  rows: ExpRow[]
  explain: string[]
  plot: { series: ExpSeries[]; xLabel: string; yLabel: string; yUnit: string; hlines?: Array<{ y: number; label: string; tone?: 'warn' | 'bad' | 'muted' }> }
}
export interface Experiment {
  id: string
  title: string
  change: string
  question: string
  options: Choice[]
  run(): ExpResult
}

function solveModel(m: WaveModel): { an: Analysis; f: Field } {
  const an = analyse(m)
  if (!an.ok) throw new Error(`experiment model invalid: ${an.issues[0].message}`)
  return { an, f: makeField(an) }
}

/** The line every boundary experiment uses: 3 km of Module 8's twin-bundle line, a 1000 kV step, matched source. */
const base = (patch: Partial<WaveModel>): WaveModel => ({ ...MODEL0, rs: MEDIA['ohl-twin'].zc, surge: 'step', ekv: 1000, arrester: false, ...patch })
const ratioOption = (r: number, ids: Array<[string, number]>) => ids.reduce((best, cur) => (Math.abs(cur[1] - r) < Math.abs(best[1] - r) ? cur : best))[0]

function boundary(term: WaveModel['term']): ExpResult & { r: number; an: Analysis; f: Field } {
  const { an, f } = solveModel(base({ term }))
  const r = arrivalRatio(f)
  const inc = f.F(an.T / 2)
  const end = f.end(an.T * 1.5)
  return {
    r,
    an,
    f,
    answer: '',
    rows: [
      { label: 'Incident wave', value: inc, unit: 'kV', decimals: 1 },
      { label: 'Reflected wave', value: end.r, unit: 'kV', decimals: 1 },
      { label: 'Far-end voltage after arrival', value: end.v, unit: 'kV', decimals: 1 },
      { label: 'Far-end voltage ÷ incident wave', value: r, unit: '', decimals: 3 },
      { label: 'Incident current wave', value: (inc / an.zc) * 1000, unit: 'A', decimals: 0 },
      { label: 'Current at the far end', value: end.iLine, unit: 'A', decimals: 0 },
    ],
    explain: [],
    plot: {
      series: [
        { id: 'end', label: 'Far end v(ℓ, t)', color: 'var(--ps-a)', points: timeSeries(f, an.lengthM, 600) },
        { id: 'mid', label: 'Middle v(ℓ/2, t)', color: 'var(--ps-c)', points: timeSeries(f, an.lengthM / 2, 600), dashed: true },
      ],
      xLabel: 'Time t [µs]',
      yLabel: 'Voltage [kV]',
      yUnit: 'kV',
    },
  }
}

const ratioOptions: Choice[] = [
  { id: '0', label: '× 0 — the end voltage is zero' },
  { id: '1', label: '× 1 — the same as the incident wave' },
  { id: '2', label: '× 2 — double the incident wave' },
]
const RATIO_IDS: Array<[string, number]> = [
  ['0', 0],
  ['1', 1],
  ['2', 2],
]

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'open',
    title: 'A surge reaches an open end',
    change:
      'A 1000 kV step is launched into 3 km of Module 8’s 400 kV line from a matched source (R_s = Z_c, so nothing returns from the source end). The far end is open — like a disconnected line or an unloaded transformer seen by a fast surge.',
    question: 'When the wave reaches the open end, the voltage there is how many times the incident wave?',
    options: ratioOptions,
    run() {
      const b = boundary('open')
      const end = b.f.end(b.an.T * 1.5)
      return {
        ...b,
        answer: ratioOption(b.r, RATIO_IDS),
        explain: [
          `The incident wave is ${fx(end.a, 1)} kV. At the open end the voltage becomes ${fx(end.v, 1)} kV — ${fx(b.r, 3)} × the incident wave (Γ = +1).`,
          `Why: no current can flow out of an open end. The reflected current wave must cancel the incident one (${fx((end.a / b.an.zc) * 1000, 0)} A − ${fx((end.a / b.an.zc) * 1000, 0)} A = ${fx(end.iLine, 0)} A), and a current wave of −i travelling backwards carries a voltage of +Z_c·i: the reflected voltage adds to the incident voltage.`,
          'This is the doubling in the opening question: equipment at the end of a line, which takes almost no current from a fast surge, sees up to twice the arriving surge.',
        ],
      }
    },
  },
  {
    id: 'short',
    title: 'A surge reaches a short circuit',
    change: 'The same 1000 kV step and the same line, but the far end is connected solidly to earth.',
    question: 'When the wave reaches the short-circuited end, the voltage there is how many times the incident wave?',
    options: ratioOptions,
    run() {
      const b = boundary('short')
      const end = b.f.end(b.an.T * 1.5)
      const iInc = (end.a / b.an.zc) * 1000
      return {
        ...b,
        answer: ratioOption(b.r, RATIO_IDS),
        explain: [
          `The end voltage is ${fx(end.v, 1)} kV (× ${fx(b.r, 3)}): a short circuit forces v = 0, so the reflected voltage wave is the negative of the incident one (Γ = −1, reflected ${fx(end.r, 1)} kV).`,
          `The CURRENT doubles instead: the incident current wave is ${fx(iInc, 0)} A and the end current is ${fx(end.iLine, 0)} A (${fx(end.iLine / iInc, 3)} ×). Voltage and current swap roles between an open and a short end.`,
        ],
      }
    },
  },
  {
    id: 'matched',
    title: 'A surge reaches a matched resistor',
    change: `The far end is now a resistor equal to the line’s surge impedance, Z_L = Z_c = ${fx(MEDIA['ohl-twin'].zc, 1)} Ω.`,
    question: 'When the wave reaches the matched resistor, the voltage there is how many times the incident wave?',
    options: ratioOptions,
    run() {
      const b = boundary('matched')
      const end = b.f.end(b.an.T * 1.5)
      return {
        ...b,
        answer: ratioOption(b.r, RATIO_IDS),
        explain: [
          `The end voltage is ${fx(end.v, 1)} kV (× ${fx(b.r, 3)}) and the reflected wave is ${fx(end.r, 1)} kV: Γ = (Z_L − Z_c)/(Z_L + Z_c) = 0.`,
          `To the wave, a resistor of exactly Z_c looks like more of the same line: the ratio v/i of the wave (${fx(end.a, 1)} kV ÷ ${fx((end.a / b.an.zc) * 1000, 0)} A = ${fx(b.an.zc, 1)} Ω) is already what the resistor demands, so nothing needs to be sent back — all the energy is absorbed.`,
        ],
      }
    },
  },
  {
    id: 'cable',
    title: 'An overhead line runs into a cable',
    change: `The far end of the overhead line (Z_c = ${fx(MEDIA['ohl-twin'].zc, 1)} Ω) is joined to a long cable (Z_c = ${fx(MEDIA.cable.zc, 1)} Ω, typical values). The 1000 kV step arrives at the junction.`,
    question: 'Compared with the incident wave, the voltage wave transmitted into the cable is…',
    options: [
      { id: 'up', label: 'higher' },
      { id: 'same', label: 'the same' },
      { id: 'down', label: 'lower' },
    ],
    run() {
      const b = boundary('junction')
      const end = b.f.end(b.an.T * 1.5)
      const tau = end.v / end.a
      const answer = Math.abs(tau - 1) < 0.005 ? 'same' : tau > 1 ? 'up' : 'down'
      return {
        ...b,
        answer,
        rows: [
          { label: 'Incident wave (overhead line)', value: end.a, unit: 'kV', decimals: 1 },
          { label: 'Reflected wave (back along the line)', value: end.r, unit: 'kV', decimals: 1 },
          { label: 'Transmitted wave (into the cable)', value: end.v, unit: 'kV', decimals: 1 },
          { label: 'τ = transmitted ÷ incident', value: tau, unit: '', decimals: 4 },
          { label: 'Incident current', value: (end.a / b.an.zc) * 1000, unit: 'A', decimals: 0 },
          { label: 'Transmitted current (into the cable)', value: end.iLoad, unit: 'A', decimals: 0 },
        ],
        explain: [
          `τ = 2Z₂/(Z₁ + Z₂) = 2 × ${fx(b.an.zl, 1)} / (${fx(b.an.zc, 1)} + ${fx(b.an.zl, 1)}) = ${fx(tau, 4)}: ${fx(end.v, 1)} kV enters the cable, ${fx(Math.abs(1 - tau) * 100, 1)} % ${tau < 1 ? 'less' : 'more'} than the ${fx(end.a, 1)} kV that arrived.`,
          `The reflected wave is ${fx(end.r, 1)} kV (Γ = ${fx(b.an.gammaL, 4)}): it travels back and ${end.r < 0 ? 'lowers' : 'raises'} the voltage on the overhead line. The current does the opposite: ${fx(end.iLoad, 0)} A enters the cable, ${fx(end.iLoad / ((end.a / b.an.zc) * 1000), 3)} × the incident current.`,
          'A low-impedance cable therefore takes a lower surge voltage than the line feeding it — the reverse (a cable feeding an overhead line) raises it. Waves reflected inside a short cable section can build the voltage up again; this lab treats the cable as long.',
        ],
      }
    },
  },
  {
    id: 'separation',
    title: 'The arrester 30 m or 3 m from the transformer',
    change: `A steep surge (front ${SEP0.s} kV/µs, crest ${SEP0.ekv} kV) arrives at a substation. An arrester with a residual voltage of ${SEP0.vres} kV (illustrative) protects a transformer, which a fast surge sees as an open end. The arrester is mounted 30 m from the transformer — or moved to 3 m.`,
    question: 'How does the peak voltage at the transformer compare in the two cases?',
    options: [
      { id: 'same', label: 'The same in both — the arrester holds everything at its residual voltage' },
      { id: 'far-higher', label: 'Noticeably higher with the arrester 30 m away' },
      { id: 'far-lower', label: 'Lower with the arrester 30 m away' },
    ],
    run() {
      const v = MEDIA['ohl-twin'].v
      const zc = MEDIA['ohl-twin'].zc
      const c3 = { zc, v, dM: 3, s: SEP0.s, ekv: SEP0.ekv, vres: SEP0.vres }
      const c30 = { ...c3, dM: 30 }
      const r3 = separationRun(c3, 400, 40000, separationRun(c30).tEnd)
      const r30 = separationRun(c30)
      const f3 = separationFormula(c3)
      const f30 = separationFormula(c30)
      const diff = r30.vtMax - r3.vtMax
      const answer = Math.abs(diff) < 0.02 * SEP0.vres ? 'same' : diff > 0 ? 'far-higher' : 'far-lower'
      const toPts = (r: typeof r3): Array<[number, number]> => r.t.map((t, k) => [t, r.vt[k]] as [number, number]).filter((_, k) => k % 8 === 0)
      return {
        answer,
        rows: [
          { label: 'Arrester residual voltage V_res', value: SEP0.vres, unit: 'kV', decimals: 0 },
          { label: 'Transformer peak, arrester 3 m away', value: r3.vtMax, unit: 'kV', decimals: 1 },
          { label: 'Transformer peak, arrester 30 m away', value: r30.vtMax, unit: 'kV', decimals: 1 },
          { label: 'Rule V_res + 2Sd/v, 3 m', value: f3.value, unit: 'kV', decimals: 1 },
          { label: 'Rule V_res + 2Sd/v, 30 m', value: f30.value, unit: 'kV', decimals: 1 },
          { label: `Margin to an illustrative BIL of ${SEP0.bil} kV, 3 m`, value: margin(SEP0.bil, r3.vtMax) * 100, unit: '%', decimals: 1 },
          { label: `Margin to an illustrative BIL of ${SEP0.bil} kV, 30 m`, value: margin(SEP0.bil, r30.vtMax) * 100, unit: '%', decimals: 1 },
        ],
        explain: [
          `The arrester holds ITS OWN terminal at ${SEP0.vres} kV. The transformer is a further distance d away: the wave passes the arrester before it operates, doubles at the transformer, and the arrester’s relief only arrives 2d/v later. Meanwhile the front keeps rising at S = ${SEP0.s} kV/µs.`,
          `Simulated transformer peak: ${fx(r3.vtMax, 1)} kV at 3 m, ${fx(r30.vtMax, 1)} kV at 30 m — ${fx(diff, 1)} kV more. The rule V_res + 2Sd/v gives ${fx(f3.value, 1)} and ${fx(f30.value, 1)} kV (${f30.valid ? 'its assumptions hold here' : 'its assumptions do not hold here'}).`,
          `Against an illustrative BIL of ${SEP0.bil} kV the margin falls from ${fx(margin(SEP0.bil, r3.vtMax) * 100, 1)} % to ${fx(margin(SEP0.bil, r30.vtMax) * 100, 1)} %: arresters are mounted as close as possible to what they protect.`,
        ],
        plot: {
          series: [
            { id: 'd3', label: 'Transformer, arrester 3 m away', color: 'var(--ps-c)', points: toPts(r3) },
            { id: 'd30', label: 'Transformer, arrester 30 m away', color: 'var(--ps-a)', points: toPts(r30) },
          ],
          xLabel: 'Time after the wave reaches the arrester [µs]',
          yLabel: 'Voltage [kV]',
          yUnit: 'kV',
          hlines: [
            { y: SEP0.vres, label: `V_res ${SEP0.vres} kV`, tone: 'warn' },
            { y: SEP0.bil, label: `BIL ${SEP0.bil} kV (illustrative)`, tone: 'bad' },
          ],
        },
      }
    },
  },
  {
    id: 'energise',
    title: 'Switch on an open-ended line',
    change: `A breaker connects a 20 km unloaded (open-ended) 400 kV line to a strong source (R_s = 10 Ω) at the instant the source voltage is at its peak, 1 pu = ${fx(PU_KV, 1)} kV. Over the few hundred microseconds shown the 50 Hz source hardly changes, so it is taken as a step.`,
    question: 'What is the highest voltage reached at the open end, in per unit of the source peak?',
    options: [
      { id: 'one', label: 'About 1 pu — the line just charges to the source voltage' },
      { id: 'onehalf', label: 'About 1.5 pu' },
      { id: 'two', label: 'Close to 2 pu' },
      { id: 'three', label: '3 pu or more' },
    ],
    run() {
      const { an, f } = solveModel({ ...MODEL0, surge: 'switching', term: 'open', rs: 10, lengthKm: 20, arrester: false })
      const pk = firstPeak(f, an.lengthM)
      const pu = pk.v / PU_KV
      const answer = pu < 1.25 ? 'one' : pu < 1.75 ? 'onehalf' : pu < 2.5 ? 'two' : 'three'
      const wSrc = 2 * Math.PI * 50 * an.window * 1e-6
      const ss = steadyState(an)
      const ssPu = ss.kind === 'value' ? ss.v / PU_KV : NaN
      return {
        answer,
        rows: [
          { label: 'Launched wave k·E = Z_c/(R_s + Z_c)·1 pu', value: (an.k * PU_KV) / PU_KV, unit: 'pu', decimals: 4 },
          { label: 'Γ at the source end', value: an.gammaS, unit: '', decimals: 4 },
          { label: 'Peak at the open end (first arrival)', value: pu, unit: 'pu', decimals: 4 },
          { label: 'Time of the peak', value: pk.t, unit: 'µs', decimals: 1 },
          { label: 'Steady state (closed form)', value: ssPu, unit: 'pu', decimals: 3 },
        ],
        explain: [
          `The breaker launches a wave of ${fx(an.k, 4)} pu (Z_c/(R_s + Z_c)). At the open end it doubles: ${fx(pu, 4)} pu after ${fx(pk.t, 1)} µs.`,
          an.gammaS < 0
            ? `The reflection returns to the source, where Γ_s = ${fx(an.gammaS, 4)} sends back a negative wave, so the end voltage rings around ${fx(ssPu, 3)} pu and settles there (the DC steady state of an open line is the source voltage). With Γ_s < 0 each round trip overshoots less, so the first peak is the highest.`
            : `The reflection returns to the source, where Γ_s = ${fx(an.gammaS, 4)} sends it back with the same sign, so the end voltage climbs towards ${fx(ssPu, 3)} pu without overshooting further.`,
          `This is the lossless single-mode value. Real energisation differs: losses, corona, closing resistors and controlled switching lower it, while trapped charge on reclosing, source inductance and unequal pole closing can raise it, even above 2 pu. And the 50 Hz source moves: cos(ωt) changes by ${fx((1 - Math.cos(wSrc)) * 100, 2)} % over the ${fx(an.window, 0)} µs shown.`,
        ],
        plot: {
          series: [
            { id: 'end', label: 'Open end [pu]', color: 'var(--ps-a)', points: timeSeries(f, an.lengthM, 600).map(([t, v]) => [t, v / PU_KV] as [number, number]) },
            { id: 'mid', label: 'Middle of the line [pu]', color: 'var(--ps-c)', points: timeSeries(f, an.lengthM / 2, 600).map(([t, v]) => [t, v / PU_KV] as [number, number]), dashed: true },
          ],
          xLabel: 'Time t [µs]',
          yLabel: 'Voltage [pu]',
          yUnit: 'pu',
          hlines: [{ y: 1, label: 'steady state 1 pu', tone: 'muted' }],
        },
      }
    },
  },
]
