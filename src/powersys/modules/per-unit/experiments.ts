import type { Network } from '../../network/types.ts'
import { fx } from '../../ui/format.ts'
import type { Choice } from '../../ui/kit.tsx'
import { baseVoltages, buildModel, compOf, faultPerUnit, networkBase, relDiff, transformerSides, zBase, type BaseChoice } from './calc.ts'
import { num } from './steps.ts'

/**
 * Per-unit experiments: change one thing about the bases (or look at one thing from another side), predict, then
 * compare the two computed columns. The correct answer is decided from the computed numbers — never written in
 * advance — and every number in an explanation is read from them.
 */

export interface ExpRow {
  label: string
  unit: string
  decimals: number
  values: [number, number]
}

export interface ExpResult {
  columns: [string, string]
  rows: ExpRow[]
  answer: string
  explain: string[]
}

export interface Experiment {
  id: string
  title: string
  /** What is changed, in one sentence. */
  change(net: Network): string
  question(net: Network): string
  options(net: Network): Choice[]
  /** Elements and zones to point at on the diagram. */
  focus: string[]
  run(net: Network): ExpResult
}

const mag = (z: { re: number; im: number }) => Math.hypot(z.re, z.im)
const FAULT_BUS = 'lv'
const label = (c: BaseChoice) => `${num(c.sMva)} MVA, ${num(c.vRefKv)} kV`

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'smva',
    title: 'Double the base power',
    change: () => 'S_base goes from 100 MVA to 200 MVA. Every voltage base stays as it is.',
    question: () => 'What happens to every per-unit impedance in the network?',
    options: () => [
      { id: 'half', label: 'They halve' },
      { id: 'same', label: 'They stay the same — the ohms have not changed' },
      { id: 'double', label: 'They double' },
    ],
    focus: ['G1', 'T1', 'L1', 'T2', 'L2', 'T3'],
    run: (net) => {
      const a = networkBase(net)
      const b = { ...a, sMva: a.sMva * 2 }
      const [ma, mb] = [buildModel(net, a), buildModel(net, b)]
      const [fa, fb] = [faultPerUnit(net, FAULT_BUS, a), faultPerUnit(net, FAULT_BUS, b)]
      const k = mag(mb.tx.T1.z) / mag(ma.tx.T1.z)
      const zA = zBase(ma.vb.hvA, a.sMva)
      const zB = zBase(mb.vb.hvA, b.sMva)
      return {
        columns: [`S_base ${num(a.sMva)} MVA`, `S_base ${num(b.sMva)} MVA`],
        rows: [
          { label: 'Z_base, 220 kV zone', unit: 'Ω', decimals: 1, values: [zA, zB] },
          { label: 'G1 x″d', unit: 'pu', decimals: 4, values: [ma.gen.G1.x, mb.gen.G1.x] },
          { label: 'T1 |z|', unit: 'pu', decimals: 4, values: [mag(ma.tx.T1.z), mag(mb.tx.T1.z)] },
          { label: 'L1 X', unit: 'pu', decimals: 4, values: [ma.line.L1.z.im, mb.line.L1.z.im] },
          { label: 'Fault at 11 kV: current', unit: 'pu', decimals: 4, values: [fa.i, fb.i] },
          { label: 'I_base, 11 kV zone', unit: 'kA', decimals: 4, values: [fa.iBaseKa, fb.iBaseKa] },
          { label: 'Fault at 11 kV: current', unit: 'kA', decimals: 4, values: [fa.iKa, fb.iKa] },
        ],
        answer: k > 1.5 ? 'double' : k < 0.75 ? 'half' : 'same',
        explain: [
          `Z_base = V_base² / S_base, so doubling S_base halves every Z_base (220 kV zone: ${fx(zA, 0)} → ${fx(zB, 0)} Ω). The ohms are the same, so every per-unit impedance Z / Z_base is multiplied by ${fx(k, 3)}: T1 ${fx(mag(ma.tx.T1.z), 4)} → ${fx(mag(mb.tx.T1.z), 4)} pu.`,
          `A fault current in per unit halves (${fx(fa.i, 4)} → ${fx(fb.i, 4)} pu) — but I_base doubles (${fx(fa.iBaseKa, 3)} → ${fx(fb.iBaseKa, 3)} kA), so in amperes nothing has changed: ${fx(fa.iKa, 4)} kA both times.`,
          'S_base is a bookkeeping choice. Pick a round number near the size of the equipment (100 MVA is the usual one for networks); the physics does not care.',
        ],
      }
    },
  },
  {
    id: 'vbase',
    title: 'Choose 230 kV as the transmission base',
    change: () => 'V_base in the 220 kV zone goes from 220 kV to 230 kV (S_base stays 100 MVA).',
    question: () => 'What becomes of the base voltage in the 11 kV zone?',
    options: (net) => {
      const lv = net.buses.find((b) => b.id === FAULT_BUS)!.kv
      return [
        { id: 'keep', label: `It stays ${num(lv)} kV — each zone keeps its own base` },
        { id: 'follow', label: `It becomes ${num(lv)} × 230 / 220 = ${fx((lv * 230) / 220, 2)} kV — every zone follows through the transformer ratios` },
        { id: 'single', label: 'It becomes 230 kV — one base voltage for the whole system' },
      ]
    },
    focus: ['z-gen', 'z-hvA', 'z-mvA', 'z-lv'],
    run: (net) => {
      const a = networkBase(net)
      const b = { ...a, vRefKv: 230 }
      const [va, vb] = [baseVoltages(net, a), baseVoltages(net, b)]
      const [ma, mb] = [buildModel(net, a), buildModel(net, b)]
      const [fa, fb] = [faultPerUnit(net, FAULT_BUS, a), faultPerUnit(net, FAULT_BUS, b)]
      const lv = vb[FAULT_BUS]
      const nomLv = net.buses.find((x) => x.id === FAULT_BUS)!.kv
      return {
        columns: [`V_base ${num(a.vRefKv)} kV`, `V_base ${num(b.vRefKv)} kV`],
        rows: [
          { label: 'V_base, generator zone', unit: 'kV', decimals: 3, values: [va.gen, vb.gen] },
          { label: 'V_base, transmission zone', unit: 'kV', decimals: 3, values: [va.hvA, vb.hvA] },
          { label: 'V_base, 33 kV zone', unit: 'kV', decimals: 3, values: [va.mvA, vb.mvA] },
          { label: 'V_base, 11 kV zone', unit: 'kV', decimals: 3, values: [va.lv, vb.lv] },
          { label: 'Nominal 11 kV in per unit', unit: 'pu', decimals: 4, values: [nomLv / va.lv, nomLv / vb.lv] },
          { label: 'T3 |z|', unit: 'pu', decimals: 4, values: [mag(ma.tx.T3.z), mag(mb.tx.T3.z)] },
          { label: 'T2 off-nominal ratio t', unit: '', decimals: 4, values: [ma.tx.T2.tap, mb.tx.T2.tap] },
          { label: 'Fault at 11 kV: current', unit: 'kA', decimals: 4, values: [fa.iKa, fb.iKa] },
        ],
        answer: Math.abs(lv - nomLv) < 1e-9 ? 'keep' : Math.abs(lv - 230) < 1e-9 ? 'single' : 'follow',
        explain: [
          `Choosing V_base in one zone fixes it in every zone: across each transformer the base changes in the transformer’s ratio. With 230 kV in the transmission zone the 11 kV zone’s base is ${fx(lv, 3)} kV and the generator zone’s ${fx(vb.gen, 3)} kV.`,
          `The nominal 11 kV is now ${fx(nomLv / lv, 4)} pu instead of 1, and every per-unit impedance changes by (220/230)² = ${fx((220 / 230) ** 2, 4)}. The off-nominal ratio t of T2 does not change (${fx(mb.tx.T2.tap, 4)}), and neither does the fault current: ${fx(fa.iKa, 4)} kA.`,
          'In practice the base is the nominal voltage of each zone — so healthy voltages read close to 1 pu — but any consistent choice gives the same physical answers.',
        ],
      }
    },
  },
  {
    id: 'sides',
    title: 'Look at T1 from either side',
    change: (net) => {
      const s = transformerSides(compOf(net, 'T1', 'transformer'), net.baseMva, baseVoltages(net, networkBase(net)))
      return `T1’s reactance in ohms: ${fx(s.from.ohm.im, 2)} Ω seen from its ${num(s.from.ratedKv)} kV winding, ${fx(s.to.ohm.im, 4)} Ω seen from its ${num(s.to.ratedKv)} kV winding — the same transformer.`
    },
    question: () => 'Divide each by the base impedance of its own side. The per-unit values are…',
    options: (net) => {
      const t = compOf(net, 'T1', 'transformer')
      return [
        { id: 'hv', label: `${fx((t.kvFrom / t.kvTo) ** 2, 0)} times larger on the ${num(t.kvFrom)} kV side, like the ohms` },
        { id: 'same', label: 'Exactly the same' },
        { id: 'lv', label: `Larger on the ${num(t.kvTo)} kV side` },
      ]
    },
    focus: ['T1'],
    run: (net) => {
      const t = compOf(net, 'T1', 'transformer')
      const c = networkBase(net)
      const s = transformerSides(t, c.sMva, baseVoltages(net, c))
      const d = relDiff(s.from.pu.im, s.to.pu.im)
      return {
        columns: [`${num(t.kvFrom)} kV side`, `${num(t.kvTo)} kV side`],
        rows: [
          { label: 'Rated winding voltage', unit: 'kV', decimals: 1, values: [s.from.ratedKv, s.to.ratedKv] },
          { label: 'X in ohms, referred to this side', unit: 'Ω', decimals: 4, values: [s.from.ohm.im, s.to.ohm.im] },
          { label: 'V_base of this side', unit: 'kV', decimals: 1, values: [s.from.vBaseKv, s.to.vBaseKv] },
          { label: 'Z_base of this side', unit: 'Ω', decimals: 4, values: [s.from.zBaseOhm, s.to.zBaseOhm] },
          { label: 'X in per unit', unit: 'pu', decimals: 6, values: [s.from.pu.im, s.to.pu.im] },
        ],
        answer: d < 1e-9 ? 'same' : s.from.pu.im > s.to.pu.im ? 'hv' : 'lv',
        explain: [
          `Referring an impedance through a transformer multiplies it by the turns ratio squared: (${num(t.kvFrom)}/${num(t.kvTo)})² = ${fx((t.kvFrom / t.kvTo) ** 2, 1)}. The base impedances differ by exactly the same factor, because the base voltages are in the same ratio: ${fx(s.from.zBaseOhm, 1)} Ω / ${fx(s.to.zBaseOhm, 4)} Ω.`,
          `So the ratio cancels: ${fx(s.from.ohm.im, 3)} / ${fx(s.from.zBaseOhm, 1)} = ${fx(s.to.ohm.im, 5)} / ${fx(s.to.zBaseOhm, 4)} = ${fx(s.to.pu.im, 4)} pu. In per unit an ideal transformer is a 1 : 1 connection — the turns ratio disappears from the diagram.`,
          'This only holds when the base voltages are in the transformer’s ratio. When they are not (a tap), what is left over is the off-nominal ratio t, drawn as a small ideal transformer.',
        ],
      }
    },
  },
  {
    id: 'nameplate',
    title: 'Put T3’s nameplate on the system base',
    change: (net) => {
      const t = compOf(net, 'T3', 'transformer')
      return `T3’s nameplate says ${num(t.zPct)} % on its own ${num(t.ratedMva)} MVA. The system base is ${num(net.baseMva)} MVA (and ${num(t.kvTo)} kV on its ${num(t.kvTo)} kV side, its rated voltage).`
    },
    question: (net) => `On the ${num(net.baseMva)} MVA system base, T3’s impedance is…`,
    options: (net) => {
      const t = compOf(net, 'T3', 'transformer')
      const k = net.baseMva / t.ratedMva
      return [
        { id: String(Number((t.zPct / k).toFixed(3))), label: `${num(t.zPct / k)} % — divide by ${num(k)}` },
        { id: 'own', label: `Still ${num(t.zPct)} % — a percentage does not depend on the base` },
        { id: String(Number((t.zPct * k).toFixed(3))), label: `${num(t.zPct * k)} % — multiply by ${num(k)}` },
      ]
    },
    focus: ['T3'],
    run: (net) => {
      const t = compOf(net, 'T3', 'transformer')
      const c = networkBase(net)
      const vb = baseVoltages(net, c)
      const zOwn = t.zPct / 100
      const zSys = mag(buildModel(net, c).tx.T3.z)
      const zbOwn = zBase(t.kvTo, t.ratedMva)
      const zbSys = zBase(vb[t.to], c.sMva)
      const pct = zSys * 100
      const ids = [Number((t.zPct / (c.sMva / t.ratedMva)).toFixed(3)), Number((t.zPct * (c.sMva / t.ratedMva)).toFixed(3))]
      const hit = ids.find((x) => Math.abs(x - pct) < 1e-6)
      return {
        columns: [`own rating (${num(t.ratedMva)} MVA)`, `system base (${num(c.sMva)} MVA)`],
        rows: [
          { label: 'S_base', unit: 'MVA', decimals: 0, values: [t.ratedMva, c.sMva] },
          { label: `V_base (${num(t.kvTo)} kV side)`, unit: 'kV', decimals: 2, values: [t.kvTo, vb[t.to]] },
          { label: 'Z_base', unit: 'Ω', decimals: 4, values: [zbOwn, zbSys] },
          { label: '|Z| in per unit', unit: 'pu', decimals: 4, values: [zOwn, zSys] },
          { label: '|Z| in ohms', unit: 'Ω', decimals: 4, values: [zOwn * zbOwn, zSys * zbSys] },
        ],
        answer: hit !== undefined ? String(hit) : Math.abs(pct - t.zPct) < 1e-6 ? 'own' : 'none',
        explain: [
          `Z_new = Z_old · (S_new / S_old) · (V_old / V_new)² = ${fx(zOwn, 3)} × (${num(c.sMva)} / ${num(t.ratedMva)}) × (${num(t.kvTo)} / ${num(vb[t.to])})² = ${fx(zSys, 4)} pu (${fx(pct, 1)} %).`,
          `The ohms do not change (${fx(zOwn * zbOwn, 4)} Ω on the ${num(t.kvTo)} kV side): a bigger S_base means a smaller Z_base (${fx(zbOwn, 3)} → ${fx(zbSys, 3)} Ω), so the same ohms are a bigger fraction of it.`,
          `This is why nameplates use the machine’s own rating: on its own rating a transformer’s impedance falls in a narrow band whatever its size (here ${net.components
            .filter((x) => x.kind === 'transformer')
            .map((x) => (x.kind === 'transformer' ? `${num(x.zPct)} %` : ''))
            .join(', ')} for ${net.components
            .filter((x) => x.kind === 'transformer')
            .map((x) => (x.kind === 'transformer' ? `${num(x.ratedMva)}` : ''))
            .join(', ')} MVA) — it must be converted to the common base before it is combined with anything else.`,
        ],
      }
    },
  },
  {
    id: 'fault',
    title: 'The same fault on a different base',
    change: () => 'A bolted three-phase fault at the town’s 11 kV bus, worked in per unit twice: on 100 MVA / 220 kV, and on 250 MVA / 230 kV (in the transmission zone).',
    question: () => 'On the second base, the fault current in kiloamperes…',
    options: () => [
      { id: 'scale', label: 'rises 2.5 times, with S_base' },
      { id: 'same', label: 'is exactly the same' },
      { id: 'v2', label: 'changes by (230 / 220)²' },
    ],
    focus: ['G1', 'T1', 'L1', 'T2', 'L2', 'T3', 'lv'],
    run: (net) => {
      const a = networkBase(net)
      const b: BaseChoice = { ...a, sMva: 250, vRefKv: 230 }
      const [fa, fb] = [faultPerUnit(net, FAULT_BUS, a), faultPerUnit(net, FAULT_BUS, b)]
      const r = fb.iKa / fa.iKa
      return {
        columns: [`Base A: ${label(a)}`, `Base B: ${label(b)}`],
        rows: [
          { label: 'V_base at the fault (11 kV zone)', unit: 'kV', decimals: 3, values: [fa.vBaseKv, fb.vBaseKv] },
          { label: 'E, pre-fault voltage there', unit: 'pu', decimals: 4, values: [fa.e, fb.e] },
          { label: 'X_total seen from the fault', unit: 'pu', decimals: 4, values: [fa.x, fb.x] },
          { label: 'I_f = E / X_total', unit: 'pu', decimals: 4, values: [fa.i, fb.i] },
          { label: 'I_base, 11 kV zone', unit: 'kA', decimals: 4, values: [fa.iBaseKa, fb.iBaseKa] },
          { label: 'I_f = I_f(pu) · I_base', unit: 'kA', decimals: 4, values: [fa.iKa, fb.iKa] },
        ],
        answer: relDiff(fa.iKa, fb.iKa) < 1e-9 ? 'same' : Math.abs(r - 2.5) < 0.05 ? 'scale' : 'v2',
        explain: [
          `Every per-unit number changes: X_total ${fx(fa.x, 4)} → ${fx(fb.x, 4)} pu, I_f ${fx(fa.i, 4)} → ${fx(fb.i, 4)} pu. Converted back with each base’s own I_base the current is ${fx(fa.iKa, 4)} kA and ${fx(fb.iKa, 4)} kA — the same physical current (difference ${fx(relDiff(fa.iKa, fb.iKa) * 100, 10)} %).`,
          'A per-unit system only rescales the quantities. Solving in per unit and converting back always gives the physical answer — as long as every value is on the same base.',
          'Assumes: reactances only (resistances neglected), no-load before the fault (loads and line charging neglected), generator EMF 1.0 pu of its rated 13.8 kV behind x″d.',
        ],
      }
    },
  },
  {
    id: 'tap',
    title: 'Let the bases follow the rated ratios',
    change: (net) => {
      const t2 = compOf(net, 'T2', 'transformer')
      const t3 = compOf(net, 'T3', 'transformer')
      return `T2 is rated ${num(t2.kvFrom)}/${num(t2.kvTo)} kV and T3 ${num(t3.kvFrom)}/${num(t3.kvTo)} kV (both on a 5 % tap). Instead of the nominal 220/33 and 33/11 kV, let V_base cross each transformer in its rated ratio.`
    },
    question: () => 'What happens to T2’s off-nominal ratio t?',
    options: (net) => {
      const t = buildModel(net, networkBase(net)).tx.T2.tap
      return [
        { id: 'same', label: `It stays ${fx(t, 3)} — a tap is a tap` },
        { id: 'one', label: 'It becomes 1 — the tap is absorbed into the base' },
        { id: 'inv', label: `It becomes ${fx(1 / t, 3)}` },
      ]
    },
    focus: ['T2', 'T3', 'z-mvA', 'z-lv'],
    run: (net) => {
      const a = networkBase(net)
      const b: BaseChoice = { ...a, follow: 'rated' }
      const [ma, mb] = [buildModel(net, a), buildModel(net, b)]
      const [fa, fb] = [faultPerUnit(net, FAULT_BUS, a), faultPerUnit(net, FAULT_BUS, b)]
      const nomMv = net.buses.find((x) => x.id === 'mvA')!.kv
      const t = mb.tx.T2.tap
      return {
        columns: ['nominal ratios', 'rated ratios'],
        rows: [
          { label: 'V_base, 33 kV zone', unit: 'kV', decimals: 3, values: [ma.vb.mvA, mb.vb.mvA] },
          { label: 'V_base, 11 kV zone', unit: 'kV', decimals: 3, values: [ma.vb.lv, mb.vb.lv] },
          { label: 'T2 off-nominal ratio t', unit: '', decimals: 4, values: [ma.tx.T2.tap, mb.tx.T2.tap] },
          { label: 'T3 off-nominal ratio t', unit: '', decimals: 4, values: [ma.tx.T3.tap, mb.tx.T3.tap] },
          { label: 'T2 |z|', unit: 'pu', decimals: 4, values: [mag(ma.tx.T2.z), mag(mb.tx.T2.z)] },
          { label: 'Nominal 33 kV in per unit', unit: 'pu', decimals: 4, values: [nomMv / ma.vb.mvA, nomMv / mb.vb.mvA] },
          { label: 'Fault at 11 kV: current', unit: 'kA', decimals: 4, values: [fa.iKa, fb.iKa] },
        ],
        answer: Math.abs(t - 1) < 1e-9 ? 'one' : Math.abs(t - ma.tx.T2.tap) < 1e-9 ? 'same' : 'inv',
        explain: [
          `With V_base following T2’s rated ratio the 33 kV zone’s base becomes ${fx(mb.vb.mvA, 2)} kV, the ratio of the bases equals the ratio of the windings, and t = ${fx(t, 4)}: the tap has moved into the base. T2 is then just its nameplate on ${num(a.sMva)} MVA: ${fx(mag(mb.tx.T2.z), 4)} pu.`,
          `The price: the nominal 33 kV is no longer 1 pu but ${fx(nomMv / mb.vb.mvA, 4)} pu, and the bases depend on today’s tap positions. That is why network studies keep V_base = nominal voltage and carry taps as off-nominal ratios (as the shared load-flow engine does).`,
          `Either way the physics is the same: ${fx(fa.iKa, 4)} kA and ${fx(fb.iKa, 4)} kA for a fault at the 11 kV bus.`,
        ],
      }
    },
  },
]

export function runExperiment(e: Experiment, net: Network): ExpResult {
  return e.run(net)
}
