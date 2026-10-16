import { useMemo } from 'react'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Calc, Callout, Quiz, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import {
  beltedByMatrix,
  beltedCharging,
  beltedFromMeasurements,
  capacitanceByCharge,
  capacitanceGraded,
  computeCable,
  DEFAULT_CABLE,
  economicNumeric,
  economicSize,
  EPS0,
  equalPeakRadii,
  gradedVoltageByIntegration,
  insulationByShells,
  intersheathEqualPeak,
  NUM_TOL,
  stressByDerivative,
  verifyChecks,
  voltageByIntegration,
  type CableInput,
  type CableResult,
  type GradedResult,
} from './calc.ts'
import { GRADING0, gradingOutcome, type GradingState } from './grading.ts'
import { sci } from './explore.tsx'
import { MODULE } from './shared.tsx'

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b)
function solve(c: Partial<CableInput>): CableResult {
  const r = computeCable({ ...DEFAULT_CABLE, ...c })
  if (!r.ok) throw new Error(r.issues[0].message)
  return r
}

// ── Verify ────────────────────────────────────────────────────────────────────────────────────────────────────

export function Verify({ cable, gPerm, grading, edited }: { cable: CableInput; gPerm: number; grading: GradingState; edited: boolean }) {
  const progress = usePsProgress()
  const own = useMemo(() => computeCable(cable), [cable])
  const res = own.ok ? own : solve({})
  const c = res.c
  const ch = useMemo(() => verifyChecks(res, gPerm), [res, gPerm])
  const vV = c.vKv * 1000
  const eco = economicSize(c.vKv, gPerm)
  const ecoN = economicNumeric(c.vKv, gPerm)
  const gOwn = gradingOutcome(res, grading)
  const g: GradedResult = gOwn.ok ? gOwn : (gradingOutcome(res, GRADING0) as GradedResult)
  const gSum = g.layers.reduce((s, l) => s + l.vKv, 0)
  const gInt = gradedVoltageByIntegration(g)
  const dCont = g.kind === 'capacitance' ? g.layers.slice(1).every((l, i) => rel(g.layers[i].eps * g.layers[i].gMin, l.eps * l.gMax) < 1e-9) : true
  const gOk = rel(gSum, c.vKv) < 1e-9 && rel(gInt, c.vKv) < NUM_TOL && dCont
  const bel = beltedFromMeasurements(0.9, 0.6)
  const belOk = bel.ok ? bel : null
  const wJkm = (res.qKvarKm * 1000) / (2 * res.omega)
  useTutorContext(
    () =>
      `Verify mode: hand calculations of g_max/g_min, C, R_ins, charging current and loss, the economical size, a graded cable and a three-core cable, each checked by a second method. Cable r ${c.rMm} mm, R ${c.RMm} mm, V ${c.vKv} kV: g_max ${fx(res.gMax, 2)} kV/cm, C ${fx(res.cUfKm, 4)} µF/km.`,
  )
  const quiz: QuizItem[] = [
    {
      id: 'g-turn',
      kind: 'number',
      level: 'numerical',
      q: `Your turn: a cable has r = ${fx(c.rMm, 1)} mm, R = ${fx(c.RMm, 1)} mm and ${fx(c.vKv, 1)} kV between core and sheath. What is the maximum stress?`,
      answer: res.gMax,
      unit: 'kV/cm',
      tol: Math.max(0.01, res.gMax * 0.01),
      why: `g_max = ${fx(c.vKv, 1)} / (${fx(res.r, 2)} × ln(${fx(res.R, 2)}/${fx(res.r, 2)})) = ${fx(res.gMax, 2)} kV/cm.`,
      mistake: 'Use radii (not diameters) in centimetres, and the natural logarithm.',
    },
  ]
  return (
    <div className="ps-stack">
      <Callout title="Check the model’s numbers by hand">
        <p>
          {own.ok ? (edited ? 'For the cable you set in Explore. ' : 'For the default cable. ') : 'Your Explore cable is not valid, so the default cable is checked. '}
          Each block repeats a result with the textbook formula and compares it with an independent second method. Numerical integrals use Simpson’s rule (4000 steps) and derivatives a central
          difference (h = 10⁻⁵·x): for these smooth 1/x-type functions their own error is below 10⁻⁷, so agreement within {NUM_TOL} (relative) is required.{' '}
          {isDone(progress, MODULE, 'verify') && '✓ Done.'}
        </p>
      </Callout>
      <Calc
        title="1 · Stress at the conductor and at the sheath"
        steps={[
          { label: 'ln(R/r)', expr: `ln(${fx(res.R, 3)} / ${fx(res.r, 3)})`, result: fx(res.ln, 5) },
          { label: 'g_max = V/(r ln(R/r))', expr: `${fx(c.vKv, 2)} / (${fx(res.r, 3)} × ${fx(res.ln, 5)})`, result: `${fx(res.gMax, 3)} kV/cm` },
          { label: 'g_min = V/(R ln(R/r))', expr: `${fx(c.vKv, 2)} / (${fx(res.R, 3)} × ${fx(res.ln, 5)})`, result: `${fx(res.gMin, 3)} kV/cm` },
          { label: 'g_max / g_min', expr: 'R / r', result: fx(res.ratio, 4) },
        ]}
        check={{
          ok: ch.gmax.ok && ch.gmin.ok && ch.vint.ok,
          text: `Second method — −dV/dx of the potential V(x), numerically: ${fx(stressByDerivative(c.vKv, res.r, res.r, res.R), 3)} kV/cm at r and ${fx(stressByDerivative(c.vKv, res.R, res.r, res.R), 3)} kV/cm at R; and ∫g dx from r to R = ${fx(voltageByIntegration(c.vKv, res.r, res.R), 4)} kV = V. Largest relative difference ${Math.max(ch.gmax.rel, ch.gmin.rel, ch.vint.rel).toExponential(1)}.`,
        }}
      />
      <Calc
        title="2 · Capacitance"
        steps={[
          { label: 'C = 2πε₀ε_r / ln(R/r)', expr: `2π × ${fx(EPS0 * 1e12, 4)}×10⁻¹² × ${fx(c.epsR, 1)} / ${fx(res.ln, 5)}`, result: `${fx(res.cFm * 1e12, 3)} pF/m` },
          { label: 'Per km', expr: '× 1000 m', result: `${fx(res.cUfKm, 5)} µF/km` },
          { label: `For ${fx(c.lengthKm, 1)} km`, expr: `${fx(res.cUfKm, 5)} × ${fx(c.lengthKm, 1)}`, result: `${fx(res.cUf, 4)} µF` },
        ]}
        check={{
          ok: ch.cap.ok && ch.energy.ok,
          text: `Second method — 1 µC/m on the conductor, Gauss’s field integrated from r to R gives V, so C = q/V = ${fx(capacitanceByCharge(c.epsR, res.r, res.R) * 1e9, 5)} µF/km; third — the stored energy ∫½εE²·2πx dx = ½CV² gives ${fx(ch.energy.b * 1e9, 5)} µF/km. Relative differences ${ch.cap.rel.toExponential(1)} and ${ch.energy.rel.toExponential(1)}.`,
        }}
      />
      <Calc
        title="3 · Insulation resistance"
        steps={[
          { label: 'R_ins × l = ρ ln(R/r) / 2π', expr: `${sci(c.rhoOhmM)} × ${fx(res.ln, 5)} / 2π`, result: `${(res.rInsMOhmKm * 1e9).toExponential(4)} Ω·m` },
          { label: 'In MΩ·km', expr: '÷ 10³ (m → km) ÷ 10⁶ (Ω → MΩ)', result: `${res.rInsMOhmKm >= 1e5 ? res.rInsMOhmKm.toExponential(4) : fx(res.rInsMOhmKm, 1)} MΩ·km` },
          { label: `For ${fx(c.lengthKm, 1)} km`, expr: `÷ ${fx(c.lengthKm, 1)}`, result: `${res.rInsMOhm >= 1e5 ? res.rInsMOhm.toExponential(4) : fx(res.rInsMOhm, 1)} MΩ` },
        ]}
        check={{
          ok: ch.rins.ok,
          text: `Second method — thin cylindrical shells in series, ∫ρ dx/(2πx) from r to R: ${(insulationByShells(c.rhoOhmM, res.r, res.R) / 1e9).toExponential(5)} MΩ·km (relative difference ${ch.rins.rel.toExponential(1)}).`,
        }}
      />
      <Calc
        title={`4 · Charging current, reactive power and dielectric loss (per core, ${c.fHz} Hz)`}
        steps={[
          { label: 'I_c = ωCV', expr: `${fx(res.omega, 2)} × ${fx(res.cUfKm, 5)}×10⁻⁶ × ${fx(vV, 0)}`, result: `${fx(res.icAKm, 4)} A/km` },
          { label: 'Q = ωCV²', expr: `${fx(res.icAKm, 4)} × ${fx(c.vKv, 2)} kV`, result: `${fx(res.qKvarKm, 3)} kvar/km` },
          { label: 'P = ωCV² tan δ', expr: `${fx(res.qKvarKm * 1000, 1)} × ${c.tanDelta}`, result: `${fx(res.pWKm, 3)} W/km` },
        ]}
        check={{
          ok: ch.reactive.ok,
          text: `Second method — the average electric energy stored in the insulation (field integral) is ${fx(wJkm, 4)} J/km; Q = 2ω·W = ${fx(ch.reactive.b, 3)} kvar/km (relative difference ${ch.reactive.rel.toExponential(1)}).`,
        }}
      />
      <Calc
        title={`5 · Most economical size for ${fx(c.vKv, 1)} kV and G = ${fx(gPerm, 0)} kV/cm`}
        steps={[
          { label: 'r = V/G', expr: `${fx(c.vKv, 2)} / ${fx(gPerm, 0)}`, result: `${fx(eco.rCm, 5)} cm` },
          { label: 'R = e·r', expr: `2.71828 × ${fx(eco.rCm, 5)}`, result: `${fx(eco.RCm, 5)} cm` },
        ]}
        check={{
          ok: ch.econ.ok,
          text: `Second method — golden-section search for the smallest R(r) = r·e^(V/(Gr)) over r from 1 µm to 100 m: r = ${fx(ecoN.rCm, 5)} cm, R = ${fx(ecoN.RCm, 5)} cm (relative difference in r ${ch.econ.rel.toExponential(1)}; near a minimum R is flat, so r is found less sharply than R).`,
        }}
      />
      <Calc
        title={`6 · ${g.kind === 'capacitance' ? 'Capacitance' : 'Intersheath'} grading, ${g.layers.length} layers${gOwn.ok ? ' (your Explore grading)' : ' (the default grading: yours is not valid)'}`}
        steps={[
          ...(g.kind === 'capacitance'
            ? [{ label: 'K = V / Σ ln(r_i/r_{i−1})/ε_i', expr: `${fx(c.vKv, 2)} / ${fx(c.vKv / g.kKv!, 5)}`, result: `${fx(g.kKv!, 3)} kV` }]
            : [{ label: 'Potentials', expr: 'conductor, intersheath(s), sheath', result: `${g.potentials!.map((p) => fx(p, 2)).join(', ')} kV` }]),
          ...g.layers.map((l, i) => ({
            label: `Layer ${i + 1}: ${fx(l.inner * 10, 1)}–${fx(l.outer * 10, 1)} mm`,
            expr: g.kind === 'capacitance' ? `g_max = K/(${fx(l.eps, 1)} × ${fx(l.inner, 3)})` : `g_max = ${fx(l.vKv, 2)} / (${fx(l.inner, 3)} × ln(${fx(l.outer, 3)}/${fx(l.inner, 3)}))`,
            result: `${fx(l.gMax, 3)} kV/cm (ΔV ${fx(l.vKv, 3)} kV)`,
          })),
        ]}
        check={{
          ok: gOk,
          text: `The layer voltages add to ${fx(gSum, 4)} kV = V${g.kind === 'capacitance' ? '; D is continuous at every boundary (ε_i g_i equal on both sides)' : ''}. Second method — integrating each layer’s stress numerically from its inner to its outer radius and adding: ${fx(gInt, 4)} kV (relative difference ${rel(gInt, c.vKv).toExponential(1)}).`,
        }}
      />
      {belOk && (
        <Calc
          title="7 · Three-core belted cable: C₁ = 0.9 µF, C₂ = 0.6 µF (illustrative measurements)"
          steps={[
            { label: 'C_s = C₁/3', expr: '0.9 / 3', result: `${fx(belOk.cs, 4)} µF` },
            { label: 'C_c = (C₂ − C_s)/2', expr: `(0.6 − ${fx(belOk.cs, 4)}) / 2`, result: `${fx(belOk.cc, 4)} µF` },
            { label: 'C_n = C_s + 3C_c', expr: `${fx(belOk.cs, 4)} + 3 × ${fx(belOk.cc, 4)}`, result: `${fx(belOk.cn, 4)} µF` },
          ]}
          check={{
            ok: rel(beltedByMatrix(belOk.cs, belOk.cc).re, belOk.cn) < 1e-9 && Math.abs(beltedByMatrix(belOk.cs, belOk.cc).im) < 1e-9,
            text: `Second method — the cores’ capacitance matrix driven by balanced phase voltages: q_a/V_a = ${fx(beltedByMatrix(belOk.cs, belOk.cc).re, 4)} µF (a real number: no coupling to the other phases is left).`,
          }}
        />
      )}
      <section className="ps-card">
        <h3>Your turn</h3>
        <Quiz items={quiz} onComplete={() => completeActivity(MODULE, 'verify')} />
      </section>
    </div>
  )
}

