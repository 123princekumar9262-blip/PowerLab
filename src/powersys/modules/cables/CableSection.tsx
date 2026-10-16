import { useId } from 'react'
import { fx } from '../../ui/format.ts'
import { equipotentialRadius, stressAt, type CableResult } from './calc.ts'
import { stressCss } from './scale.ts'
import { layerSpecs, probeValues } from './shared.tsx'

/*
 * The cable's cross-section in 2D. To scale: r, R, the probe circle and the equipotential circles (CALCULATED: the radii
 * where the potential is 80 %, 60 %, 40 % and 20 % of V — an exact solution of the coaxial field). The insulation is
 * shaded by the computed stress on the same colour scale as the 3D view. The screens, sheath, bedding, armour and
 * jacket are drawn with illustrative thicknesses.
 */

const W = 600
const H = 400
const CX = 200
const CY = 200
const RMAX = 182
const LEVELS = [0.8, 0.6, 0.4, 0.2]

export function CableSection({
  res,
  probeT,
  gPerm,
  selected,
  label,
  showProbe = true,
}: {
  res: CableResult
  probeT: number
  gPerm: number
  selected?: string | null
  label?: string
  showProbe?: boolean
}) {
  const gid = useId()
  const L = layerSpecs(res.c.rMm, res.c.RMm)
  const ro = L[L.length - 1].outer
  const s = RMAX / ro
  const px = (mm: number) => mm * s
  const pv = probeValues(res, probeT)
  const by = (id: string) => L.find((l) => l.id === id)!
  const ins = by('insulation')
  const armour = by('armour')
  const nStops = 14
  const stops = Array.from({ length: nStops + 1 }, (_, k) => {
    const x = res.r + ((res.R - res.r) * k) / nStops
    return { off: x / res.R, color: stressCss(stressAt(res.c.vKv, x, res.r, res.R) / gPerm) }
  })
  const wr = (armour.outer - armour.inner) / 2
  const rc = armour.inner + wr
  const nW = Math.max(12, Math.floor((2 * Math.PI * rc) / (2 * wr * 1.08)))
  const eq = LEVELS.map((k) => ({ k, x: equipotentialRadius(k, res.r, res.R) * 10 }))
  const a25 = (25 * Math.PI) / 180
  const sel = (id: string) => selected === id
  const ring = (id: string, cls?: string) => {
    const l = by(id)
    return <circle key={id} cx={CX} cy={CY} r={px(l.outer)} style={{ fill: l.color }} className={`cb-xs-layer ${cls ?? ''} ${sel(id) ? 'is-sel' : ''}`} />
  }
  const colX = 420
  return (
    <figure className="cb-xs">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label ?? `Cross-section of the cable: conductor radius ${fx(res.c.rMm, 1)} mm, sheath radius ${fx(res.c.RMm, 1)} mm, equipotential circles and the stress colour`}
      >
        <defs>
          <radialGradient id={gid} gradientUnits="userSpaceOnUse" cx={CX} cy={CY} r={px(res.c.RMm)}>
            {stops.map((st, k) => (
              <stop key={k} offset={st.off} stopColor={st.color} />
            ))}
          </radialGradient>
        </defs>
        {ring('serving')}
        {ring('armour')}
        {Array.from({ length: nW }, (_, k) => {
          const t = (k / nW) * 2 * Math.PI
          return <circle key={k} cx={CX + px(rc) * Math.cos(t)} cy={CY + px(rc) * Math.sin(t)} r={Math.max(0.8, px(wr) * 0.92)} className="cb-xs-wire" />
        })}
        <circle cx={CX} cy={CY} r={px(armour.inner)} style={{ fill: by('bedding').color }} className={`cb-xs-layer ${sel('bedding') ? 'is-sel' : ''}`} />
        {ring('sheath')}
        {ring('iscreen')}
        <circle cx={CX} cy={CY} r={px(ins.outer)} fill={`url(#${gid})`} className={`cb-xs-layer ${sel('insulation') ? 'is-sel' : ''}`} />
        {ring('cscreen')}
        {ring('conductor')}
        {/* equipotentials (calculated) */}
        {eq.map(({ k, x }, i) => {
          const ex = CX + px(x) * Math.cos(a25)
          const ey = CY - px(x) * Math.sin(a25)
          const ly = 34 + i * 20
          return (
            <g key={k} className="cb-xs-eq">
              <circle cx={CX} cy={CY} r={px(x)} />
              <polyline points={`${ex},${ey} ${colX - 8},${ly - 4}`} className="cb-xs-leader" />
              <text x={colX} y={ly} className="cb-xs-text">
                {Math.round(k * 100)} % · {fx(k * res.c.vKv, 1)} kV at {fx(x, 1)} mm
              </text>
            </g>
          )
        })}
        <text x={colX} y={18} className="cb-xs-head">
          Equipotentials (V = {fx(res.c.vKv, 1)} kV)
        </text>
        {/* probe */}
        {showProbe && (
          <g className={`cb-xs-probe ${sel('probe') ? 'is-sel' : ''}`}>
            <circle cx={CX} cy={CY} r={px(pv.xMm)} />
            <polyline points={`${CX + px(pv.xMm) * Math.cos(-a25)},${CY + px(pv.xMm) * Math.sin(a25)} ${colX - 8},${142}`} className="cb-xs-leader" />
            <text x={colX} y={146} className="cb-xs-head">
              Probe at x = {fx(pv.xMm, 1)} mm
            </text>
            <text x={colX} y={164} className="cb-xs-text">
              g = {fx(pv.g, 2)} kV/cm
            </text>
            <text x={colX} y={180} className="cb-xs-text">
              V = {fx(pv.v, 2)} kV
            </text>
          </g>
        )}
        {/* r and R */}
        <g className="cb-xs-dim">
          <line x1={CX} y1={CY} x2={CX - px(res.c.rMm)} y2={CY} />
          <line x1={CX} y1={CY + 3} x2={CX - px(res.c.RMm) * Math.cos(0.32)} y2={CY + px(res.c.RMm) * Math.sin(0.32)} />
          <circle cx={CX} cy={CY} r={2.5} />
        </g>
        <text x={colX} y={216} className="cb-xs-head">
          Geometry (to scale)
        </text>
        <text x={colX} y={234} className="cb-xs-text">
          r = {fx(res.c.rMm, 1)} mm (conductor)
        </text>
        <text x={colX} y={250} className="cb-xs-text">
          R = {fx(res.c.RMm, 1)} mm (sheath, inside)
        </text>
        <text x={colX} y={266} className="cb-xs-text">
          ln(R/r) = {fx(res.ln, 4)}
        </text>
        <text x={colX} y={292} className="cb-xs-head">
          Stress (rms)
        </text>
        <text x={colX} y={310} className="cb-xs-text">
          g_max = {fx(res.gMax, 2)} kV/cm at r
        </text>
        <text x={colX} y={326} className="cb-xs-text">
          g_min = {fx(res.gMin, 2)} kV/cm at R
        </text>
        <text x={CX - px(res.c.rMm) / 2} y={CY - 5} textAnchor="middle" className="cb-xs-dimtext">
          r
        </text>
        <text x={CX - px(res.c.RMm) * Math.cos(0.32) * 0.8} y={CY + px(res.c.RMm) * Math.sin(0.32) * 0.8 + 14} textAnchor="middle" className="cb-xs-dimtext">
          R
        </text>
        <text x={W - 8} y={H - 8} textAnchor="end" className="cb-xs-kind">
          r, R, equipotentials, probe and colours calculated · outer layer thicknesses illustrative
        </text>
      </svg>
    </figure>
  )
}
