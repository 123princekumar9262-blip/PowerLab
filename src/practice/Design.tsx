import { useMemo, useState } from 'react'
import { LabScope, type Viewport } from '../components/lab/LabScope.tsx'
import { eventLabel } from '../converters/dcdc/explain.ts'
import type { ChannelMeta } from '../lab/types.ts'
import { href } from '../shell/router.ts'
import { Crumbs, PageHead } from '../shell/ui.tsx'
import { loadProgress, updateProgress } from './common.ts'
import { SPECS, type DcdcRunView, type DesignResult, type DesignSpec, type Verdict } from './design.ts'
import { PxScope } from './PxScope.tsx'
import '../styles/practice.css'

const ID = 'design'
const RANK: Record<Verdict, number> = { fail: 0, warning: 1, pass: 2 }
const WORD: Record<Verdict, string> = { pass: 'Pass', warning: 'Warning', fail: 'Fail' }

/** Display value of a field (the stored SI value / scale), rounded for the input. */
const show = (v: number, scale: number) => Number((v / scale).toPrecision(6))

/** Design: pick a specification, choose the components, the simulation validates every requirement. */
export default function Design() {
  const [specId, setSpecId] = useState(SPECS[0].id)
  const spec = SPECS.find((s) => s.id === specId) ?? SPECS[0]
  const [progress, setProgress] = useState(() => loadProgress(ID, SPECS.length))
  return (
    <div className="page px-page">
      <Crumbs items={[{ label: 'Practice', href: href.engineering() }, { label: 'Design' }]} />
      <PageHead
        title="Design"
        lead="Start from a specification, choose the components, and let the simulation validate your design: every requirement is checked on the simulated waveforms — PASS, WARNING or FAIL, with a hint for the next try."
        side={
          <span className="px-score" aria-label={`${progress.solved.length} of ${SPECS.length} specifications met`}>
            {progress.solved.length} <span>/ {SPECS.length} met</span>
          </span>
        }
      />
      <div className="px-specs" role="tablist" aria-label="Specifications">
        {SPECS.map((s) => {
          const v = progress.verdicts?.[s.id] as Verdict | undefined
          return (
            <button key={s.id} type="button" role="tab" aria-selected={s.id === spec.id} className={`px-spec ${s.id === spec.id ? 'is-on' : ''}`} onClick={() => setSpecId(s.id)}>
              <span className="px-spec-top">
                <span className="px-spec-title">{s.title}</span>
                {v && <span className={`px-pill px-pill--${v}`}>{WORD[v]}</span>}
              </span>
              <span className="px-spec-brief">{s.brief}</span>
            </button>
          )
        })}
      </div>
      <SpecView
        key={spec.id}
        spec={spec}
        onResult={(r) =>
          setProgress(
            updateProgress(ID, SPECS.length, (p) => {
              const before = (p.verdicts?.[spec.id] as Verdict | undefined) ?? null
              const best = before && RANK[before] >= RANK[r.verdict] ? before : r.verdict
              return { ...p, rounds: (p.rounds ?? 0) + 1, solved: r.verdict === 'pass' ? [...p.solved, spec.id] : p.solved, verdicts: { ...p.verdicts, [spec.id]: best } }
            }),
          )
        }
      />
    </div>
  )
}

