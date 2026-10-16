import type { ReactElement } from 'react'
import { fx } from '../../ui/format.ts'
import { Plot, type PlotSeries } from '../../ui/Plot.tsx'
import { economicSize, gradedProfile, profile, sheathFor, type CableResult, type GradedResult } from './calc.ts'
import { OVER_COLOR, scaleGradient, stressCss } from './scale.ts'
import { probeValues } from './shared.tsx'

/*
 * Plots and figures. StressPlots, StressLegend, EconomicPlot and GradingPlot are CALCULATED. CableTypes and
 * BeltedFigure are CONCEPTUAL (labelled "illustration", no numbers).
 */

/** g(x) and V(x) across the insulation, with the probe marked. */
export function StressPlots({ res, probeT, gPerm, height = 210, stack = false }: { res: CableResult; probeT: number; gPerm: number; height?: number; stack?: boolean }) {
  const pr = profile(res, 80)
  const pv = probeValues(res, probeT)
  const top = Math.max(res.gMax * 1.12, Math.min(gPerm * 1.06, res.gMax * 3))
  const showG = gPerm <= top
  return (
    <div className={stack ? 'ps-stack' : 'ps-cols-2 cb-plots'}>
      <Plot
        series={[{ id: 'g', label: 'g(x)', color: 'var(--ps-a)', points: pr.g }]}
        xLabel="Radius x [mm]"
        yLabel="Stress g [kV/cm]"
        xDomain={[res.c.rMm, res.c.RMm]}
        yDomain={[0, top]}
        vlines={[{ x: pv.xMm, label: `probe: ${fx(pv.g, 2)} kV/cm` }]}
        hlines={showG ? [{ y: gPerm, label: `permissible G = ${fx(gPerm, 0)} kV/cm` }] : []}
        height={height}
        label={`Stress across the insulation from ${fx(res.gMax, 2)} kV/cm at the conductor to ${fx(res.gMin, 2)} kV/cm at the sheath`}
      />
      <Plot
        series={[{ id: 'v', label: 'V(x)', color: 'var(--ps-c)', points: pr.v }]}
        xLabel="Radius x [mm]"
        yLabel="Potential V [kV]"
        xDomain={[res.c.rMm, res.c.RMm]}
        yDomain={[0, res.c.vKv * 1.08]}
        vlines={[{ x: pv.xMm, label: `probe: ${fx(pv.v, 2)} kV` }]}
        height={height}
        label={`Potential across the insulation from ${fx(res.c.vKv, 1)} kV at the conductor to 0 at the sheath`}
      />
    </div>
  )
}

/** The colour scale 0 … G with the cable's g_min, g_max and the probe marked. */
export function StressLegend({ res, gPerm, probeT }: { res: CableResult; gPerm: number; probeT?: number }) {
  const pos = (g: number) => `${Math.min(100, (g / gPerm) * 100).toFixed(2)}%`
  const marks: Array<{ g: number; label: string }> = [
    { g: res.gMin, label: `g_min ${fx(res.gMin, 1)}` },
    { g: res.gMax, label: `g_max ${fx(res.gMax, 1)}` },
  ]
  if (probeT !== undefined) {
    const p = probeValues(res, probeT)
    marks.push({ g: p.g, label: `probe ${fx(p.g, 1)}` })
  }
  const over = res.gMax > gPerm
  return (
    <div className="cb-legend" aria-label={`Stress colour scale from 0 to ${fx(gPerm, 0)} kV/cm`}>
      <span className="cb-legend-title">Insulation colour = computed stress [kV/cm rms]</span>
      <div className="cb-legend-bar-wrap">
        <div className="cb-legend-bar" style={{ background: scaleGradient() }} />
        <div className="cb-legend-over" style={{ background: OVER_COLOR }} title="above the permissible stress" />
        {marks.map((m, k) => (
          <span key={k} className={`cb-legend-mark cb-legend-mark--${k}`} style={{ left: m.g > gPerm ? 'calc(100% + 15px)' : pos(m.g) }}>
            <i style={{ background: stressCss(m.g / gPerm) }} />
            {m.label}
          </span>
        ))}
      </div>
      <div className="cb-legend-ticks">
        <span>0</span>
        <span>{fx(gPerm / 2, 0)}</span>
        <span>G = {fx(gPerm, 0)}</span>
      </div>
      <p className="small muted cb-legend-note">
        {over
          ? `g_max is above the permissible stress G (${fx(res.gMax, 1)} > ${fx(gPerm, 0)} kV/cm): the over-stressed region is drawn in the warning colour.`
          : `g_max is ${fx((res.gMax / gPerm) * 100, 0)} % of the permissible stress G = ${fx(gPerm, 0)} kV/cm (a design value you choose).`}
      </p>
    </div>
  )
}

