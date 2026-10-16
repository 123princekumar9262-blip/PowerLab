import { useMemo, useState, type ReactNode } from 'react'
import { fx } from '../../ui/format.ts'
import { Calc, Quiz, type QuizItem } from '../../ui/kit.tsx'
import { dcBusOutflow, dcLoadFlow } from './dcflow.ts'
import { bPrimeFull } from './fdlf.ts'
import { methodsModel, parallelPstPhi, rxStudy } from './methodsModel.ts'
import { lfBuses, saadatCase } from './systems.ts'
import { sci } from './views.tsx'
import { ybusSteps } from './ybusSteps.ts'

/*
 * The Verify and Practise blocks for the fast decoupled load flow, the DC load flow and the phase shifter. They are
 * shown on demand (a disclosure button) below the module's own checks and questions, and record no activity.
 */

const D2R = Math.PI / 180
/** A value for an expression: negative numbers in brackets. */
const pz = (v: number) => (v < 0 ? `(${fx(v, 0)})` : fx(v, 0))

function OnDemand({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="ps-card ps-lfm-ondemand">
      <button type="button" className="ps-lfm-disclose" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> {label}
      </button>
      {open && <div className="ps-stack ps-lfm-ondemand-body">{children}</div>}
    </section>
  )
}

// ── Verify ────────────────────────────────────────────────────────────────────────────────────────────────────

export function MethodsVerify() {
  return (
    <OnDemand label="Also check by hand: fast decoupled, DC load flow and the phase shifter (Saadat 3-bus)">
      <MethodsVerifyBody />
    </OnDemand>
  )
}

