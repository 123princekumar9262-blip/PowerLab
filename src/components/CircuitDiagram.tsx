import { useEffect, useRef } from 'react'
import type { DiodeBias, ResolvedParams, SimulationSample } from '../types/simulation.ts'
import { formatA, formatSI, formatV } from '../utils/format.ts'

interface Props {
  /** The simulated circuit state at the cursor; null before the first run. */
  sample: SimulationSample | null
  params: ResolvedParams
  /** Peak load current of the run, used only to scale particle speed. */
  ioPeak: number
  /** Peak load power, used only to scale the resistor's heat glow. */
  pPeak: number
}

// Geometry (SVG user units). One series loop: source → D1 → R → back.
const SRC = { x: 96, y: 172, r: 34 }
const TOP = 70
const BOT = 272
const D_A = 300 // anode end of the diode body
const D_K = 344 // cathode bar
const RX = 566
const R_TOP = 120
const R_BOT = 224

/** The closed conduction loop, drawn in the direction of conventional current. */
const LOOP_PATH = `M${SRC.x},${SRC.y - SRC.r} V${TOP} H${RX} V${BOT} H${SRC.x} V${SRC.y + SRC.r}`

const BIAS_TEXT: Record<DiodeBias, string> = {
  'forward-conducting': 'forward biased',
  'forward-below-threshold': 'forward, below Vf',
  reverse: 'reverse biased',
  zero: 'zero bias',
}

