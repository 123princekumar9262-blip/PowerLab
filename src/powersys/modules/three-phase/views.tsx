import { useEffect, useMemo, useRef, useState } from 'react'
import { abs, arg, type Complex } from '../../engine/complex.ts'
import { cx, fx, sg } from '../../ui/format.ts'
import { useReducedMotion } from '../../ui/kit.tsx'
import { cycle, inst, setSum, type Conn, type LineModel, type PhaseSet } from './calc.ts'

/*
 * The module's own drawings: the rotating phasors beside their waveforms, the star and delta connections, the power
 * triangle and the line model. All plain SVG; every label is computed by the caller or from the values passed in.
 */

export const PHASE = [
  { k: 'a', name: 'a (R)', color: 'var(--ps-a)' },
  { k: 'b', name: 'b (Y)', color: 'var(--ps-b)' },
  { k: 'c', name: 'c (B)', color: 'var(--ps-c)' },
] as const
export const SUM_COLOR = 'var(--ps-flow)'

// ── rotating phasors and their waveforms ─────────────────────────────────────────────────────────────────────

/** ωt that advances while playing (one supply cycle in `periodS` seconds); a scrub value when paused. */
export function useClock(periodS = 3) {
  const reduced = useReducedMotion()
  const [playing, setPlaying] = useState(!reduced)
  const [wt, setWt] = useState(Math.PI / 6)
  const last = useRef<number | null>(null)
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = (t: number) => {
      if (last.current !== null) setWt((w) => (w + ((t - last.current!) / 1000 / periodS) * 2 * Math.PI) % (2 * Math.PI))
      last.current = t
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      last.current = null
    }
  }, [playing, periodS])
  return { wt, setWt, playing, setPlaying, reduced }
}

export function ClockControls({ clock, freq = 50 }: { clock: ReturnType<typeof useClock>; freq?: number }) {
  const d = (clock.wt * 180) / Math.PI
  return (
    <div className="ps-3p-clock">
      <button type="button" className="btn ps-btn-sm" onClick={() => clock.setPlaying(!clock.playing)} aria-pressed={clock.playing}>
        {clock.playing ? 'Pause' : 'Play'}
      </button>
      <label className="ps-3p-scrub">
        <span className="sr-only">Instant in the cycle, ωt</span>
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={Math.round(d)}
          onChange={(e) => {
            clock.setPlaying(false)
            clock.setWt((Number(e.target.value) * Math.PI) / 180)
          }}
        />
      </label>
      <output className="ps-3p-clock-val">
        ωt = {fx(d, 0)}° · t = {fx((d / 360) * (1000 / freq), 2)} ms
      </output>
    </div>
  )
}

/**
 * Left: the three phasors rotating counter-clockwise. Right: v(t) = √2·|V|·sin(ωt + θ) over one cycle, drawn on the same
 * vertical scale, so each phasor's height is its waveform's value at the cursor.
 */