function SpecView({ spec, onResult }: { spec: DesignSpec; onResult: (r: DesignResult) => void }) {
  const [vals, setVals] = useState<Record<string, number>>(() => Object.fromEntries(spec.fields.map((f) => [f.key, show(spec.start[f.key], f.scale)])))
  const [auto, setAuto] = useState(!!spec.autoDuty)
  const [result, setResult] = useState<DesignResult | null>(null)
  const [busy, setBusy] = useState(false)
  const design = useMemo(() => {
    const d = Object.fromEntries(spec.fields.map((f) => [f.key, vals[f.key] * f.scale]))
    if (spec.autoDuty && auto) d.duty = spec.autoDuty(d)
    return d
  }, [vals, auto, spec])
  const valid = spec.fields.every((f) => Number.isFinite(vals[f.key]) && vals[f.key] >= f.min && vals[f.key] <= f.max)
  const [simulated, setSimulated] = useState<Record<string, number> | null>(null)
  const stale = !!simulated && spec.fields.some((f) => simulated[f.key] !== design[f.key])

  const run = () => {
    if (!valid) return
    setBusy(true)
    // let "Simulating…" paint before the solve
    window.setTimeout(() => {
      const r = spec.evaluate(design)
      setResult(r)
      setSimulated(design)
      setBusy(false)
      onResult(r)
    }, 30)
  }
  const link = spec.link(simulated ?? design)

  return (
    <>
      <div className="px-grid">
        <section className="px-card" aria-labelledby="px-spec-h">
          <div className="px-card-head">
            <h3 id="px-spec-h">Specification</h3>
            <span className="px-quiet">{spec.brief}</span>
          </div>
          <p className="px-story">{spec.story}</p>
          <div className="px-why-grid">
            <div>
              <p className="px-subhead">Given</p>
              <dl className="px-kv">
                {spec.given.map(([k, v]) => (
                  <Kv key={k} k={k} v={v} />
                ))}
              </dl>
            </div>
            <div>
              <p className="px-subhead">Requirements</p>
              <dl className="px-kv">
                {spec.requirements.map(([k, v]) => (
                  <Kv key={k} k={k} v={v} />
                ))}
              </dl>
            </div>
          </div>
          <p className="px-subhead">Your design</p>
          <div className="px-fields">
            {spec.fields.map((f) => {
              const isDuty = f.key === 'duty' && !!spec.autoDuty
              const value = isDuty && auto ? Number((design.duty / f.scale).toFixed(2)) : vals[f.key]
              const bad = !(Number.isFinite(vals[f.key]) && vals[f.key] >= f.min && vals[f.key] <= f.max)
              return (
                <div key={f.key} className="px-field">
                  <label className="px-field-label" htmlFor={`px-f-${f.key}`}>
                    {f.label}
                    <small>
                      {bad ? `Enter ${f.min} … ${f.max} ${f.unit}` : `${f.min} … ${f.max} ${f.unit}`}
                      {isDuty && (
                        <>
                          {' · '}
                          <label className="px-check">
                            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> ideal D from Vout/Vin
                          </label>
                        </>
                      )}
                    </small>
                  </label>
                  <span className="px-input">
                    <input
                      id={`px-f-${f.key}`}
                      type="number"
                      inputMode="decimal"
                      step={f.step}
                      min={f.min}
                      max={f.max}
                      value={Number.isFinite(value) ? value : ''}
                      disabled={isDuty && auto}
                      aria-invalid={bad}
                      onChange={(e) => setVals({ ...vals, [f.key]: e.target.value === '' ? NaN : Number(e.target.value) })}
                      onKeyDown={(e) => e.key === 'Enter' && run()}
                    />
                    <span className="px-input-unit">{f.unit}</span>
                  </span>
                </div>
              )
            })}
          </div>
          <div className="px-actions">
            <button type="button" className="btn btn--primary" disabled={!valid || busy} onClick={run}>
              {busy ? 'Simulating…' : 'Simulate design'}
            </button>
            {stale && <span className="px-quiet">The values changed since the last run.</span>}
          </div>
        </section>

        <section className="px-card" aria-labelledby="px-res-h" aria-live="polite">
          <div className="px-card-head">
            <h3 id="px-res-h">Validated result</h3>
            {result && <span className="px-quiet">every value below is simulated</span>}
          </div>
          {!result ? (
            <div className="px-empty">{busy ? <span className="px-busy">Simulating your design…</span> : <span>Enter your values and press Simulate design.<br />The starting values are deliberately not a solution.</span>}</div>
          ) : (
            <>
              <div className="px-overall">
                <span className={`px-pill px-pill--${result.verdict}`}>{WORD[result.verdict]}</span>
                <span className="px-overall-text">
                  {result.verdict === 'pass'
                    ? 'Your design meets every requirement.'
                    : `${result.checks.filter((c) => c.verdict !== 'pass').length} of ${result.checks.length} requirements not met${result.verdict === 'warning' ? ' — close' : ''}.`}
                </span>
              </div>
              <div className="px-checks">
                {result.checks.map((c) => (
                  <div key={c.id} className="px-checkrow">
                    <span className="px-checkrow-name">
                      {c.label}
                      <span>{c.limit}</span>
                    </span>
                    <span className="px-checkrow-value">{c.value}</span>
                    <span className={`px-pill px-pill--${c.verdict}`}>{WORD[c.verdict]}</span>
                    <span className="px-checkrow-hint">{c.hint}</span>
                  </div>
                ))}
              </div>
              <p className="px-quiet" style={{ margin: '12px 0 0' }}>
                {result.used.map(([k, v]) => `${k}: ${v}`).join(' · ')} ·{' '}
                <a className="px-link" href={href.workspace(link.lab, link.topic, 'explore', link.query)}>
                  {link.lab === 'rectifiers' ? 'Open the bridge rectifier (set R and C there)' : 'Open this design in the workspace'}
                </a>
              </p>
            </>
          )}
        </section>
      </div>

      {result && (
        <section className="px-card" aria-labelledby="px-wave-h">
          <div className="px-card-head">
            <h3 id="px-wave-h">Simulated waveforms</h3>
            <span className="px-quiet">{result.runs[0].kind === 'rect' ? 'From switch-on (capacitor empty) to steady state' : 'Steady state · drag to read values'}</span>
          </div>
          <div className={`px-runs ${result.runs.length > 1 ? 'px-runs--two' : ''}`}>
            {result.runs.map((r) =>
              r.kind === 'dcdc' ? (
                <DcdcScope key={r.label} view={r} />
              ) : (
                <PxScope key={r.label} result={r.result} channels={['vin', 'vout', 'io', 'id', 'ic']} shown={['vout', 'id']} cycles={r.result.params.cycles} label={r.label} />
              ),
            )}
          </div>
        </section>
      )}
    </>
  )
}

