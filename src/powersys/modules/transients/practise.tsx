import { useMemo } from 'react'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Calc, Callout, Quiz, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import { amps, kv, MODULE, termName } from './shared.tsx'
import { GRID_N, verifyChecks } from './verify.ts'
import { PRACTICE } from './practiceData.ts'
import { gammaOf, LI_FIT, margin, SEP0, separationFormula, tauOf, type WaveModel } from './waves.ts'

// ── Verify ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function Verify({ model, probeF, edited }: { model: WaveModel; probeF: number; edited: boolean }) {
  const progress = usePsProgress()
  const c = useMemo(() => verifyChecks(model, probeF), [model, probeF])
  const { own, m, an, xP, grid, zl, g, aHand, vHand, iHand, iLoadHand, gEnd, gS, rows, maxDiff, hand, vs, is, ss, E, series, lateK, vEndLate, predicted, sep, sr, sg, sgMax, sgTol, sf, li } = c
  const zlTxt = zl === Infinity ? '∞' : fx(zl, 2)
  const tHand = 3.5 * an.T

  useTutorContext(
    () =>
      `Verify mode: Γ and τ by hand, the lattice at the probe against an independent method-of-characteristics grid (${GRID_N} sections), v = Zc·i for one wave, the closed-form steady state, the separation-distance rule against two simulations, and the impulse fit. Model: ${termName(m, an)}, Zc ${fx(an.zc, 1)} Ω, Γ_L ${fx(an.gammaL, 4)}.`,
  )
  const quiz: QuizItem[] = [
    {
      id: 'turn',
      kind: 'number',
      level: 'numerical',
      q: `Your turn: a ${fx(1000, 0)} kV wave on a line with Z_c = ${fx(an.zc, 1)} Ω reaches a ${fx(1500, 0)} Ω resistor. What is the voltage across the resistor just after the wave arrives?`,
      answer: 1000 * tauOf(1500, an.zc),
      unit: 'kV',
      tol: 1,
      why: `τ = 2 × 1500 / (1500 + ${fx(an.zc, 1)}) = ${fx(tauOf(1500, an.zc), 4)}, so ${fx(1000 * tauOf(1500, an.zc), 1)} kV.`,
      mistake: 'The end voltage is (1 + Γ) × the incident wave — not Γ × the incident wave (that is only the reflected part).',
    },
  ]
  return (
    <div className="ps-stack">
      <Callout title="Check the model’s numbers by hand — and by a second, independent method">
        <p>
          {own ? (edited ? 'For the model you set up in Explore' : 'For the default model') : 'Your Explore inputs are not valid, so the default model is checked'}: {termName(m, an)}, Z_c ={' '}
          {fx(an.zc, 1)} Ω, R_s = {fx(m.rs, 0)} Ω, {m.arrester ? `arrester V_res ${fx(m.vres, 0)} kV, ` : ''}probe at {fx(xP / 1000, 2)} km. {isDone(progress, MODULE, 'verify') && '✓ Done.'}
        </p>
      </Callout>
      <Calc
        title="1 · Reflection and transmission at the end"
        steps={[
          { label: 'Z_L, Z_c', expr: termName(m, an), result: `${zlTxt} Ω, ${fx(an.zc, 2)} Ω` },
          { label: 'Γ = (Z_L − Z_c)/(Z_L + Z_c)', expr: zl === Infinity ? 'Z_L → ∞' : `(${zlTxt} − ${fx(an.zc, 2)}) / (${zlTxt} + ${fx(an.zc, 2)})`, result: fx(g, 5) },
          { label: 'τ = 1 + Γ', expr: `1 + ${fx(g, 5)}`, result: fx(1 + g, 5) },
          { label: 'Current reflection −Γ, transmission 1 − Γ', expr: `−(${fx(g, 5)}), 1 − ${fx(g, 5)}`, result: `${fx(-g, 5)}, ${fx(1 - g, 5)}` },
          { label: 'Incident wave at the end, t = 1.5 T', expr: `k·e(T/2) = ${fx(an.k, 4)} × ${fx(aHand / an.k, 3)} kV`, result: kv(aHand, 3) },
          {
            label: m.arrester ? 'End voltage (τ·a, capped at V_res)' : 'End voltage = τ × incident',
            expr: m.arrester ? `min(|${fx(1 + g, 5)} × ${fx(aHand, 3)}|, ${fx(m.vres, 0)})` : `${fx(1 + g, 5)} × ${fx(aHand, 3)}`,
            result: kv(vHand, 3),
          },
          { label: 'Line current at the end (incident − reflected)/Z_c', expr: `(2 × ${fx(aHand, 3)} − ${fx(vHand, 3)}) / ${fx(an.zc, 2)}`, result: amps(iHand) },
          { label: 'Current in the load', expr: zl === Infinity ? 'open end' : zl === 0 ? 'short: all of it' : `${fx(vHand, 3)} kV / ${zlTxt} Ω`, result: amps(iLoadHand) },
        ]}
        check={{
          ok: c.coefficientsOk,
          text: `Independent check — the Bergeron grid solver’s far end at t = 1.5 T: v = ${kv(gEnd.v, 3)}, line current ${amps(gEnd.i)}, load current ${amps(gEnd.i - gEnd.iArr)}${m.arrester ? `, arrester ${amps(gEnd.iArr)}` : ''} — the hand values above${m.arrester ? ', with |v| ≤ V_res' : ''}.`,
        }}
      />
      <Calc
        title={`2 · The ${m.arrester ? 'wave solution' : 'lattice'} at the probe against an independent time-domain solution`}
        steps={[
          ...(m.arrester
            ? [{ label: 'Arrester fitted', expr: 'non-linear end: superposition (the lattice sum) does not apply', result: 'compare the wave-function solution' }]
            : [
                {
                  label: `Lattice terms at t = 3.5 T = ${fx(tHand, 2)} µs`,
                  expr: hand.terms.map((q) => `${q.mult >= 0 ? '+' : '−'}${fx(Math.abs(q.mult), 4)}·k·e`).join(' '),
                  result: kv(hand.v, 3),
                },
              ]),
          ...rows.map((r) => ({
            label: `t = ${fx(r.t, 2)} µs`,
            expr: `${m.arrester ? 'solution' : 'lattice'} ${fx(r.vSol, 4)} · grid ${fx(r.vGrid, 4)} kV`,
            result: `Δ ${r.d === 0 ? '0' : r.d.toExponential(1)} kV`,
          })),
        ]}
        check={{
          ok: c.gridOk,
          text: `Method of characteristics (Bergeron) on ${GRID_N} sections with Δt = Δx/v = ${fx(grid.dt * 1000, 3)} ns, every node’s voltage and current stepped in time: the largest difference at the probe over all ${grid.t.length} time steps is ${maxDiff.toExponential(2)} kV. Both methods are exact for a lossless line at the grid points (Courant number 1), so the stated tolerance of 1 × 10⁻⁶ kV covers only rounding.`,
        }}
      />
      <Calc
        title="3 · One wave alone: v = Z_c·i"
        steps={[
          { label: 'At x = ℓ/4, t = T/2 only the first wave has passed: it left the source at T/4', expr: `v = k·e(T/4) = ${fx(an.k, 4)} × ${fx(an.k ? vs / an.k : 0, 3)}`, result: kv(vs, 3) },
          { label: 'i = v / Z_c', expr: `${fx(vs, 3)} kV / ${fx(an.zc, 2)} Ω`, result: amps(is) },
        ]}
        check={{
          ok: c.singleOk,
          text: `Independent check — the Bergeron grid solver at x = ℓ/4, t = T/2: v = ${kv(gS.v, 3)}, i = ${amps(gS.i)}${Math.abs(gS.i) > 1e-9 ? ` (v/i = ${fx((gS.v / gS.i) * 1000, 3)} Ω)` : ''} — a single travelling wave carries i = v/Z_c.`,
        }}
      />
      {c.steadyApplies && ss.kind === 'value' ? (
        <Calc
          title="4 · The steady state, in closed form"
          steps={[
            {
              label: ss.arresterHolds ? 'Final value (the DC value is clamped)' : 'Final value E·Z_L/(R_s + Z_L)',
              expr: ss.arresterHolds ? `|DC value| > V_res → V_res` : zl === Infinity ? `open end: E = ${fx(E, 1)} kV` : `${fx(E, 1)} × ${zlTxt} / (${fx(m.rs, 0)} + ${zlTxt})`,
              result: kv(ss.v, 3),
            },
            { label: 'Round-trip factor ρ = Γ_s·Γ_L', expr: `${fx(an.gammaS, 4)} × ${fx(an.gammaL, 4)}`, result: fx(an.rho, 5) },
            ...(m.arrester
              ? [{ label: `Grid, far end at t = ${fx(grid.t[lateK], 1)} µs`, expr: 'a late sample (the arrester is non-linear: no lattice formula); not the final value', result: kv(vEndLate, 3) }]
              : [
                  { label: 'Sum of the whole lattice at the end', expr: `(1 + Γ_L)·k·E / (1 − ρ)`, result: kv(series, 3) },
                  { label: 'After 4 arrivals (7T to 9T), the lattice', expr: `V_final·(1 − ρ⁴)`, result: kv(predicted, 3) },
                  { label: `Grid, far end at t = ${fx(grid.t[lateK], 1)} µs`, expr: 'independent', result: kv(vEndLate, 3) },
                ]),
          ]}
          check={
            m.arrester
              ? undefined
              : {
                  ok: c.steadyOk,
                  text: m.arrester
                    ? `With the arrester the far end reads ${kv(vEndLate, 3)} at ${fx(grid.t[lateK], 1)} µs${ss.arresterHolds ? '; the closed form says the clamp must hold V_res indefinitely' : ''}. The closed form is the final value; a late sample is not.`
                    : Math.abs(an.rho) < 1e-12
                      ? `The infinite lattice sum equals the closed form. With ρ = Γ_s·Γ_L = 0 no wave returns after the first arrival, so the grid’s far end already equals the final value (difference ${fx(vEndLate - ss.v, 3)} kV).`
                      : `The infinite lattice sum equals the closed form. After 8 travel times the far end is still ${fx(vEndLate - ss.v, 3)} kV from it — exactly −V_final·ρ⁴, the waves not yet died out. The final value comes from the closed form, never from the last sample.`,
                }
          }
        />
      ) : (
        <Callout title="4 · The steady state">
          <p className="small">
            {ss.kind === 'decays'
              ? 'The 1.2/50 impulse returns to zero, so every wave does: the line ends at 0 kV, not at a DC value.'
              : ss.kind === 'none'
                ? ss.reason
                : `The ramp settles at its crest; the closed-form steady state is ${kv(ss.v, 3)}.`}
          </p>
        </Callout>
      )}
      <Calc
        title={`5 · Separation distance: arrester ${SEP0.dM} m from the transformer`}
        steps={[
          { label: 'Rule V_res + 2Sd/v', expr: `${fx(sep.vres, 0)} + 2 × ${sep.s} × ${sep.dM} / ${fx(sep.v, 2)}`, result: kv(sf.value, 2) },
          { label: 'Characteristic recursion (sampled)', expr: `Δt = ${fx(sr.dt * 1000, 3)} ns`, result: kv(sr.vtMax, 2) },
          { label: 'Bergeron grid, 40 sections per d', expr: `Δt = ${fx(sg.dt * 1000, 3)} ns`, result: kv(sgMax, 2) },
        ]}
        check={{
          ok: c.sepOk,
          text: `The two simulations agree within ${fx(sgTol, 2)} kV (each reads a peak to within 2S·Δt). ${sf.valid ? `The rule is within ${fx(sr.peakTol, 2)} kV of the simulation: its assumptions hold here.` : `The rule does not apply here: ${sf.reasons.join('; ')}.`}`,
        }}
      />
      <Calc
        title="6 · The 1.2/50 µs impulse from its fitted constants"
        steps={[
          { label: 'α, β', expr: 'fitted', result: `${fx(LI_FIT.alpha, 6)}, ${fx(LI_FIT.beta, 5)} /µs` },
          { label: 'T1 = (t_90 − t_30)/0.6', expr: `(${fx(li.t90, 4)} − ${fx(li.t30, 4)}) / 0.6`, result: `${fx(li.front, 4)} µs` },
          { label: 'T2 = t_50 − O1', expr: `${fx(li.t50, 3)} − (${fx(li.origin, 4)})`, result: `${fx(li.tail, 3)} µs` },
        ]}
        check={{ ok: c.impulseOk, text: 'Computed back from α and β: 1.2 µs and 50 µs.' }}
      />
      <Quiz items={quiz} onComplete={() => completeActivity(MODULE, 'verify')} />
    </div>
  )
}

