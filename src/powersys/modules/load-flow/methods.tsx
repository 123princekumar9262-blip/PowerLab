import { useMemo, useState, type ReactNode } from 'react'
import { useLevel } from '../../../shell/prefs.ts'
import { fx } from '../../ui/format.ts'
import { Callout, Eq, Predict, Readouts, Seg, Slider, type Choice } from '../../ui/kit.tsx'
import { Plot } from '../../ui/Plot.tsx'
import type { LineFlow } from './analysis.ts'
import type { BusShown } from './LfDiagram.tsx'
import { methodsModel, PCT_FLOOR, pstTable, rxStudy, timesWords, type Method, type MethodsModel, type MethodsState } from './methodsModel.ts'
import { pstSweep } from './pst.ts'
import { CASES, type LfCase } from './systems.ts'
import { log10m, Matrix, sb, sci } from './views.tsx'
import { FD_MAX_ITER } from './fdlf.ts'
import './methods.css'

/*
 * "Other solution methods" — the Explore sub-view on the fast decoupled load flow, the DC load flow and the
 * phase-shifting transformer. Every number is computed (methodsModel.ts, fdlf.ts, dcflow.ts, pst.ts) on the case
 * the student has set up in Explore (system, loading, outages, capacitor, Q limits) plus an optional phase shifter.
 */

const R2D = 180 / Math.PI

/** What the module's single-line diagram shows in this view: the selected method's solution. */
export function methodsDiagram(m: MethodsModel | null, method: Method): { busV: BusShown[] | null; flows: LineFlow[] | null; current: string | null } {
  if (!m) return { busV: null, flows: null, current: null }
  const current = m.pst ? m.pst.line : null
  if (method === 'dc') {
    if (!m.dc.ok) return { busV: null, flows: null, current }
    return {
      busV: m.dc.th.map((t) => ({ vm: 1, thDeg: t * R2D })),
      // reactive power is not part of a DC load flow: NaN is shown as “—”
      flows: m.dc.flows.map((f) => ({ id: f.id, from: f.from, to: f.to, inService: f.inService, pFromMw: f.pMw, pToMw: -f.pMw, qFromMvar: NaN, qToMvar: NaN, lossMw: 0, lossMvar: 0, iSeriesPu: 0 })),
      current,
    }
  }
  if (method === 'fdlf') {
    if (!m.fd.converged) return { busV: null, flows: null, current }
    return { busV: m.fd.Vm.map((v, i) => ({ vm: v, thDeg: m.fd.th[i] * R2D })), flows: m.fdLines, current }
  }
  if (!m.ac.converged) return { busV: null, flows: null, current }
  return { busV: m.ac.run.Vm.map((v, i) => ({ vm: v, thDeg: m.ac.run.th[i] * R2D })), flows: m.ac.lines, current }
}

/** A Predict that hides the comparison until the student has committed (or chooses to skip). */
function PredictFirst({ question, options, answer, why, children }: { question: string; options: Choice[]; answer: string; why: ReactNode; children: ReactNode }) {
  const [shown, setShown] = useState(false)
  return (
    <>
      <Predict question={question} options={options} answer={answer} why={why} onAnswered={() => setShown(true)} />
      {shown ? (
        children
      ) : (
        <button type="button" className="text-btn ps-lfm-skip" onClick={() => setShown(true)}>
          Skip the prediction and show the comparison
        </button>
      )}
    </>
  )
}

const sizeWord = (ratio: number) => (ratio < 0.25 ? 'small' : ratio < 0.6 ? 'noticeable' : 'not small')

// ── the view ──────────────────────────────────────────────────────────────────────────────────────────────────

