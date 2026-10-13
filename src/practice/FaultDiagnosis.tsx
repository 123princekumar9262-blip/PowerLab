import { useEffect, useMemo, useState } from 'react'
import { CircuitDiagram } from '../components/CircuitDiagram.tsx'
import { href } from '../shell/router.ts'
import { Crumbs, PageHead } from '../shell/ui.tsx'
import { sanitizeParams } from '../simulation/params.ts'
import type { LoadType, RectifierTopology, SignalId } from '../types/simulation.ts'
import { formatA, formatSI } from '../utils/format.ts'
import { loadProgress, newSeed, updateProgress } from './common.ts'
import {
  answerText,
  CASE_POINTS,
  compareRows,
  explainFault,
  healthyReference,
  judge,
  KIND_TEXT,
  KIND_POINTS,
  KINDS_FOR,
  PART_POINTS,
  PROBE_COST,
  roundCases,
  runFaulty,
  runHealthy,
  TEMPLATES,
  type Answer,
  type FaultCase,
  type FaultKind,
  type Judgement,
} from './faults.ts'
import { PxScope } from './PxScope.tsx'
import '../styles/practice.css'

const ID = 'fault'

interface Done {
  answer: Answer
  probed: boolean
  j: Judgement
}

/** Fault diagnosis: one round = five real circuits, each with one hidden fault, judged by the simulation. */
export default function FaultDiagnosis() {
  const [seed, setSeed] = useState(newSeed)
  const cases = useMemo(() => roundCases(seed), [seed])
  const [k, setK] = useState(0)
  const [done, setDone] = useState<Record<number, Done>>({})
  const [progress, setProgress] = useState(() => loadProgress(ID, TEMPLATES.length))
  const total = Object.values(done).reduce((s, d) => s + d.j.points, 0)
  const finished = Object.keys(done).length === cases.length
  const c = cases[Math.min(k, cases.length - 1)]

  const restart = (s: number) => {
    setSeed(s)
    setK(0)
    setDone({})
  }
  const record = (d: Done) => {
    const next = { ...done, [k]: d }
    setDone(next)
    const all = Object.keys(next).length === cases.length
    const score = Object.values(next).reduce((s, x) => s + x.j.points, 0)
    setProgress(
      updateProgress(ID, TEMPLATES.length, (p) => ({
        ...p,
        solved: d.j.partOk && d.j.kindOk ? [...p.solved, c.id] : p.solved,
        ...(all ? { rounds: (p.rounds ?? 0) + 1, best: !p.best || score > p.best.score ? { score, of: cases.length * CASE_POINTS } : p.best } : {}),
      })),
    )
  }

  return (
    <div className="page px-page">
      <Crumbs items={[{ label: 'Practice', href: href.engineering() }, { label: 'Fault Diagnosis' }]} />
      <PageHead
        title="Fault Diagnosis"
        lead="Each circuit below has one hidden fault. Read the waveforms and the bench measurements, name the faulty part and what is wrong with it. Then the simulation runs the healthy circuit beside it and shows why."
        side={
          <span className="px-score" aria-label={`Score ${total} of ${cases.length * CASE_POINTS}`}>
            {total} <span>/ {cases.length * CASE_POINTS}</span>
          </span>
        }
      />
      <div className="px-roundbar">
        <ol className="px-steps" aria-label="Cases in this round">
          {cases.map((x, i) => {
            const d = done[i]
            const state = d ? (d.j.partOk && d.j.kindOk ? 'ok' : d.j.partOk ? 'half' : 'bad') : i === k ? 'now' : 'todo'
            return (
              <li key={x.key}>
                <button type="button" className={`px-step px-step--${state}`} aria-current={i === k ? 'step' : undefined} onClick={() => setK(i)} disabled={!d && i !== k}>
                  <span className="px-step-n">{i + 1}</span>
                  <span className="px-step-label">{d ? `${d.j.points} / ${CASE_POINTS}` : i === k ? 'now' : ''}</span>
                </button>
              </li>
            )
          })}
        </ol>
        <p className="px-roundmeta">
          Set #{seed} · solved {progress.solved.length} of {progress.total} fault types{progress.best ? ` · best round ${progress.best.score} / ${progress.best.of}` : ''}
          <button type="button" className="px-link" onClick={() => restart(newSeed())}>
            New set
          </button>
        </p>
      </div>

      {finished && k >= cases.length ? (
        <Summary cases={cases} done={done} total={total} seed={seed} onReplay={() => restart(seed)} onNew={() => restart(newSeed())} onOpen={setK} />
      ) : (
        <CaseView key={`${seed}:${k}`} c={c} n={k} of={cases.length} done={done[k] ?? null} onDone={record} onNext={() => setK(k + 1)} last={k === cases.length - 1} />
      )}
    </div>
  )
}

