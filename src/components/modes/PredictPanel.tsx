import { useEffect, useRef, useState } from 'react'
import type { Comparison } from '../../measurements/compare.ts'
import { lastCycle, scoreNumber, scoreSketch, SKETCH_POINTS, type PredictionTask } from '../../prediction/prediction.ts'
import type { SimulationResult } from '../../types/simulation.ts'
import { formatSI, formatCapacitance } from '../../utils/format.ts'

interface Props {
  task: PredictionTask
  result: SimulationResult
  comparison: Comparison
  revealed: boolean
  best: number | null
  onReveal: (score: number) => void
  onNext: () => void
  onExplore: () => void
}

const W = 360
const H = 220

/**
 * Phase 9 — predict before you see. Sketch Vout over one cycle (Vin is drawn as a guide)
 * and estimate key numbers; then reveal the simulation over your sketch.
 */
export function PredictPanel({ task, result, comparison, revealed, best, onReveal, onNext, onExplore }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [sketch, setSketch] = useState<Array<number | null>>(() => Array(SKETCH_POINTS).fill(null))
  const [guesses, setGuesses] = useState<Record<string, string>>({})
  const drawing = useRef<{ last: number | null } | null>(null)
  const cycle = lastCycle(result)
  const vm = result.params.vm
  const range = vm * 1.25 // y-range: ±1.25·Vm

  useEffect(() => {
    setSketch(Array(SKETCH_POINTS).fill(null))
    setGuesses({})
  }, [task])

  // Draw grid, Vin guide, the sketch and (after reveal) the simulated Vout.
  useEffect(() => {
    const c = canvasRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const dpr = window.devicePixelRatio || 1
    c.width = W * dpr
    c.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const cs = getComputedStyle(c)
    const col = (v: string) => cs.getPropertyValue(v).trim()
    const x = (k: number) => (k / (SKETCH_POINTS - 1)) * W
    const y = (v: number) => H / 2 - (v / range) * (H / 2)
    ctx.fillStyle = col('--scope-lane')
    ctx.fillRect(0, 0, W, H)
    ctx.strokeStyle = col('--scope-grid')
    ctx.lineWidth = 1
    for (let g = 1; g < 4; g++) {
      ctx.beginPath()
      ctx.moveTo((g * W) / 4, 0)
      ctx.lineTo((g * W) / 4, H)
      ctx.stroke()
    }
    ctx.strokeStyle = col('--scope-zero')
    ctx.beginPath()
    ctx.moveTo(0, H / 2)
    ctx.lineTo(W, H / 2)
    ctx.stroke()
    const line = (vals: Array<number | null>, color: string, width: number, dash: number[] = []) => {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.setLineDash(dash)
      ctx.beginPath()
      let pen = false
      vals.forEach((v, k) => {
        if (v === null) {
          pen = false
          return
        }
        if (pen) ctx.lineTo(x(k), y(v))
        else ctx.moveTo(x(k), y(v))
        pen = true
      })
      ctx.stroke()
      ctx.setLineDash([])
    }
    line(cycle.vin, col('--sig-vin'), 1.5, [5, 5])
    if (revealed) line(cycle.vout, col('--sig-vout'), 2.5)
    line(sketch, col('--text-1'), 2.5)
    ctx.fillStyle = col('--text-3')
    ctx.font = '11px "Cascadia Code", Consolas, monospace'
    ;['0°', '90°', '180°', '270°'].forEach((t, g) => ctx.fillText(t, (g * W) / 4 + 4, H - 6))
    ctx.fillText(`+${formatSI(vm, 'V')}`, 4, y(vm) - 4)
  }, [sketch, revealed, cycle.vin, cycle.vout, range, vm])

  const toPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const k = Math.round(((e.clientX - r.left) / r.width) * (SKETCH_POINTS - 1))
    const v = (0.5 - (e.clientY - r.top) / r.height) * 2 * range
    return { k: Math.max(0, Math.min(SKETCH_POINTS - 1, k)), v }
  }
  const paint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { k, v } = toPoint(e)
    // Read the previous column NOW: the state updater runs later, after the ref has moved on.
    const last = drawing.current?.last ?? null
    setSketch((prev) => {
      const next = prev.slice()
      // Fill every column between the previous and current pointer position.
      if (last !== null && last !== k) {
        const a = Math.min(last, k)
        const b = Math.max(last, k)
        const v0 = prev[last] ?? v
        for (let j = a; j <= b; j++) next[j] = v0 + ((v - v0) * (j - last)) / (k - last)
      } else next[k] = v
      return next
    })
    if (drawing.current) drawing.current.last = k
  }

  const sk = scoreSketch(sketch, cycle.vout, vm)
  const numeric = task.questions.map((q) => {
    const g = guesses[q.key]
    const guess = g === undefined || g.trim() === '' ? null : Number(g.replace(',', '.'))
    const answer = q.answer(comparison.measurements)
    return { q, guess, answer, score: scoreNumber(guess, answer, q.tol) }
  })
  const parts = [sk.coverage > 0 ? sk.match : null, ...numeric.map((n) => n.score)].filter((v): v is number => v !== null)
  const total = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0

  return (
    <section className="mode-panel" aria-labelledby="pred-title">
      <header className="mode-head">
        <div>
          <p className="eyebrow">Predict · then see</p>
          <h2 id="pred-title">Sketch Vout for one cycle</h2>
        </div>
        {best !== null && <span className="muted small">best {best.toFixed(0)} / 100</span>}
      </header>
      <p className="muted small">
        Circuit: <b>{task.topology}</b> rectifier, <b>{task.load}</b> load — Vrms {task.params.source.vrms} V, R {task.params.load.resistance} Ω
        {task.load.includes('L') && <>, L {formatSI(task.params.load.inductance, 'H')}</>}
        {task.load.includes('C') && <>, C {formatCapacitance(task.params.load.capacitance)}</>}, {task.params.diode.model} diode. The dashed blue line is Vin (steady state).
      </p>
      <canvas
        ref={canvasRef}
        className="sketch"
        style={{ aspectRatio: `${W} / ${H}` }}
        aria-label="Sketch area: drag to draw your predicted output voltage over one source cycle"
        onPointerDown={(e) => {
          if (revealed) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drawing.current = { last: null }
          paint(e)
        }}
        onPointerMove={(e) => drawing.current && !revealed && paint(e)}
        onPointerUp={() => (drawing.current = null)}
      />
      <div className="sketch-legend">
        <span><i className="sw sw--vin" /> Vin</span>
        <span><i className="sw sw--you" /> your sketch</span>
        {revealed && <span><i className="sw sw--vout" /> simulated Vout</span>}
      </div>

      <div className="guesses">
        {numeric.map(({ q, guess, answer, score }) => (
          <label key={q.key} className="guess">
            <span>{q.label}</span>
            <span className="num-input">
              <input inputMode="decimal" disabled={revealed} value={guesses[q.key] ?? ''} onChange={(e) => setGuesses((g) => ({ ...g, [q.key]: e.target.value }))} placeholder="?" />
              <span className="unit">{q.unit}</span>
            </span>
            {revealed && (
              <span className="guess-result">
                sim {answer === null ? '—' : `${answer.toFixed(q.unit === '°' ? 1 : 2)} ${q.unit}`}
                {guess !== null && score !== null && <b className={score >= 80 ? 'ok' : 'no'}> · {score.toFixed(0)}/100</b>}
              </span>
            )}
          </label>
        ))}
      </div>

      {revealed ? (
        <>
          <p className="score">
            Shape match <b>{sk.coverage > 0 ? sk.match.toFixed(0) : '—'}</b>/100 · overall <b>{total.toFixed(0)}</b>/100
          </p>
          <p className="muted small">Where does your sketch differ? Explore it in the lab: the cursor, circuit and WHY panel explain every part of the real waveform.</p>
          <div className="mode-actions">
            <button className="text-btn" onClick={onExplore}>
              Explore in the lab
            </button>
            <button className="primary-btn" onClick={onNext}>
              Next prediction →
            </button>
          </div>
        </>
      ) : (
        <div className="mode-actions">
          <button className="text-btn" onClick={() => setSketch(Array(SKETCH_POINTS).fill(null))}>
            Clear sketch
          </button>
          <button className="primary-btn" disabled={sk.coverage < 0.5} title={sk.coverage < 0.5 ? 'Sketch at least half the cycle first' : undefined} onClick={() => onReveal(total)}>
            Reveal the simulation
          </button>
        </div>
      )}
    </section>
  )
}
