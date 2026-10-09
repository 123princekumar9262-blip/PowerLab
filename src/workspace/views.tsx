import { useState, type ReactNode } from 'react'
import type { Level } from '../shell/prefs.ts'
import { formatSI, formatTime, formatW } from '../utils/format.ts'
import { carryIsEmpty, type CarryReport } from './carry.ts'
import type { AnalysisCategory, ComponentInspection, CurrentPath, EnergyModel, NextConsequence, StatusInfo, WhyQuestion, WorkspaceEvent } from './contract.ts'

/*
 * The shell's generic views. Each renders one contract shape (contract.ts) that a lab adapter produced from
 * its simulation; none computes a physical value.
 */

// ── Change circuit: which values were kept ──────────────────────────────────

export function CarryNotice({ report, onDismiss }: { report: CarryReport | null | undefined; onDismiss(): void }) {
  if (carryIsEmpty(report)) return null
  return (
    <p className="wv-notice small" role="status">
      {report!.kept.length > 0 && (
        <span>
          <b>Kept from the previous circuit:</b> {report!.kept.join(', ')}.
        </span>
      )}
      {report!.notUsed.length > 0 && (
        <span>
          <b>Not used here (remembered):</b> {report!.notUsed.join(', ')}.
        </span>
      )}
      <button className="text-btn" onClick={onDismiss}>
        Got it
      </button>
    </p>
  )
}

// ── Status line (+ the current path when it is shown) ───────────────────────

