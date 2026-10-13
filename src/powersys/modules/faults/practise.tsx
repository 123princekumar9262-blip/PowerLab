import { useMemo } from 'react'
import { abs } from '../../engine/complex.ts'
import { completeActivity } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Quiz, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import { zText } from './diagrams.tsx'
import { tripTime } from './relays.ts'
import { toSeq } from './sequence.ts'
import { allTypes, faultModel } from './study.ts'
import { C } from '../../engine/complex.ts'
import { faultStudy, theveninAt } from './zbus.ts'

const MODULE = 'faults'

export function Practise() {
  const m = useMemo(() => faultModel(), [])
  const hvA = faultStudy(m, 'hvA', '3ph')
  const gen = theveninAt(m, m.busIds.indexOf('gen'))
  const genLg = abs(allTypes(m, 'gen').slg.point.iabc[0])
  const town = allTypes(m, 'lv')
  const v0 = abs(toSeq([C(1), C(0), C(0)])[0])
  const tSi = tripTime('SI', 0.2, 100, 500)
  const items: QuizItem[] = [
    {
      id: 'level',
      kind: 'number',
      q: `The Thevenin impedance at the 220 kV switchyard is |Z_kk| = ${fx(abs(hvA.z1!), 4)} pu on a 100 MVA base. What is the three-phase fault level there?`,
      answer: hvA.levelMva,
      unit: 'MVA',
      tol: Math.max(1, hvA.levelMva * 0.01),
      why: `S_sc = S_base / |Z_kk| = 100 / ${fx(abs(hvA.z1!), 4)} = ${fx(hvA.levelMva, 1)} MVA (V_f = 1 pu).`,
    },
    {
      id: 'lg-gen',
      kind: 'number',
      q: `At the generator terminals Z₁ = Z₂ = ${zText(gen.z1)} pu and Z₀ = ${zText(gen.z0)} pu. What is the line-to-ground fault current |I_a| in per unit (bolted, V_f = 1)?`,
      answer: genLg,
      unit: 'pu',
      tol: 0.02,
      why: `I_a = 3·I₀ = 3 / (Z₁ + Z₂ + Z₀) = 3 / ${fx(2 * gen.z1!.im + gen.z0!.im, 4)} = ${fx(genLg, 3)} pu — more than the ${fx(1 / gen.z1!.im, 3)} pu of a three-phase fault, because Z₀ < Z₁.`,
    },
    {
      id: 'unearthed',
      kind: 'choice',
      q: 'The 33 kV system is fed by T2’s delta winding and feeds T3’s delta winding. A conductor of the 33 kV line touches earth. The fault current is…',
      options: [
        { id: 'large', label: 'larger than a three-phase fault there' },
        { id: 'same', label: 'about the same as a three-phase fault' },
        { id: 'zero', label: 'practically zero — there is no earth return path' },
      ],
      answer: 'zero',
      why: 'With no earthed star point in the 33 kV system the zero-sequence network is open: Z₀ = ∞ and I = 3V_f/(Z₁ + Z₂ + Z₀) = 0. The healthy phases rise to √3 pu instead.',
    },
    {
      id: 'v0',
      kind: 'number',
      q: 'Phase a carries 1∠0° pu and phases b and c carry nothing. What is the magnitude of the zero-sequence component?',
      answer: v0,
      unit: 'pu',
      tol: 0.005,
      why: 'x₀ = (x_a + x_b + x_c)/3 = 1/3. The positive and negative components are 1/3 too — the three add up to x_a = 1 and cancel in b and c.',
    },
    {
      id: 'll',
      kind: 'number',
      q: `A three-phase fault at the town’s 11 kV bus draws ${fx(town['3ph'].faultKa, 3)} kA. Every impedance is the same in the positive and negative sequence. What does a line-to-line fault there draw?`,
      answer: town.ll.faultKa,
      unit: 'kA',
      tol: 0.02,
      why: `With Z₂ = Z₁: I_LL = √3·V_f/(2Z₁) = (√3/2)·I_3φ = 0.866 × ${fx(town['3ph'].faultKa, 3)} = ${fx(town.ll.faultKa, 3)} kA.`,
    },
    {
      id: 'reactor',
      kind: 'choice',
      q: 'A generator’s star point is earthed through a reactor X_n. In the zero-sequence network it appears as…',
      options: [
        { id: 'xn', label: 'X_n' },
        { id: '3xn', label: '3·X_n' },
        { id: 'xn3', label: 'X_n / 3' },
        { id: 'none', label: 'nothing — it carries no current in a fault' },
      ],
      answer: '3xn',
      why: 'The neutral carries I_a + I_b + I_c = 3·I₀, so the voltage across the reactor is 3·I₀·X_n: per phase, in the zero-sequence network, that is an impedance of 3·X_n.',
    },
    {
      id: 'ynd',
      kind: 'choice',
      q: 'Seen from its earthed-star (YN) side, a YNd transformer in the zero-sequence network is…',
      options: [
        { id: 'series', label: 'a series impedance through to the delta side' },
        { id: 'shunt', label: 'its leakage impedance to the reference (earth), with the delta side cut off' },
        { id: 'open', label: 'an open circuit on both sides' },
      ],
      answer: 'shunt',
      why: 'Zero-sequence current can flow in the earthed star; the delta winding lets the matching current circulate inside it but none leaves on its lines. So: a path to earth on the YN side, open towards the delta side.',
    },
    {
      id: 'si',
      kind: 'number',
      q: 'A standard-inverse relay (IEC: t = TMS·0.14/((I/I_s)^0.02 − 1)) is set to TMS 0.2. How long does it take to operate at 5 times its setting?',
      answer: tSi,
      unit: 's',
      tol: 0.01,
      why: `t = 0.2 × 0.14 / (5^0.02 − 1) = 0.028 / ${fx(5 ** 0.02 - 1, 5)} = ${fx(tSi, 3)} s.`,
    },
    {
      id: 'grading',
      kind: 'choice',
      q: 'A fault occurs on the town feeder, which both R1 (CB4, on the feeder) and R2 (CB2, on the 33 kV line feeding the town) can see. A well-graded scheme…',
      options: [
        { id: 'down', label: 'trips CB4 first; CB2 waits a grading margin as backup' },
        { id: 'up', label: 'trips CB2 first, as it is closer to the source' },
        { id: 'both', label: 'trips both at once to be safe' },
      ],
      answer: 'down',
      why: 'Discrimination: the breaker nearest the fault clears it, so only the faulted feeder loses supply. The upstream relay operates only if the downstream breaker fails — 0.3–0.4 s later.',
    },
  ]
  useTutorContext(() => `Practise mode: questions on fault levels, symmetrical components, sequence networks and relay grading for the Grid Explorer network.`)
  return (
    <div className="ps-card ps-ft-practise">
      <h3>Practice questions</h3>
      <p className="small muted">Every number comes from this module’s fault study of the Grid Explorer network. Answer all of them correctly to complete the activity.</p>
      <Quiz items={items} onComplete={() => completeActivity(MODULE, 'practice')} />
    </div>
  )
}