export function RotatingView({ set, wt, showSum, unit = 'V', label }: { set: PhaseSet; wt: number; showSum: boolean; unit?: string; label: string }) {
  const W = 780
  const H = 290
  const cy = H / 2
  const cxp = 140
  const R = 112
  const x0 = 310
  const x1 = W - 70
  const total = setSum(set)
  const peak = Math.SQRT2 * Math.max(abs(set.a), abs(set.b), abs(set.c), showSum ? abs(total) : 0, 1e-9)
  const k = R / peak
  const X = (w: number) => x0 + (w / (2 * Math.PI)) * (x1 - x0)
  const Y = (v: number) => cy - v * k
  const phasors = [...PHASE.map((p) => ({ ...p, z: set[p.k] })), ...(showSum ? [{ k: 's', name: 'a+b+c', color: SUM_COLOR, z: total }] : [])]
  const paths = useMemo(
    () =>
      phasors.map((p) =>
        cycle(180)
          .map((w, i) => `${i ? 'L' : 'M'}${X(w).toFixed(1)} ${Y(inst(p.z, w)).toFixed(1)}`)
          .join(''),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [set.a, set.b, set.c, showSum, k],
  )
  const tip = (z: Complex) => {
    const a = wt + arg(z)
    const m = Math.SQRT2 * abs(z) * k
    return { x: cxp + m * Math.cos(a), y: cy - m * Math.sin(a) }
  }
  const values = phasors.map((p) => `${p.name} ${fx(inst(p.z, wt), 1)} ${unit}`).join(', ')
  return (
    <figure className="ps-3p-rot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}. At ωt = ${fx((wt * 180) / Math.PI, 0)}°: ${values}.`}>
        <defs>
          {phasors.map((p) => (
            <marker key={p.k} id={`rot-${p.k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 10 5 0 10z" style={{ fill: p.color }} />
            </marker>
          ))}
        </defs>
        {/* phasor side */}
        <circle cx={cxp} cy={cy} r={R} className="ps-ph-circle" />
        <line x1={cxp - R - 12} x2={cxp + R + 12} y1={cy} y2={cy} className="ps-ph-axis" />
        <line x1={cxp} x2={cxp} y1={cy - R - 12} y2={cy + R + 12} className="ps-ph-axis" />
        <text x={cxp + R + 8} y={cy - 6} className="ps-ph-axislabel">
          Re
        </text>
        <text x={cxp + 6} y={cy - R - 4} className="ps-ph-axislabel">
          Im
        </text>
        <path d={`M${cxp + 34} ${cy} A34 34 0 0 0 ${cxp + 34 * Math.cos(-0.9)} ${cy + 34 * Math.sin(-0.9)}`} className="ps-3p-rotdir" />
        <text x={cxp + 40} y={cy - 26} className="ps-ph-axislabel">
          ω
        </text>
        {/* waveform side */}
        <line x1={x0} x2={x1} y1={cy} y2={cy} className="ps-ph-axis" />
        {[0, 90, 180, 270, 360].map((d) => (
          <g key={d}>
            <line x1={X((d * Math.PI) / 180)} x2={X((d * Math.PI) / 180)} y1={cy - R - 6} y2={cy + R + 6} className="ps-3p-grid" />
            <text x={X((d * Math.PI) / 180)} y={H - 6} className="ps-plot-tick" textAnchor="middle">
              {d}°
            </text>
          </g>
        ))}
        <text x={x0 - 8} y={cy - R + 4} className="ps-plot-tick" textAnchor="end">
          {sg(peak, 3)}
        </text>
        <text x={x0 - 8} y={cy + R + 4} className="ps-plot-tick" textAnchor="end">
          −{sg(peak, 3)}
        </text>
        <text x={x0 - 8} y={cy + 4} className="ps-plot-tick" textAnchor="end">
          0
        </text>
        <text x={x1 + 8} y={cy + 4} className="ps-plot-axis">
          ωt
        </text>
        {phasors.map((p, i) => (
          <path key={p.k} d={paths[i]} className="ps-plot-line" style={{ stroke: p.color }} strokeDasharray={p.k === 's' ? '5 4' : undefined} />
        ))}
        {/* projections */}
        {phasors.map((p) => {
          const t = tip(p.z)
          const yv = Y(inst(p.z, wt))
          return <line key={`pr${p.k}`} x1={t.x} y1={t.y} x2={X(wt)} y2={yv} className="ps-3p-proj" style={{ stroke: p.color }} />
        })}
        <line x1={X(wt)} x2={X(wt)} y1={cy - R - 8} y2={cy + R + 8} className="ps-3p-cursor" />
        {phasors.map((p) => {
          const t = tip(p.z)
          const len = Math.hypot(t.x - cxp, t.y - cy)
          const ux = len ? (t.x - cxp) / len : 0
          const uy = len ? (t.y - cy) / len : 0
          return (
            <g key={`ph${p.k}`}>
              {len > 2 && (
                <line x1={cxp} y1={cy} x2={t.x} y2={t.y} className="ps-ph-arrow" style={{ stroke: p.color }} strokeDasharray={p.k === 's' ? '4 3' : undefined} markerEnd={`url(#rot-${p.k})`} />
              )}
              {len > 2 && (
                <text x={t.x + ux * 13} y={t.y + uy * 13 + 4} className="ps-ph-label" textAnchor="middle">
                  {p.k === 's' ? 'Σ' : p.k}
                </text>
              )}
              <circle cx={X(wt)} cy={Y(inst(p.z, wt))} r={4} style={{ fill: p.color }} className="ps-3p-dot" />
            </g>
          )
        })}
      </svg>
      <figcaption className="ps-plot-foot">
        <ul className="ps-plot-legend">
          {phasors.map((p) => (
            <li key={p.k}>
              <span className="ps-plot-key" style={{ background: p.color }} aria-hidden="true" />
              {p.k === 's' ? 'v_a + v_b + v_c' : `v_${p.k} — phase ${p.name.split(' ')[1].replace(/[()]/g, '')}`}
              <span className="ps-3p-legend-val">
                {fx(inst(p.z, wt), 1)} {unit}
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  )
}

// ── star and delta connections ────────────────────────────────────────────────────────────────────────────────

function Zbox({ x1, y1, x2, y2, label, color }: { x1: number; y1: number; x2: number; y2: number; label: string; color: string }) {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const a = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} className="ps-3p-wire" style={{ stroke: color }} />
      <rect x={mx - 15} y={my - 6} width={30} height={12} rx={2} transform={`rotate(${a} ${mx} ${my})`} className="ps-3p-z" style={{ stroke: color }} />
      <text x={mx} y={my - 12} className="ps-3p-sk-label" textAnchor="middle">
        {label}
      </text>
    </g>
  )
}

/** The three supply lines a, b, c and the load connected in star or delta; the voltage and current arrows named. */
export function ConnectionSketch({ conn }: { conn: Conn }) {
  const ys = [44, 104, 164]
  const xT = 92 // terminals
  return (
    <svg
      viewBox="0 0 330 212"
      className="ps-3p-sketch"
      role="img"
      aria-label={conn === 'star' ? 'Star connection: three impedances from lines a, b, c to a common neutral point N' : 'Delta connection: three impedances between lines a–b, b–c and c–a'}
    >
      {PHASE.map((p, i) => (
        <g key={p.k}>
          <line x1={16} y1={ys[i]} x2={xT} y2={ys[i]} className="ps-3p-wire" style={{ stroke: p.color }} />
          <circle cx={xT} cy={ys[i]} r={3.5} className="ps-3p-node" />
          <text x={10} y={ys[i] + 4} className="ps-3p-sk-label" textAnchor="end">
            {p.k}
          </text>
        </g>
      ))}
      <text x={54} y={ys[0] - 10} className="ps-3p-sk-note" textAnchor="middle">
        I_a →
      </text>
      {/* V_ab between lines a and b */}
      <line x1={40} y1={ys[0] + 6} x2={40} y2={ys[1] - 6} className="ps-3p-sk-arrow" markerEnd="url(#sk-arr)" />
      <text x={46} y={(ys[0] + ys[1]) / 2 + 4} className="ps-3p-sk-note">
        V_ab
      </text>
      <defs>
        <marker id="sk-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 10 5 0 10z" className="ps-3p-sk-head" />
        </marker>
      </defs>
      {conn === 'star' ? (
        <g>
          {PHASE.map((p, i) => (
            <g key={p.k}>
              <line x1={xT} y1={ys[i]} x2={130} y2={ys[i]} className="ps-3p-wire" style={{ stroke: p.color }} />
              <Zbox x1={130} y1={ys[i]} x2={200} y2={ys[i]} label="Z" color={p.color} />
              <line x1={200} y1={ys[i]} x2={268} y2={104} className="ps-3p-wire" style={{ stroke: p.color }} />
            </g>
          ))}
          <circle cx={268} cy={104} r={4} className="ps-3p-node" />
          <text x={278} y={108} className="ps-3p-sk-label">
            N
          </text>
          <text x={165} y={203} className="ps-3p-sk-note" textAnchor="middle">
            each Z between a line and N: V_ph = V_a · I_ph = I_L
          </text>
        </g>
      ) : (
        <g>
          {/* triangle corners */}
          {(() => {
            // a and c reach the right-hand corners straight; b meets the left corner — no wire crosses another
            const A = { x: 262, y: ys[0] }
            const B = { x: 172, y: ys[1] }
            const Cc = { x: 262, y: ys[2] }
            return (
              <>
                <line x1={xT} y1={ys[0]} x2={A.x} y2={A.y} className="ps-3p-wire" style={{ stroke: PHASE[0].color }} />
                <line x1={xT} y1={ys[1]} x2={B.x} y2={B.y} className="ps-3p-wire" style={{ stroke: PHASE[1].color }} />
                <line x1={xT} y1={ys[2]} x2={Cc.x} y2={Cc.y} className="ps-3p-wire" style={{ stroke: PHASE[2].color }} />
                <Zbox x1={B.x} y1={B.y} x2={A.x} y2={A.y} label="" color="var(--text-2)" />
                <text x={196} y={66} className="ps-3p-sk-label" textAnchor="end">
                  Z (a–b)
                </text>
                <Zbox x1={B.x} y1={B.y} x2={Cc.x} y2={Cc.y} label="" color="var(--text-2)" />
                <text x={196} y={152} className="ps-3p-sk-label" textAnchor="end">
                  Z (b–c)
                </text>
                <Zbox x1={Cc.x} y1={Cc.y} x2={A.x} y2={A.y} label="" color="var(--text-2)" />
                <text x={276} y={108} className="ps-3p-sk-label">
                  Z (c–a)
                </text>
                {[A, B, Cc].map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={3.5} className="ps-3p-node" />
                ))}
                <text x={165} y={203} className="ps-3p-sk-note" textAnchor="middle">
                  each Z between two lines: V_ph = V_L · I_a = I_ab − I_ca
                </text>
              </>
            )
          })()}
        </g>
      )}
    </svg>
  )
}

