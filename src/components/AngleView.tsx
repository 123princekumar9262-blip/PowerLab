import { useMemo, useRef } from 'react'
import { DEVICE_MAP } from '../explanations/threePhase.ts'
import { indexAtTime } from '../simulation/engine.ts'
import { threePhaseSource } from '../simulation/source.ts'
import type { SimulationResult } from '../types/simulation.ts'
import { formatV } from '../utils/format.ts'

interface Props {
  result: SimulationResult
  /** Master cursor angle θ (phase a), degrees. */
  angleDeg: number
  /** Move the master cursor to angle θ within the last (steady-state) cycle. */
  onAngle: (deg: number) => void
}

const W = 720
const WAVE_H = 150
const ROW_H = 14
const PAD_L = 44
const PAD_R = 12

/**
 * Electrical-angle view of the steady-state cycle (all data sampled from the simulation):
 * phase voltages and Vo against θ = 0…360°, the commutation boundaries (where a device
 * actually switched), the conducting pair in each segment, and a device timeline with
 * conduction bars (and SCR gate pulses). Plus a phasor diagram at the cursor angle.
 */
export function AngleView({ result, angleDeg, onAngle }: Props) {
  const p = result.params
  const svgRef = useRef<SVGSVGElement>(null)
  const scr = p.control.device === 'scr' || p.topology === '3ph-half-controlled'
  const names = result.diodeIds.map((id) => (id === 'Dfw' ? 'Dfw' : scr && (DEVICE_MAP[id]?.upper || (p.control.device === 'scr' && p.topology === '3ph-bridge')) ? id.replace('D', 'T') : id))

  // Sample the last cycle at 1° steps (angle of phase a), straight from the trace.
  const data = useMemo(() => {
    const { period: T, duration, phase } = p
    const phiDeg = (phase * 180) / Math.PI
    const idx: number[] = []
    for (let d = 0; d <= 360; d++) {
      const frac = ((((d - phiDeg) / 360) % 1) + 1) % 1
      idx.push(indexAtTime(result, duration - T + frac * T))
    }
    const s = result.trace.signals
    const col = (arr?: Float64Array) => idx.map((i) => (arr ? arr[i] : 0))
    const on = result.trace.diodes.map((d) => idx.map((i) => d.on[i] === 1))
    const gate = result.trace.diodes.map((d) => (d.gate ? idx.map((i) => d.gate![i] === 1) : null))
    // Commutation boundaries: angles of the device turn-on events in the last cycle.
    const src = threePhaseSource(p)
    const bounds = result.events.filter((e) => e.kind === 'diode-on' && e.time >= duration - T).map((e) => src.angleDeg(e.time))
    // Conducting set per degree, then runs of equal sets → segment labels.
    const setAt = (d: number) => result.diodeIds.filter((_, k) => on[k][d]).map((id, k) => names[result.diodeIds.indexOf(id)] ?? String(k))
    const runs: Array<{ from: number; to: number; label: string }> = []
    for (let d = 0; d <= 360; d++) {
      const label = setAt(d).join('+') || '—'
      const last = runs[runs.length - 1]
      if (last && last.label === label) last.to = d
      else runs.push({ from: d, to: d, label })
    }
    return { va: col(s.vin), vb: col(s.vb), vc: col(s.vc), vo: col(s.vout), on, gate, bounds, runs }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  const vmax = Math.max(p.vm, ...data.vo.map(Math.abs)) * 1.1
  const vmin = Math.min(-p.vm, ...data.vo) * 1.1
  const x = (d: number) => PAD_L + (d / 360) * (W - PAD_L - PAD_R)
  const y = (v: number) => 8 + ((vmax - v) / (vmax - vmin)) * (WAVE_H - 16)
  const line = (vals: number[]) => vals.map((v, d) => `${d ? 'L' : 'M'}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const rows = result.diodeIds.length
  const H = WAVE_H + 24 + rows * (ROW_H + 3) + 8
  const θ = ((angleDeg % 360) + 360) % 360

  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = svgRef.current!.getBoundingClientRect()
    const d = (((e.clientX - r.left) / r.width) * W - PAD_L) / (W - PAD_L - PAD_R)
    onAngle(Math.max(0, Math.min(359.9, d * 360)))
  }

  // Phasors at the cursor angle: projection on the vertical axis = instantaneous value.
  const R = 62
  const seqSign = p.threePhase.sequence === 'acb' ? -1 : 1
  const ph = [
    { q: 'a', off: 0, v: data.va[Math.round(θ)] },
    { q: 'b', off: -120 * seqSign, v: data.vb[Math.round(θ)] },
    { q: 'c', off: 120 * seqSign, v: data.vc[Math.round(θ)] },
  ]
  const segLabel = data.runs.find((r) => θ >= r.from && θ <= r.to)?.label ?? '—'

  return (
    <section className="angle-view" aria-labelledby="angle-title">
      <header className="section-head section-head--row">
        <h2 id="angle-title" className="eyebrow">
          Angle view · steady-state cycle
        </h2>
        <span className="muted small">
          θ = <b className="mono">{θ.toFixed(1)}°</b> · conducting <b>{segLabel}</b> · drag to move the cursor
        </span>
      </header>
      <div className="angle-body">
        <svg
          ref={svgRef}
          className="angle-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Electrical angle view. At θ = ${θ.toFixed(0)}° the conducting devices are ${segLabel}.`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            pick(e)
          }}
          onPointerMove={(e) => e.buttons && pick(e)}
        >
          {/* conduction-segment shading + boundaries */}
          {data.runs.map((r, k) => (
            <rect key={k} className={`seg-band ${k % 2 ? 'odd' : ''}`} x={x(r.from)} y={4} width={Math.max(0, x(r.to + 1) - x(r.from))} height={WAVE_H - 8} />
          ))}
          {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360].map((d) => (
            <g key={d}>
              <line className="angle-grid" x1={x(d)} x2={x(d)} y1={4} y2={WAVE_H - 4} />
              <text className="angle-tick" x={x(d)} y={WAVE_H + 12} textAnchor="middle">
                {d}°
              </text>
            </g>
          ))}
          <line className="angle-zero" x1={x(0)} x2={x(360)} y1={y(0)} y2={y(0)} />
          {data.bounds.map((b, k) => (
            <line key={k} className="commutation" x1={x(b)} x2={x(b)} y1={4} y2={H - 6} />
          ))}
          <path className="aw aw--a" d={line(data.va)} />
          <path className="aw aw--b" d={line(data.vb)} />
          <path className="aw aw--c" d={line(data.vc)} />
          <path className="aw aw--o" d={line(data.vo)} />
          {data.runs
            .filter((r) => r.to - r.from >= 12)
            .map((r, k) => (
              <text key={k} className="seg-label" x={(x(r.from) + x(r.to)) / 2} y={WAVE_H - 10} textAnchor="middle">
                {r.label}
              </text>
            ))}
          {/* device timeline */}
          {result.diodeIds.map((id, k) => {
            const top = WAVE_H + 20 + k * (ROW_H + 3)
            const bars: Array<[number, number]> = []
            let start = -1
            for (let d = 0; d <= 361; d++) {
              const v = d <= 360 && data.on[k][d]
              if (v && start < 0) start = d
              if (!v && start >= 0) {
                bars.push([start, d - 1])
                start = -1
              }
            }
            const g = data.gate[k]
            return (
              <g key={id}>
                <text className="row-label" x={PAD_L - 6} y={top + ROW_H - 3} textAnchor="end">
                  {names[k]}
                </text>
                <rect className="row-bg" x={x(0)} y={top} width={x(360) - x(0)} height={ROW_H} />
                {g &&
                  g.map((on, d) => (on && d < 360 ? <rect key={d} className="gate-bar" x={x(d)} y={top + ROW_H - 3} width={x(d + 1) - x(d) + 0.3} height={3} /> : null))}
                {bars.map(([a, b], j) => (
                  <rect key={j} className={`on-bar on-bar--${DEVICE_MAP[id]?.phase ?? 'x'}`} x={x(a)} y={top + 1} width={Math.max(1, x(b + 1) - x(a))} height={ROW_H - 5} rx={2} />
                ))}
              </g>
            )
          })}
          <line className="angle-cursor" x1={x(θ)} x2={x(θ)} y1={2} y2={H - 4} />
        </svg>
        <svg className="phasor-svg" viewBox="-90 -90 180 180" role="img" aria-label="Phasor diagram at the cursor angle">
          <circle className="phasor-circle" r={R} />
          <line className="phasor-axis" x1={0} x2={0} y1={-R - 10} y2={R + 10} />
          {ph.map((f) => {
            const a = ((θ + f.off) * Math.PI) / 180
            // Phasor rotates counter-clockwise; its vertical projection is Vm·sin(θ + offset).
            const px = R * Math.cos(a)
            const py = -R * Math.sin(a)
            return (
              <g key={f.q} className={`phasor phasor--${f.q}`}>
                <line x1={0} y1={0} x2={px} y2={py} />
                <circle cx={px} cy={py} r={3.5} />
                <line className="proj" x1={px} y1={py} x2={0} y2={py} />
                <text x={px * 1.22} y={py * 1.22 + 4} textAnchor="middle">
                  {f.q}
                </text>
              </g>
            )
          })}
          <text className="phasor-note" x={0} y={84} textAnchor="middle">
            projection = instantaneous V
          </text>
        </svg>
        <div className="phasor-values">
          {ph.map((f) => (
            <div key={f.q} className={`pv pv--${f.q}`}>
              V{f.q}N <b>{formatV(f.v)}</b>
            </div>
          ))}
          <div className="pv pv--o">
            Vo <b>{formatV(data.vo[Math.round(θ)])}</b>
          </div>
        </div>
      </div>
    </section>
  )
}
