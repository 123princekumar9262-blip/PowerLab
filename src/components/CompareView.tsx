import { useMemo, useRef } from 'react'
import { freewheelInsight } from '../explanations/freewheel.ts'
import { measure, type Measurements } from '../measurements/measurements.ts'
import { indexAtTime, runSimulation, sampleAt } from '../simulation/engine.ts'
import type { CircuitId, LabParams, SignalId, SimulationResult } from '../types/simulation.ts'
import { formatA, formatDeg, formatSI, formatV } from '../utils/format.ts'
import { formatQuantity } from '../experiment/experiment.ts'

interface Props {
  /** The simulation on the bench (with or without the freewheeling diode). */
  result: SimulationResult
  params: LabParams
  circuitId: CircuitId
  cursorTime: number
  onCursorTime: (t: number) => void
}

const LANES: Array<{ id: string; title: string; sig: SignalId; unit: string }> = [
  { id: 'vout', title: 'Vout — load voltage', sig: 'vout', unit: 'V' },
  { id: 'io', title: 'Io — load (inductor) current', sig: 'io', unit: 'A' },
  { id: 'ifw', title: 'Ifw — freewheeling diode current', sig: 'ifw', unit: 'A' },
  { id: 'wl', title: 'E_L — energy stored in L', sig: 'wl', unit: 'J' },
]

const ROWS: Array<{ key: keyof Measurements; label: string; unit: string }> = [
  { key: 'voutAvg', label: 'Average output Vdc', unit: 'V' },
  { key: 'voutMin', label: 'Most negative output', unit: 'V' },
  { key: 'ioAvg', label: 'Average current Idc', unit: 'A' },
  { key: 'ioMin', label: 'Minimum current', unit: 'A' },
  { key: 'ioRipplePP', label: 'Current ripple (p-p)', unit: 'A' },
  { key: 'ioRippleFactor', label: 'Current ripple factor', unit: '' },
  { key: 'conductionAngleDeg', label: 'D1 conduction', unit: '°' },
  { key: 'fwConductionDeg', label: 'Dfw conduction', unit: '°' },
  { key: 'wlMax', label: 'E_L maximum', unit: 'J' },
  { key: 'wlMin', label: 'E_L minimum', unit: 'J' },
]

const W = 720
const LEFT = 56
const RIGHT = 12
const LANE_H = 92
const GAP = 26

/**
 * WITHOUT vs WITH the freewheeling diode: the same RL rectifier simulated twice, drawn on
 * shared axes over the last two (steady-state) cycles. Shaded bands mark where the two
 * output voltages differ — computed from the two simulations, not drawn by hand.
 */
