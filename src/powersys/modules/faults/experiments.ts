import { abs } from '../../engine/complex.ts'
import { fx } from '../../ui/format.ts'
import type { Choice } from '../../ui/kit.tsx'
import { referRatio, relayCurrents, SETUP0, allTypes, faultModel, faultNetwork, type Setup } from './study.ts'
import { FAULT_LABEL, FAULT_TYPES, type FaultType } from './sequence.ts'
import { faultStudy, theveninAt, threePhaseWithLoadFlow } from './zbus.ts'

/**
 * Fault experiments: predict, then compare. Every answer is decided from the computed results (never written in
 * advance), and every number in a table or an explanation is read from them.
 */

export interface ExpTable {
  cols: string[]
  rows: Array<{ label: string; unit: string; decimals: number; values: Array<number | null> }>
}

export interface ExpResult {
  answer: string
  table: ExpTable
  explain: string[]
  /** What to draw: the fault and the network it is in (the case after the change). */
  show: { setup: Setup; bus: string; type: FaultType }
}

export interface FaultExperiment {
  id: string
  title: string
  change: string
  question: string
  options: Choice[]
  run(): ExpResult
}

const kaOf = (setup: Setup, bus: string, t: FaultType) => faultStudy(faultModel(setup), bus, t).faultKa
const j = (x: number) => `j${fx(x, 3)}`