// ── power triangle ────────────────────────────────────────────────────────────────────────────────────────────

export function PowerTriangle({ p, q, unit }: { p: number; q: number; unit: string }) {
  const W = 300
  const H = 190
  const s = Math.hypot(p, q)
  const maxSide = Math.max(Math.abs(p), Math.abs(q), 1e-9)
  const k = Math.min((W - 110) / Math.max(Math.abs(p), 1e-9), (H - 60) / Math.max(Math.abs(q), maxSide * 0.25))
  const ox = 30
  const oy = q >= 0 ? H - 30 : 30
  const px = ox + p * k
  const qy = oy - q * k
  const phi = (Math.atan2(q, p) * 180) / Math.PI
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="ps-3p-tri"
      role="img"
      aria-label={`Power triangle: P ${fx(p, 2)} ${unit.replace('VA', 'W')}, Q ${fx(q, 2)} ${unit.replace('VA', 'var')}, S ${fx(s, 2)} ${unit}, angle ${fx(phi, 1)} degrees`}
    >
      <line x1={ox} y1={oy} x2={px} y2={oy} className="ps-3p-tri-p" />
      <line x1={px} y1={oy} x2={px} y2={qy} className="ps-3p-tri-q" />
      <line x1={ox} y1={oy} x2={px} y2={qy} className="ps-3p-tri-s" />
      {Math.abs(phi) > 2 && (
        <path d={`M${ox + 30} ${oy} A30 30 0 0 ${q >= 0 ? 0 : 1} ${ox + 30 * Math.cos((phi * Math.PI) / 180)} ${oy - 30 * Math.sin((phi * Math.PI) / 180)}`} className="ps-3p-tri-arc" />
      )}
      <text x={ox + 36} y={oy + (q >= 0 ? -6 : 14)} className="ps-3p-sk-note">
        φ {fx(Math.abs(phi), 1)}°
      </text>
      <text x={(ox + px) / 2} y={oy + (q >= 0 ? 18 : -8)} className="ps-3p-sk-label" textAnchor="middle">
        P {sg(p, 4)} {unit.replace('VA', 'W')}
      </text>
      <text x={px + 6} y={(oy + qy) / 2 + 4} className="ps-3p-sk-label">
        Q {sg(q, 4)}
      </text>
      <text x={px + 6} y={(oy + qy) / 2 + 18} className="ps-3p-sk-note">
        {unit.replace('VA', 'var')} {q >= 0 ? '(lagging)' : '(leading)'}
      </text>
      <text x={(ox + px) / 2 - 8} y={(oy + qy) / 2 + (q >= 0 ? -8 : 16)} className="ps-3p-sk-label" textAnchor="end">
        S {sg(s, 4)} {unit}
      </text>
    </svg>
  )
}