/** The sheath radius needed for g_max = G as the conductor radius changes; its minimum at r = V/G. */
export function EconomicPlot({ vKv, gPerm, rMm, height = 220 }: { vKv: number; gPerm: number; rMm?: number; height?: number }) {
  const opt = economicSize(vKv, gPerm)
  const rOptMm = opt.rCm * 10
  const lo = rOptMm * 0.3
  const hi = Math.max(rOptMm * 3.2, rMm ? rMm * 1.2 : 0)
  const pts: Array<[number, number]> = Array.from({ length: 121 }, (_, k) => {
    const r = lo + ((hi - lo) * k) / 120
    return [r, sheathFor(r / 10, vKv, gPerm) * 10]
  })
  const series: PlotSeries[] = [
    { id: 'R', label: 'R needed', color: 'var(--ps-b)', points: pts },
    { id: 'r', label: 'R = r', color: 'var(--text-3)', points: pts.map(([r]) => [r, r] as [number, number]), dashed: true },
  ]
  const vl = [{ x: rOptMm, label: `r = V/G = ${fx(rOptMm, 2)} mm → R = ${fx(opt.RCm * 10, 2)} mm` }]
  if (rMm !== undefined && Math.abs(rMm - rOptMm) > 0.02 * rOptMm) vl.push({ x: rMm, label: `your r = ${fx(rMm, 1)} mm → R = ${fx(sheathFor(rMm / 10, vKv, gPerm) * 10, 1)} mm` })
  return (
    <Plot
      series={series}
      xLabel="Conductor radius r [mm]"
      yLabel="Sheath radius R [mm]"
      xDomain={[lo, hi]}
      yDomain={[0, opt.RCm * 10 * 2.6]}
      vlines={vl}
      height={height}
      label={`Sheath radius needed to keep the maximum stress at ${fx(gPerm, 0)} kV/cm for ${fx(vKv, 1)} kV: smallest at r = ${fx(rOptMm, 2)} mm`}
    />
  )
}

/** Ungraded against graded stress profiles. */
export function GradingPlot({ res, graded, extra, height = 230 }: { res: CableResult; graded: GradedResult[]; extra?: string[]; height?: number }) {
  const colors = ['var(--ps-b)', 'var(--ps-c)']
  const series: PlotSeries[] = [
    { id: 'u', label: 'ungraded', color: 'var(--text-3)', points: profile(res, 60).g, dashed: true },
    ...graded.map((g, i) => ({ id: `g${i}`, label: extra?.[i] ?? 'graded', color: colors[i % 2], points: gradedProfile(g, 40) })),
  ]
  const bounds = graded[0]?.layers.slice(1).map((l) => ({ x: l.inner * 10, label: `${fx(l.inner * 10, 1)} mm` })) ?? []
  return (
    <Plot
      series={series}
      xLabel="Radius x [mm]"
      yLabel="Stress g [kV/cm]"
      xDomain={[res.c.rMm, res.c.RMm]}
      yDomain={[0, res.gMax * 1.12]}
      vlines={bounds}
      height={height}
      label={`Stress across the insulation, ungraded (peak ${fx(res.gMax, 2)} kV/cm) and graded (peak ${graded.map((g) => fx(g.peak, 2)).join(', ')} kV/cm)`}
    />
  )
}

// ── illustrations ──────────────────────────────────────────────────────────────────────────────────────────────

function Core({ x, y, r, ins, screen, sheath }: { x: number; y: number; r: number; ins: number; screen?: boolean; sheath?: boolean }) {
  return (
    <g>
      {sheath && <circle cx={x} cy={y} r={r + ins + 3} className="cb-il-sheath" />}
      <circle cx={x} cy={y} r={r + ins} className="cb-il-ins" />
      {screen && <circle cx={x} cy={y} r={r + ins} className="cb-il-screen" />}
      <circle cx={x} cy={y} r={r} className="cb-il-cond" />
    </g>
  )
}

