import { useMemo, useState } from 'react'
import { href } from '../../../shell/router.ts'
import { psModule } from '../../catalog.ts'
import { completeActivity, isDone, usePsProgress } from '../../progress.ts'
import type { ModuleProps } from '../../types.ts'
import { fx } from '../../ui/format.ts'
import { Callout, Readouts, Seg, Slider, useTutorContext } from '../../ui/kit.tsx'
import { Plot } from '../../ui/Plot.tsx'
import { SingleLine } from '../../ui/SingleLine.tsx'
import { CHALLENGES } from './challenges.ts'
import type { Challenge, Control, State, Value } from './types.ts'
import './challenge.css'

/*
 * Module 7 — Engineer's Challenge. Practise: realistic tasks that need several modules at once; the model is
 * re-solved on every change and the verdict checks each objective against the computed result. Learn: the method
 * engineers follow, and where each step is taught.
 */

const MODULE = 'challenge'

export default function ChallengeModule({ mode, setMode }: ModuleProps) {
  return mode === 'learn' ? <Method onStart={() => setMode('practise')} /> : <Challenges />
}

// ── Practise ───────────────────────────────────────────────────────────────────────────────────────────────────

function Challenges() {
  const [current, setCurrent] = useState(CHALLENGES[0].id)
  const progress = usePsProgress()
  const c = CHALLENGES.find((x) => x.id === current)!
  return (
    <div className="ps-stack">
      <nav className="ps-ch-list" aria-label="Challenges">
        {CHALLENGES.map((x, k) => {
          const solved = isDone(progress, MODULE, `ch-${x.id}`)
          return (
            <button
              key={x.id}
              type="button"
              className={`ps-ch-card ${x.id === current ? 'on' : ''} ${solved ? 'is-solved' : ''}`}
              aria-current={x.id === current ? 'true' : undefined}
              onClick={() => setCurrent(x.id)}
            >
              <span className="ps-ch-card-head">
                <span className="ps-ch-n" aria-hidden="true">
                  {solved ? '✓' : k + 1}
                </span>
                <span className="ps-ch-level">{x.level}</span>
              </span>
              <span className="ps-ch-title">{x.title}</span>
              <span className="ps-ch-line">{x.line}</span>
              <span className="ps-ch-uses">Uses: {x.uses.map((u) => psModule(u)?.short ?? u).join(' · ')}</span>
              {solved && <span className="sr-only">(solved)</span>}
            </button>
          )
        })}
      </nav>
      <ChallengeRun key={c.id} c={c} />
    </div>
  )
}

