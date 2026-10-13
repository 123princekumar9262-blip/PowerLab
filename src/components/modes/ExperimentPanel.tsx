import { useState } from 'react'
import { describeFault, diffParams, diffQuantities, explainChanges, formatQuantity, type Snapshot } from '../../experiment/experiment.ts'
import type { Measurements } from '../../measurements/measurements.ts'
import { supportsFreewheel, type CircuitId, type DiodeId, type FaultSpec, type LabParams, type LoadType, type RectifierTopology } from '../../types/simulation.ts'
import { FREEWHEEL_EXPERIMENTS, type FreewheelExperiment } from '../../experiment/freewheel.ts'
import { StepBar } from '../lab/Modes.tsx'

interface Props {
  circuitId: CircuitId
  topology: RectifierTopology
  params: LabParams
  measurements: Measurements
  steady: boolean
  snapshot: Snapshot | null
  onCapture: () => void
  onClearSnapshot: () => void
  onFaults: (f: FaultSpec) => void
  load: LoadType
  /** Guided freewheeling-diode experiment in progress (half-wave RL). */
  guided: FreewheelExperiment | null
  onRunGuided: (x: FreewheelExperiment) => void
}

type FaultKind = 'none' | 'open' | 'short' | 'vf' | 'missing' | 'imbalance'

