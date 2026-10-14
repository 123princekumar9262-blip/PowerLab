import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react'
import { fx } from '../../ui/format.ts'
import { bundleOffsets, bundleRadius, dist, minPhaseSpacing, PHASES, type Design, type GeometryIssue, type LineResult, type PhaseIndex, type Pt } from './calc.ts'

/*
 * The line's cross-section, drawn to scale (GEOMETRY): the three phase bundles at their positions above the ground,
 * the spacings D_ab, D_bc, D_ca and the heights the calculation uses, the image conductors below the ground (earth
 * effect) and an enlarged bundle with its GMR circle. Editable: drag a phase, or focus it and use the arrow keys.
 */

export const PHASE_VAR = ['var(--ps-a)', 'var(--ps-b)', 'var(--ps-c)']
export type Highlight = 'gmd' | 'gmr' | 'height' | null

interface Win {
  x1: number
  y0: number
  y1: number
}

const W = 640
const PAD = { l: 44, r: 16, t: 16, b: 34 }
const HANDLE = 13

function windowFor(phases: Pt[], images: boolean, compact = false): Win {
  const xm = Math.max(...phases.map((p) => Math.abs(p.x)))
  const ym = Math.max(...phases.map((p) => p.y))
  const x1 = compact ? Math.ceil((xm + 4) / 2) * 2 : Math.max(24, Math.ceil((xm + 2) / 4) * 4)
  const y1 = compact ? Math.ceil((ym + 6) / 2) * 2 : Math.max(images ? 30 : 40, Math.ceil((ym + (images ? 8 : 2)) / 10) * 10)
  return { x1, y0: images ? -Math.ceil((ym + 3) / 10) * 10 : 0, y1 }
}