export function CompareView({ result, params, circuitId, cursorTime, onCursorTime }: Props) {
  const fwOn = result.params.control.freewheel
  const other = useMemo(
    () => runSimulation({ ...params, control: { device: 'diode', alphaDeg: params.control?.alphaDeg ?? 0, freewheel: !fwOn } }, circuitId),
    [params, circuitId, fwOn],
  )
  const without = fwOn ? other : result
  const withFw = fwOn ? result : other
  const mw = useMemo(() => measure(without), [without])
  const mf = useMemo(() => measure(withFw), [withFw])
  const svgRef = useRef<SVGSVGElement>(null)

  const p = result.params
  const T = p.period
  const t1 = p.duration
  const t0 = Math.max(0, t1 - 2 * T)
  const n = result.trace.length
  const i0 = indexAtTime(result, t0)
  const plotW = W - LEFT - RIGHT
  const xOf = (t: number) => LEFT + ((t - t0) / (t1 - t0)) * plotW
  // The cursor at the same point of the cycle inside the compared window.
  const tc = cursorTime >= t0 ? cursorTime : t1 - T + (((cursorTime % T) + T) % T)

  // Difference bands: where |Vout(with) − Vout(without)| > 2 % of Vm.
  const bands = useMemo(() => {
    const a = without.trace.signals.vout!
    const b = withFw.trace.signals.vout!
    const out: Array<[number, number]> = []
    let start = -1
    for (let i = i0; i <= n; i++) {
      const diff = i < n && Math.abs(a[i] - b[i]) > 0.02 * p.vm
      if (diff && start < 0) start = i
      if (!diff && start >= 0) {
        out.push([result.trace.time[start], result.trace.time[i - 1]])
        start = -1
      }
    }
    return out
  }, [without, withFw, i0, n, p.vm, result])

  const poly = (r: SimulationResult, sig: SignalId, lo: number, hi: number, top: number) => {
    const arr = r.trace.signals[sig]
    if (!arr) return ''
    const step = Math.max(1, Math.floor((n - i0) / 900))
    const y = (v: number) => top + LANE_H - ((v - lo) / (hi - lo || 1)) * LANE_H
    let d = ''
    for (let i = i0; i < n; i += step) d += `${d ? 'L' : 'M'}${xOf(r.trace.time[i]).toFixed(1)},${y(arr[i]).toFixed(1)}`
    return d
  }
  const range = (sig: SignalId) => {
    let lo = 0
    let hi = 0
    for (const r of [without, withFw]) {
      const arr = r.trace.signals[sig]
      if (arr) for (let i = i0; i < n; i++) (lo = Math.min(lo, arr[i])), (hi = Math.max(hi, arr[i]))
    }
    const pad = (hi - lo) * 0.08 || 1
    return [lo - (lo < 0 ? pad : 0), hi + pad] as const
  }
  const fmt = (v: number, unit: string) => (unit === 'J' ? formatSI(v, 'J') : unit === 'A' ? formatA(v) : formatV(v))
  const height = LANES.length * (LANE_H + GAP) + 24

  const kc = indexAtTime(result, tc)
  const sw = sampleAt(without, kc)
  const sf = sampleAt(withFw, kc)
  const iw = freewheelInsight
  const angle = formatDeg(((((tc / T) * 360 + (p.phase * 180) / Math.PI) % 360) + 360) % 360)
  const stateOf = (r: SimulationResult, k: number) => {
    const s = sampleAt(r, k)
    const on = s.diodes.filter((d) => d.on).map((d) => d.id)
    if (!on.length) return 'no diode conducting'
    if (r.params.control.freewheel) return iw(r, s).modeLabel.toLowerCase() + ` (${on.join(' + ')} ON)`
    return on.includes('D1') && s.vin < 0 ? 'D1 ON, held on by L' : 'D1 ON'
  }

  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.type === 'pointermove' && e.buttons !== 1) return
    const svg = svgRef.current
    if (!svg) return
    const box = svg.getBoundingClientRect()
    const x = ((e.clientX - box.left) / box.width) * W
    const t = t0 + ((x - LEFT) / plotW) * (t1 - t0)
    onCursorTime(Math.min(t1, Math.max(t0, t)))
  }

  const diffs = ROWS.map((r) => ({ ...r, a: mw[r.key] as number | null, b: mf[r.key] as number | null }))
  const insights: string[] = []
  insights.push(`Vout never goes below ${formatV(mf.voutMin)} with Dfw; without it the inductor drags it down to ${formatV(mw.voutMin)}.`)
  if (mw.turnOffAngleDeg !== null) insights.push(`Without Dfw, D1 is held on until β = ${mw.turnOffAngleDeg.toFixed(1)}°; with Dfw it hands over at ${(mf.turnOffAngleDeg ?? 180).toFixed(1)}° and Dfw conducts for ${(mf.fwConductionDeg ?? 0).toFixed(1)}° per cycle.`)
  insights.push(`Vdc ${mf.voutAvg > mw.voutAvg ? 'rises' : 'falls'} from ${formatV(mw.voutAvg)} to ${formatV(mf.voutAvg)} — the negative area is gone.`)
  insights.push(
    mf.ioMin > 0 && mw.ioMin <= 0
      ? `The load current becomes continuous: minimum ${formatA(mw.ioMin)} → ${formatA(mf.ioMin)}; ripple factor ${formatQuantity(mw.ioRippleFactor, '')} → ${formatQuantity(mf.ioRippleFactor, '')}.`
      : `Minimum load current ${formatA(mw.ioMin)} → ${formatA(mf.ioMin)}; ripple factor ${formatQuantity(mw.ioRippleFactor, '')} → ${formatQuantity(mf.ioRippleFactor, '')}.`,
  )
  if (mw.wlMin !== null && mf.wlMin !== null) insights.push(`The inductor ${mf.wlMin > 0 ? `never empties with Dfw (E_L,min = ${formatSI(mf.wlMin, 'J')})` : 'still empties every cycle'}; without it E_L,min = ${formatSI(mw.wlMin, 'J')}.`)

  return (
    <section className="compare" aria-labelledby="cmp-title">
      <header className="section-head section-head--row">
        <h2 id="cmp-title" className="eyebrow">Without vs with the freewheeling diode</h2>
        <span className="compare-legend">
          <span className="cmp-key cmp-key--without">Without Dfw</span>
          <span className="cmp-key cmp-key--with">With Dfw</span>
          <span className="cmp-key cmp-key--diff">differ</span>
        </span>
      </header>
      <p className="muted small">The same circuit simulated twice (last two cycles, steady state). Drag to move the cursor — it is the same cursor as the scope.</p>
      <svg ref={svgRef} className="compare-svg" viewBox={`0 0 ${W} ${height}`} onPointerDown={onPointer} onPointerMove={onPointer} role="img" aria-label="Comparison of the RL rectifier without and with a freewheeling diode">
        {LANES.map((lane, k) => {
          const top = 18 + k * (LANE_H + GAP)
          const [lo, hi] = range(lane.sig)
          const y0 = top + LANE_H - ((0 - lo) / (hi - lo || 1)) * LANE_H
          return (
            <g key={lane.id}>
              <text className="cmp-title" x={LEFT} y={top - 6}>{lane.title}</text>
              <rect className="cmp-lane" x={LEFT} y={top} width={plotW} height={LANE_H} />
              {bands.map(([a, b], j) => (
                <rect key={j} className="cmp-band" x={xOf(a)} y={top} width={Math.max(1, xOf(b) - xOf(a))} height={LANE_H} />
              ))}
              <line className="cmp-zero" x1={LEFT} x2={LEFT + plotW} y1={y0} y2={y0} />
              <text className="cmp-tick" x={LEFT - 6} y={top + 8} textAnchor="end">{fmt(hi, lane.unit)}</text>
              <text className="cmp-tick" x={LEFT - 6} y={y0 + 3} textAnchor="end">0</text>
              <path className="cmp-trace cmp-trace--without" d={poly(without, lane.sig, lo, hi, top)} />
              <path className="cmp-trace cmp-trace--with" d={poly(withFw, lane.sig, lo, hi, top)} />
            </g>
          )
        })}
        <line className="cmp-cursor" x1={xOf(tc)} x2={xOf(tc)} y1={12} y2={height - 10} />
      </svg>

      <div className="cmp-now">
        <p className="event-q">At θ = {angle}</p>
        <dl>
          <div>
            <dt className="cmp-key cmp-key--without">Without</dt>
            <dd>
              {stateOf(without, kc)} · Vout {formatV(sw.vout)} · Io {formatA(sw.io)}
            </dd>
          </div>
          <div>
            <dt className="cmp-key cmp-key--with">With Dfw</dt>
            <dd>
              {stateOf(withFw, kc)} · Vout {formatV(sf.vout)} · Io {formatA(sf.io)} · Ifw {formatA(sf.values.ifw ?? 0)}
            </dd>
          </div>
        </dl>
      </div>

      <p className="event-q">What is different? (measured)</p>
      <ul className="change-list">
        {insights.map((t, k) => (
          <li key={k}>{t}</li>
        ))}
      </ul>
      <div className="table-wrap">
        <table className="ba-table">
          <thead>
            <tr>
              <th>Quantity</th>
              <th className="num">Without</th>
              <th className="num">With Dfw</th>
              <th className="num">Δ</th>
            </tr>
          </thead>
          <tbody>
            {diffs.map((r) => {
              const rel = r.a !== null && r.b !== null && Math.abs(r.a) > 1e-12 ? (r.b - r.a) / Math.abs(r.a) : null
              return (
                <tr key={r.key} className={rel === null || Math.abs(rel) >= 0.005 ? 'changed' : ''}>
                  <th>{r.label}</th>
                  <td className="num">{formatQuantity(r.a, r.unit)}</td>
                  <td className="num">{formatQuantity(r.b, r.unit)}</td>
                  <td className="num">{rel === null ? (r.a === r.b ? '≈' : 'new') : Math.abs(rel) < 0.005 ? '≈' : `${rel > 0 ? '+' : '−'}${Math.abs(rel * 100).toFixed(1)} %`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