// ── Practise ──────────────────────────────────────────────────────────────────────────────────────────────────

export function Practise() {
  const items = useMemo<QuizItem[]>(() => {
    const base = solve({})
    const longer = solve({ lengthKm: base.c.lengthKm * 2 })
    const hiEps = solve({ epsR: base.c.epsR * 2 })
    // a 2 cm / 5 cm diameter cable, ε_r 3.5, ρ 5×10¹² Ω·m, 2 km, on a 66 kV system
    const q1 = solve({ rMm: 10, RMm: 25, epsR: 3.5, rhoOhmM: 5e12, lengthKm: 2, vKv: 66 / Math.sqrt(3), fHz: 50 })
    // 33 kV core-to-sheath, d = 1 cm, D = 4 cm
    const q2 = solve({ rMm: 5, RMm: 20, vKv: 33 })
    const eco = economicSize(50, 40)
    const capEps = [5, 4]
    const r1 = equalPeakRadii(1, capEps)[0]
    const cg = capacitanceGraded(66, [1, r1, 2.5], capEps) as GradedResult
    const isP = intersheathEqualPeak(66, [1, 1.6, 2.5])[0]
    const bel = beltedFromMeasurements(0.84, 0.54)
    const belI = bel.ok ? beltedCharging(bel.cn, 11, 50) : NaN
    const loss = 3 * 2 * Math.PI * 50 * 0.25e-6 * 10 * (66e3 / Math.sqrt(3)) ** 2 * 0.002
    const thick = solve({ rMm: 10, RMm: 30 }).gMax / solve({ rMm: 10, RMm: 20 }).gMax
    return [
      {
        id: 'where-max',
        kind: 'choice',
        level: 'concept',
        q: 'In a single-core cable, where is the electric stress in the insulation highest?',
        options: [
          { id: 'a', label: 'At the conductor surface' },
          { id: 'b', label: 'At the sheath' },
          { id: 'c', label: 'Halfway through the insulation' },
          { id: 'd', label: 'It is the same everywhere' },
        ],
        answer: base.gMax > base.gMin ? 'a' : 'b',
        why: `The flux q/(2πx) is densest on the smallest circle: ${fx(base.gMax, 2)} kV/cm at the conductor against ${fx(base.gMin, 2)} kV/cm at the sheath for the default cable.`,
        mistake: 'Stress is flux density ÷ ε, and the same flux passes through a smaller circumference near the conductor.',
      },
      {
        id: 'length-rins',
        kind: 'choice',
        level: 'concept',
        q: 'A cable’s length is doubled. Its insulation resistance…',
        options: [
          { id: 'up', label: 'doubles' },
          { id: 'down', label: 'halves' },
          { id: 'same', label: 'does not change' },
        ],
        answer: longer.rInsMOhm < base.rInsMOhm * 0.99 ? 'down' : longer.rInsMOhm > base.rInsMOhm * 1.01 ? 'up' : 'same',
        why: `The leakage paths (radial) are in parallel along the length: ${fx(base.rInsMOhm, 0)} → ${fx(longer.rInsMOhm, 0)} MΩ.`,
        mistake: 'Leakage flows radially, not along the cable — more length means more parallel paths.',
      },
      {
        id: 'eps-stress',
        kind: 'choice',
        level: 'concept',
        q: 'A single-dielectric cable is made with an insulation of twice the permittivity (same r, R and V). The maximum stress…',
        options: [
          { id: 'up', label: 'rises' },
          { id: 'down', label: 'falls' },
          { id: 'same', label: 'does not change (but the capacitance doubles)' },
        ],
        answer: rel(hiEps.gMax, base.gMax) < 1e-9 ? 'same' : hiEps.gMax > base.gMax ? 'up' : 'down',
        why: `g = V/(x ln(R/r)) has no ε_r: ${fx(base.gMax, 2)} kV/cm either way, while C goes ${fx(base.cUfKm, 4)} → ${fx(hiEps.cUfKm, 4)} µF/km.`,
      },
      {
        id: 'grading-why',
        kind: 'choice',
        level: 'concept',
        q: 'Why is the insulation of a high-voltage cable graded?',
        options: [
          { id: 'a', label: 'To make the stress more uniform, so the whole thickness is used and the peak stress falls' },
          { id: 'b', label: 'To raise the capacitance and so the charging current' },
          { id: 'c', label: 'To lower the conductor resistance' },
        ],
        answer: 'a',
        why: 'Ungraded, the insulation near the sheath works far below its strength; grading moves stress from the conductor surface outwards.',
      },
      {
        id: 'cap',
        kind: 'number',
        level: 'numerical',
        q: 'A single-core cable has a conductor diameter of 2 cm and a sheath inner diameter of 5 cm; the insulation has ε_r = 3.5. What is its capacitance per km?',
        answer: q1.cUfKm,
        unit: 'µF/km',
        tol: q1.cUfKm * 0.01,
        why: `C = 2π × 8.854×10⁻¹² × 3.5 / ln(2.5) × 1000 = ${fx(q1.cUfKm, 4)} µF/km.`,
        mistake: 'Use the ratio of the radii (or the diameters — the same ratio), the natural logarithm, and ×1000 for a km.',
      },
      {
        id: 'rins',
        kind: 'number',
        level: 'numerical',
        q: 'The same cable has an insulation resistivity of 5 × 10¹² Ω·m. What is the insulation resistance of 2 km?',
        answer: q1.rInsMOhm,
        unit: 'MΩ',
        tol: q1.rInsMOhm * 0.01,
        why: `R_ins = ρ ln(R/r) / (2π l) = 5×10¹² × ${fx(q1.ln, 4)} / (2π × 2000) = ${fx(q1.rInsMOhm, 1)} MΩ.`,
        mistake: 'The length is in the denominator (and in metres).',
      },
      {
        id: 'ic',
        kind: 'number',
        level: 'numerical',
        q: 'The same cable is one phase of a 66 kV, 50 Hz three-phase circuit (sheath earthed). What is its charging current per km?',
        answer: q1.icAKm,
        unit: 'A/km',
        tol: q1.icAKm * 0.01,
        why: `V = 66/√3 = ${fx(q1.c.vKv, 2)} kV; I_c = ωCV = 2π50 × ${fx(q1.cUfKm, 4)}×10⁻⁶ × ${fx(q1.c.vKv * 1000, 0)} = ${fx(q1.icAKm, 3)} A/km.`,
        mistake: 'Use the phase voltage (core to sheath), not the line voltage.',
      },
      {
        id: 'gmax',
        kind: 'number',
        level: 'university',
        q: 'A single-core cable has a conductor diameter of 1 cm and a sheath inner diameter of 4 cm, with 33 kV (rms) between core and sheath. Find the maximum stress.',
        answer: q2.gMax,
        unit: 'kV/cm',
        tol: 0.1,
        why: `g_max = 33 / (0.5 × ln 4) = ${fx(q2.gMax, 2)} kV/cm (and g_min = ${fx(q2.gMin, 2)} kV/cm at the sheath).`,
        mistake: 'r is the radius, 0.5 cm — not the diameter.',
      },
      {
        id: 'econ',
        kind: 'number',
        level: 'university',
        q: 'A single-core cable is to work at 50 kV (rms, core to sheath) with a permissible maximum stress of 40 kV/cm (rms). Find the most economical conductor diameter.',
        answer: eco.rCm * 2,
        unit: 'cm',
        tol: 0.01,
        why: `r = V/G = 50/40 = ${fx(eco.rCm, 3)} cm, so d = ${fx(eco.rCm * 2, 2)} cm; the sheath diameter is then e·d = ${fx(eco.RCm * 2, 2)} cm.`,
        mistake: 'The condition ln(R/r) = 1 gives r = V/G; the question asks for the diameter, 2r.',
      },
      {
        id: 'capgrade',
        kind: 'number',
        level: 'university',
        q: 'A capacitance-graded cable (r = 1 cm, R = 2.5 cm, 66 kV core to sheath) has an inner layer of ε_r = 5 and an outer layer of ε_r = 4, with the boundary placed for equal maximum stresses. What is that maximum stress?',
        answer: cg.peak,
        unit: 'kV/cm',
        tol: 0.2,
        why: `ε₁r = ε₂r₁ gives r₁ = 5 × 1/4 = ${fx(r1, 3)} cm; K = 66 / (ln(1.25)/5 + ln(2.5/1.25)/4) = ${fx(cg.kKv!, 2)} kV; g_max = K/(ε₁r) = ${fx(cg.peak, 2)} kV/cm in both layers.`,
        mistake: 'Find the boundary first (ε₁r = ε₂r₁), then share V between the layers in proportion to ln(r_i/r_{i−1})/ε_i.',
      },
      {
        id: 'inter',
        kind: 'number',
        level: 'university',
        q: 'A single-core cable (r = 1 cm, R = 2.5 cm, 66 kV core to sheath) has one intersheath at 1.6 cm. At what potential must the intersheath be held for equal maximum stresses in the two layers?',
        answer: isP,
        unit: 'kV',
        tol: 0.2,
        why: `G = 66 / (1 × ln 1.6 + 1.6 × ln(2.5/1.6)) = ${fx(66 / (Math.log(1.6) + 1.6 * Math.log(2.5 / 1.6)), 2)} kV/cm; V₁ = 66 − G × 1 × ln 1.6 = ${fx(isP, 2)} kV.`,
        mistake: 'Each layer is its own small cable: ΔV_i = G·r_{i−1}·ln(r_i/r_{i−1}).',
      },
      {
        id: 'belted',
        kind: 'number',
        level: 'university',
        q: 'On a three-core belted cable, all three cores joined measure 0.84 µF to the sheath; one core against the other two joined to the sheath measures 0.54 µF. What is the charging current per phase on an 11 kV, 50 Hz system?',
        answer: belI,
        unit: 'A',
        tol: 0.01,
        why: bel.ok
          ? `C_s = 0.84/3 = ${fx(bel.cs, 3)} µF; C_c = (0.54 − ${fx(bel.cs, 3)})/2 = ${fx(bel.cc, 3)} µF; C_n = C_s + 3C_c = ${fx(bel.cn, 3)} µF; I = 2π50 × ${fx(bel.cn, 3)}×10⁻⁶ × 11000/√3 = ${fx(belI, 3)} A.`
          : '',
        mistake: 'C_n = C_s + 3C_c (the delta of C_c becomes a star of 3C_c), and use the phase voltage.',
      },
      {
        id: 'ratio',
        kind: 'number',
        level: 'gate',
        q: 'For the most economical single-core cable (smallest overall size for a given voltage and permissible stress), what is the ratio R/r of sheath to conductor radius?',
        answer: eco.RCm / eco.rCm,
        unit: '',
        tol: 0.01,
        why: `ln(R/r) = 1, so R/r = e = ${fx(eco.RCm / eco.rCm, 4)}.`,
      },
      {
        id: 'thick',
        kind: 'number',
        level: 'gate',
        q: 'In a single-core cable with r = 1 cm and R = 2 cm, R is increased to 3 cm at the same voltage. The new maximum stress is what fraction of the old one?',
        answer: thick,
        unit: '',
        tol: 0.005,
        why: `g_max ∝ 1/ln(R/r): ln 2 / ln 3 = ${fx(thick, 4)} — not one half.`,
        mistake: 'The thickness enters through a logarithm.',
      },
      {
        id: 'loss',
        kind: 'number',
        level: 'gate',
        q: 'Three single-core cables of 0.25 µF/km each, 10 km long, form a 66 kV, 50 Hz circuit. With tan δ = 0.002, what is the total dielectric loss?',
        answer: loss / 1000,
        unit: 'kW',
        tol: 0.05,
        why: `P = 3 × ωCV² tan δ = 3 × 2π50 × 2.5×10⁻⁶ × (66000/√3)² × 0.002 = ${fx(loss / 1000, 2)} kW.`,
        mistake: 'Use the phase voltage per core and multiply by three cores; C is for the whole 10 km.',
      },
    ]
  }, [])
  useTutorContext(
    () =>
      'Practise mode: questions on cable stress, capacitance, insulation resistance, charging current, dielectric loss, economical size, grading and three-core capacitance. Answers come from the module’s calculations.',
  )
  return (
    <div className="ps-card ps-practise">
      <h3>Practice questions</h3>
      <p className="small muted">
        From concept to GATE-style. Every number comes from this module’s calculations; the questions are written for this app (not past papers). Answer all of them correctly to complete the activity.
      </p>
      <Quiz items={items} onComplete={() => completeActivity(MODULE, 'practice')} />
    </div>
  )
}
