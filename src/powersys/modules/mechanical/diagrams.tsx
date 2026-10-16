import { useId, type KeyboardEvent } from 'react'
import { fx } from '../../ui/format.ts'
import { Plot } from '../../ui/Plot.tsx'
import { spanPoints, vCat, vPar, type Loads, type SpanResult, type StringResult } from './calc.ts'
import { deg, shareColor } from './shared.tsx'

/*
 * The module's 2D figures. Elevation: the side view of the span — GEOMETRY (towers, supports) and CALCULATED (the
 * catenary, the parabola, the sag and clearance dimensions); the vertical scale is exaggerated and says by how much.
 * Ladder: the insulator string as a capacitor ladder with every disc's CALCULATED voltage. LoadDiagram: the conductor
 * with its ice and the load arrows to scale (CALCULATED). CoronaSketch: an illustration (no numbers).
 */

// ── side elevation ───────────────────────────────────────────────────────────────────────────────────────────

export interface ElevationProps {
  res: SpanResult
  /** Drawn insulator-string length [m] (sets the cross-arm height; an illustration). */
  stringLen?: number
  /** A common frame for side-by-side figures: the span and height the axes cover. */
  frame?: { L: number; yMax: number }
  compact?: boolean
  label: string
  showParabola?: boolean
}

export function elevationFrame(res: SpanResult, stringLen: number) {
  return { L: res.input.L, yMax: (res.input.hA + res.input.h + stringLen) * 1.18 + 1 }
}

