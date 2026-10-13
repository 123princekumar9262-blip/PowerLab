import { useMemo, useState } from 'react'
import { abs, add, C, scale, sub, type Complex } from '../../engine/complex.ts'
import { iBaseKa, zBaseOhm } from '../../network/perunit.ts'
import { fx } from '../../ui/format.ts'
import { Calc, Callout, Quiz, Seg, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import { zText } from './diagrams.tsx'
import type { ProtState } from './explore.tsx'
import type { FaultState } from './explore.tsx'
import { phaseDomainFault } from './phase.ts'
import { CURVES, tripTime } from './relays.ts'
import { FAULT_LABEL, type FaultType } from './sequence.ts'
import { BUS_SHORT, faultModel, relayCurrents, SETUP0 } from './study.ts'
import { directThreePhase, faultStudy, theveninAt } from './zbus.ts'

/** The radial path from the generator: each element and the bus it reaches. */
const PATH: Array<{ el: string; bus: string }> = [
  { el: 'G1', bus: 'gen' },
  { el: 'T1', bus: 'hvA' },
  { el: 'L1', bus: 'hvB' },
  { el: 'T2', bus: 'mvA' },
  { el: 'L2', bus: 'mvB' },
  { el: 'T3', bus: 'lv' },
]

export function Verify({ st, prot }: { st: FaultState; prot: ProtState }) {
  const [bus, setBus] = useState('mvB')
  const [ut, setUt] = useState<Exclude<FaultType, '3ph'>>('slg')
  const m = useMemo(() => faultModel(SETUP0), [])
  const net = m.net
  const k = m.busIds.indexOf(bus)
  const r3 = faultStudy(m, bus, '3ph')
  const ok = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol
  // 1 · the Thevenin impedance by hand: the series sum along the radial path
  const upto = PATH.findIndex((p) => p.bus === bus)
  const steps1: Array<{ label: string; expr: string; result: string }> = []
  let zSum: Complex = C(0)
  for (const p of PATH.slice(0, upto + 1)) {
    const c = net.components.find((x) => x.id === p.el)!
    let z: Complex = C(0)
    let expr = ''
    if (c.kind === 'generator') {
      z = C(0, (c.x1Pu! * net.baseMva) / c.ratedMva)
      expr = `j${c.x1Pu} × ${net.baseMva}/${c.ratedMva}`
    } else if (c.kind === 'transformer') {
      const b = m.branches.find((x) => x.id === c.id)!
      z = b.z1
      const toKv = net.buses.find((x) => x.id === c.to)!.kv
      expr = `${c.zPct / 100} × ${net.baseMva}/${c.ratedMva}${c.kvTo !== toKv ? ` × (${c.kvTo}/${toKv})²` : ''}, X/R = ${c.xr}`
    } else if (c.kind === 'line') {
      const zb = zBaseOhm(net.buses.find((x) => x.id === c.to)!.kv, net.baseMva)
      z = scale(C(c.rOhmPerKm * c.lengthKm, c.xOhmPerKm * c.lengthKm), 1 / zb)
      expr = `(${c.rOhmPerKm} + j${c.xOhmPerKm}) × ${c.lengthKm} km / ${fx(zb, 2)} Ω`
    }
    zSum = add(zSum, z)
    steps1.push({ label: c.name.replace(/ \(.*\)/, ''), expr, result: `${zText(z, 4)} pu` })
  }
  steps1.push({ label: 'Sum along the path', expr: 'radial: one source, no shunts', result: `${zText(zSum, 4)} pu` })
  const zkk = theveninAt(m, k).z1!
  // 2 · current and level
  const ib = iBaseKa(m.kv[k], net.baseMva)
  const ifPu = 1 / abs(zkk)
  // 3 · direct solution
  const d = directThreePhase(m, bus)!
  const maxDv = Math.max(...r3.buses.map((b, i) => abs(sub(b.v012[1], d.v[i]))))
  // 4 · unsymmetrical fault, two ways
  const th = theveninAt(m, k)
  const ru = faultStudy(m, bus, ut)
  const pd = th.z0 ? phaseDomainFault(ut, C(1), th.z1!, th.z2!, th.z0) : null
  const maxDi = pd ? Math.max(...ru.point.iabc.map((x, i) => abs(sub(x, pd.iabc[i])))) : NaN
  // 5 · relay time
  const rc = relayCurrents(m, 'feeder', '3ph')
  const R1 = prot.down
  const mult = Math.min(rc.downA / R1.isA, 20)
  const cv = CURVES[R1.curve]
  const tHand = (R1.tms * cv.k) / (mult ** cv.alpha - 1)
  const tRelay = tripTime(R1.curve, R1.tms, R1.isA, rc.downA)
  const mvB = faultStudy(m, 'mvB', '3ph')
  const quiz: QuizItem[] = [
    {
      id: 'if-mvb',
      kind: 'number',
      q: `Your turn: the Thevenin impedance at the 33 kV distribution substation is |Z_kk| = ${fx(abs(mvB.z1!), 4)} pu on 100 MVA. What is the three-phase fault current there?`,
      answer: mvB.faultKa,
      unit: 'kA',
      tol: Math.max(0.01, mvB.faultKa * 0.02),
      why: `I_f = 1/${fx(abs(mvB.z1!), 4)} = ${fx(1 / abs(mvB.z1!), 4)} pu × I_base (100 MVA / (√3 × 33 kV) = ${fx(iBaseKa(33, 100), 4)} kA) = ${fx(mvB.faultKa, 3)} kA.`,
    },
  ]
  useTutorContext(
    () =>
      `Verify mode: hand checks of the fault study at ${BUS_SHORT[bus]}. Z_kk by series sum ${zText(zSum, 4)} vs Z_bus ${zText(zkk, 4)}; I_f ${fx(r3.faultKa, 3)} kA; direct faulted-network solution agrees within ${maxDv.toExponential(1)} pu; ${FAULT_LABEL[ut]} fault by sequences vs phase-domain solution; R1 relay time ${fx(tRelay, 3)} s.${st.setup !== SETUP0 ? ' (Verify uses the network as built, not the earthing changed in Explore.)' : ''}`,
  )
  return (
    <div className="ps-stack ps-ft-verify">
      <Callout title="The numbers in this module come from Z_bus = Y_bus⁻¹ and the sequence-network equations">
        <p>
          Here you check them another way: by summing impedances along the path, by solving the faulted network directly, by solving an unbalanced fault in phase quantities, and by evaluating the
          relay curve by hand. The network as built (solidly earthed generator, YNd / YNd / Dyn transformers).
        </p>
      </Callout>
      <div className="ps-toolbar">
        <div className="ps-toolbar-group">
          <span className="small muted">Fault at</span>
          <Seg label="Bus to verify" value={bus} onChange={setBus} options={PATH.slice(1).map((p) => ({ id: p.bus, label: BUS_SHORT[p.bus] }))} />
        </div>
      </div>
      <Calc
        title="1 · The Thevenin impedance: add up the path from the generator"
        steps={steps1}
        check={{ ok: abs(sub(zSum, zkk)) < 1e-12, text: `Z_bus = Y_bus⁻¹ gives Z_kk = ${zText(zkk, 4)} pu — the same.` }}
      />
      <Calc
        title="2 · Three-phase fault current and fault level"
        steps={[
          { label: 'Fault current in per unit', expr: `|I_f| = V_f/|Z_kk| = 1/${fx(abs(zkk), 4)}`, result: `${fx(ifPu, 4)} pu` },
          { label: 'Base current', expr: `${net.baseMva} MVA / (√3 × ${m.kv[k]} kV)`, result: `${fx(ib, 4)} kA` },
          { label: 'Fault current', expr: `${fx(ifPu, 4)} × ${fx(ib, 4)}`, result: `${fx(ifPu * ib, 3)} kA` },
          { label: 'Fault level', expr: `√3 × ${m.kv[k]} kV × ${fx(ifPu * ib, 3)} kA`, result: `${fx(Math.sqrt(3) * m.kv[k] * ifPu * ib, 1)} MVA` },
        ]}
        check={{ ok: ok(ifPu * ib, r3.faultKa, 1e-9) && ok(Math.sqrt(3) * m.kv[k] * ifPu * ib, r3.levelMva, 1e-6), text: `The study gives ${fx(r3.faultKa, 3)} kA and ${fx(r3.levelMva, 1)} MVA.` }}
      />
      <Calc
        title="3 · Z_bus against a direct solution of the faulted network"
        steps={[
          { label: 'Direct', expr: `Y_bus·V = I (generator as Norton source E/jx″d), with V_${bus} = 0, solved for every bus voltage`, result: `I_f = ${fx(abs(d.iF), 6)} pu` },
          { label: 'Z_bus method', expr: 'I_f = 1/Z_kk,  V_i = 1 − Z_ik·I_f', result: `I_f = ${fx(abs(r3.point.i012[1]), 6)} pu` },
          { label: 'Generator terminals', expr: `direct ${fx(abs(d.v[0]), 6)} · Z_bus ${fx(abs(r3.buses[0].v012[1]), 6)}`, result: `Δ ${fx(abs(sub(d.v[0], r3.buses[0].v012[1])), 9)} pu` },
          { label: 'Largest voltage difference', expr: 'over all six buses', result: `${maxDv.toExponential(1)} pu` },
        ]}
        check={{ ok: maxDv < 1e-9 && ok(abs(d.iF), abs(r3.point.i012[1]), 1e-9), text: 'Two independent methods, the same fault: identical to rounding.' }}
      />
      <section className="ps-calc" aria-label="Unbalanced fault two ways">
        <div className="ps-toolbar">
          <h3 className="ps-calc-title">4 · An unbalanced fault: sequence networks against phase quantities</h3>
          <Seg
            label="Fault type"
            value={ut}
            onChange={(v) => setUt(v as Exclude<FaultType, '3ph'>)}
            options={[
              { id: 'slg', label: 'Line-to-ground' },
              { id: 'll', label: 'Line-to-line' },
              { id: 'dlg', label: 'Double line-to-ground' },
            ]}
          />
        </div>
        {!th.z0 && ut !== 'll' ? (
          <p className="muted">
            {BUS_SHORT[bus]} has no zero-sequence path (Z₀ = ∞): an earth fault there draws no current — there is nothing to compare. Choose the generator side, 220 kV or 11 kV, or a line-to-line
            fault.
          </p>
        ) : (
          <Calc
            title={`${FAULT_LABEL[ut]} at ${BUS_SHORT[bus]}, bolted`}
            steps={[
              { label: 'Z₁ · Z₂ · Z₀ (Z_bus diagonals)', expr: `${zText(th.z1, 4)} · ${zText(th.z2, 4)} · ${zText(th.z0, 4)}`, result: 'pu' },
              ut === 'slg'
                ? { label: 'I₀ = I₁ = I₂', expr: `1 / (Z₁ + Z₂ + Z₀)`, result: `${fx(abs(ru.point.i012[0]), 4)} pu` }
                : ut === 'll'
                  ? { label: 'I₁ = −I₂', expr: '1 / (Z₁ + Z₂)', result: `${fx(abs(ru.point.i012[1]), 4)} pu` }
                  : { label: 'I₁', expr: '1 / (Z₁ + Z₂‖Z₀)', result: `${fx(abs(ru.point.i012[1]), 4)} pu` },
              { label: 'Largest phase current', expr: ut === 'slg' ? 'I_a = 3·I₀' : 'from I_abc = A·I₀₁₂', result: `${fx(ru.faultKa / ru.iBaseKa, 4)} pu = ${fx(ru.faultKa, 3)} kA` },
              {
                label: 'Phase-domain solution',
                expr: pd ? 'V_abc = E_abc − Z_abc·I_abc with the fault conditions, 6 equations' : 'needs an earth path',
                result: pd ? `${fx(Math.max(...pd.iabc.map(abs)), 4)} pu` : '—',
              },
            ]}
            check={pd ? { ok: maxDi < 1e-9, text: `All three phase currents agree (largest difference ${maxDi.toExponential(1)} pu) — no symmetrical components in the second method.` } : undefined}
          />
        )}
      </section>
      <Calc
        title={`5 · Relay R1’s operating time (${cv.name}, as set in Explore)`}
        steps={[
          { label: 'Current seen', expr: 'three-phase fault on the town feeder', result: `${fx(rc.downA, 1)} A` },
          { label: 'Multiple of setting', expr: `${fx(rc.downA, 1)} / ${R1.isA}${rc.downA / R1.isA > 20 ? ' (capped at 20)' : ''}`, result: fx(mult, 4) },
          { label: 'Operating time', expr: `${fx(R1.tms, 2)} × ${cv.k} / (${fx(mult, 4)}^${cv.alpha} − 1)`, result: `${fx(tHand, 4)} s` },
        ]}
        check={{ ok: ok(tHand, tRelay, 1e-12), text: `The relay model gives ${fx(tRelay, 4)} s.` }}
      />
      <section className="ps-card">
        <h3>Your turn</h3>
        <Quiz items={quiz} />
      </section>
    </div>
  )
}
