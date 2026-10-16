import { fx } from '../../ui/format.ts'
import type { Choice } from '../../ui/kit.tsx'
import { defaultDc, loopPerM, solveDc, type DcDistributor, type DcOk } from './distributor.ts'
import { annualCost, DEFAULT_PF, DEFAULT_TARIFF, economicPf, pfCorrection, type PfInput, type PfOk } from './pf.ts'
import { changeWords, placeWords, ratioWords } from './words.ts'

/**
 * Predict-first experiments: change one thing, then compare two computed results. The correct option is decided
 * from the computation (never written in advance) and every number in an explanation is read from it.
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
  dc?: { before: { d: DcDistributor; r: DcOk }; after: { d: DcDistributor; r: DcOk } }
  pf?: { before: { inp: PfInput; r: PfOk }; after: { inp: PfInput; r: PfOk } }
}
export interface Experiment {
  id: string
  title: string
  change: string
  question: string
  options: Choice[]
  cols: [string, string]
  run(): ExpResult
}

const dcRun = (d: DcDistributor) => {
  const r = solveDc(d)
  if (!r.ok) throw new Error(`experiment case invalid: ${r.message}`)
  return { d, r }
}
const pfRun = (inp: PfInput) => {
  const r = pfCorrection(inp)
  if (!r.ok) throw new Error(`experiment case invalid: ${r.message}`)
  return { inp, r }
}
const dropPct = (d: DcDistributor, r: DcOk) => ((d.VA - r.minV) / d.VA) * 100

/** Pick the option whose number is nearest to a computed value. */
const nearest = (v: number, opts: Array<[string, number]>) => opts.reduce((b, o) => (Math.abs(o[1] - v) < Math.abs(b[1] - v) ? o : b))[0]

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'both-ends',
    title: 'Feed the distributor from both ends',
    change: 'The 400 m two-wire distributor (four loads, 0.1 Ω/km per conductor, illustrative values) is fed at A only. Now end B is also connected to a 220 V supply.',
    question: 'Where is the lowest voltage now?',
    options: [
      { id: 'L4', label: 'Still at the last load, L4 (350 m)' },
      { id: 'L3', label: 'At load L3 (300 m)' },
      { id: 'L2', label: 'At load L2 (200 m)' },
      { id: 'L1', label: 'At load L1 (100 m)' },
    ],
    cols: ['Fed at A only', 'Fed at both ends'],
    run() {
      const b = dcRun(defaultDc('one'))
      const a = dcRun(defaultDc('both'))
      const answer = a.r.minIds[0] ?? 'L4'
      const s = a.r.sections
      const turn = s.findIndex((x) => x.Iin <= 0)
      return {
        answer,
        dc: { before: b, after: a },
        rows: [
          { label: 'Current fed at A', unit: 'A', decimals: 2, before: b.r.IA, after: a.r.IA },
          { label: 'Current fed at B', unit: 'A', decimals: 2, before: b.r.IB, after: a.r.IB },
          { label: 'Lowest voltage', unit: 'V', decimals: 2, before: b.r.minV, after: a.r.minV },
          { label: 'Largest drop', unit: '%', decimals: 2, before: dropPct(b.d, b.r), after: dropPct(a.d, a.r) },
          { label: 'Loss in the conductors', unit: 'W', decimals: 0, before: b.r.loss, after: a.r.loss },
        ],
        explain: [
          `By taking moments about B, end A now supplies I_A = Σ I·(L − x)/L = ${fx(a.r.IA, 2)} A and end B the remaining ${fx(a.r.IB, 2)} A of the ${fx(a.r.totalLoad, 0)} A.`,
          `Walking from A, the section current falls at each load: ${s.map((x) => fx(x.Iin, 2)).join(' → ')} A. It changes sign ${turn > 0 ? `after ${a.r.minIds.join(' + ')}` : 'at once'}: loads before that point are fed from A, loads after it from B. The point where the current reverses is the point of minimum potential — ${placeWords(a.r.minKind, a.r.minX, a.r.minIds, a.d.L)}, ${fx(a.r.minV, 2)} V.`,
          `The largest drop ${changeWords(dropPct(b.d, b.r), dropPct(a.d, a.r))} (${fx(dropPct(b.d, b.r), 2)} % → ${fx(dropPct(a.d, a.r), 2)} %), and the conductor loss ${changeWords(b.r.loss, a.r.loss)}: each load is now reached over a shorter path.`,
        ],
      }
    },
  },
  {
    id: 'far-load',
    title: 'One load near end B grows',
    change: 'The same distributor, fed at both ends at 220 V. Load L3 (300 m from A, 100 m from B) rises from 60 A to 120 A.',
    question: 'Which way does the point of minimum potential move?',
    options: [
      { id: 'A', label: 'Towards A' },
      { id: 'stays', label: 'It stays at the same load' },
      { id: 'B', label: 'Towards B (towards the heavier load)' },
    ],
    cols: ['L3 = 60 A', 'L3 = 120 A'],
    run() {
      const b = dcRun(defaultDc('both'))
      const base = defaultDc('both')
      const a = dcRun({ ...base, loads: base.loads.map((l) => (l.id === 'L3' ? { ...l, I: 120 } : l)) })
      const answer = Math.abs(a.r.minX - b.r.minX) < 1e-9 ? 'stays' : a.r.minX > b.r.minX ? 'B' : 'A'
      return {
        answer,
        dc: { before: b, after: a },
        rows: [
          { label: 'Current fed at A', unit: 'A', decimals: 2, before: b.r.IA, after: a.r.IA },
          { label: 'Current fed at B', unit: 'A', decimals: 2, before: b.r.IB, after: a.r.IB },
          { label: 'Minimum point from A', unit: 'm', decimals: 0, before: b.r.minX, after: a.r.minX },
          { label: 'Lowest voltage', unit: 'V', decimals: 2, before: b.r.minV, after: a.r.minV },
        ],
        explain: [
          `The extra 60 A at 300 m adds 60 × (400 − 300)/400 = ${fx((60 * 100) / 400, 2)} A to I_A and ${fx((60 * 300) / 400, 2)} A to I_B: B is nearer, so it takes the larger share — but A’s current rises too, from ${fx(b.r.IA, 2)} A to ${fx(a.r.IA, 2)} A.`,
          `With more current leaving A, it now reaches further before the loads use it up: the section currents are ${a.r.sections.map((x) => fx(x.Iin, 2)).join(' → ')} A. The minimum point ${answer === 'stays' ? 'stays' : `moves from ${fx(b.r.minX, 0)} m to ${fx(a.r.minX, 0)} m`} — ${placeWords(a.r.minKind, a.r.minX, a.r.minIds, a.d.L)}.`,
          `The lowest voltage ${changeWords(b.r.minV, a.r.minV, 2)} (${fx(b.r.minV, 2)} → ${fx(a.r.minV, 2)} V).`,
        ],
      }
    },
  },
  {
    id: 'uniform',
    title: 'Spread the load evenly',
    change: 'A 400 m distributor fed at A (0.1 Ω/km per conductor) supplies 200 A in total. Before: all 200 A taken at the far end. After: the same 200 A spread uniformly, 0.5 A per metre.',
    question: 'The drop with the uniform load, compared with the load at the far end, is…',
    options: [
      { id: 'quarter', label: 'one quarter' },
      { id: 'half', label: 'one half' },
      { id: 'same', label: 'the same — it is the same total current' },
      { id: 'double', label: 'twice as large' },
    ],
    cols: ['200 A at the far end', '0.5 A/m along 400 m'],
    run() {
      const base: DcDistributor = { L: 400, rCond: 0.1, VA: 220, VB: 220, feed: 'one', loads: [], i: 0 }
      const b = dcRun({ ...base, loads: [{ id: 'F', x: 400, I: 200 }] })
      const a = dcRun({ ...base, i: 0.5 })
      const ratio = (220 - a.r.minV) / (220 - b.r.minV)
      const answer = nearest(ratio, [
        ['quarter', 0.25],
        ['half', 0.5],
        ['same', 1],
        ['double', 2],
      ])
      const rl = loopPerM(0.1)
      return {
        answer,
        dc: { before: b, after: a },
        rows: [
          { label: 'Total load', unit: 'A', decimals: 0, before: b.r.totalLoad, after: a.r.totalLoad },
          { label: 'Drop at the far end', unit: 'V', decimals: 3, before: 220 - b.r.minV, after: 220 - a.r.minV },
          { label: 'Loss in the conductors', unit: 'W', decimals: 0, before: b.r.loss, after: a.r.loss },
        ],
        explain: [
          `All at the far end: the whole 200 A flows through the whole loop resistance, drop = I·r·L = 200 × ${fx(rl * 1000, 2)} Ω/km × 0.4 km = ${fx(220 - b.r.minV, 3)} V.`,
          `Spread uniformly: the current falls linearly from 200 A at A to 0 at B, so the average current along the line is half: drop = i·r·L²/2 = ${fx(220 - a.r.minV, 3)} V — the ratio is ${ratioWords(ratio)}. Equivalently, a uniform load acts like the whole load placed at the MIDDLE.`,
          `The loss ${changeWords(b.r.loss, a.r.loss)}: ∫ I² r dx with I falling linearly gives one third of I²rL.`,
        ],
      }
    },
  },
  {
    id: 'pf-current',
    title: 'Correct a factory’s PF from 0.7 to 0.95',
    change: 'A 200 kW load at 400 V, 0.7 lagging (illustrative). A capacitor bank raises its power factor to 0.95 lagging. The real power is unchanged.',
    question: 'By about how much does the line current fall?',
    options: [
      { id: '10', label: 'About 10 %' },
      { id: '26', label: 'About 26 %' },
      { id: '36', label: 'About 36 %' },
      { id: '50', label: 'About 50 %' },
    ],
    cols: ['pf 0.7 lagging', 'pf 0.95 lagging'],
    run() {
      const b = pfRun({ ...DEFAULT_PF, pf2: DEFAULT_PF.pf1 })
      const a = pfRun({ ...DEFAULT_PF, pf2: 0.95 })
      const fall = -a.r.dI * 100
      const answer = nearest(fall, [
        ['10', 10],
        ['26', 26],
        ['36', 36],
        ['50', 50],
      ])
      return {
        answer,
        pf: { before: b, after: a },
        rows: [
          { label: 'Real power P', unit: 'kW', decimals: 1, before: DEFAULT_PF.P, after: DEFAULT_PF.P },
          { label: 'Reactive power Q', unit: 'kVAr', decimals: 1, before: b.r.Q2, after: a.r.Q2 },
          { label: 'Apparent power S', unit: 'kVA', decimals: 1, before: b.r.S2, after: a.r.S2 },
          { label: 'Line current', unit: 'A', decimals: 1, before: b.r.I2, after: a.r.I2 },
          { label: 'Copper loss (relative, ∝ I²)', unit: '%', decimals: 1, before: 100, after: 100 * (a.r.I2 / b.r.I2) ** 2 },
        ],
        explain: [
          `For the same P at the same voltage, I = P/(√3·V·cos φ) is inversely proportional to the power factor: I₂/I₁ = 0.7/0.95 = ${fx(a.r.I2 / b.r.I2, 4)}. The current ${changeWords(b.r.I2, a.r.I2)} (${fx(b.r.I2, 1)} → ${fx(a.r.I2, 1)} A).`,
          `The bank supplies Q_c = P(tan φ₁ − tan φ₂) = ${fx(a.r.Qc, 1)} kVAr locally, so that reactive current no longer travels through the supply. Copper losses go as I², so they fall to ${fx(100 * (a.r.I2 / b.r.I2) ** 2, 1)} % of their old value.`,
        ],
      }
    },
  },
  {
    id: 'unity',
    title: 'Correct to unity, or to the economical PF?',
    change: `The same 200 kW load at 0.7 lagging. Illustrative tariff: maximum-demand charge x = ₹${DEFAULT_TARIFF.x} per kVA per year; capacitors cost y = ₹${DEFAULT_TARIFF.y} per kVAr per year.`,
    question: 'Which costs less per year — correcting to unity, or to the economical power factor?',
    options: [
      { id: 'unity', label: 'Unity — the kVA charge is then the smallest' },
      { id: 'econ', label: 'The economical power factor, below unity' },
      { id: 'same', label: 'They cost the same' },
    ],
    cols: ['Corrected to unity', 'Economical PF'],
    run() {
      const e = economicPf(DEFAULT_PF.pf1, DEFAULT_TARIFF)
      const b = pfRun({ ...DEFAULT_PF, pf2: 1 })
      const a = pfRun({ ...DEFAULT_PF, pf2: e.pf })
      const cb = annualCost(DEFAULT_PF.P, DEFAULT_PF.pf1, 1, DEFAULT_TARIFF)
      const ca = annualCost(DEFAULT_PF.P, DEFAULT_PF.pf1, e.pf, DEFAULT_TARIFF)
      const answer = Math.abs(cb.total - ca.total) < 0.5 ? 'same' : cb.total < ca.total ? 'unity' : 'econ'
      return {
        answer,
        pf: { before: b, after: a },
        rows: [
          { label: 'Final power factor', unit: '', decimals: 4, before: 1, after: e.pf },
          { label: 'Capacitor bank Q_c', unit: 'kVAr', decimals: 1, before: b.r.Qc, after: a.r.Qc },
          { label: 'Maximum demand S', unit: 'kVA', decimals: 1, before: b.r.S2, after: a.r.S2 },
          { label: 'kVA charge', unit: '₹/yr', decimals: 0, before: cb.kva, after: ca.kva },
          { label: 'Capacitor cost', unit: '₹/yr', decimals: 0, before: cb.cap, after: ca.cap },
          { label: 'Total', unit: '₹/yr', decimals: 0, before: cb.total, after: ca.total },
        ],
        explain: [
          `The economical point is where one more kVAr of capacitors saves exactly what it costs: sin φ₂ = y/x = ${DEFAULT_TARIFF.y}/${DEFAULT_TARIFF.x} = ${fx(e.ratio, 3)}, so cos φ₂ = ${fx(e.pf, 4)}.`,
          `Going on from ${fx(e.pf, 3)} to unity needs ${fx(b.r.Qc - a.r.Qc, 1)} kVAr more (₹${fx(cb.cap - ca.cap, 0)} a year) but lowers the maximum demand by only ${fx(a.r.S2 - b.r.S2, 1)} kVA (₹${fx(ca.kva - cb.kva, 0)} a year): near unity the kVA hardly falls, because S = P/cos φ is flat there. Unity costs ₹${fx(cb.total - ca.total, 0)} a year more.`,
        ],
      }
    },
  },
  {
    id: 'delta',
    title: 'Star or delta capacitor bank?',
    change: 'The same correction (200 kW, 0.7 → 0.95 lagging, 400 V, 50 Hz) with the capacitors connected in delta instead of star.',
    question: 'The capacitance needed per phase in delta, compared with star, is…',
    options: [
      { id: 'third', label: 'one third' },
      { id: 'root3', label: '1/√3 (about 0.577)' },
      { id: 'same', label: 'the same — the bank must give the same kVAr' },
      { id: 'triple', label: 'three times' },
    ],
    cols: ['Star', 'Delta'],
    run() {
      const s = pfRun(DEFAULT_PF)
      const ratio = s.r.Cdelta / s.r.Cstar
      const answer = nearest(ratio, [
        ['third', 1 / 3],
        ['root3', 1 / Math.sqrt(3)],
        ['same', 1],
        ['triple', 3],
      ])
      return {
        answer,
        pf: { before: s, after: s },
        rows: [
          { label: 'kVAr per phase', unit: 'kVAr', decimals: 2, before: s.r.Qc / 3, after: s.r.Qc / 3 },
          { label: 'Voltage across each capacitor', unit: 'V', decimals: 1, before: s.r.VcapStar, after: s.r.VcapDelta },
          { label: 'Capacitance per phase', unit: 'µF', decimals: 1, before: s.r.Cstar, after: s.r.Cdelta },
          { label: 'Current in each capacitor', unit: 'A', decimals: 1, before: s.r.IcapStar, after: s.r.IcapDelta },
        ],
        explain: [
          `Each phase must give Q_c/3 = ${fx(s.r.Qc / 3, 2)} kVAr = V_c²·ωC. In star each capacitor sees V_ph = ${fx(s.r.VcapStar, 1)} V; in delta it sees the full V_LL = ${fx(s.r.VcapDelta, 0)} V — √3 times more voltage, so 3 times the kVAr per µF.`,
          `So delta needs ${ratioWords(ratio)} of the star capacitance: ${fx(s.r.Cdelta, 1)} µF against ${fx(s.r.Cstar, 1)} µF per phase. The price: each delta capacitor must be rated for the line voltage.`,
        ],
      }
    },
  },
]