function MethodsVerifyBody() {
  const c = useMemo(() => saadatCase(), [])
  const m = useMemo(() => methodsModel(c, { pstLine: '1–3', phiDeg: 0 }), [c])
  const [L12, L13, L23] = c.lines
  const lb = lfBuses(c)
  // 1 · B′ by hand, and as −Im(Y_bus) of the same network with r = 0 (an independent route)
  const b22 = 1 / L12.x + 1 / L23.x
  const b33 = 1 / L13.x + 1 / L23.x
  const b23 = -1 / L23.x
  const Bp = bPrimeFull(c)
  const lossless = { ...c, lines: c.lines.map((l) => ({ ...l, r: 0, b: 0 })) }
  const Y0 = ybusSteps(lossless).Y
  const viaY = [-Y0[1][1].im, -Y0[2][2].im, -Y0[1][2].im]
  const bpOk =
    Math.abs(b22 - Bp[1][1]) < 1e-9 &&
    Math.abs(b33 - Bp[2][2]) < 1e-9 &&
    Math.abs(b23 - Bp[1][2]) < 1e-9 &&
    Math.abs(viaY[0] - b22) < 1e-9 &&
    Math.abs(viaY[1] - b33) < 1e-9 &&
    Math.abs(viaY[2] - b23) < 1e-9
  const Bpp = -m.Y0[1][1].im
  // 2 · the first fast decoupled iteration by hand (Cramer's rule on the 2×2 B′)
  const fd = m.fd
  const det = b22 * b33 - b23 * b23
  const nr0 = m.ac.run.records[0]
  // flat start (θ = 0): P_i = |V_i|·Σ_k |V_k|·G_ik, written out from the Y_bus entries
  const Yb = m.Y0
  const V0 = [c.buses[0].vSet, 1, c.buses[2].vSet]
  const P2f = V0[1] * (Yb[1][0].re * V0[0] + Yb[1][1].re * V0[1] + Yb[1][2].re * V0[2])
  const P3f = V0[2] * (Yb[2][0].re * V0[0] + Yb[2][1].re * V0[1] + Yb[2][2].re * V0[2])
  const dP2f = lb[1].p - P2f
  const dP3f = lb[2].p - P3f
  const r2 = dP2f / V0[1]
  const r3 = dP3f / V0[2]
  const dth2 = (r2 * b33 - b23 * r3) / det
  const dth3 = (b22 * r3 - b23 * r2) / det
  // Q₂ with the new angles: Q₂ = Σ_k |V₂||V_k|(G₂k sin θ₂k − B₂k cos θ₂k), written out
  const thN = [0, dth2, dth3]
  const Q2 = [0, 1, 2].reduce((q, k) => q + V0[1] * V0[k] * (Yb[1][k].re * Math.sin(thN[1] - thN[k]) - Yb[1][k].im * Math.cos(thN[1] - thN[k])), 0)
  const dQ2 = lb[1].q - Q2
  const mmOk = Math.abs(dP2f - nr0.dP[0]) < 1e-12 && Math.abs(dP3f - nr0.dP[1]) < 1e-12
  const dV2 = dQ2 / 1 / Bpp
  const s1 = fd.records[1]
  const it1Ok = mmOk && Math.abs(s1.th[1] - dth2) < 1e-12 && Math.abs(s1.th[2] - dth3) < 1e-12 && Math.abs(s1.Vm[1] - (1 + dV2)) < 1e-12
  // 3 · converged FDLF against NR
  const nr = m.ac.run
  const ag = m.agree!
  const convOk = ag.dth <= 2 * ag.bound && ag.dv <= 2 * ag.bound
  // 4 · DC load flow by hand
  const P2 = lb[1].p
  const P3 = lb[2].p
  const t2 = (P2 * b33 - b23 * P3) / det
  const t3 = (b22 * P3 - b23 * P2) / det
  const f12 = ((0 - t2) / L12.x) * 100
  const f13 = ((0 - t3) / L13.x) * 100
  const f23 = ((t2 - t3) / L23.x) * 100
  const dc = m.dc
  const out = dcBusOutflow(c, dc)
  const dcOk = Math.abs(f12 - dc.flows[0].pMw) < 1e-9 && Math.abs(f13 - dc.flows[1].pMw) < 1e-9 && Math.abs(f23 - dc.flows[2].pMw) < 1e-9 && Math.abs(out[1] - P2 * 100) < 1e-9
  // 5 · the phase shifter by hand: one loop, ΔP = φ / Σx
  const phiDeg = 5
  const xLoop = L12.x + L13.x + L23.x
  const dP = ((phiDeg * D2R) / xLoop) * 100
  const dcP = dcLoadFlow(c, { line: '1–3', phiDeg })
  const dPdc = dcP.flows.map((f, j) => f.pMw - dc.flows[j].pMw)
  const pstOk = Math.abs(dPdc[1] - dP) < 1e-9 && Math.abs(dPdc[0] + dP) < 1e-9 && Math.abs(dPdc[2] + dP) < 1e-9
  const acP = useMemo(() => methodsModel(c, { pstLine: '1–3', phiDeg }), [c])
  const dPac = acP.ac.converged && m.ac.converged ? acP.ac.lines[1].pFromMw - m.ac.lines[1].pFromMw : null
  // your turn
  const phiQ = 10
  const dcQ = dcLoadFlow(c, { line: '1–3', phiDeg: phiQ })
  const quiz: QuizItem[] = [
    {
      id: 'lfm-b33',
      kind: 'number',
      q: `From the line data alone, what is the B′ entry B′₃₃ (pu)? Line 1–3 has x = ${L13.x} pu and line 2–3 has x = ${L23.x} pu.`,
      answer: Bp[2][2],
      unit: 'pu',
      tol: 0.1,
      level: 'numerical',
      mistake: 'B′ uses 1/x only (r ignored). Using −B₃₃ of Y_bus, which includes the resistance, gives a smaller number.',
      why: `B′₃₃ = 1/x₁₃ + 1/x₂₃ = 1/${L13.x} + 1/${L23.x} = ${fx(Bp[2][2], 2)} pu.`,
    },
    {
      id: 'lfm-pst12',
      kind: 'number',
      q: `In the DC model, a ${phiQ}° phase shifter is put in line 1–3. What is the change in the flow on line 1–2 (from bus 1 to bus 2), in MW? Give it with its sign — negative if the flow falls.`,
      answer: dcQ.flows[0].pMw - dc.flows[0].pMw,
      unit: 'MW',
      tol: 1,
      level: 'university',
      mistake: 'The shift drives a flow round the whole loop: line 1–2 is part of the return path, so its flow falls by the same amount the PST line gains.',
      why: `ΔP = φ/Σx = (${phiQ} × π/180)/${fx(xLoop, 3)} × 100 = ${fx(((phiQ * D2R) / xLoop) * 100, 1)} MW round the loop 1→3→2→1, so line 1–2 changes by ${fx(dcQ.flows[0].pMw - dc.flows[0].pMw, 1)} MW.`,
    },
  ]
  return (
    <>
      <p className="small muted">Each value is recomputed here by a second route, independently of the solvers.</p>
      <Calc
        title="A · B′ and B″ from the line data"
        steps={[
          { label: 'B′₂₂ = 1/x₁₂ + 1/x₂₃', expr: `1/${L12.x} + 1/${L23.x}`, result: `${fx(b22, 2)} pu` },
          { label: 'B′₃₃ = 1/x₁₃ + 1/x₂₃', expr: `1/${L13.x} + 1/${L23.x}`, result: `${fx(b33, 3)} pu` },
          { label: 'B′₂₃ = −1/x₂₃', expr: `−1/${L23.x}`, result: `${fx(b23, 2)} pu` },
          { label: 'B″ = −B₂₂ (bus 2 is the only PQ bus)', expr: `−Im(Y₂₂) = −(${fx(m.Y0[1][1].im, 2)})`, result: `${fx(Bpp, 2)} pu` },
        ]}
        check={{
          ok: bpOk,
          text: `Second route: −Im(Y_bus) of the same network with every r set to 0 gives ${fx(viaY[0], 2)}, ${fx(viaY[1], 3)}, ${fx(viaY[2], 2)} — the same B′. B″ differs from B′₂₂ (${fx(Bpp, 0)} against ${fx(b22, 0)}) because it keeps r.`,
        }}
      />
      <Calc
        title="B · The first fast decoupled iteration"
        steps={[
          {
            label: 'Flat start: P_i = |V_i|·Σ|V_k|G_ik',
            expr: `P₂ = 1×(${pz(Yb[1][0].re)}×${fx(V0[0], 2)} + ${pz(Yb[1][1].re)}×1 + ${pz(Yb[1][2].re)}×${fx(V0[2], 2)}),  P₃ = ${fx(V0[2], 2)}×(${pz(Yb[2][0].re)}×${fx(V0[0], 2)} + ${pz(Yb[2][1].re)}×1 + ${pz(Yb[2][2].re)}×${fx(V0[2], 2)})`,
            result: `${fx(P2f, 4)}, ${fx(P3f, 4)} pu`,
          },
          { label: 'ΔP/|V| = (P_spec − P)/|V|', expr: `(${fx(lb[1].p, 2)} − (${fx(P2f, 4)}))/1,  (${fx(lb[2].p, 2)} − ${fx(P3f, 4)})/${fx(V0[2], 2)}`, result: `${fx(r2, 4)}, ${fx(r3, 4)}` },
          {
            label: 'Δθ = B′⁻¹·(ΔP/|V|), Cramer',
            expr: `det = ${fx(b22, 2)}×${fx(b33, 3)} − (${fx(b23, 0)})² = ${fx(det, 2)}`,
            result: `Δθ₂ = ${fx((dth2 * 180) / Math.PI, 4)}°, Δθ₃ = ${fx((dth3 * 180) / Math.PI, 4)}°`,
          },
          { label: 'ΔQ₂ with the new angles', expr: `Q₂ = Σ|V₂||V_k|(G₂k sin θ₂k − B₂k cos θ₂k) = ${fx(Q2, 4)};  Q₂,spec − Q₂ = ${fx(lb[1].q, 2)} − (${fx(Q2, 4)})`, result: `${fx(dQ2, 4)} pu` },
          { label: 'Δ|V₂| = (ΔQ₂/|V₂|)/B″', expr: `${fx(dQ2, 4)} / ${fx(Bpp, 2)}`, result: `${fx(dV2, 5)} → |V₂| = ${fx(1 + dV2, 5)} pu` },
        ]}
        check={{
          ok: it1Ok,
          text: `The Newton–Raphson iteration view’s flat-start mismatches are the same (ΔP₂ = ${fx(nr0.dP[0], 4)}, ΔP₃ = ${fx(nr0.dP[1], 4)}), and the fast decoupled solver’s state after iteration 1 is θ₂ = ${fx((s1.th[1] * 180) / Math.PI, 4)}°, θ₃ = ${fx((s1.th[2] * 180) / Math.PI, 4)}°, |V₂| = ${fx(s1.Vm[1], 5)} pu — the same.`,
        }}
      />
      <Calc
        title="C · Fast decoupled converges to the Newton–Raphson answer"
        steps={[
          { label: 'θ₂', expr: `FDLF ${fx((fd.th[1] * 180) / Math.PI, 6)}°   NR ${fx((nr.th[1] * 180) / Math.PI, 6)}°`, result: `Δ ${sci((Math.abs(fd.th[1] - nr.th[1]) * 180) / Math.PI, 1)}°` },
          { label: 'θ₃', expr: `FDLF ${fx((fd.th[2] * 180) / Math.PI, 6)}°   NR ${fx((nr.th[2] * 180) / Math.PI, 6)}°`, result: `Δ ${sci((Math.abs(fd.th[2] - nr.th[2]) * 180) / Math.PI, 1)}°` },
          { label: '|V₂|', expr: `FDLF ${fx(fd.Vm[1], 8)}   NR ${fx(nr.Vm[1], 8)}`, result: `Δ ${sci(Math.abs(fd.Vm[1] - nr.Vm[1]), 1)} pu` },
          { label: 'Iterations', expr: `FDLF ${fd.iterations}, NR ${nr.iterations}`, result: `both below 10⁻⁸ pu` },
        ]}
        check={{
          ok: convOk,
          text: `The differences are within twice the first-order bound ‖J⁻¹‖·(m_FDLF + m_NR) = ${sci(ag.bound, 1)} (both stopped with every mismatch below 10⁻⁸ pu).`,
        }}
      />
      <Calc
        title="D · DC load flow by hand"
        steps={[
          { label: 'P (pu)', expr: `P₂ = ${fx(P2, 2)} (load), P₃ = ${fx(P3, 2)} (generator)`, result: 'θ₁ = 0 (slack)' },
          { label: 'θ₂ = (P₂B′₃₃ − B′₂₃P₃)/det', expr: `(${fx(P2, 0)}×${fx(b33, 3)} − (${fx(b23, 0)})×${fx(P3, 0)}) / ${fx(det, 2)}`, result: `${fx(t2, 5)} rad = ${fx((t2 * 180) / Math.PI, 3)}°` },
          { label: 'θ₃ = (B′₂₂P₃ − B′₂₃P₂)/det', expr: `(${fx(b22, 0)}×${fx(P3, 0)} − (${fx(b23, 0)})×(${fx(P2, 0)})) / ${fx(det, 2)}`, result: `${fx(t3, 5)} rad = ${fx((t3 * 180) / Math.PI, 3)}°` },
          { label: 'P₁₂ = (θ₁ − θ₂)/x₁₂', expr: `(0 − (${fx(t2, 5)}))/${L12.x} × 100`, result: `${fx(f12, 2)} MW` },
          { label: 'P₁₃ = (θ₁ − θ₃)/x₁₃', expr: `(0 − (${fx(t3, 5)}))/${L13.x} × 100`, result: `${fx(f13, 2)} MW` },
          { label: 'P₂₃ = (θ₂ − θ₃)/x₂₃', expr: `(${fx(t2, 5)} − (${fx(t3, 5)}))/${L23.x} × 100`, result: `${fx(f23, 2)} MW` },
        ]}
        check={{
          ok: dcOk,
          text: `The DC solver (LU factorisation) gives the same three flows, and at bus 2: in from 1 (${fx(f12, 2)}) + in from 3 (${fx(-f23, 2)}) = ${fx(f12 - f23, 2)} MW = the load (KCL).`,
        }}
      />
      {m.ac.converged && (
        <p className="small muted">
          For comparison, the full AC solution has P₁₂ = {fx(m.ac.lines[0].pFromMw, 2)}, P₁₃ = {fx(m.ac.lines[1].pFromMw, 2)}, P₂₃ = {fx(m.ac.lines[2].pFromMw, 2)} MW — this system’s r/x of 0.33–0.5
          and its {fx(m.ac.lossMw, 1)} MW of losses are far from the DC assumptions.
        </p>
      )}
      <Calc
        title={`E · A ${phiDeg}° phase shifter in line 1–3, by hand`}
        steps={[
          { label: 'Loop reactance', expr: `x₁₂ + x₁₃ + x₂₃ = ${L12.x} + ${L13.x} + ${L23.x}`, result: `${fx(xLoop, 3)} pu` },
          { label: 'ΔP = φ / Σx', expr: `(${phiDeg} × π/180) / ${fx(xLoop, 3)} × 100`, result: `${fx(dP, 2)} MW round the loop 1→3→2→1` },
          { label: 'Lines 1–2 / 1–3 / 2–3', expr: 'the loop flow adds to 1→3 and opposes 1→2 and 2→3', result: `−${fx(dP, 2)} / +${fx(dP, 2)} / −${fx(dP, 2)} MW` },
        ]}
        check={{
          ok: pstOk,
          text: `The DC load flow with the ±φ/x injections gives ${dPdc.map((d) => `${d >= 0 ? '+' : ''}${fx(d, 2)}`).join(' / ')} MW — the same.${dPac !== null ? ` The AC complex-tap model gives ${dPac >= 0 ? '+' : ''}${fx(dPac, 2)} MW on line 1–3 (${fx(Math.abs(dPac - dP), 1)} MW apart: |V| ≠ 1, sin φ ≠ φ and r ≠ 0 in the AC model).` : ''}`,
        }}
      />
      <section className="ps-card">
        <h3>Your turn</h3>
        <Quiz items={quiz} />
      </section>
    </>
  )
}

