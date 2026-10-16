import { abs, add } from '../../engine/complex.ts'
import { fx } from '../../ui/format.ts'
import type { Choice } from '../../ui/kit.tsx'
import { sourceDuty, trvMetrics } from './breaker.ts'
import { DIFF0, differential, I_RATED_LV } from './differential.ts'
import { apparentOhm, distanceCase, K0, L1_KM, ROUTE0, Z0L, Z1L, ZONES0 } from './distance.ts'
import { EARTH0, earthFault, genSequence } from './earthing.ts'
import { amps, pctChange, reachEffect, timesWords, zoneName, zPolar } from './words.ts'

/**
 * Predict-first experiments. Each run() computes both cases; the correct option is DECIDED from the computed numbers
 * (never written in advance), and every number in the explanation is read from the computation.
 */

export interface ExpRow {
  label: string
  before: string
  after: string
  changed: boolean
}
export interface ExpResult {
  answer: string
  rows: ExpRow[]
  explain: string[]
  /** Column headings. */
  cols: [string, string]
}
export interface Experiment {
  id: string
  title: string
  change: string
  question: string
  options: Choice[]
  run(): ExpResult
}

const row = (label: string, before: string, after: string): ExpRow => ({ label, before, after, changed: before !== after })

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'zones',
    title: 'A fault at 70 % and at 90 % of the line',
    change: `Two bolted three-phase faults on line L1 (${L1_KM} km): one 70 % of the way from A, one 90 %. The relay at A has the typical settings: zone 1 at 80 % (instantaneous), zone 2 at 120 % (0.3 s).`,
    question: 'Which zones do the two faults fall in?',
    options: [
      { id: '1-1', label: 'Both in zone 1 — both are on the protected line' },
      { id: '1-2', label: '70 % in zone 1, 90 % in zone 2' },
      { id: '2-2', label: 'Both in zone 2' },
      { id: '1-0', label: '70 % in zone 1, 90 % in no zone' },
    ],
    run() {
      const a = distanceCase({ km: 0.7 * L1_KM, type: '3ph', rfOhm: 0 }, ROUTE0, ZONES0).decisions.RA
      const b = distanceCase({ km: 0.9 * L1_KM, type: '3ph', rfOhm: 0 }, ROUTE0, ZONES0).decisions.RA
      return {
        answer: `${a.zone}-${b.zone}`,
        cols: ['70 % of L1', '90 % of L1'],
        rows: [
          row('Apparent impedance', zPolar(a.z!), zPolar(b.z!)),
          row('Zone', zoneName(a.zone), zoneName(b.zone)),
          row('Relay operates after', a.tripS !== null ? `${fx(a.tripS, 2)} s` : '—', b.tripS !== null ? `${fx(b.tripS, 2)} s` : '—'),
        ],
        explain: [
          `Z_app = m·Z₁L: ${zPolar(a.z!)} at 70 %, ${zPolar(b.z!)} at 90 %. Zone 1 reaches 80 % of Z₁L, so the 90 % fault lies outside it — in ${zoneName(b.zone)}, so the relay operates after ${fx(b.tripS ?? 0, 2)} s.`,
          `Zone 1 deliberately stops short of the far end: errors in the CTs, VTs and line data — and the downward tilt of fault resistance on a line exporting power — could make a fault just beyond B look inside the line, and zone 1 must never trip for the next line. The last ${100 - ZONES0.reachPct[0]} % is covered by zone 2 with a short delay (or, in practice, a signalling scheme with the far end).`,
        ],
      }
    },
  },
  {
    id: 'rf',
    title: 'Add fault resistance',
    change: 'An earth fault on phase a at 70 % of L1 is in zone 1 when bolted. Now the same fault has 10 Ω of resistance (an arc and a tower footing), and B has a 2000 MVA grid infeed.',
    question: 'What does the relay at A do now?',
    options: [
      { id: 'under', label: 'It sees the fault further away: it under-reaches (a slower zone or none)' },
      { id: 'none', label: 'Nothing changes: R_f is not part of the line' },
      { id: 'over', label: 'It sees the fault nearer: it over-reaches' },
    ],
    run() {
      const opts = { infeed: true, sscMva: 2000, deltaDeg: 0 }
      const a = distanceCase({ km: 0.7 * L1_KM, type: 'slg', rfOhm: 0 }, opts, ZONES0).decisions.RA
      const b = distanceCase({ km: 0.7 * L1_KM, type: 'slg', rfOhm: 10 }, opts, ZONES0).decisions.RA
      const single = distanceCase({ km: 0.7 * L1_KM, type: 'slg', rfOhm: 10 }, ROUTE0, ZONES0).decisions.RA
      const add = abs({ re: b.z!.re - a.z!.re, im: b.z!.im - a.z!.im })
      return {
        answer: reachEffect(a.zone, b.zone),
        cols: ['Bolted', 'R_f = 10 Ω'],
        rows: [
          row('Apparent impedance', zPolar(a.z!), zPolar(b.z!)),
          row('Zone', zoneName(a.zone), zoneName(b.zone)),
          row('Operates after', a.tripS !== null ? `${fx(a.tripS, 2)} s` : '—', b.tripS !== null ? `${fx(b.tripS, 2)} s` : 'no trip'),
        ],
        explain: [
          `R_f adds R_f·I_F/I_relay to the measurement: here the point moves by ${fx(add, 2)} Ω — ${timesWords(add / 10)} R_f — from ${zPolar(a.z!)} to ${zPolar(b.z!)}, ${zoneName(b.zone)}.`,
          `Why more than 10 Ω? The voltage across R_f is driven by the whole fault current, but the relay at A divides by its own current only; the infeed from B adds current through R_f that A never sees. Without the infeed the same fault reads ${zPolar(single.z!)} (${zoneName(single.zone)}).`,
          'Earth faults through resistance are the classic cause of distance-relay under-reach; quadrilateral characteristics, which reach further along R, are used against it.',
        ],
      }
    },
  },
  {
    id: 'k0',
    title: 'An earth fault without k₀ compensation',
    change: 'A bolted earth fault on phase a at 75 % of L1. The relay measures the phase-a loop as V_a/I_a — no residual compensation.',
    question: 'Compared with the true 75 % of Z₁L, what does the uncompensated relay see?',
    options: [
      { id: 'further', label: 'A larger impedance: the fault looks further away (under-reach)' },
      { id: 'nearer', label: 'A smaller impedance: the fault looks nearer (over-reach)' },
      { id: 'same', label: 'The same impedance' },
    ],
    run() {
      const c = distanceCase({ km: 0.75 * L1_KM, type: 'slg', rfOhm: 0 }, ROUTE0, ZONES0)
      const v = c.fault.relays.RA
      const zc = apparentOhm('aE', v, K0)!
      const zu = apparentOhm('aE', v, { re: 0, im: 0 })!
      const off = distanceCase({ km: 0.75 * L1_KM, type: 'slg', rfOhm: 0 }, ROUTE0, { ...ZONES0, k0On: false }).decisions.RA
      const r = abs(zu) / abs(zc)
      return {
        answer: Math.abs(r - 1) < 1e-6 ? 'same' : r > 1 ? 'further' : 'nearer',
        cols: ['With k₀', 'Without k₀'],
        rows: [row('Apparent impedance', zPolar(zc), zPolar(zu)), row('Zone', zoneName(c.decisions.RA.zone), zoneName(off.zone))],
        explain: [
          `Without compensation the relay reads ${zPolar(zu)} — ${timesWords(r)} the true ${zPolar(zc)}, ${zoneName(off.zone)} instead of zone 1.`,
          `The earth-fault current returns through the earth and the zero-sequence path, whose impedance per km is higher (|Z₀L| = ${fx(abs(Z0L) / abs(Z1L), 2)} × |Z₁L| here; k₀ = (Z₀ − Z₁)/(3Z₁) = ${fx(abs(K0), 3)}). V_a includes that extra drop; dividing by I_a + k₀·3I₀ instead of I_a removes it and gives m·Z₁L again.`,
        ],
      }
    },
  },
  {
    id: 'through',
    title: 'A fault outside the transformer',
    change: 'A three-phase fault on the 33 kV busbar, beyond transformer T2’s LV current transformers. T2 is YNd11; the differential relay compensates for Yd11; CTs are ideal.',
    question: 'Does the differential relay trip?',
    options: [
      { id: 'no', label: 'No — the current that enters the zone also leaves it' },
      { id: 'yes', label: 'Yes — the fault current is far above the relay’s setting' },
    ],
    run() {
      const d = differential('ext-lv', '3ph', DIFF0)
      const i = differential('int-lv', '3ph', DIFF0)
      return {
        answer: d.trip ? 'yes' : 'no',
        cols: ['External (through)', 'Internal, for comparison'],
        rows: [
          row('Phase-a current on 220 kV', `${fx(abs(d.hvA[0]), 0)} A`, `${fx(abs(i.hvA[0]), 0)} A`),
          row('Phase-a current at the LV CTs', `${fx(abs(d.lvA[0]), 0)} A`, `${fx(abs(i.lvA[0]), 0)} A`),
          row('I_op (phase a)', `${fx(d.iop[0], 3)} pu`, `${fx(i.iop[0], 3)} pu`),
          row('I_res (phase a)', `${fx(d.ires[0], 3)} pu`, `${fx(i.ires[0], 3)} pu`),
          row('Decision', d.trip ? 'trip' : 'restrain', i.trip ? 'trip' : 'restrain'),
        ],
        explain: [
          `A through current of ${fx(d.throughPu, 2)} pu of rating (${fx(abs(d.lvA[0]), 0)} A on 33 kV) — but after the vector-group compensation the HV and LV currents cancel: I_op = ${fx(d.iop[0], 3)} pu.`,
          `For a fault at T2’s own LV terminals (inside the zone) nothing comes out at the LV CTs, and I_op = ${fx(i.iop[0], 2)} pu = the fault current: the relay trips. Size alone does not decide — the balance does.`,
        ],
      }
    },
  },
  {
    id: 'spill',
    title: 'Tap changer off its matched position',
    change: 'The same external three-phase fault, but the on-load tap changer is 10 % away from the ratio the relay was matched to, and the LV CTs read 5 % high.',
    question: 'What does the relay do?',
    options: [
      { id: 'restrain', label: 'A spill current appears, but the bias keeps the relay stable' },
      { id: 'trip', label: 'The spill current trips it — a false trip' },
      { id: 'zero', label: 'Nothing: I_op stays exactly zero' },
    ],
    run() {
      const a = differential('ext-lv', '3ph', DIFF0)
      const b = differential('ext-lv', '3ph', { ...DIFF0, tapPct: 10, ctErrPct: 5 })
      const flat = Math.max(DIFF0.bias.is1, 0)
      return {
        answer: b.iop[0] < 1e-9 ? 'zero' : b.trip ? 'trip' : 'restrain',
        cols: ['Matched, ideal', 'Tap +10 %, CT +5 %'],
        rows: [
          row('I_op (phase a)', `${fx(a.iop[0], 3)} pu`, `${fx(b.iop[0], 3)} pu`),
          row('I_res (phase a)', `${fx(a.ires[0], 3)} pu`, `${fx(b.ires[0], 3)} pu`),
          row('Threshold', `${fx(a.thr[0], 3)} pu`, `${fx(b.thr[0], 3)} pu`),
          row('Decision', a.trip ? 'trip' : 'restrain', b.trip ? 'trip' : 'restrain'),
        ],
        explain: [
          `Spill I_op = ${fx(b.iop[0], 3)} pu = I_t·|ε + t/(1+t)| with I_t = ${fx(abs(b.lvA[0]) / I_RATED_LV, 2)} pu. A plain differential relay set at ${fx(flat, 2)} pu would ${b.iop[0] > flat ? 'trip' : 'not trip'}.`,
          `The bias raises the threshold with the through current: at I_res = ${fx(b.ires[0], 2)} pu it is ${fx(b.thr[0], 3)} pu, so the relay ${b.trip ? 'still trips' : 'stays stable'}. That is why the operating current is compared with a percentage of the restraint current.`,
        ],
      }
    },
  },
  {
    id: 'earthing',
    title: 'Unearthed versus solidly earthed',
    change: 'A line-to-ground fault at the generator terminals (Module 4’s 13.8 kV system, C₀ = 0.5 µF per phase). Once with the star point solidly earthed, once unearthed.',
    question: 'How does the unearthed system compare?',
    options: [
      { id: 'low-high', label: 'Much smaller fault current, but the healthy phases rise towards line voltage' },
      { id: 'low-same', label: 'Smaller current, healthy-phase voltages unchanged' },
      { id: 'high-high', label: 'Larger current and higher voltages' },
      { id: 'same', label: 'No difference' },
    ],
    run() {
      const s = earthFault({ ...EARTH0, method: 'solid' })
      const g = genSequence()
      const sum = abs(add(add(g.z1, g.z2), s.z0 ?? g.z0g))
      const share = { z12: (abs(add(g.z1, g.z2)) / sum) * 100, z0: (abs(s.z0 ?? g.z0g) / sum) * 100 }
      const u = earthFault({ ...EARTH0, method: 'unearthed' })
      const lower = u.iFaultA < s.iFaultA
      const vUp = u.vHealthyPu > s.vHealthyPu * 1.01
      return {
        answer: lower && vUp ? 'low-high' : lower ? 'low-same' : vUp ? 'high-high' : 'same',
        cols: ['Solidly earthed', 'Unearthed'],
        rows: [
          row('Earth-fault current', amps(s.iFaultA), amps(u.iFaultA)),
          row('Healthy-phase voltage', `${fx(s.vHealthyPu, 3)} pu`, `${fx(u.vHealthyPu, 3)} pu`),
          row('… in kV to earth', `${fx(s.vHealthyKv, 2)} kV`, `${fx(u.vHealthyKv, 2)} kV`),
        ],
        explain: [
          `Solid: ${amps(s.iFaultA)}, limited only by the machine’s own impedances, I_F = 3V/(Z₁ + Z₂ + Z₀): Z₁ + Z₂ make ${fx(share.z12, 0)} % of that sum and the small Z₀ ${fx(share.z0, 0)} % — which is why this earth fault exceeds a three-phase fault (3/(Z₁+Z₂+Z₀) against 1/Z₁). Unearthed: only the phases’ capacitive current flows, ${amps(u.iFaultA)} (${pctChange(u.iFaultA, s.iFaultA, 2)}).`,
          `But with no earth reference the whole system shifts: the faulted phase sits at earth potential and the healthy phases rise from ${fx(s.vHealthyPu, 3)} pu to ${fx(u.vHealthyPu, 3)} pu (√3 = ${fx(Math.sqrt(3), 3)}) — line voltage across their insulation. And a small capacitive arc can re-strike (arcing ground).`,
        ],
      }
    },
  },
  {
    id: 'trv',
    title: 'More capacitance at the breaker',
    change: 'Breaker CB1 (220 kV) interrupts a terminal fault. The capacitance on its source side is raised from 10 nF to 40 nF (more equipment on the busbar).',
    question: 'What happens to the rate of rise of the restriking voltage (RRRV)?',
    options: [
      { id: 'faster', label: 'It rises faster (higher RRRV)' },
      { id: 'slower', label: 'It rises more slowly (lower RRRV)' },
      { id: 'same', label: 'No change' },
    ],
    run() {
      const d = sourceDuty('CB1')
      const a = trvMetrics({ lH: d.lH, cF: 10e-9, vPeakV: d.vPeakV, rOhm: null })
      const b = trvMetrics({ lH: d.lH, cF: 40e-9, vPeakV: d.vPeakV, rOhm: null })
      const r = b.rrrv / a.rrrv
      return {
        answer: Math.abs(r - 1) < 1e-9 ? 'same' : r > 1 ? 'faster' : 'slower',
        cols: ['C = 10 nF', 'C = 40 nF'],
        rows: [
          row('Natural frequency f₀', `${fx(a.f0 / 1000, 2)} kHz`, `${fx(b.f0 / 1000, 2)} kHz`),
          row('TRV peak', `${fx(a.peakV / 1000, 1)} kV`, `${fx(b.peakV / 1000, 1)} kV`),
          row('RRRV', `${fx(a.rrrv / 1e9, 3)} kV/µs`, `${fx(b.rrrv / 1e9, 3)} kV/µs`),
        ],
        explain: [
          `ω₀ = 1/√(LC): four times the capacitance halves the natural frequency (${fx(a.f0 / 1000, 2)} → ${fx(b.f0 / 1000, 2)} kHz), and RRRV = V_m·ω₀ falls by the same factor (${timesWords(r)}).`,
          `The peak is unchanged at 2V_m = ${fx(a.peakV / 1000, 1)} kV in this lossless model — it only arrives later. Added capacitance makes the breaker’s job easier, which is why capacitors are sometimes fitted across breaker terminals.`,
        ],
      }
    },
  },
]
