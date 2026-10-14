import { useMemo } from 'react'
import { C, sub } from '../../engine/complex.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Calc, Callout, Quiz, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import { chargingMvar, lineParams, sil } from '../three-phase/calc.ts'
import {
  ALUMINIUM,
  bundleGmFormula,
  capacitanceF,
  computeLine,
  EPS0,
  F_DESIGN,
  imageDist,
  inductanceH,
  inductanceMatrix,
  linkages,
  pct,
  potentialMatrix,
  presetDesign,
  R_PRIME,
  rDcPerKm,
  singlePhase,
  skinCheck,
  skinWords,
  matrixTol,
  type Design,
  type LineResult,
} from './calc.ts'
import { DESIGN0, MODULE } from './shared.tsx'

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b)

// ── Verify ────────────────────────────────────────────────────────────────────────────────────────────────────

export function Verify({ design, edited }: { design: Design; edited: boolean }) {
  const progress = usePsProgress()
  const out = useMemo(() => computeLine(design.geometry, design.options), [design])
  const useOwn = out.ok
  const d = useOwn ? design : DESIGN0
  const res = useMemo(() => (out.ok ? out : (computeLine(DESIGN0.geometry, DESIGN0.options) as LineResult)), [out])
  const g = d.geometry
  const o = d.options
  const [A, B, Cp] = g.phases
  const w = 2 * Math.PI * F_DESIGN
  // 1 · inductance by hand
  const gmdHand = Math.cbrt(res.dab * res.dbc * res.dca)
  const rp = R_PRIME * g.rM
  const gmrHand = bundleGmFormula(g.n, g.dM, rp)
  const lHand = inductanceH(gmdHand, gmrHand) * 1e6
  // 2 · capacitance by hand
  const req = bundleGmFormula(g.n, g.dM, g.rM)
  const Hs = [2 * A.y, 2 * B.y, 2 * Cp.y]
  const Hm = [imageDist(A, B), imageDist(B, Cp), imageDist(Cp, A)]
  const earthLn = o.earth ? Math.log(Math.cbrt(Hm[0] * Hm[1] * Hm[2]) / Math.cbrt(Hs[0] * Hs[1] * Hs[2])) : 0
  const cHand = ((2 * Math.PI * EPS0) / (Math.log(gmdHand / req) - earthLn)) * 1e12
  // 3 · resistance by hand
  const sk = skinCheck(res.r.q50)
  const r20 = rDcPerKm(g.rM, 20)
  const rT = r20 * (1 + ALUMINIUM.alpha20 * (o.tempC - 20))
  // 4 · X, B, Zc, SIL — and Module 2's own formulas for the same constants
  const xHand = w * lHand * 1e-3
  const bHand = w * cHand * 1e-9 * 1e6
  const zcHand = Math.sqrt((lHand * 1e-3) / (cHand * 1e-9))
  const silHand = (o.kv * o.kv) / zcHand
  const k = { rOhmPerKm: res.r.rAc, xOhmPerKm: res.xOhmKm, bUsPerKm: res.bUsKm }
  const m2 = lineParams(k, 1)
  // 5 · single-phase line, checked by flux linkage
  const spD = 2
  const spR = 0.006
  const sp = singlePhase(spD, spR)
  const lam = linkages(
    inductanceMatrix(
      [
        { x: 0, y: 10 },
        { x: spD, y: 10 },
      ],
      R_PRIME * spR,
    ),
    [C(1), C(-1)],
  )
  const loopMatrix = sub(lam[0], lam[1]).re
  const P2 = potentialMatrix(
    [
      { x: 0, y: 10 },
      { x: spD, y: 10 },
    ],
    spR,
    false,
  )
  const cMatrix = 1 / (P2[0][0] - P2[0][1] - P2[1][0] + P2[1][1])
  useTutorContext(
    () =>
      `Verify mode: hand calculations of GMD, GMR, L, C (with the earth term), R with temperature and skin effect, X, B, Zc and SIL, checked against the matrix model and Module 2's formulas. Line: GMD ${fx(res.gmd, 3)} m, L ${fx(res.lMhKm, 4)} mH/km, C ${fx(res.cNfKm, 3)} nF/km.`,
  )
  const quiz: QuizItem[] = [
    {
      id: 'l-turn',
      kind: 'number',
      level: 'numerical',
      q: `Your turn: a transposed line has GMD = ${fx(res.gmd, 3)} m and a bundle GMR of ${fx(res.gmrL * 1000, 2)} mm. What is its inductance per phase?`,
      answer: res.lMhKm,
      unit: 'mH/km',
      tol: Math.max(0.002, res.lMhKm * 0.005),
      why: `L = 0.2 × ln(${fx(res.gmd, 3)} / ${fx(res.gmrL, 5)}) = ${fx(res.lMhKm, 4)} mH/km.`,
      mistake: 'Use the GMR in metres (mm ÷ 1000) and the natural logarithm; 2 × 10⁻⁷ H/m is 0.2 mH/km.',
    },
  ]
  return (
    <div className="ps-stack">
      <Callout title="Check the model’s numbers by hand">
        <p>
          {useOwn
            ? edited
              ? 'For the line you designed in Explore. '
              : 'For the default line (a 400 kV flat line with twin bundles). '
            : 'Your Explore design is not valid, so the default line is checked. '}
          Each block repeats a result with the textbook formula and compares it with a second, independent method. {isDone(progress, MODULE, 'verify') && '✓ Done.'}
        </p>
      </Callout>
      <Calc
        title="1 · Inductance: GMD and GMR"
        steps={[
          { label: 'Spacings', expr: 'D_ab, D_bc, D_ca', result: `${fx(res.dab, 3)}, ${fx(res.dbc, 3)}, ${fx(res.dca, 3)} m` },
          { label: 'GMD = ∛(D_ab D_bc D_ca)', expr: `∛(${fx(res.dab * res.dbc * res.dca, 2)})`, result: `${fx(gmdHand, 4)} m` },
          { label: 'r′ = 0.7788 r', expr: `0.7788 × ${fx(g.rM * 1000, 2)} mm`, result: `${fx(rp * 1000, 3)} mm` },
          {
            label: g.n === 1 ? 'GMR = r′' : `GMR (${g.n} sub-conductors)`,
            expr: g.n === 1 ? 'one conductor' : g.n === 2 ? `√(${fx(rp, 5)} × ${g.dM})` : g.n === 3 ? `∛(${fx(rp, 5)} × ${g.dM}²)` : `1.09 × ⁴√(${fx(rp, 5)} × ${g.dM}³)`,
            result: `${fx(gmrHand * 1000, 2)} mm`,
          },
          { label: 'L = 0.2 ln(GMD/GMR)', expr: `0.2 × ln(${fx(gmdHand, 4)} / ${fx(gmrHand, 5)})`, result: `${fx(lHand, 4)} mH/km` },
        ]}
        check={{
          ok: rel(res.matrix.lMhKm, lHand) < matrixTol(g.n),
          text: `Independent check — flux linkages of all ${res.matrix.conductors} sub-conductors with balanced currents, averaged over a transposition cycle: ${fx(res.matrix.lMhKm, 4)} mH/km (${fx(Math.abs(pct(res.matrix.lMhKm, lHand)), 4)} % apart${g.n > 1 ? ': the formula uses bundle-centre distances, so the two differ by more as the bundle size approaches the phase spacing' : ' — the same'}).`,
        }}
      />
      <Calc
        title={`2 · Capacitance to neutral${o.earth ? ', with the earth' : ''}`}
        steps={[
          { label: g.n === 1 ? 'r_eq = r' : 'r_eq (with r, not r′)', expr: g.n === 1 ? 'one conductor' : `bundle formula with r = ${fx(g.rM * 1000, 2)} mm`, result: `${fx(req * 1000, 2)} mm` },
          { label: 'ln(GMD / r_eq)', expr: `ln(${fx(gmdHand, 4)} / ${fx(req, 5)})`, result: fx(Math.log(gmdHand / req), 5) },
          ...(o.earth
            ? [
                { label: 'H_a, H_b, H_c (to own image)', expr: '2 h', result: `${Hs.map((h) => fx(h, 2)).join(', ')} m` },
                { label: 'H_ab, H_bc, H_ca (to the others’ images)', expr: '√((x_a − x_b)² + (h_a + h_b)²) …', result: `${Hm.map((h) => fx(h, 3)).join(', ')} m` },
                { label: 'Earth term', expr: 'ln(∛(H_ab H_bc H_ca) / ∛(H_a H_b H_c))', result: fx(earthLn, 6) },
              ]
            : []),
          { label: 'C = 2π ε₀ / (…)', expr: `2π × ${fx(EPS0 * 1e12, 4)}×10⁻¹² / ${fx(Math.log(gmdHand / req) - earthLn, 5)} × 10¹²`, result: `${fx(cHand, 4)} nF/km` },
        ]}
        check={{
          ok: rel(res.matrix.cEqualNfKm, cHand) < matrixTol(g.n),
          text: `Independent check — potential coefficients of every sub-conductor${o.earth ? ' and its image' : ''}, equal charges, averaged over the cycle: ${fx(res.matrix.cEqualNfKm, 4)} nF/km (${fx(Math.abs(pct(res.matrix.cEqualNfKm, cHand)), 4)} % apart${g.n > 1 ? ', from the bundle-centre distances' : ''}). Solving exactly (each bundle one equipotential, charge free to vary): ${fx(res.matrix.cNfKm, 4)} nF/km, ${fx(pct(res.matrix.cNfKm, cHand), 2)} % — the size of the textbook’s equal-charge approximation.`,
        }}
      />
      <Calc
        title={`3 · Resistance at ${o.tempC} °C and 50 Hz`}
        steps={[
          { label: 'R₂₀ = ρ l / (π r²)', expr: `${ALUMINIUM.rho20 * 1e8}×10⁻⁸ × 1000 / (π × ${fx(g.rM, 4)}²)`, result: `${fx(r20, 5)} Ω/km` },
          { label: `R at ${o.tempC} °C`, expr: `${fx(r20, 5)} × [1 + ${ALUMINIUM.alpha20} × (${o.tempC} − 20)]`, result: `${fx(rT, 5)} Ω/km` },
          { label: 'Per phase', expr: `${fx(rT, 5)} / ${g.n}`, result: `${fx(rT / g.n, 5)} Ω/km` },
          { label: 'Skin effect (Bessel)', expr: `q = √2 r/δ = ${fx(res.r.q50, 4)}`, result: `R_ac/R_dc = ${fx(res.r.ratio50, 6)}` },
          { label: 'R_ac per phase', expr: `${fx(rT / g.n, 5)} × ${fx(res.r.ratio50, 6)}`, result: `${fx(res.r.rAc, 5)} Ω/km` },
        ]}
        check={{
          ok: sk.bracketed,
          text: `The exact ratio must lie between the high-frequency asymptote max(1, r/(2δ) + ¼) = ${fx(Math.max(1, sk.high), 5)} and the low-frequency estimate 1 + q⁴/192 = ${fx(sk.low, 5)}: it does. ${
            sk.regime === 'low'
              ? `With q = ${fx(res.r.q50, 3)} (≤ 2) the low-frequency estimate applies: ${fx(Math.abs(pct(sk.low, sk.exact)), 2)} % above the exact value.`
              : sk.regime === 'high'
                ? `With q = ${fx(res.r.q50, 3)} (≥ 3) the high-frequency asymptote applies: ${fx(Math.abs(pct(sk.high, sk.exact)), 2)} % below the exact value.`
                : `With q = ${fx(res.r.q50, 3)} (between 2 and 3) neither estimate is close — only the exact Bessel solution is.`
          } At 50 Hz the skin effect of this conductor is ${skinWords(res.r.ratio50)}.`,
        }}
      />
      <Calc
        title="4 · What Module 2 receives"
        steps={[
          { label: 'X = ωL', expr: `2π × 50 × ${fx(lHand, 4)}×10⁻³`, result: `${fx(xHand, 5)} Ω/km` },
          { label: 'B = ωC', expr: `2π × 50 × ${fx(cHand, 4)}×10⁻⁹ × 10⁶`, result: `${fx(bHand, 4)} µS/km` },
          { label: 'Z_c = √(L/C)', expr: `√(${fx(lHand, 4)}×10⁻³ / ${fx(cHand, 4)}×10⁻⁹)`, result: `${fx(zcHand, 2)} Ω` },
          { label: 'SIL = V²/Z_c', expr: `${o.kv}² / ${fx(zcHand, 2)}`, result: `${fx(silHand, 1)} MW` },
        ]}
        check={{
          ok: rel(m2.zcLossless, res.zcOhm) < 1e-9 && rel(sil(o.kv, m2.zcLossless), res.silMw) < 1e-9,
          text: `Module 2’s own formulas with r = ${fx(k.rOhmPerKm, 4)}, x = ${fx(k.xOhmPerKm, 4)} Ω/km, b = ${fx(k.bUsPerKm, 3)} µS/km: Z_c = √(x/b) = ${fx(m2.zcLossless, 2)} Ω, SIL = ${fx(sil(o.kv, m2.zcLossless), 1)} MW, charging ${fx(chargingMvar(o.kv, k, 100), 2)} Mvar per 100 km — the same.`,
        }}
      />
      <Calc
        title={`5 · Single-phase line: wires ${spD} m apart, r = ${spR * 1000} mm`}
        steps={[
          { label: 'L_loop = 4×10⁻⁷ ln(D/r′)', expr: `4×10⁻⁷ × ln(${spD} / ${fx(R_PRIME * spR, 6)})`, result: `${fx(sp.loopH * 1e6, 4)} mH/km` },
          { label: 'C = π ε₀ / ln(D/r)', expr: `π ε₀ / ln(${spD} / ${spR})`, result: `${fx(sp.cLineF * 1e12, 4)} nF/km` },
        ]}
        check={{
          ok: rel(loopMatrix, sp.loopH) < 1e-12 && rel(cMatrix, sp.cLineF) < 1e-12,
          text: `Flux linkages of the two wires with +I and −I: (λ₁ − λ₂)/I = ${fx(loopMatrix * 1e6, 4)} mH/km; charges +q and −q: q/(V₁ − V₂) = ${fx(cMatrix * 1e12, 4)} nF/km — the same.`,
        }}
      />
      <section className="ps-card">
        <h3>Your turn</h3>
        <Quiz items={quiz} onComplete={() => completeActivity(MODULE, 'verify')} />
      </section>
    </div>
  )
}