const tri = (cx: number, cy: number, d: number) => [0, 1, 2].map((k) => ({ x: cx + d * Math.cos(-Math.PI / 2 + (k * 2 * Math.PI) / 3), y: cy + d * Math.sin(-Math.PI / 2 + (k * 2 * Math.PI) / 3) }))

/** Six cable types, simplified cross-sections (illustration). */
export function CableTypes() {
  const cells: Array<{ title: string; draw: (cx: number, cy: number) => ReactElement }> = [
    {
      title: 'Belted (3-core)',
      draw: (cx, cy) => (
        <g>
          <circle cx={cx} cy={cy} r={52} className="cb-il-serving" />
          <circle cx={cx} cy={cy} r={46} className="cb-il-sheath" />
          <circle cx={cx} cy={cy} r={43} className="cb-il-belt" />
          <circle cx={cx} cy={cy} r={37} className="cb-il-filler" />
          {tri(cx, cy, 19).map((p, k) => (
            <Core key={k} x={p.x} y={p.y} r={8} ins={7} />
          ))}
        </g>
      ),
    },
    {
      title: 'Screened (H-type)',
      draw: (cx, cy) => (
        <g>
          <circle cx={cx} cy={cy} r={52} className="cb-il-serving" />
          <circle cx={cx} cy={cy} r={46} className="cb-il-sheath" />
          <circle cx={cx} cy={cy} r={43} className="cb-il-filler" />
          {tri(cx, cy, 20).map((p, k) => (
            <Core key={k} x={p.x} y={p.y} r={8} ins={10} screen />
          ))}
        </g>
      ),
    },
    {
      title: 'SL (separate sheaths)',
      draw: (cx, cy) => (
        <g>
          <circle cx={cx} cy={cy} r={52} className="cb-il-serving" />
          <circle cx={cx} cy={cy} r={47} className="cb-il-filler" />
          {tri(cx, cy, 21).map((p, k) => (
            <Core key={k} x={p.x} y={p.y} r={8} ins={9} sheath />
          ))}
        </g>
      ),
    },
    {
      title: 'Oil-filled (single core)',
      draw: (cx, cy) => (
        <g>
          <circle cx={cx} cy={cy} r={50} className="cb-il-serving" />
          <circle cx={cx} cy={cy} r={44} className="cb-il-sheath" />
          <circle cx={cx} cy={cy} r={41} className="cb-il-ins" />
          <circle cx={cx} cy={cy} r={19} className="cb-il-cond" />
          <circle cx={cx} cy={cy} r={8} className="cb-il-oil" />
        </g>
      ),
    },
    {
      title: 'Gas-pressure (pipe)',
      draw: (cx, cy) => (
        <g>
          <circle cx={cx} cy={cy} r={52} className="cb-il-pipe" />
          <circle cx={cx} cy={cy} r={47} className="cb-il-gas" />
          {tri(cx, cy + 4, 18).map((p, k) => (
            <Core key={k} x={p.x} y={p.y} r={7} ins={8} sheath />
          ))}
        </g>
      ),
    },
    {
      title: 'XLPE (single core)',
      draw: (cx, cy) => (
        <g>
          <circle cx={cx} cy={cy} r={50} className="cb-il-serving" />
          <circle cx={cx} cy={cy} r={45} className="cb-il-sheath" />
          <circle cx={cx} cy={cy} r={42} className="cb-il-semi" />
          <circle cx={cx} cy={cy} r={40} className="cb-il-xlpe" />
          <circle cx={cx} cy={cy} r={20} className="cb-il-semi" />
          <circle cx={cx} cy={cy} r={18} className="cb-il-cond" />
        </g>
      ),
    },
  ]
  return (
    <figure className="cb-figure">
      <svg viewBox="0 0 540 316" role="img" aria-label="Illustration: simplified cross-sections of six cable types — belted, screened (H-type), SL, oil-filled, gas-pressure and XLPE">
        {cells.map((c, i) => {
          const cx = 90 + (i % 3) * 180
          const cy = 66 + Math.floor(i / 3) * 150
          return (
            <g key={c.title}>
              {c.draw(cx, cy)}
              <text x={cx} y={cy + 72} textAnchor="middle" className="cb-fig-text">
                {c.title}
              </text>
            </g>
          )
        })}
        <text x={534} y={312} textAnchor="end" className="cb-fig-kind">
          illustration · not to scale
        </text>
      </svg>
      <figcaption className="small muted cb-il-key">
        <span className="cb-key cb-key--cond" /> conductor <span className="cb-key cb-key--ins" /> paper / insulation <span className="cb-key cb-key--xlpe" /> XLPE{' '}
        <span className="cb-key cb-key--semi" /> screen <span className="cb-key cb-key--sheath" /> metallic sheath / pipe <span className="cb-key cb-key--oil" /> oil duct
      </figcaption>
    </figure>
  )
}

