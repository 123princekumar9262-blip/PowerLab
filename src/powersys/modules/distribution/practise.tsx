import { useMemo } from 'react'
import { completeActivity } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Quiz, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import { defaultDc, loopPerM, solveDc, type DcDistributor, type DcOk } from './distributor.ts'
import { kelvinArea, type KelvinInput } from './kelvin.ts'
import { economicPf, pfCorrection, type PfOk } from './pf.ts'
import { MODULE } from './shared.tsx'

const ok = (r: ReturnType<typeof solveDc>) => r as DcOk

/** Practice: concept → numerical → university-style → GATE-style. Written for this app; numbers from the models. */
export function Practise() {
  const q = useMemo(() => {
    const one = defaultDc('one')
    const r1 = ok(solveDc(one))
    const both = defaultDc('both')
    const r2 = ok(solveDc(both))
    const uni: DcDistributor = { L: 400, rCond: 0.1, VA: 220, VB: 220, feed: 'one', loads: [], i: 0.5 }
    const ru = ok(solveDc(uni))
    // a both-ends case with unequal voltages, written for this practice set
    const un: DcDistributor = {
      L: 500,
      rCond: 0.05,
      VA: 230,
      VB: 226,
      feed: 'both',
      i: 0,
      loads: [
        { id: 'P', x: 100, I: 60 },
        { id: 'Q', x: 250, I: 80 },
        { id: 'R', x: 400, I: 50 },
      ],
    }
    const ru2 = ok(solveDc(un))
    const pf = pfCorrection({ P: 200, pf1: 0.7, pf2: 0.95, lead2: false, VLL: 400, f: 50 }) as PfOk
    const pf2 = pfCorrection({ P: 500, pf1: 0.75, pf2: 0.9, lead2: false, VLL: 11000, f: 50 }) as PfOk
    const econ = economicPf(0.75, { x: 1500, y: 450 })
    const kq: KelvinInput = { I: 200, T: 4000, c: 6, rho: 0.0282, k: 1500, p: 0.12 }
    const ka = kelvinArea(kq)
    return { one, r1, both, r2, uni, ru, un, ru2, pf, pf2, econ, kq, ka }
  }, [])
  const { one, r1, both, r2, uni, ru, un, ru2, pf, pf2, econ, kq, ka } = q
  const rl = loopPerM(one.rCond)
  const items: QuizItem[] = [
    {
      id: 'feeder',
      level: 'concept',
      kind: 'choice',
      q: 'Why is a feeder sized by its current, but a distributor by its voltage drop?',
      options: [
        {
          id: 'a',
          label:
            'A feeder has no loads tapped off it, so the voltage at its end can be regulated at the substation; a distributor feeds consumers all along it, and the last one must still get an acceptable voltage',
        },
        { id: 'b', label: 'A feeder is always underground and a distributor always overhead' },
        { id: 'c', label: 'Feeders carry DC and distributors AC' },
      ],
      answer: 'a',
      why: 'With no tappings, the same current flows along the whole feeder and its far-end voltage can be held by the substation’s tap changer — so heating (current rating) decides its size. A distributor’s consumers see every drop along the way.',
      mistake: 'The layout (overhead or underground, AC or DC) does not decide how a conductor is sized; what is connected along it does.',
    },
    {
      id: 'loop',
      level: 'numerical',
      kind: 'number',
      q: 'A two-wire distributor has conductors of 0.1 Ω/km each. What is the resistance of the loop for a 300 m section?',
      answer: 2 * 0.1 * 0.3,
      unit: 'Ω',
      tol: 0.0005,
      why: 'The current goes out on one conductor and back on the other: R_loop = 2 × 0.1 Ω/km × 0.3 km = 0.06 Ω.',
      mistake: 'Taking only one conductor (0.03 Ω) halves every drop. State whether r is per conductor or per loop before you start.',
    },
    {
      id: 'one-drop',
      level: 'numerical',
      kind: 'number',
      q: `A ${one.L} m two-wire DC distributor fed at A at ${one.VA} V supplies ${one.loads.map((l) => `${l.I} A at ${l.x} m`).join(', ')}. Each conductor has ${one.rCond} Ω/km. What is the lowest voltage?`,
      answer: r1.minV,
      unit: 'V',
      tol: 0.02,
      why: `V_min = V_A − 2r·Σ I·x = ${one.VA} − ${fx(rl, 4)} × ${fx(
        one.loads.reduce((s, l) => s + l.I * l.x, 0),
        0,
      )} = ${fx(r1.minV, 2)} V, at the last load.`,
      mistake: 'Each load’s current flows from A to that load, so its drop uses its own distance x — and the loop resistance 2r.',
    },
    {
      id: 'both-ia',
      level: 'university',
      kind: 'number',
      q: `The same distributor is fed at both ends at ${both.VA} V. What current does end A supply?`,
      answer: r2.IA,
      unit: 'A',
      tol: 0.02,
      why: `Equal end voltages: the drops from A and from B to any point are equal, so I_A = Σ I·(L − x)/L = ${fx(
        both.loads.reduce((s, l) => s + l.I * (both.L - l.x), 0),
        0,
      )}/${both.L} = ${fx(r2.IA, 2)} A.`,
      mistake: 'Splitting the total load equally between the ends is wrong: each load is shared in inverse proportion to its distance from each end.',
    },
    {
      id: 'both-min',
      level: 'university',
      kind: 'choice',
      q: 'In that case (fed at both ends), at which load is the voltage lowest?',
      options: both.loads.map((l) => ({ id: l.id, label: `${l.id} (${l.x} m, ${l.I} A)` })),
      answer: r2.minIds[0] ?? '',
      why: `Subtract the loads from I_A in turn: ${r2.sections.map((s) => fx(s.Iin, 2)).join(' → ')} A. The current changes direction at ${r2.minIds.join(' + ')}: that load is fed from both sides and is the point of minimum potential (${fx(r2.minV, 2)} V).`,
      mistake: 'The lowest point is not simply the middle of the distributor: it is where the current reverses, which depends on how the loads are spread.',
    },
    {
      id: 'unequal',
      level: 'gate',
      kind: 'number',
      q: `A ${un.L} m two-wire distributor is fed at A at ${un.VA} V and at B at ${un.VB} V; each conductor has ${un.rCond} Ω/km. Loads: ${un.loads.map((l) => `${l.I} A at ${l.x} m`).join(', ')} from A. What is the lowest voltage on the distributor?`,
      answer: ru2.minV,
      unit: 'V',
      tol: 0.02,
      why: `I_A = [(V_A − V_B) + 2r·Σ I(L − x)]/(2rL) = ${fx(ru2.IA, 3)} A. Section currents ${ru2.sections.map((s) => fx(s.Iin, 2)).join(' → ')} A; the current reverses at load ${ru2.minIds.join(' + ')} (${fx(ru2.minX, 0)} m), where V = ${fx(ru2.minV, 3)} V.`,
      mistake: 'With unequal end voltages the extra (V_A − V_B)/R_loop flows straight through from A to B, so I_A is no longer just the moment sum.',
    },
    {
      id: 'uniform',
      level: 'numerical',
      kind: 'number',
      q: `A ${uni.L} m distributor fed at one end is loaded uniformly at ${uni.i} A/m; each conductor has ${uni.rCond} Ω/km. What is the voltage drop at the far end?`,
      answer: uni.VA - ru.minV,
      unit: 'V',
      tol: 0.01,
      why: `Drop = i·r_loop·L²/2 = ${uni.i} × ${fx(loopPerM(uni.rCond), 4)} × ${uni.L}² / 2 = ${fx(uni.VA - ru.minV, 3)} V — half of what the same ${fx(uni.i * uni.L, 0)} A would drop if it were all taken at the far end.`,
      mistake: 'A uniform load acts like the whole load at the MIDDLE, not at the end: the factor ½ comes from integrating the linearly falling current.',
    },
    {
      id: 'ring',
      level: 'concept',
      kind: 'choice',
      q: 'How is a ring main fed at one point analysed?',
      options: [
        { id: 'a', label: 'As a distributor fed at one end' },
        { id: 'b', label: 'As a distributor fed at both ends with equal voltages — the ring opened out at the feed point' },
        { id: 'c', label: 'It cannot be solved without a computer' },
      ],
      answer: 'b',
      why: 'Cut the ring at the feed point and lay it out straight: both ends are the same point, at the same voltage.',
    },
    {
      id: 'qc',
      level: 'numerical',
      kind: 'number',
      q: 'A 200 kW three-phase load runs at 0.7 lagging. What capacitor bank (kVAr) raises it to 0.95 lagging?',
      answer: pf.Qc,
      unit: 'kVAr',
      tol: 0.5,
      why: `Q_c = P(tan φ₁ − tan φ₂) = 200 × (${fx(Math.tan(pf.phi1), 4)} − ${fx(Math.tan(pf.phi2), 4)}) = ${fx(pf.Qc, 1)} kVAr.`,
      mistake: 'Q_c is the difference of the tangents times P — not P·(sin φ₁ − sin φ₂), and not S₁ − S₂.',
    },
    {
      id: 'cdelta',
      level: 'university',
      kind: 'number',
      q: `For that bank on 400 V, 50 Hz, what capacitance per phase is needed if it is connected in delta?`,
      answer: pf.Cdelta,
      unit: 'µF',
      tol: 2,
      why: `C = Q_c/(3ωV_LL²) = ${fx(pf.Qc * 1000, 0)} / (3 × ${fx(2 * Math.PI * 50, 2)} × 400²) = ${fx(pf.Cdelta, 1)} µF — one third of the ${fx(pf.Cstar, 1)} µF a star bank would need.`,
      mistake: 'In delta each capacitor has the full line voltage across it. Using V_ph gives the star value (three times too big).',
    },
    {
      id: 'current',
      level: 'gate',
      kind: 'number',
      q: 'At the same real power and voltage, a load’s power factor is raised from 0.7 to 0.95. By what percentage does the line current fall?',
      answer: -pf.dI * 100,
      unit: '%',
      tol: 0.1,
      why: `I ∝ 1/cos φ at constant P and V: 1 − 0.7/0.95 = ${fx(-pf.dI * 100, 2)} %. The copper loss falls to (0.7/0.95)² = ${fx((0.7 / 0.95) ** 2 * 100, 1)} % of its old value.`,
      mistake: 'The current does not fall by (0.95 − 0.7)/0.7: it is inversely proportional to the power factor.',
    },
    {
      id: 'econ',
      level: 'gate',
      kind: 'number',
      q: 'A tariff charges ₹1,500 per kVA of maximum demand per year; capacitors cost ₹450 per kVAr per year (interest and depreciation). A load runs at 0.75 lagging. What is the most economical power factor?',
      answer: econ.pf,
      unit: '',
      tol: 0.002,
      why: `sin φ₂ = y/x = 450/1500 = ${fx(econ.ratio, 2)}, cos φ₂ = √(1 − ${fx(econ.ratio, 2)}²) = ${fx(econ.pf, 4)} lagging (it is above 0.75, so correction pays).`,
      mistake: 'The answer is cos φ₂ = √(1 − (y/x)²), not y/x itself — and it does not depend on the load’s own power factor (as long as it is lower).',
    },
    {
      id: 'mv',
      level: 'university',
      kind: 'number',
      q: 'A 500 kW load on an 11 kV, 50 Hz supply runs at 0.75 lagging. What capacitance per phase (star) raises its power factor to 0.9 lagging?',
      answer: pf2.Cstar,
      unit: 'µF',
      tol: 0.05,
      why: `Q_c = 500 × (${fx(Math.tan(pf2.phi1), 4)} − ${fx(Math.tan(pf2.phi2), 4)}) = ${fx(pf2.Qc, 2)} kVAr; C = Q_c/(ω·V_LL²) = ${fx(pf2.Qc * 1000, 0)} / (${fx(2 * Math.PI * 50, 2)} × 11 000²) = ${fx(pf2.Cstar, 3)} µF per phase.`,
      mistake: 'At 11 kV the capacitance is tiny compared with a 400 V bank of the same kVAr: C scales as 1/V².',
    },
    {
      id: 'kelvin-c',
      level: 'concept',
      kind: 'choice',
      q: 'Kelvin’s law says the most economical conductor cross-section is the one for which…',
      options: [
        { id: 'a', label: 'the annual cost of the energy lost equals the annual interest and depreciation on the part of the capital cost that is proportional to the cross-section' },
        { id: 'b', label: 'the voltage drop is exactly at its permitted limit' },
        { id: 'c', label: 'the current density equals the conductor’s rating' },
      ],
      answer: 'a',
      why: 'Total = A·a + B/a is least where A·a = B/a. The law says nothing about voltage drop, current rating or corona — those must be checked separately.',
    },
    {
      id: 'kelvin-n',
      level: 'gate',
      kind: 'number',
      q: `An aluminium feeder (ρ = ${kq.rho} Ω·mm²/m) carries an equivalent ${kq.I} A for ${kq.T} h a year; energy costs ₹${kq.c}/kWh. The conductor costs ₹${kq.k} per mm² per km and interest plus depreciation is ${kq.p * 100} % a year. What cross-section does Kelvin’s law give?`,
      answer: ka,
      unit: 'mm²',
      tol: 0.5,
      why: `a* = I·√(ρ·T·c/(p·k)) = ${kq.I} × √(${kq.rho} × ${kq.T} × ${kq.c} / (${kq.p} × ${kq.k})) = ${fx(ka, 1)} mm². (Per km: capital p·k·a; losses I²·(1000ρ/a)·T·c/1000 — equal at a*.)`,
      mistake: 'Keep the units consistent: ρ in Ω·mm²/m gives R = 1000ρ/a Ω per km, and the energy cost needs kWh (divide W·h by 1000).',
    },
  ]
  useTutorContext(() => `Practise mode — ${items.length} questions on distribution systems and power-factor correction (concept, numerical, university-style and GATE-style, written for this app).`)
  return (
    <div className="ps-stack">
      <p className="small muted">
        Questions written for this app in the style of university and GATE examinations — not past papers. All values are illustrative; every answer is computed by the module’s models.
      </p>
      <Quiz items={items} onComplete={() => completeActivity(MODULE, 'practice')} />
    </div>
  )
}
