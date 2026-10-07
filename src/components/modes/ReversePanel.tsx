import { useState } from 'react'
import { conductingOptions, LOAD_OPTIONS, RECTIFIER_OPTIONS, type ReverseTask } from '../../reverse/reverse.ts'
import type { LoadType, RectifierTopology } from '../../types/simulation.ts'

interface Props {
  task: ReverseTask
  answers: { pulses: number | null; conducting: string }
  revealed: boolean
  onReveal: () => void
  onNext: () => void
  onExplore: () => void
}

/** Phase G — reverse engineering: identify the rectifier from its source and output waveforms. */
export function ReversePanel({ task, answers, revealed, onReveal, onNext, onExplore }: Props) {
  const [rect, setRect] = useState<RectifierTopology | null>(null)
  const [pulses, setPulses] = useState<number | null>(null)
  const [load, setLoad] = useState<LoadType | null>(null)
  const [pair, setPair] = useState<string | null>(null)
  // Offer every answer any rectifier of this section could give — the list must not reveal the topology.
  const pairs = [...new Set(RECTIFIER_OPTIONS[task.section].flatMap((r) => conductingOptions(r.id)))]
  const truthRect = task.topology
  const checks = [
    { q: 'Which rectifier?', ok: rect === truthRect, truth: RECTIFIER_OPTIONS[task.section].find((r) => r.id === truthRect)?.label },
    { q: 'Pulses per cycle?', ok: pulses === answers.pulses, truth: String(answers.pulses) },
    { q: 'Which load?', ok: load === task.load, truth: task.load },
    { q: `Conducting at θ = ${task.probeDeg}°?`, ok: pair === answers.conducting, truth: answers.conducting },
  ]
  const score = checks.filter((c) => c.ok).length
  const reset = () => {
    setRect(null)
    setPulses(null)
    setLoad(null)
    setPair(null)
  }

  const Choice = <T extends string | number>(props: { label: string; options: T[]; value: T | null; onPick: (v: T) => void; show?: (v: T) => string }) => (
    <div className="rev-q">
      <p className="event-q">{props.label}</p>
      <div className="rev-opts">
        {props.options.map((o) => (
          <button key={String(o)} className={`pick ${props.value === o ? 'on' : ''}`} disabled={revealed} onClick={() => props.onPick(o)}>
            {props.show ? props.show(o) : String(o)}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <section className="mode-panel" aria-labelledby="rev-title">
      <header className="mode-head">
        <div>
          <p className="eyebrow">Reverse engineering</p>
          <h2 id="rev-title">What circuit made these waveforms?</h2>
        </div>
      </header>
      <p className="muted small">
        Only the source and output channels are shown; the circuit is hidden. Use the cursor and zoom on the scope. The question about conducting devices refers to θ = {task.probeDeg}° (marked by the cursor at the start).
      </p>
      <Choice label="1. Which rectifier?" options={RECTIFIER_OPTIONS[task.section].map((r) => r.id)} value={rect} onPick={setRect} show={(v) => RECTIFIER_OPTIONS[task.section].find((r) => r.id === v)!.label} />
      <Choice label="2. How many output pulses per source cycle?" options={[1, 2, 3, 6]} value={pulses} onPick={setPulses} />
      <Choice label="3. What load is most likely?" options={task.section === 'three' ? (['R', 'RL'] as LoadType[]) : LOAD_OPTIONS} value={load} onPick={setLoad} />
      <Choice label={`4. Which device(s) conduct at θ = ${task.probeDeg}°?`} options={pairs} value={pair} onPick={setPair} />
      {!revealed ? (
        <div className="mode-actions">
          <span />
          <button className="primary-btn" disabled={!rect || !pulses || !load || !pair} onClick={onReveal}>
            Reveal the answer
          </button>
        </div>
      ) : (
        <>
          <ul className="criteria">
            {checks.map((c) => (
              <li key={c.q} className={c.ok ? 'pass' : 'fail'}>
                <span className="crit-mark">{c.ok ? '✓' : '✕'}</span>
                <span className="crit-label">{c.q}</span>
                <span className="crit-value">{c.truth}</span>
              </li>
            ))}
          </ul>
          <p className="score">
            Score <b>{score}</b> / 4. {score === 4 ? 'Perfect reading of the waveforms.' : 'Explore the circuit to see what gave it away: pulse count → topology; smooth vs. pulsing current → load.'}
          </p>
          <div className="mode-actions">
            <button className="text-btn" onClick={onExplore}>
              Explore this circuit
            </button>
            <button
              className="primary-btn"
              onClick={() => {
                reset()
                onNext()
              }}
            >
              Next puzzle →
            </button>
          </div>
        </>
      )}
    </section>
  )
}
