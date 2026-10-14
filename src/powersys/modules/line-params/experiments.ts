import { fx } from '../../ui/format.ts'
import type { Choice } from '../../ui/kit.tsx'
import { ALUMINIUM, computeLine, pct, skinWords, PHASES, presetDesign, rhoAt, skinDepth, skinQ, skinRatio, type Design, type LineResult } from './calc.ts'

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
  /** The two cross-sections (geometry experiments). */
  designs?: { before: Design; after: Design }
  /** The skin-effect parameter q before and after (the frequency experiment: current density is drawn from it). */
  profiles?: { qBefore: number; qAfter: number; fBefore: number; fAfter: number }
}
export interface Experiment {
  id: string
  title: string
  change: string
  question: string
  options: Choice[]
  run(): ExpResult
}

function solve(d: Design): LineResult {
  const r = computeLine(d.geometry, d.options)
  if (!r.ok) throw new Error(`experiment geometry invalid: ${r.issues[0].message}`)
  return r
}

const BASE = () => presetDesign('horizontal')
const lcRows = (b: LineResult, a: LineResult): ExpRow[] => [
  { label: 'GMD', unit: 'm', decimals: 2, before: b.gmd, after: a.gmd },
  { label: 'GMR (bundle, for L)', unit: 'mm', decimals: 1, before: b.gmrL * 1000, after: a.gmrL * 1000 },
  { label: 'Inductance L', unit: 'mH/km', decimals: 4, before: b.lMhKm, after: a.lMhKm },
  { label: 'Capacitance C', unit: 'nF/km', decimals: 3, before: b.cNfKm, after: a.cNfKm },
  { label: 'Surge impedance Z_c', unit: 'Ω', decimals: 1, before: b.zcOhm, after: a.zcOhm },
  { label: 'SIL at 400 kV', unit: 'MW', decimals: 0, before: b.silMw, after: a.silMw },
]
const signed = (x: number, d = 1) => `${x > 0 ? '+' : ''}${fx(x, d)}`

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'spacing',
    title: 'Double the phase spacing',
    change: 'A 400 kV flat line (twin bundle, 11 m between neighbouring phases) is rebuilt with 22 m between phases. Nothing else changes.',
    question: 'What happens to the inductance per phase?',
    options: [
      { id: 'double', label: 'It roughly doubles' },
      { id: 'up-small', label: 'It rises, but by much less than double' },
      { id: 'same', label: 'It does not change' },
      { id: 'down', label: 'It falls' },
    ],
    run() {
      const bd = BASE()
      const ad = presetDesign('horizontal', 22)
      const b = solve(bd)
      const a = solve(ad)
      const ratio = a.lMhKm / b.lMhKm
      const answer = ratio > 1.75 ? 'double' : ratio > 1.001 ? 'up-small' : ratio < 0.999 ? 'down' : 'same'
      return {
        answer,
        rows: lcRows(b, a),
        designs: { before: bd, after: ad },
        explain: [
          `L rises from ${fx(b.lMhKm, 4)} to ${fx(a.lMhKm, 4)} mH/km — ${signed(pct(a.lMhKm, b.lMhKm))} %, not double. Inductance depends on the LOGARITHM of the spacing: L = 0.2·ln(GMD/GMR) mH/km.`,
          `Doubling the GMD (${fx(b.gmd, 2)} → ${fx(a.gmd, 2)} m) adds 0.2·ln 2 = ${fx(0.2 * Math.log(2), 4)} mH/km whatever the line. The bigger loop links more flux, but the field far from a conductor is weak.`,
          `The capacitance falls ${fx(Math.abs(pct(a.cNfKm, b.cNfKm)), 1)} % (C = 2πε₀ / ln(GMD/r_eq)), so Z_c = √(L/C) rises and the SIL falls from ${fx(b.silMw, 0)} to ${fx(a.silMw, 0)} MW. Wide spacing costs tower steel and gains nothing electrically — the spacing is set by insulation clearance.`,
        ],
      }
    },
  },
  {
    id: 'bundle',
    title: 'Use two sub-conductors per phase',
    change: 'Each phase of the flat 400 kV line (11 m spacing) changes from one 31.8 mm conductor to a twin bundle of the same conductor, 0.45 m apart.',
    question: 'What happens to the surge impedance loading (SIL) — the natural power rating of the line?',
    options: [
      { id: 'up', label: 'It rises' },
      { id: 'same', label: 'It stays the same' },
      { id: 'down', label: 'It falls' },
    ],
    run() {
      const bd = presetDesign('horizontal', 11, 15, { n: 1 })
      const ad = presetDesign('horizontal', 11, 15, { n: 2 })
      const b = solve(bd)
      const a = solve(ad)
      const d = pct(a.silMw, b.silMw)
      const answer = Math.abs(d) < 0.5 ? 'same' : d > 0 ? 'up' : 'down'
      return {
        answer,
        rows: lcRows(b, a),
        designs: { before: bd, after: ad },
        explain: [
          `The bundle acts like one fat conductor: its GMR grows from ${fx(b.gmrL * 1000, 1)} mm (r′ of one conductor) to ${fx(a.gmrL * 1000, 1)} mm = √(r′·d).`,
          `So L falls ${fx(Math.abs(pct(a.lMhKm, b.lMhKm)), 1)} % and C rises ${fx(pct(a.cNfKm, b.cNfKm), 1)} %; Z_c = √(L/C) falls from ${fx(b.zcOhm, 1)} to ${fx(a.zcOhm, 1)} Ω and the SIL = V²/Z_c rises ${signed(d)} % to ${fx(a.silMw, 0)} MW.`,
          'The bigger equivalent radius also lowers the electric field at the conductor surface (less corona) and halves the resistance per phase — why EHV lines use bundles.',
        ],
      }
    },
  },
  {
    id: 'height',
    title: 'Raise the line higher above the earth',
    change: 'The flat 400 kV line is raised from 10 m to 25 m above the ground (the earth effect is switched on). Spacing and conductors are unchanged.',
    question: 'What happens to the capacitance per phase?',
    options: [
      { id: 'up', label: 'It rises noticeably' },
      { id: 'down-slight', label: 'It falls slightly (under 5 %)' },
      { id: 'down-lot', label: 'It falls a lot (more than 5 %)' },
      { id: 'none', label: 'Exactly no change: height does not enter the formula' },
    ],
    run() {
      const bd = presetDesign('horizontal', 11, 10)
      const ad = presetDesign('horizontal', 11, 25)
      const b = solve(bd)
      const a = solve(ad)
      const d = pct(a.cNfKm, b.cNfKm)
      const answer = Math.abs(d) < 0.01 ? 'none' : d > 0 ? 'up' : d > -5 ? 'down-slight' : 'down-lot'
      return {
        answer,
        rows: [
          { label: 'Mean height', unit: 'm', decimals: 1, before: b.hMean, after: a.hMean },
          { label: 'C ignoring earth', unit: 'nF/km', decimals: 4, before: b.cNoEarthNfKm, after: a.cNoEarthNfKm },
          { label: 'C with earth (images)', unit: 'nF/km', decimals: 4, before: b.cNfKm, after: a.cNfKm },
          { label: 'Inductance L', unit: 'mH/km', decimals: 4, before: b.lMhKm, after: a.lMhKm },
          { label: 'Charging at 400 kV', unit: 'Mvar/100 km', decimals: 2, before: b.chargingMvar100, after: a.chargingMvar100 },
        ],
        designs: { before: bd, after: ad },
        explain: [
          `C falls from ${fx(b.cNfKm, 4)} to ${fx(a.cNfKm, 4)} nF/km (${signed(d, 2)} %). The earth is a conductor: it holds image charges below the ground that pull more charge onto the line — the closer the line, the stronger the pull.`,
          `Without the earth the formula gives ${fx(b.cNoEarthNfKm, 4)} nF/km at either height: the earth adds ${fx(pct(b.cNfKm, b.cNoEarthNfKm), 2)} % at 10 m but only ${fx(pct(a.cNfKm, a.cNoEarthNfKm), 2)} % at 25 m. A small effect — most textbook problems ignore it — but it is real.`,
          'The inductance does not change: in this model the earth is ignored for balanced currents.',
        ],
      }
    },
  },
  {
    id: 'transpose',
    title: 'Leave a flat line untransposed',
    change: 'The flat 400 kV line is built without transposition: phase a always on the left, b in the middle, c on the right.',
    question: 'With balanced currents, which phase has the lowest inductance?',
    options: [
      { id: 'a', label: 'Phase a (an outer phase)' },
      { id: 'b', label: 'Phase b (the middle phase)' },
      { id: 'c', label: 'Phase c (the other outer phase)' },
      { id: 'same', label: 'All three are equal' },
    ],
    run() {
      const d = BASE()
      const res = solve(d)
      const re = res.matrix.lPhase.map((z) => z.re)
      const lo = re.indexOf(Math.min(...re))
      const spread = (Math.max(...re) - Math.min(...re)) / res.lMhKm
      const answer = spread < 1e-3 ? 'same' : PHASES[lo]
      return {
        answer,
        rows: re.map((v, k) => ({ label: `Inductance of phase ${PHASES[k]}`, unit: 'mH/km', decimals: 4, before: res.matrix.lMhKm, after: v })),
        explain: [
          `Untransposed, each phase sees different neighbours: phase b is ${fx(res.dab, 1)} m from both others, the outer phases have one neighbour at ${fx(res.dab, 1)} m and one at ${fx(res.dca, 1)} m. The phase inductances are ${re.map((v, k) => `${PHASES[k]} ${fx(v, 4)}`).join(', ')} mH/km — the middle phase is ${fx(Math.abs(pct(re[1], res.matrix.lMhKm)), 1)} % below the average.`,
          `Their average, ${fx((re[0] + re[1] + re[2]) / 3, 4)} mH/km, is exactly the transposed value: transposition makes each phase spend a third of the length in each position, so the three phases become equal (here ${fx(res.lMhKm, 4)} mH/km from the GMD formula).`,
          `Strictly, untransposed per-phase “inductances” are complex (imaginary parts ${res.matrix.lPhase.map((z) => fx(z.im, 4)).join(', ')} mH/km): energy is passed between phases. Unequal drops unbalance the receiving-end voltages — why long lines are transposed.`,
        ],
      }
    },
  },
  {
    id: 'temperature',
    title: 'Heat the conductor',
    change: 'Under heavy load the conductor warms from 20 °C to 75 °C.',
    question: 'What happens to its resistance?',
    options: [
      { id: 'none', label: 'It does not change' },
      { id: 'few', label: 'It rises by a few per cent (under 10 %)' },
      { id: 'fifth', label: 'It rises by roughly a fifth (10–40 %)' },
      { id: 'double', label: 'It roughly doubles' },
    ],
    run() {
      const bd = presetDesign('horizontal', 11, 15, undefined, { ...BASE().options, tempC: 20 })
      const ad = presetDesign('horizontal', 11, 15, undefined, { ...BASE().options, tempC: 75 })
      const b = solve(bd)
      const a = solve(ad)
      const d = pct(a.r.rDc, b.r.rDc)
      const answer = d < 0.1 ? 'none' : d < 10 ? 'few' : d < 40 ? 'fifth' : 'double'
      return {
        answer,
        rows: [
          { label: 'Resistivity ρ', unit: 'nΩ·m', decimals: 2, before: b.r.rho * 1e9, after: a.r.rho * 1e9 },
          { label: 'R dc per phase', unit: 'mΩ/km', decimals: 2, before: b.r.rDc * 1000, after: a.r.rDc * 1000 },
          { label: 'R ac (50 Hz) per phase', unit: 'mΩ/km', decimals: 2, before: b.r.rAc * 1000, after: a.r.rAc * 1000 },
          { label: 'Inductance L', unit: 'mH/km', decimals: 4, before: b.lMhKm, after: a.lMhKm },
        ],
        explain: [
          `R_T = R₂₀·[1 + α(T − 20)] with α = ${ALUMINIUM.alpha20} /°C for aluminium (a typical value): 1 + ${ALUMINIUM.alpha20} × 55 = ${fx(1 + ALUMINIUM.alpha20 * 55, 4)}, a rise of ${fx(d, 1)} %.`,
          `Losses I²R rise by the same ${fx(d, 1)} % at the same current — and more loss heats the conductor further. The geometry, so L and C, is unchanged (thermal expansion and extra sag are not modelled).`,
        ],
      }
    },
  },
  {
    id: 'frequency',
    title: 'Raise the frequency',
    change: 'The same 31.8 mm aluminium conductor (at 50 °C) carries a 1 kHz current — a 20th harmonic — instead of 50 Hz.',
    question: 'What happens to its ac resistance compared with its dc resistance?',
    options: [
      { id: 'same', label: 'It stays practically equal to the dc value' },
      { id: 'up', label: 'It rises well above the dc value (more than 20 % above)' },
      { id: 'down', label: 'It falls below the dc value' },
    ],
    run() {
      const r = BASE().geometry.rM
      const rho = rhoAt(BASE().options.tempC)
      const fB = 50
      const fA = 1000
      const kb = skinRatio(r, rho, fB)
      const ka = skinRatio(r, rho, fA)
      const answer = ka > 1.2 ? 'up' : ka < 1 ? 'down' : 'same'
      return {
        answer,
        rows: [
          { label: 'Skin depth δ', unit: 'mm', decimals: 2, before: skinDepth(rho, fB) * 1000, after: skinDepth(rho, fA) * 1000 },
          { label: 'q = √2·r/δ', unit: '', decimals: 3, before: skinQ(r, rho, fB), after: skinQ(r, rho, fA) },
          { label: 'R_ac / R_dc', unit: '', decimals: 4, before: kb, after: ka },
        ],
        profiles: { qBefore: skinQ(r, rho, fB), qAfter: skinQ(r, rho, fA), fBefore: fB, fAfter: fA },
        explain: [
          `At 50 Hz the skin depth δ = √(2ρ/ωμ) is ${fx(skinDepth(rho, fB) * 1000, 1)} mm against a ${fx(r * 1000, 1)} mm radius, so R_ac/R_dc is ${fx(kb, 4)}: an increase that is ${skinWords(kb)}.`,
          `At 1 kHz δ shrinks to ${fx(skinDepth(rho, fA) * 1000, 2)} mm: the current crowds into a thin outer layer and R_ac/R_dc = ${fx(ka, 3)} (${skinWords(ka)}). The high-frequency estimate r/(2δ) + 1/4 = ${fx(r / (2 * skinDepth(rho, fA)) + 0.25, 3)} is ${fx(Math.abs(pct(r / (2 * skinDepth(rho, fA)) + 0.25, ka)), 1)} % from the exact value.`,
          'Harmonic currents therefore heat a conductor more than their RMS value suggests. (A stranded ACSR conductor with a steel core behaves somewhat differently — this is the solid-conductor model.)',
        ],
      }
    },
  },
]
