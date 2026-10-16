import { useMemo } from 'react'
import { abs, add, C, sub } from '../../engine/complex.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx, ph } from '../../ui/format.ts'
import { Calc, Callout, Quiz, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import { defaultAc, powerBalance, solveAc, superpositionVA, type AcOk } from './acdist.ts'
import { defaultDc, discretiseUniform, feedCurrentA, loopPerM, nodalDc, solveDc, uniformTotalDrop, type DcDistributor, type DcOk } from './distributor.ts'
import { DEFAULT_KELVIN, kelvinArea, kelvinCost, kelvinNumeric } from './kelvin.ts'
import { annualCost, capPerPhase, DEFAULT_FEEDER, DEFAULT_PF, DEFAULT_TARIFF, economicPf, economicPfNumeric, kvarOf, pfCorrection, solveFeeder, type PfOk } from './pf.ts'
import { MODULE, rupees, tiny } from './shared.tsx'
import { placeWords } from './words.ts'

const okDc = (r: ReturnType<typeof solveDc>) => r as DcOk
const deg = (x: number) => (x * 180) / Math.PI
const phc = (c: { re: number; im: number }, d = 3) => ph(abs(c), deg(Math.atan2(c.im, c.re)), d, 3)

/** Verify: every result of the module checked by hand and by a second, independent method. */
export function Verify() {
  const progress = usePsProgress()
  const v = useMemo(() => {
    const one = defaultDc('one')
    const r1 = okDc(solveDc(one))
    const n1 = nodalDc(one)!
    const both = defaultDc('both')
    const r2 = okDc(solveDc(both))
    const n2 = nodalDc(both)!
    const uni: DcDistributor = { L: 400, rCond: 0.1, VA: 220, VB: 220, feed: 'one', loads: [], i: 0.5 }
    const ru = okDc(solveDc(uni))
    const disc = [10, 100, 1000].map((N) => ({ N, drop: uni.VA - okDc(solveDc(discretiseUniform(uni, N))).minV }))
    const ac = defaultAc()
    const aA = solveAc(ac, 'receiving') as AcOk
    const aB = solveAc(ac, 'own') as AcOk
    const pf = pfCorrection(DEFAULT_PF) as PfOk
    const econ = economicPf(DEFAULT_PF.pf1, DEFAULT_TARIFF)
    const econN = economicPfNumeric(DEFAULT_PF.P, DEFAULT_PF.pf1, DEFAULT_TARIFF)
    const f0 = solveFeeder(DEFAULT_FEEDER, DEFAULT_PF.P, pf.Q1, 0)
    const f1 = solveFeeder(DEFAULT_FEEDER, DEFAULT_PF.P, pf.Q1, pf.Qc)
    const ka = kelvinArea(DEFAULT_KELVIN)
    const kn = kelvinNumeric(DEFAULT_KELVIN)
    return { one, r1, n1, both, r2, n2, uni, ru, disc, ac, aA, aB, pf, econ, econN, f0, f1, ka, kn }
  }, [])
  const { one, r1, n1, both, r2, n2, uni, ru, disc, ac, aA, aB, pf, econ, econN, f0, f1, ka, kn } = v
  const rl = loopPerM(one.rCond)
  const maxDiff = (r: DcOk, n: typeof n1) => Math.max(...n.V.map((x, k) => Math.abs(x - r.nodes[k].V)))
  const uExact = uniformTotalDrop(uni.i, loopPerM(uni.rCond), uni.L)
  const uErrOk = disc.every((x) => Math.abs(x.drop - uExact - (uni.i * loopPerM(uni.rCond) * uni.L ** 2) / (2 * x.N)) < 1e-9)
  const supA = superpositionVA(ac, aA)
  const supB = superpositionVA(ac, aB)
  const balB = powerBalance(ac, aB)
  const balErr = abs(sub(balB.sending, add(balB.loads, balB.losses)))
  const S2c = add(C(DEFAULT_PF.P, pf.Q1), C(0, -pf.Qc))
  const kc = kelvinCost(DEFAULT_KELVIN, ka)
  const vbYour = 218
  const iaYour = feedCurrentA({ ...both, VB: vbYour })
  const cYour = capPerPhase(100, 400, 50, 'delta')
  const quiz: QuizItem[] = [
    {
      id: 'ia',
      kind: 'number',
      q: `Your turn: the same distributor fed at both ends, but now V_A = 220 V and V_B = ${vbYour} V. What current does end A supply?`,
      answer: iaYour,
      unit: 'A',
      tol: 0.05,
      why: `I_A = [V_A − V_B + 2r·Σ I(L − x)] / (2r·L) = [2 + ${fx(rl, 4)} × ${fx(
        both.loads.reduce((s, l) => s + l.I * (both.L - l.x), 0),
        0,
      )}] / (${fx(rl, 4)} × ${both.L}) = ${fx(iaYour, 2)} A.`,
      mistake: 'The higher voltage at A pushes an extra (V_A − V_B)/R_loop through the whole distributor — and R_loop uses 2r, both conductors.',
    },
    {
      id: 'cdelta',
      kind: 'number',
      q: 'Your turn: a 100 kVAr bank on a 400 V, 50 Hz supply is connected in delta. What capacitance is needed per phase?',
      answer: cYour,
      unit: 'µF',
      tol: 1,
      why: `Each delta capacitor sees 400 V and gives 100/3 kVAr: C = Q_c/(3ωV_LL²) = 100 000 / (3 × ${fx(2 * Math.PI * 50, 2)} × 400²) = ${fx(cYour, 1)} µF.`,
      mistake: 'In delta each capacitor sees the LINE voltage. Using V_ph = 231 V gives the star value, three times too large.',
    },
  ]
  useTutorContext(
    () =>
      'Verify mode: DC distributors (section currents vs a nodal conductance-matrix solve), the uniformly loaded distributor (closed form vs discretisation), an AC distributor (back-sweep vs superposition and power balance), capacitor sizing (Q from C), the economical power factor (closed form vs golden-section search), a feeder (exact quadratic vs complex KVL) and Kelvin’s law (closed form vs numerical minimum).',
  )
  return (
    <div className="ps-stack">
      <Callout title="Every result here is computed twice">
        <p>
          Each card works a result by hand and checks it against an independent second method. Where two exact methods are compared, they must agree to rounding (10⁻⁹); where one is a search or a
          series, the tolerance is stated with the reason. Illustrative values throughout. {isDone(progress, MODULE, 'verify') && '✓ Done.'}
        </p>
      </Callout>
      <Calc
        title="1 · Fed at one end: section currents and the drop"
        steps={[
          ...r1.sections
            .filter((s) => s.Iin > 1e-9)
            .map((s) => ({
              label: `${fx(s.x0, 0)}–${fx(s.x1, 0)} m`,
              expr: `I = ${fx(s.Iin, 0)} A (loads beyond); ${fx(s.Iin, 0)} × ${fx(rl, 4)} × ${fx(s.x1 - s.x0, 0)}`,
              result: `${fx(s.drop, 3)} V`,
            })),
          { label: 'Lowest voltage', expr: `220 − Σ drops (${placeWords(r1.minKind, r1.minX, r1.minIds, one.L)})`, result: `${fx(r1.minV, 3)} V` },
          {
            label: 'Same by moments',
            expr: `220 − 2r·Σ I·x = 220 − ${fx(rl, 4)} × ${fx(
              one.loads.reduce((s, l) => s + l.I * l.x, 0),
              0,
            )}`,
            result: `${fx(220 - rl * one.loads.reduce((s, l) => s + l.I * l.x, 0), 3)} V`,
          },
        ]}
        check={{ ok: maxDiff(r1, n1) < 1e-9 * one.VA, text: `Nodal analysis (conductance matrix, ${n1.free.length} unknowns) gives the same node voltages to ${tiny(maxDiff(r1, n1), 3)} V.` }}
      />
      <Calc
        title="2 · Fed at both ends (220 V, 220 V): the point of minimum potential"
        steps={[
          {
            label: 'I_A by moments about B',
            expr: `Σ I·(L − x)/L = ${fx(
              both.loads.reduce((s, l) => s + l.I * (both.L - l.x), 0),
              0,
            )}/${both.L}`,
            result: `${fx(r2.IA, 3)} A`,
          },
          { label: 'I_B', expr: `${fx(r2.totalLoad, 0)} − ${fx(r2.IA, 3)}`, result: `${fx(r2.IB, 3)} A` },
          { label: 'Section currents', expr: 'subtract each load in turn', result: r2.sections.map((s) => fx(s.Iin, 2)).join(' → ') + ' A' },
          { label: 'Current reverses', expr: 'first section current ≤ 0', result: placeWords(r2.minKind, r2.minX, r2.minIds, both.L) },
          { label: 'Lowest voltage', expr: `220 − Σ drops from A`, result: `${fx(r2.minV, 3)} V` },
        ]}
        check={{
          ok: maxDiff(r2, n2) < 1e-9 * both.VA && Math.abs(n2.xs[n2.minNode] - r2.minX) < 1e-9 && Math.abs(n2.IA - r2.IA) < 1e-9,
          text: `The nodal solve's lowest node is at ${fx(n2.xs[n2.minNode], 0)} m (${fx(n2.V[n2.minNode], 3)} V) — the same point; voltages agree to ${tiny(maxDiff(r2, n2), 3)} V, I_A to ${tiny(Math.abs(n2.IA - r2.IA), 3)} A.`,
        }}
      />
      <Calc
        title="3 · Uniformly loaded (0.5 A/m over 400 m, fed at one end): the closed form and its limit"
        steps={[
          { label: 'Closed form', expr: `i·2r·L²/2 = 0.5 × ${fx(loopPerM(uni.rCond), 4)} × 400² / 2`, result: `${fx(uExact, 4)} V` },
          { label: 'Section-current solve', expr: 'the model with i = 0.5 A/m', result: `${fx(uni.VA - ru.minV, 4)} V` },
          ...disc.map((x) => ({ label: `${x.N} point loads`, expr: `${fx((uni.i * uni.L) / x.N, 3)} A every ${fx(uni.L / x.N, 1)} m`, result: `${fx(x.drop, 4)} V` })),
        ]}
        check={{
          ok: uErrOk && Math.abs(uni.VA - ru.minV - uExact) < 1e-9,
          text: `With N point loads at the section ends the drop is too large by exactly i·2r·L²/(2N) (${disc.map((x) => fx(x.drop - uExact, 4)).join(', ')} V), which → 0 as N → ∞: the discretisation converges to the closed form.`,
        }}
      />
      <Calc
        title="4 · AC distributor: sending voltage for the two power-factor conventions"
        steps={[
          { label: 'Loads', expr: ac.loads.map((l) => `${l.id}: ${l.I} A, pf ${l.pf} lag at ${l.x} m`).join('; '), result: `V_B = ${ac.VB}∠0° V` },
          { label: '(a) currents from V_B', expr: aA.Iload.map((I, j) => `I_${ac.loads[j].id} = ${phc(I, 2)}`).join(', '), result: `V_A = ${phc(aA.VA)} V` },
          { label: '(b) currents from own V', expr: aB.Iload.map((I, j) => `I_${ac.loads[j].id} = ${phc(I, 2)}`).join(', '), result: `V_A = ${phc(aB.VA)} V` },
          { label: 'Difference', expr: '|V_A(b)| − |V_A(a)|', result: `${fx(abs(aB.VA) - abs(aA.VA), 4)} V` },
        ]}
        check={{
          ok: abs(sub(supA, aA.VA)) < 1e-9 * ac.VB && abs(sub(supB, aB.VA)) < 1e-9 * ac.VB && balErr < 1e-9 * abs(balB.sending),
          text: `Superposition V_B + Σ I_k·z·x_k gives both V_A again (to ${tiny(Math.max(abs(sub(supA, aA.VA)), abs(sub(supB, aB.VA))), 3)} V), and in (b) the power sent equals the loads plus the I²Z losses (to ${tiny(balErr, 3)} VA).`,
        }}
      />
      <Calc
        title="5 · Capacitor bank: 200 kW from 0.7 to 0.95 lagging at 400 V, 50 Hz"
        steps={[
          {
            label: 'Q_c',
            expr: `200 × (tan ${fx(deg(pf.phi1), 2)}° − tan ${fx(deg(pf.phi2), 2)}°) = 200 × (${fx(Math.tan(pf.phi1), 4)} − ${fx(Math.tan(pf.phi2), 4)})`,
            result: `${fx(pf.Qc, 2)} kVAr`,
          },
          { label: 'Star, per phase', expr: `Q_c/(3ωV_ph²) = ${fx(pf.Qc * 1000, 0)} / (3 × ${fx(2 * Math.PI * 50, 2)} × ${fx(pf.VcapStar, 2)}²)`, result: `${fx(pf.Cstar, 1)} µF` },
          { label: 'Delta, per phase', expr: `Q_c/(3ωV_LL²) = ${fx(pf.Qc * 1000, 0)} / (3 × ${fx(2 * Math.PI * 50, 2)} × 400²)`, result: `${fx(pf.Cdelta, 1)} µF` },
          { label: 'Line current', expr: `S/(√3·V): ${fx(pf.S1, 2)} → ${fx(pf.S2, 2)} kVA`, result: `${fx(pf.I1, 1)} → ${fx(pf.I2, 1)} A` },
        ]}
        check={{
          ok:
            Math.abs(kvarOf(pf.Cstar, 400, 50, 'star') - pf.Qc) < 1e-9 * pf.Qc &&
            Math.abs(kvarOf(pf.Cdelta, 400, 50, 'delta') - pf.Qc) < 1e-9 * pf.Qc &&
            Math.abs(pf.Cstar / pf.Cdelta - 3) < 1e-12 &&
            Math.abs(abs(S2c) - pf.S2) < 1e-9 * pf.S2,
          text: `Complex power: (${fx(DEFAULT_PF.P, 0)} + j${fx(pf.Q1, 2)}) − j${fx(pf.Qc, 2)} = ${fx(S2c.re, 0)} + j${fx(S2c.im, 2)} kVA, |S| = ${fx(abs(S2c), 2)} kVA, pf ${fx(S2c.re / abs(S2c), 4)}. Each bank, 3V_c²ωC, returns ${fx(kvarOf(pf.Cstar, 400, 50, 'star'), 2)} kVAr; star/delta = ${fx(pf.Cstar / pf.Cdelta, 6)}.`,
        }}
      />
      <Calc
        title={`6 · The economical power factor (x = ₹${DEFAULT_TARIFF.x}/kVA/yr, y = ₹${DEFAULT_TARIFF.y}/kVAr/yr, illustrative)`}
        steps={[
          { label: 'Annual cost', expr: 'x·P/cos φ₂ + y·P·(tan φ₁ − tan φ₂)', result: 'minimise over φ₂' },
          { label: 'd/dφ₂ = 0', expr: 'x·P·sin φ₂/cos² φ₂ − y·P/cos² φ₂ = 0', result: 'sin φ₂ = y/x' },
          { label: 'Closed form', expr: `√(1 − (${DEFAULT_TARIFF.y}/${DEFAULT_TARIFF.x})²)`, result: fx(econ.pf, 6) },
          { label: 'Golden-section search', expr: `${econN.iterations} steps over φ₂ ∈ [0, φ₁]`, result: fx(econN.pf, 6) },
          { label: 'Cost there', expr: `vs ${rupees(annualCost(200, 0.7, 1, DEFAULT_TARIFF).total)} at unity`, result: `${rupees(annualCost(200, 0.7, econ.pf, DEFAULT_TARIFF).total)} /yr` },
        ]}
        check={{
          ok: Math.abs(econ.pf - econN.pf) < 1e-6,
          text: `The search finds the same minimum (difference ${tiny(Math.abs(econ.pf - econN.pf), 3)}). Tolerance 10⁻⁶: the cost curve is flat at its minimum, so a search pins the optimum only to about the square root of the arithmetic precision.`,
        }}
      />
      {f0.ok && f1.ok && (
        <Calc
          title="7 · On a feeder (415 V source, 0.02 + j0.015 Ω per phase): the voltage rise and the loss saved"
          steps={[
            { label: 'Before', expr: `P = 200 kW, Q = ${fx(pf.Q1, 1)} kVAr`, result: `V_r = ${fx(f0.VrLL, 2)} V, loss ${fx(f0.loss, 3)} kW` },
            { label: 'After', expr: `bank ${fx(f1.Qbank, 1)} kVAr at that voltage`, result: `V_r = ${fx(f1.VrLL, 2)} V, loss ${fx(f1.loss, 3)} kW` },
          ]}
          check={{
            ok: Math.abs(f0.VsCheck - 415) < 1e-9 * 415 && Math.abs(f1.VsCheck - 415) < 1e-9 * 415,
            text: `Rebuilding V_s = V_r + (R + jX)·I from each solution returns ${fx(f0.VsCheck, 6)} V and ${fx(f1.VsCheck, 6)} V — the source voltage — so both are exact solutions.`,
          }}
        />
      )}
      <Calc
        title="8 · Kelvin’s law (illustrative costs)"
        steps={[
          { label: 'a*', expr: `I·√(ρTc/(pk)) = 150 × √(${DEFAULT_KELVIN.rho} × ${DEFAULT_KELVIN.T} × ${DEFAULT_KELVIN.c} / (${DEFAULT_KELVIN.p} × ${DEFAULT_KELVIN.k}))`, result: `${fx(ka, 3)} mm²` },
          { label: 'Capital charge', expr: `p·k·a*`, result: `${rupees(kc.capital)} /km/yr` },
          { label: 'Cost of losses', expr: `I²·(ρ·1000/a*)·T·c/1000`, result: `${rupees(kc.energy)} /km/yr` },
          { label: 'Numerical minimum', expr: `golden-section search, ${kn.iterations} steps`, result: `${fx(kn.a, 3)} mm²` },
        ]}
        check={{
          ok: Math.abs(kn.a - ka) < 1e-6 * ka && Math.abs(kc.capital - kc.energy) < 1e-9 * kc.total,
          text: `The two annual costs are equal at a*, and the numerical minimum agrees to ${tiny(Math.abs(kn.a - ka) / ka, 3)} (relative; tolerance 10⁻⁶ for the same flat-minimum reason).`,
        }}
      />
      <section className="ps-card">
        <h3>Your turn</h3>
        <Quiz items={quiz} onComplete={() => completeActivity(MODULE, 'verify')} />
      </section>
    </div>
  )
}