export function Elevation({ res, stringLen = 1, frame, compact = false, label, showParabola = true }: ElevationProps) {
  const W = 640
  const H = compact ? 250 : 310
  const m = { l: 44, r: 44, t: 26, b: 40 }
  const f = frame ?? elevationFrame(res, stringLen)
  const pw = W - m.l - m.r
  const ph = H - m.t - m.b
  const X = (x: number) => m.l + (x / f.L) * pw
  const Y = (y: number) => H - m.b - (y / f.yMax) * ph
  const s = res.input
  const pts = spanPoints(res, 160)
  const path = (p: Array<[number, number, number]>) => p.map((q, i) => `${i ? 'L' : 'M'}${X(q[0]).toFixed(1)} ${Y(q[1]).toFixed(1)}`).join('')
  const exag = ph / f.yMax / (pw / f.L)
  const exagText = Math.abs(exag - 1) < 0.05 ? 'true scale (vertical = horizontal)' : exag > 1 ? `vertical scale exaggerated ×${fx(exag, 1)}` : `vertical scale compressed ×${fx(exag, 2)}`
  const gapPx = (res.maxGap / f.yMax) * ph
  const xA = 0
  const xB = s.L
  const yA = s.hA
  const yB = s.hA + s.h
  const low = res.low
  const level = s.h === 0
  const warnClear = res.clearance < s.minClear
  const fs = compact ? 'mech-svg-text is-compact' : 'mech-svg-text'
  const tower = (x: number, yAttach: number, key: string) => {
    const top = yAttach + stringLen
    const cx = X(x)
    const yb = Y(0)
    const yt = Y(top)
    const hb = 9
    const ht = 4
    const lv = Math.max(2, Math.round((yb - yt) / 26))
    const rungs = Array.from({ length: lv + 1 }, (_, i) => {
      const y = yb + ((yt - yb) * i) / lv
      const hw = hb + ((ht - hb) * i) / lv
      return { y, hw }
    })
    return (
      <g key={key} className="mech-tower2d" aria-hidden="true">
        <path d={`M${cx - hb} ${yb} L${cx - ht} ${yt} L${cx + ht} ${yt} L${cx + hb} ${yb}`} />
        {rungs.slice(0, -1).map((r, i) => (
          <g key={i}>
            <line x1={cx - r.hw} y1={r.y} x2={cx + rungs[i + 1].hw} y2={rungs[i + 1].y} />
            <line x1={cx + r.hw} y1={r.y} x2={cx - rungs[i + 1].hw} y2={rungs[i + 1].y} />
          </g>
        ))}
        <line x1={cx - 13} y1={yt} x2={cx + 13} y2={yt} className="mech-arm2d" />
        <line x1={cx} y1={yt} x2={cx} y2={Y(yAttach)} className="mech-string2d" />
      </g>
    )
  }
  const lx = X(low.x)
  const ly = Y(low.y)
  const labelSide = low.x > s.L * 0.72 ? -1 : 1
  const anchor = labelSide > 0 ? 'start' : 'end'
  return (
    <figure className={`mech-figure mech-elev ${compact ? 'is-compact' : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <line x1={m.l - 20} x2={W - m.r + 20} y1={Y(0)} y2={Y(0)} className="mech-ground2d" />
        {Array.from({ length: 30 }, (_, i) => (
          <line key={i} x1={m.l - 20 + i * 20} y1={Y(0) + 1} x2={m.l - 28 + i * 20} y2={Y(0) + 8} className="mech-hatch2d" />
        ))}
        {/* minimum clearance */}
        <line x1={X(0)} x2={X(s.L)} y1={Y(s.minClear)} y2={Y(s.minClear)} className={`mech-minclear ${warnClear ? 'is-bad' : ''}`} />
        <text x={X(s.L) - 4} y={Y(s.minClear) - 4} textAnchor="end" className={fs}>
          minimum clearance {fx(s.minClear, 1)} m
        </text>
        {tower(xA, yA, 'a')}
        {tower(xB, yB, 'b')}
        {/* curves */}
        {showParabola && <path d={path(pts.par)} className="mech-par" />}
        <path d={path(pts.cat)} className="mech-cat" />
        {/* sag dimension(s) */}
        {
          <g className="mech-dim">
            <line x1={X(xA)} x2={lx} y1={Y(yA)} y2={Y(yA)} className="mech-ref" />
            {res.vSagA > 1e-6 && <line x1={lx} x2={lx} y1={Y(yA)} y2={ly} className="mech-dimline" />}
            {res.vSagA > 1e-6 && (
              <text x={lx + 6 * labelSide} y={(Y(yA) + ly) / 2 + 4} textAnchor={anchor} className={`${fs} is-value`}>
                {level ? 'sag' : 'S₁'} {fx(res.vSagA, 2)} m
              </text>
            )}
            {!level && (
              <>
                <line x1={lx} x2={X(xB)} y1={Y(yB)} y2={Y(yB)} className="mech-ref" />
                <line x1={lx + 12 * labelSide} x2={lx + 12 * labelSide} y1={Y(yB)} y2={ly} className="mech-dimline" />
                <text x={lx + 18 * labelSide} y={(Y(yB) + Y(yA)) / 2 + 4} textAnchor={anchor} className={`${fs} is-value`}>
                  S₂ {fx(res.vSagB, 2)} m
                </text>
              </>
            )}
          </g>
        }
        {/* clearance */}
        <g className="mech-dim">
          <line x1={lx} x2={lx} y1={ly} y2={Y(0)} className={`mech-clearline ${warnClear ? 'is-bad' : ''}`} />
          <text x={lx + 6 * labelSide} y={(ly + Y(0)) / 2 + 4} textAnchor={anchor} className={`${fs} is-value ${warnClear ? 'is-bad' : ''}`}>
            clearance {fx(res.clearance, 2)} m
          </text>
        </g>
        <circle cx={lx} cy={ly} r={4} className="mech-lowdot" />
        {/* supports */}
        <text x={X(xA)} y={Y(yA + stringLen) - 9} textAnchor="middle" className={fs}>
          A {fx(yA, 1)} m
        </text>
        <text x={X(xB)} y={Y(yB + stringLen) - 9} textAnchor="middle" className={fs}>
          B {fx(yB, 1)} m
        </text>
        {/* span */}
        <line x1={X(xA)} x2={X(xB)} y1={H - 14} y2={H - 14} className="mech-dimline" />
        <line x1={X(xA)} x2={X(xA)} y1={H - 19} y2={H - 9} className="mech-dimline" />
        <line x1={X(xB)} x2={X(xB)} y1={H - 19} y2={H - 9} className="mech-dimline" />
        <text x={(X(xA) + X(xB)) / 2} y={H - 18} textAnchor="middle" className={`${fs} is-value`}>
          span {fx(s.L, 0)} m
        </text>
        {/* key */}
        <g transform={`translate(${m.l - 20}, 12)`}>
          <line x1={0} x2={22} y1={0} y2={0} className="mech-cat" />
          <text x={28} y={4} className={fs}>
            catenary
          </text>
          {showParabola && (
            <>
              <line x1={96} x2={118} y1={0} y2={0} className="mech-par" />
              <text x={124} y={4} className={fs}>
                parabola
              </text>
            </>
          )}
        </g>
        <text x={W - m.r + 20} y={16} textAnchor="end" className={`${fs} mech-kind`}>
          {exagText}
        </text>
      </svg>
      {!compact && (
        <figcaption className="small muted">
          Side view, calculated.{' '}
          {showParabola
            ? `The two curves differ by at most ${res.maxGap < 0.01 ? `${fx(res.maxGap * 1000, 1)} mm` : `${fx(res.maxGap * 100, 1)} cm`} — ${gapPx < 1 ? 'less than a pixel here, so they look like one line' : 'visible at this scale'}. `
            : ''}
          {res.loads.theta > 0 ? `The wind also swings the conductor ${fx(res.low.z, 2)} m sideways (θ = ${fx(deg(res.loads.theta), 1)}°); this view shows its height. ` : ''}
          Towers and insulator strings are drawn for recognition.
        </figcaption>
      )}
    </figure>
  )
}

/** Parabola minus catenary along the span (in the plane of the load). */
export function GapPlot({ res, height = 200 }: { res: SpanResult; height?: number }) {
  const N = 80
  const unit = res.maxGap < 0.01 ? 'mm' : 'cm'
  const k = unit === 'mm' ? 1000 : 100
  const pts: Array<[number, number]> = Array.from({ length: N + 1 }, (_, i) => {
    const u = (res.Lp * i) / N
    return [u * res.uHat[0], (vPar(res.par, res.T0, res.loads.wr, u) - vCat(res.cat, u)) * k]
  })
  return (
    <Plot
      label="Height of the parabola minus height of the catenary along the span"
      xLabel="distance from support A [m]"
      yLabel={`parabola − catenary [${unit}]`}
      series={[{ id: 'gap', label: 'difference', color: 'var(--accent)', points: pts }]}
      height={height}
    />
  )
}

// ── the insulator ladder ─────────────────────────────────────────────────────────────────────────────────────

export function Ladder({
  str,
  selected = null,
  onSelect,
  compact = false,
  label,
}: {
  str: StringResult
  selected?: number | null
  onSelect?(k: number | null): void
  compact?: boolean
  label: string
}) {
  const n = str.input.n
  const rowH = compact ? 27 : 36
  const y0 = 34
  const W = 640
  const H = y0 + n * rowH + 44
  const towerX = 44
  const sx = 160
  const gx = 214
  const nameX = 240
  const kvX = 376
  const pctX = 436
  const barX = 450
  const barW = 150
  const ny = (k: number) => y0 + k * rowH
  const vmax = Math.max(...str.discV)
  const guard = str.lineC.some((c) => c > 0)
  const graded = str.input.grading === 'capacitance'
  const fs = compact ? 'mech-svg-text is-compact' : 'mech-svg-text'
  const eqX = barX + (str.V / n / vmax) * barW
  const key = (e: KeyboardEvent, k: number) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect?.(selected === k ? null : k)
    }
  }
  return (
    <figure className={`mech-figure mech-ladder ${compact ? 'is-compact' : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {/* tower and cross-arm (earth) */}
        <line x1={towerX} x2={towerX} y1={y0 - 10} y2={ny(n) + 14} className="mech-earthbar" />
        <line x1={towerX} x2={sx} y1={y0} y2={y0} className="mech-earthbar" />
        <text x={towerX + 6} y={y0 - 8} className={fs}>
          cross-arm · earthed
        </text>
        <text x={towerX - 6} y={ny(n) + 30} textAnchor="middle" className={fs}>
          tower
        </text>
        {/* string nodes and discs */}
        {str.discV.map((v, i) => {
          const k = i + 1
          const ya = ny(i)
          const yb = ny(k)
          const ym = (ya + yb) / 2
          const col = shareColor(v / (str.V / n))
          const isSel = selected === k
          return (
            <g
              key={k}
              className={`mech-disc2d ${isSel ? 'is-sel' : ''} ${onSelect ? 'is-btn' : ''}`}
              role={onSelect ? 'button' : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-pressed={onSelect ? isSel : undefined}
              aria-label={`Disc ${k}: ${fx(v, 2)} kV, ${fx((v / str.V) * 100, 1)} % of the phase voltage`}
              onClick={onSelect ? () => onSelect(isSel ? null : k) : undefined}
              onKeyDown={onSelect ? (e) => key(e, k) : undefined}
            >
              <rect x={sx - 24} y={ya + 2} width={W - sx + 16} height={rowH - 4} className="mech-row-hit" rx={5} />
              <line x1={sx} x2={sx} y1={ya} y2={ym - 4} className="mech-wire2d" />
              <line x1={sx} x2={sx} y1={ym + 4} y2={yb} className="mech-wire2d" />
              <line x1={sx - 12} x2={sx + 12} y1={ym - 4} y2={ym - 4} className="mech-plate" style={{ stroke: col }} />
              <line x1={sx - 12} x2={sx + 12} y1={ym + 4} y2={ym + 4} className="mech-plate" style={{ stroke: col }} />
              <text x={nameX} y={ym + 4} className={fs}>
                Disc {k}
                {compact ? '' : k === 1 ? ' · top' : k === n ? ' · line' : ''}
                {graded && !compact ? `  C ${fx(str.discC[i], 2)}` : ''}
              </text>
              <text x={kvX} y={ym + 4} textAnchor="end" className={`${fs} is-value`}>
                {fx(v, 2)} kV
              </text>
              <text x={pctX} y={ym + 4} textAnchor="end" className={`${fs} is-value`}>
                {fx((v / str.V) * 100, 1)} %
              </text>
              <rect x={barX} y={ym - 6} width={Math.max(1, (v / vmax) * barW)} height={12} rx={2} style={{ fill: col }} />
            </g>
          )
        })}
        {/* equal-share marker */}
        <line x1={eqX} x2={eqX} y1={y0 - 6} y2={ny(n) + 4} className="mech-eqline" />
        <text x={eqX} y={y0 - 10} textAnchor={eqX > W - 110 ? 'end' : 'middle'} className={fs}>
          equal share {fx(str.V / n, 2)} kV
        </text>
        {/* shunt capacitances: each link to the tower */}
        {Array.from({ length: n - 1 }, (_, j) => {
          const y = ny(j + 1)
          const cx = (towerX + sx) / 2
          return (
            <g key={`s${j}`} className="mech-shunt">
              <line x1={towerX} x2={cx - 4} y1={y} y2={y} className="mech-wire2d is-thin" />
              <line x1={cx - 4} x2={cx - 4} y1={y - 8} y2={y + 8} className="mech-plate is-shunt" />
              <line x1={cx + 4} x2={cx + 4} y1={y - 8} y2={y + 8} className="mech-plate is-shunt" />
              <line x1={cx + 4} x2={sx} y1={y} y2={y} className="mech-wire2d is-thin" />
              <circle cx={sx} cy={y} r={2.6} className="mech-node" />
              {j === 0 && (
                <text x={cx} y={y - 11} textAnchor="middle" className={fs}>
                  mC
                </text>
              )}
            </g>
          )
        })}
        {/* guard ring: line-to-link capacitances */}
        {guard && (
          <g className="mech-guard">
            <line x1={gx} x2={gx} y1={ny(1) - 6} y2={ny(n)} className="mech-wire2d is-guard" />
            {str.lineC.map((c, j) => {
              const y = ny(j + 1)
              const cx = (sx + gx) / 2
              return (
                <g key={`g${j}`}>
                  <line x1={sx} x2={cx - 3} y1={y} y2={y} className="mech-wire2d is-thin" />
                  <line x1={cx - 3} x2={cx - 3} y1={y - 6} y2={y + 6} className="mech-plate is-guard" />
                  <line x1={cx + 3} x2={cx + 3} y1={y - 6} y2={y + 6} className="mech-plate is-guard" />
                  <line x1={cx + 3} x2={gx} y1={y} y2={y} className="mech-wire2d is-thin" />
                  {j === 0 && (
                    <text x={gx + 13} y={(ny(1) + ny(n)) / 2} textAnchor="middle" transform={`rotate(-90 ${gx + 13} ${(ny(1) + ny(n)) / 2})`} className={fs}>
                      guard ring
                    </text>
                  )}
                  <title>{`C_g,${j + 1} = ${fx(c, 3)} C`}</title>
                </g>
              )
            })}
          </g>
        )}
        {/* the line */}
        <line x1={sx - 40} x2={guard ? gx + 10 : sx + 40} y1={ny(n)} y2={ny(n)} className="mech-linebar" />
        <text x={sx - 44} y={ny(n) + 4} textAnchor="end" className={fs}>
          line
        </text>
        <text x={nameX} y={ny(n) + 24} className={fs}>
          phase voltage V = {fx(str.V, 2)} kV · η = {fx(str.eff * 100, 1)} %
        </text>
      </svg>
    </figure>
  )
}

/** A colour key for the disc shares, with every disc's value (colour is never the only cue). */
export function ShareLegend({ str, selected, onSelect }: { str: StringResult; selected?: number | null; onSelect?(k: number | null): void }) {
  const n = str.input.n
  return (
    <div className="mech-legend">
      <div className="mech-legend-scale" aria-hidden="true">
        <span>½× equal share</span>
        <span className="mech-legend-bar" />
        <span>2× equal share</span>
      </div>
      <ul className="mech-legend-chips" aria-label="Voltage on each disc">
        {str.discV.map((v, i) => (
          <li key={i}>
            <button type="button" className={`mech-chip ${selected === i + 1 ? 'on' : ''}`} aria-pressed={selected === i + 1} onClick={() => onSelect?.(selected === i + 1 ? null : i + 1)}>
              <span className="mech-chip-sw" style={{ background: shareColor(v / (str.V / n)) }} aria-hidden="true" />
              {i + 1}: {fx(v, 2)} kV · {fx((v / str.V) * 100, 1)} %
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── loads on the conductor ───────────────────────────────────────────────────────────────────────────────────

export function LoadDiagram({ loads, d, t, p }: { loads: Loads; d: number; t: number; p: number }) {
  const W = 560
  const H = 250
  const mid = useId()
  const cx = 110
  const cy = 125
  const rOut = 62
  const pxm = rOut / (d / 2 + t)
  const rc = (d / 2) * pxm
  const ox = 300
  const oy = 34
  const k = Math.min(180 / loads.wv, loads.ww > 0 ? 200 / loads.ww : Infinity)
  const yW = oy + loads.w * k
  const yV = oy + loads.wv * k
  const xH = ox + loads.ww * k
  const th = loads.theta
  const arcR = 34
  return (
    <figure className="mech-figure">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The conductor with its ice, and the loads per metre drawn to scale">
        <defs>
          <marker id={`${mid}-a`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="mech-arrowhead" />
          </marker>
        </defs>
        {/* cross-section */}
        {t > 0 && <circle cx={cx} cy={cy} r={rOut} className="mech-ice2d" />}
        <circle cx={cx} cy={cy} r={rc} className="mech-cond2d" />
        <text x={cx} y={cy + rOut + 18} textAnchor="middle" className="mech-svg-text">
          d = {fx(d * 1000, 1)} mm{t > 0 ? ` · ice t = ${fx(t * 1000, 1)} mm` : ''}
        </text>
        {p > 0 && [-30, 0, 30].map((dy) => <line key={dy} x1={cx - rOut - 46} x2={cx - rOut - 10} y1={cy + dy} y2={cy + dy} className="mech-windarrow" markerEnd={`url(#${mid}-a)`} />)}
        {p > 0 && (
          <text x={cx - rOut - 46} y={cy - 40} className="mech-svg-text">
            wind {fx(p, 0)} N/m²
          </text>
        )}
        {/* force triangle */}
        <line x1={ox} x2={ox} y1={oy} y2={yW} className="mech-force is-w" markerEnd={`url(#${mid}-a)`} />
        <text x={ox - 8} y={(oy + yW) / 2 + 4} textAnchor="end" className="mech-svg-text is-value">
          w {fx(loads.w, 2)} N/m
        </text>
        {loads.wi > 0 && (
          <>
            <line x1={ox} x2={ox} y1={yW} y2={yV} className="mech-force is-ice" markerEnd={`url(#${mid}-a)`} />
            <text x={ox - 8} y={(yW + yV) / 2 + 4} textAnchor="end" className="mech-svg-text is-value">
              w_i {fx(loads.wi, 2)} N/m
            </text>
          </>
        )}
        {loads.ww > 0 && (
          <>
            <line x1={ox} x2={xH} y1={yV} y2={yV} className="mech-force is-wind" markerEnd={`url(#${mid}-a)`} />
            <text x={(ox + xH) / 2} y={yV + 18} textAnchor="middle" className="mech-svg-text is-value">
              w_w {fx(loads.ww, 2)} N/m
            </text>
            <line x1={ox} x2={xH} y1={oy} y2={yV} className="mech-force is-res" markerEnd={`url(#${mid}-a)`} />
            <text x={(ox + xH) / 2 + 10} y={(oy + yV) / 2} className="mech-svg-text is-value">
              w_r {fx(loads.wr, 2)} N/m
            </text>
            <path d={`M${ox} ${oy + arcR} A${arcR} ${arcR} 0 0 0 ${ox + arcR * Math.sin(th)} ${oy + arcR * Math.cos(th)}`} className="mech-arc" />
            <text x={ox + (arcR + 8) * Math.sin(th / 2) + 4} y={oy + (arcR + 8) * Math.cos(th / 2) + 4} className="mech-svg-text is-value">
              θ {fx(deg(th), 1)}°
            </text>
          </>
        )}
      </svg>
      <figcaption className="small muted">Calculated: the arrows are to scale ({fx(1 / k, 3)} N/m per pixel); the ice ring is to scale with the conductor.</figcaption>
    </figure>
  )
}

// ── corona (illustration) ────────────────────────────────────────────────────────────────────────────────────

export function CoronaSketch() {
  const gid = useId()
  return (
    <figure className="mech-figure">
      <svg viewBox="0 -6 560 212" role="img" aria-label="Illustration: the field is strongest at a thin conductor's surface; the air there ionises and glows">
        <defs>
          <radialGradient id={gid}>
            <stop offset="35%" stopColor="rgba(158,197,255,0.55)" />
            <stop offset="100%" stopColor="rgba(158,197,255,0)" />
          </radialGradient>
        </defs>
        {Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2
          return <line key={i} x1={150 + 18 * Math.cos(a)} y1={100 + 18 * Math.sin(a)} x2={150 + 76 * Math.cos(a)} y2={100 + 76 * Math.sin(a)} className="mech-fieldline" />
        })}
        <circle cx={150} cy={100} r={40} fill={`url(#${gid})`} />
        <circle cx={150} cy={100} r={16} className="mech-cond2d" />
        <text x={150} y={196} textAnchor="middle" className="mech-svg-text">
          field lines crowd at the surface
        </text>
        {Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2
          return <line key={i} x1={410 + 46 * Math.cos(a)} y1={100 + 46 * Math.sin(a)} x2={410 + 80 * Math.cos(a)} y2={100 + 80 * Math.sin(a)} className="mech-fieldline" />
        })}
        <circle cx={410} cy={100} r={44} className="mech-cond2d" />
        <text x={410} y={196} textAnchor="middle" className="mech-svg-text">
          a fatter conductor spreads them out
        </text>
        <text x={280} y={8} textAnchor="middle" className="mech-svg-text mech-kind">
          illustration — not to scale, no values
        </text>
      </svg>
    </figure>
  )
}
