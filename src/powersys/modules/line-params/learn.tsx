import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { completeActivity } from '../../progress.ts'
import { statusFor } from '../../syllabus/coverage.ts'
import { TOPICS } from '../../syllabus/topics.ts'
import { fx } from '../../ui/format.ts'
import { Calc, Callout, Eq, Readouts, Stepper, useTutorContext } from '../../ui/kit.tsx'
import {
  ALUMINIUM,
  ARRANGEMENT_LABEL,
  computeLine,
  EPS0,
  F_DESIGN,
  imageDist,
  pct,
  presetDesign,
  R_PRIME,
  rhoAt,
  singlePhase,
  skinDepth,
  skinQ,
  skinRatioQ,
  skinWords,
  type Arrangement,
  type Bundle,
  type Design,
  type LineResult,
} from './calc.ts'
import { CrossSection } from './CrossSection.tsx'
import { DESIGN0, MODULE } from './shared.tsx'
import { TowerScene } from './TowerScene.tsx'
import { BundleRow, FluxLoop, SkinPlot, Transposition } from './visuals.tsx'

function solve(d: Design): LineResult {
  const r = computeLine(d.geometry, d.options)
  if (!r.ok) throw new Error(r.issues[0].message)
  return r
}

/** "VIT BEEE304L Module 2 · GATE EE Section 3 (partial)" for this module's topics, from the syllabus mapping. */
function SyllabusNote() {
  const ids = ['line-resistance', 'line-inductance', 'line-capacitance', 'gmd-bundles-transposition']
  const ts = TOPICS.filter((t) => ids.includes(t.id))
  const vit = ts.map((t) => statusFor(t, 'vit-eee')).find((s) => s.status === 'verified')
  const gate = ts.map((t) => statusFor(t, 'gate-ee')).filter((s) => s.status === 'verified' || s.status === 'partial')
  const gateWhere = [...new Set(gate.map((s) => s.ref.where))].filter(Boolean)
  return (
    <p className="small muted lp-syllabus">
      Syllabus: {vit ? `VIT ${vit.ref.where} Module ${vit.ref.unit} (named)` : 'VIT — not named'}
      {gateWhere.length > 0 ? ` · GATE EE Section${gateWhere.length > 1 ? 's' : ''} ${gateWhere.join(' and ')} (${gate.some((s) => s.status === 'verified') ? 'named' : 'partly'})` : ''}.
    </p>
  )
}

