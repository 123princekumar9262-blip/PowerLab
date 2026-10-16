import { useMemo } from 'react'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Calc, Callout, Quiz, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import { computeSpan, G, G0_RMS, RHO_ICE, type SpanResult } from './calc.ts'
import { CORONA_HAND_TOL, coronaCheck, lengthTensionCheck, loadsCheck, parabolaCheck, stringCheck, unequalCheck } from './checks.ts'
import { coronaOf, DESIGN0, spanOf, stringOf, toSpanInput, type Design } from './model.ts'
import { deg, kN, MODULE } from './shared.tsx'

/*
 * Verify: each block repeats a model result with the textbook formula and checks it against an independent second
 * method (checks.ts — tested over the whole range of every control, so a valid design never shows ✗).
 */

export function Verify({ design, edited }: { design: Design; edited: boolean }) {
  const progress = usePsProgress()
  const sOut = useMemo(() => spanOf(design), [design])
  const tOut = useMemo(() => stringOf(design), [design])
  const cOut = useMemo(() => coronaOf(design), [design])
  const useOwn = sOut.ok && tOut.ok && cOut.ok
  const s = useMemo(() => (useOwn ? sOut : spanOf(DESIGN0)) as SpanResult, [useOwn, sOut])
  const st = useOwn && tOut.ok ? tOut : (stringOf(DESIGN0) as Extract<ReturnType<typeof stringOf>, { ok: true }>)
  const cor = useOwn && cOut.ok ? cOut : (coronaOf(DESIGN0) as Extract<ReturnType<typeof coronaOf>, { ok: true }>)
  const level = s.input.h === 0
  const wr = s.loads.wr
  const pc = parabolaCheck(s.T0, wr, s.Lp)
  const lt = lengthTensionCheck(s)
  const lc = loadsCheck(s)
  // unequal supports: the design's own span, or (for a level design) an example with support B 20 m higher
  const uSpan = useMemo(() => {
    if (!level) return s
    const r = computeSpan({ ...toSpanInput(DESIGN0.span), h: 20, T0: 10e3 })
    return r.ok ? r : s
  }, [level, s])
  const uc = unequalCheck(uSpan)
  const sc = stringCheck(st)
  const cc = coronaCheck(cor)
  const ci = cor.input
  const n = st.input.n
  const yourTurn = (wr * s.Lp * s.Lp) / (8 * s.T0)
  useTutorContext(
    () =>
      `Verify mode: hand calculations for the span (parabola vs catenary, length and support tension, wind and ice loads, unequal supports), the insulator string (ladder vs nodal solve) and corona (Peek's Vc vs the surface gradient). Span: w_r ${fx(wr, 3)} N/m, T0 ${fx(kN(s.T0), 3)} kN, catenary sag ${fx(s.cat.SB, 4)} m.`,
  )
  const quiz: QuizItem[] = [
    {
      id: 'sag-turn',
      kind: 'number',
      level: 'numerical',
      q: `Your turn: a level span of ${fx(s.Lp, 1)} m carries a load of ${fx(wr, 3)} N/m at a tension of ${fx(kN(s.T0), 3)} kN. What is its sag by the parabolic formula?`,
      answer: yourTurn,
      unit: 'm',
      tol: Math.max(0.01, yourTurn * 0.005),
      why: `S = wL²/(8T₀) = ${fx(wr, 3)} × ${fx(s.Lp, 1)}² / (8 × ${fx(s.T0, 0)}) = ${fx(yourTurn, 4)} m.`,
      mistake: 'Keep the units consistent: N/m, m and N (not kN) — and square the span.',
    },
  ]
  return (
    <div className="ps-stack">
      <Callout title="Check the model’s numbers by hand">
        <p>
          {useOwn
            ? edited
              ? 'For the design you set in Explore. '
              : 'For the default design (a 300 m span, a 5-disc 66 kV string). '
            : 'Your Explore design is not valid, so the default design is checked. '}
          Each block repeats a result with the textbook formula and compares it with an independent second method; the tolerance of each comparison is stated.{' '}
          {isDone(progress, MODULE, 'verify') && '✓ Done.'}
        </p>
      </Callout>
      <Calc
        title={`1 · Sag: parabola against the exact catenary${level ? '' : ' (the same span with level supports)'}`}
        steps={[
          { label: 'Parabola S = w_r L²/(8T₀)', expr: `${fx(wr, 3)} × ${fx(s.Lp, 1)}² / (8 × ${fx(s.T0, 1)})`, result: `${fx(pc.Spar, 4)} m` },
          { label: 'c = T₀ / w_r', expr: `${fx(s.T0, 1)} / ${fx(wr, 3)}`, result: `${fx(pc.c, 2)} m` },
          { label: 'Catenary S = c(cosh(L/2c) − 1)', expr: `${fx(pc.c, 2)} × (cosh ${fx(pc.u, 5)} − 1)`, result: `${fx(pc.Scat, 4)} m` },
          { label: '(S_cat − S_par)/S_par', expr: `(${fx(pc.Scat, 4)} − ${fx(pc.Spar, 4)}) / ${fx(pc.Spar, 4)}`, result: `${fx(pc.d * 100, 4)} %` },
          { label: 'Series bracket', expr: `(4/3)(S/L)² … (4/3)(S/L)²·cosh(L/2c)`, result: `${fx(pc.lo * 100, 4)} … ${fx(pc.hi * 100, 4)} %` },
        ]}
        check={{
          ok: pc.ok,
          text: `The catenary is ${fx(pc.d * 100, 4)} % deeper than the parabola — inside the bracket the series of cosh guarantees (the parabola keeps only its first term). The parabola is ${Math.abs(pc.d) <= 0.01 ? 'within' : 'more than'} 1 % here.`,
        }}
      />
      <Calc
        title="2 · Conductor length and support tension"
        steps={[
          { label: 'Length (closed form)', expr: level ? '2c·sinh(L/2c)' : 'c[sinh((L′ − u₀)/c) + sinh(u₀/c)]', result: `${fx(s.cat.length, 4)} m` },
          { label: 'Length (Simpson, 2000 strips)', expr: '∫ √(1 + y′²) dx along the span', result: `${fx(lt.numLen, 4)} m` },
          { label: 'T = T₀ + w_r·S (vertical balance)', expr: `${fx(s.T0, 1)} + ${fx(wr, 3)} × ${fx(s.cat.SB, 4)}`, result: `${fx(kN(lt.tBalance), 4)} kN` },
          { label: 'T = T₀·√(1 + y′²) (along the tangent)', expr: `${fx(s.T0, 1)} × √(1 + ${fx(Math.sinh((s.Lp - s.cat.u0) / s.cat.c), 5)}²)`, result: `${fx(kN(lt.tTangent), 4)} kN` },
        ]}
        check={{
          ok: lt.ok,
          text: `Length: the two agree within 1 part in 10⁷ (Simpson’s error for this smooth curve is far smaller). Tension: the two expressions are the identity cosh² − sinh² = 1, equal to 1 part in 10⁹.`,
        }}
      />
      <Calc
        title="3 · Wind and ice loads, vertical sag and clearance"
        steps={[
          { label: 'w_i = ρ·g·π/4·((d+2t)² − d²)', expr: `${RHO_ICE} × ${G} × π/4 × ((${fx(s.input.d, 4)} + ${fx(2 * s.input.iceT, 3)})² − ${fx(s.input.d, 4)}²)`, result: `${fx(lc.wi, 3)} N/m` },
          { label: 'w_w = p(d + 2t)', expr: `${fx(s.input.windP, 0)} × ${fx(s.input.d + 2 * s.input.iceT, 4)}`, result: `${fx(lc.ww, 3)} N/m` },
          { label: 'w_r = √((w + w_i)² + w_w²)', expr: `√(${fx(lc.wv, 3)}² + ${fx(lc.ww, 3)}²)`, result: `${fx(lc.wr, 3)} N/m` },
          { label: 'θ = atan(w_w / (w + w_i))', expr: `atan(${fx(lc.ww, 3)} / ${fx(lc.wv, 3)})`, result: `${fx(deg(lc.theta), 3)}°` },
          ...(level
            ? [
                { label: 'Vertical sag S·cos θ', expr: `${fx(lc.S, 4)} × cos ${fx(deg(lc.theta), 3)}°`, result: `${fx(lc.vSag, 4)} m` },
                { label: 'Clearance h_A − S·cos θ', expr: `${fx(s.input.hA, 2)} − ${fx(lc.vSag, 4)}`, result: `${fx(lc.clear, 4)} m` },
              ]
            : []),
        ]}
        check={{
          ok: lc.ok,
          text: level
            ? `The model finds the lowest point by minimising the height of the 3D curve (no cos θ): ${fx(s.clearance, 4)} m clearance — the same to 10⁻⁹ m. The ice weight by the annulus area equals the formula ρgπt(d + t) exactly.`
            : `The loads equal the model’s (ice by the annulus area = ρgπt(d + t) exactly). With unequal supports the lowest point is found on the 3D curve: ${fx(s.vSagA, 3)} m below A, clearance ${fx(s.clearance, 3)} m.`,
        }}
      />
      <Calc
        title={`4 · Supports at different levels${level ? ' (example: support B 20 m higher, T₀ = 10 kN)' : ''}`}
        steps={[
          { label: 'x₁ = L/2 − T₀h/(wL)', expr: `${fx(uSpan.Lp / 2, 2)} − ${fx(uSpan.T0, 0)} × ${fx(uSpan.hp, 3)} / (${fx(uSpan.loads.wr, 3)} × ${fx(uSpan.Lp, 2)})`, result: `${fx(uc.par.x1, 3)} m` },
          { label: 'x₂ = L − x₁', expr: `${fx(uSpan.Lp, 2)} − ${fx(uc.par.x1, 3)}`, result: `${fx(uc.par.x2, 3)} m` },
          { label: 'S₁ = w x₁²/(2T₀)', expr: `${fx(uSpan.loads.wr, 3)} × ${fx(uc.par.x1, 3)}² / (2 × ${fx(uSpan.T0, 0)})`, result: `${fx(uc.par.SA, 4)} m` },
          { label: 'S₂ = w x₂²/(2T₀)', expr: `${fx(uSpan.loads.wr, 3)} × ${fx(uc.par.x2, 3)}² / (2 × ${fx(uSpan.T0, 0)})`, result: `${fx(uc.par.SB, 4)} m` },
          { label: 'Catenary S₁, S₂', expr: 'exact', result: `${fx(uSpan.cat.SA, 4)}, ${fx(uSpan.cat.SB, 4)} m` },
        ]}
        check={{
          ok: uc.ok,
          text: `S₂ − S₁ = ${fx(uc.dPar, 6)} m (parabola) and ${fx(uc.dCat, 6)} m (catenary) — both equal h${uSpan.loads.theta > 0 ? `′ = h·cos θ = ${fx(uSpan.hp, 6)} m (with wind, h is taken in the plane of the load)` : ` = ${fx(uSpan.hp, 6)} m`}, to 10⁻⁹ of the span.${uc.par.x1 < 0 ? ' x₁ < 0: the lowest point lies outside the span; S₁ is not a sag in the span.' : ''}`,
        }}
      />
      <Calc
        title={`5 · Insulator string: ${n} discs, m = ${fx(st.input.m, 2)}, ${st.input.kv} kV${st.input.grading !== 'none' ? `, ${st.input.grading === 'guard' ? 'ideal guard ring' : 'capacitance grading'}` : ''}`}
        steps={[
          { label: 'Phase voltage V = V_LL/√3', expr: `${st.input.kv} / √3`, result: `${fx(st.V, 4)} kV` },
          { label: 'Ladder: V_{k+1} = V_k + m(V₁ + … + V_k)', expr: 'equal discs, then scaled to Σ = V', result: `${sc.ladder.map((v) => fx(v, 3)).join(', ')} kV` },
          ...(st.input.grading !== 'none'
            ? [
                {
                  label: `With ${st.input.grading === 'guard' ? 'the ring' : 'grading'} (nodal solve)`,
                  expr: st.input.grading === 'guard' ? 'C_g,k = C·m·k/(n − k)' : 'C_k = C(1 + m·k(k−1)/2)',
                  result: `${st.discV.map((v) => fx(v, 3)).join(', ')} kV`,
                },
              ]
            : []),
          { label: 'Σ disc voltages', expr: st.discV.map((v) => fx(v, 3)).join(' + '), result: `${fx(sc.sum, 4)} kV` },
          { label: 'η = V / (n·V_max)', expr: `${fx(st.V, 4)} / (${n} × ${fx(Math.max(...st.discV), 4)})`, result: `${fx(st.eff * 100, 3)} %` },
        ]}
        check={{
          ok: sc.ok,
          text: `An independent nodal solve of the equal-disc circuit (a matrix of the ${n - 1} link equations) gives ${sc.plain.map((v) => fx(v, 3)).join(', ')} kV — the ladder’s values to 1 part in 10⁹.${st.input.grading !== 'none' ? ` With ${st.input.grading === 'guard' ? 'the ideal ring' : 'grading'} every disc takes V/n = ${fx(st.V / n, 4)} kV (to 10⁻⁹).` : ''}`,
        }}
      />
      <Calc
        title={`6 · Corona: r = ${fx(ci.rCm, 3)} cm, D = ${fx(ci.DCm, 0)} cm, m₀ = ${fx(ci.m0, 2)}, ${fx(ci.b, 1)} cmHg, ${ci.t} °C`}
        steps={[
          { label: 'By hand: δ = 3.92 b/(273 + t)', expr: `3.92 × ${fx(ci.b, 1)} / (273 + ${ci.t})`, result: fx(cc.delta, 5) },
          { label: 'ln(D/r)', expr: `ln(${fx(ci.DCm, 0)} / ${fx(ci.rCm, 3)})`, result: fx(cor.lnDr, 5) },
          { label: 'V_c = m₀ g₀ δ r ln(D/r), g₀ = 30/√2', expr: `${fx(ci.m0, 2)} × 21.213 × ${fx(cc.delta, 5)} × ${fx(ci.rCm, 3)} × ${fx(cor.lnDr, 5)}`, result: `${fx(cc.vcHand, 3)} kV phase` },
          { label: 'The model (δ = (b/76)(298/(273 + t)))', expr: `δ = ${fx(cc.deltaExact, 5)}`, result: `${fx(cor.vc, 3)} kV phase` },
          { label: 'Line to line √3·V_c', expr: `√3 × ${fx(cor.vc, 2)}`, result: `${fx(cor.vcLine, 1)} kV` },
          { label: 'With g₀ rounded to 21.1', expr: `${fx(cc.vcHand, 3)} × 21.1 / 21.213`, result: `${fx(cc.vc211, 2)} kV` },
          { label: 'Consistency: q = 2πε₀V_c/ln(D/r)', expr: 'charge per metre at V_c', result: `${fx(cc.q * 1e6, 4)} µC/m` },
          { label: 'Surface field E = q/(2πε₀r)', expr: `in kV/cm; breakdown m₀g₀δ = ${fx(cc.gCrit, 4)}`, result: `${fx(cc.g, 4)} kV/cm` },
        ]}
        check={{
          ok: cc.ok,
          text: `The hand value differs from the model by ${fx(Math.abs(cc.vcHand / cor.vc - 1) * 100, 4)} % — within the ${fx(CORONA_HAND_TOL * 100, 2)} % allowed, because the textbook 3.92 is 298/76 = 3.92105 rounded. The last two lines are a consistency check, not an independent method: they confirm that V_c is the voltage at which the surface field reaches the air's breakdown gradient. Rounding g₀ to 21.1 lowers V_c by ${fx((1 - 21.1 / G0_RMS) * 100, 2)} %.`,
        }}
      />
      <section className="ps-card">
        <h3>Your turn</h3>
        <Quiz items={quiz} onComplete={() => completeActivity(MODULE, 'verify')} />
      </section>
    </div>
  )
}