const Kv = ({ k, v }: { k: string; v: string }) => (
  <>
    <dt>{k}</dt>
    <dd>{v}</dd>
  </>
)

const DCDC_META: Record<string, ChannelMeta> = {
  vout: { id: 'vout', label: 'Vout', name: 'Output voltage', unit: 'V', color: '#d95926', group: 'Voltages' },
  il: { id: 'il', label: 'iL', name: 'Inductor current', unit: 'A', color: '#e66767', group: 'Currents' },
}

/** The DC-DC lab's scope for one simulated design: Vout zoomed to its ripple, iL below. */
function DcdcScope({ view }: { view: DcdcRunView }) {
  const r = view.run
  const full: Viewport = { t0: 0, t1: r.params.duration }
  const [vp, setVp] = useState<Viewport>(full)
  const [k, setK] = useState(Math.round(r.length / 3))
  return (
    <div>
      <p className="px-scope-label" style={{ margin: '0 0 6px' }}>
        {view.label} · {view.m.mode}
      </p>
      <LabScope
        result={r}
        channels={['vout', 'il']}
        meta={DCDC_META}
        layout="separate"
        yMode="fit"
        viewport={vp}
        onViewport={setVp}
        cursorIndex={k}
        onCursorTime={(t) => setK(Math.min(r.length - 1, Math.max(0, Math.round(t / r.params.dt))))}
        shading={false}
        eventLabel={eventLabel}
        periodName="period"
        selectedEventId={null}
        onSelectEvent={() => {}}
      />
    </div>
  )
}