export function StatusLine({ status, time, path, onOpen }: { status: StatusInfo; time: string; path?: CurrentPath | null; onOpen?(): void }) {
  const body = (
    <>
      <span className={`wp-dot wp-dot--${status.tone ?? 'neutral'}`} aria-hidden="true" />
      <b className="wp-headline">{status.headline}</b>
      {status.facts.map((f) => (
        <span key={f} className="wp-fact">
          {f}
        </span>
      ))}
      <span className="wp-time">{time}</span>
    </>
  )
  return (
    <div className="wp-status">
      {onOpen ? (
        <button className="wp-status-line" onClick={onOpen} title="Details of this instant" aria-label={`${status.headline}, ${status.facts.join(', ')} — details`}>
          {body}
        </button>
      ) : (
        <p className="wp-status-line">{body}</p>
      )}
      {path && (
        <div className="wp-path small">
          <b>Current path</b> {path.text || 'no current flows'}
          {path.reasons.length > 0 && (
            <details className="wp-path-why">
              <summary>Why this path?</summary>
              <ul>
                {path.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

// ── WHY: What → Why → Physical principle → What happens next ────────────────

export function WhyView({ questions, next, onGoTo, detailed, extra }: { questions: WhyQuestion[]; next: NextConsequence | null; onGoTo?(time: number): void; detailed: boolean; extra?: ReactNode }) {
  const [id, setId] = useState(questions[0]?.id ?? '')
  const [more, setMore] = useState(detailed)
  const q = questions.find((x) => x.id === id) ?? questions[0]
  if (!q) return <p className="muted small">No explanation for this instant.</p>
  return (
    <section className="wv-why" aria-label="Why">
      {questions.length > 1 ? (
        <div className="wv-questions" role="group" aria-label="Questions">
          {questions.map((x) => (
            <button key={x.id} className={`why-q ${x.id === q.id ? 'on' : ''}`} aria-pressed={x.id === q.id} onClick={() => setId(x.id)}>
              {x.question}
            </button>
          ))}
        </div>
      ) : (
        <p className="wv-question">{q.question}</p>
      )}
      <dl className="wv-steps">
        <div>
          <dt>What is happening?</dt>
          <dd>{q.what}</dd>
        </div>
        <div>
          <dt>Why?</dt>
          <dd>{q.why}</dd>
        </div>
        <div>
          <dt>Physical principle</dt>
          <dd>
            {q.principle}
            {q.equation && <span className="chain-eq wv-eq">{q.equation}</span>}
          </dd>
        </div>
        {next && (
          <div className="why-next">
            <dt>What happens next?</dt>
            <dd>
              {next.text}
              {next.time !== null && onGoTo && (
                <button className="text-btn wv-goto" onClick={() => onGoTo(next.time!)}>
                  Go to t = {formatTime(next.time)} →
                </button>
              )}
            </dd>
          </div>
        )}
      </dl>
      {(q.more?.length || extra) && (
        <>
          <button className="text-btn wv-more-btn" aria-expanded={more} onClick={() => setMore(!more)}>
            {more ? 'Less detail' : 'More detail'}
          </button>
          {more && (
            <div className="wv-more">
              {q.more?.map((m) => (
                <p key={m}>{m}</p>
              ))}
              {extra}
            </div>
          )}
        </>
      )}
      <p className="muted small">Read from the simulated state at the cursor — move the cursor and the answer follows the circuit.</p>
    </section>
  )
}

// ── Inspect ─────────────────────────────────────────────────────────────────

export function InspectorView({ parts, selected, info, onPick, onWhy }: { parts: Array<{ id: string; label: string }>; selected: string | null; info: ComponentInspection | null; onPick(id: string): void; onWhy?(): void }) {
  return (
    <div className="wp-inspect">
      {parts.length > 0 && (
        <div className="wp-parts" role="group" aria-label="Component">
          {parts.map((p) => (
            <button key={p.id} className={`chip-btn ${selected === p.id ? 'on' : ''}`} aria-pressed={selected === p.id} onClick={() => onPick(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      {info ? (
        <section className="wv-inspect" aria-label={`Inspector: ${info.title}`}>
          <h3>{info.title}</h3>
          <p className="small muted">{info.kind}</p>
          {info.state && <p className="wv-state">{info.state}</p>}
          <dl className="inspect-rows">
            {info.rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {info.why && <p className="small wv-inspect-why">{info.why}</p>}
          {onWhy && (
            <button className="text-btn" onClick={onWhy}>
              Why? →
            </button>
          )}
          <p className="muted small">Values at the cursor (move it — they follow); averages and peaks over the measurement window. All from the simulation.</p>
        </section>
      ) : (
        <p className="muted small">Click a component on the circuit — or choose one above — to see what it is doing now.</p>
      )}
    </div>
  )
}

// ── Events ──────────────────────────────────────────────────────────────────

export function EventsView({ events, total, selectedId, onSelect }: { events: WorkspaceEvent[]; total: number; selectedId: string | null; onSelect(e: WorkspaceEvent): void }) {
  const cats = [...new Set(events.map((e) => e.category))]
  const [cat, setCat] = useState<string>('all')
  const list = cat === 'all' ? events : events.filter((e) => e.category === cat)
  const sel = events.find((e) => e.id === selectedId) ?? null
  return (
    <div className="wv-events">
      {sel && (
        <section className="wv-event-detail" aria-label="Selected event">
          <p className="eyebrow">
            Event · <span className="no-case">{formatTime(sel.time)}{sel.at ? ` · ${sel.at}` : ''}</span>
          </p>
          <h3>{sel.label}</h3>
          {sel.what && (
            <>
              <p className="event-q">What happened?</p>
              <p className="small">{sel.what}</p>
            </>
          )}
          {sel.why && (
            <>
              <p className="event-q">Why did it happen?</p>
              <p className="small">{sel.why}</p>
            </>
          )}
        </section>
      )}
      {cats.length > 1 && (
        <div className="seg seg--small" role="radiogroup" aria-label="Event type">
          {['all', ...cats].map((c) => (
            <button key={c} role="radio" aria-checked={cat === c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>
              {c === 'all' ? 'All' : c[0].toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
      )}
      <p className="muted small">
        {total} event{total === 1 ? '' : 's'} in the shown window{list.length < total && cat === 'all' ? ` (first ${list.length})` : ''}. Choose one to move the cursor to it.
      </p>
      <ol className="wv-event-list">
        {list.map((e) => (
          <li key={e.id}>
            <button className={`wv-event ${e.id === selectedId ? 'on' : ''}`} aria-pressed={e.id === selectedId} onClick={() => onSelect(e)}>
              <span className="wv-event-t">{formatTime(e.time)}</span>
              <span>{e.label}</span>
              {e.at && <span className="muted small">{e.at}</span>}
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ── Analyze: measurements and theory ────────────────────────────────────────

export function AnalyzeView({ categories, level, initial }: { categories: AnalysisCategory[]; level: Level; initial?: string }) {
  const [tab, setTab] = useState(initial && categories.some((c) => c.id === initial) ? initial : (categories[0]?.id ?? ''))
  const cat = categories.find((c) => c.id === tab) ?? categories[0]
  if (!cat) return null
  const eng = level === 'engineer'
  const bad = (c: AnalysisCategory) => c.rows.some((r) => r.pass === false)
  return (
    <section className="wv-analyze" aria-label="Measurements and theory">
      <div className="ws-tabs ws-tabs--scroll" role="tablist" aria-label="Analysis">
        {categories.map((c) => (
          <button key={c.id} role="tab" aria-selected={c.id === cat.id} className={c.id === cat.id ? 'on' : ''} onClick={() => setTab(c.id)}>
            {c.label}
            {bad(c) && <span className="badge-warn"> ⚠</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={cat.label} className="wv-analyze-body">
        {cat.rows.length > 0 && (
          <div className="table-wrap">
            <table className="wv-table">
              <thead>
                <tr>
                  <th scope="col">Quantity</th>
                  <th scope="col" className="num">
                    SIMULATION
                  </th>
                  <th scope="col" className="num">
                    THEORY
                  </th>
                  <th scope="col" className="num">
                    Error
                  </th>
                  {eng && <th scope="col">Formula</th>}
                </tr>
              </thead>
              <tbody>
                {cat.rows.map((r) => (
                  <tr key={r.key} className={r.pass === false ? 'row-bad' : ''}>
                    <th scope="row">{r.label}</th>
                    <td className="num">{r.simulation}</td>
                    <td className="num">{r.theory ?? <span className="muted">—</span>}</td>
                    <td className="num">
                      {r.pass === null ? (
                        <span className="muted" title={r.note}>
                          {r.note ? 'n/a' : '—'}
                        </span>
                      ) : (
                        <span className={`err ${r.pass ? 'err--ok' : 'err--bad'}`}>
                          {r.pass ? '✓' : '⚠'} {r.error ?? ''}
                        </span>
                      )}
                    </td>
                    {eng && <td className="formula">{r.formula ?? ''}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cat.assumptions && cat.assumptions.length > 0 && (
          <details className="wv-assumptions" open={eng}>
            <summary>Theory assumptions</summary>
            <ul>
              {cat.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </details>
        )}
        {cat.extra}
      </div>
    </section>
  )
}

// ── Energy ──────────────────────────────────────────────────────────────────

export function EnergyView({ model }: { model: EnergyModel }) {
  const scale = Math.max(1e-12, ...model.ledger.map((r) => Math.abs(r.watts)))
  const ok = model.balance === null ? null : Math.abs(model.balance) <= model.tolerance
  return (
    <section className="energy wv-energy" aria-label="Energy">
      <header className="section-head section-head--row">
        <h2 className="eyebrow">Energy · right now</h2>
        {ok !== null && (
          <span className={`balance ${ok ? 'balance--ok' : 'balance--bad'}`} title="Sum of all element powers: zero by conservation of energy">
            Σ p = {formatW(model.balance!)} {ok ? '✓ conserved' : '⚠'}
          </span>
        )}
      </header>
      <div className="ledger" role="table" aria-label="Instantaneous power of each element">
        <div className="ledger-axis" role="row" aria-hidden="true">
          <span>◀ supplying</span>
          <span>absorbing ▶</span>
        </div>
        {model.ledger.map((r) => {
          const w = Math.min(50, (Math.abs(r.watts) / scale) * 50)
          const supplying = r.watts < -scale * 1e-6
          return (
            <div key={r.id} className="ledger-row" role="row" title={r.note}>
              <span className="ledger-label" role="cell">
                {r.label}
              </span>
              <span className="ledger-bar" role="cell" aria-label={`${r.label} ${supplying ? 'supplying' : 'absorbing'} ${formatW(Math.abs(r.watts))}`}>
                <span className="ledger-mid" />
                <span className={`ledger-fill ledger-fill--${r.id} ${supplying ? 'is-supply' : 'is-absorb'}`} style={{ width: `${w}%`, [supplying ? 'right' : 'left']: '50%' }} />
              </span>
              <span className="ledger-value" role="cell">
                {Math.abs(r.watts) < scale * 1e-6 ? '0 W' : `${supplying ? '−' : '+'}${formatW(Math.abs(r.watts))}`}
              </span>
            </div>
          )
        })}
      </div>
      {model.stores.length > 0 && (
        <div className="stores">
          {model.stores.map((s) => (
            <div key={s.id} className="store">
              <span className="store-label">{s.label}</span>
              <span className="store-bar">
                <span className={`store-fill store-fill--${s.id}`} style={{ width: `${Math.max(0, Math.min(1, s.fraction)) * 100}%` }} />
              </span>
              <span className="store-value">{formatSI(s.joules, 'J')}</span>
              <span className="muted small store-detail">{s.detail}</span>
            </div>
          ))}
        </div>
      )}
      {model.summary && <p className="muted small">{model.summary}</p>}
    </section>
  )
}