/** Phase G/H — Experiment: BEFORE / AFTER comparisons, and fault injection (three-phase). */
export function ExperimentPanel({ circuitId, topology, params, measurements, steady, snapshot, onCapture, onClearSnapshot, onFaults, load, guided, onRunGuided }: Props) {
  const three = topology.startsWith('3ph')
  const fwCircuit = !three && supportsFreewheel(topology, load)
  const devices: DiodeId[] = topology === '3ph-half-wave' ? ['Da', 'Db', 'Dc'] : ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']
  const [kind, setKind] = useState<FaultKind>('open')
  const [device, setDevice] = useState<DiodeId>(devices[0])
  const [phase, setPhase] = useState<'a' | 'b' | 'c'>('c')
  const [value, setValue] = useState(1.5)

  const apply = () => {
    const f: FaultSpec = {}
    if (kind === 'open' || kind === 'short') f.diode = { id: device, kind }
    if (kind === 'vf') f.vfOverride = { id: device, vf: value }
    if (kind === 'missing') f.missingPhase = phase
    if (kind === 'imbalance') f.imbalance = { phase, scale: value }
    onFaults(f)
  }

  const changes = snapshot ? diffParams(snapshot, circuitId, params) : []
  const deltas = snapshot ? diffQuantities(snapshot.m, measurements, fwCircuit) : []
  const why = snapshot ? explainChanges(changes, deltas, three) : []
  const active = describeFault(params.faults)

  return (
    <section className="mode-panel" aria-labelledby="exp-title">
      <header className="mode-head">
        <div>
          <p className="eyebrow">Experiment</p>
          <h2 id="exp-title">Before → After</h2>
        </div>
        {snapshot && (
          <button className="text-btn" onClick={onClearSnapshot}>
            Reset
          </button>
        )}
      </header>
      <StepBar at={snapshot ? 1 : 0} of={2} label={snapshot ? 'Step 2 of 2: change a value and compare' : 'Step 1 of 2: capture the circuit before'} />

      {fwCircuit && (
        <div className="guided">
          <p className="event-q">Freewheeling-diode experiments</p>
          <ol className="guided-list">
            {FREEWHEEL_EXPERIMENTS.map((x) => (
              <li key={x.id}>
                <button className={`lesson-card ${guided?.id === x.id ? 'is-active' : ''}`} onClick={() => onRunGuided(x)}>
                  <span>
                    <span className="lesson-title">{x.title}</span>
                    <span className="lesson-sum">{x.goal}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {guided && !guided.before && (
        <div className="guided-result">
          <p className="event-q">What does the physics say?</p>
          <p className="lesson-body">{guided.physics(measurements, null)}</p>
          <p className="muted small">Now run experiment 2 to add the freewheeling diode.</p>
        </div>
      )}

      {!snapshot ? (
        <>
          <p className="lesson-body">
            1. Press <b>Capture BEFORE</b>. 2. Change one thing — a parameter{three ? ', the circuit, or a fault below' : ' or the circuit'}. 3. Read what changed, and why.
          </p>
          <button className="primary-btn" disabled={!steady} onClick={onCapture} title={!steady ? 'Wait for steady state (increase Duration)' : undefined}>
            Capture BEFORE
          </button>
        </>
      ) : (
        <>
          <p className="muted small">
            BEFORE: {snapshot.circuitId} · {describeFault(snapshot.params.faults)} fault. Now change something — the AFTER column is the live simulation.
          </p>
          {changes.length === 0 ? (
            <p className="flag flag--info">Nothing changed yet. Move a slider, switch the circuit{three ? ' or inject a fault' : ''}.</p>
          ) : (
            <>
              <p className="event-q">What you changed</p>
              <ul className="change-list">
                {changes.map((c) => (
                  <li key={c.key}>
                    <b>{c.label}</b>: {c.before} → {c.after}
                  </li>
                ))}
              </ul>
              <p className="event-q">What changed? (measured)</p>
              <table className="ba-table">
                <thead>
                  <tr>
                    <th>Quantity</th>
                    <th className="num">Before</th>
                    <th className="num">After</th>
                    <th className="num">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {deltas.map((q) => (
                    <tr key={q.key} className={q.rel !== null && Math.abs(q.rel) >= 0.005 ? 'changed' : ''}>
                      <th>{q.label}</th>
                      <td className="num">{formatQuantity(q.before, q.unit)}</td>
                      <td className="num">{formatQuantity(q.after, q.unit)}</td>
                      <td className="num">{q.rel === null ? '—' : Math.abs(q.rel) < 0.005 ? '≈' : `${q.rel > 0 ? '+' : '−'}${Math.abs(q.rel * 100).toFixed(1)} %`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="event-q">{guided ? 'Why did it change?' : 'Why?'}</p>
              {why.map((w, k) => (
                <p key={k} className="lesson-body">
                  {w}
                </p>
              ))}
              {guided && guided.before && (
                <>
                  <p className="event-q">What does the physics say?</p>
                  <p className="lesson-body">{guided.physics(measurements, snapshot.m)}</p>
                </>
              )}
            </>
          )}
        </>
      )}

      {three && (
        <div className="fault-box">
          <p className="event-q">Fault injection</p>
          <p className="muted small">
            Active fault: <b>{active}</b>
          </p>
          <div className="fault-row">
            <select
              value={kind}
              onChange={(e) => {
                const k = e.target.value as FaultKind
                setKind(k)
                setValue(k === 'vf' ? 1.5 : 0.8)
              }}
              aria-label="Fault type"
            >
              <option value="open">One diode open</option>
              <option value="short">One diode short</option>
              <option value="vf">Unequal diode Vf</option>
              <option value="missing">Phase missing</option>
              <option value="imbalance">Phase voltage imbalance</option>
            </select>
            {(kind === 'open' || kind === 'short' || kind === 'vf') && (
              <select value={device} onChange={(e) => setDevice(e.target.value as DiodeId)} aria-label="Device">
                {devices.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            )}
            {(kind === 'missing' || kind === 'imbalance') && (
              <select value={phase} onChange={(e) => setPhase(e.target.value as 'a' | 'b' | 'c')} aria-label="Phase">
                {(['a', 'b', 'c'] as const).map((q) => (
                  <option key={q} value={q}>
                    phase {q.toUpperCase()}
                  </option>
                ))}
              </select>
            )}
            {kind === 'vf' && <input className="small-num" type="number" step={0.1} min={0} max={5} value={value} onChange={(e) => setValue(Number(e.target.value))} aria-label="Vf of the faulty diode [V]" />}
            {kind === 'imbalance' && <input className="small-num" type="number" step={0.05} min={0} max={2} value={value} onChange={(e) => setValue(Number(e.target.value))} aria-label="Phase amplitude (fraction of nominal)" />}
          </div>
          <div className="mode-actions">
            <button className="text-btn" onClick={() => onFaults({})}>
              Clear fault
            </button>
            <button className="primary-btn" onClick={apply}>
              Inject fault
            </button>
          </div>
          <p className="muted small">Tip: capture BEFORE on the healthy circuit, then inject a fault — the comparison becomes a troubleshooting exercise. Shorts need some source resistance Rs (Advanced) to give realistic fault currents.</p>
        </div>
      )}
    </section>
  )
}