export function MethodsView({ c, m, state, setState }: { c: LfCase; m: MethodsModel; state: MethodsState; setState(s: MethodsState): void }) {
  const level = useLevel()
  const nr = m.ac.run
  const set = (p: Partial<MethodsState>) => setState({ ...state, ...p })
  return (
    <div className="ps-stack ps-lfm">
      <section className="ps-card ps-lfm-intro" aria-labelledby="ps-lfm-why">
        <h3 id="ps-lfm-why">Why other methods?</h3>
        <p>
          Newton–Raphson is the reference: it converges in a few iterations, but every iteration builds a new Jacobian and solves it — a matrix the size of the number of unknowns, which for a large
          interconnected grid can run to tens of thousands. Two observations about transmission networks make cheaper methods possible: lines have x much larger than r, and the angle across a line is
          small. Then <b>active power follows the angles</b> and <b>reactive power follows the voltage magnitudes</b>, and the cross-coupling can be dropped.
        </p>
        {m.dec ? (
          <p>
            Here, at the Newton–Raphson solution, the coupling blocks of the Jacobian are {sizeWord(m.dec.ratio)}: their largest entry is <b>{fx(m.dec.ratio * 100, 0)} %</b> of the main blocks’ (J2{' '}
            {fx(m.dec.j2, 1)}, J3 {fx(m.dec.j3, 1)} against J1 {fx(m.dec.j1, 1)}, J4 {fx(m.dec.j4, 1)}). The lines’ r/x is{' '}
            {Math.abs(m.dec.rxMax - m.dec.rxMin) < 1e-9 ? fx(m.dec.rxMax, 2) : `${fx(m.dec.rxMin, 2)} to ${fx(m.dec.rxMax, 2)}`}.
          </p>
        ) : (
          <p className="muted">The Newton–Raphson load flow has no solution for these settings, so there is no Jacobian to inspect.</p>
        )}
        <p className="small muted">
          The diagram above shows the solution of the method chosen below{m.pst ? `, with the phase shifter in line ${m.pst.line} (outlined)` : ''}. The operating-point controls on the right apply to
          every method{m.pst ? '; its readouts (and its overload warning) describe the network without the phase shifter — the phase shifter’s effect is in the card below' : ''}.
        </p>
      </section>
      <div className="ps-toolbar">
        <Seg
          label="Solve with"
          value={state.method}
          onChange={(v) => set({ method: v })}
          options={[
            { id: 'nr', label: 'NR (full AC)' },
            { id: 'fdlf', label: 'Fast decoupled' },
            { id: 'dc', label: 'DC load flow' },
          ]}
        />
        <span className="small muted">
          {state.method === 'nr' && nr.converged && `Newton–Raphson: ${nr.iterations} iterations.`}
          {state.method === 'fdlf' && m.fd.converged && `Fast decoupled: ${m.fd.iterations} iterations to the same 10⁻⁸ pu.`}
          {state.method === 'dc' && m.dc.ok && 'DC: one linear solve — |V| taken as 1 pu, Mvar not computed (shown as —).'}
        </span>
      </div>
      {state.method === 'nr' && <NrCard m={m} />}
      {state.method === 'fdlf' && <FdlfCard key={c.id} c={c} m={m} level={level} />}
      {state.method === 'dc' && <DcCard key={c.id} c={c} m={m} />}
      <PstCard key={`pst-${c.id}`} c={c} state={state} set={set} level={level} />
    </div>
  )
}

function NrCard({ m }: { m: MethodsModel }) {
  const nr = m.ac.run
  if (!m.ac.converged)
    return (
      <Callout tone="bad" title="Newton–Raphson finds no operating point">
        <p>{m.ac.error}</p>
      </Callout>
    )
  const sizes = nr.records.filter((r) => r.J).map((r) => r.J!.length)
  const distinct = [...new Set(sizes)]
  const jac =
    distinct.length <= 1
      ? `a fresh ${distinct[0] ?? 0} × ${distinct[0] ?? 0} Jacobian`
      : `a fresh Jacobian (${distinct.map((n) => `${n} × ${n}`).join(', then ')} — it grew when a PV bus reached its reactive limit and became a PQ bus)`
  return (
    <section className="ps-card" aria-labelledby="ps-lfm-nr">
      <h3 id="ps-lfm-nr">The reference: full AC Newton–Raphson</h3>
      <p>
        {nr.iterations} iterations to a largest mismatch of {sci(nr.history[nr.history.length - 1], 1)} pu. Each iteration built and solved {jac} — {sizes.length} factorisations in all. Choose{' '}
        <b>Fast decoupled</b> to see how far constant matrices get, or <b>DC load flow</b> for the linear approximation.
      </p>
    </section>
  )
}

// ── fast decoupled ────────────────────────────────────────────────────────────────────────────────────────────

const RX_FACTORS = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 3.5, 4]

