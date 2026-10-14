import { fx } from '../../ui/format.ts'
import { Plot } from '../../ui/Plot.tsx'
import { bundleGmFormula, bundleOffsets, bundleRadius, currentDensity, R_PRIME, type Bundle } from './calc.ts'
import { PHASE_VAR } from './CrossSection.tsx'

/*
 * Small drawings for Learn and Verify. FluxLoop and Transposition are CONCEPTUAL (labelled illustration, no numbers);
 * BundleRow is GEOMETRY to scale with its computed GMR; SkinPlot is CALCULATED (the Bessel solution).
 */

/** Two conductors carrying opposite currents, their flux circles and the loop between them (illustration). */
export function FluxLoop({ wide = false }: { wide?: boolean }) {
  const W = 520
  const H = 220
  const D = wide ? 300 : 180
  const x1 = W / 2 - D / 2
  const x2 = W / 2 + D / 2
  const y = 110
  const rings = [16, 30, 48, 70, 96]
  return (
    <figure className="lp-figure">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Illustration: two conductors with opposite currents; circles of magnetic flux around each; the loop between them links the flux.">
        <rect x={x1} y={y - 34} width={D} height={68} className="lp-loop" />
        {rings.map((r) => (
          <g key={r}>
            <circle cx={x1} cy={y} r={r} className="lp-flux" />
            <circle cx={x2} cy={y} r={r} className="lp-flux" />
          </g>
        ))}
        <circle cx={x1} cy={y} r={9} className="lp-wire" />
        <circle cx={x2} cy={y} r={9} className="lp-wire" />
        <circle cx={x1} cy={y} r={2.2} className="lp-dot" />
        <g className="lp-cross">
          <line x1={x2 - 4} y1={y - 4} x2={x2 + 4} y2={y + 4} />
          <line x1={x2 - 4} y1={y + 4} x2={x2 + 4} y2={y - 4} />
        </g>
        <text x={x1} y={y + 30} textAnchor="middle" className="lp-fig-text">
          current out
        </text>
        <text x={x2} y={y + 30} textAnchor="middle" className="lp-fig-text">
          current in
        </text>
        <line x1={x1} y1={y + 54} x2={x2} y2={y + 54} className="lp-fig-dim" />
        <text x={W / 2} y={y + 70} textAnchor="middle" className="lp-fig-text">
          spacing D {wide ? '(wider: bigger loop)' : ''}
        </text>
        <text x={W / 2} y={y - 42} textAnchor="middle" className="lp-fig-text">
          the loop between the wires links the flux
        </text>
        <text x={W - 6} y={H - 6} textAnchor="end" className="lp-fig-kind">
          illustration
        </text>
      </svg>
    </figure>
  )
}

/** A transposition cycle: each phase takes each position for a third of the length (illustration). */
export function Transposition() {
  const W = 520
  const H = 150
  const ys = [40, 75, 110]
  const xs = [30, 190, 340, 490]
  const order = [
    [0, 1, 2],
    [2, 0, 1],
    [1, 2, 0],
  ]
  return (
    <figure className="lp-figure">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Illustration: a transposition cycle in three sections; each phase occupies each of the three positions for one third of the line length.">
        {order.map((o, s) =>
          o.map((ph, pos) => {
            const next = order[(s + 1) % 3]
            const toPos = next.indexOf(ph)
            const xa = xs[s]
            const xb = xs[s + 1]
            return (
              <g key={`${s}-${pos}`}>
                <line x1={xa} y1={ys[pos]} x2={xb - 22} y2={ys[pos]} style={{ stroke: PHASE_VAR[ph] }} className="lp-tr-line" />
                {s < 2 && <line x1={xb - 22} y1={ys[pos]} x2={xb} y2={ys[toPos]} style={{ stroke: PHASE_VAR[ph] }} className="lp-tr-line" />}
                {s === 0 && (
                  <text x={xa - 8} y={ys[pos] + 4} textAnchor="end" className="lp-fig-text" style={{ fill: PHASE_VAR[ph] }}>
                    {'abc'[ph]}
                  </text>
                )}
              </g>
            )
          }),
        )}
        {[0, 1, 2].map((s) => (
          <text key={s} x={(xs[s] + xs[s + 1] - 22) / 2} y={H - 10} textAnchor="middle" className="lp-fig-text">
            section {s + 1} · ⅓ of the length
          </text>
        ))}
        <text x={W - 6} y={14} textAnchor="end" className="lp-fig-kind">
          illustration
        </text>
      </svg>
    </figure>
  )
}

/** Bundles of 1–4 sub-conductors drawn to one scale, each with its GMR circle (dashed). */
export function BundleRow({ rM, dM, active }: { rM: number; dM: number; active?: Bundle }) {
  const W = 520
  const H = 170
  const scale = 52 / (bundleRadius(4, dM) + rM)
  return (
    <figure className="lp-figure">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Bundles of 1 to 4 sub-conductors, ${fx(dM, 2)} m spacing, drawn to scale with their GMR circles`}>
        {([1, 2, 3, 4] as Bundle[]).map((n, i) => {
          const cx = 65 + i * 130
          const cy = 72
          const gmr = bundleGmFormula(n, dM, R_PRIME * rM)
          return (
            <g key={n} className={active === n ? 'lp-bundle is-on' : 'lp-bundle'}>
              <circle cx={cx} cy={cy} r={Math.max(1, gmr * scale)} className="lp-inset-gmr" />
              {bundleOffsets(n, dM).map((o, j) => (
                <circle key={j} cx={cx + o.x * scale} cy={cy - o.y * scale} r={Math.max(2, rM * scale)} className="lp-inset-sub" style={{ stroke: 'var(--ps-a)' }} />
              ))}
              <text x={cx} y={cy + 72} textAnchor="middle" className="lp-fig-text">
                {n === 1 ? 'single' : `${n} sub-conductors`}
              </text>
              <text x={cx} y={cy + 88} textAnchor="middle" className="lp-fig-val">
                GMR {fx(gmr * 1000, 1)} mm
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className="small muted">To scale (sub-conductors drawn at least 2 px). Dashed: the GMR circle — the single conductor that would have the same inductance.</figcaption>
    </figure>
  )
}

/** |J| across a solid conductor at two frequencies (the exact Bessel solution). */
export function SkinPlot({ curves, height = 220 }: { curves: Array<{ q: number; label: string; color: string; dashed?: boolean }>; height?: number }) {
  return (
    <Plot
      series={curves.map((c, i) => ({ id: `c${i}`, label: c.label, color: c.color, points: currentDensity(c.q, 60).map(([f, j]) => [f, j] as [number, number]), dashed: c.dashed }))}
      xLabel="Distance from the centre, ρ / r"
      yLabel="|J| / J_dc"
      xDomain={[0, 1]}
      yDomain={[0, Math.max(1.2, ...curves.map((c) => currentDensity(c.q, 60)[60][1])) * 1.08]}
      height={height}
      label={`Current density across a solid round conductor, relative to the uniform dc density: ${curves.map((c) => c.label).join('; ')}`}
    />
  )
}
