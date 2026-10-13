import { abs, add, C, conj, div, mul } from '../../engine/complex.ts'
import { fx } from '../../ui/format.ts'
import type { Choice } from '../../ui/kit.tsx'
import {
  betaL,
  cycle,
  disturbedSet,
  inst,
  instantaneousPower,
  LINE_PRESETS,
  lineAbcd,
  lineParams,
  linePerformance,
  lossless,
  maxReceivingPower,
  pctOf,
  powerSummary,
  receivingPowerCircle,
  setSum,
  sil,
  solveLoad,
  SQRT3,
  voltageProfile,
  type LineLoad,
  type LineConstants,
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
export interface ExpChart {
  xLabel: string
  yLabel: string
  series: Array<{ id: string; label: string; color: string; points: Array<[number, number]>; dashed?: boolean }>
  hlines?: Array<{ y: number; label: string }>
  vlines?: Array<{ x: number; label: string }>
  yDomain?: [number, number]
}
export interface ExpResult {
  answer: string
  rows: ExpRow[]
  explain: string[]
  chart: ExpChart
}
export interface Experiment {
  id: string
  title: string
  change: string
  question: string
  options: Choice[]
  run(): ExpResult
}

const L400 = LINE_PRESETS.find((p) => p.id === '400')!
const deg = (r: number) => (r * 180) / Math.PI

function exactPerf(k: LineConstants, len: number, load: LineLoad, kv = 400) {
  const m = lineAbcd(k, len, 'long')
  const p = lineParams(k, len)
  const perf = linePerformance(m, kv, load)
  return { m, p, perf, profile: voltageProfile(p, len, perf.vr, perf.ir, 80) }
}

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'unbalance',
    title: 'Phase b sags by 20 %',
    change: 'In a 230 V (phase) supply, phase b’s voltage falls to 80 % of the others; its angle is unchanged.',
    question: 'What happens to v_a + v_b + v_c, the voltage a neutral wire would have to absorb?',
    options: [
      { id: 'zero', label: 'Still zero at every instant' },
      { id: 'small', label: 'A sine wave about 20 % of the phase voltage' },
      { id: 'large', label: 'A sine wave about as large as a phase voltage' },
    ],
    run() {
      const before = disturbedSet(230, 1, 0)
      const after = disturbedSet(230, 0.8, 0)
      const sb = abs(setSum(before))
      const sa = abs(setSum(after))
      const ratio = sa / 230
      return {
        answer: ratio < 0.02 ? 'zero' : ratio < 0.5 ? 'small' : 'large',
        rows: [
          { label: '|V_b|', unit: 'V', decimals: 1, before: abs(before.b), after: abs(after.b) },
          { label: '|V_a + V_b + V_c|', unit: 'V', decimals: 2, before: sb, after: sa },
          { label: 'Peak of v_a + v_b + v_c', unit: 'V', decimals: 1, before: Math.SQRT2 * sb, after: Math.SQRT2 * sa },
        ],
        explain: [
          `The balanced phasors close a triangle, so their sum is exactly zero (${fx(sb, 3)} V). Shrink V_b by 20 % and the sum is what is missing from it: |ΣV| = 0.2 × 230 = ${fx(sa, 1)} V (${fx(ratio * 100, 0)} % of a phase voltage), pointing opposite to V_b.`,
          'In a four-wire star system that residual drives a current in the neutral; in a three-wire system it shifts the neutral point instead, and the phase voltages of the load become unequal.',
        ],
        chart: {
          xLabel: 'ωt [°]',
          yLabel: 'v [V]',
          series: [
            { id: 'b', label: 'Σ balanced', color: 'var(--text-3)', points: cycle(120).map((w) => [deg(w), inst(setSum(before), w)]), dashed: true },
            { id: 'a', label: 'Σ with b at 80 %', color: 'var(--ps-flow)', points: cycle(120).map((w) => [deg(w), inst(setSum(after), w)]) },
            { id: 'vb', label: 'v_b at 80 %', color: 'var(--ps-b)', points: cycle(120).map((w) => [deg(w), inst(after.b, w)]) },
          ],
        },
      }
    },
  },
  {
    id: 'reconnect',
    title: 'Reconnect a star load in delta',
    change: 'Three equal 20 Ω impedances at power factor 0.8 lagging, fed from a 400 V supply, are reconnected from star to delta.',
    question: 'How does the power they take change?',
    options: [
      { id: 'same', label: 'It stays the same — same impedances, same supply' },
      { id: 'root3', label: 'It rises √3 times' },
      { id: 'three', label: 'It rises three times' },
    ],
    run() {
      const phi = deg(Math.acos(0.8))
      const y = powerSummary(solveLoad(400, 20, phi, 'star'))
      const d = powerSummary(solveLoad(400, 20, phi, 'delta'))
      const r = d.p / y.p
      return {
        answer: Math.abs(r - 1) < 0.05 ? 'same' : Math.abs(r - Math.sqrt(3)) < 0.05 ? 'root3' : 'three',
        rows: [
          { label: 'Voltage across each impedance', unit: 'V', decimals: 1, before: y.vPh, after: d.vPh },
          { label: 'Current in each impedance', unit: 'A', decimals: 2, before: y.iPh, after: d.iPh },
          { label: 'Line current', unit: 'A', decimals: 2, before: y.iL, after: d.iL },
          { label: 'Total power P', unit: 'kW', decimals: 2, before: y.p / 1000, after: d.p / 1000 },
        ],
        explain: [
          `In star each impedance sees the phase voltage, ${fx(y.vPh, 1)} V; in delta it sees the full line voltage, ${fx(d.vPh, 1)} V — √3 times more. Its current rises √3 times too (${fx(y.iPh, 2)} → ${fx(d.iPh, 2)} A), so its power, V·I·cos φ, rises √3 × √3 = 3 times: ${fx(y.p / 1000, 2)} → ${fx(d.p / 1000, 2)} kW (× ${fx(r, 3)}).`,
          `The line current rises three times as well (${fx(y.iL, 2)} → ${fx(d.iL, 2)} A): √3 from the higher voltage and √3 more because each line feeds two delta branches. This is why a star–delta starter limits a motor’s starting current to a third.`,
        ],
        chart: {
          xLabel: 'ωt [°]',
          yLabel: 'p [kW]',
          series: [
            { id: 'y', label: 'Total p, star', color: 'var(--ps-c)', points: instantaneousPower(solveLoad(400, 20, phi, 'star'), 120).map((p) => [deg(p.wt), p.total / 1000]), dashed: true },
            { id: 'd', label: 'Total p, delta', color: 'var(--ps-a)', points: instantaneousPower(solveLoad(400, 20, phi, 'delta'), 120).map((p) => [deg(p.wt), p.total / 1000]) },
          ],
          yDomain: [0, Math.ceil((d.p / 1000) * 1.25)],
        },
      }
    },
  },
  {
    id: 'ferranti',
    title: 'Double the length of an unloaded line',
    change: 'A 400 kV line is energised from one end with nothing connected at the other. Its length goes from 200 km to 400 km.',
    question: 'The receiving end rises above the sending voltage (the Ferranti effect). How does that rise change?',
    options: [
      { id: 'half', label: 'It doubles' },
      { id: 'more', label: 'It grows about four times' },
      { id: 'same', label: 'It stays the same — no current, no drop' },
    ],
    run() {
      const nl: LineLoad = { pMw: 0, pf: 1, lagging: true }
      // hold the sending end at 400 kV: V_r = V_s / |A|
      const rise = (len: number) => (1 / abs(lineAbcd(L400, len, 'long').A) - 1) * 100
      const rb = rise(200)
      const ra = rise(400)
      const r = ra / rb
      const prof = (len: number) => {
        const { profile } = exactPerf(L400, len, nl)
        const scale = 400 / profile[0].vLL
        return profile.map((p) => [p.dKm, p.vLL * scale] as [number, number])
      }
      return {
        answer: r < 1.3 ? 'same' : r < 2.8 ? 'half' : 'more',
        rows: [
          { label: 'Length', unit: 'km', decimals: 0, before: 200, after: 400 },
          { label: 'β·l', unit: '°', decimals: 2, before: deg(betaL(L400, 200)), after: deg(betaL(L400, 400)) },
          { label: 'Receiving voltage (V_s = 400 kV)', unit: 'kV', decimals: 2, before: 400 * (1 + rb / 100), after: 400 * (1 + ra / 100) },
          { label: 'Rise above V_s', unit: '%', decimals: 2, before: rb, after: ra },
        ],
        explain: [
          `The charging current of the line’s capacitance flows through its inductance, and the voltage across that inductance adds to the sending voltage. On a lossless line V_r/V_s = 1/cos βl ≈ 1 + (βl)²/2: the rise grows with the square of the length. Here it goes from ${fx(rb, 2)} % to ${fx(ra, 2)} % (× ${fx(r, 2)}).`,
          `${r > 4.05 ? 'A little more than four times, because 1/cos βl rises faster than its first term' : 'About four times'}. At 400 km an unloaded 400 kV line delivers ${fx(400 * (1 + ra / 100), 1)} kV — utilities connect shunt reactors at the ends of long lines to absorb this charging.`,
        ],
        chart: {
          xLabel: 'Distance from sending end [km]',
          yLabel: 'Voltage [kV]',
          series: [
            { id: 'b', label: '200 km', color: 'var(--ps-c)', points: prof(200), dashed: true },
            { id: 'a', label: '400 km', color: 'var(--ps-a)', points: prof(400) },
          ],
          hlines: [{ y: 400, label: 'V_s = 400 kV' }],
        },
      }
    },
  },
  {
    id: 'sil',
    title: 'Load a line at its surge impedance loading',
    change:
      'A 400 km, 400 kV line (its resistance neglected) is fed at 400 kV. Its load is a resistance that would draw the line’s SIL at 400 kV (Z_load = Z_c), instead of one that would draw half of it (Z_load = 2·Z_c).',
    question: 'How does the voltage vary along the line at SIL?',
    options: [
      { id: 'rise', label: 'It rises towards the receiving end' },
      { id: 'flat', label: 'It is almost the same all along the line' },
      { id: 'sag', label: 'It falls towards the receiving end' },
    ],
    run() {
      const k = lossless(L400)
      const len = 400
      const p = lineParams(k, len)
      const P = sil(400, p.zcLossless)
      /** Sending end held at 400 kV, a resistive load of R per phase (Ω). */
      const fed = (kk: LineConstants, rOhm: number) => {
        const pp = lineParams(kk, len)
        const m = lineAbcd(kk, len, 'long')
        const vs = C(400 / SQRT3, 0)
        const vr = div(vs, add(m.A, div(m.B, C(rOhm, 0))))
        const ir = div(vr, C(rOhm, 0))
        const profile = voltageProfile(pp, len, vr, ir, 80)
        const qs = 3 * mul(vs, conj(add(mul(m.C, vr), mul(m.D, ir)))).im
        return { profile, vrLL: abs(vr) * SQRT3, qs }
      }
      const half = fed(k, (2 * 400 * 400) / P)
      const at = fed(k, (400 * 400) / P)
      const real = fed(L400, (400 * 400) / P)
      const spread = (pr: Array<{ vLL: number }>) => {
        const v = pr.map((x) => x.vLL)
        return ((Math.max(...v) - Math.min(...v)) / 400) * 100
      }
      const sa = spread(at.profile)
      return {
        answer: sa < 1 ? 'flat' : at.vrLL > 400 ? 'rise' : 'sag',
        rows: [
          { label: 'Load resistance per phase', unit: 'Ω', decimals: 1, before: (2 * 400 * 400) / P, after: (400 * 400) / P },
          { label: 'Receiving voltage', unit: 'kV', decimals: 2, before: half.vrLL, after: at.vrLL },
          { label: 'Spread of |V| along the line', unit: '%', decimals: 2, before: spread(half.profile), after: sa },
          { label: 'Reactive power sent', unit: 'Mvar', decimals: 1, before: half.qs, after: at.qs },
        ],
        explain: [
          `Z_c = √(x/b) = ${fx(p.zcLossless, 1)} Ω, so SIL = 400² / ${fx(p.zcLossless, 1)} = ${fx(P, 0)} MW. A line terminated in its own surge impedance carries a travelling wave with nothing reflected: the reactive power its capacitance generates (∝ V²) equals what its inductance absorbs (∝ I²), and |V| is the same all along the 400 km (spread ${fx(sa, 3)} %).`,
          `With the lighter load the capacitance wins: the line generates reactive power (${fx(-half.qs, 0)} Mvar flows back into the sending end) and the far end rises to ${fx(half.vrLL, 1)} kV. With this line’s real resistance (${fx(L400.rOhmPerKm, 2)} Ω/km) the SIL profile is no longer perfectly flat: the far end falls to ${fx(real.vrLL, 1)} kV.`,
        ],
        chart: {
          xLabel: 'Distance from sending end [km]',
          yLabel: 'Voltage [kV]',
          series: [
            { id: 'b', label: '½ SIL load', color: 'var(--ps-c)', points: half.profile.map((x) => [x.dKm, x.vLL]), dashed: true },
            { id: 'a', label: 'SIL load', color: 'var(--ps-mv)', points: at.profile.map((x) => [x.dKm, x.vLL]) },
          ],
          hlines: [{ y: 400, label: 'V_s = 400 kV' }],
        },
      }
    },
  },
  {
    id: 'voltage',
    title: 'Double the transmission voltage',
    change: 'The same 300 km route is built for 400 kV instead of 200 kV, with the same per-km line constants; both ends are held at rated voltage.',
    question: 'How does the most power the line can carry change?',
    options: [
      { id: 'two', label: 'It doubles' },
      { id: 'four', label: 'It rises about four times' },
      { id: 'same', label: 'It stays the same — the conductors are the same' },
    ],
    run() {
      const m = lineAbcd(L400, 300, 'long')
      const b = maxReceivingPower(m, 200, 200)
      const a = maxReceivingPower(m, 400, 400)
      const r = a.pMw / b.pMw
      const curve = (kv: number) => Array.from({ length: 91 }, (_, i) => [i * 2, receivingPowerCircle(m, kv, kv, i * 2)] as [number, number])
      return {
        answer: r < 1.3 ? 'same' : r < 3 ? 'two' : 'four',
        rows: [
          { label: 'Line voltage', unit: 'kV', decimals: 0, before: 200, after: 400 },
          { label: 'Maximum receiving power', unit: 'MW', decimals: 0, before: b.pMw, after: a.pMw },
          { label: 'SIL', unit: 'MW', decimals: 0, before: sil(200, lineParams(L400, 300).zcLossless), after: sil(400, lineParams(L400, 300).zcLossless) },
        ],
        explain: [
          `P = V_s·V_r·sin δ / X: with both ends at rated voltage it scales with V². Doubling the voltage gives ${fx(r, 2)} times the maximum (${fx(b.pMw, 0)} → ${fx(a.pMw, 0)} MW), for the same reactance and the same conductors.`,
          'That is why the longest, heaviest corridors use the highest voltages: the power a line can carry before it loses synchronism grows with the square of its voltage, while its cost grows much more slowly.',
        ],
        chart: {
          xLabel: 'Load angle δ [°]',
          yLabel: 'Receiving power [MW]',
          series: [
            { id: 'b', label: '200 kV', color: 'var(--ps-c)', points: curve(200), dashed: true },
            { id: 'a', label: '400 kV', color: 'var(--ps-a)', points: curve(400) },
          ],
        },
      }
    },
  },
  {
    id: 'leading',
    title: 'Make the load leading',
    change: 'A 400 kV line, 250 km long, delivers 300 MW at the receiving end at 400 kV. The load’s power factor changes from 0.9 lagging to 0.9 leading.',
    question: 'What happens to the voltage regulation?',
    options: [
      { id: 'up', label: 'It rises' },
      { id: 'small', label: 'It falls but stays positive' },
      { id: 'neg', label: 'It becomes negative — the no-load voltage would be lower than on load' },
    ],
    run() {
      const lag = exactPerf(L400, 250, { pMw: 300, pf: 0.9, lagging: true })
      const lead = exactPerf(L400, 250, { pMw: 300, pf: 0.9, lagging: false })
      const ra = lead.perf.regulationPct
      const rb = lag.perf.regulationPct
      return {
        answer: ra > rb ? 'up' : ra >= 0 ? 'small' : 'neg',
        rows: [
          { label: 'Load reactive power', unit: 'Mvar', decimals: 1, before: lag.perf.qr, after: lead.perf.qr },
          { label: 'Sending voltage', unit: 'kV', decimals: 2, before: lag.perf.vsLL, after: lead.perf.vsLL },
          { label: 'No-load receiving voltage', unit: 'kV', decimals: 2, before: lag.perf.vrNoLoadLL, after: lead.perf.vrNoLoadLL },
          { label: 'Regulation', unit: '%', decimals: 2, before: rb, after: ra },
          { label: 'Efficiency', unit: '%', decimals: 2, before: lag.perf.efficiencyPct, after: lead.perf.efficiencyPct },
        ],
        explain: [
          `Regulation compares the receiving voltage at no load (|V_s|/|A|, sending voltage unchanged) with the full-load ${fx(400, 0)} kV. A lagging load draws reactive power through the line’s reactance and needs a higher sending voltage: ${fx(lag.perf.vsLL, 1)} kV, regulation ${fx(rb, 2)} %.`,
          `A leading load supplies reactive power, so the drop across X reverses: the sending end needs only ${fx(lead.perf.vsLL, 1)} kV, and on removing the load the receiving end would fall to ${fx(lead.perf.vrNoLoadLL, 1)} kV — a regulation of ${fx(ra, 2)} % (${fx(-pctOf(lead.perf.vsLL, lag.perf.vsLL), 1)} % less sending voltage).`,
        ],
        chart: {
          xLabel: 'Power-factor angle of the load φ [°]  (− leading, + lagging)',
          yLabel: 'Regulation [%]',
          series: [
            {
              id: 'reg',
              label: 'Regulation',
              color: 'var(--ps-a)',
              points: Array.from({ length: 81 }, (_, i) => {
                const phi = -40 + i
                return [phi, exactPerf(L400, 250, { pMw: 300, pf: Math.cos((phi * Math.PI) / 180), lagging: phi >= 0 }).perf.regulationPct] as [number, number]
              }),
            },
          ],
          hlines: [{ y: 0, label: 'zero regulation' }],
          vlines: [
            { x: -(Math.acos(0.9) * 180) / Math.PI, label: '0.9 leading' },
            { x: (Math.acos(0.9) * 180) / Math.PI, label: '0.9 lagging' },
          ],
        },
      }
    },
  },
]

const cache = new Map<string, ExpResult>()
export function runExperiment(e: Experiment): ExpResult {
  let r = cache.get(e.id)
  if (!r) {
    r = e.run()
    cache.set(e.id, r)
  }
  return r
}
