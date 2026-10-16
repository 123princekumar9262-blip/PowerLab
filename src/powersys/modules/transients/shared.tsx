import { useEffect, useMemo, useRef, useState } from 'react'
import { fx } from '../../ui/format.ts'
import { Callout, useReducedMotion } from '../../ui/kit.tsx'
import { analyse, makeField, maxAbsV, nextMedium, profile, TERM_LABEL, type Analysis, type Field, type Outcome, type WaveModel } from './waves.ts'

export const MODULE = 'transients'

/** kV with one decimal; A with none; Γ with three. */
export const kv = (x: number, d = 1) => `${fx(x, d)} kV`
export const amps = (x: number) => `${fx(x, 0)} A`
export const us = (x: number, d = 2) => `${fx(x, d)} µs`
export const signed = (x: number, d = 3) => `${x > 0 ? '+' : ''}${fx(x, d)}`

export interface Solved {
  out: Outcome
  an: Analysis | null
  f: Field | null
  vmax: number
}
export function solve(m: WaveModel): Solved {
  const out = analyse(m)
  if (!out.ok) return { out, an: null, f: null, vmax: 1 }
  const f = makeField(out)
  return { out, an: out, f, vmax: Math.max(1e-9, maxAbsV(f)) }
}
export function useSolved(m: WaveModel): Solved {
  return useMemo(() => solve(m), [m])
}

/** The termination in words, for the current model. */
export function termName(m: WaveModel, an: Analysis | null): string {
  switch (m.term) {
    case 'open':
      return 'open end'
    case 'short':
      return 'short-circuited end'
    case 'matched':
      return an ? `matched resistor (${fx(an.zc, 1)} Ω)` : 'matched resistor'
    case 'resistor':
      return `resistor of ${fx(m.rl, 0)} Ω`
    case 'junction':
      return `junction with a long ${nextMedium(m).kind === 'cable' ? 'cable' : 'overhead line'} (${fx(nextMedium(m).zc, 1)} Ω)`
  }
  return TERM_LABEL[m.term]
}

/** Playback of the time cursor: about one travel time per second; none under reduced motion. */
export function usePlayback(window: number, T: number, key: unknown, start = 0) {
  const reduced = useReducedMotion()
  const [t, setTState] = useState(start)
  const [playing, setPlaying] = useState(false)
  const tRef = useRef(start)
  const setT = (v: number) => {
    tRef.current = v
    setTState(v)
  }
  useEffect(() => {
    setPlaying(false)
    const v = Math.min(window, tRef.current)
    tRef.current = v
    setTState(v)
  }, [key, window])
  useEffect(() => {
    if (!playing || reduced) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const n = Math.min(window, tRef.current + dt * T)
      tRef.current = n
      setTState(n)
      if (n >= window) setPlaying(false)
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, window, T, reduced])
  return { t, setT, playing: playing && !reduced, setPlaying }
}

/** Invalid inputs: the reasons, and no numbers. */
export function InvalidModel({ out }: { out: Outcome }) {
  if (out.ok) return null
  return (
    <Callout tone="bad" title="These inputs cannot be solved — no results">
      <ul className="tr-issues">
        {out.issues.map((i, k) => (
          <li key={k}>{i.message}</li>
        ))}
      </ul>
    </Callout>
  )
}

/** Values at five points along the line (0, ¼, ½, ¾, 1 of ℓ) — exposed for tests of the 2D/3D synchronisation. */
export function quartiles(pts: Array<[number, number]>): string {
  const n = pts.length - 1
  return [0, 0.25, 0.5, 0.75, 1].map((q) => pts[Math.round(q * n)][1].toFixed(2)).join(',')
}

// ── the 2D line view (the 3D scene's fallback, and the 2D picture of the same model) ───────────────────────────

/**
 * Side view: source, line, termination, arrester and probe, with the voltage wave v(x, t) drawn above the line from
 * the same profile() as the 3D wave and the snapshot chart (CALCULATED); the symbols are schematic.
 */
