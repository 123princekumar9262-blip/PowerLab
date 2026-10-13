import { useMemo, type ReactNode } from 'react'
import { abs, sub, type Complex } from '../../engine/complex.ts'
import type { BusType, LfBus } from '../../network/loadflow.ts'
import { ybusFromImpedances } from '../../network/ybus.ts'
import { cx, fx, sg } from '../../ui/format.ts'
import { Callout, Eq, Readouts, Slider } from '../../ui/kit.tsx'
import { Plot } from '../../ui/Plot.tsx'
import type { CaseSolution } from './analysis.ts'
import { gaussSeidel } from './gaussSeidel.ts'
import type { NrRun } from './stepwise.ts'
import { activeLines, type LfCase } from './systems.ts'
import { nonZeros, type YStep } from './ybusSteps.ts'

/* The building blocks of Explore (and parts of Learn / Verify): the matrix display, the Y_bus builder, the
 * Newton–Raphson iteration stepper, the Gauss–Seidel comparison and the results tables. */

const SUBS = '₀₁₂₃₄₅₆₇₈₉'
/** Bus number as a subscript (1-based). */
export const sb = (i: number) =>
  String(i + 1)
    .split('')
    .map((d) => SUBS[+d])
    .join('')
export const TYPE_NAME: Record<BusType, string> = { slack: 'Slack', pv: 'PV', pq: 'PQ' }
const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
/** A small number in scientific notation, e.g. 3.1 × 10⁻¹⁰ (0 stays 0). */
export function sci(x: number, digits = 1): string {
  if (x === 0) return '0'
  if (!Number.isFinite(x)) return '—'
  const [m, e] = x.toExponential(digits).split('e')
  const exp = String(Number(e))
    .split('')
    .map((ch) => SUP[ch] ?? ch)
    .join('')
  return `${m.replace('-', '−')} × 10${exp}`
}
export const log10m = (m: number) => Math.log10(Math.max(m, 1e-16))
const TOL = 1e-8

// ── a matrix ───────────────────────────────────────────────────────────────────────────────────────────────────

