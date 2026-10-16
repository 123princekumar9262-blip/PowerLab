import { useMemo } from 'react'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import { fx } from '../../ui/format.ts'
import { Calc, Callout, Quiz, useTutorContext, type QuizItem } from '../../ui/kit.tsx'
import {
  acFundamental,
  commutationNumeric,
  K_RC,
  K_VD0,
  linkCheckNumeric,
  numericPmax,
  pMaxMidShunt,
  pMaxSeries,
  pMidShunt,
  pSeries,
  rectifierBridge,
  solveBus,
  tanPhi,
  tcrAlphaFor,
  tcrB,
  tcrBNumeric,
  TCR_RATIO,
  vClosedForm,
  V_REF,
  xTh,
  type BusPoint,
  type LccResult,
} from './calc.ts'
import { compute, lccLinkOf, MODULE, STATE0, type HfState } from './shared.tsx'

const D2R = Math.PI / 180

/** Tolerances between the two methods, and why. */
const TOL = {
  /** RK4 + Simpson with 3000 steps over 60°: the integration error is below 1e-8 of the values; 1e-6 leaves margin. */
  num: 1e-6,
}

export function Verify({ st }: { st: HfState }) {
  const progress = usePsProgress()
  const c = useMemo(() => compute(st), [st])
  const c0 = useMemo(() => compute(STATE0), [])
  // 1–3 · the LCC link of Explore, or the default when it has no operating point
  const ownLcc = c.lcc.ok
  const link = ownLcc ? c.link : lccLinkOf(STATE0.lcc)
  const L = (ownLcc ? c.lcc : c0.lcc) as LccResult
  const lk = linkCheckNumeric(link, L)
  const rb = L.rect
  const num = commutationNumeric(link.vllR, L.alphaDeg, link.xc, L.id)
  const fund = acFundamental(link.vllR, L.alphaDeg, link.xc, L.id)
  const k = (Math.SQRT2 * link.xc * L.id) / link.vllR
  const muHand = (Math.acos(Math.cos(L.alphaDeg * D2R) - k) - L.alphaDeg * D2R) / D2R
  const vdHand = K_VD0 * link.vllR * Math.cos(L.alphaDeg * D2R) - K_RC * link.xc * L.id
  const cosHand = (Math.cos(L.alphaDeg * D2R) + Math.cos((L.alphaDeg + muHand) * D2R)) / 2
  const pHand = vdHand * L.id
  const qHand = pHand * Math.tan(Math.acos(cosHand))
  // 4 · VSC
  const ownVsc = c.vsc.ok
  const V = ownVsc ? c.vsc : c0.vsc
  const vl = ownVsc ? st.vsc : STATE0.vsc
  // 5 · compensation (always valid)
  const cp = st.comp
  const ns = numericPmax((d) => pSeries(cp.v, cp.v, cp.x, cp.k, d))
  const nm = numericPmax((d) => pMidShunt(cp.v, cp.x, d))
  // 6 · weak bus
  const ownBus = c.bus.ok
  const wb = ownBus ? st.weak : STATE0.weak
  const bus = (ownBus ? c.bus : solveBus(STATE0.weak, STATE0.weak.support)) as BusPoint
  const x = xTh(wb.scr)
  const t = tanPhi(wb.pf)
  const qNet = wb.p * t - (bus.state === 'regulating' ? bus.qc : 0)
  const bFix = bus.state === 'at-limit' && wb.support === 'svc' ? wb.rating : 0
  const cf = wb.support === 'statcom' && bus.state === 'at-limit' ? null : vClosedForm(wb.p, x, qNet, bFix)
  // 7 · TCR at the SVC's angle (or 135°)
  const svcAlpha = wb.support === 'svc' ? tcrAlphaFor(Math.max(0, Math.min(1, (wb.rating - bus.qc / (bus.v * bus.v)) / (TCR_RATIO * wb.rating)))) : null
  const aT = svcAlpha !== null && svcAlpha < 179.9 ? svcAlpha : 135
  const bT = tcrB(aT)!
  const bTn = tcrBNumeric(aT)!
  // your turn: a fresh bridge
  const yt = rectifierBridge(220, 20, 10, 1.5)
  const quiz: QuizItem[] = yt.ok
    ? [
        {
          id: 'vd-turn',
          kind: 'number',
          level: 'numerical',
          q: 'Your turn: a 6-pulse rectifier has V_LL = 220 kV (valve side), α = 20°, X_c = 10 Ω per phase and I_d = 1.5 kA. What is its DC voltage V_d?',
          answer: yt.vd,
          unit: 'kV',
          tol: 0.3,
          why: `V_d = 1.3505 × 220 × cos 20° − (3/π) × 10 × 1.5 = ${fx(yt.vd0 * Math.cos(20 * D2R), 2)} − ${fx(yt.drop, 2)} = ${fx(yt.vd, 2)} kV.`,
          mistake: 'Use V_d0 = 1.3505·V_LL with the line-to-line rms voltage, and subtract (3/π)·X_c·I_d (kV, since Ω × kA = kV).',
        },
      ]
    : []
  useTutorContext(
    () =>
      `Verify mode: hand calculations of the LCC bridge (V_d, μ), the CC/CEA operating point, the converter's Q, a VSC station, compensation P_max, the weak-bus voltage and the TCR susceptance, each checked by a second method. Link: I_d ${fx(L.id, 3)} kA, α ${fx(L.alphaDeg, 2)}°, μ ${fx(L.muRDeg, 2)}°.`,
  )
  const note = (own: boolean, what: string) => (own ? `${what} as set in Explore` : `default ${what} (yours in Explore has no solution)`)
  return (
    <div className="ps-stack">
      <Callout title="Check the model’s numbers by hand">
        <p>
          Each block repeats a result with the textbook formula and compares it with an independent second method (a numerical integration, a phasor calculation, a numerical maximum or a second
          solver). The tolerance and its reason are stated with each check. {isDone(progress, MODULE, 'verify') && '✓ Done.'}
        </p>
      </Callout>
      <Calc
        title={`1 · One rectifier bridge: V_d and the overlap μ — ${note(ownLcc, 'link')}`}
        steps={[
          { label: 'V_d0 = (3√2/π)·V_LL', expr: `1.3505 × ${fx(link.vllR, 2)}`, result: `${fx(rb.vd0, 3)} kV` },
          { label: '√2·X_c·I_d / V_LL', expr: `1.4142 × ${fx(link.xc, 1)} × ${fx(L.id, 4)} / ${fx(link.vllR, 2)}`, result: fx(k, 5) },
          { label: 'μ = arccos(cos α − …) − α', expr: `arccos(cos ${fx(L.alphaDeg, 3)}° − ${fx(k, 5)}) − ${fx(L.alphaDeg, 3)}°`, result: `${fx(muHand, 4)}°` },
          { label: 'V_d = V_d0 cos α − (3/π)X_c·I_d', expr: `${fx(rb.vd0, 3)} × ${fx(Math.cos(L.alphaDeg * D2R), 5)} − ${fx(K_RC * link.xc * L.id, 3)}`, result: `${fx(vdHand, 3)} kV per bridge` },
        ]}
        check={
          num.ok
            ? {
                ok: Math.abs(num.muDeg - muHand) < 1e-4 && Math.abs(num.vd - vdHand) < TOL.num * rb.vd0 * 10,
                text: `Second method — integrate the commutation 2L_c·di/dt = √2·V_LL·sin(ωt) numerically (RK4, 3000 steps) until i = I_d, then average the DC voltage over a pulse (Simpson): μ = ${fx(num.muDeg, 5)}°, V_d = ${fx(num.vd, 4)} kV. Agreement within 10⁻⁴° and 10⁻⁵ of V_d0 (the integration error is far smaller).`,
              }
            : undefined
        }
      />
      <Calc
        title={`2 · The operating point (${L.mode === 'normal' ? 'CC at the rectifier, CEA at the inverter' : L.mode === 'shift' ? 'mode shift' : L.mode === 'manual' ? 'α set by hand' : 'both at their limits'})`}
        steps={[
          {
            label: 'I_d',
            expr: L.mode === 'normal' ? 'the rectifier’s current order' : L.mode === 'shift' ? 'I_order − ΔI (inverter control)' : '(V_d0r cos α − V_d0i cos γ)/(R_dc + R_cr − R_ci)',
            result: `${fx(L.id, 4)} kA`,
          },
          {
            label: 'V_di = V_d0i cos γ − R_ci·I_d',
            expr: `${fx(L.vd0i, 2)} × cos ${fx(L.gammaDeg, 3)}° − ${fx(L.rci, 3)} × ${fx(L.id, 4)}`,
            result: `${fx(L.vd0i * Math.cos(L.gammaDeg * D2R) - L.rci * L.id, 3)} kV`,
          },
          { label: 'V_dr = V_di + R_dc·I_d', expr: `… + ${fx(link.rdc, 1)} × ${fx(L.id, 4)}`, result: `${fx(L.vd0i * Math.cos(L.gammaDeg * D2R) - L.rci * L.id + link.rdc * L.id, 3)} kV` },
          { label: 'Line loss I_d²·R_dc', expr: `${fx(L.id, 4)}² × ${fx(link.rdc, 1)}`, result: `${fx(L.id * L.id * link.rdc, 3)} MW` },
        ]}
        check={{
          ok: lk.ok,
          text: `Second method — both station voltages recomputed by numerically integrating the commutation (no closed form): rectifier 2 × bridge at α = ${fx(L.alphaDeg, 3)}° → ${fx(lk.vdr, 4)} kV; inverter: the firing angle whose integrated overlap ends γ = ${fx(L.gammaDeg, 3)}° before 180°, averaged → ${fx(lk.vdi, 4)} kV. Kirchhoff on the line: (${fx(lk.vdr, 4)} − ${fx(lk.vdi, 4)}) / ${fx(link.rdc, 1)} Ω = ${fx(lk.id, 5)} kA against ${fx(L.id, 5)} kA (tolerance 10⁻⁵ kA, the integration error amplified by V_d/(R_dc·I_d)). (Consistency, not a second method: the line loss I_d²·R_dc equals P_dr − P_di = ${fx(L.pr - L.pi, 3)} MW by construction.)`,
        }}
      />
      <Calc
        title="3 · The rectifier bridge’s reactive power"
        steps={[
          { label: 'cos φ ≈ ½[cos α + cos(α + μ)]', expr: `½[cos ${fx(L.alphaDeg, 2)}° + cos ${fx(L.alphaDeg + muHand, 2)}°]`, result: fx(cosHand, 5) },
          { label: 'P = V_d·I_d', expr: `${fx(vdHand, 3)} × ${fx(L.id, 4)}`, result: `${fx(pHand, 2)} MW` },
          { label: 'Q = P·tan φ', expr: `${fx(pHand, 2)} × tan ${fx((Math.acos(cosHand) * 180) / Math.PI, 3)}°`, result: `${fx(qHand, 2)} Mvar per bridge` },
        ]}
        check={
          fund.ok
            ? {
                ok: Math.abs(fund.pAc - pHand) / pHand < TOL.num && Math.abs(cosHand - (fund.i1 / fund.i1Ideal) * fund.cosPhi1) < TOL.num,
                text: `Second method — Fourier analysis of the actual line current (with its overlap ramps): AC power ${fx(fund.pAc, 2)} MW (= the DC power), exact displacement factor cos φ₁ = ${fx(fund.cosPhi1, 5)}. The approximation is off by ${fx(Math.abs(fund.cosPhi1 - cosHand), 5)} because overlap shrinks the fundamental to ${fx((fund.i1 / fund.i1Ideal) * 100, 3)} % of (√6/π)·I_d; with that factor the two agree exactly (within 10⁻⁶).`,
              }
            : undefined
        }
      />
      <Calc
        title={`4 · A VSC station — ${note(ownVsc, 'orders')}`}
        steps={[
          { label: 'V_c·cos δ = V_s + Q·X/V_s', expr: `${fx(vl.vs1, 3)} + ${fx(vl.q1, 2)} × ${fx(vl.x, 3)} / ${fx(vl.vs1, 3)}`, result: fx(vl.vs1 + (vl.q1 * vl.x) / vl.vs1, 5) },
          { label: 'V_c·sin δ = P·X/V_s', expr: `${fx(V.ok ? V.p1 : 0, 3)} × ${fx(vl.x, 3)} / ${fx(vl.vs1, 3)}`, result: fx(V.ok ? (V.p1 * vl.x) / vl.vs1 : 0, 5) },
          { label: 'V_c ∠ δ', expr: '√(a² + b²) ∠ arctan(b/a)', result: V.ok ? `${fx(V.st1.vc, 5)} pu ∠ ${fx(V.st1.deltaDeg, 4)}°` : '—' },
        ]}
        check={
          V.ok
            ? (() => {
                const d = V.st1.deltaDeg * D2R
                const ire = (V.st1.vc * Math.sin(d)) / vl.x
                const iim = -(V.st1.vc * Math.cos(d) - vl.vs1) / vl.x
                const p = vl.vs1 * ire
                const q = -vl.vs1 * iim
                return {
                  ok: Math.abs(p - V.p1) < 1e-9 && Math.abs(q - vl.q1) < 1e-9 && V.st1.i <= vl.iMax + 1e-12,
                  text: `Second method — phasors: I = (V_c∠δ − V_s)/(jX) = ${fx(ire, 4)} ${iim < 0 ? '−' : '+'} j${fx(Math.abs(iim), 4)} pu, S = V_s·I* = ${fx(p, 4)} ${q < 0 ? '−' : '+'} j${fx(Math.abs(q), 4)} pu — the orders (to 10⁻⁹); |I| = ${fx(V.st1.i, 4)} pu ≤ ${fx(vl.iMax, 2)} pu, inside the capability.`,
                }
              })()
            : undefined
        }
      />
      <Calc
        title={`5 · Compensated power limits (V = ${fx(cp.v, 2)} pu, X = ${fx(cp.x, 2)} pu, k = ${fx(cp.k * 100, 0)} %)`}
        steps={[
          { label: 'Series: V²/(X(1 − k))', expr: `${fx(cp.v, 2)}² / (${fx(cp.x, 2)} × ${fx(1 - cp.k, 2)})`, result: `${fx(pMaxSeries(cp.v, cp.v, cp.x, cp.k), 4)} pu` },
          { label: 'Midpoint shunt: 2V²/X', expr: `2 × ${fx(cp.v, 2)}² / ${fx(cp.x, 2)}`, result: `${fx(pMaxMidShunt(cp.v, cp.x), 4)} pu` },
        ]}
        check={{
          ok: Math.abs(ns.f - pMaxSeries(cp.v, cp.v, cp.x, cp.k)) < 1e-9 && Math.abs(nm.f - pMaxMidShunt(cp.v, cp.x)) < 1e-9,
          text: `Second method — maximise each power–angle curve numerically (golden-section search on 0°–180°): ${fx(ns.f, 6)} pu at ${fx(ns.x, 3)}° and ${fx(nm.f, 6)} pu at ${fx(nm.x, 3)}° (within 10⁻⁹).`,
        }}
      />
      <Calc
        title={`6 · The weak-bus voltage — ${note(ownBus, 'bus')}`}
        steps={[
          { label: 'X = 1/SCR, tan φ', expr: `1/${fx(wb.scr, 2)}, tan(arccos ${fx(wb.pf, 2)})`, result: `${fx(x, 4)} pu, ${fx(t, 4)}` },
          {
            label: 'Compensator',
            expr:
              wb.support === 'none'
                ? 'none'
                : bus.state === 'regulating'
                  ? 'regulating: Q_c needed for 1.0 pu'
                  : wb.support === 'svc'
                    ? 'at limit: fixed B = rating'
                    : 'at limit: fixed current I = rating',
            result: wb.support === 'none' ? '—' : `Q_c = ${fx(bus.qc, 4)} pu`,
          },
          bus.state === 'regulating'
            ? {
                label: 'V held by the controller; δ from P = E·V·sin δ / X',
                expr: `V = ${fx(V_REF, 2)}, δ = arcsin(${fx(wb.p, 2)} × ${fx(x, 4)} / ${fx(V_REF, 2)})`,
                result: `V = ${fx(bus.v, 6)} pu, δ = ${fx(bus.deltaDeg, 3)}°`,
              }
            : {
                label: cf ? 'V² from the quadratic (upper root)' : 'Newton on (V, δ)',
                expr: cf ? `(1 − XB)²u² + (2Xq(1 − XB) − 1)u + X²(P² + q²) = 0, q = ${fx(qNet, 4)}` : `${bus.steps.length - 1} iterations from a flat start`,
                result: `V = ${fx(cf ? cf.upper : bus.v, 6)} pu`,
              },
        ]}
        check={{
          ok: Math.abs(bus.v - bus.vCheck) <= bus.tolV && bus.residual < 1e-9,
          text: `Second method — ${
            bus.state === 'regulating'
              ? `the fixed-Q quadratic with that Q_c: its root nearest V_ref is V = ${fx(bus.vCheck, 9)} pu`
              : cf
                ? `Newton–Raphson on the full power-flow equations (${bus.steps.length - 1} iterations): V = ${fx(bus.v, 9)} pu`
                : `${bus.checkMethod}: V = ${fx(bus.vCheck, 9)} pu`
          }; both satisfy the power-flow equations to ${bus.residual < 1e-12 ? '10⁻¹²' : bus.residual.toExponential(0)} pu. Tolerance on V: min(10⁻⁶, 10⁻⁹ + 10⁻¹²/|dP/dV|) = ${bus.tolV.toExponential(1)} pu, because here dP/dV = ${fx(bus.dPdV, 4)}${Math.abs(bus.dPdV) < 0.05 ? ' — close to the nose, where V is ill-conditioned' : ''}; the difference is ${Math.abs(bus.v - bus.vCheck).toExponential(1)} pu.`,
        }}
      />
      <Calc
        title={`7 · TCR susceptance at α = ${fx(aT, 2)}°${svcAlpha !== null && svcAlpha < 179.9 ? ' (the SVC’s firing angle now)' : ''}`}
        steps={[{ label: 'B/B_max = (2π − 2α + sin 2α)/π', expr: `(2π − 2 × ${fx(aT * D2R, 4)} + sin ${fx(2 * aT, 2)}°)/π`, result: fx(bT, 6) }]}
        check={{
          ok: Math.abs(bTn - bT) < 1e-9,
          text: `Second method — Fourier analysis of the TCR current i ∝ cos α − cos θ over its conduction (α to 360° − α, and its mirror): fundamental ${fx(bTn, 6)} of full conduction (Simpson, 2000 steps: within 10⁻⁹).`,
        }}
      />
      <section className="ps-card">
        <h3>Your turn</h3>
        <Quiz items={quiz} onComplete={() => completeActivity(MODULE, 'verify')} />
      </section>
    </div>
  )
}