function ChallengeRun({ c }: { c: Challenge }) {
  const [state, setState] = useState<State>(c.initial)
  const [checked, setChecked] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [hints, setHints] = useState(0)
  const ev = useMemo(() => c.evaluate(state), [c, state])
  const allOk = ev.objectives.every((o) => o.ok)
  const progress = usePsProgress()
  const solvedBefore = isDone(progress, MODULE, `ch-${c.id}`)
  const set = (id: string, v: Value) => {
    setState((s) => ({ ...s, [id]: v }))
    setChecked(false)
  }
  const check = () => {
    setChecked(true)
    setAttempts((a) => a + 1)
    if (allOk) completeActivity(MODULE, `ch-${c.id}`)
  }
  useTutorContext(
    () =>
      `Engineer's Challenge — "${c.title}". Brief: ${c.brief.join(' ')} Current settings: ${c.controls.map((k) => `${k.label} = ${String(state[k.id])}`).join('; ')}. Measurements: ${ev.measurements.map((m) => `${m.label} ${m.value}${m.unit ? ` ${m.unit}` : ''}`).join('; ')}. ${checked ? `Verdict: ${ev.objectives.map((o) => `${o.ok ? 'met' : 'NOT met'} — ${o.label} (${o.detail})`).join('; ')}.` : 'The student has not checked the solution yet — guide with questions rather than giving the settings away.'}`,
  )
  const d = ev.diagram
  return (
    <section className="ps-stack" aria-labelledby={`ch-${c.id}`}>
      <div className="ps-card ps-ch-brief">
        <p className="eyebrow">
          Challenge · {c.level}
          {solvedBefore ? ' · solved before' : ''}
        </p>
        <h3 id={`ch-${c.id}`}>{c.title}</h3>
        {c.brief.map((p, k) => (
          <p key={k}>{p}</p>
        ))}
      </div>
      {ev.alarm && (
        <Callout tone="bad" title="Alarm">
          <p>{ev.alarm}</p>
        </Callout>
      )}
      {d && (
        <div className="ps-diagram">
          <SingleLine net={d.net} sol={d.sol} label={`${c.title}: single-line diagram`} highlight={d.highlight} showValues place={d.place} tags={d.tags} viewBox={d.viewBox} faultAt={d.faultAt} />
        </div>
      )}
      {ev.plot && (
        <div className="ps-ch-plot">
          <Plot {...ev.plot} />
        </div>
      )}
      <div className="ps-split ps-split--wide-side">
        <div className="ps-stack">
          <section className="ps-card" aria-label="Controls">
            <div className="ps-toolbar">
              <h3>Your controls</h3>
              <button
                type="button"
                className="text-btn"
                onClick={() => {
                  setState(c.initial)
                  setChecked(false)
                }}
              >
                Reset
              </button>
            </div>
            <div className="ps-ch-controls">
              {c.controls.map((k) => (
                <ControlView key={k.id} k={k} value={state[k.id]} onChange={(v) => set(k.id, v)} />
              ))}
            </div>
          </section>
          <section className="ps-ch-measure" aria-label="Measurements">
            <p className="eyebrow ps-ch-eyebrow">Measurements</p>
            <Readouts items={ev.measurements} />
          </section>
        </div>
        <aside className="ps-card ps-ch-verdict" aria-label="Verdict" aria-live="polite">
          <h3>Objectives</h3>
          <ul className="ps-ch-objectives">
            {ev.objectives.map((o) => (
              <li key={o.id} className={checked ? (o.ok ? 'is-ok' : 'is-bad') : ''}>
                <span className="ps-ch-mark" aria-hidden="true">
                  {checked ? (o.ok ? '✓' : '✗') : '○'}
                </span>
                <span>
                  {o.label}
                  {checked && <span className="ps-ch-detail"> — {o.detail}</span>}
                  {checked && <span className="sr-only">{o.ok ? ' (met)' : ' (not met)'}</span>}
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn--primary ps-btn-sm" onClick={check}>
            Check my solution
          </button>
          {checked && (
            <p className={allOk ? 'ps-right' : 'ps-wrong'}>
              {allOk ? `Solved${attempts > 1 ? ` in ${attempts} checks` : ' first time'}.` : `${ev.objectives.filter((o) => !o.ok).length} of ${ev.objectives.length} objectives not met yet.`}
            </p>
          )}
          {checked && allOk && (
            <div className="ps-ch-debrief">
              <p className="eyebrow">Debrief</p>
              {c.debrief(state, ev).map((p, k) => (
                <p key={k}>{p}</p>
              ))}
            </div>
          )}
          {!(checked && allOk) && (
            <div className="ps-ch-hints">
              {c.hints.slice(0, hints).map((h, k) => (
                <p key={k} className="ps-ch-hint">
                  <span className="eyebrow">Hint {k + 1}</span> {h}
                </p>
              ))}
              {hints < c.hints.length && (
                <button type="button" className="text-btn" onClick={() => setHints((n) => n + 1)}>
                  {hints === 0 ? 'Show a hint' : 'Another hint'}
                </button>
              )}
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}

function ControlView({ k, value, onChange }: { k: Control; value: Value; onChange(v: Value): void }) {
  if (k.kind === 'slider') return <Slider label={k.label} value={Number(value)} min={k.min} max={k.max} step={k.step} unit={k.unit} decimals={k.decimals} hint={k.hint} onChange={onChange} />
  if (k.kind === 'switch')
    return (
      <div className="ps-ch-switch">
        <span className="ps-slider-label">{k.label}</span>
        <Seg
          label={k.label}
          value={value === true ? 'on' : 'off'}
          onChange={(v) => onChange(v === 'on')}
          options={[
            { id: 'off', label: k.off },
            { id: 'on', label: k.on },
          ]}
        />
        {k.hint && <p className="ps-hint">{k.hint}</p>}
      </div>
    )
  return (
    <div className="ps-ch-choice">
      <span className="ps-slider-label">{k.label}</span>
      <Seg label={k.label} value={String(value)} onChange={(v) => onChange(v)} options={k.options} />
      {k.hint && <p className="ps-hint">{k.hint}</p>}
    </div>
  )
}

// ── Learn: the engineer's method ───────────────────────────────────────────────────────────────────────────────

const METHOD: Array<{ title: string; text: string; module: string }> = [
  { title: 'Understand the system', text: 'Draw the single-line diagram: sources, transformers, lines, loads, breakers — and the voltage level of each part.', module: 'grid' },
  { title: 'Model it in per unit', text: 'Choose one MVA base and a voltage base per zone; convert every impedance. Transformers disappear into simple series impedances.', module: 'per-unit' },
  { title: 'Solve the normal state', text: 'Run a load flow: every bus voltage, every flow and the losses, for the load you are designing for.', module: 'load-flow' },
  { title: 'Check the abnormal: faults', text: 'Compute fault currents at each bus and for each fault type; size breakers and set the protection that clears them.', module: 'faults' },
  { title: 'Check the dynamics', text: 'Will generators stay in step when a fault is cleared? Will frequency hold when a generator trips?', module: 'stability' },
  { title: 'Decide — then re-solve', text: 'Change the design or the settings, and solve again to prove the limits are met. An engineer’s answer is a checked answer.', module: 'challenge' },
]

function Method({ onStart }: { onStart(): void }) {
  const progress = usePsProgress()
  useTutorContext(() => `Learn mode: the engineer's method (understand → per unit → load flow → faults → dynamics → decide and re-solve), and the typical limits a design is checked against.`)
  return (
    <div className="ps-stack ps-ch-method">
      <ol className="ps-ch-steps">
        {METHOD.map((m, k) => {
          const mod = psModule(m.module)
          return (
            <li key={m.title} className="ps-card">
              <span className="ps-ch-n" aria-hidden="true">
                {k + 1}
              </span>
              <div>
                <h3>{m.title}</h3>
                <p>{m.text}</p>
                {mod && m.module !== 'challenge' && (
                  <a className="ps-ch-link" href={href.subject('power-systems', mod.id)}>
                    Module {mod.n} · {mod.title} {mod.status === 'ready' ? '→' : '(planned)'}
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      <section className="ps-card" aria-labelledby="ps-ch-limits">
        <h3 id="ps-ch-limits">The limits a design is checked against</h3>
        <p className="small muted">Typical planning values used in these challenges — actual limits are set by each country’s grid code and each utility.</p>
        <table className="ps-table">
          <thead>
            <tr>
              <th scope="col">Quantity</th>
              <th scope="col">Typical limit</th>
              <th scope="col">Why</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Bus voltage</td>
              <td className="ps-ch-cell">
                {fx(0.95, 2)}–{fx(1.05, 2)} pu
              </td>
              <td className="ps-ch-cell">Equipment is designed for its nominal voltage; customers’ supply must stay close to it.</td>
            </tr>
            <tr>
              <td>Thermal loading</td>
              <td className="ps-ch-cell">≤ 100 % of rating</td>
              <td className="ps-ch-cell">Current heats conductors and windings; overload ages insulation and sags lines.</td>
            </tr>
            <tr>
              <td>Breaker rating</td>
              <td className="ps-ch-cell">≥ the largest fault current it may interrupt</td>
              <td className="ps-ch-cell">A breaker that cannot interrupt the fault fails — often violently.</td>
            </tr>
            <tr>
              <td>Fault clearing time</td>
              <td className="ps-ch-cell">&lt; the critical clearing time</td>
              <td className="ps-ch-cell">Otherwise nearby generators lose synchronism.</td>
            </tr>
          </tbody>
        </table>
      </section>
      <p>
        <button type="button" className="btn btn--primary ps-btn-sm" onClick={onStart}>
          Start the challenges →
        </button>{' '}
        <span className="small muted">
          {CHALLENGES.filter((x) => isDone(progress, MODULE, `ch-${x.id}`)).length} of {CHALLENGES.length} solved
        </span>
      </p>
    </div>
  )
}
