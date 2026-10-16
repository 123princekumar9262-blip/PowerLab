import { useMemo } from 'react'
import { completeActivity } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Quiz, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import { computeSpan, criticalDisruptive, G0_RMS, gradedCaps, iceWeight, ladderVoltages, loads, parabola, parabolaLimit, efficiency, PARABOLA_OK } from './calc.ts'
import { DESIGN0, toSpanInput } from './model.ts'
import { MODULE } from './shared.tsx'

/** Practice questions — concept → numerical → university-style → GATE-style. Every answer is computed. */
export function Practise() {
  const items = useMemo<QuizItem[]>(() => {
    // wind alone: does the vertical sag change? (parabola)
    const base = toSpanInput(DESIGN0.span)
    const bare = computeSpan(base)
    const windy = computeSpan({ ...base, windP: 500 })
    if (!bare.ok || !windy.ok) throw new Error('practice span invalid')
    const vBare = bare.par.Slevel
    const vWind = windy.par.Slevel * Math.cos(windy.loads.theta)
    // corona: which change raises V_c (each computed against the same base)
    const vc0 = criticalDisruptive(0.85, 1, 1.05, 200)
    const vcOpts = {
      thin: criticalDisruptive(0.85, 1, 0.7, 200),
      high: criticalDisruptive(0.85, 0.8, 1.05, 200),
      thick: criticalDisruptive(0.85, 1, 1.5, 200),
      rain: criticalDisruptive(0.7, 1, 1.05, 200),
    }
    const raises = Object.entries(vcOpts)
      .filter(([, v]) => v > vc0)
      .map(([k]) => k)
    // numericals
    const s1 = (6 * 250 ** 2) / (8 * 15e3)
    const wi = iceWeight(0.02, 0.01)
    const ld = loads(9, 0.0195, 0.012, 390)
    const sIncl = (ld.wr * 200 ** 2) / (8 * 30e3)
    const sVert = sIncl * Math.cos(ld.theta)
    const p = parabola(10e3, 10, 300, 20)
    const clear = 40 - p.SA
    const v3 = ladderVoltages(3, 0.125, 33 / Math.sqrt(3))
    const eff3 = efficiency(v3, 33 / Math.sqrt(3))
    const c3 = gradedCaps(3, 0.2)[2]
    const delta = (3.92 * 74) / (273 + 30)
    const vc = 0.9 * G0_RMS * delta * 1 * Math.log(250 / 1)
    const deltaG = (3.92 * 72) / (273 + 35)
    const v2 = ladderVoltages(2, 0.1, 1)
    const eff2 = efficiency(v2, 1)
    return [
      {
        id: 'disc',
        kind: 'choice',
        level: 'concept',
        q: 'In a string of identical discs, why does the disc nearest the line carry the largest voltage?',
        options: [
          { id: 'a', label: 'It is the most polluted disc' },
          { id: 'b', label: 'The charging currents of every link’s shunt capacitance to the tower all flow through it' },
          { id: 'c', label: 'It is closest to the earthed tower' },
        ],
        answer: 'b',
        why: 'Disc k carries the current of disc k − 1 plus the current of the shunt between them; the line-end disc carries them all, and with equal capacitances voltage ∝ current.',
        mistake: 'The disc nearest the TOWER (cross-arm end) carries the least, not the most.',
      },
      {
        id: 'wind',
        kind: 'choice',
        level: 'concept',
        q: 'By the parabolic formula, what does a wind across the line (no ice, the same T₀) do to the VERTICAL sag?',
        options: [
          { id: 'up', label: 'It increases it' },
          { id: 'same', label: 'Nothing: S·cos θ = (w_r L²/8T₀)(w/w_r) = wL²/8T₀' },
          { id: 'down', label: 'It reduces it' },
        ],
        answer: Math.abs(vWind - vBare) < 1e-9 * vBare ? 'same' : vWind > vBare ? 'up' : 'down',
        why: `For a 300 m span at 500 N/m² of wind: S·cos θ = ${fx(vWind, 4)} m, bare wL²/8T₀ = ${fx(vBare, 4)} m. The wind swings the conductor sideways instead.`,
      },
      {
        id: 'corona-up',
        kind: 'choice',
        level: 'concept',
        q: 'Which change RAISES the critical disruptive voltage of a line?',
        options: [
          { id: 'thin', label: 'A thinner conductor' },
          { id: 'high', label: 'Building the line at high altitude' },
          { id: 'thick', label: 'A conductor of larger radius' },
          { id: 'rain', label: 'Rain on the conductor (a lower m₀)' },
        ],
        answer: raises[0],
        why: `V_c ∝ m₀·δ·r·ln(D/r): from ${fx(vc0, 1)} kV, a 1.5 cm radius gives ${fx(vcOpts.thick, 1)} kV; 0.7 cm gives ${fx(vcOpts.thin, 1)}, δ = 0.8 gives ${fx(vcOpts.high, 1)}, m₀ = 0.7 gives ${fx(vcOpts.rain, 1)} kV.`,
      },
      {
        id: 'parabola',
        kind: 'choice',
        level: 'concept',
        q: 'When is the parabolic formula S = wL²/(8T) NOT accurate enough?',
        options: [
          { id: 'a', label: 'Whenever the supports are level' },
          { id: 'b', label: 'When the sag is a large fraction of the span (very slack spans, river crossings)' },
          { id: 'c', label: 'When the tension is high' },
        ],
        answer: 'b',
        why: `Its error is about (4/3)(S/L)²: it reaches ${PARABOLA_OK * 100} % only when S/L is ${fx(parabolaLimit(PARABOLA_OK) * 100, 1)} %.`,
      },
      {
        id: 'sag',
        kind: 'number',
        level: 'numerical',
        q: 'A level span of 250 m; the conductor weighs 6 N/m and the tension is 15 kN. What is the sag (parabola)?',
        answer: s1,
        unit: 'm',
        tol: 0.01,
        why: `S = wL²/(8T) = 6 × 250² / (8 × 15 000) = ${fx(s1, 3)} m.`,
        mistake: 'Use the tension in newtons: 15 kN = 15 000 N.',
      },
      {
        id: 'ice',
        kind: 'number',
        level: 'numerical',
        q: 'A 20 mm conductor carries a 10 mm radial coat of ice (ρ = 915 kg/m³, g = 9.81 m/s²). What does the ice weigh per metre?',
        answer: wi,
        unit: 'N/m',
        tol: 0.03,
        why: `w_i = ρ·g·π·t(d + t) = 915 × 9.81 × π × 0.01 × 0.03 = ${fx(wi, 3)} N/m.`,
        mistake: 'The ice is a ring: area = π/4·((d + 2t)² − d²) = π·t(d + t), not π·t².',
      },
      {
        id: 'loaded',
        kind: 'number',
        level: 'university',
        q: 'A 200 m level span: conductor 9 N/m, diameter 19.5 mm, 12 mm of radial ice (ρ = 915 kg/m³), wind 390 N/m² on the iced conductor, working tension 30 kN. Using the parabola, what is the VERTICAL sag?',
        answer: sVert,
        unit: 'm',
        tol: 0.01,
        why: `w_i = ${fx(ld.wi, 3)} N/m, w_w = 390 × 0.0435 = ${fx(ld.ww, 3)} N/m, w_r = ${fx(ld.wr, 3)} N/m; S = w_r L²/(8T) = ${fx(sIncl, 3)} m in the inclined plane; cos θ = (w + w_i)/w_r = ${fx(Math.cos(ld.theta), 4)}, so the vertical sag is ${fx(sVert, 3)} m.`,
        mistake: 'Wind acts on the iced diameter d + 2t; the vertical sag is S·cos θ, not S.',
      },
      {
        id: 'river',
        kind: 'number',
        level: 'university',
        q: 'A river crossing: supports 40 m and 60 m above the water, 300 m apart horizontally; conductor 10 N/m, tension 10 kN. Using the parabola, how high above the water is the lowest point of the conductor?',
        answer: clear,
        unit: 'm',
        tol: 0.02,
        why: `x₁ = 150 − 10 000 × 20 / (10 × 300) = ${fx(p.x1, 2)} m; S₁ = 10 × ${fx(p.x1, 2)}² / (2 × 10 000) = ${fx(p.SA, 3)} m; 40 − ${fx(p.SA, 3)} = ${fx(clear, 3)} m.`,
        mistake: 'Measure x₁ from the LOWER support, and subtract S₁ from the lower support’s height.',
      },
      {
        id: 'disc3',
        kind: 'number',
        level: 'university',
        q: 'A 33 kV three-phase line hangs on strings of 3 identical discs; the shunt capacitance of each link is 1/8 of a disc’s capacitance. What voltage does the line-end disc carry?',
        answer: v3[2],
        unit: 'kV',
        tol: 0.03,
        why: `V = 33/√3 = ${fx(33 / Math.sqrt(3), 3)} kV. V₂ = 1.125 V₁, V₃ = V₂ + 0.125(V₁ + V₂) = ${fx(v3[2] / v3[0], 4)} V₁; V₁ = ${fx(v3[0], 3)} kV, so V₃ = ${fx(v3[2], 3)} kV.`,
        mistake: 'Use the phase voltage (line voltage ÷ √3), not 33 kV.',
      },
      {
        id: 'eff3',
        kind: 'number',
        level: 'university',
        q: 'What is the string efficiency of that string?',
        answer: eff3 * 100,
        unit: '%',
        tol: 0.1,
        why: `η = V/(3·V₃) = ${fx(33 / Math.sqrt(3), 3)} / (3 × ${fx(v3[2], 3)}) = ${fx(eff3 * 100, 2)} %.`,
      },
      {
        id: 'vc',
        kind: 'number',
        level: 'university',
        q: 'A three-phase line has conductors of 1 cm radius, 2.5 m apart (equilateral). With m₀ = 0.9, 74 cmHg and 30 °C (δ = 3.92b/(273 + t)), g₀ = 30/√2 kV/cm rms, what is the critical disruptive voltage per phase?',
        answer: vc,
        unit: 'kV',
        tol: vc * 0.008,
        why: `δ = 3.92 × 74/303 = ${fx(delta, 4)}; V_c = 0.9 × ${fx(G0_RMS, 3)} × ${fx(delta, 4)} × 1 × ln(250/1) = ${fx(vc, 1)} kV per phase (${fx(vc * Math.sqrt(3), 0)} kV line to line). With g₀ = 21.1 the answer is 0.5 % lower — also accepted.`,
        mistake: 'r and D in the same unit (cm), ln not log₁₀, and the result is per phase.',
      },
      {
        id: 'double',
        kind: 'number',
        level: 'gate',
        q: 'At the same tension, the span of a line is doubled. By the parabolic formula, the sag becomes how many times larger?',
        answer: 2 ** 2,
        unit: '×',
        tol: 0.05,
        why: 'S ∝ L²: (2)² = 4.',
        mistake: 'Sag grows with the square of the span, not in proportion.',
      },
      {
        id: 'grading',
        kind: 'number',
        level: 'gate',
        q: 'A 3-disc string is to be capacitance-graded so that all discs share the voltage equally. With m = 0.2, the line-end disc needs what capacitance relative to the top disc (C₃/C₁)?',
        answer: c3,
        unit: '×',
        tol: 0.005,
        why: `C₂ = C₁(1 + m), C₃ = C₂ + 2m·C₁ = C₁(1 + 3m) = ${fx(c3, 2)} C₁.`,
        mistake: 'Each disc must also carry the shunt currents of ALL the links above it.',
      },
      {
        id: 'delta',
        kind: 'number',
        level: 'gate',
        q: 'What is the air density factor δ = 3.92b/(273 + t) at 72 cmHg and 35 °C?',
        answer: deltaG,
        unit: '',
        tol: 0.002,
        why: `δ = 3.92 × 72 / 308 = ${fx(deltaG, 4)}.`,
      },
      {
        id: 'eff2',
        kind: 'number',
        level: 'gate',
        q: 'A 2-disc string has m = 0.1. What is its string efficiency?',
        answer: eff2 * 100,
        unit: '%',
        tol: 0.1,
        why: `V₂ = 1.1 V₁, V = 2.1 V₁: η = 2.1/(2 × 1.1) = ${fx(eff2 * 100, 2)} %.`,
      },
    ]
  }, [])
  useTutorContext(
    () =>
      'Practise mode: questions on sag and tension (parabola, catenary, unequal supports, wind and ice), insulator strings (voltage distribution, efficiency, grading) and corona (Peek). Answers come from the module’s calculations.',
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