export function CrossSection({
  design,
  res,
  issues = [],
  editable = false,
  onMove,
  selected = null,
  onSelect,
  highlight = null,
  showImages = false,
  compact = false,
  frame,
  label,
}: {
  design: Design
  res: LineResult | null
  issues?: GeometryIssue[]
  editable?: boolean
  onMove?(k: PhaseIndex, p: Pt): void
  selected?: PhaseIndex | null
  onSelect?(k: PhaseIndex | null): void
  highlight?: Highlight
  showImages?: boolean
  compact?: boolean
  /** Positions the drawing must include (to draw two designs at one scale). */
  frame?: Pt[]
  label: string
}) {
  const g = design.geometry
  const svg = useRef<SVGSVGElement>(null)
  const frozen = useRef<Win | null>(null)
  const [drag, setDrag] = useState<PhaseIndex | null>(null)
  const images = showImages && design.options.earth
  const win = frozen.current ?? windowFor([...g.phases, ...(frame ?? [])], images, compact)
  const k = (W - PAD.l - PAD.r) / (2 * win.x1)
  const H = (win.y1 - win.y0) * k + PAD.t + PAD.b
  const sx = (x: number) => PAD.l + (x + win.x1) * k
  const sy = (y: number) => PAD.t + (win.y1 - y) * k
  const bad = new Set(issues.flatMap((i) => i.phases ?? []))
  const tooClose = issues.filter((i) => i.kind === 'spacing').flatMap((i) => i.phases ?? [])

  const clampPt = (p: Pt): Pt => ({
    x: Math.round(Math.max(-win.x1 + 2, Math.min(win.x1 - 2, p.x)) * 10) / 10,
    y: Math.round(Math.max(0.5, Math.min(win.y1 - 2, p.y)) * 10) / 10,
  })
  const toWorld = (e: PointerEvent): Pt | null => {
    const el = svg.current
    const m = el?.getScreenCTM()
    if (!el || !m) return null
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return { x: (pt.x - PAD.l) / k - win.x1, y: win.y1 - (pt.y - PAD.t) / k }
  }
  const onKey = (ph: PhaseIndex) => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.1
    const p = g.phases[ph]
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key]
    if (!d || !onMove) return
    e.preventDefault()
    onMove(ph, clampPt({ x: p.x + d[0], y: p.y + d[1] }))
  }

  // grid
  const grid: ReactElement[] = []
  for (let x = -win.x1; x <= win.x1; x += 2) {
    const major = x % 10 === 0
    grid.push(<line key={`gx${x}`} x1={sx(x)} x2={sx(x)} y1={sy(win.y1)} y2={sy(win.y0)} className={major ? 'lp-grid lp-grid--major' : 'lp-grid'} />)
    if (major && !compact)
      grid.push(
        <text key={`tx${x}`} x={sx(x)} y={H - 18} className="lp-tick" textAnchor="middle">
          {x}
        </text>,
      )
  }
  for (let y = win.y0; y <= win.y1; y += 2) {
    const major = y % 10 === 0
    grid.push(<line key={`gy${y}`} x1={sx(-win.x1)} x2={sx(win.x1)} y1={sy(y)} y2={sy(y)} className={major ? 'lp-grid lp-grid--major' : 'lp-grid'} />)
    if (major && !compact)
      grid.push(
        <text key={`ty${y}`} x={PAD.l - 6} y={sy(y) + 4} className="lp-tick" textAnchor="end">
          {y}
        </text>,
      )
  }

  // dimension lines between phases (offset when the third phase sits on the line)
  const pairs: Array<[PhaseIndex, PhaseIndex, string, number | undefined]> = [
    [0, 1, 'D_ab', res?.dab],
    [1, 2, 'D_bc', res?.dbc],
    [2, 0, 'D_ca', res?.dca],
  ]
  const dims = pairs.map(([i, j, name, val]) => {
    const third = g.phases[3 - i - j]
    const a = g.phases[i]
    const b = g.phases[j]
    const ax = sx(a.x)
    const ay = sy(a.y)
    const bx = sx(b.x)
    const by = sy(b.y)
    const len = Math.hypot(bx - ax, by - ay) || 1
    // unit normal pointing up (or right for a vertical line)
    let nx = -(by - ay) / len
    let ny = (bx - ax) / len
    if (ny > 0 || (Math.abs(ny) < 1e-6 && nx < 0)) {
      nx = -nx
      ny = -ny
    }
    if (Math.abs(by - ay) > Math.abs(bx - ax) * 3) {
      // mostly vertical: put dimensions to the right
      nx = 1
      ny = 0
    }
    const t = ((third.x - a.x) * (b.x - a.x) + (third.y - a.y) * (b.y - a.y)) / (dist(a, b) ** 2 || 1)
    const foot = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
    const onLine = t > 0 && t < 1 && dist(foot, third) < 1.2
    const off = onLine ? 40 : 0
    const p1 = { x: ax + nx * off, y: ay + ny * off }
    const p2 = { x: bx + nx * off, y: by + ny * off }
    const mid = { x: (p1.x + p2.x) / 2 + nx * 13, y: (p1.y + p2.y) / 2 + ny * 13 }
    const vertical = nx === 1 && ny === 0
    return (
      <g key={name} className={`lp-dim ${highlight === 'gmd' ? 'is-hl' : ''} ${selected !== null && (selected === i || selected === j) ? 'is-sel' : ''}`}>
        {off > 0 && (
          <>
            <line x1={ax} y1={ay} x2={p1.x} y2={p1.y} className="lp-dim-ext" />
            <line x1={bx} y1={by} x2={p2.x} y2={p2.y} className="lp-dim-ext" />
          </>
        )}
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} className="lp-dim-line" />
        {val !== undefined && (
          <text x={mid.x} y={mid.y + 4} textAnchor={vertical ? 'start' : 'middle'} className="lp-dim-text">
            {name.replace('_', '')} {fx(val, 2)} m
          </text>
        )}
      </g>
    )
  })

  // heights
  const heights = g.phases.map((p, i) => {
    const stacked = g.phases.some((q, j) => j !== i && Math.abs(q.x - p.x) < 3 && q.y < p.y)
    return (
      <g key={`h${i}`} className={`lp-height ${highlight === 'height' ? 'is-hl' : ''}`}>
        <line x1={sx(p.x)} y1={sy(p.y) + HANDLE} x2={sx(p.x)} y2={sy(0)} className="lp-height-line" />
        {
          <text x={stacked ? sx(p.x) - HANDLE - 6 : sx(p.x) + 5} y={stacked ? sy(p.y) + 4 : sy(p.y) + HANDLE + 15} textAnchor={stacked ? 'end' : 'start'} className="lp-height-text">
            h {fx(p.y, 1)} m
          </text>
        }
      </g>
    )
  })

  // the enlarged bundle and its GMR
  const off = bundleOffsets(g.n, g.dM)
  const rho = bundleRadius(g.n, g.dM)
  const box = 128
  const fit = (box / 2 - 22) / (rho + g.rM)
  const scaleIn = g.n === 1 ? (box / 2 - 30) / g.rM : fit
  const bx0 = W - PAD.r - box - 6
  const by0 = PAD.t + 6
  const cx = bx0 + box / 2
  const cy = by0 + box / 2 + 6
  const sel = selected ?? 0

  return (
    <figure className={`lp-xs ${compact ? 'is-compact' : ''} ${images ? 'has-images' : ''}`}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={label} className={drag !== null ? 'is-dragging' : ''}>
        <defs>
          <pattern id="lp-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" className="lp-hatch" />
          </pattern>
        </defs>
        {grid}
        {images ? (
          <rect x={sx(-win.x1)} y={sy(0)} width={2 * win.x1 * k} height={(0 - win.y0) * k} className="lp-earth-mirror" />
        ) : (
          <rect x={sx(-win.x1)} y={sy(0)} width={2 * win.x1 * k} height={10} fill="url(#lp-hatch)" />
        )}
        <line x1={sx(-win.x1)} x2={sx(win.x1)} y1={sy(0)} y2={sy(0)} className="lp-ground" />
        {!compact && (
          <text x={sx(-win.x1) + 6} y={sy(0) - 6} className="lp-note">
            ground (earth){images ? ' — a mirror for charge: images below' : ''}
          </text>
        )}
        {!compact && (
          <text x={W - PAD.r} y={H - 4} className="lp-tick" textAnchor="end">
            x [m] · height [m]
          </text>
        )}
        {heights}
        {/* the minimum spacing around phases that are too close */}
        {tooClose.map((i, n) => (
          <circle key={`min${n}`} cx={sx(g.phases[i].x)} cy={sy(g.phases[i].y)} r={(minPhaseSpacing(g) / 2) * k} className="lp-min" />
        ))}
        {res && dims}
        {images &&
          g.phases.map((p, i) => (
            <g key={`img${i}`} className="lp-image">
              {i === sel && <line x1={sx(p.x)} y1={sy(p.y)} x2={sx(p.x)} y2={sy(-p.y)} className="lp-image-link" />}
              <circle cx={sx(p.x)} cy={sy(-p.y)} r={HANDLE - 2} style={{ stroke: PHASE_VAR[i] }} />
              <text x={sx(p.x)} y={sy(-p.y) + 4} textAnchor="middle" style={{ fill: PHASE_VAR[i] }}>
                {PHASES[i]}′
              </text>
            </g>
          ))}
        {g.phases.map((p, i) => {
          const ph = i as PhaseIndex
          const x = sx(p.x)
          const y = sy(p.y)
          const s = 7 / Math.max(rho, 1e-9)
          return (
            <g
              key={`p${i}`}
              className={`lp-handle ${selected === ph ? 'is-sel' : ''} ${bad.has(ph) ? 'is-bad' : ''} ${editable ? 'is-edit' : ''}`}
              tabIndex={editable || onSelect ? 0 : undefined}
              role={editable ? 'button' : undefined}
              aria-label={`Phase ${PHASES[i]}: x ${fx(p.x, 1)} m, height ${fx(p.y, 1)} m.${editable ? ' Drag, or use the arrow keys (Shift: 1 m steps) to move it.' : ''}`}
              onKeyDown={editable ? onKey(ph) : undefined}
              onFocus={() => onSelect?.(ph)}
              onPointerDown={(e) => {
                onSelect?.(ph)
                if (!editable) return
                ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
                frozen.current = win
                setDrag(ph)
              }}
              onPointerMove={(e) => {
                if (drag !== ph || !onMove) return
                const w = toWorld(e)
                if (w) onMove(ph, clampPt(w))
              }}
              onPointerUp={() => {
                frozen.current = null
                setDrag(null)
              }}
              onPointerCancel={() => {
                frozen.current = null
                setDrag(null)
              }}
            >
              <circle cx={x} cy={y} r={HANDLE + 6} className="lp-handle-hit" />
              <circle cx={x} cy={y} r={HANDLE} className="lp-handle-ring" style={{ stroke: PHASE_VAR[i] }} />
              {off.map((o, j) => (
                <circle key={j} cx={x + (g.n === 1 ? 0 : o.x * s)} cy={y - (g.n === 1 ? 0 : o.y * s)} r={g.n === 1 ? 4 : 2.6} style={{ fill: PHASE_VAR[i] }} />
              ))}
              <text x={x} y={y - HANDLE - 6} textAnchor="middle" className="lp-handle-label" style={{ fill: PHASE_VAR[i] }}>
                {PHASES[i]}
              </text>
            </g>
          )
        })}
        {!compact && (
          <g className={`lp-inset ${highlight === 'gmr' ? 'is-hl' : ''}`} aria-label={`Bundle of phase ${PHASES[sel]}, enlarged`}>
            <rect x={bx0} y={by0} width={box} height={box + 20} rx={6} className="lp-inset-box" />
            <text x={bx0 + 8} y={by0 + 15} className="lp-inset-title">
              Bundle · enlarged
            </text>
            {off.map((o, j) => (
              <circle key={j} cx={cx + o.x * scaleIn} cy={cy - o.y * scaleIn} r={Math.max(1.5, g.rM * scaleIn)} className="lp-inset-sub" style={{ stroke: PHASE_VAR[sel] }} />
            ))}
            {res && (
              <>
                <circle cx={cx} cy={cy} r={Math.min(box / 2 - 8, res.gmrL * scaleIn)} className="lp-inset-gmr" />
                {g.n > 1 && <line x1={cx + off[0].x * scaleIn} y1={cy - off[0].y * scaleIn} x2={cx + off[1].x * scaleIn} y2={cy - off[1].y * scaleIn} className="lp-inset-d" />}
                <text x={bx0 + 8} y={by0 + box + 4} className="lp-inset-val">
                  GMR {fx(res.gmrL * 1000, 1)} mm{g.n > 1 ? ` · d ${fx(g.dM, 2)} m` : ` · r ${fx(g.rM * 1000, 1)} mm`}
                </text>
                <text x={bx0 + 8} y={by0 + box + 16} className="lp-inset-key">
                  dashed: GMR circle (to scale)
                </text>
              </>
            )}
          </g>
        )}
      </svg>
    </figure>
  )
}
