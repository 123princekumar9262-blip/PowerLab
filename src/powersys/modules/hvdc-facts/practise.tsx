import { useMemo } from 'react'
import { completeActivity } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Quiz, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import { K_VD0, noseClosedForm, pMaxMidShunt, pMaxSeries, qAtLimit, rectifierBridge, tcrB } from './calc.ts'
import { MODULE } from './shared.tsx'

/** Practice questions, concept → numerical → university-style → GATE-style; every answer comes from the model. */
export function Practise() {
  const items = useMemo<QuizItem[]>(() => {
    const b = rectifierBridge(220, 20, 10, 1.5)
    if (!b.ok) throw new Error('practice bridge invalid')
    const q25 = 200 * Math.tan((25 * Math.PI) / 180)
    const svc = qAtLimit('svc', 1, 0.8)
    const stat = qAtLimit('statcom', 1, 0.8)
    const nose = noseClosedForm(0.25, 0, 0)!
    return [
      {
        id: 'q-why',
        kind: 'choice',
        level: 'concept',
        q: 'Why does a line-commutated (thyristor) converter draw reactive power from the AC system, even when it is a rectifier?',
        options: [
          { id: 'a', label: 'Because the DC line has capacitance' },
          { id: 'b', label: 'Because firing at α (and the overlap μ) delays the AC current behind the voltage' },
          { id: 'c', label: 'Because the thyristors have a forward voltage drop' },
        ],
        answer: 'b',
        why: 'cos φ ≈ ½[cos α + cos(α + μ)]: any delay makes the current lag. A rectifier and an inverter both absorb Q.',
        mistake: 'In steady state a DC line carries no charging current; the converter itself absorbs the reactive power.',
      },
      {
        id: 'control',
        kind: 'choice',
        level: 'concept',
        q: 'In normal operation of an LCC link, which station controls the DC current?',
        options: [
          { id: 'r', label: 'The rectifier (constant current); the inverter holds its extinction angle (CEA)' },
          { id: 'i', label: 'The inverter (constant current); the rectifier holds α at α_min' },
          { id: 'both', label: 'Both, equally' },
        ],
        answer: 'r',
        why: 'The inverter’s current order is lower by the current margin ΔI, so it takes over only if the rectifier is pushed to α_min (mode shift).',
      },
      {
        id: 'statcom',
        kind: 'choice',
        level: 'concept',
        q: `An SVC and a STATCOM are both rated 1 pu at 1 pu voltage. At 0.8 pu voltage, at their limits, which supplies more reactive power?`,
        options: [
          { id: 'svc', label: 'The SVC' },
          { id: 'statcom', label: 'The STATCOM' },
          { id: 'same', label: 'They supply the same' },
        ],
        answer: stat > svc ? 'statcom' : svc > stat ? 'svc' : 'same',
        why: `SVC: Q = B·V² = ${fx(svc, 2)} pu. STATCOM: Q = I·V = ${fx(stat, 2)} pu.`,
        mistake: 'At its limit an SVC is just a capacitor, so its output falls with V².',
      },
      {
        id: 'vd0',
        kind: 'number',
        level: 'numerical',
        q: 'A 6-pulse bridge is fed with 100 kV (rms, line to line). What is its ideal no-load DC voltage V_d0?',
        answer: K_VD0 * 100,
        unit: 'kV',
        tol: 0.1,
        why: `V_d0 = (3√2/π) × 100 = ${fx(K_VD0 * 100, 2)} kV.`,
        mistake: 'Use the rms line-to-line voltage: V_d0 = 1.35·V_LL (equivalently 2.34 × the rms phase voltage).',
      },
      {
        id: 'q-approx',
        kind: 'number',
        level: 'numerical',
        q: 'A 6-pulse rectifier delivers 200 MW at α = 25° with negligible overlap. Estimate the reactive power it draws.',
        answer: q25,
        unit: 'Mvar',
        tol: 1,
        why: `With μ ≈ 0, cos φ ≈ cos α, so Q = P·tan α = 200 × tan 25° = ${fx(q25, 1)} Mvar.`,
      },
      {
        id: 'tcr',
        kind: 'number',
        level: 'numerical',
        q: 'A TCR is fired at α = 120° (measured from the voltage zero crossing). What fraction of its full-conduction susceptance does it present?',
        answer: tcrB(120)!,
        unit: '',
        tol: 0.005,
        why: `B/B_max = (2π − 2α + sin 2α)/π = (2π − 4π/3 + sin 240°)/π = ${fx(tcrB(120)!, 4)}.`,
        mistake: 'α is in radians inside the formula; sin 240° is negative.',
      },
      {
        id: 'vd',
        kind: 'number',
        level: 'university',
        q: 'A 6-pulse rectifier: V_LL = 220 kV, α = 20°, X_c = 10 Ω per phase, I_d = 1.5 kA. Find the DC voltage V_d.',
        answer: b.vd,
        unit: 'kV',
        tol: 0.3,
        why: `V_d = 1.3505 × 220 × cos 20° − (3/π) × 10 × 1.5 = ${fx(b.vd0 * Math.cos((20 * Math.PI) / 180), 2)} − ${fx(b.drop, 2)} = ${fx(b.vd, 2)} kV.`,
        mistake: 'Subtract the commutation drop (3/π)·X_c·I_d — with X_c per phase in Ω and I_d in kA it comes out in kV.',
      },
      {
        id: 'mu',
        kind: 'number',
        level: 'university',
        q: 'For the same bridge, find the overlap angle μ.',
        answer: b.muDeg,
        unit: '°',
        tol: 0.1,
        why: `cos(α + μ) = cos 20° − √2 × 10 × 1.5 / 220 = ${fx(Math.cos((20 * Math.PI) / 180) - b.k, 4)}, so α + μ = ${fx(20 + b.muDeg, 2)}° and μ = ${fx(b.muDeg, 2)}°.`,
        mistake: 'Subtract α at the end: arccos gives α + μ.',
      },
      {
        id: 'link',
        kind: 'number',
        level: 'university',
        q: 'A DC link has V_dr = 500 kV at the rectifier and V_di = 490 kV at the inverter, with R_dc = 5 Ω. How much power is lost in the line?',
        answer: ((500 - 490) / 5) ** 2 * 5,
        unit: 'MW',
        tol: 0.1,
        why: `I_d = (500 − 490)/5 = ${fx((500 - 490) / 5, 2)} kA; loss = I_d²·R_dc = ${fx(((500 - 490) / 5) ** 2 * 5, 1)} MW (also = P_dr − P_di = 1000 − 980 MW).`,
      },
      {
        id: 'nose',
        kind: 'number',
        level: 'university',
        q: 'A unity-power-factor load is fed from a 1.0 pu source through X = 0.25 pu (lossless). What is the largest load the bus can take before its voltage collapses?',
        answer: nose.p,
        unit: 'pu',
        tol: 0.01,
        why: `At unity power factor the nose is P_max = E²/(2X) = 1/(2 × 0.25) = ${fx(nose.p, 3)} pu, at V = E/√2 = ${fx(nose.v, 3)} pu.`,
        mistake: 'E²/X is the angle limit with both voltages held at 1 pu; with an unsupported load bus the voltage sags and the limit is E²/(2X).',
      },
      {
        id: 'series',
        kind: 'number',
        level: 'gate',
        q: 'A lossless line is 40 % series compensated. By what factor does its steady-state power limit increase?',
        answer: pMaxSeries(1, 1, 1, 0.4) / pMaxSeries(1, 1, 1, 0),
        unit: '',
        tol: 0.005,
        why: `P_max ∝ 1/X_eff = 1/(X(1 − 0.4)): the factor is 1/0.6 = ${fx(1 / 0.6, 3)}.`,
        mistake: 'It is 1/(1 − k), not 1 + k.',
      },
      {
        id: 'shunt',
        kind: 'number',
        level: 'gate',
        q: 'A lossless line has X = 0.6 pu and 1.0 pu at both ends. An ideal shunt compensator holds its midpoint at 1.0 pu. What is the maximum power it can now carry?',
        answer: pMaxMidShunt(1, 0.6),
        unit: 'pu',
        tol: 0.01,
        why: `P = (2V²/X)·sin(δ/2), maximum 2 × 1 / 0.6 = ${fx(pMaxMidShunt(1, 0.6), 3)} pu at δ = 180° — twice the uncompensated ${fx(pMaxSeries(1, 1, 0.6, 0), 3)} pu.`,
        mistake: 'Each half has X/2 and carries δ/2; the maximum is at δ = 180°, not 90°.',
      },
    ]
  }, [])
  useTutorContext(
    () =>
      'Practise mode: questions on LCC converters (V_d, overlap, reactive power), DC-link control, VSC, series and shunt compensation, SVC/TCR, STATCOM and voltage collapse. Answers come from the module’s calculations.',
  )
  return (
    <div className="ps-card ps-practise">
      <h3>Practice questions</h3>
      <p className="small muted">
        From concept to GATE-style. Every number comes from this module’s calculations; the questions are written for this app, not taken from past papers. Answer all of them correctly to complete the
        activity.
      </p>
      <Quiz items={items} onComplete={() => completeActivity(MODULE, 'practice')} />
    </div>
  )
}