function CaseView({ c, n, of, done, onDone, onNext, last }: { c: FaultCase; n: number; of: number; done: Done | null; onDone: (d: Done) => void; onNext: () => void; last: boolean }) {
  const faulty = useMemo(() => runFaulty(c), [c])
  // the healthy run is needed for the reference values and the reveal only
  const [showRef, setShowRef] = useState(false)
  const healthy = useMemo(() => (showRef || done ? runHealthy(c) : null), [c, showRef, done])
  const [part, setPart] = useState<string | null>(done?.answer.part ?? null)
  const [kind, setKind] = useState<FaultKind | null>(done?.answer.kind ?? null)
  const [probed, setProbed] = useState(done?.probed ?? false)
  const [shown, setShown] = useState<SignalId[]>(c.bench.channels)
  const bench = c.bench
  const partType = bench.parts.find((p) => p.id === part)?.type
  const kinds = partType ? KINDS_FOR[partType] : []
  useEffect(() => {
    if (kind && !kinds.includes(kind)) setKind(null)
  }, [part]) // eslint-disable-line react-hooks/exhaustive-deps

  // the schematic is the HEALTHY circuit, idle: nothing on it gives the fault away
  const drawn = useMemo(() => sanitizeParams(bench.params, bench.circuitId).params, [bench])
  const [topology, load] = bench.circuitId.split(':') as [RectifierTopology, LoadType]
  const m = faulty.m
  const readings: Array<[string, string]> = [
    ['Output voltage, average', formatSI(m.voutAvg, 'V')],
    ['Ripple, peak-to-peak', formatSI(m.ripplePP, 'V')],
    ['Ripple frequency', m.rippleFrequency === null ? 'no ripple' : formatSI(m.rippleFrequency, 'Hz')],
    ['Lowest output voltage', formatSI(m.voutMin, 'V')],
    ['Load current, average', formatA(m.ioAvg)],
  ]
  const probe = () => {
    setProbed(true)
    setShown((s) => [...new Set([...s, ...bench.probes])])
  }
  const toggle = (s: SignalId) => {
    if (bench.probes.includes(s) && !probed) return
    setShown((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]))
  }
  const submit = () => {
    if (!part || !kind) return
    onDone({ answer: { part, kind }, probed, j: judge(c, { part, kind }, probed) })
  }

  return (
    <>
      <section className="px-casehead" aria-labelledby="px-case-title">
        <p className="eyebrow">
          Case {n + 1} of {of}
        </p>
        <h2 id="px-case-title">{bench.title}</h2>
        <ul className="px-plate" aria-label="Nameplate">
          {bench.nameplate.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>

      <div className="px-grid">
        <section className="px-card px-circuit" aria-label="Circuit">
          <div className="px-card-head">
            <h3>Circuit</h3>
            <span className="px-quiet">Click a part to select it</span>
          </div>
          <CircuitDiagram
            topology={topology}
            load={load}
            params={drawn}
            sample={null}
            result={null}
            inspecting={!done}
            selectedPart={part}
            onPart={(id) => bench.parts.some((p) => p.id === id) && setPart(id)}
          />
        </section>

        <section className="px-card px-diagnose" aria-labelledby="px-diag">
          <div className="px-card-head">
            <h3 id="px-diag">Your diagnosis</h3>
            <span className="px-quiet">
              part {PART_POINTS} pt · cause {KIND_POINTS} pt
            </span>
          </div>
          <p className="px-q">
            <span className="px-qn">1</span> Which part is faulty?
          </p>
          <div className="px-parts" role="radiogroup" aria-label="Faulty part">
            {bench.parts.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={part === p.id} className={`px-part ${part === p.id ? 'is-on' : ''}`} disabled={!!done} onClick={() => setPart(p.id)}>
                {p.type === 'device' ? p.id : p.type === 'phase' ? `Phase ${p.id.slice(-1).toUpperCase()}` : 'Capacitor C'}
              </button>
            ))}
          </div>
          <p className="px-q">
            <span className="px-qn">2</span> What is wrong with it, and how does it show?
          </p>
          {kinds.length ? (
            <div className="px-options" role="radiogroup" aria-label="Cause">
              {kinds.map((x) => (
                <button key={x} type="button" role="radio" aria-checked={kind === x} className={`px-option ${kind === x ? 'is-on' : ''}`} disabled={!!done} onClick={() => setKind(x)}>
                  <span className="px-option-title">{KIND_TEXT[x].title}</span>
                  <span className="px-option-text">{KIND_TEXT[x].text}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="px-quiet px-placeholder">Choose a part first.</p>
          )}
          {!done ? (
            <div className="px-actions">
              <button type="button" className="btn btn--primary" disabled={!part || !kind} onClick={submit}>
                Check diagnosis
              </button>
              {probed && <span className="px-quiet">Current probe used: −{PROBE_COST} point</span>}
            </div>
          ) : (
            <Verdict c={c} d={done} />
          )}
        </section>
      </div>

      <section className="px-card" aria-labelledby="px-bench">
        <div className="px-card-head">
          <h3 id="px-bench">Bench measurements</h3>
          {!done && (
            <button type="button" className="px-link" aria-expanded={showRef} onClick={() => setShowRef(!showRef)}>
              {showRef ? 'Hide' : 'Show'} what a healthy unit reads
            </button>
          )}
        </div>
        <dl className="px-readings">
          {readings.map(([kk, v]) => (
            <div key={kk} className="px-reading">
              <dt>{kk}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {showRef && healthy && !done && (
          <p className="px-ref">
            Healthy unit (datasheet test, simulated):{' '}
            {healthyReference(healthy)
              .map(([kk, v]) => `${kk.toLowerCase()} ${v}`)
              .join(' · ')}
          </p>
        )}
      </section>

      <section className="px-card" aria-labelledby="px-scope-h">
        <div className="px-card-head">
          <h3 id="px-scope-h">{done ? 'Faulty circuit' : 'Oscilloscope'}</h3>
          <span className="px-quiet">Drag on the traces to read values · wheel to zoom</span>
        </div>
        <PxScope
          result={faulty.result}
          channels={probed || done ? [...bench.channels, ...bench.probes] : bench.channels}
          shown={shown.filter((s) => probed || !bench.probes.includes(s))}
          onToggle={toggle}
          extra={
            !probed && !done ? (
              <button type="button" className="px-probe" onClick={probe} title="Show every device current — costs one point">
                + Current probe <span>−{PROBE_COST} pt</span>
              </button>
            ) : null
          }
        />
        {done && healthy && (
          <>
            <div className="px-card-head px-card-head--sub">
              <h3>Healthy circuit</h3>
              <span className="px-quiet">The same circuit without the fault, simulated for comparison</span>
            </div>
            <PxScope key="healthy" result={healthy.result} channels={[...bench.channels, ...bench.probes]} shown={shown} onToggle={toggle} />
          </>
        )}
      </section>

      {done && healthy && (
        <section className="px-card px-why" aria-labelledby="px-why">
          <div className="px-card-head">
            <h3 id="px-why">Why — from the two simulations</h3>
          </div>
          <div className="px-why-grid">
            <div>
              {explainFault(c, healthy, faulty).map((t, i) => (
                <p key={i}>{t}</p>
              ))}
            </div>
            <table className="px-table">
              <thead>
                <tr>
                  <th scope="col">Measured</th>
                  <th scope="col">Healthy</th>
                  <th scope="col">Faulty</th>
                </tr>
              </thead>
              <tbody>
                {compareRows(c, healthy, faulty).map((r) => (
                  <tr key={r.label} className={r.rel !== null && Math.abs(r.rel) > 0.05 ? 'is-changed' : ''}>
                    <th scope="row">{r.label}</th>
                    <td>{r.healthy}</td>
                    <td>{r.faulty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-actions">
            <button type="button" className="btn btn--primary" onClick={onNext}>
              {last ? 'See the round' : 'Next case →'}
            </button>
            <a className="px-link" href={href.workspace('rectifiers', bench.topic, 'experiment', { load })}>
              Inject faults yourself in Rectifiers › Experiment
            </a>
          </div>
        </section>
      )}
    </>
  )
}

function Verdict({ c, d }: { c: FaultCase; d: Done }) {
  const right = d.j.partOk && d.j.kindOk
  const truth = c.accepted[0]
  return (
    <div className={`px-verdict px-verdict--${right ? 'pass' : d.j.partOk ? 'warning' : 'fail'}`} role="status">
      <p className="px-verdict-head">
        <span className="px-verdict-tag">{right ? 'Correct' : d.j.partOk ? 'Right part, wrong cause' : 'Not this time'}</span>
        <span className="px-verdict-pts">
          +{d.j.points} / {CASE_POINTS}
        </span>
      </p>
      <p>
        The fault: <b>{answerText(c.bench, truth)}</b>.
        {c.accepted.length > 1 && <> Also accepted: {c.accepted.slice(1).map((a) => answerText(c.bench, a)).join(', ')} (identical evidence).</>}
      </p>
      {!right && <p className="px-quiet">You said: {answerText(c.bench, d.answer)}.</p>}
      {d.probed && d.j.points > 0 && <p className="px-quiet">−{PROBE_COST} point for the current probe.</p>}
    </div>
  )
}

function Summary({ cases, done, total, seed, onReplay, onNew, onOpen }: { cases: FaultCase[]; done: Record<number, Done>; total: number; seed: number; onReplay: () => void; onNew: () => void; onOpen: (i: number) => void }) {
  const of = cases.length * CASE_POINTS
  return (
    <section className="px-card px-summary" aria-labelledby="px-sum">
      <p className="eyebrow">Set #{seed} complete</p>
      <h2 id="px-sum">
        {total} of {of} points
      </h2>
      <ol className="px-sumlist">
        {cases.map((c, i) => (
          <li key={c.key}>
            <button type="button" className="px-sumrow" onClick={() => onOpen(i)}>
              <span className="px-sumn">{i + 1}</span>
              <span className="px-sumtext">
                <span>{c.bench.title}</span>
                <span className="px-quiet">{answerText(c.bench, c.accepted[0])}</span>
              </span>
              <span className={`px-pill px-pill--${done[i]?.j.points === CASE_POINTS ? 'pass' : done[i]?.j.partOk ? 'warning' : 'fail'}`}>
                {done[i]?.j.points ?? 0} / {CASE_POINTS}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="px-actions">
        <button type="button" className="btn btn--primary" onClick={onNew}>
          New set
        </button>
        <button type="button" className="btn" onClick={onReplay}>
          Replay set #{seed}
        </button>
      </div>
      <p className="px-quiet">Each set is random; the same set number always gives the same cases.</p>
    </section>
  )
}