export function LineView2D({ s, t, probeX, label, compact }: { s: Solved; t: number; probeX: number; label?: string; compact?: boolean }) {
  const W = 640
  const H = compact ? 200 : 240
  const x0 = 92
  const x1 = W - 110
  const yl = H * 0.62
  const amp = H * 0.4
  if (!s.an || !s.f) return <p className="small muted">No picture: the inputs are not valid.</p>
  const an = s.an
  const m = an.model
  const pts = profile(s.f, t, 240)
  const X = (km: number) => x0 + (km / m.lengthKm) * (x1 - x0)
  const Yv = (v: number) => yl - (v / s.vmax) * amp
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Yv(p[1]).toFixed(1)}`).join('')
  const fill = `${path}L${X(m.lengthKm)} ${yl}L${X(0)} ${yl}Z`
  const vEnd = pts[pts.length - 1][1]
  const xp = X(probeX / 1000)
  const vp = s.f.v(probeX, t)
  const ground = H - 18
  return (
    <figure className="tr-lineview" data-wave={quartiles(pts)} data-t={t.toFixed(4)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label ?? `The line at t = ${fx(t, 2)} µs: the voltage wave along it`}>
        <line x1={20} x2={W - 20} y1={ground} y2={ground} className="tr-ground" />
        {/* source */}
        <g className="tr-sym">
          <circle cx={36} cy={yl} r={16} />
          <path d={`M26 ${yl} q5 -9 10 0 t10 0`} />
          <line x1={36} x2={36} y1={yl + 16} y2={ground} />
          <rect x={58} y={yl - 6} width={24} height={12} />
          <line x1={52} x2={58} y1={yl} y2={yl} />
          <line x1={82} x2={x0} y1={yl} y2={yl} />
          <text x={36} y={yl - 24} textAnchor="middle" className="tr-sym-text">
            e(t)
          </text>
          <text x={70} y={yl - 12} textAnchor="middle" className="tr-sym-text">
            R_s {fx(m.rs, 0)} Ω
          </text>
        </g>
        {/* the wave */}
        <path d={fill} className="tr-wave-fill" />
        <path d={path} className="tr-wave-line" />
        {/* the line */}
        <line x1={x0} x2={x1} y1={yl} y2={yl} className={`tr-conductor ${an.line.kind === 'cable' ? 'is-cable' : ''}`} />
        <text x={(x0 + x1) / 2} y={yl + 18} textAnchor="middle" className="tr-sym-text muted">
          {an.line.short} · Z_c {fx(an.zc, 1)} Ω · ℓ {fx(m.lengthKm, 1)} km
        </text>
        {/* termination */}
        <g className="tr-sym">
          {m.term === 'open' && <circle cx={x1 + 4} cy={yl} r={3} />}
          {m.term === 'short' && <line x1={x1} x2={x1} y1={yl} y2={ground} className="tr-strap" />}
          {(m.term === 'matched' || m.term === 'resistor') && (
            <>
              <line x1={x1} x2={x1 + 24} y1={yl} y2={yl} />
              <rect x={x1 + 18} y={yl + 10} width={12} height={34} />
              <line x1={x1 + 24} x2={x1 + 24} y1={yl} y2={yl + 10} />
              <line x1={x1 + 24} x2={x1 + 24} y1={yl + 44} y2={ground} />
            </>
          )}
          {m.term === 'junction' && (
            <>
              <line x1={x1} x2={W - 24} y1={yl} y2={yl} className={`tr-conductor ${an.line.kind === 'cable' ? '' : 'is-cable'}`} strokeDasharray="6 4" />
            </>
          )}
          <text x={x1 + 8} y={yl - 30} className="tr-sym-text">
            {termShort(m)}
          </text>
        </g>
        {m.arrester && (
          <g className="tr-sym tr-arrester">
            <line x1={x1 - 8} x2={x1 - 8} y1={yl} y2={yl + 14} />
            <rect x={x1 - 14} y={yl + 14} width={12} height={30} />
            <path d={`M${x1 - 12} ${yl + 22} l8 6 l-8 6`} />
            <line x1={x1 - 8} x2={x1 - 8} y1={yl + 44} y2={ground} />
          </g>
        )}
        {/* probe */}
        <g className="tr-probe2d">
          <line x1={xp} x2={xp} y1={yl - amp - 6} y2={yl + 8} />
          <circle cx={xp} cy={Yv(vp)} r={4} />
          <text x={xp} y={ground + 13} textAnchor="middle">
            probe {fx(vp, 0)} kV
          </text>
        </g>
        <text x={x1 - 4} y={Yv(vEnd) + (vEnd >= 0 ? -6 : 14)} textAnchor="end" className="tr-val">
          v(ℓ) {fx(vEnd, 0)} kV
        </text>
        <text x={x0} y={16} className="tr-sym-text muted">
          t = {fx(t, 2)} µs · wave height to scale: {fx(s.vmax, 0)} kV full height
        </text>
      </svg>
    </figure>
  )
}

export function termShort(m: WaveModel): string {
  switch (m.term) {
    case 'open':
      return 'open end'
    case 'short':
      return 'short to earth'
    case 'matched':
      return 'R = Z_c'
    case 'resistor':
      return `R_L ${fx(m.rl, 0)} Ω`
    case 'junction':
      return nextMedium(m).kind === 'cable' ? 'into a cable' : 'into a line'
  }
}
