import { fx } from '../../ui/format.ts'
import type { Choice } from '../../ui/kit.tsx'
import type { PlotSeries } from '../../ui/Plot.tsx'
import {
  capacitanceGraded,
  changeWords,
  compareWithLine,
  computeCable,
  DEFAULT_CABLE,
  equalPeakRadii,
  gMaxFixedSheath,
  pct,
  profile,
  timesWords,
  type CableInput,
  type CableResult,
  gradedProfile,
} from './calc.ts'

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
export interface ExpPlot {
  series: PlotSeries[]
  xLabel: string
  yLabel: string
  label: string
  vlines?: Array<{ x: number; label: string }>
}
export interface ExpResult {
  answer: string
  rows: ExpRow[]
  /** Column headings for the two cases (default: Before, After). */
  columns?: [string, string]
  explain: string[]
  plot?: ExpPlot
}
export interface Experiment {
  id: string
  title: string
  change: string
  question: string
  options: Choice[]
  run(): ExpResult
}

function solve(c: Partial<CableInput>): CableResult {
  const r = computeCable({ ...DEFAULT_CABLE, ...c })
  if (!r.ok) throw new Error(`experiment cable invalid: ${r.issues[0].message}`)
  return r
}
const signed = (x: number, d = 1) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${fx(Math.abs(x), d)}`

const fieldRows = (b: CableResult, a: CableResult): ExpRow[] => [
  { label: 'Insulation thickness R − r', unit: 'mm', decimals: 1, before: b.thicknessMm, after: a.thicknessMm },
  { label: 'ln(R/r)', unit: '', decimals: 4, before: b.ln, after: a.ln },
  { label: 'Maximum stress g_max (at the conductor)', unit: 'kV/cm', decimals: 2, before: b.gMax, after: a.gMax },
  { label: 'Minimum stress g_min (at the sheath)', unit: 'kV/cm', decimals: 2, before: b.gMin, after: a.gMin },
  { label: 'Capacitance', unit: 'µF/km', decimals: 4, before: b.cUfKm, after: a.cUfKm },
]
const gSeries = (res: CableResult, id: string, label: string, color: string, dashed = false): PlotSeries => ({ id, label, color, points: profile(res, 60).g, dashed })

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'thickness',
    title: 'Double the insulation thickness',
    change: `A cable with a 10 mm conductor radius and 10 mm of insulation (R = 20 mm) at ${DEFAULT_CABLE.vKv} kV core-to-sheath is rebuilt with 20 mm of insulation (R = 30 mm). Nothing else changes.`,
    question: 'What happens to the maximum stress g_max at the conductor surface?',
    options: [
      { id: 'half', label: 'It halves — twice the thickness, half the stress' },
      { id: 'less', label: 'It falls, but by clearly less than half' },
      { id: 'more', label: 'It falls by more than half' },
      { id: 'same', label: 'It does not change' },
    ],
    run() {
      const b = solve({ rMm: 10, RMm: 20 })
      const a = solve({ rMm: 10, RMm: 30 })
      const ratio = a.gMax / b.gMax
      const answer = ratio < 0.48 ? 'more' : ratio <= 0.52 ? 'half' : ratio < 0.999 ? 'less' : 'same'
      return {
        answer,
        rows: fieldRows(b, a),
        plot: {
          series: [gSeries(b, 'b', 'R = 20 mm', 'var(--text-3)', true), gSeries(a, 'a', 'R = 30 mm', 'var(--ps-c)')],
          xLabel: 'Radius x [mm]',
          yLabel: 'g [kV/cm]',
          label: 'Stress across the insulation before and after doubling its thickness',
        },
        explain: [
          `g_max = V / (r · ln(R/r)) — the thickness enters only through the logarithm. ln(20/10) = ${fx(b.ln, 4)} becomes ln(30/10) = ${fx(a.ln, 4)}, so g_max ${changeWords(a.gMax, b.gMax)}: ${fx(b.gMax, 2)} → ${fx(a.gMax, 2)} kV/cm (×${fx(ratio, 3)}), not ×0.5.`,
          `Why: the extra insulation is added on the outside, where the field is weakest (${fx(b.gMin, 2)} kV/cm at 20 mm, against ${fx(b.gMax, 2)} kV/cm at the conductor). The flux density at the conductor depends on the charge, which falls only as 1/ln(R/r).`,
          `So adding thickness is an expensive way to lower the stress at the conductor — the capacitance ${changeWords(a.cUfKm, b.cUfKm)} too. The other levers are the conductor size (next experiment) and grading.`,
        ],
      }
    },
  },
  {
    id: 'conductor',
    title: 'A bigger conductor in the same sheath',
    change: `The sheath stays at R = 25 mm and the voltage at ${DEFAULT_CABLE.vKv} kV. The conductor radius is increased step by step from 4 mm to 20 mm (the insulation gets thinner as the conductor grows).`,
    question: 'How does the maximum stress g_max change as the conductor grows?',
    options: [
      { id: 'down', label: 'It falls steadily — a fatter conductor has a gentler surface' },
      { id: 'up', label: 'It rises steadily — the insulation gets thinner' },
      { id: 'dip', label: 'It first falls, then rises: there is a best conductor size' },
      { id: 'same', label: 'It stays the same' },
    ],
    run() {
      const R = 2.5
      const rs = Array.from({ length: 81 }, (_, k) => 0.4 + (k / 80) * 1.6)
      const gs = rs.map((r) => gMaxFixedSheath(DEFAULT_CABLE.vKv, r, R))
      const kmin = gs.indexOf(Math.min(...gs))
      const first = gs[0]
      const last = gs[gs.length - 1]
      const answer = kmin > 0 && kmin < gs.length - 1 ? 'dip' : last < first ? 'down' : last > first ? 'up' : 'same'
      const rOpt = R / Math.E
      const gOpt = gMaxFixedSheath(DEFAULT_CABLE.vKv, rOpt, R)
      const b = solve({ rMm: 4, RMm: 25 })
      const a = solve({ rMm: 20, RMm: 25 })
      return {
        answer,
        columns: ['r = 4 mm', 'r = 20 mm'],
        rows: [
          { label: 'Conductor radius r', unit: 'mm', decimals: 1, before: 4, after: 20 },
          { label: 'ln(R/r)', unit: '', decimals: 4, before: b.ln, after: a.ln },
          { label: 'g_max', unit: 'kV/cm', decimals: 2, before: b.gMax, after: a.gMax },
          { label: 'Capacitance', unit: 'µF/km', decimals: 4, before: b.cUfKm, after: a.cUfKm },
        ],
        plot: {
          series: [{ id: 'g', label: 'g_max', color: 'var(--ps-a)', points: rs.map((r, k) => [r * 10, gs[k]] as [number, number]) }],
          xLabel: 'Conductor radius r [mm] (sheath fixed at 25 mm)',
          yLabel: 'g_max [kV/cm]',
          label: 'Maximum stress against conductor radius for a fixed sheath radius',
          vlines: [{ x: rOpt * 10, label: `r = R/e = ${fx(rOpt * 10, 1)} mm` }],
        },
        explain: [
          `g_max = V / (r · ln(R/r)) has two factors that pull opposite ways: a bigger r makes the surface less curved (r ↑), but leaves less insulation (ln(R/r) ↓). From r = 4 mm to the lowest point g_max falls from ${fx(first, 2)} to ${fx(gOpt, 2)} kV/cm, then rises to ${fx(last, 2)} kV/cm at r = 20 mm.`,
          `The lowest g_max is where r·ln(R/r) is largest: d/dr[r ln(R/r)] = ln(R/r) − 1 = 0, so ln(R/r) = 1 and r = R/e = ${fx(rOpt * 10, 2)} mm. There g_max = e·V/R = ${fx(gOpt, 2)} kV/cm.`,
          'The same condition, R = e·r, is the most economical conductor size: for a given voltage and permissible stress it gives the smallest overall cable (Learn step 6).',
        ],
      }
    },
  },
  {
    id: 'permittivity',
    title: 'A higher-permittivity insulation',
    change: `The default cable (r = ${DEFAULT_CABLE.rMm} mm, R = ${DEFAULT_CABLE.RMm} mm, ${DEFAULT_CABLE.vKv} kV) is insulated with a material of ε_r = 4.0 instead of ${DEFAULT_CABLE.epsR}. Same geometry, same voltage.`,
    question: 'What changes?',
    options: [
      { id: 'both-up', label: 'The stress at the conductor and the capacitance both rise' },
      { id: 'c-up', label: 'The capacitance and the charging current rise; the stress profile is unchanged' },
      { id: 'g-down', label: 'The stress falls and the capacitance rises' },
      { id: 'none', label: 'Nothing changes' },
    ],
    run() {
      const b = solve({})
      const a = solve({ epsR: 4 })
      const dg = pct(a.gMax, b.gMax)
      const dc = pct(a.cUfKm, b.cUfKm)
      const answer = Math.abs(dg) < 1e-9 ? (dc > 0 ? 'c-up' : 'none') : dg > 0 ? (dc > 0 ? 'both-up' : 'none') : dc > 0 ? 'g-down' : 'none'
      return {
        answer,
        rows: [
          { label: 'Relative permittivity ε_r', unit: '', decimals: 1, before: b.c.epsR, after: a.c.epsR },
          { label: 'g_max', unit: 'kV/cm', decimals: 2, before: b.gMax, after: a.gMax },
          { label: 'g_min', unit: 'kV/cm', decimals: 2, before: b.gMin, after: a.gMin },
          { label: 'Capacitance', unit: 'µF/km', decimals: 4, before: b.cUfKm, after: a.cUfKm },
          { label: 'Charging current per core', unit: 'A/km', decimals: 3, before: b.icAKm, after: a.icAKm },
          { label: 'Dielectric loss per core (same tan δ)', unit: 'W/km', decimals: 1, before: b.pWKm, after: a.pWKm },
          { label: 'Surge impedance', unit: 'Ω', decimals: 1, before: b.zc, after: a.zc },
        ],
        explain: [
          `With one dielectric, g(x) = V / (x · ln(R/r)) contains no ε_r: the charge rises with ε_r, but so does the permittivity the field must cross, and the two cancel. g_max ${changeWords(a.gMax, b.gMax)} (${fx(b.gMax, 2)} kV/cm in both).`,
          `C = 2πε₀ε_r / ln(R/r) is proportional to ε_r: ${fx(b.cUfKm, 4)} → ${fx(a.cUfKm, 4)} µF/km (${signed(dc)} %), and with it the charging current and, at the same tan δ, the dielectric loss.`,
          'So ε_r matters for capacitance and losses — not for the stress of a single dielectric. It does matter when two dielectrics share the voltage: that is capacitance grading (next experiment).',
        ],
      }
    },
  },
  {
    id: 'grading',
    title: 'Grade the insulation with a high-ε inner layer',
    change: `A cable of the default size (r = 10 mm, R = 22 mm, ${DEFAULT_CABLE.vKv} kV) insulated with one material of ε_r = 2.5 is rebuilt in two layers: an inner layer with ε_r = 4.0 out to ${fx(equalPeakRadii(1, [4, 2.5])[0] * 10, 0)} mm, the outer layer still 2.5. Same overall size, same voltage.`,
    question: 'What happens to the highest stress anywhere in the insulation?',
    options: [
      { id: 'down', label: 'It falls' },
      { id: 'up', label: 'It rises' },
      { id: 'same', label: 'It stays the same — the geometry did not change' },
    ],
    run() {
      const v = DEFAULT_CABLE.vKv
      const plain = capacitanceGraded(v, [1, 2.2], [2.5])
      const eps = [4, 2.5]
      const r1 = equalPeakRadii(1, eps)[0]
      const graded = capacitanceGraded(v, [1, r1, 2.2], eps)
      if (!plain.ok || !graded.ok) throw new Error('grading experiment invalid')
      const d = pct(graded.peak, plain.peak)
      const answer = Math.abs(d) < 0.05 ? 'same' : d < 0 ? 'down' : 'up'
      const [L1, L2] = graded.layers
      return {
        answer,
        rows: [
          { label: 'Highest stress', unit: 'kV/cm', decimals: 2, before: plain.peak, after: graded.peak },
          { label: 'Stress at the conductor (r = 10 mm)', unit: 'kV/cm', decimals: 2, before: plain.layers[0].gMax, after: L1.gMax },
          { label: `Stress just outside the boundary (${fx(r1 * 10, 1)} mm)`, unit: 'kV/cm', decimals: 2, before: (plain.kKv as number) / (2.5 * r1), after: L2.gMax },
          { label: 'Stress at the sheath', unit: 'kV/cm', decimals: 2, before: plain.layers[0].gMin, after: L2.gMin },
          { label: 'Capacitance', unit: 'µF/km', decimals: 4, before: plain.cUfKm as number, after: graded.cUfKm as number },
        ],
        plot: {
          series: [
            { id: 'p', label: 'one ε', color: 'var(--text-3)', points: gradedProfile(plain, 60), dashed: true },
            { id: 'g', label: 'graded', color: 'var(--ps-b)', points: gradedProfile(graded, 40) },
          ],
          xLabel: 'Radius x [mm]',
          yLabel: 'g [kV/cm]',
          label: 'Stress across the insulation: one dielectric against two graded layers',
          vlines: [{ x: r1 * 10, label: `boundary ${fx(r1 * 10, 1)} mm` }],
        },
        explain: [
          `The flux density D = q/(2πx) is continuous across the layers, so g = D/ε: the high-ε inner layer carries a lower stress for the same D. The highest stress ${changeWords(graded.peak, plain.peak)}: ${fx(plain.peak, 2)} → ${fx(graded.peak, 2)} kV/cm.`,
          `The boundary at ${fx(r1 * 10, 1)} mm satisfies ε₁r = ε₂r₁ (4.0 × 10 = 2.5 × ${fx(r1 * 10, 1)}), so both layers reach the same maximum: ${fx(L1.gMax, 2)} kV/cm at the conductor and ${fx(L2.gMax, 2)} kV/cm just outside the boundary — the stress jumps up there.`,
          `The insulation is used more evenly; the same cable could take a higher voltage. In practice, materials with stable, graded permittivities are hard to make, which is why this is rarely done today.`,
        ],
      }
    },
  },
  {
    id: 'vs-line',
    title: '10 km of cable against 10 km of overhead line',
    change: `The default cable (r = ${DEFAULT_CABLE.rMm} mm, R = ${DEFAULT_CABLE.RMm} mm, ε_r = ${DEFAULT_CABLE.epsR}) and Module 8’s default overhead line (400 kV flat line, twin bundle) are each 10 km long and energised at the same phase voltage, ${DEFAULT_CABLE.vKv} kV.`,
    question: 'How does the cable’s charging current compare with the line’s?',
    options: [
      { id: 'same', label: 'About the same — both are 10 km long' },
      { id: 'few', label: 'Larger, by 1.5 to 5 times' },
      { id: 'ten', label: 'Much larger, by 5 to 50 times' },
      { id: 'hundred', label: 'More than 50 times larger' },
    ],
    run() {
      const res = solve({ lengthKm: 10 })
      const cmp = compareWithLine(res)
      const ratio = cmp.icCableTotal / cmp.icLineTotal
      const answer = ratio < 1.5 ? 'same' : ratio < 5 ? 'few' : ratio <= 50 ? 'ten' : 'hundred'
      return {
        answer,
        columns: ['Overhead line', 'Cable'],
        rows: [
          { label: 'Capacitance per phase', unit: 'nF/km', decimals: 2, before: cmp.cLine, after: cmp.cCable },
          { label: 'Charging current over 10 km', unit: 'A', decimals: 2, before: cmp.icLineTotal, after: cmp.icCableTotal },
          { label: 'Surge impedance', unit: 'Ω', decimals: 1, before: cmp.zcLine, after: cmp.zcCable },
          { label: 'Wave speed', unit: 'm/µs', decimals: 0, before: cmp.speedLine, after: cmp.speedCable },
        ],
        explain: [
          `The cable’s charging current is ${timesWords(ratio)} the line’s: ${fx(cmp.icCableTotal, 2)} A against ${fx(cmp.icLineTotal, 2)} A. At the same voltage and length the ratio is simply the capacitance ratio, ${fx(cmp.cCable, 1)} / ${fx(cmp.cLine, 2)} nF/km.`,
          `Why: in the cable the “plates” are ${fx(res.thicknessMm, 0)} mm apart (ln(R/r) = ${fx(res.ln, 3)}), filled with a dielectric of ε_r = ${res.c.epsR}; the line’s conductors are metres apart in air (ln(GMD/r_eq) = ${fx(Math.log(cmp.line.gmd / cmp.line.req), 2)}).`,
          `This is why long ac cables need shunt reactors (or are replaced by dc): at some length the charging current alone fills the conductor’s rating. The surge impedance is also much lower — ${fx(cmp.zcCable, 1)} Ω against ${fx(cmp.zcLine, 1)} Ω — which shapes how surges travel (Module 15).`,
        ],
      }
    },
  },
  {
    id: 'length',
    title: 'Twice the route length',
    change: `The default cable is laid over ${DEFAULT_CABLE.lengthKm * 2} km instead of ${DEFAULT_CABLE.lengthKm} km.`,
    question: 'What happens to the insulation resistance measured between the conductor and the sheath?',
    options: [
      { id: 'up', label: 'It doubles — twice as much insulation' },
      { id: 'down', label: 'It halves' },
      { id: 'same', label: 'It does not change — insulation resistance is a material property' },
    ],
    run() {
      const b = solve({})
      const a = solve({ lengthKm: DEFAULT_CABLE.lengthKm * 2 })
      const ratio = a.rInsMOhm / b.rInsMOhm
      const answer = Math.abs(ratio - 1) < 1e-6 ? 'same' : ratio > 1 ? 'up' : 'down'
      return {
        answer,
        rows: [
          { label: 'Length', unit: 'km', decimals: 1, before: b.c.lengthKm, after: a.c.lengthKm },
          { label: 'Insulation resistance', unit: 'MΩ', decimals: 0, before: b.rInsMOhm, after: a.rInsMOhm },
          { label: 'Insulation resistance × length', unit: 'MΩ·km', decimals: 0, before: b.rInsMOhmKm, after: a.rInsMOhmKm },
          { label: 'Capacitance of the whole cable', unit: 'µF', decimals: 3, before: b.cUf, after: a.cUf },
          { label: 'Charging current per core', unit: 'A', decimals: 2, before: b.ic, after: a.ic },
        ],
        explain: [
          `The leakage current flows radially, from conductor to sheath. A longer cable offers more parallel paths, so the resistance ${changeWords(a.rInsMOhm, b.rInsMOhm, 0)}: ${fx(b.rInsMOhm, 0)} → ${fx(a.rInsMOhm, 0)} MΩ. R_ins = ρ·ln(R/r) / (2π l) — the length is in the denominator.`,
          `That is why insulation resistance is quoted as MΩ·km (${fx(b.rInsMOhmKm, 0)} MΩ·km here, the same for both). The capacitance, being parallel too, doubles (${fx(b.cUf, 3)} → ${fx(a.cUf, 3)} µF), and so does the charging current.`,
        ],
      }
    },
  },
]