// ── Practise ──────────────────────────────────────────────────────────────────────────────────────────────────

function solve(d: Design): LineResult {
  const r = computeLine(d.geometry, d.options)
  if (!r.ok) throw new Error(r.issues[0].message)
  return r
}

export function Practise() {
  const items = useMemo<QuizItem[]>(() => {
    const base = solve(DESIGN0)
    const one = solve(presetDesign('horizontal', 11, 15, { n: 1 }))
    const twin = solve(presetDesign('horizontal', 11, 15, { n: 2 }))
    const noEarth = solve({ ...DESIGN0, options: { ...DESIGN0.options, earth: false } })
    const sp = singlePhase(2, 0.006)
    // a flat line 4 m between neighbours, r = 10 mm, transposed
    const flat4 = solve({ ...presetDesign('horizontal', 4, 12, { n: 1, rM: 0.01 }), options: { ...DESIGN0.options, earth: false } })
    // twin bundle r = 15 mm, d = 0.4 m, GMD 12 m (no earth)
    const cTwin = capacitanceF(12, Math.sqrt(0.015 * 0.4)) * 1e12
    const r75 = 0.06 * (1 + ALUMINIUM.alpha20 * 55)
    const zc = Math.sqrt(1.0e-3 / 11e-9)
    return [
      {
        id: 'bundle-why',
        kind: 'choice',
        level: 'concept',
        q: 'Why do EHV lines use bundled conductors?',
        options: [
          { id: 'a', label: 'To raise the inductance and limit fault current' },
          { id: 'b', label: 'A larger GMR: lower L, higher C, lower Z_c — so a higher SIL — and lower surface field (less corona)' },
          { id: 'c', label: 'Only to make the line mechanically stronger' },
        ],
        answer: 'b',
        why: `Here twin instead of single conductors: L ${fx(one.lMhKm, 3)} → ${fx(twin.lMhKm, 3)} mH/km, SIL ${fx(one.silMw, 0)} → ${fx(twin.silMw, 0)} MW.`,
        mistake: 'Bundling lowers the inductance — the bundle behaves like one conductor of a much larger radius.',
      },
      {
        id: 'transpose-why',
        kind: 'choice',
        level: 'concept',
        q: 'What does transposing an unsymmetrically spaced line achieve?',
        options: [
          { id: 'a', label: 'It lowers the resistance' },
          { id: 'b', label: 'It makes the three phase inductances (and capacitances) equal, so balanced currents give balanced drops' },
          { id: 'c', label: 'It removes the capacitance to earth' },
        ],
        answer: 'b',
        why: `Untransposed, this flat line’s phase inductances are ${base.matrix.lPhase.map((z) => fx(z.re, 3)).join(', ')} mH/km; transposed, all are ${fx(base.lMhKm, 3)} mH/km.`,
      },
      {
        id: 'skin',
        kind: 'choice',
        level: 'concept',
        q: 'As the frequency rises, the ac resistance of a solid conductor…',
        options: [
          { id: 'a', label: 'falls, because the current spreads out' },
          { id: 'b', label: 'rises, because the current crowds into a skin of depth δ = √(2ρ/ωμ) at the surface' },
          { id: 'c', label: 'stays equal to the dc resistance' },
        ],
        answer: 'b',
        why: 'δ shrinks as 1/√f, so less of the cross-section carries current.',
      },
      {
        id: 'earth',
        kind: 'choice',
        level: 'concept',
        q: 'Including the effect of the earth (method of images) makes the line’s capacitance to neutral…',
        options: [
          { id: 'up', label: 'slightly larger' },
          { id: 'down', label: 'slightly smaller' },
          { id: 'same', label: 'exactly the same' },
        ],
        answer: base.cNfKm > noEarth.cNfKm ? 'up' : base.cNfKm < noEarth.cNfKm ? 'down' : 'same',
        why: `For the 400 kV line at 15 m: ${fx(noEarth.cNfKm, 3)} → ${fx(base.cNfKm, 3)} nF/km (${fx(pct(base.cNfKm, noEarth.cNfKm), 2)} %). The image charges pull more charge onto the line.`,
      },
      {
        id: 'sp-l',
        kind: 'number',
        level: 'numerical',
        q: 'A single-phase line has two solid wires of radius 6 mm, 2 m apart. What is its loop inductance?',
        answer: sp.loopH * 1e6,
        unit: 'mH/km',
        tol: sp.loopH * 1e6 * 0.005,
        why: `L = 4×10⁻⁷ ln(2 / (0.7788 × 0.006)) H/m = ${fx(sp.loopH * 1e6, 4)} mH/km.`,
        mistake: 'Use r′ = 0.7788 r for inductance, and the loop formula has 4×10⁻⁷ (two conductors), not 2×10⁻⁷.',
      },
      {
        id: 'gmd',
        kind: 'number',
        level: 'numerical',
        q: 'A transposed three-phase line has its conductors in a horizontal row, 4 m between neighbours. What is its GMD?',
        answer: flat4.gmd,
        unit: 'm',
        tol: 0.01,
        why: `GMD = ∛(4 × 4 × 8) = ${fx(flat4.gmd, 3)} m.`,
        mistake: 'The outer phases are 8 m apart: GMD = ∛(D·D·2D), not the plain average.',
      },
      {
        id: 'flat-l',
        kind: 'number',
        level: 'university',
        q: 'The same line uses solid conductors of radius 10 mm. What is the inductance per phase?',
        answer: flat4.lMhKm,
        unit: 'mH/km',
        tol: 0.005,
        why: `L = 0.2 ln(${fx(flat4.gmd, 3)} / 0.007788) = ${fx(flat4.lMhKm, 4)} mH/km.`,
        mistake: 'Per phase uses 2×10⁻⁷ H/m (0.2 mH/km) and GMR = 0.7788 r.',
      },
      {
        id: 'twin-c',
        kind: 'number',
        level: 'university',
        q: 'A transposed line has twin bundles (r = 15 mm, d = 0.4 m) and GMD = 12 m. Ignoring the earth, what is its capacitance to neutral?',
        answer: cTwin,
        unit: 'nF/km',
        tol: 0.05,
        why: `r_eq = √(0.015 × 0.4) = ${fx(Math.sqrt(0.006) * 1000, 1)} mm; C = 2π ε₀ / ln(12 / ${fx(Math.sqrt(0.006), 4)}) = ${fx(cTwin, 3)} nF/km.`,
        mistake: 'For capacitance the bundle radius uses r, not r′.',
      },
      {
        id: 'r75',
        kind: 'number',
        level: 'university',
        q: 'An aluminium conductor has R₂₀ = 0.06 Ω/km. Taking α = 0.00403 /°C, what is its resistance at 75 °C?',
        answer: r75,
        unit: 'Ω/km',
        tol: 0.0005,
        why: `R₇₅ = 0.06 × (1 + 0.00403 × 55) = ${fx(r75, 4)} Ω/km.`,
      },
      {
        id: 'gate-double',
        kind: 'number',
        level: 'gate',
        q: 'If the GMD of a transposed line is doubled (conductors unchanged), by how much does the inductance per phase increase?',
        answer: 0.2 * Math.log(2),
        unit: 'mH/km',
        tol: 0.002,
        why: `ΔL = 0.2 ln(2·GMD/GMR) − 0.2 ln(GMD/GMR) = 0.2 ln 2 = ${fx(0.2 * Math.log(2), 4)} mH/km, whatever the line.`,
        mistake: 'L depends on the logarithm of the spacing — it does not double.',
      },
      {
        id: 'gate-zc',
        kind: 'number',
        level: 'gate',
        q: 'A lossless line has L = 1.0 mH/km and C = 11 nF/km per phase. What is its surge impedance?',
        answer: zc,
        unit: 'Ω',
        tol: 1,
        why: `Z_c = √(L/C) = √(1.0×10⁻³ / 11×10⁻⁹) = ${fx(zc, 1)} Ω.`,
        mistake: 'Convert to H and F per km (or both per m) before dividing.',
      },
    ]
  }, [])
  useTutorContext(
    () => `Practise mode: questions on line resistance, inductance, capacitance, GMD/GMR, bundles, transposition, earth effect and surge impedance. Answers come from the module's calculations.`,
  )
  return (
    <div className="ps-card ps-practise">
      <h3>Practice questions</h3>
      <p className="small muted">
        From concept to GATE-style. Every number comes from this module’s calculations; the questions are written for this app. Answer all of them correctly to complete the activity.
      </p>
      <Quiz items={items} onComplete={() => completeActivity(MODULE, 'practice')} />
    </div>
  )
}