export function Matrix({
  label,
  rows,
  cols,
  cell,
  changed,
  split,
  corner,
}: {
  label: string
  rows: string[]
  cols: string[]
  cell(i: number, j: number): { text: string; zero?: boolean }
  changed?: Set<string>
  /** Draw block boundaries after this many rows and columns (Jacobian J1…J4). */
  split?: number
  corner?: string
}) {
  return (
    <div className="ps-lf-matrix-wrap" role="region" aria-label={label} tabIndex={0}>
      <table className="ps-lf-matrix">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <th scope="col" className="ps-lf-corner">
              {corner ?? ''}
            </th>
            {cols.map((c, j) => (
              <th key={j} scope="col" className={split !== undefined && j === split ? 'is-split' : ''}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={split !== undefined && i === split ? 'is-split' : ''}>
              <th scope="row">{r}</th>
              {cols.map((_, j) => {
                const v = cell(i, j)
                const ch = changed?.has(`${i},${j}`)
                return (
                  <td key={j} className={`${v.zero ? 'is-zero' : ''} ${ch ? 'is-changed' : ''} ${split !== undefined && j === split ? 'is-split' : ''}`}>
                    {v.text}
                    {ch && <span className="sr-only"> (changed in this step)</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const isZero = (y: Complex) => abs(y) < 1e-12
export const yText = (y: Complex, d = 3) => (isZero(y) ? '0' : cx(y.re, y.im, d))

/** Y_bus with optional highlighted cells. */
export function YMatrix({ Y, changed, label, d }: { Y: Complex[][]; changed?: Array<[number, number]>; label: string; d?: number }) {
  const n = Y.length
  const names = Array.from({ length: n }, (_, i) => String(i + 1))
  return (
    <Matrix
      label={label}
      corner="Y"
      rows={names}
      cols={names}
      cell={(i, j) => ({ text: yText(Y[i][j], d), zero: isZero(Y[i][j]) })}
      changed={changed ? new Set(changed.map(([i, j]) => `${i},${j}`)) : undefined}
    />
  )
}

// ── the Y_bus builder ──────────────────────────────────────────────────────────────────────────────────────────

export function YbusBuilder({ c, steps, count, setCount, Yfinal }: { c: LfCase; steps: YStep[]; count: number; setCount(n: number): void; Yfinal: Complex[][] }) {
  const n = c.buses.length
  const zeroY = useMemo(() => Array.from({ length: n }, () => Array.from({ length: n }, () => ({ re: 0, im: 0 }))), [n])
  const Y = count === 0 ? zeroY : steps[count - 1].Y
  const st = count > 0 ? steps[count - 1] : null
  const d = 2
  const nz = nonZeros(Y)
  // the shared builder (network/ybus.ts) from the same data, as an independent check
  const shared = useMemo(() => {
    const lines = activeLines(c).map((l) => ({ i: l.from, k: l.to, z: { re: l.r, im: l.x }, yHalf: { re: 0, im: l.b / 2 } }))
    const Ys = ybusFromImpedances(n, lines)
    c.buses.forEach((b, i) => {
      if (b.shuntMvar) Ys[i][i] = { re: Ys[i][i].re, im: Ys[i][i].im + b.shuntMvar / c.baseMva }
    })
    return Ys
  }, [c, n])
  const diff = Math.max(...Yfinal.flatMap((r, i) => r.map((y, k) => abs(sub(y, shared[i][k])))))
  const done = count === steps.length
  const yi = (i: number, k: number) => `Y${sb(i)}${sb(k)}`
  let explain: ReactNode = (
    <p>
      Y_bus starts as an all-zero {n} × {n} matrix — no branches, no connections. Add the branches one at a time.
    </p>
  )
  if (st && st.kind === 'line') {
    const l = activeLines(c).find((x) => x.id === st.label)!
    explain = (
      <>
        <p>
          <b>Line {l.id}</b>: series admittance y = 1 / (r + jx) = 1 / ({cx(l.r, l.x, 4)}) = <b>{cx(st.y.re, st.y.im, 3)} pu</b>
          {l.b > 0 ? (
            <>
              ; half its charging at each end j·b/2 = <b>j{fx(st.yHalf.im, 4)} pu</b>
            </>
          ) : (
            ' (no line charging in this case)'
          )}
          .
        </p>
        <ul className="ps-lf-steps">
          <li>
            Diagonal: {yi(st.i, st.i)} and {yi(st.k, st.k)} each gain y{l.b > 0 ? ' + j·b/2' : ''} — every branch adds to the self-admittance of both its ends.
          </li>
          <li>
            Off-diagonal: {yi(st.i, st.k)} = {yi(st.k, st.i)} = −y = {cx(-st.y.re, -st.y.im, 3)} — the mutual admittance between the two buses (the charging does not appear here).
          </li>
        </ul>
      </>
    )
  } else if (st && st.kind === 'shunt') {
    explain = (
      <p>
        <b>Shunt capacitor at {st.label}</b>: B = Q / S_base = j{fx(st.yHalf.im, 3)} pu, added to the diagonal {yi(st.i, st.i)} only — a shunt connects a bus to earth, not to another bus.
      </p>
    )
  }
  return (
    <div className="ps-stack">
      <div className="ps-lf-builder">
        <section className="ps-card" aria-labelledby="ps-lf-bd">
          <h3 id="ps-lf-bd">Branch data (per unit, {c.baseMva} MVA base)</h3>
          <div className="table-wrap">
            <table className="ps-table ps-lf-branches">
              <thead>
                <tr>
                  <th scope="col">Element</th>
                  <th scope="col">r + jx</th>
                  <th scope="col">b (total)</th>
                  <th scope="col">y = 1/z</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((s, k) => {
                  const l = s.kind === 'line' ? activeLines(c).find((x) => x.id === s.label)! : null
                  return (
                    <tr key={s.label + k} className={`${k < count ? 'is-added' : 'is-waiting'} ${k === count - 1 ? 'is-current' : ''}`}>
                      <td>
                        <span aria-hidden="true">{k < count ? '✓ ' : '○ '}</span>
                        {s.kind === 'line' ? `Line ${s.label}` : `Capacitor, ${s.label}`}
                        {k < count ? <span className="sr-only"> (added)</span> : null}
                      </td>
                      <td>{l ? cx(l.r, l.x, 4) : '—'}</td>
                      <td>{l ? fx(l.b, 4) : fx(s.yHalf.im, 3)}</td>
                      <td>{s.kind === 'line' ? cx(s.y.re, s.y.im, 3) : `j${fx(s.yHalf.im, 3)}`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="ps-lf-buttons">
            <button type="button" className="text-btn" onClick={() => setCount(0)} disabled={count === 0}>
              Clear
            </button>
            <button type="button" className="text-btn" onClick={() => setCount(count - 1)} disabled={count === 0}>
              ← Remove last
            </button>
            <button type="button" className="btn btn--primary ps-btn-sm" onClick={() => setCount(count + 1)} disabled={done}>
              Add {count < steps.length ? (steps[count].kind === 'line' ? `line ${steps[count].label}` : 'the capacitor') : 'next'} →
            </button>
            <button type="button" className="text-btn" onClick={() => setCount(steps.length)} disabled={done}>
              Add all
            </button>
          </div>
        </section>
        <section className="ps-card ps-lf-ycard" aria-labelledby="ps-lf-ym" aria-live="polite">
          <div className="ps-toolbar">
            <h3 id="ps-lf-ym">
              Y_bus after {count} of {steps.length} {steps.length === 1 ? 'element' : 'elements'}
            </h3>
            <span className="small muted">
              G + jB, pu · non-zero entries {nz} of {n * n} ({fx((nz / (n * n)) * 100, 0)} %)
            </span>
          </div>
          <YMatrix Y={Y} changed={st?.cells} label={`Bus admittance matrix after ${count} elements`} d={d} />
          <div className="ps-lf-explain">{explain}</div>
          {st && <p className="small muted ps-lf-key">Highlighted (outlined) entries changed in this step.</p>}
        </section>
      </div>
      {done && (
        <Callout tone="good" title="Y_bus is complete">
          <p>
            Each diagonal entry is the sum of the admittances of everything connected to that bus; each off-diagonal entry is minus the admittance between two buses, and is zero where no branch joins
            them
            {nz < n * n ? ` — here ${n * n - nz} of the ${n * n} entries are zero` : ' — in this small, fully meshed case every bus is joined to every other, so nothing is zero'}. Real networks of
            thousands of buses have only a few lines per bus, so well over 99 % of Y_bus is zero, which is why load-flow programs store it sparsely.
          </p>
          <p className="small">✓ Independent check: the shared Y_bus builder used by the solver gives the same matrix (largest difference {sg(diff, 2)} pu).</p>
        </Callout>
      )}
    </div>
  )
}

// ── Newton–Raphson, iteration by iteration ─────────────────────────────────────────────────────────────────────

export function unknownLabels(angIdx: number[], magIdx: number[]) {
  return {
    eqs: [...angIdx.map((i) => `P${sb(i)}`), ...magIdx.map((i) => `Q${sb(i)}`)],
    vars: [...angIdx.map((i) => `θ${sb(i)}`), ...magIdx.map((i) => `|V${sb(i)}|`)],
  }
}

const rad2deg = (r: number) => (r * 180) / Math.PI

export function NrStepper({ c, run, idx, setIdx, lb }: { c: LfCase; run: NrRun; idx: number; setIdx(i: number): void; lb: LfBus[] }) {
  const rec = run.records[idx]
  const next = run.records[idx + 1]
  const last = idx === run.records.length - 1
  const { eqs, vars } = unknownLabels(rec.angIdx, rec.magIdx)
  const nAng = rec.angIdx.length
  const S = c.baseMva
  const maxRow = [...rec.dP, ...rec.dQ].reduce((m, v, j, a) => (Math.abs(v) > Math.abs(a[m]) ? j : m), 0)
  const status = rec.J
    ? `Iteration ${rec.k}: largest mismatch ${sg(rec.mismatch, 3)} pu — not yet below 10⁻⁸ pu, so correct the unknowns.`
    : run.converged && last
      ? `Converged: after ${run.iterations} ${run.iterations === 1 ? 'iteration' : 'iterations'} the largest mismatch is ${sg(rec.mismatch, 2)} pu (< 10⁻⁸ pu).`
      : rec.mismatch < TOL
        ? `Mismatch below 10⁻⁸ pu at iteration ${rec.k} — then the generator limits are checked.`
        : `Stopped: ${run.error ?? 'no further iteration.'}`
  const series = [
    {
      id: 'nr',
      label: 'NR',
      color: 'var(--accent)',
      points: run.records.slice(0, idx + 1).map((r, j) => [j, log10m(r.mismatch)] as [number, number]),
    },
  ]
  return (
    <div className="ps-stack">
      <div className="ps-card ps-lf-nrbar">
        <div className="ps-lf-buttons">
          <button type="button" className="text-btn" onClick={() => setIdx(0)} disabled={idx === 0}>
            Restart (flat start)
          </button>
          <button type="button" className="text-btn" onClick={() => setIdx(idx - 1)} disabled={idx === 0}>
            ← Previous
          </button>
          <button type="button" className="btn btn--primary ps-btn-sm" onClick={() => setIdx(idx + 1)} disabled={last}>
            Next iteration →
          </button>
          <button type="button" className="text-btn" onClick={() => setIdx(run.records.length - 1)} disabled={last}>
            Run to the end
          </button>
        </div>
        <p className={`ps-lf-status ${run.converged && last ? 'is-done' : !run.converged && last ? 'is-bad' : ''}`} aria-live="polite">
          {status}
        </p>
      </div>
      {rec.event && (
        <Callout tone="warn" title="A generator reached its reactive limit">
          <p>The solution above holds every PV voltage — but {rec.event}. Newton–Raphson continues from here with one more unknown (that bus’s |V|) and one more equation (its Q).</p>
        </Callout>
      )}
      <div className="ps-lf-nrgrid">
        <section className="ps-card" aria-labelledby="ps-lf-st">
          <h3 id="ps-lf-st">{idx === 0 ? 'Start: the flat start' : `State after iteration ${rec.k}`}</h3>
          <table className="ps-table">
            <thead>
              <tr>
                <th scope="col">Bus</th>
                <th scope="col">Type</th>
                <th scope="col">|V| pu</th>
                <th scope="col">θ °</th>
              </tr>
            </thead>
            <tbody>
              {c.buses.map((b, i) => (
                <tr key={i}>
                  <td>{b.tag}</td>
                  <td>{TYPE_NAME[rec.types[i]]}</td>
                  <td className={rec.magIdx.includes(i) ? 'is-unknown' : ''}>{fx(rec.Vm[i], 5)}</td>
                  <td className={rec.angIdx.includes(i) ? 'is-unknown' : ''}>{fx(rad2deg(rec.th[i]), 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">Bold values are unknowns; the rest are specified.</p>
        </section>
        <section className="ps-card" aria-labelledby="ps-lf-mm">
          <h3 id="ps-lf-mm">Mismatch: specified − calculated</h3>
          <table className="ps-table">
            <thead>
              <tr>
                <th scope="col">Eq.</th>
                <th scope="col">Spec.</th>
                <th scope="col">Calc.</th>
                <th scope="col">Δ pu</th>
              </tr>
            </thead>
            <tbody>
              {rec.angIdx.map((i, j) => (
                <tr key={`p${i}`} className={maxRow === j ? 'is-max' : ''}>
                  <td>ΔP{sb(i)}</td>
                  <td>{fx(lb[i].p, 4)}</td>
                  <td>{fx(rec.P[i], 4)}</td>
                  <td>
                    {sg(rec.dP[j], 4)}
                    {maxRow === j && <span className="ps-lf-tagmax"> largest</span>}
                  </td>
                </tr>
              ))}
              {rec.magIdx.map((i, j) => (
                <tr key={`q${i}`} className={maxRow === nAng + j ? 'is-max' : ''}>
                  <td>ΔQ{sb(i)}</td>
                  <td>{fx(rec.Q[i] + rec.dQ[j], 4)}</td>
                  <td>{fx(rec.Q[i], 4)}</td>
                  <td>
                    {sg(rec.dQ[j], 4)}
                    {maxRow === nAng + j && <span className="ps-lf-tagmax"> largest</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">Spec. = net injection (generation − load) / {S} MVA.</p>
        </section>
        <section className="ps-card" aria-labelledby="ps-lf-cr">
          <h3 id="ps-lf-cr">Correction J⁻¹·Δ</h3>
          {rec.dx && next ? (
            <table className="ps-table">
              <thead>
                <tr>
                  <th scope="col">Unknown</th>
                  <th scope="col">Correction</th>
                  <th scope="col">New value</th>
                </tr>
              </thead>
              <tbody>
                {rec.angIdx.map((i, j) => (
                  <tr key={`t${i}`}>
                    <td>θ{sb(i)}</td>
                    <td>{sg(rad2deg(rec.dx![j]), 4)}°</td>
                    <td>{fx(rad2deg(next.th[i]), 4)}°</td>
                  </tr>
                ))}
                {rec.magIdx.map((i, j) => (
                  <tr key={`v${i}`}>
                    <td>|V{sb(i)}|</td>
                    <td>Δ|V|/|V| = {sg(rec.dx![nAng + j], 4)}</td>
                    <td>{fx(next.Vm[i], 5)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">
              {run.converged && last ? 'None needed — the equations are satisfied.' : rec.mismatch < TOL ? 'None at this state; the limits are checked next.' : 'No correction could be computed.'}
            </p>
          )}
          <p className="small muted">θ ← θ + Δθ; |V| ← |V|·(1 + Δ|V|/|V|).</p>
        </section>
      </div>
      {rec.J && (
        <details className="ps-card ps-lf-jac">
          <summary>
            The Jacobian at this iteration ({eqs.length} × {eqs.length}: J1…J4)
          </summary>
          <p className="small">
            Each entry is how strongly one calculated injection responds to one unknown at the present state. The four blocks: J1 = ∂P/∂θ (large — active power follows angle), J2 = |V|·∂P/∂|V|, J3 =
            ∂Q/∂θ, J4 = |V|·∂Q/∂|V| (large — reactive power follows voltage magnitude).
          </p>
          <Matrix label={`Jacobian at iteration ${rec.k}`} rows={eqs} cols={vars} corner="J" split={nAng} cell={(i, j) => ({ text: fx(rec.J![i][j], 3), zero: Math.abs(rec.J![i][j]) < 1e-12 })} />
          <p className="ps-lf-jeq">[ΔP; ΔQ] = [J1 J2; J3 J4] · [Δθ; Δ|V|/|V|]</p>
          <table className="ps-table ps-lf-jform">
            <caption className="sr-only">Jacobian entries</caption>
            <thead>
              <tr>
                <th scope="col">Block</th>
                <th scope="col">Off-diagonal (k ≠ i)</th>
                <th scope="col">Diagonal (k = i)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>J1 = ∂P_i/∂θ_k</td>
                <td>|V_i||V_k|(G_ik sin θ_ik − B_ik cos θ_ik)</td>
                <td>−Q_i − B_ii|V_i|²</td>
              </tr>
              <tr>
                <td>J2 = |V_k|·∂P_i/∂|V_k|</td>
                <td>|V_i||V_k|(G_ik cos θ_ik + B_ik sin θ_ik)</td>
                <td>P_i + G_ii|V_i|²</td>
              </tr>
              <tr>
                <td>J3 = ∂Q_i/∂θ_k</td>
                <td>−|V_i||V_k|(G_ik cos θ_ik + B_ik sin θ_ik)</td>
                <td>P_i − G_ii|V_i|²</td>
              </tr>
              <tr>
                <td>J4 = |V_k|·∂Q_i/∂|V_k|</td>
                <td>|V_i||V_k|(G_ik sin θ_ik − B_ik cos θ_ik)</td>
                <td>Q_i − B_ii|V_i|²</td>
              </tr>
            </tbody>
          </table>
          <p className="small muted">
            Polar form, θ_ik = θ_i − θ_k. The |V| columns are scaled by |V|, so the unknown is the relative change Δ|V|/|V|. Dashed lines in the matrix separate the blocks.
          </p>
        </details>
      )}
      <div className="ps-lf-plotrow">
        <Plot
          label="Largest mismatch against iteration (log scale)"
          series={series}
          xLabel="Iteration"
          yLabel="log₁₀ largest mismatch [pu]"
          xDomain={[0, Math.max(4, run.records.length - 1)]}
          yDomain={[-16, 2]}
          hlines={[{ y: -8, label: 'tolerance 10⁻⁸ pu' }]}
          height={220}
        />
        <div className="ps-card ps-lf-history">
          <h3>Mismatch so far</h3>
          <ol className="ps-lf-histlist">
            {run.records.slice(0, idx + 1).map((r, j) => (
              <li key={j}>
                <span className="muted">{j === 0 ? 'start' : `it. ${r.k}`}</span> <b>{sci(r.mismatch, 2)}</b>
              </li>
            ))}
          </ol>
          <p className="small muted">Close to the solution the number of correct digits roughly doubles each iteration — quadratic convergence.</p>
        </div>
      </div>
    </div>
  )
}

// ── Gauss–Seidel compared ──────────────────────────────────────────────────────────────────────────────────────

const ALPHAS = Array.from({ length: 19 }, (_, k) => +(1 + k * 0.05).toFixed(2))

export function GsCompare({ c, Y, lb, nr, alpha, setAlpha }: { c: LfCase; Y: Complex[][]; lb: LfBus[]; nr: NrRun; alpha: number; setAlpha(a: number): void }) {
  const gs = useMemo(() => gaussSeidel(Y, lb, { alpha }), [Y, lb, alpha])
  const sweep = useMemo(() => ALPHAS.map((a) => ({ a, r: gaussSeidel(Y, lb, { alpha: a, maxIter: 400 }) })), [Y, lb])
  const best = sweep.filter((s) => s.r.converged).reduce<(typeof sweep)[number] | null>((b, s) => (!b || s.r.iterations < b.r.iterations ? s : b), null)
  const diff = gs.converged && nr.converged ? Math.max(...gs.V.map((v, i) => abs(sub(v, nr.V[i])))) : NaN
  const xMax = Math.max(gs.history.length - 1, nr.history.length - 1, 4)
  return (
    <div className="ps-stack">
      <div className="ps-lf-gsrow">
        <section className="ps-card" aria-labelledby="ps-lf-gs">
          <h3 id="ps-lf-gs">Gauss–Seidel on the same system</h3>
          <Eq
            expr="V_i ← (1/Y_ii)·[ (P_i − jQ_i)/V_i* − Σ_{k≠i} Y_ik·V_k ]"
            where={[
              ['V_i*', 'complex conjugate of the latest V_i', 'pu'],
              ['α', 'acceleration: V_i ← V_i,old + α·(V_i,new − V_i,old)'],
            ]}
            assume="each bus uses the newest voltages of the others; a PV bus first gets Q_i from the present voltages, then its |V| is reset to the set-point"
          />
          <Slider label="Acceleration factor α" value={alpha} min={1} max={1.9} step={0.05} decimals={2} onChange={setAlpha} hint="1 = plain Gauss–Seidel" />
        </section>
        <Readouts
          label="Gauss–Seidel against Newton–Raphson"
          items={[
            { label: 'Newton–Raphson', value: nr.converged ? String(nr.iterations) : '—', unit: 'iterations' },
            {
              label: 'Gauss–Seidel',
              value: gs.converged ? String(gs.iterations) : 'none',
              unit: gs.converged ? 'iterations' : '',
              note: `acceleration ${fx(alpha, 2)}${gs.converged ? '' : ' — no convergence'}`,
              tone: gs.converged ? undefined : 'bad',
            },
            {
              label: 'Best acceleration',
              value: best ? fx(best.a, 2) : '—',
              note: best ? `${best.r.iterations} iterations (tried 1.00–1.90)` : undefined,
            },
            {
              label: 'Same solution?',
              value: Number.isFinite(diff) ? (diff < 1e-6 ? 'yes' : 'no') : '—',
              note: Number.isFinite(diff) ? `largest voltage difference ${diff < 1e-12 ? '< 10⁻¹²' : diff.toExponential(1).replace('-', '−')} pu` : undefined,
              tone: diff < 1e-6 ? 'good' : undefined,
            },
          ]}
        />
      </div>
      <div className="ps-lf-plotcard">
        <Plot
          label="Convergence of Newton–Raphson and Gauss–Seidel"
          series={[
            { id: 'nr', label: 'NR', color: 'var(--accent)', points: nr.history.map((m, k) => [k, log10m(m)]) },
            { id: 'gs', label: 'GS', color: 'var(--warning)', points: gs.history.map((m, k) => [k, log10m(m)]) },
          ]}
          xLabel="Iteration"
          yLabel="log₁₀ largest mismatch [pu]"
          xDomain={[0, xMax]}
          yDomain={[Math.min(-10, Math.floor(Math.min(...nr.history.map(log10m), ...gs.history.map(log10m))) - 1), 1]}
          hlines={[{ y: -8, label: 'tolerance' }]}
          height={260}
        />
        <div className="ps-card">
          <h3>Why so different?</h3>
          <p>
            Each Gauss–Seidel sweep is cheap — one bus at a time, no matrix to factorise — but a correction spreads only to neighbouring buses each sweep, so convergence is linear: a roughly constant
            fraction of the error is removed each time (a straight line on this log scale). Newton–Raphson solves for all the corrections at once with the Jacobian and converges quadratically (a line
            that bends ever more steeply down).
          </p>
        </div>
      </div>
      <div className="ps-lf-plotcard">
        <Plot
          label="Gauss–Seidel iterations against acceleration factor"
          series={[{ id: 'it', label: 'GS', color: 'var(--warning)', points: sweep.filter((s) => s.r.converged).map((s) => [s.a, s.r.iterations]) }]}
          xLabel="Acceleration factor α"
          yLabel="Iterations to 10⁻⁸ pu"
          xDomain={[1, 1.9]}
          vlines={[{ x: alpha, label: `α = ${fx(alpha, 2)}` }]}
          height={260}
        />
        <div className="ps-card">
          <h3>Choosing the acceleration factor</h3>
          <p>
            Plain Gauss–Seidel (α = 1) needs {sweep[0].r.converged ? sweep[0].r.iterations : 'more than 400'} iterations here
            {best ? `; the best α in 1.00–1.90 is ${fx(best.a, 2)}, with ${best.r.iterations}` : ''}. A larger α pushes each correction further in the direction it is already going; too large and it
            overshoots, and the count rises again{sweep.some((s) => !s.r.converged) ? ' (missing points did not converge within 400 iterations)' : ''}. The best value depends on the network.
          </p>
        </div>
      </div>
      <details className="ps-card">
        <summary>The first Gauss–Seidel sweeps (α = {fx(alpha, 2)})</summary>
        <div className="table-wrap">
          <table className="ps-table">
            <thead>
              <tr>
                <th scope="col">Sweep</th>
                {c.buses.map((b, i) =>
                  b.type === 'slack' ? null : (
                    <th key={i} scope="col">
                      V{sb(i)}
                    </th>
                  ),
                )}
                <th scope="col">Largest mismatch</th>
              </tr>
            </thead>
            <tbody>
              {gs.trace.map((V, k) => (
                <tr key={k}>
                  <td>{k === 0 ? 'start' : k}</td>
                  {V.map((v, i) => (c.buses[i].type === 'slack' ? null : <td key={i}>{cx(v.re, v.im, 4)}</td>))}
                  <td>{sci(gs.history[k], 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

// ── results ────────────────────────────────────────────────────────────────────────────────────────────────────

export function Results({ sol }: { sol: CaseSolution }) {
  const c = sol.case
  const t = sol.totals
  const balance = t.pGen - t.pLoad - t.pLoss
  const qBalance = t.qGen + t.qShunt - t.qLoad - t.qLoss
  return (
    <div className="ps-stack">
      <Readouts
        label="Power balance"
        items={[
          { label: 'Generation', value: fx(t.pGen, 2), unit: 'MW', note: `${fx(t.qGen, 2)} Mvar` },
          { label: 'Load', value: fx(t.pLoad, 2), unit: 'MW', note: `${fx(t.qLoad, 2)} Mvar` },
          { label: 'Line losses', value: fx(t.pLoss, 3), unit: 'MW', note: `${fx((t.pLoss / t.pGen) * 100, 2)} % of generation` },
          {
            label: 'Gen − load − losses',
            value: fx(balance, 4),
            unit: 'MW',
            tone: Math.abs(balance) < 1e-6 ? 'good' : 'bad',
            note: Math.abs(balance) < 1e-6 ? 'balanced (within 10⁻⁶ MW)' : 'not balanced',
          },
          { label: 'Iterations', value: String(sol.iterations), note: 'Newton–Raphson, shared solver' },
        ]}
      />
      <div className="ps-stack ps-lf-results">
        <section className="ps-card" aria-labelledby="ps-lf-rb">
          <h3 id="ps-lf-rb">Buses</h3>
          <div className="table-wrap">
            <table className="ps-table">
              <thead>
                <tr>
                  <th scope="col">Bus</th>
                  <th scope="col">Type</th>
                  <th scope="col">|V| pu</th>
                  <th scope="col">θ °</th>
                  <th scope="col">P_G MW</th>
                  <th scope="col">Q_G Mvar</th>
                  <th scope="col">Load MW + jMvar</th>
                </tr>
              </thead>
              <tbody>
                {sol.bus.map((b, i) => (
                  <tr key={i}>
                    <td>
                      {c.buses[i].tag} {c.buses[i].name !== `Bus ${c.buses[i].tag}` ? c.buses[i].name : ''}
                    </td>
                    <td>
                      {b.atQLimit ? 'PV→PQ' : TYPE_NAME[b.type]}
                      {b.atQLimit && <span className="sr-only"> (held at its reactive limit)</span>}
                    </td>
                    <td>{fx(b.vm, 4)}</td>
                    <td>{fx(b.thDeg, 3)}</td>
                    <td>{c.buses[i].type === 'pq' ? '—' : fx(b.pGenMw, 2)}</td>
                    <td>{c.buses[i].type === 'pq' ? (b.qShuntMvar ? `C ${fx(b.qShuntMvar, 1)}` : '—') : fx(b.qGenMvar, 2)}</td>
                    <td>{b.pLoadMw || b.qLoadMvar ? `${fx(b.pLoadMw, 1)} + j${fx(b.qLoadMvar, 1)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="ps-card" aria-labelledby="ps-lf-rl">
          <h3 id="ps-lf-rl">Lines — flow into the line at each end</h3>
          <div className="table-wrap">
            <table className="ps-table">
              <thead>
                <tr>
                  <th scope="col">Line i–k</th>
                  <th scope="col">S_ik MW + jMvar</th>
                  <th scope="col">S_ki MW + jMvar</th>
                  <th scope="col">Loss MW</th>
                  <th scope="col">Mvar</th>
                  {sol.lines.some((l) => l.loadingPct !== undefined) && <th scope="col">Load %</th>}
                </tr>
              </thead>
              <tbody>
                {sol.lines.map((l) => (
                  <tr key={l.id} className={!l.inService ? 'is-out' : ''}>
                    <td>{l.id}</td>
                    {l.inService ? (
                      <>
                        <td>{cx(l.pFromMw, l.qFromMvar, 1)}</td>
                        <td>{cx(l.pToMw, l.qToMvar, 1)}</td>
                        <td>{fx(l.lossMw, 3)}</td>
                        <td>{fx(l.lossMvar, 2)}</td>
                        {l.loadingPct !== undefined && <td className={l.loadingPct > 100 ? 'ps-lf-over' : ''}>{fx(l.loadingPct, 0)}</td>}
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
            Loss = S_ik + S_ki (what goes in at both ends and does not come out).
            {t.qCharging > 0 && ` The lines’ charging produces ${fx(t.qCharging, 1)} Mvar, so a lightly loaded line has a negative Mvar loss.`}
          </p>
        </section>
      </div>
      <p className="small muted">
        Reactive balance: generation {fx(t.qGen, 2)} {t.qShunt ? `+ capacitors ${fx(t.qShunt, 2)} ` : ''}− load {fx(t.qLoad, 2)} − line Mvar losses ({fx(t.qLoss, 2)}) = {fx(qBalance, 4)} Mvar.
        {c.id === 'five' && ` Line loading is against an assumed ${c.lines[0].ratingMva} MVA thermal rating.`}
      </p>
    </div>
  )
}