function FdlfCard({ c, m, level }: { c: LfCase; m: MethodsModel; level: string }) {
  const nr = m.ac.run
  const fd = m.fd
  const base = useMemo(() => methodsModel(CASES[c.id](), { pstLine: '1–3', phiDeg: 0 }), [c.id])
  const bN = base.ac.run.iterations
  const bF = base.fd.iterations
  const pAns = bF > bN + 1 ? 'more' : bF < bN - 1 ? 'fewer' : 'same'
  const rx = useMemo(() => rxStudy(c.id, RX_FACTORS), [c.id])
  const rx0 = rx[0]
  const rxMax = rx[rx.length - 1]
  const upTo = rx.filter((p) => p.fd !== null && p.rx <= (base.dec?.rxMax ?? 0) + 1e-9).map((p) => p.fd!)
  const fdLo = upTo.length ? Math.min(...upTo) : bF
  const fdHi = upTo.length ? Math.max(...upTo) : bF
  const other = useMemo(() => {
    const o = c.id === 'saadat' ? 'five' : 'saadat'
    const mm = methodsModel(CASES[o](), { pstLine: '1–3', phiDeg: 0 })
    return { name: CASES[o]().short, nr: mm.ac.run.iterations, fd: mm.fd.iterations, rx: mm.dec?.rxMax ?? 0 }
  }, [c.id])
  // records are labelled by iteration k; after a PV bus switches to PQ the same k appears twice (before and after)
  const maxK = Math.max(nr.records.length ? nr.records[nr.records.length - 1].k : 0, fd.records.length ? fd.records[fd.records.length - 1].k : 0)
  const at = <T extends { k: number }>(recs: T[], k: number, f: (r: T) => number) =>
    recs
      .filter((r) => r.k === k)
      .map((r) => sci(f(r), 1))
      .join(' → ')
  const eventRec = fd.records.find((r) => r.event)
  const angLabels = fd.angIdx.map((i) => `θ${sb(i)}`)
  const magLabels = fd.magIdx.map((i) => `|V${sb(i)}|`)
  return (
    <section className="ps-card ps-stack" aria-labelledby="ps-lfm-fd">
      <h3 id="ps-lfm-fd">Fast decoupled load flow (XB scheme — the original Stott–Alsaç form)</h3>
      <PredictFirst
        question={`On the unmodified ${base.c.short} system Newton–Raphson needs ${bN} iterations to reach a mismatch below 10⁻⁸ pu. How many will the fast decoupled method need?`}
        options={[
          { id: 'fewer', label: 'Fewer — it is the “fast” method' },
          { id: 'same', label: 'About the same (within one)' },
          { id: 'more', label: 'More — but each one is cheaper' },
        ]}
        answer={pAns}
        why={
          <p>
            It needs {bF} ({timesWords(bF, bN)}). Its matrices are only approximations of the Jacobian, so it converges linearly — a roughly constant fraction of the error per iteration — instead of
            quadratically. Each iteration costs two solves with matrices factorised once, against a new Jacobian built and factorised every Newton iteration.
          </p>
        }
      >
        <div className="ps-stack">
          <Eq
            expr="ΔP/|V| = B′·Δθ        ΔQ/|V| = B″·Δ|V|"
            where={[
              ['ΔP, ΔQ', 'the exact AC mismatches (specified − calculated with the full Y_bus)', 'pu'],
              [
                'B′',
                `built from −1/x of every branch: B′_ii = Σ 1/x_ik, B′_ik = −1/x_ik; non-slack buses (${angLabels.length} × ${angLabels.length}); r, line charging, shunts and taps ignored`,
                'pu',
              ],
              ['B″', `−B = −Im(Y_bus), PQ buses only (${magLabels.length} × ${magLabels.length}); r, charging and shunts kept`, 'pu'],
            ]}
            assume="x ≫ r and small angle differences, so ∂P/∂|V| and ∂Q/∂θ are dropped and cos θ_ik ≈ 1, |V| ≈ 1 in the remaining blocks. Both matrices are constant: factorised once."
          />
          {!fd.converged ? (
            <Callout tone="bad" title="The fast decoupled iteration did not converge">
              <p>
                {fd.error}{' '}
                {m.ac.converged
                  ? fd.stop === 'cap-converging'
                    ? `Newton–Raphson converges here (${nr.iterations} iterations); the fast decoupled method was still converging, only slowly — linear convergence with constant matrices can need very many iterations, especially after a PV bus switches to PQ.`
                    : `Newton–Raphson converges here (${nr.iterations} iterations); with its constant matrices the fast decoupled iteration does not get there from the flat start.`
                  : ''}
              </p>
            </Callout>
          ) : (
            <Readouts
              label="Fast decoupled against Newton–Raphson"
              items={[
                {
                  label: 'Newton–Raphson',
                  value: m.ac.converged ? String(nr.iterations) : '—',
                  unit: 'iterations',
                  note: m.ac.converged ? `${nr.iterations} Jacobians built and factorised` : 'no solution',
                },
                {
                  label: 'Fast decoupled',
                  value: String(fd.iterations),
                  unit: 'iterations',
                  note: `B′ factorised once${magLabels.length ? `, B″ ${fd.factorisations.bpp === 1 ? 'once' : `${fd.factorisations.bpp} times (a PV bus switched to PQ)`}` : ''}`,
                },
                ...(m.agree
                  ? [
                      {
                        label: 'Same solution?',
                        value: m.agree.dth <= 2 * m.agree.bound && m.agree.dv <= 2 * m.agree.bound ? 'yes' : 'no',
                        tone: m.agree.dth <= 2 * m.agree.bound && m.agree.dv <= 2 * m.agree.bound ? ('good' as const) : ('bad' as const),
                        note: `largest difference ${sci(m.agree.dth * R2D, 1)}° in θ, ${sci(m.agree.dv, 1)} pu in |V|`,
                      },
                    ]
                  : []),
              ]}
            />
          )}
          {m.agree && (
            <p className="small muted">
              Both stop when every mismatch is below 10⁻⁸ pu, so they can differ by up to about ‖J⁻¹‖·(sum of the two final mismatches) = {sci(m.agree.bound, 1)} (rad, or pu of |V|) — the first-order
              bound computed at the solution; “yes” means both differences are within twice it.
            </p>
          )}
          <div className="ps-lfm-plotrow ps-lfm-plotrow--table">
            <Plot
              label="Largest mismatch against iteration, Newton–Raphson and fast decoupled (log scale)"
              series={[
                { id: 'nr', label: 'NR', color: 'var(--accent)', points: nr.records.map((r) => [r.k, log10m(r.mismatch)] as [number, number]) },
                { id: 'fd', label: 'FDLF', color: 'var(--warning)', points: fd.records.map((r) => [r.k, log10m(r.mismatch)] as [number, number]) },
              ]}
              xLabel="Iteration"
              yLabel="log₁₀ largest mismatch [pu]"
              xDomain={[0, Math.max(4, maxK)]}
              yDomain={[Math.min(-10, Math.floor(Math.min(...nr.history.map(log10m), ...fd.history.map(log10m))) - 1), 2]}
              hlines={[{ y: -8, label: 'tolerance 10⁻⁸ pu' }]}
              vlines={eventRec ? [{ x: eventRec.k, label: 'PV → PQ' }] : []}
              height={250}
            />
            <div className="ps-lfm-itertable" role="region" aria-label="Iteration table" tabIndex={0}>
              <table className="ps-table">
                <caption className="sr-only">Largest mismatch at each iteration</caption>
                <thead>
                  <tr>
                    <th scope="col">It.</th>
                    <th scope="col">NR, pu</th>
                    <th scope="col">FDLF |ΔP|</th>
                    <th scope="col">FDLF |ΔQ|</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: maxK + 1 }, (_, k) => (
                    <tr key={k} className={eventRec && eventRec.k === k ? 'is-event' : ''}>
                      <td>{k === 0 ? 'start' : k}</td>
                      <td>{at(nr.records, k, (r) => r.mismatch)}</td>
                      <td>{at(fd.records, k, (r) => r.dPmax)}</td>
                      <td>{fd.magIdx.length ? at(fd.records, k, (r) => r.dQmax) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {eventRec && (
            <p className="small muted">
              After iteration {eventRec.k} {eventRec.event}; the mismatch jumps (shown as “a → b” in the table) because a new equation — that bus’s Q — has joined.
            </p>
          )}
          <details className="ps-more" open={level === 'engineer'}>
            <summary>The two constant matrices of this case</summary>
            <div className="ps-lfm-mats">
              <div>
                <p className="small">B′ — rows ΔP/|V|, columns Δθ</p>
                <Matrix label="B prime" rows={fd.angIdx.map((i) => `P${sb(i)}`)} cols={angLabels} corner="B′" cell={(i, j) => ({ text: fx(fd.Bp[i][j], 2), zero: Math.abs(fd.Bp[i][j]) < 1e-12 })} />
              </div>
              <div>
                <p className="small">B″ — rows ΔQ/|V|, columns Δ|V|</p>
                {magLabels.length ? (
                  <Matrix
                    label="B double prime"
                    rows={fd.magIdx.map((i) => `Q${sb(i)}`)}
                    cols={magLabels}
                    corner="B″"
                    cell={(i, j) => ({ text: fx(fd.Bpp[i][j], 2), zero: Math.abs(fd.Bpp[i][j]) < 1e-12 })}
                  />
                ) : (
                  <p className="small muted">No PQ bus — no Q–V half-iteration.</p>
                )}
              </div>
            </div>
            <p className="small muted">
              One iteration: Δθ = B′⁻¹·(ΔP/|V|), update θ; recompute ΔQ with the new angles; Δ|V| = B″⁻¹·(ΔQ/|V|), update |V|. The mismatches always use the full Y_bus, which is why the converged
              answer is the Newton–Raphson answer.
            </p>
          </details>
          <details className="ps-more" open={level !== 'beginner'}>
            <summary>How r/x affects the fast decoupled method</summary>
            <div className="ps-lfm-plotrow">
              <Plot
                label={`Iterations against r/x, ${base.c.short} (every line's r scaled)`}
                series={[
                  { id: 'nr', label: 'NR', color: 'var(--accent)', points: rx.filter((p) => p.nr !== null).map((p) => [p.rx, p.nr!] as [number, number]) },
                  { id: 'fd', label: 'FDLF', color: 'var(--warning)', points: rx.filter((p) => p.fd !== null).map((p) => [p.rx, p.fd!] as [number, number]) },
                ]}
                xLabel="largest r/x of the lines"
                yLabel="Iterations to 10⁻⁸ pu"
                vlines={[{ x: base.dec?.rxMax ?? 0, label: 'this system' }]}
                height={230}
              />
              <div className="ps-card">
                <p>
                  {base.c.short} as given (r/x up to {fx(base.dec?.rxMax ?? 0, 2)}): NR {bN}, FDLF {bF}. {other.name} (r/x {fx(other.rx, 2)}): NR {other.nr}, FDLF {other.fd}.
                </p>
                <p className="small muted">
                  Every line’s resistance is multiplied by 0 to 4 on the unmodified {base.c.short} system.{' '}
                  {rx.some((p) => p.fd === null) ? `Missing points: the fast decoupled iteration did not converge within ${FD_MAX_ITER} iterations. ` : ''}With every r set to zero it still needs{' '}
                  {rx0.fd ?? '—'} iterations (NR {rx0.nr ?? '—'}): the main cost is linear convergence with constant matrices. A large r/x adds to it — r × {fx(rxMax.k, 0)} (r/x {fx(rxMax.rx, 2)})
                  needs {rxMax.fd ?? 'no convergence within the cap'}
                  {rxMax.fd !== null ? ' iterations' : ''} — because it couples P to |V| and Q to θ, exactly what the method throws away. Up to this system’s own r/x it stays between {fdLo} and {fdHi}{' '}
                  iterations.
                </p>
              </div>
            </div>
          </details>
        </div>
      </PredictFirst>
    </section>
  )
}

// ── DC load flow ──────────────────────────────────────────────────────────────────────────────────────────────

function DcCard({ c, m }: { c: LfCase; m: MethodsModel }) {
  const base = useMemo(() => methodsModel(CASES[c.id](), { pstLine: '1–3', phiDeg: 0 }), [c.id])
  const bSlackDc = base.dc.pInjMw[base.dc.slack]
  const bSlackAc = base.ac.slackMw
  const pAns = bSlackDc < bSlackAc - 0.5 ? 'less' : bSlackDc > bSlackAc + 0.5 ? 'more' : 'same'
  const rows = m.dcRows.filter((r) => r.inService)
  const worst = rows.reduce<(typeof rows)[number] | null>((w, r) => (!w || Math.abs(r.errMw) > Math.abs(w.errMw) ? r : w), null)
  const pcts = rows.filter((r) => r.errPct !== null).map((r) => Math.abs(r.errPct!))
  const worstPct = pcts.length ? Math.max(...pcts) : null
  const slackDc = m.dc.ok ? m.dc.pInjMw[m.dc.slack] : NaN
  return (
    <section className="ps-card ps-stack" aria-labelledby="ps-lfm-dc">
      <h3 id="ps-lfm-dc">DC load flow</h3>
      <PredictFirst
        question={`The DC load flow ignores resistance, so it has no losses. On the unmodified ${base.c.short} system, how will its slack-bus generation compare with the full AC answer (${fx(bSlackAc, 1)} MW)?`}
        options={[
          { id: 'less', label: 'Lower — by about the AC losses' },
          { id: 'same', label: 'The same' },
          { id: 'more', label: 'Higher' },
        ]}
        answer={pAns}
        why={
          <p>
            DC: {fx(bSlackDc, 1)} MW; AC: {fx(bSlackAc, 1)} MW. The difference, {fx(bSlackAc - bSlackDc, 1)} MW, is close to the AC line losses ({fx(base.ac.lossMw, 1)} MW): with no losses the slack
            supplies exactly the load minus the other generation.
          </p>
        }
      >
        <div className="ps-stack">
          <Eq
            expr="P_ik = (θ_i − θ_k) / x_ik        P = B′·θ   (θ_slack = 0)"
            where={[
              ['P_ik', 'active power from bus i to bus k', 'pu'],
              ['θ_i', 'bus voltage angle', 'rad'],
              ['x_ik', 'series reactance of the branch', 'pu'],
              ['B′', 'the same matrix as the fast decoupled method: −1/x of every branch', 'pu'],
            ]}
            assume="(1) every |V| = 1 pu; (2) r ≪ x, so r is ignored — no losses; (3) small angle differences, sin θ_ik ≈ θ_ik; (4) reactive power is not considered."
          />
          {!m.dc.ok || !m.ac.converged ? (
            <Callout tone="bad" title="No comparison">
              <p>{!m.dc.ok ? m.dc.error : `The AC load flow has no solution for these settings (${m.ac.error}) — the DC load flow still gives an answer, but there is nothing to compare it with.`}</p>
            </Callout>
          ) : (
            <>
              <Readouts
                label="DC against AC"
                items={[
                  { label: 'Largest error', value: worst ? fx(Math.abs(worst.errMw), 1) : '—', unit: 'MW', note: worst ? `line ${worst.id}` : undefined },
                  {
                    label: 'Largest error, relative',
                    value: worstPct !== null ? fx(worstPct, 1) : '—',
                    unit: '%',
                    note: `of the AC flow (lines carrying ≥ ${fx(PCT_FLOOR * 100, 0)} % of the largest flow)`,
                  },
                  { label: 'Slack generation', value: fx(slackDc, 1), unit: 'MW', note: `AC ${fx(m.ac.slackMw, 1)} MW — AC losses ${fx(m.ac.lossMw, 2)} MW` },
                ]}
              />
              <div className="table-wrap">
                <table className="ps-table ps-lfm-dctable">
                  <caption className="sr-only">Line flows: DC load flow against the full AC (Newton–Raphson) solution</caption>
                  <thead>
                    <tr>
                      <th scope="col">Line i–k</th>
                      <th scope="col">x pu</th>
                      <th scope="col">DC P_ik MW</th>
                      <th scope="col">AC P_ik MW</th>
                      <th scope="col">Error MW</th>
                      <th scope="col">Error %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.dcRows.map((r) => (
                      <tr key={r.id} className={!r.inService ? 'is-out' : worst && r.id === worst.id ? 'is-worst' : ''}>
                        <td>{r.id}</td>
                        {r.inService ? (
                          <>
                            <td>{fx(r.x, 4)}</td>
                            <td>{fx(r.dcMw, 1)}</td>
                            <td>{fx(r.acMw, 1)}</td>
                            <td>
                              {r.errMw >= 0 ? '+' : ''}
                              {fx(r.errMw, 1)}
                            </td>
                            <td>{r.errPct === null ? '—' : `${r.errPct >= 0 ? '+' : ''}${fx(r.errPct, 1)}`}</td>
                          </>
                        ) : (
                          <td colSpan={5} className="muted">
                            out of service
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small muted">
                AC P_ik is the active power entering the line at bus i (the AC flows at the two ends differ by the line’s loss; DC has one flow per line). A percentage is shown only for lines carrying
                at least {fx(PCT_FLOOR * 100, 0)} % of the largest AC flow. Error = DC − AC.
              </p>
            </>
          )}
          <details className="ps-more">
            <summary>Where the DC load flow is used</summary>
            <p>
              It is linear: B′ is factorised once, and the flow on every line is a fixed linear combination of the bus injections. That makes it the tool for questions that need thousands of load
              flows quickly — <b>contingency screening</b> (take each line out in turn and find which others would overload; the worst cases are then checked with a full AC load flow), and{' '}
              <b>electricity-market and transmission-planning studies</b>, where the network has to appear as linear constraints inside an optimisation.
            </p>
            <p>It says nothing about voltages or reactive power, and it misses the losses — so it is a screening tool, not a replacement for the AC load flow.</p>
          </details>
        </div>
      </PredictFirst>
    </section>
  )
}

// ── phase-shifting transformer ────────────────────────────────────────────────────────────────────────────────

const PHIS = Array.from({ length: 41 }, (_, k) => k - 20)

function PstCard({ c, state, set, level }: { c: LfCase; state: MethodsState; set(p: Partial<MethodsState>): void; level: string }) {
  const lines = c.lines.filter((l) => l.inService !== false)
  const line = lines.find((l) => l.id === state.pstLine) ?? null
  const id = line?.id ?? ''
  const phi = state.phiDeg
  const t = useMemo(() => (line ? pstTable(c, id, phi) : null), [c, id, phi, line])
  const sweep = useMemo(() => (line ? pstSweep(c, id, PHIS) : []), [c, id, line])
  const base = useMemo(() => CASES[c.id](), [c.id])
  const pred = useMemo(() => pstTable(base, '1–3', 10), [base])
  const r12 = pred.rows.find((r) => r.id === '1–2')!
  const pAns = r12.ac0 !== null && r12.ac1 !== null ? (r12.ac1 < r12.ac0 - 0.5 ? 'down' : r12.ac1 > r12.ac0 + 0.5 ? 'up' : 'same') : 'same'
  const self = t?.rows.find((r) => r.id === id)
  const dAc = self && self.ac0 !== null && self.ac1 !== null ? self.ac1 - self.ac0 : null
  const dDc = self ? self.dc1 - self.dc0 : 0
  const slackChange = t && t.ac0.converged && t.ac1.converged ? t.ac1.slackMw - t.ac0.slackMw : null
  const loading = t?.ac1.converged ? t.ac1.lines.find((l) => l.id === id)?.loadingPct : undefined
  const loading0 = t?.ac0.converged ? t.ac0.lines.find((l) => l.id === id)?.loadingPct : undefined
  const others = t ? t.rows.filter((r) => r.id !== id && r.inService && r.ac0 !== null && r.ac1 !== null) : []
  const biggest = others.reduce<(typeof others)[number] | null>((w, r) => (!w || Math.abs(r.ac1! - r.ac0!) > Math.abs(w.ac1! - w.ac0!) ? r : w), null)
  const fromName = line ? c.buses[line.from].name : ''
  const toName = line ? c.buses[line.to].name : ''
  return (
    <section className="ps-card ps-stack" aria-labelledby="ps-lfm-pst">
      <h3 id="ps-lfm-pst">Phase-shifting transformer: steering active power</h3>
      <p>
        Two paths in parallel share power in inverse proportion to their reactance — the operator cannot choose the split. A <b>phase-shifting transformer</b> (PST) in series with one path adds a
        controllable angle φ to that path’s voltage, so it can push power into the path or out of it. Inside, a series winding injects a small voltage in quadrature with the line voltage.
      </p>
      <PredictFirst
        question={`On the unmodified ${base.short} system, a PST in line 1–3 is set to +10° (pushing power from bus 1 towards bus 3). What happens to the flow on line 1–2?`}
        options={[
          { id: 'up', label: 'It rises' },
          { id: 'down', label: 'It falls' },
          { id: 'same', label: 'Nothing — the PST only acts on its own line' },
        ]}
        answer={pAns}
        why={
          <p>
            Line 1–2 goes from {fx(r12.ac0 ?? 0, 1)} to {fx(r12.ac1 ?? 0, 1)} MW. The loads have not changed, so extra power pushed through line 1–3 must come out of the other paths: the shift drives
            a flow round the loop, adding to the PST’s line and subtracting from the parallel path.
          </p>
        }
      >
        <div className="ps-stack">
          <div className="ps-lfm-pstctl">
            <div>
              <Seg label="PST in line" value={id} onChange={(v) => set({ pstLine: v })} options={lines.map((l) => ({ id: l.id, label: l.id }))} />
              <p className="small muted">
                {line ? `At the ${fromName} end; positive φ pushes power from ${fromName} towards ${toName}.` : `Line ${state.pstLine} is out of service — choose another line.`}
              </p>
            </div>
            <Slider label="Phase shift φ" value={phi} min={-20} max={20} step={0.5} unit="°" decimals={1} onChange={(v) => set({ phiDeg: v })} hint="0° = no shift (the ordinary network)" />
            <button type="button" className="text-btn" onClick={() => set({ phiDeg: 0 })} disabled={phi === 0}>
              Set φ = 0
            </button>
          </div>
          {!line || !t ? null : !t.ac1.converged || !t.ac0.converged ? (
            <Callout tone="bad" title="No AC operating point">
              <p>{!t.ac0.converged ? t.ac0.error : t.ac1.error} The DC model below still applies.</p>
            </Callout>
          ) : (
            <Readouts
              label="The phase shifter's effect"
              items={[
                {
                  label: `Line ${id}, AC`,
                  value: fx(self!.ac1!, 1),
                  unit: 'MW',
                  note: `${fx(self!.ac0!, 1)} MW at φ = 0${loading !== undefined && loading0 !== undefined ? ` · loading ${fx(loading0, 0)} → ${fx(loading, 0)} %` : ''}`,
                },
                { label: 'Change, AC (complex tap)', value: `${dAc! >= 0 ? '+' : ''}${fx(dAc!, 1)}`, unit: 'MW' },
                {
                  label: 'Change, DC (±φ/x injections)',
                  value: `${dDc >= 0 ? '+' : ''}${fx(dDc, 1)}`,
                  unit: 'MW',
                  note: t.sens && Number.isFinite(t.sens.xRest) ? `${fx(t.sens.mwPerDeg, 2)} MW per degree` : undefined,
                },
                { label: 'Slack generation change', value: `${slackChange! >= 0 ? '+' : ''}${fx(slackChange!, 2)}`, unit: 'MW', note: 'only the losses change' },
              ]}
            />
          )}
          {line && t && t.sens && !Number.isFinite(t.sens.xRest) && (
            <Callout tone="warn" title="No parallel path">
              <p>Line {id} is the only connection between its two buses here, so no phase shift can change its flow — the power has nowhere else to go.</p>
            </Callout>
          )}
          {line && t && (
            <div className="ps-lfm-plotrow">
              <Plot
                label={`Active power on line ${id} against the phase shift`}
                series={[
                  { id: 'ac', label: 'AC', color: 'var(--accent)', points: sweep.filter((p) => p.acMw !== null).map((p) => [p.phiDeg, p.acMw!] as [number, number]) },
                  { id: 'dc', label: 'DC', color: 'var(--warning)', points: sweep.map((p) => [p.phiDeg, p.dcMw] as [number, number]), dashed: true },
                ]}
                xLabel="Phase shift φ [°]"
                yLabel={`P on line ${id} [MW]`}
                xDomain={[-20, 20]}
                vlines={[{ x: phi, label: `φ = ${fx(phi, 1)}°` }]}
                height={240}
              />
              <div className="table-wrap ps-lfm-psttable">
                <table className="ps-table">
                  <caption className="sr-only">Line flows without and with the phase shifter</caption>
                  <thead>
                    <tr>
                      <th scope="col">Line</th>
                      <th scope="col">AC, φ = 0</th>
                      <th scope="col">AC, φ = {fx(phi, 1)}°</th>
                      <th scope="col">Δ AC</th>
                      <th scope="col">Δ DC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.rows.map((r) => (
                      <tr key={r.id} className={!r.inService ? 'is-out' : r.id === id ? 'is-pst' : ''}>
                        <td>
                          {r.id}
                          {r.id === id && <span className="ps-lfm-tag"> PST</span>}
                        </td>
                        {r.inService ? (
                          <>
                            <td>{r.ac0 === null ? '—' : fx(r.ac0, 1)}</td>
                            <td>{r.ac1 === null ? '—' : fx(r.ac1, 1)}</td>
                            <td>{r.ac0 === null || r.ac1 === null ? '—' : `${r.ac1 - r.ac0 >= 0 ? '+' : ''}${fx(r.ac1 - r.ac0, 1)}`}</td>
                            <td>{`${r.dc1 - r.dc0 >= 0 ? '+' : ''}${fx(r.dc1 - r.dc0, 1)}`}</td>
                          </>
                        ) : (
                          <td colSpan={4} className="muted">
                            out
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="small muted">MW entering each line at its first-named bus.</p>
              </div>
            </div>
          )}
          {line && t && phi !== 0 && dAc !== null && biggest && (
            <p>
              φ = {fx(phi, 1)}° moves {fx(Math.abs(dAc), 1)} MW {dAc >= 0 ? 'into' : 'out of'} line {id}; the largest change elsewhere is on line {biggest.id} (
              {biggest.ac1! - biggest.ac0! >= 0 ? '+' : ''}
              {fx(biggest.ac1! - biggest.ac0!, 1)} MW). The DC model predicts {dDc >= 0 ? '+' : ''}
              {fx(dDc, 1)} MW for line {id} — {fx(Math.abs(dDc - dAc), 1)} MW from the AC result.
            </p>
          )}
          <details className="ps-more" open={level !== 'beginner'}>
            <summary>The equations, and the sign convention</summary>
            <Eq
              expr="P_ik = (|V_i||V_k| / x)·sin(θ_i − θ_k + φ)"
              where={[
                ['φ', 'phase shift of the PST at the bus-i end; positive φ advances the line-side voltage, pushing power from i to k', 'rad'],
                ['x', 'series reactance of the line (the PST is taken as ideal, with no reactance of its own)', 'pu'],
              ]}
              assume="a lossless line; the PST is ideal (no impedance of its own), |tap| = 1"
            />
            <p className="small">
              AC model (used for the AC numbers): the ideal shifter makes the line-side voltage V_i·e^(jφ), so only two Y_bus entries change: Y_ik = −y·e^(−jφ), Y_ki = −y·e^(+jφ) — Y_bus is no longer
              symmetric.
            </p>
            <Eq
              expr="DC:  B′·θ = P − P_φ,   P_φ,i = +φ/x,  P_φ,k = −φ/x        loop:  ΔP = φ / (x + X_rest)"
              where={[
                [
                  'P_φ',
                  'the PST’s known part moved to the right-hand side: +φ/x at bus i, −φ/x at bus k. Equivalently, the network without the PST with extra injections −P_φ (−φ/x at i, +φ/x at k)',
                  'pu',
                ],
                ['X_rest', 'reactance between buses i and k through the rest of the network; for a single loop, the sum of the other branches’ x', 'pu'],
              ]}
            />
            {t?.sens && Number.isFinite(t.sens.xRest) && (
              <p className="small muted">
                Line {id}: x = {fx(t.sens.x, 4)} pu, X_rest = {fx(t.sens.xRest, 4)} pu, so ΔP = φ/(x + X_rest) = {fx(t.sens.mwPerDeg, 2)} MW per degree in the DC model.
              </p>
            )}
          </details>
        </div>
      </PredictFirst>
    </section>
  )
}

// ── Learn: a pointer to the section ────────────────────────────────────────────────────────────────────────────

export function MethodsTeaser({ onOpen }: { onOpen(): void }) {
  return (
    <section className="ps-card ps-lfm-teaser" aria-labelledby="ps-lfm-teaser">
      <h3 id="ps-lfm-teaser">Beyond Newton–Raphson</h3>
      <p>
        Real grids are solved thousands of times a day, so engineers also use cheaper methods: the <b>fast decoupled</b> load flow (constant matrices, more but cheaper iterations), the{' '}
        <b>DC load flow</b> (one linear solve, active power only), and they steer flows with <b>phase-shifting transformers</b>.
      </p>
      <button type="button" className="text-btn" onClick={onOpen}>
        Open: fast decoupled, DC load flow and phase shifters →
      </button>
    </section>
  )
}