/** A three-core belted cable with its partial capacitances (illustration). */
export function BeltedFigure() {
  const cx = 150
  const cy = 130
  const cores = tri(cx, cy, 42)
  return (
    <figure className="cb-figure">
      <svg
        viewBox="0 0 540 260"
        role="img"
        aria-label="Illustration: three cores inside an earthed sheath; each core has a capacitance C_s to the sheath and C_c to each other core; on the right the equivalent star of C_n = C_s + 3C_c per phase"
      >
        <circle cx={cx} cy={cy} r={100} className="cb-il-sheath" />
        <circle cx={cx} cy={cy} r={96} className="cb-il-belt" />
        {cores.map((p, k) => {
          const q = cores[(k + 1) % 3]
          const out = { x: cx + ((p.x - cx) / 42) * 96, y: cy + ((p.y - cy) / 42) * 96 }
          return (
            <g key={k}>
              <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="cb-il-cap cb-il-cap--c" />
              <text x={(p.x + q.x) / 2 + ((p.x + q.x) / 2 - cx) * 0.35} y={(p.y + q.y) / 2 + ((p.y + q.y) / 2 - cy) * 0.35 + 4} textAnchor="middle" className="cb-fig-val">
                C_c
              </text>
              <line x1={p.x} y1={p.y} x2={out.x} y2={out.y} className="cb-il-cap cb-il-cap--s" />
              <text x={(p.x + out.x) / 2 + 12} y={(p.y + out.y) / 2 - 4} className="cb-fig-val">
                C_s
              </text>
            </g>
          )
        })}
        {cores.map((p, k) => (
          <g key={`c${k}`}>
            <circle cx={p.x} cy={p.y} r={15} className="cb-il-cond" />
            <text x={p.x} y={p.y + 4} textAnchor="middle" className="cb-fig-core">
              {'abc'[k]}
            </text>
          </g>
        ))}
        <text x={cx} y={250} textAnchor="middle" className="cb-fig-text">
          earthed sheath = neutral
        </text>
        {/* the equivalent star */}
        <g transform="translate(350 40)">
          {[0, 1, 2].map((k) => (
            <g key={k}>
              <line x1={30 + k * 60} y1={10} x2={30 + k * 60} y2={70} className="cb-il-wire" />
              <line x1={18 + k * 60} y1={70} x2={42 + k * 60} y2={70} className="cb-il-plate" />
              <line x1={18 + k * 60} y1={78} x2={42 + k * 60} y2={78} className="cb-il-plate" />
              <line x1={30 + k * 60} y1={78} x2={30 + k * 60} y2={120} className="cb-il-wire" />
              <text x={30 + k * 60} y={4} textAnchor="middle" className="cb-fig-core">
                {'abc'[k]}
              </text>
              <text x={46 + k * 60} y={64} className="cb-fig-val">
                C_n
              </text>
            </g>
          ))}
          <line x1={30} y1={120} x2={150} y2={120} className="cb-il-wire" />
          <text x={90} y={140} textAnchor="middle" className="cb-fig-text">
            neutral (sheath)
          </text>
          <text x={90} y={172} textAnchor="middle" className="cb-fig-text">
            C_n = C_s + 3 C_c per phase
          </text>
        </g>
        <text x={534} y={256} textAnchor="end" className="cb-fig-kind">
          illustration
        </text>
      </svg>
    </figure>
  )
}
