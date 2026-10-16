import { fx } from '../../ui/format.ts'
import type { Choice } from '../../ui/kit.tsx'
import { airDensity, computeCorona, computeSpan, computeString, diffWords, pctText, type CoronaResult, type SpanInput, type SpanResult, type StringResult } from './calc.ts'
import { DESIGN0, toCoronaInput, toSpanInput } from './model.ts'

/**
 * What-if experiments: change one thing, predict, then compare the computed before and after. The correct answer is
 * decided from the computation (never written in advance) and every number in an explanation is read from it.
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
  spans?: { before: SpanResult; after: SpanResult }
  strings?: { before: StringResult; after: StringResult }
  corona?: { before: CoronaResult; after: CoronaResult }
}
export interface Experiment {
  id: string
  title: string
  change: string
  question: string
  options: Choice[]
  run(): ExpResult
}

export const BASE_SPAN: SpanInput = toSpanInput(DESIGN0.span)

function span(s: Partial<SpanInput>): SpanResult {
  const r = computeSpan({ ...BASE_SPAN, ...s })
  if (!r.ok) throw new Error(`experiment span invalid: ${r.issues[0].message}`)
  return r
}
function str(n: number, m: number, kv = 66): StringResult {
  const r = computeString({ n, m, kv, grading: 'none' })
  if (!r.ok) throw new Error('experiment string invalid')
  return r
}
function cor(b: number, t: number): CoronaResult {
  const r = computeCorona({ ...toCoronaInput(DESIGN0), b, t })
  if (!r.ok) throw new Error('experiment corona invalid')
  return r
}
const signed = (x: number, d = 1) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${fx(Math.abs(x), d)}`
const pct = (a: number, b: number) => ((a - b) / b) * 100
const kN = (n: number) => n / 1000

const spanRows = (b: SpanResult, a: SpanResult): ExpRow[] => [
  { label: 'Sag, catenary (vertical)', unit: 'm', decimals: 3, before: b.vSagA, after: a.vSagA },
  { label: 'Sag, parabola wL²/8T₀ (in the load plane)', unit: 'm', decimals: 3, before: b.par.Slevel, after: a.par.Slevel },
  { label: 'Tension at the supports', unit: 'kN', decimals: 3, before: kN(b.Tmax), after: kN(a.Tmax) },
  { label: 'Ground clearance', unit: 'm', decimals: 2, before: b.clearance, after: a.clearance },
  { label: 'Conductor length', unit: 'm', decimals: 3, before: b.cat.length, after: a.cat.length },
]

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'span',
    title: 'Double the span',
    change: `A level span of 200 m (T₀ = ${fx(BASE_SPAN.T0 / 1000, 0)} kN, a ${fx(BASE_SPAN.w, 1)} N/m conductor) is rebuilt with its towers 400 m apart (same heights, same conductor). The tension at the lowest point stays the same.`,
    question: 'How many times bigger does the sag get?',
    options: [
      { id: 'x2', label: 'About 2 times' },
      { id: 'x4', label: 'About 4 times' },
      { id: 'x8', label: 'About 8 times' },
      { id: 'same', label: 'It stays the same — the tension did not change' },
    ],
    run() {
      const b = span({ L: 200 })
      const a = span({ L: 400 })
      const ratio = a.cat.SB / b.cat.SB
      const parRatio = a.par.Slevel / b.par.Slevel
      const cands: Array<[string, number]> = [
        ['same', 1],
        ['x2', 2],
        ['x4', 4],
        ['x8', 8],
      ]
      const answer = cands.reduce((best, c) => (Math.abs(Math.log(ratio / c[1])) < Math.abs(Math.log(ratio / best[1])) ? c : best))[0]
      return {
        answer,
        rows: [...spanRows(b, a), { label: 'Sag ratio after ÷ before', unit: '', decimals: 4, before: 1, after: ratio }],
        spans: { before: b, after: a },
        explain: [
          `The sag goes from ${fx(b.cat.SB, 3)} m to ${fx(a.cat.SB, 3)} m — ${fx(ratio, 3)} times. The parabola S = wL²/(8T₀) says exactly (400/200)² = ${fx(parRatio, 2)}: sag grows with the SQUARE of the span.`,
          `Why the square: twice the span carries twice the weight, and that weight hangs over twice the distance, so the "lever" doubles too. Holding the same T₀ then needs four times the dip.`,
          `The catenary's ratio is ${fx(ratio, 4)}, a little above 4: the deeper the sag, the more the parabola underestimates it (here by ${pctText(Math.abs(b.relDiff) * 100)} % at 200 m and ${pctText(Math.abs(a.relDiff) * 100)} % at 400 m). The support tension rises from ${fx(kN(b.Tmax), 3)} to ${fx(kN(a.Tmax), 3)} kN (T = T₀ + wS).`,
        ],
      }
    },
  },
  {
    id: 'ice',
    title: 'Add ice to the conductor',
    change: `The ${fx(BASE_SPAN.L, 0)} m level span (T₀ held at ${fx(BASE_SPAN.T0 / 1000, 0)} kN, the textbook approach) gets a 10 mm radial layer of ice (ρ = 915 kg/m³, a typical value).`,
    question: 'What happens to the sag and to the tension at the supports?',
    options: [
      { id: 'both', label: 'The sag rises and the support tension rises too' },
      { id: 'sag-only', label: 'The sag rises; the support tension does not change' },
      { id: 'none', label: 'Nothing changes — ice does not pull on the tension' },
      { id: 'down', label: 'The sag falls (the ice stiffens the conductor)' },
    ],
    run() {
      const b = span({})
      const a = span({ iceT: 0.01 })
      const sagUp = a.vSagA > b.vSagA * (1 + 1e-9)
      const sagDown = a.vSagA < b.vSagA * (1 - 1e-9)
      const tUp = a.Tmax > b.Tmax * (1 + 1e-9)
      const answer = sagDown ? 'down' : sagUp && tUp ? 'both' : sagUp ? 'sag-only' : 'none'
      return {
        answer,
        rows: [{ label: 'Vertical load w + w_i', unit: 'N/m', decimals: 2, before: b.loads.wv, after: a.loads.wv }, ...spanRows(b, a)],
        spans: { before: b, after: a },
        explain: [
          `Ice adds w_i = ρ·g·π·t(d + t) = ${fx(a.loads.wi, 2)} N/m to the ${fx(b.loads.w, 2)} N/m conductor: the load becomes ${fx(a.loads.wv / b.loads.w, 2)} times heavier, and with T₀ fixed the parabola S = wL²/(8T₀) grows by exactly that factor; the catenary sag goes ${fx(b.vSagA, 3)} → ${fx(a.vSagA, 3)} m (${fx(a.vSagA / b.vSagA, 3)} times).`,
          `The support tension T = T₀ + wS rises from ${fx(kN(b.Tmax), 3)} to ${fx(kN(a.Tmax), 3)} kN (${signed(pct(a.Tmax, b.Tmax), 2)} %) — a ${diffWords((a.Tmax - b.Tmax) / b.Tmax).replace(/ \(.*/, '')} change, because T₀ is held.`,
          `In a real line the conductor's LENGTH is fixed when it is strung, so ice also stretches it and raises T₀ — the sag rises by less and the tension by more. That "change of state" calculation (with the conductor's elasticity and temperature) is not modelled here; designers check the worst case — ice and wind — against the breaking strength.`,
        ],
      }
    },
  },
  {
    id: 'wind',
    title: 'Let the wind blow',
    change: `A wind pressure of 400 N/m² (an illustrative design value) acts across the ${fx(BASE_SPAN.L, 0)} m level span (no ice, T₀ held).`,
    question: 'The conductor swings sideways. What happens to its VERTICAL sag (the drop that sets the ground clearance)?',
    options: [
      { id: 'more', label: 'It rises noticeably (more than 2 %)' },
      { id: 'same', label: 'It stays practically the same (within 2 %)' },
      { id: 'less', label: 'It falls noticeably — the conductor is blown upwards' },
    ],
    run() {
      const b = span({})
      const a = span({ windP: 400 })
      const d = pct(a.vSagA, b.vSagA)
      const answer = d > 2 ? 'more' : d < -2 ? 'less' : 'same'
      const deg = (a.loads.theta * 180) / Math.PI
      return {
        answer,
        rows: [
          { label: 'Resultant load w_r', unit: 'N/m', decimals: 2, before: b.loads.wr, after: a.loads.wr },
          { label: 'Swing angle θ', unit: '°', decimals: 1, before: 0, after: deg },
          { label: 'Sag in the plane of the load', unit: 'm', decimals: 3, before: b.cat.SB, after: a.cat.SB },
          { label: 'Vertical sag S·cos θ', unit: 'm', decimals: 3, before: b.vSagA, after: a.vSagA },
          { label: 'Sideways swing S·sin θ', unit: 'm', decimals: 3, before: 0, after: a.low.z },
          { label: 'Tension at the supports', unit: 'kN', decimals: 3, before: kN(b.Tmax), after: kN(a.Tmax) },
        ],
        spans: { before: b, after: a },
        explain: [
          `The wind adds a horizontal load w_w = p·d = ${fx(a.loads.ww, 2)} N/m. The resultant ${fx(a.loads.wr, 2)} N/m is tilted θ = ${fx(deg, 1)}° from the vertical, and the conductor hangs in that tilted plane: its sag there grows to ${fx(a.cat.SB, 3)} m.`,
          `But the vertical part of that sag is S·cos θ = ${fx(a.vSagA, 3)} m against ${fx(b.vSagA, 3)} m without wind (${signed(d, 2)} %). With the parabola it is exactly unchanged: S·cos θ = (w_r L²/8T₀)·(w/w_r) = wL²/8T₀. The catenary's difference, ${diffWords((a.vSagA - b.vSagA) / b.vSagA)}, is its extra depth for the larger load.`,
          `What the wind does change: the conductor moves ${fx(a.low.z, 2)} m sideways at mid-span (clearance to the tower, trees and buildings beside the line) and the support tension rises ${signed(pct(a.Tmax, b.Tmax), 2)} %.`,
        ],
      }
    },
  },
  {
    id: 'discs',
    title: 'Use more discs in the string',
    change: 'A 66 kV insulator string (m = 0.1) is lengthened from 4 to 8 discs.',
    question: 'What happens to the string efficiency?',
    options: [
      { id: 'up', label: 'It rises — more discs share the voltage' },
      { id: 'down', label: 'It falls' },
      { id: 'same', label: 'It stays the same' },
    ],
    run() {
      const b = str(4, 0.1)
      const a = str(8, 0.1)
      const answer = Math.abs(a.eff - b.eff) < 1e-6 ? 'same' : a.eff > b.eff ? 'up' : 'down'
      const lb = b.discV[b.input.n - 1]
      const la = a.discV[a.input.n - 1]
      return {
        answer,
        rows: [
          { label: 'Discs', unit: '', decimals: 0, before: 4, after: 8 },
          { label: 'Voltage on the line-end disc', unit: 'kV', decimals: 2, before: lb, after: la },
          { label: 'Line-end disc share of V', unit: '%', decimals: 1, before: (lb / b.V) * 100, after: (la / a.V) * 100 },
          { label: 'Equal share V/n', unit: 'kV', decimals: 2, before: b.V / 4, after: a.V / 8 },
          { label: 'String efficiency', unit: '%', decimals: 1, before: b.eff * 100, after: a.eff * 100 },
        ],
        strings: { before: b, after: a },
        explain: [
          `The line-end disc's voltage does fall, ${fx(lb, 2)} → ${fx(la, 2)} kV — but not in proportion. With 8 discs a fair share would be ${fx(a.V / 8, 2)} kV; it carries ${fx(la / (a.V / 8), 2)} times that.`,
          `Efficiency η = V/(n·V_max) = ${fx(b.eff * 100, 1)} % → ${fx(a.eff * 100, 1)} %. Every extra link adds another shunt path to the tower, and all of those charging currents flow through the discs nearest the line, so the distribution gets more uneven as the string grows.`,
          'This is why very long strings (EHV) need grading rings: adding discs alone gives diminishing returns.',
        ],
      }
    },
  },
  {
    id: 'm',
    title: 'Bring the tower closer (larger m)',
    change: 'A 5-disc string has m = C_shunt/C_disc = 0.05; a shorter cross-arm brings the steel closer and m rises to 0.2.',
    question: 'How does the share of the line-end disc change?',
    options: [
      { id: 'worse', label: 'It rises — the distribution gets more uneven' },
      { id: 'better', label: 'It falls — the distribution gets more even' },
      { id: 'same', label: 'It does not change: m only affects the top disc' },
    ],
    run() {
      const b = str(5, 0.05)
      const a = str(5, 0.2)
      const sb = b.discV[4] / b.V
      const sa = a.discV[4] / a.V
      const answer = Math.abs(sa - sb) < 1e-9 ? 'same' : sa > sb ? 'worse' : 'better'
      return {
        answer,
        rows: [
          ...b.discV.map((v, k) => ({ label: `Disc ${k + 1}${k === 0 ? ' (cross-arm)' : k === 4 ? ' (line)' : ''}`, unit: 'kV', decimals: 2, before: v, after: a.discV[k] })),
          { label: 'String efficiency', unit: '%', decimals: 1, before: b.eff * 100, after: a.eff * 100 },
        ],
        strings: { before: b, after: a },
        explain: [
          `The line-end disc's share rises from ${fx(sb * 100, 1)} % to ${fx(sa * 100, 1)} % of the phase voltage, and the efficiency falls from ${fx(b.eff * 100, 1)} % to ${fx(a.eff * 100, 1)} %.`,
          "m is the ratio of each link's capacitance to the tower to a disc's own capacitance. A larger m sends more of the charging current sideways to the tower at each link; all of it must come through the discs below, so the lower discs carry more current — and more voltage.",
          'The remedy is a longer cross-arm (smaller m) — limited by the tower’s cost and strength — or grading.',
        ],
      }
    },
  },
  {
    id: 'altitude',
    title: 'Build the line high up',
    change: `The same ${fx(DESIGN0.string.kv, 0)} kV line is built at a high site where the air pressure is 60 cmHg instead of 76 cmHg (temperature 25 °C in both cases).`,
    question: 'What happens to the voltage at which corona starts (V_c)?',
    options: [
      { id: 'lower', label: 'It falls: corona starts at a lower voltage' },
      { id: 'higher', label: 'It rises: thinner air insulates better' },
      { id: 'same', label: 'It does not change: V_c depends only on the conductor' },
    ],
    run() {
      const b = cor(76, 25)
      const a = cor(60, 25)
      const answer = Math.abs(a.vc - b.vc) < 1e-9 ? 'same' : a.vc < b.vc ? 'lower' : 'higher'
      return {
        answer,
        rows: [
          { label: 'Air density factor δ', unit: '', decimals: 4, before: b.delta, after: a.delta },
          { label: 'Breakdown gradient m₀g₀δ', unit: 'kV/cm', decimals: 2, before: b.gCritical, after: a.gCritical },
          { label: 'V_c (phase, rms)', unit: 'kV', decimals: 1, before: b.vc, after: a.vc },
          { label: 'V_c (line-to-line)', unit: 'kV', decimals: 1, before: b.vcLine, after: a.vcLine },
          { label: 'Visual critical V_v (phase)', unit: 'kV', decimals: 1, before: b.vv, after: a.vv },
        ],
        corona: { before: b, after: a },
        explain: [
          `δ = (b/76)·(298/(273 + t)) (≈ 3.92·b/(273 + t)) falls from ${fx(b.delta, 4)} to ${fx(airDensity(60, 25), 4)}: thinner air. Its molecules are further apart, so a free electron travels further between collisions and gains more energy — it ionises the air at a LOWER field.`,
          `V_c = m₀·g₀·δ·r·ln(D/r) is proportional to δ: ${fx(b.vc, 1)} → ${fx(a.vc, 1)} kV per phase (${signed(pct(a.vc, b.vc), 1)} %). Hot weather (higher t) lowers δ the same way.`,
          'Rain, fog and dirt act differently: drops and particles on the surface distort the field like irregularities. In Peek’s formula that is represented by a lower irregularity factor m₀, which also lowers V_c (not a separate rain model here).',
        ],
      }
    },
  },
]