// ── Practise ──────────────────────────────────────────────────────────────────────────────────────────────────

export function MethodsPractise() {
  return (
    <OnDemand label="More practice: fast decoupled, DC load flow and phase-shifting transformers">
      <MethodsPractiseBody />
    </OnDemand>
  )
}

function MethodsPractiseBody() {
  const c = useMemo(() => saadatCase(), [])
  const m = useMemo(() => methodsModel(c, { pstLine: '1–3', phiDeg: 0 }), [c])
  const Bp = bPrimeFull(c)
  const [L12, L13, L23] = c.lines
  const xLoop = L12.x + L13.x + L23.x
  const pst3 = dcLoadFlow(c, { line: '1–3', phiDeg: 3 })
  // a DC flow from given angles
  const x = 0.08
  const thI = -2
  const thK = -6.5
  const pDc = (((thI - thK) * D2R) / x) * 100
  // two parallel lines and a PST (university-style)
  const par = { x1: 0.2, x2: 0.3, total: 1, want: 0.4 }
  const phiPar = parallelPstPhi(par.x1, par.x2, par.total, par.want)
  const share0 = (par.total * par.x2) / (par.x1 + par.x2)
  const nr = m.ac.run
  const [rx0, rx1, rx4] = useMemo(() => rxStudy('saadat', [0, 1, 4]), [])
  const items: QuizItem[] = [
    {
      id: 'lfm-why',
      kind: 'choice',
      level: 'concept',
      q: 'Why may the fast decoupled method drop the blocks ∂P/∂|V| and ∂Q/∂θ of the Jacobian?',
      options: [
        { id: 'zero', label: 'Those derivatives are exactly zero in any network' },
        { id: 'xr', label: 'In transmission networks x ≫ r and angle differences are small, so P depends mainly on θ and Q mainly on |V|' },
        { id: 'later', label: 'They are recomputed at the end, so they can be left out during the iteration' },
      ],
      answer: 'xr',
      mistake: 'They are small, not zero — the full equations are still used for the mismatches, which is why the answer is exact.',
      why: `They are small where x ≫ r, not zero (on Saadat’s system, r/x up to 0.5, the coupling blocks’ largest entry is ${fx((m.dec?.ratio ?? 0) * 100, 0)} % of the main blocks’). Dropping them changes only the direction of each step; the mismatches still use the full equations, so the converged answer is exact.`,
    },
    {
      id: 'lfm-same',
      kind: 'choice',
      level: 'concept',
      q: 'Fast decoupled and Newton–Raphson are both run to a mismatch below 10⁻⁸ pu. Their answers…',
      options: [
        { id: 'approx', label: 'differ: fast decoupled is an approximate solution, like the DC load flow' },
        { id: 'nr', label: 'differ: Newton–Raphson is more accurate because it uses the exact Jacobian' },
        { id: 'same', label: 'are the same, to that tolerance — only the path differs' },
      ],
      answer: 'same',
      mistake: 'Confusing the fast decoupled load flow with the DC load flow. FDLF approximates only the Jacobian (the direction of each step), not the equations being solved.',
      why: `On Saadat’s system they agree to ${sci(m.agree?.dth ?? 0, 1)} rad in angle and ${sci(m.agree?.dv ?? 0, 1)} pu in |V|.`,
    },
    {
      id: 'lfm-bp22',
      kind: 'number',
      level: 'numerical',
      q: `Saadat’s system: line 1–2 is ${L12.r} + j${L12.x} pu and line 2–3 is ${L23.r} + j${L23.x} pu. What is B′₂₂ (pu)?`,
      answer: Bp[1][1],
      unit: 'pu',
      tol: 0.5,
      mistake: `Using −B₂₂ of Y_bus (${fx(-m.Y0[1][1].im, 0)}) — that is B″, which keeps r. B′ is built from 1/x alone.`,
      why: `B′₂₂ = 1/x₁₂ + 1/x₂₃ = 1/${L12.x} + 1/${L23.x} = ${fx(Bp[1][1], 1)} pu.`,
    },
    {
      id: 'lfm-dcflow',
      kind: 'number',
      level: 'numerical',
      q: `In a DC load flow (100 MVA base) a line of x = ${x} pu joins bus i at θ = ${fx(thI, 1)}° and bus k at θ = ${fx(thK, 1)}°. What active power flows from i to k, in MW?`,
      answer: pDc,
      unit: 'MW',
      tol: 0.5,
      mistake: 'Leaving the angle in degrees: θ must be in radians in P = (θ_i − θ_k)/x.',
      why: `P = (θ_i − θ_k)/x = (${fx(thI - thK, 1)}° × π/180)/${x} = ${fx(pDc / 100, 4)} pu = ${fx(pDc, 1)} MW.`,
    },
    {
      id: 'lfm-iters',
      kind: 'choice',
      level: 'university',
      q: `On Saadat’s system the fast decoupled method needs ${m.fd.iterations} iterations against Newton–Raphson’s ${nr.iterations}. What is the main reason?`,
      options: [
        { id: 'size', label: 'Three buses are too few for the fast decoupled method' },
        { id: 'rx', label: 'Only the high r/x — with every r set to zero it would need as few iterations as Newton–Raphson' },
        {
          id: 'linear',
          label: 'Its constant matrices only approximate the Jacobian, so it converges linearly (a roughly constant fraction of the error per iteration) while Newton–Raphson converges quadratically',
        },
      ],
      answer: 'linear',
      mistake: `r/x is a secondary effect: even with every r set to zero it still needs ${rx0.fd ?? '—'} iterations against Newton–Raphson’s ${rx0.nr ?? '—'}.`,
      why: `Computed on Saadat’s system with every line resistance scaled: r × 0 → ${rx0.fd ?? '—'} iterations (NR ${rx0.nr ?? '—'}); as given → ${rx1.fd ?? '—'} (NR ${rx1.nr ?? '—'}); r × 4 → ${rx4.fd ?? '—'} (NR ${rx4.nr ?? '—'}). The constant matrices cost iterations even without resistance; a large r/x adds more.`,
    },
    {
      id: 'lfm-dcslack',
      kind: 'number',
      level: 'university',
      q: `Saadat’s system: load ${fx(c.buses[1].pLoadMw, 0)} MW at bus 2, generator at bus 3 scheduled at ${fx(c.buses[2].pGenMw, 0)} MW. What slack generation does the DC load flow give, in MW?`,
      answer: m.dc.pInjMw[m.dc.slack],
      unit: 'MW',
      tol: 0.5,
      mistake: `Adding the AC losses (${fx(m.ac.lossMw, 1)} MW) — the DC load flow has none.`,
      why: `Lossless: P_slack = ${fx(c.buses[1].pLoadMw, 0)} − ${fx(c.buses[2].pGenMw, 0)} = ${fx(m.dc.pInjMw[m.dc.slack], 0)} MW (AC: ${fx(m.ac.slackMw, 2)} MW).`,
    },
    {
      id: 'lfm-pst3',
      kind: 'number',
      level: 'university',
      q: `Saadat’s system in the DC model: a 3° phase shifter in line 1–3 (x₁₂ = ${L12.x}, x₁₃ = ${L13.x}, x₂₃ = ${L23.x} pu). How much does the flow on line 1–3 rise, in MW?`,
      answer: pst3.flows[1].pMw - m.dc.flows[1].pMw,
      unit: 'MW',
      tol: 0.5,
      mistake: 'Using φ/x₁₃ alone — that ignores that the angles of buses 1 and 3 move too; in a single loop the shift drives φ/(sum of all three reactances).',
      why: `ΔP = φ/(x₁₂ + x₁₃ + x₂₃) = (3 × π/180)/${fx(xLoop, 3)} × 100 = ${fx(pst3.flows[1].pMw - m.dc.flows[1].pMw, 1)} MW.`,
    },
    {
      id: 'lfm-parallel',
      kind: 'number',
      level: 'university',
      q: `Two lines in parallel between buses A and B, x₁ = ${par.x1} pu and x₂ = ${par.x2} pu, carry ${par.total} pu from A to B (DC model, so line 1 carries ${fx(share0, 1)} pu). What phase shift φ in line 1, in degrees (positive pushing power from A to B through it), makes line 1 carry ${par.want} pu?`,
      answer: phiPar,
      unit: '°',
      tol: 0.1,
      mistake: `Using φ = (${par.want} − ${fx(share0, 1)}) × x₁ = ${fx(((par.want - share0) * par.x1) / D2R, 2)}° — that keeps the angle across the pair fixed. It changes: line 2 must carry ${fx(par.total - par.want, 1)} pu, which needs δ = ${fx((par.total - par.want) * par.x2, 2)} rad.`,
      why: `Line 2: P₂ = δ/x₂ = ${fx(par.total - par.want, 1)} → δ = ${fx((par.total - par.want) * par.x2, 3)} rad. Line 1: P₁ = (δ + φ)/x₁ = ${par.want} → φ = ${par.want}×${par.x1} − ${fx((par.total - par.want) * par.x2, 3)} = ${fx(phiPar * D2R, 3)} rad = ${fx(phiPar, 2)}° (negative: it holds power back).`,
    },
    {
      id: 'lfm-dcsize',
      kind: 'choice',
      level: 'university',
      q: 'A DC load flow is run on an N-bus network with one slack bus. What does it solve?',
      options: [
        { id: 'twice', label: 'A 2(N−1)×2(N−1) system, iterated to convergence' },
        { id: 'once', label: 'One linear (N−1)×(N−1) system B′·θ = P, once' },
        { id: 'nn', label: 'An N×N system including the slack bus angle' },
      ],
      answer: 'once',
      mistake: 'The slack angle is the reference (θ = 0), so it is not an unknown; and the DC equations are linear — no iteration.',
      why: `Saadat’s 3 buses: a ${m.dc.Bp.length}×${m.dc.Bp.length} B′, solved once.`,
    },
  ]
  return (
    <>
      <p className="small muted">Written for this app (not past papers); every number comes from this module’s calculations. These questions do not count towards the activity above.</p>
      <Quiz items={items} />
    </>
  )
}