export function Learn({ onExplore }: { onExplore(): void }) {
  const level = useLevel()
  const [step, setStep] = useState(0)
  const [sel, setSel] = useState<string | null>(null)
  const d0 = DESIGN0
  const r0 = useMemo(() => solve(d0), [d0])
  const g0 = d0.geometry
  const single = useMemo(() => presetDesign('horizontal', 11, 15, { n: 1 }), [])
  const rs = useMemo(() => solve(single), [single])
  const bundles = useMemo(() => ([1, 2, 3, 4] as Bundle[]).map((n) => solve(presetDesign('horizontal', 11, 15, { n }))), [])
  const arr = useMemo(() => (['horizontal', 'vertical', 'triangular'] as Arrangement[]).map((a) => ({ a, r: solve(presetDesign(a)) })), [])
  // resistance worked example: the default conductor
  const rM = g0.rM
  const area = Math.PI * rM * rM
  const r20 = (ALUMINIUM.rho20 * 1000) / area
  const rT = r20 * (1 + ALUMINIUM.alpha20 * (d0.options.tempC - 20))
  const rho = rhoAt(d0.options.tempC)
  const q50 = skinQ(rM, rho, 50)
  const q1k = skinQ(rM, rho, 1000)
  // single-phase worked example
  const spD = 1.5
  const spR = 0.005
  const sp = singlePhase(spD, spR)
  // earth term for the capacitance example
  const [A, B, Cc] = g0.phases
  const Hs = [2 * A.y, 2 * B.y, 2 * Cc.y]
  const Hm = [imageDist(A, B), imageDist(B, Cc), imageDist(Cc, A)]
  const xs0 = <CrossSection design={d0} res={r0} label="Cross-section of the line in the picture" />

  const steps: Array<{ title: string; visual: ReactNode; body: ReactNode; work?: ReactNode }> = [
    {
      title: 'Why do towers look like this?',
      visual: <TowerScene design={d0} res={r0} selected={sel} onSelect={setSel} fallback={xs0} info={undefined} height={360} label="A 400 kV transmission tower with three twin-bundle phases" />,
      body: (
        <>
          <p className="lp-question">Why do towers hold their conductors in different arrangements — and why do big lines use two or four wires per phase?</p>
          <p>
            The picture is a {d0.options.kv} kV line. The <b>tower</b> is earthed steel; its <b>cross-arms</b> hold the three phases {fx(d0.spacing, 0)} m apart. <b>Insulator strings</b> keep each
            live conductor away from the steel. Each phase is a <b>bundle</b> of {g0.n} conductors {fx(g0.dM, 2)} m apart. Select any part (in the picture or the list) to see what it does.
          </p>
          <p>
            To the rest of the power system, a line is just three numbers per kilometre per phase: its <b>resistance R</b> (heating), its <b>inductance L</b> (the magnetic field around the currents)
            and its <b>capacitance C</b> (the electric field between the conductors and to earth). The tower’s shape decides L and C; the conductor decides R.
          </p>
          <SyllabusNote />
        </>
      ),
    },
    {
      title: 'Resistance: material, temperature, frequency',
      visual: (
        <>
          <SkinPlot
            curves={[
              { q: q50, label: '50 Hz', color: 'var(--ps-c)' },
              { q: q1k, label: '1 kHz', color: 'var(--ps-a)' },
            ]}
          />
          <p className="small muted">Calculated: how the current spreads across a {fx(rM * 2000, 1)} mm solid aluminium conductor (exact Bessel solution).</p>
        </>
      ),
      body: (
        <>
          <p>
            A conductor resists current in proportion to its length and inversely to its area: R = ρ·l/A. Warm it and the metal’s atoms vibrate more: R rises by α ≈ {ALUMINIUM.alpha20} per °C for
            aluminium (a typical value).
          </p>
          <p>
            With alternating current, the changing magnetic field <i>inside</i> the conductor pushes the current outwards — the <b>skin effect</b>. The current flows mostly within a skin depth δ of
            the surface, so ac resistance exceeds dc. At 50 Hz δ is {fx(skinDepth(rho, 50) * 1000, 1)} mm against a radius of {fx(rM * 1000, 1)} mm: R_ac/R_dc = {fx(skinRatioQ(q50), 4)}, an increase
            that is {skinWords(skinRatioQ(q50))}. At 1 kHz δ is {fx(skinDepth(rho, 1000) * 1000, 2)} mm and the increase is {skinWords(skinRatioQ(q1k))} (the plot).
          </p>
          <p className="small muted">
            <b>Proximity effect</b> (explained, not computed here): the field of a nearby conductor pushes current towards one side of its neighbour, adding a little more ac resistance.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="R_T = R₂₀ [1 + α (T − 20)]     δ = √(2ρ / (ωμ))"
            where={[
              ['ρ', `resistivity of aluminium, ${ALUMINIUM.rho20 * 1e8} × 10⁻⁸ at 20 °C (typical)`, 'Ω·m'],
              ['α', 'temperature coefficient', '/°C'],
              ['ω, μ', 'angular frequency 2πf; permeability μ₀ (aluminium is non-magnetic)', 'rad/s, H/m'],
            ]}
            assume="a solid round conductor; stranded ACSR conductors with a steel core are beyond this model"
          />
          <Calc
            title={`Worked example: one ${fx(rM * 2000, 1)} mm conductor, 1 km`}
            steps={[
              { label: 'Area A = π r²', expr: `π × (${fx(rM * 1000, 1)} mm)²`, result: `${fx(area * 1e6, 1)} mm²` },
              { label: 'R₂₀ = ρ l / A', expr: `${ALUMINIUM.rho20 * 1e8}×10⁻⁸ × 1000 / ${fx(area * 1e6, 1)}×10⁻⁶`, result: `${fx(r20, 4)} Ω/km` },
              { label: `R at ${d0.options.tempC} °C`, expr: `${fx(r20, 4)} × [1 + ${ALUMINIUM.alpha20} × ${d0.options.tempC - 20}]`, result: `${fx(rT, 4)} Ω/km` },
              { label: `Twin bundle: two in parallel`, expr: `${fx(rT, 4)} / 2`, result: `${fx(rT / 2, 4)} Ω/km per phase` },
              { label: 'Skin effect at 50 Hz', expr: `R_ac / R_dc (Bessel), δ = ${fx(r0.r.delta50 * 1000, 2)} mm`, result: `${fx(r0.r.ratio50, 5)}` },
            ]}
            check={{ ok: Math.abs(r0.r.rAc - (rT / 2) * r0.r.ratio50) < 1e-12, text: `The model’s R_ac per phase is ${fx(r0.r.rAc, 4)} Ω/km — the same.` }}
          />
        </>
      ),
    },
    {
      title: 'Inductance: flux that links the loop',
      visual: <FluxLoop />,
      body: (
        <>
          <p>
            A current makes a magnetic field — circles of flux around the wire. Inductance measures <b>how much flux links the circuit per ampere</b>. For two wires carrying a current out and back,
            the flux that matters is the flux passing between them, through the loop they form.
          </p>
          <p>
            Move the wires further apart and the loop is bigger, so more flux links it: L rises. But the field weakens as 1/distance, so L grows only with the <b>logarithm</b> of the spacing. Part of
            the flux is inside the conductor itself; it is counted by using a slightly smaller radius, r′ = e^(−1/4)·r = 0.7788 r.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            title="Single-phase two-wire line"
            expr="L_loop = 4 × 10⁻⁷ · ln(D / r′)  [H/m]      C_ab = π ε₀ / ln(D / r)  [F/m]"
            where={[
              ['D', 'distance between the wire centres', 'm'],
              ['r′', 'GMR of a solid round wire, e^(−1/4)·r', 'm'],
              ['ε₀', `${fx(EPS0 * 1e12, 4)} × 10⁻¹² (free space)`, 'F/m'],
            ]}
            assume="long straight parallel wires, D ≫ r, uniform current (low frequency), no earth"
          />
          <Calc
            title={`Worked example: wires ${spD} m apart, r = ${spR * 1000} mm`}
            steps={[
              { label: 'r′ = 0.7788 r', expr: `0.7788 × ${spR * 1000} mm`, result: `${fx(R_PRIME * spR * 1000, 3)} mm` },
              { label: 'ln(D / r′)', expr: `ln(${spD} / ${fx(R_PRIME * spR, 6)})`, result: fx(Math.log(spD / (R_PRIME * spR)), 4) },
              { label: 'L_loop', expr: `4×10⁻⁷ × ${fx(Math.log(spD / (R_PRIME * spR)), 4)} H/m × 1000`, result: `${fx(sp.loopH * 1e6, 4)} mH/km` },
              { label: 'C between the wires', expr: `π ε₀ / ln(${spD} / ${spR})`, result: `${fx(sp.cLineF * 1e12, 3)} nF/km` },
            ]}
          />
          <details className="ps-more" open={level === 'engineer'}>
            <summary>Where e^(−1/4) comes from</summary>
            <p className="small">
              Inside a wire of radius r with uniform current, the flux at radius x links only the fraction (x/r)² of the current. Integrating gives an internal inductance of μ₀/8π = 0.5 × 10⁻⁷ H/m,
              whatever the radius. Writing 2 × 10⁻⁷·ln(1/r′) for internal plus external flux absorbs it: ln(1/r′) = ln(1/r) + 1/4, so r′ = r·e^(−1/4).
            </p>
          </details>
        </>
      ),
    },
    {
      title: 'Three phases: spacing, transposition and GMD',
      visual: (
        <>
          <CrossSection design={single} res={rs} highlight="gmd" label="Flat three-phase line, single conductors, with the spacings D_ab, D_bc and D_ca" />
          <Transposition />
        </>
      ),
      body: (
        <>
          <p>
            In a three-phase line the three currents add to zero, so each phase’s return path is the other two. With the phases at the corners of an equilateral triangle of side D, each phase has L =
            2 × 10⁻⁷·ln(D/r′) per metre — half the single-phase loop, because it is per phase.
          </p>
          <p>
            A flat line is not symmetrical: the middle phase is close to both others, the outer phases are not. Their inductances differ. <b>Transposing</b> — swapping positions at towers so each
            phase occupies each position for a third of the length — evens them out. The result is the same formula with D replaced by the <b>geometric mean distance</b>.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="L = 2 × 10⁻⁷ · ln(GMD / GMR)  [H/m per phase]      GMD = ∛(D_ab · D_bc · D_ca)"
            where={[
              ['GMD', 'geometric mean of the three phase spacings', 'm'],
              ['GMR', 'of one phase: r′ for a single solid conductor', 'm'],
            ]}
            assume="balanced currents; fully transposed; earth ignored for inductance"
          />
          <Calc
            title="Worked example: flat line, 11 m between neighbours, one 31.8 mm conductor per phase"
            steps={[
              { label: 'Spacings', expr: 'D_ab, D_bc, D_ca', result: `${fx(rs.dab, 1)}, ${fx(rs.dbc, 1)}, ${fx(rs.dca, 1)} m` },
              { label: 'GMD', expr: `∛(${fx(rs.dab, 1)} × ${fx(rs.dbc, 1)} × ${fx(rs.dca, 1)})`, result: `${fx(rs.gmd, 3)} m` },
              { label: 'GMR = r′', expr: `0.7788 × ${fx(single.geometry.rM * 1000, 2)} mm`, result: `${fx(rs.gmrL * 1000, 2)} mm` },
              { label: 'L', expr: `0.2 × ln(${fx(rs.gmd, 3)} / ${fx(rs.gmrL, 5)}) mH/km`, result: `${fx(rs.lMhKm, 4)} mH/km` },
            ]}
            check={{
              ok: Math.abs(rs.matrix.lMhKm - rs.lMhKm) / rs.lMhKm < 1e-9,
              text: `An independent flux-linkage matrix of the three conductors, averaged over the transposition cycle, gives ${fx(rs.matrix.lMhKm, 4)} mH/km — the same.`,
            }}
          />
        </>
      ),
    },
    {
      title: 'Bundled conductors: a bigger GMR',
      visual: <BundleRow rM={g0.rM} dM={g0.dM} />,
      body: (
        <>
          <p>
            Split a phase into 2, 3 or 4 sub-conductors a few tens of centimetres apart. Seen from the other phases the bundle behaves like one conductor of a much larger radius — its <b>GMR</b>: the
            geometric mean of each sub-conductor’s r′ and its distances to the others.
          </p>
          <p>
            From one to two sub-conductors L falls {fx(Math.abs(pct(bundles[1].lMhKm, bundles[0].lMhKm)), 0)} % and the SIL rises {fx(pct(bundles[1].silMw, bundles[0].silMw), 0)} %. The larger
            equivalent radius also lowers the electric stress at the surface (less corona) — why every EHV line is bundled.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="GMR₂ = √(r′ d)     GMR₃ = ∛(r′ d²)     GMR₄ = 1.09 · ⁴√(r′ d³)"
            where={[
              ['d', 'spacing between neighbouring sub-conductors', 'm'],
              ['r′', 'GMR of one sub-conductor (use r for capacitance: r_eq)', 'm'],
            ]}
            assume="sub-conductors share the current equally; d is much smaller than the phase spacing"
          />
          <div className="table-wrap">
            <table className="ps-table">
              <caption className="small muted">
                Flat line, 11 m spacing, {fx(g0.rM * 2000, 1)} mm conductors, d = {g0.dM} m, 400 kV (computed)
              </caption>
              <thead>
                <tr>
                  <th scope="col">Sub-conductors</th>
                  <th scope="col">
                    GMR <span className="lp-unit">[mm]</span>
                  </th>
                  <th scope="col">
                    L <span className="lp-unit">[mH/km]</span>
                  </th>
                  <th scope="col">
                    C <span className="lp-unit">[nF/km]</span>
                  </th>
                  <th scope="col">
                    SIL <span className="lp-unit">[MW]</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {bundles.map((b, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{fx(b.gmrL * 1000, 1)}</td>
                    <td>{fx(b.lMhKm, 4)}</td>
                    <td>{fx(b.cNfKm, 3)}</td>
                    <td>{fx(b.silMw, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ),
    },
    {
      title: 'Capacitance, and the earth below',
      visual: <CrossSection design={d0} res={r0} showImages highlight="height" label="Cross-section with the image conductors below the ground" />,
      body: (
        <>
          <p>
            A voltage puts charge on the conductors; the charge makes an electric field between the phases and to earth. Capacitance is charge per volt. The same logarithm appears — but with <b>r</b>,
            not r′: there is no electric field inside a conductor (for a bundle, r_eq uses r).
          </p>
          <p>
            The earth is a conductor too. Its effect is found with the <b>method of images</b>: the ground acts like a mirror carrying an opposite charge at the same depth below it. Those image
            charges pull more charge onto the line, so C rises — here by {fx(pct(r0.cNfKm, r0.cNoEarthNfKm), 2)} %, because the earth ({fx(r0.hMean, 1)} m below) is far away compared with the phase
            spacing (GMD {fx(r0.gmd, 1)} m). A lower line feels the earth more.
          </p>
        </>
      ),
      work: (
        <>
          <Eq
            expr="C = 2π ε₀ / [ ln(GMD / r_eq) − ln( ∛(H_ab H_bc H_ca) / ∛(H_a H_b H_c) ) ]  [F/m to neutral]"
            where={[
              ['r_eq', 'r for one conductor; √(r d), ∛(r d²), 1.09 ⁴√(r d³) for bundles', 'm'],
              ['H_a', 'distance from phase a to its own image, 2h_a', 'm'],
              ['H_ab', 'distance from phase a to the image of phase b', 'm'],
            ]}
            assume="transposed; equal charge on each phase in every section; flat, perfectly conducting earth"
          />
          <Calc
            title="Worked example: the line in the picture"
            steps={[
              { label: 'r_eq = √(r d)', expr: `√(${fx(g0.rM, 4)} × ${g0.dM})`, result: `${fx(r0.req * 1000, 1)} mm` },
              { label: 'ln(GMD / r_eq)', expr: `ln(${fx(r0.gmd, 3)} / ${fx(r0.req, 5)})`, result: fx(Math.log(r0.gmd / r0.req), 4) },
              { label: 'C without earth', expr: `2π ε₀ / ${fx(Math.log(r0.gmd / r0.req), 4)}`, result: `${fx(r0.cNoEarthNfKm, 3)} nF/km` },
              { label: 'H_a, H_b, H_c', expr: '2 × heights', result: `${Hs.map((h) => fx(h, 1)).join(', ')} m` },
              { label: 'H_ab, H_bc, H_ca', expr: 'phase to image', result: `${Hm.map((h) => fx(h, 2)).join(', ')} m` },
              { label: 'Earth term', expr: `ln(${fx(Math.cbrt(Hm[0] * Hm[1] * Hm[2]), 3)} / ${fx(Math.cbrt(Hs[0] * Hs[1] * Hs[2]), 3)})`, result: fx(r0.earthLn, 5) },
              { label: 'C with earth', expr: `2π ε₀ / (${fx(Math.log(r0.gmd / r0.req), 4)} − ${fx(r0.earthLn, 5)})`, result: `${fx(r0.cNfKm, 3)} nF/km` },
            ]}
            check={{ ok: r0.cNfKm > r0.cNoEarthNfKm, text: `The earth raises C by ${fx(pct(r0.cNfKm, r0.cNoEarthNfKm), 2)} % at a mean height of ${fx(r0.hMean, 1)} m.` }}
          />
        </>
      ),
    },
    {
      title: 'From L and C to what the line does',
      visual: (
        <div className="ps-card">
          <Readouts
            label="The line in the picture"
            items={[
              { label: 'Reactance X', value: fx(r0.xOhmKm, 4), unit: 'Ω/km', note: 'ωL' },
              { label: 'Susceptance B', value: fx(r0.bUsKm, 3), unit: 'µS/km', note: 'ωC' },
              { label: 'Surge impedance Z_c', value: fx(r0.zcOhm, 1), unit: 'Ω' },
              { label: 'SIL at 400 kV', value: fx(r0.silMw, 0), unit: 'MW' },
            ]}
          />
          <div className="table-wrap">
            <table className="ps-table">
              <caption className="small muted">The same conductors in the three arrangements (computed)</caption>
              <thead>
                <tr>
                  <th scope="col">Arrangement</th>
                  <th scope="col">
                    GMD <span className="lp-unit">[m]</span>
                  </th>
                  <th scope="col">
                    X <span className="lp-unit">[Ω/km]</span>
                  </th>
                  <th scope="col">
                    B <span className="lp-unit">[µS/km]</span>
                  </th>
                  <th scope="col">
                    SIL <span className="lp-unit">[MW]</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {arr.map(({ a, r }) => (
                  <tr key={a}>
                    <td>{ARRANGEMENT_LABEL[a]}</td>
                    <td>{fx(r.gmd, 2)}</td>
                    <td>{fx(r.xOhmKm, 4)}</td>
                    <td>{fx(r.bUsKm, 3)}</td>
                    <td>{fx(r.silMw, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ),
      body: (
        <>
          <p>
            At {F_DESIGN} Hz the inductance becomes a series reactance X = ωL and the capacitance a shunt susceptance B = ωC. Together with R these are exactly the per-km constants Module 2 uses to
            model a loaded line.
          </p>
          <p>
            So the answer to the opening question: the arrangement is set mainly by clearances and cost, and changes L and C only logarithmically; bundling raises the GMR a lot, lowering Z_c and
            raising the SIL — more power per line.
          </p>
          <Callout tone="info" title="Not covered here">
            Double-circuit lines (two three-phase circuits on one tower) are not modelled in this module.
          </Callout>
          <button type="button" className="btn btn--primary ps-btn-sm" onClick={onExplore}>
            Design your own line →
          </button>
        </>
      ),
      work: (
        <>
          <Eq
            expr="X = ωL     B = ωC     Z_c = √(L / C)     SIL = V² / Z_c"
            where={[
              ['Z_c', 'surge impedance of the lossless line', 'Ω'],
              ['SIL', 'surge impedance loading: the load at which the line’s capacitance supplies exactly the reactive power its inductance absorbs', 'MW'],
              ['V', 'line-to-line voltage', 'kV'],
            ]}
          />
        </>
      ),
    },
  ]
  const onFinish = useCallback(() => completeActivity(MODULE, 'tour'), [])
  const cur = steps[step]
  useTutorContext(
    () =>
      `Learn mode — line parameters, step ${step + 1} of ${steps.length}: ${cur.title}. Default line: 400 kV flat, 11 m spacing, twin bundle of ${fx(g0.rM * 2000, 1)} mm conductors 0.45 m apart, 15 m high: GMD ${fx(r0.gmd, 3)} m, GMR ${fx(r0.gmrL * 1000, 2)} mm, L ${fx(r0.lMhKm, 4)} mH/km, C ${fx(r0.cNfKm, 3)} nF/km, X ${fx(r0.xOhmKm, 4)} Ω/km, B ${fx(r0.bUsKm, 3)} µS/km, Zc ${fx(r0.zcOhm, 1)} Ω, SIL ${fx(r0.silMw, 0)} MW.`,
  )
  return (
    <div className="ps-split lp-learn">
      <div className="lp-learn-visual">
        {cur.visual}
        {cur.work}
      </div>
      <div className="ps-card ps-tour">
        <Stepper steps={steps} index={step} onIndex={setStep} onFinish={onFinish} />
      </div>
    </div>
  )
}