// ── Practise ───────────────────────────────────────────────────────────────────────────────────────────────────

export function Practise() {
  useTutorContext(() => 'Practise mode — travelling waves, reflections, the lattice diagram, surge shapes, arresters and insulation coordination.')
  const items = useMemo<QuizItem[]>(() => {
    const { lMhKm, cNfKm } = PRACTICE.line
    const zc3 = Math.sqrt((lMhKm * 1e-6) / (cNfKm * 1e-12))
    const v3 = 1 / Math.sqrt(lMhKm * 1e-6 * cNfKm * 1e-12) / 1e6
    const g5 = gammaOf(1600, 400)
    const t6 = 500 * tauOf(40, 400)
    const r7 = 500 * gammaOf(40, 400)
    // lattice: R_s = 100, Z_c = 400, open end, 1000 kV step
    const k8 = 400 / (100 + 400)
    const gs8 = gammaOf(100, 400)
    const v8 = 2 * k8 * 1000 * (1 + gs8)
    const sep = separationFormula(PRACTICE.sep)
    const m10 = margin(1050, 750) * 100
    return [
      {
        id: 'open-i',
        kind: 'choice',
        level: 'concept',
        q: 'A voltage wave reaches the open end of a line. What is the current at the open end?',
        options: [
          { id: 'a', label: 'Twice the incident current' },
          { id: 'b', label: 'Zero' },
          { id: 'c', label: 'The same as the incident current' },
        ],
        answer: 'b',
        why: 'Nothing is connected, so no current can flow out: the reflected current wave cancels the incident one — and its voltage adds, doubling the voltage.',
        mistake: 'Voltage doubles at an open end; current doubles at a short circuit.',
      },
      {
        id: 'matched',
        kind: 'choice',
        level: 'concept',
        q: 'A line ends in a resistor equal to its surge impedance. What is reflected?',
        options: [
          { id: 'a', label: 'Nothing' },
          { id: 'b', label: 'Half the wave' },
          { id: 'c', label: 'The whole wave, inverted' },
        ],
        answer: 'a',
        why: 'Γ = (Z_c − Z_c)/(Z_c + Z_c) = 0: the resistor demands exactly the v/i the wave already has, and absorbs all its energy.',
      },
      {
        id: 'zc',
        kind: 'number',
        level: 'numerical',
        q: `A lossless line has L = ${lMhKm} mH/km and C = ${cNfKm} nF/km. What is its surge impedance?`,
        answer: zc3,
        unit: 'Ω',
        tol: 1,
        why: `Z_c = √(L/C) = √(${lMhKm}×10⁻⁶ / ${cNfKm}×10⁻¹²) = ${fx(zc3, 1)} Ω.`,
        mistake: 'Convert per km to per metre consistently (mH/km = µH/m, nF/km = pF/m); the ratio is the same either way.',
      },
      {
        id: 'v',
        kind: 'number',
        level: 'numerical',
        q: 'For the same line, how fast does a surge travel?',
        answer: v3,
        unit: 'm/µs',
        tol: 1,
        why: `v = 1/√(LC) = 1/√(${lMhKm}×10⁻⁶ × ${cNfKm}×10⁻¹²) = ${fx(v3 * 1e6, 0)} m/s = ${fx(v3, 1)} m/µs — just below the speed of light, as for any overhead line.`,
        mistake: 'Use L and C per metre (H/m and F/m) here — per km values give a speed in km/s, off by a factor of 1000 if mixed.',
      },
      {
        id: 'gamma',
        kind: 'number',
        level: 'numerical',
        q: 'A 400 Ω line ends in a 1600 Ω resistor. What is the voltage reflection coefficient?',
        answer: g5,
        unit: '',
        tol: 0.005,
        why: `Γ = (1600 − 400)/(1600 + 400) = ${fx(g5, 3)}.`,
        mistake: 'Γ is (Z_L − Z_c)/(Z_L + Z_c): load minus line on top.',
      },
      {
        id: 'cable-tr',
        kind: 'number',
        level: 'university',
        q: 'A 500 kV surge on an overhead line (Z_c = 400 Ω) reaches a junction with a long cable (Z_c = 40 Ω). What voltage enters the cable?',
        answer: t6,
        unit: 'kV',
        tol: 0.5,
        why: `τ = 2 × 40/(400 + 40) = ${fx(tauOf(40, 400), 4)}, so ${fx(t6, 1)} kV enters the cable.`,
        mistake: 'The transmitted voltage is τ = 2Z₂/(Z₁ + Z₂) times the incident wave, with Z₂ the impedance the wave moves INTO.',
      },
      {
        id: 'cable-ref',
        kind: 'number',
        level: 'university',
        q: 'At the same junction, what is the reflected voltage wave (with its sign)?',
        answer: r7,
        unit: 'kV',
        tol: 0.5,
        why: `Γ = (40 − 400)/(40 + 400) = ${fx(gammaOf(40, 400), 4)}: reflected ${fx(r7, 1)} kV. Check: incident + reflected = ${fx(500 + r7, 1)} kV = transmitted.`,
        mistake: 'Into a lower impedance the reflection is negative: the voltage on the line falls.',
      },
      {
        id: 'lattice',
        kind: 'number',
        level: 'university',
        q: 'A 1000 kV step is applied through R_s = 100 Ω to a 400 Ω lossless line with an open far end. Using the lattice diagram, what is the far-end voltage between 3T and 5T?',
        answer: v8,
        unit: 'kV',
        tol: 1,
        why: `k = 400/500 = ${fx(k8, 2)}; the first arrival gives 2 × ${fx(k8 * 1000, 0)} = ${fx(2 * k8 * 1000, 0)} kV. The reflection returns to the source (Γ_s = ${fx(gs8, 2)}) and comes back as ${fx(k8 * 1000 * gs8, 0)} kV, doubling again at the end: ${fx(2 * k8 * 1000, 0)} + ${fx(2 * k8 * 1000 * gs8, 0)} = ${fx(v8, 0)} kV. It settles at 1000 kV.`,
        mistake: 'Each wave doubles at the open end; the source end multiplies it by Γ_s first.',
      },
      {
        id: 'sep',
        kind: 'number',
        level: 'university',
        q: `An arrester (residual voltage ${PRACTICE.sep.vres} kV) is ${PRACTICE.sep.dM} m from a transformer. A surge with a front of ${PRACTICE.sep.s} kV/µs travels at ${PRACTICE.sep.v} m/µs. Estimate the peak voltage at the transformer.`,
        answer: sep.value,
        unit: 'kV',
        tol: 1,
        why: `V_t ≈ V_res + 2Sd/v = ${PRACTICE.sep.vres} + 2 × ${PRACTICE.sep.s} × ${PRACTICE.sep.dM}/${PRACTICE.sep.v} = ${fx(sep.value, 0)} kV.`,
        mistake: 'The factor 2: the wave travels to the transformer and its reflection travels back before the arrester can relieve it.',
      },
      {
        id: 'margin',
        kind: 'number',
        level: 'university',
        q: 'Equipment with a BIL of 1050 kV sees at most 750 kV. What is its protective margin, (BIL − V)/V?',
        answer: m10,
        unit: '%',
        tol: 0.5,
        why: `(1050 − 750)/750 = ${fx(m10, 1)} %.`,
        mistake: 'The margin is relative to the protective level (the voltage that reaches the equipment), not to the BIL.',
      },
      {
        id: 'switch',
        kind: 'choice',
        level: 'university',
        q: 'An open-ended lossless line is energised from a source of negligible impedance at the instant of peak voltage. The highest voltage at the open end is about…',
        options: [
          { id: 'a', label: '1 pu' },
          { id: 'b', label: '√2 pu' },
          { id: 'c', label: '2 pu' },
          { id: 'd', label: '3 pu' },
        ],
        answer: 'c',
        why: 'With negligible source impedance the launched wave is the full 1 pu, and it doubles at the open end (Γ = +1). Real energisation differs from this lossless single-mode value: losses, corona, closing resistors and controlled switching lower it, while trapped charge on reclosing, source inductance and unequal pole closing can raise it — even above 2 pu.',
      },
      {
        id: 'li',
        kind: 'choice',
        level: 'concept',
        q: 'What does “1.2/50 µs” describe?',
        options: [
          { id: 'a', label: 'The front time (from the 30 % and 90 % points, ×1.67) and the time to half value on the tail' },
          { id: 'b', label: 'The time to the peak and the total duration' },
          { id: 'c', label: 'The rise time from 10 % to 90 % and the time to zero' },
        ],
        answer: 'a',
        why: `By the conventional definition: T1 = 1.67 × (t_90 − t_30) and T2 from the virtual origin to the half value. The fitted shape here reaches its peak at ${fx(LI_FIT.times.tPeak, 2)} µs — not at 1.2 µs.`,
      },
    ]
  }, [])
  return (
    <div className="ps-stack">
      <Callout title="Practice">
        <p className="small">
          From concepts to exam-style numericals. Questions are written for this lab in the style of university examinations — they are not past papers. (These topics are not named in the GATE EE
          syllabus.)
        </p>
      </Callout>
      <Quiz items={items} onComplete={() => completeActivity(MODULE, 'practice')} />
    </div>
  )
}