export function CircuitDiagram({ sample, params, ioPeak, pPeak }: Props) {
  const on = sample?.diodeState === 'ON'
  const flowing = !!sample && sample.io > 0
  const idle = !sample
  const reverse = sample?.bias === 'reverse'
  const vin = sample?.vin ?? 0
  const vd = sample?.vd ?? 0
  const heat = sample && pPeak > 0 ? Math.min(1, (sample.vout * sample.io) / pPeak) : 0

  // Particle speed ∝ instantaneous current (visual only; the value itself comes from the sample).
  const speed = flowing && ioPeak > 0 ? 18 + 90 * Math.min(1, sample!.io / ioPeak) : 0
  const flowRef = useFlowAnimation(speed)

  const rZig = zigzag(RX, R_TOP, R_BOT, 12, 8)
  const state = idle ? 'idle' : on ? 'on' : 'off'

  return (
    <svg
      className={`circuit circuit--${state}`}
      viewBox="-60 0 780 320"
      role="img"
      aria-label={
        idle
          ? 'Half-wave rectifier circuit: AC source, diode D1, load resistor R.'
          : `Half-wave rectifier. Vin ${formatV(vin)}. D1 is ${on ? 'conducting' : 'blocking'}. Load current ${formatA(sample!.io)}.`
      }
    >
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="heat">
          <stop offset="0%" stopColor="var(--heat)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--heat)" stopOpacity="0" />
        </radialGradient>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--current)" />
        </marker>
      </defs>

      {/* Wires */}
      <path className={`wire ${flowing ? 'wire--active' : ''}`} d={`M${SRC.x},${SRC.y - SRC.r} V${TOP} H${D_A}`} />
      <path className={`wire ${flowing ? 'wire--active' : ''}`} d={`M${D_K},${TOP} H${RX} V${R_TOP}`} />
      <path className={`wire ${flowing ? 'wire--active' : ''}`} d={`M${RX},${R_BOT} V${BOT} H${SRC.x} V${SRC.y + SRC.r}`} />

      {/* Moving charge: only while the simulation says current flows */}
      {flowing && <path ref={flowRef} className="flow" d={LOOP_PATH} />}

      {/* AC source */}
      <g className="source">
        <circle cx={SRC.x} cy={SRC.y} r={SRC.r} />
        <path d={`M${SRC.x - 18},${SRC.y} q9,-20 18,0 t18,0`} />
        {!idle && vin !== 0 && (
          <>
            <text className="polarity" x={SRC.x + 46} y={SRC.y - 20}>
              {vin > 0 ? '+' : '−'}
            </text>
            <text className="polarity" x={SRC.x + 46} y={SRC.y + 32}>
              {vin > 0 ? '−' : '+'}
            </text>
          </>
        )}
        <text className="label" x={SRC.x - 52} y={SRC.y - 6} textAnchor="end">
          vin
        </text>
        <text className="value" x={SRC.x - 52} y={SRC.y + 12} textAnchor="end">
          {idle ? `${formatSI(params.vrms, 'V')} rms` : formatV(vin)}
        </text>
        <text className="sub" x={SRC.x} y={BOT + 34} textAnchor="middle">
          {formatSI(params.vrms, 'V')} rms · {params.frequency} Hz
        </text>
      </g>

      {/* Diode D1 */}
      <g className={`diode ${idle ? '' : on ? 'diode--on' : 'diode--off'}`}>
        <rect className="diode-hit" x={D_A - 12} y={TOP - 34} width={D_K - D_A + 24} height={68} rx={8} />
        <path className="diode-body" d={`M${D_A},${TOP - 21} L${D_A},${TOP + 21} L${D_K},${TOP} Z`} filter={on ? 'url(#glow)' : undefined} />
        <path className="diode-bar" d={`M${D_K},${TOP - 21} V${TOP + 21}`} />
        <text className="tiny" x={D_A + 2} y={TOP + 38}>
          A
        </text>
        <text className="tiny" x={D_K - 6} y={TOP + 38}>
          K
        </text>
        <text className="label" x={(D_A + D_K) / 2} y={TOP - 46} textAnchor="middle">
          D1
        </text>
        {!idle && (
          <>
            {vd !== 0 && (
              <>
                <text className="polarity" x={D_A - 22} y={TOP - 14} textAnchor="middle">
                  {vd > 0 ? '+' : '−'}
                </text>
                <text className="polarity" x={D_K + 22} y={TOP - 14} textAnchor="middle">
                  {vd > 0 ? '−' : '+'}
                </text>
              </>
            )}
            <text className="value" x={(D_A + D_K) / 2} y={TOP + 64} textAnchor="middle">
              vD {formatV(vd)}
            </text>
            <g transform={`translate(${(D_A + D_K) / 2}, ${TOP + 90})`}>
              <rect className={`badge ${on ? 'badge--on' : 'badge--off'}`} x={-62} y={-13} width={124} height={24} rx={12} />
              <text className="badge-text" x={0} y={4} textAnchor="middle">
                {on ? '● ON · conducting' : reverse ? '✕ OFF · blocking' : '○ OFF · below Vf'}
              </text>
            </g>
            <text className="sub" x={(D_A + D_K) / 2} y={TOP + 124} textAnchor="middle">
              {BIAS_TEXT[sample!.bias]}
            </text>
          </>
        )}
      </g>

      {/* Current arrow and value on the top wire */}
      {flowing && (
        <g className="current-label">
          <path d={`M${D_K + 52},${TOP - 16} H${D_K + 112}`} markerEnd="url(#arrow)" />
          <text className="value value--current" x={D_K + 82} y={TOP - 26} textAnchor="middle">
            io {formatA(sample!.io)}
          </text>
        </g>
      )}

      {/* Load resistor R */}
      <g className="resistor">
        {heat > 0.01 && <ellipse cx={RX} cy={(R_TOP + R_BOT) / 2} rx={44} ry={70} fill="url(#heat)" opacity={heat} />}
        <path className={`wire ${flowing ? 'wire--active' : ''}`} d={rZig} />
        <text className="label" x={RX - 30} y={(R_TOP + R_BOT) / 2 - 4} textAnchor="end">
          R
        </text>
        <text className="sub" x={RX - 30} y={(R_TOP + R_BOT) / 2 + 14} textAnchor="end">
          {formatSI(params.resistance, 'Ω').replace(/\.0+ /, ' ')}
        </text>
        {/* Output voltage across R */}
        <path className="bracket" d={`M${RX + 34},${R_TOP} h8 V${R_BOT} h-8`} />
        <text className={`polarity ${!idle && sample!.vout > 0 ? '' : 'polarity--dim'}`} x={RX + 52} y={R_TOP + 6}>
          +
        </text>
        <text className={`polarity ${!idle && sample!.vout > 0 ? '' : 'polarity--dim'}`} x={RX + 52} y={R_BOT + 2}>
          −
        </text>
        <text className="label" x={RX + 58} y={(R_TOP + R_BOT) / 2 - 4}>
          Vout
        </text>
        <text className="value" x={RX + 58} y={(R_TOP + R_BOT) / 2 + 14}>
          {idle ? '—' : formatV(sample!.vout)}
        </text>
      </g>

      {/* Return / reference */}
      <g className="ground">
        <path d={`M${RX - 120},${BOT} v12 m-12,0 h24 m-18,6 h12 m-7,6 h2`} />
        <text className="tiny" x={RX - 100} y={BOT + 22}>
          0 V
        </text>
      </g>
    </svg>
  )
}

/** Vertical zig-zag resistor symbol from y0 to y1 at x: straight leads, then `segments` alternating peaks. */
function zigzag(x: number, y0: number, y1: number, amp: number, segments: number): string {
  const lead = 10
  const step = (y1 - y0 - 2 * lead) / segments
  let d = `M${x},${y0} V${y0 + lead}`
  for (let k = 0; k < segments; k++) d += ` L${x + (k % 2 === 0 ? amp : -amp)},${y0 + lead + step * (k + 0.5)}`
  return `${d} L${x},${y1 - lead} V${y1}`
}

/**
 * Move the dotted "charge" pattern along the loop at `speed` px/s by updating
 * stroke-dashoffset directly (no React re-render per frame). Respects reduced motion.
 */
function useFlowAnimation(speed: number) {
  const ref = useRef<SVGPathElement | null>(null)
  const speedRef = useRef(speed)
  speedRef.current = speed
  const active = speed > 0

  useEffect(() => {
    if (!active) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    let raf = 0
    let offset = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      offset -= speedRef.current * dt
      if (ref.current) ref.current.style.strokeDashoffset = String(offset % 1000)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])

  return ref
}