export const EXPERIMENTS: FaultExperiment[] = [
  {
    id: 'severity',
    title: 'The worst fault at the generator terminals',
    change: 'A fault at the 13.8 kV generator terminals — each of the four types in turn, bolted (Z_f = 0).',
    question: 'Which type of fault draws the largest current there?',
    options: FAULT_TYPES.map((t) => ({ id: t, label: FAULT_LABEL[t] })),
    run: () => {
      const m = faultModel()
      const all = allTypes(m, 'gen')
      const best = FAULT_TYPES.reduce((a, t) => (all[t].faultKa > all[a].faultKa ? t : a), '3ph' as FaultType)
      const th = theveninAt(m, m.busIds.indexOf('gen'))
      return {
        answer: best,
        table: {
          cols: ['Largest phase current [kA]', 'Compared with three-phase [%]'],
          rows: FAULT_TYPES.map((t) => ({ label: FAULT_LABEL[t], unit: '', decimals: 1, values: [all[t].faultKa, (all[t].faultKa / all['3ph'].faultKa) * 100] })),
        },
        explain: [
          `At the generator terminals Z₁ = Z₂ = ${j(th.z1!.im)} pu (the machine’s x″d and x₂ on the 100 MVA base), but Z₀ = ${j(th.z0!.im)} pu: only the generator’s own small zero-sequence reactance — T1’s delta winding on this side blocks any zero-sequence path from the 220 kV network.`,
          `A line-to-ground fault draws 3·V_f/(Z₁ + Z₂ + Z₀) = 3/${fx(2 * th.z1!.im + th.z0!.im, 3)} = ${fx(abs(all.slg.point.iabc[0]), 2)} pu, against V_f/Z₁ = ${fx(abs(all['3ph'].point.iabc[0]), 2)} pu for a three-phase fault: whenever Z₀ < Z₁ the earth fault is the larger — here ${fx(all.slg.faultKa, 1)} kA against ${fx(all['3ph'].faultKa, 1)} kA.`,
          'That is one reason generator neutrals are usually earthed through an impedance: it adds 3·Z_n to the zero sequence and limits the earth-fault current (try the reactor experiment).',
        ],
        show: { setup: SETUP0, bus: 'gen', type: best },
      }
    },
  },
  {
    id: 'unearthed',
    title: 'An earth fault on the 33 kV line',
    change: 'Phase a of the 33 kV line touches earth at the distribution substation (bus “Distribution s/s 33 kV”).',
    question: 'How much current flows into this earth fault?',
    options: [
      { id: 'more', label: 'More than a three-phase fault at the same place' },
      { id: 'similar', label: 'Roughly as much as a three-phase fault' },
      { id: 'none', label: 'Practically none' },
    ],
    run: () => {
      const base = faultModel()
      const lg = faultStudy(base, 'mvB', 'slg')
      const f3 = faultStudy(base, 'mvB', '3ph')
      const withEt: Setup = { ...SETUP0, et33: true, rnOhm: 10 }
      const lgEt = faultStudy(faultModel(withEt), 'mvB', 'slg')
      const r = lg.faultKa / f3.faultKa
      const vb = abs(lg.buses.find((b) => b.id === 'mvB')!.vabc[1])
      const vbEt = abs(lgEt.buses.find((b) => b.id === 'mvB')!.vabc[1])
      return {
        answer: r < 0.05 ? 'none' : r > 1.05 ? 'more' : 'similar',
        table: {
          cols: ['As built (unearthed)', 'With an earthing transformer, R_n = 10 Ω'],
          rows: [
            { label: 'Earth-fault current', unit: 'kA', decimals: 3, values: [lg.faultKa, lgEt.faultKa] },
            { label: 'Three-phase fault current (same bus)', unit: 'kA', decimals: 3, values: [f3.faultKa, faultStudy(faultModel(withEt), 'mvB', '3ph').faultKa] },
            { label: 'Healthy phase b voltage at the fault', unit: 'pu', decimals: 3, values: [vb, vbEt] },
          ],
        },
        explain: [
          `The 33 kV system is supplied through T2’s delta winding and feeds T3’s delta winding: nowhere in it is a star point connected to earth. An earth-fault current has to return through earth to a star point — there is none, so the zero-sequence network has no path to the reference, Z₀ is infinite, and I = 3V_f/(Z₁ + Z₂ + Z₀) = ${fx(lg.faultKa * 1000, 0)} A.`,
          `But the fault pulls phase a to earth potential and the whole 33 kV system floats with it: the healthy phases rise to ${fx(vb, 3)} pu = √3 × normal (line voltage to earth). Cable and line insulation is stressed, and a second earth fault on another phase becomes a phase-to-phase fault. (A real system’s capacitance to earth would also carry a small current — not modelled here.)`,
          `Utilities therefore earth such a system on purpose, e.g. with an earthing (zig-zag) transformer and a neutral resistor at the substation. With one (R_n = 10 Ω) the same fault draws ${fx(lgEt.faultKa * 1000, 0)} A — enough for earth-fault protection to see — and the healthy phases rise only to ${fx(vbEt, 3)} pu.`,
        ],
        show: { setup: SETUP0, bus: 'mvB', type: 'slg' },
      }
    },
  },
  {
    id: 'll',
    title: 'Line-to-line against three-phase',
    change: 'Phases b and c touch at the town’s 11 kV bus (no earth involved). Compare with a three-phase fault at the same place.',
    question: 'The line-to-line fault current is about…',
    options: [
      { id: 'half', label: 'half of the three-phase current' },
      { id: 'r87', label: 'seven-eighths (≈ 87 %) of it' },
      { id: 'same', label: 'the same' },
      { id: 'more', label: 'more than the three-phase current' },
    ],
    run: () => {
      const m = faultModel()
      const a = allTypes(m, 'lv')
      const r = a.ll.faultKa / a['3ph'].faultKa
      return {
        answer: r < 0.7 ? 'half' : r < 0.95 ? 'r87' : r < 1.05 ? 'same' : 'more',
        table: {
          cols: ['Three-phase', 'Line-to-line'],
          rows: [
            { label: 'Fault current (largest phase)', unit: 'kA', decimals: 3, values: [a['3ph'].faultKa, a.ll.faultKa] },
            { label: 'Positive-sequence current |I₁|', unit: 'pu', decimals: 3, values: [abs(a['3ph'].point.i012[1]), abs(a.ll.point.i012[1])] },
            { label: 'Negative-sequence current |I₂|', unit: 'pu', decimals: 3, values: [abs(a['3ph'].point.i012[2]), abs(a.ll.point.i012[2])] },
            { label: 'Voltage of phase a at the fault', unit: 'pu', decimals: 3, values: [abs(a['3ph'].point.vabc[0]), abs(a.ll.point.vabc[0])] },
          ],
        },
        explain: [
          `For the line-to-line fault the positive- and negative-sequence networks are connected in parallel at the fault: I₁ = −I₂ = V_f/(Z₁ + Z₂). Every impedance here is the same in both sequences, so Z₂ = Z₁ and I₁ is half the three-phase value (${fx(abs(a.ll.point.i012[1]), 3)} against ${fx(abs(a['3ph'].point.i012[1]), 3)} pu).`,
          `The phase current is I_b = (a² − a)·I₁ = −j√3·I₁, so I_LL = √3/2 · I_3φ = ${fx(r * 100, 1)} % — ${fx(a.ll.faultKa, 2)} kA against ${fx(a['3ph'].faultKa, 2)} kA. This ratio is the basis of the minimum-fault-current check in protection settings.`,
          `Phase a is not involved: it keeps ${fx(abs(a.ll.point.vabc[0]), 3)} pu while b and c collapse to the same value.`,
        ],
        show: { setup: SETUP0, bus: 'lv', type: 'll' },
      }
    },
  },
  {
    id: 'reactor',
    title: 'Earth the generator through a reactor',
    change: 'The generator’s star point is earthed through a reactor X_n = 0.1 pu (on the machine’s rating) instead of solidly.',
    question: 'What happens to the line-to-ground fault current at the generator terminals?',
    options: [
      { id: 'same', label: 'Nothing — the reactor is in the neutral, not in the phases' },
      { id: 'above', label: 'It falls, but stays above the three-phase current' },
      { id: 'below', label: 'It falls below the three-phase current' },
    ],
    run: () => {
      const s1: Setup = { ...SETUP0, genEarth: 'reactor', xnPu: 0.1 }
      const m0 = faultModel()
      const m1 = faultModel(s1)
      const k = m0.busIds.indexOf('gen')
      const lg0 = kaOf(SETUP0, 'gen', 'slg')
      const lg1 = kaOf(s1, 'gen', 'slg')
      const f3 = kaOf(SETUP0, 'gen', '3ph')
      const z00 = theveninAt(m0, k).z0!.im
      const z01 = theveninAt(m1, k).z0!.im
      return {
        answer: Math.abs(lg1 - lg0) / lg0 < 0.01 ? 'same' : lg1 > f3 ? 'above' : 'below',
        table: {
          cols: ['Solidly earthed', 'Through X_n = 0.1 pu'],
          rows: [
            { label: 'Zero-sequence impedance Z₀ (imaginary part)', unit: 'pu', decimals: 4, values: [z00, z01] },
            { label: 'Line-to-ground fault current', unit: 'kA', decimals: 2, values: [lg0, lg1] },
            { label: 'Three-phase fault current', unit: 'kA', decimals: 2, values: [f3, kaOf(s1, 'gen', '3ph')] },
          ],
        },
        explain: [
          `The neutral carries the sum of the three phase currents, I_n = 3·I₀, so the voltage across the reactor is 3·I₀·X_n: in the zero-sequence network it appears as 3·X_n. On the 100 MVA base Z₀ rises from ${j(z00)} to ${j(z01)} pu.`,
          `The earth-fault current falls from ${fx(lg0, 1)} kA to ${fx(lg1, 1)} kA — ${lg1 < f3 ? 'below' : 'still above'} the ${fx(f3, 1)} kA of a three-phase fault, which the reactor does not change at all (no neutral current flows in a balanced fault).`,
          'Limiting the earth-fault current protects the generator’s core and windings from damage during an internal earth fault.',
        ],
        show: { setup: s1, bus: 'gen', type: 'slg' },
      }
    },
  },
  {
    id: 'prefault',
    title: 'Does the load before the fault matter?',
    change: 'Instead of 1.0 pu everywhere and no load, start from the load flow (the generator at 1.02 pu, the loads as impedances, the transformer taps and the line charging).',
    question: 'How much does the three-phase fault current at the town change?',
    options: [
      { id: 'tiny', label: 'Less than 1 %' },
      { id: 'few', label: 'A few per cent (1–10 %)' },
      { id: 'big', label: 'More than 10 %' },
    ],
    run: () => {
      const m = faultModel()
      const flat = faultStudy(m, 'lv', '3ph')
      const lf = threePhaseWithLoadFlow(faultNetwork(SETUP0), 'lv')!
      const k = m.busIds.indexOf('lv')
      const d = ((lf.ka - flat.faultKa) / flat.faultKa) * 100
      return {
        answer: Math.abs(d) < 1 ? 'tiny' : Math.abs(d) <= 10 ? 'few' : 'big',
        table: {
          cols: ['1.0 pu, no load (classical)', 'From the load flow'],
          rows: [
            { label: 'Pre-fault voltage at the town', unit: 'pu', decimals: 4, values: [1, abs(lf.vPre[k])] },
            { label: 'Thevenin impedance |Z_kk|', unit: 'pu', decimals: 4, values: [abs(flat.z1!), abs(lf.zkk)] },
            { label: 'Three-phase fault current', unit: 'kA', decimals: 3, values: [flat.faultKa, lf.ka] },
          ],
        },
        explain: [
          `The fault current changes by ${d > 0 ? '+' : ''}${fx(d, 1)} %: ${fx(flat.faultKa, 3)} → ${fx(lf.ka, 3)} kA. By superposition I_f = V_k⁰ / Z_kk, so what matters is the pre-fault voltage at the fault (${fx(abs(lf.vPre[k]), 4)} pu instead of 1.0) and the Thevenin impedance, which the loads (in parallel) and the taps change a little (${fx(abs(flat.z1!), 4)} → ${fx(abs(lf.zkk), 4)} pu).`,
          'The load current itself is small against the fault current, which is why the classical study ignores it. Standards cover the difference with a voltage factor instead of a load flow: IEC 60909 multiplies the nominal voltage by c = 1.1 when it calculates maximum short-circuit currents in medium- and high-voltage networks.',
        ],
        show: { setup: SETUP0, bus: 'lv', type: '3ph' },
      }
    },
  },
  {
    id: 'dyn',
    title: 'A line-to-line fault seen through the transformer',
    change: 'A line-to-line fault on the town feeder. The town’s relay R1 measures 11 kV currents; the 33 kV relay R2 measures the currents on the other side of the Dyn transformer T3.',
    question: 'Referred to 11 kV, R2’s largest phase current is…',
    options: [
      { id: 'less', label: 'smaller than R1’s' },
      { id: 'same', label: 'the same as R1’s — it is the same fault current' },
      { id: 'more', label: 'larger than R1’s' },
    ],
    run: () => {
      const m = faultModel()
      const k = referRatio(m)
      const c3 = relayCurrents(m, 'feeder', '3ph')
      const cl = relayCurrents(m, 'feeder', 'll')
      const r3 = (c3.upA * k) / c3.downA
      const rl = (cl.upA * k) / cl.downA
      return {
        answer: rl < 0.97 ? 'less' : rl > 1.03 ? 'more' : 'same',
        table: {
          cols: ['Three-phase fault', 'Line-to-line fault'],
          rows: [
            { label: 'R1 (11 kV) largest phase current', unit: 'A', decimals: 0, values: [c3.downA, cl.downA] },
            { label: 'R2 (33 kV) largest phase current', unit: 'A', decimals: 0, values: [c3.upA, cl.upA] },
            { label: 'R2 referred to 11 kV (× 33/11)', unit: 'A', decimals: 0, values: [c3.upA * k, cl.upA * k] },
            { label: 'R2 (referred) ÷ R1', unit: '', decimals: 3, values: [r3, rl] },
          ],
        },
        explain: [
          `For a three-phase fault the two relays see the same current (ratio ${fx(r3, 3)}). For a line-to-line fault on the 11 kV side, the ±30° shifts of the Dyn transformer recombine the positive- and negative-sequence currents differently on the 33 kV side: one 33 kV phase carries 2/√3 = ${fx(2 / Math.sqrt(3), 3)} times the referred 11 kV current, the other two half of that.`,
          `So R2 sees relatively more current (ratio ${fx(rl, 3)}) and runs faster than the three-phase grading suggests: the grading margin shrinks. Protection engineers check grading for every fault type, not only the largest current.`,
        ],
        show: { setup: SETUP0, bus: 'lv', type: 'll' },
      }
    },
  },
]

/** Cached results (the networks are fixed). */
const cache = new Map<string, ExpResult>()
export function runExperiment(e: FaultExperiment): ExpResult {
  let r = cache.get(e.id)
  if (!r) {
    r = e.run()
    cache.set(e.id, r)
  }
  return r
}