// ── a line and its model ──────────────────────────────────────────────────────────────────────────────────────

/** One phase of the line (to neutral) in the chosen model, with its computed series impedance and shunt admittance. */
export function LineSketch({ model, Z, Y, lengthKm, gamma, zc, vs, vr }: { model: LineModel; Z: Complex; Y: Complex; lengthKm: number; gamma: Complex; zc: Complex; vs: string; vr: string }) {
  const W = 780
  const H = 176
  const top = 52
  const bot = 136
  const xa = 96
  const xb = W - 110
  const cap = (x: number, label?: string) => (
    <g key={`cap${x}`}>
      <line x1={x} y1={top} x2={x} y2={(top + bot) / 2 - 5} className="ps-3p-sk-line" />
      <line x1={x - 12} y1={(top + bot) / 2 - 5} x2={x + 12} y2={(top + bot) / 2 - 5} className="ps-3p-sk-line ps-3p-sk-plate" />
      <line x1={x - 12} y1={(top + bot) / 2 + 5} x2={x + 12} y2={(top + bot) / 2 + 5} className="ps-3p-sk-line ps-3p-sk-plate" />
      <line x1={x} y1={(top + bot) / 2 + 5} x2={x} y2={bot} className="ps-3p-sk-line" />
      {label && (
        <text x={x + 16} y={(top + bot) / 2 + 4} className="ps-3p-sk-note">
          {label}
        </text>
      )}
    </g>
  )
  const box = (x1: number, x2: number, label?: string, sub?: string) => (
    <g key={`box${x1}`}>
      <rect x={x1} y={top - 9} width={x2 - x1} height={18} rx={3} className="ps-3p-sk-box" />
      {label && (
        <text x={(x1 + x2) / 2} y={top - 16} className="ps-3p-sk-label" textAnchor="middle">
          {label}
        </text>
      )}
      {sub && (
        <text x={(x1 + x2) / 2} y={top + 4} className="ps-3p-sk-in" textAnchor="middle">
          {sub}
        </text>
      )}
    </g>
  )
  const zText = `Z = ${cx(Z.re, Z.im, 1)} Ω`
  const yHalf = `Y/2 = j${sg(Y.im / 2 / 1e-6, 4)} µS`
  let body
  if (model === 'short') {
    body = (
      <>
        <line x1={xa} y1={top} x2={xb} y2={top} className="ps-3p-sk-line" />
        {box(300, 480, zText, 'R + jX')}
        <line x1={xa} y1={bot} x2={xb} y2={bot} className="ps-3p-sk-line" />
        <text x={W / 2} y={bot + 22} className="ps-3p-sk-note" textAnchor="middle">
          shunt capacitance neglected · I_s = I_r
        </text>
      </>
    )
  } else if (model === 'medium') {
    body = (
      <>
        <line x1={xa} y1={top} x2={xb} y2={top} className="ps-3p-sk-line" />
        {box(300, 480, zText, 'R + jX')}
        {cap(200, yHalf)}
        {cap(580, yHalf)}
        <line x1={xa} y1={bot} x2={xb} y2={bot} className="ps-3p-sk-line" />
        <text x={W / 2} y={bot + 22} className="ps-3p-sk-note" textAnchor="middle">
          nominal π: the whole line’s capacitance lumped, half at each end
        </text>
      </>
    )
  } else {
    const n = 6
    const xs = Array.from({ length: n }, (_, i) => 170 + (i * (xb - 200 - 170)) / (n - 1))
    body = (
      <>
        <line x1={xa} y1={top} x2={xb} y2={top} className="ps-3p-sk-line" />
        {xs.map((x, i) => (
          <g key={i}>
            {box(x - 22, x + 22, i === 2 ? `z = ${cx(Z.re / lengthKm, Z.im / lengthKm, 3)} Ω/km` : undefined)}
            {cap(x + 40, i === n - 1 ? `y = j${sg(Y.im / lengthKm / 1e-6, 3)} µS/km` : undefined)}
          </g>
        ))}
        <line x1={xa} y1={bot} x2={xb} y2={bot} className="ps-3p-sk-line" />
        <text x={W / 2} y={bot + 22} className="ps-3p-sk-note" textAnchor="middle">
          distributed along {fx(lengthKm, 0)} km · γ = {cx(gamma.re * 1000, gamma.im * 1000, 3)} per 1000 km · Z_c = {cx(zc.re, zc.im, 1)} Ω
        </text>
      </>
    )
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ps-3p-line" role="img" aria-label={`One phase of the line, ${model} model. Sending end ${vs}; receiving end ${vr}.`}>
      {body}
      <circle cx={xa} cy={top} r={4} className="ps-3p-node" />
      <circle cx={xa} cy={bot} r={4} className="ps-3p-node" />
      <circle cx={xb} cy={top} r={4} className="ps-3p-node" />
      <circle cx={xb} cy={bot} r={4} className="ps-3p-node" />
      <line x1={xa - 30} y1={top + 8} x2={xa - 30} y2={bot - 8} className="ps-3p-sk-arrow" markerEnd="url(#ln-arr)" transform={`rotate(180 ${xa - 30} ${(top + bot) / 2})`} />
      <line x1={xb + 30} y1={top + 8} x2={xb + 30} y2={bot - 8} className="ps-3p-sk-arrow" markerEnd="url(#ln-arr)" transform={`rotate(180 ${xb + 30} ${(top + bot) / 2})`} />
      <defs>
        <marker id="ln-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0 0 10 5 0 10z" className="ps-3p-sk-head" />
        </marker>
      </defs>
      <text x={xa - 38} y={(top + bot) / 2 - 2} className="ps-3p-sk-label" textAnchor="end">
        V_s
      </text>
      <text x={xa - 38} y={(top + bot) / 2 + 13} className="ps-3p-sk-note" textAnchor="end">
        sending
      </text>
      <text x={xb + 38} y={(top + bot) / 2 - 2} className="ps-3p-sk-label">
        V_r
      </text>
      <text x={xb + 38} y={(top + bot) / 2 + 13} className="ps-3p-sk-note">
        receiving
      </text>
      <text x={xa - 8} y={18} className="ps-3p-sk-val">
        {vs}
      </text>
      <text x={xb + 8} y={18} className="ps-3p-sk-val" textAnchor="end">
        {vr}
      </text>
      <text x={W / 2} y={H - 2} className="ps-3p-sk-note" textAnchor="middle">
        one phase to neutral
      </text>
    </svg>
  )
}
