import { useId, type ReactNode } from 'react'
import { fx } from '../../ui/format.ts'
import { chainOutput, type EnergyChain, type HydroResult, type NuclearResult, type PlantType, type PumpedIn, type PumpedResult, type ThermalResult } from './calc.ts'
import { BASE_MVA, DEG, measDefs, NET, type MeasId, type SeOutcome } from './se.ts'
import { grp } from './shared.tsx'

/*
 * The module's 2D figures.
 *  · Sankey (CALCULATED): band widths ∝ the computed energy (or power) at each stage of an efficiency chain.
 *  · Process-flow diagrams (the 2D view of each station): boxes are the equipment (layout schematic); energy arrows are
 *    CALCULATED (width ∝ the computed power they carry); thin dashed lines only show where water goes (no size).
 *  · SCADA schematic and reactor cut-away: CONCEPTUAL illustrations (no numbers), labelled so.
 *  · The estimation network: buses and lines (schematic), meters coloured from the computed residual test, estimated
 *    flows from the computed state (CALCULATED).
 */

const val = (v: number, unit: string) => `${grp(v, Math.abs(v) < 10 ? 2 : Math.abs(v) < 100 ? 1 : 0)} ${unit}`

/** Break a label into lines of at most `n` characters at spaces. */
function wrap(s: string, n = 20): string[] {
  const out: string[] = []
  let line = ''
  for (const w of s.split(' ')) {
    if ((line + ' ' + w).trim().length > n && line) {
      out.push(line)
      line = w
    } else line = (line + ' ' + w).trim()
  }
  if (line) out.push(line)
  return out
}
const short = (s: string) => s.replace(/\s*\(.*\)$/, '')

// ── Sankey ────────────────────────────────────────────────────────────────────────────────────────────────────

export function Sankey({ c, label, height }: { c: EnergyChain; label: string; height?: number }) {
  const W = 680
  const n = c.steps.length
  const xs = 14
  const step = (W - xs - 160) / n
  const xk = (k: number) => xs + step * k - step * 0.55
  const xe = xs + n * step + 6
  const y0 = 40
  const T = 96
  const s = T / c.input
  const r0 = 10
  const yEnd = y0 + T + 46
  const H = height ?? yEnd + 58
  const thick = [c.input, ...c.steps.map((st) => st.out)].map((v) => v * s)
  const out = chainOutput(c)
  const pct = (v: number) => `${fx((v / c.input) * 100, 1)} %`
  return (
    <figure className="gen-sankey">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}: ${c.inLabel} ${val(c.input, c.unit)}; ${c.steps.map((st) => `${short(st.lossLabel)} ${val(st.loss, c.unit)}`).join('; ')}; ${c.steps[n - 1]?.outLabel ?? ''} ${val(out, c.unit)}`}
      >
        <text x={xs} y={y0 - 10} className="gen-sk-in">
          {c.inLabel} · {val(c.input, c.unit)}
        </text>
        {thick.map((t, k) => {
          const x0 = k === 0 ? xs : xk(k)
          const x1 = k < n ? xk(k + 1) : xe
          return <rect key={k} x={x0} y={y0} width={Math.max(0, x1 - x0) + 0.5} height={Math.max(t, 1.5)} className="gen-sk-band" />
        })}
        <polygon points={`${xe},${y0 - 5} ${xe},${y0 + Math.max(thick[n], 1.5) + 5} ${xe + 13},${y0 + Math.max(thick[n], 1.5) / 2}`} className="gen-sk-band" />
        <text x={xe + 18} y={y0 + Math.max(thick[n], 1.5) / 2 - 4} className="gen-sk-out">
          {c.steps[n - 1]?.outLabel}
        </text>
        <text x={xe + 18} y={y0 + Math.max(thick[n], 1.5) / 2 + 11} className="gen-sk-val">
          {val(out, c.unit)} · {pct(out)}
        </text>
        {c.steps.map((st, k) => {
          const x = xk(k + 1)
          const yTop = y0 + thick[k + 1]
          const l = Math.max(1.5, st.loss * s)
          const yBot = yTop + l
          const cy = yBot + r0
          const d = `M${x} ${yTop} A${r0 + l} ${r0 + l} 0 0 1 ${x + r0 + l} ${cy} L${x + r0 + l} ${yEnd} L${x + r0} ${yEnd} L${x + r0} ${cy} A${r0} ${r0} 0 0 0 ${x} ${yBot} Z`
          const cx = x + r0 + l / 2
          return (
            <g key={k}>
              <path d={d} className="gen-sk-loss" />
              <polygon points={`${x + r0 - 3},${yEnd} ${x + r0 + l + 3},${yEnd} ${cx},${yEnd + 7}`} className="gen-sk-loss" />
              <text x={cx} y={yEnd + 21} className="gen-sk-val" textAnchor="middle">
                {val(st.loss, c.unit)} · {pct(st.loss)}
              </text>
              {wrap(short(st.lossLabel), 22).map((ln, j) => (
                <text key={j} x={cx} y={yEnd + 35 + j * 13} className="gen-sk-lbl" textAnchor="middle">
                  {ln}
                </text>
              ))}
              <text x={x + 4} y={y0 + thick[k + 1] / 2 + 4} className="gen-sk-eta">
                {thick[k + 1] > 16 ? `η ${fx(st.eta * 100, 1)} %` : ''}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className="small muted">
        Calculated: band widths are proportional to the computed {c.unit === 'MW' ? 'powers' : 'energies'} (very small losses are drawn at a minimum visible width). Input = output + losses:{' '}
        {val(c.input, c.unit)} = {val(out, c.unit)} + {val(c.input - out, c.unit)}.
      </figcaption>
    </figure>
  )
}

// ── process-flow diagrams ─────────────────────────────────────────────────────────────────────────────────────

type Pt = [number, number]
interface Node {
  id: string
  x: number
  y: number
  w: number
  h: number
  label: string
  sub?: string
}
interface Flow {
  pts: Pt[]
  /** Energy carried [MW] — sets the width; omitted for a path-only line (dashed, fixed width). */
  value?: number
  kind: 'useful' | 'loss' | 'water'
  label?: string
  at?: Pt
  anchor?: 'start' | 'middle' | 'end'
}

function arrowHead(pts: Pt[], w: number): string {
  const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]]
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const L = Math.hypot(dx, dy) || 1
  const ux = dx / L
  const uy = dy / L
  const hw = w / 2 + 4
  const len = 9
  const bx = b[0] - ux * len
  const by = b[1] - uy * len
  return `${bx - uy * hw},${by + ux * hw} ${bx + uy * hw},${by - ux * hw} ${b[0]},${b[1]}`
}

function Pfd({
  nodes,
  flows,
  vmax,
  label,
  note,
  frames,
  selected,
}: {
  nodes: Node[]
  flows: Flow[]
  vmax: number
  label: string
  note: ReactNode
  frames?: Array<{ x: number; y: number; w: number; h: number; label: string }>
  selected?: string | null
}) {
  const width = (v?: number) => (v === undefined ? 2 : Math.max(2, (20 * v) / vmax))
  return (
    <figure className="gen-pfd">
      <svg viewBox="0 0 680 300" role="img" aria-label={label}>
        {frames?.map((f) => (
          <g key={f.label}>
            <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={14} className="gen-pfd-frame" />
            <text x={f.x + 8} y={f.y + f.h - 6} className="gen-pfd-note">
              {f.label}
            </text>
          </g>
        ))}
        {flows.map((f, k) => {
          const w = width(f.value)
          // stop the line short of the arrow tip so the head stays sharp
          const pts = f.pts.map((p) => [...p] as Pt)
          const [a, b] = [pts[pts.length - 2], pts[pts.length - 1]]
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
          const tip: Pt = [b[0] - ((b[0] - a[0]) / L) * 8, b[1] - ((b[1] - a[1]) / L) * 8]
          const line = [...pts.slice(0, -1), tip]
          return (
            <g key={k} className={`gen-flow gen-flow--${f.kind}`}>
              <polyline points={line.map((p) => p.join(',')).join(' ')} style={{ strokeWidth: w }} strokeDasharray={f.value === undefined ? '5 4' : undefined} />
              <polygon points={arrowHead(f.pts, f.value === undefined ? 0 : w)} />
              {f.label && f.at && (
                <text x={f.at[0]} y={f.at[1]} textAnchor={f.anchor ?? 'start'} className="gen-pfd-val">
                  {f.label}
                </text>
              )}
            </g>
          )
        })}
        {nodes.map((n) => (
          <g key={n.id} className={`gen-node ${selected === n.id ? 'is-sel' : ''}`}>
            <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={6} />
            <text x={n.x + n.w / 2} y={n.y + n.h / 2 + (n.sub ? -2 : 4)} textAnchor="middle" className="gen-node-label">
              {n.label}
            </text>
            {n.sub && (
              <text x={n.x + n.w / 2} y={n.y + n.h / 2 + 13} textAnchor="middle" className="gen-node-sub">
                {n.sub}
              </text>
            )}
          </g>
        ))}
      </svg>
      <figcaption className="small muted">{note}</figcaption>
    </figure>
  )
}

const NOTE = 'Equipment layout is schematic. Calculated: each solid arrow’s width is proportional to the computed power it carries. Dashed lines only show where the water goes.'

export function ThermalPfd({ r, pMw, selected }: { r: ThermalResult; pMw: number; selected?: string | null }) {
  const nodes: Node[] = [
    { id: 'coal', x: 14, y: 196, w: 78, h: 40, label: 'Coal', sub: `${grp(r.fuelKgH / 1000, 0)} t/h` },
    { id: 'boiler', x: 120, y: 70, w: 96, h: 160, label: 'Boiler', sub: `η ${fx(r.chain.steps[0].eta * 100, 1)} %` },
    { id: 'stack', x: 250, y: 12, w: 80, h: 34, label: 'Stack' },
    { id: 'turbine', x: 300, y: 84, w: 104, h: 50, label: 'Turbine' },
    { id: 'generator', x: 446, y: 84, w: 92, h: 50, label: 'Generator' },
    { id: 'grid', x: 586, y: 89, w: 80, h: 40, label: 'Grid' },
    { id: 'condenser', x: 300, y: 190, w: 104, h: 46, label: 'Condenser' },
    { id: 'tower', x: 450, y: 190, w: 100, h: 46, label: 'Cooling tower' },
    { id: 'pump', x: 196, y: 252, w: 84, h: 32, label: 'Feed pump' },
  ]
  const flows: Flow[] = [
    {
      pts: [
        [92, 216],
        [120, 216],
      ],
      value: r.qInMw,
      kind: 'useful',
      label: `${val(r.qInMw, 'MW')} heat`,
      at: [16, 188],
    },
    {
      pts: [
        [168, 70],
        [168, 29],
        [250, 29],
      ],
      value: r.boilerLossMw,
      kind: 'loss',
      label: val(r.boilerLossMw, 'MW'),
      at: [176, 22],
    },
    {
      pts: [
        [216, 109],
        [300, 109],
      ],
      value: r.steamMw,
      kind: 'useful',
      label: `steam ${val(r.steamMw, 'MW')}`,
      at: [258, 84],
      anchor: 'middle',
    },
    {
      pts: [
        [404, 109],
        [446, 109],
      ],
      value: r.mechMw,
      kind: 'useful',
    },
    {
      pts: [
        [538, 109],
        [586, 109],
      ],
      value: pMw,
      kind: 'useful',
      label: val(pMw, 'MW'),
      at: [626, 80],
      anchor: 'middle',
    },
    {
      pts: [
        [470, 134],
        [470, 162],
      ],
      value: r.genLossMw,
      kind: 'loss',
      label: `generator loss ${val(r.genLossMw, 'MW')}`,
      at: [462, 156],
      anchor: 'end',
    },
    {
      pts: [
        [352, 134],
        [352, 190],
      ],
      value: r.condenserMw,
      kind: 'loss',
      label: `${val(r.condenserMw, 'MW')} to the condenser`,
      at: [340, 170],
      anchor: 'end',
    },
    {
      pts: [
        [404, 213],
        [450, 213],
      ],
      value: r.condenserMw,
      kind: 'loss',
    },
    {
      pts: [
        [528, 190],
        [528, 158],
      ],
      value: r.condenserMw,
      kind: 'loss',
      label: 'to the air',
      at: [546, 172],
    },
    {
      pts: [
        [330, 236],
        [330, 268],
        [280, 268],
      ],
      kind: 'water',
      label: 'condensate',
      at: [336, 262],
    },
    {
      pts: [
        [196, 268],
        [150, 268],
        [150, 230],
      ],
      kind: 'water',
      label: 'feed water',
      at: [100, 286],
    },
  ]
  return (
    <Pfd nodes={nodes} flows={flows} vmax={r.qInMw} selected={selected} label={`Coal station process flow: ${val(r.qInMw, 'MW')} of coal heat gives ${val(pMw, 'MW')} of electricity`} note={NOTE} />
  )
}

export function HydroPfd({ r, pMw, headM, selected }: { r: HydroResult; pMw: number; headM: number; selected?: string | null }) {
  const nodes: Node[] = [
    { id: 'reservoir', x: 14, y: 40, w: 120, h: 58, label: 'Reservoir', sub: `head ${grp(headM, 0)} m` },
    { id: 'dam', x: 140, y: 30, w: 40, h: 120, label: 'Dam' },
    { id: 'generator', x: 300, y: 84, w: 100, h: 50, label: 'Generator' },
    { id: 'turbine', x: 300, y: 180, w: 100, h: 50, label: 'Turbine' },
    { id: 'grid', x: 586, y: 89, w: 80, h: 40, label: 'Grid' },
    { id: 'tailrace', x: 470, y: 236, w: 130, h: 40, label: 'Tailrace', sub: `${grp(r.qM3s, r.qM3s < 100 ? 1 : 0)} m³/s` },
  ]
  const flows: Flow[] = [
    {
      pts: [
        [180, 70],
        [230, 70],
        [230, 205],
        [300, 205],
      ],
      value: r.waterMw,
      kind: 'useful',
      label: `penstock: ρgQH ${val(r.waterMw, 'MW')}`,
      at: [222, 160],
      anchor: 'end',
    },
    {
      pts: [
        [330, 230],
        [330, 266],
      ],
      value: r.chain.steps[0].loss,
      kind: 'loss',
      label: `turbine loss ${val(r.chain.steps[0].loss, 'MW')}`,
      at: [338, 262],
    },
    {
      pts: [
        [350, 180],
        [350, 134],
      ],
      value: r.mechMw,
      kind: 'useful',
      label: `shaft ${val(r.mechMw, 'MW')}`,
      at: [362, 162],
    },
    {
      pts: [
        [350, 84],
        [350, 50],
      ],
      value: r.chain.steps[1].loss,
      kind: 'loss',
      label: `generator loss ${val(r.chain.steps[1].loss, 'MW')}`,
      at: [358, 56],
    },
    {
      pts: [
        [400, 109],
        [586, 109],
      ],
      value: pMw,
      kind: 'useful',
      label: val(pMw, 'MW'),
      at: [494, 94],
      anchor: 'middle',
    },
    {
      pts: [
        [400, 205],
        [440, 205],
        [440, 256],
        [470, 256],
      ],
      kind: 'water',
      label: 'water out',
      at: [446, 230],
    },
  ]
  return <Pfd nodes={nodes} flows={flows} vmax={r.waterMw} selected={selected} label={`Hydro station process flow: ${val(r.waterMw, 'MW')} in the falling water gives ${val(pMw, 'MW')}`} note={NOTE} />
}

export function NuclearPfd({ r, pMw, selected }: { r: NuclearResult; pMw: number; selected?: string | null }) {
  const nodes: Node[] = [
    { id: 'core', x: 24, y: 70, w: 86, h: 150, label: 'Reactor', sub: 'core' },
    { id: 'sg', x: 150, y: 70, w: 86, h: 150, label: 'Steam', sub: 'generator' },
    { id: 'turbine', x: 300, y: 84, w: 104, h: 50, label: 'Turbine' },
    { id: 'generator', x: 446, y: 84, w: 92, h: 50, label: 'Generator' },
    { id: 'grid', x: 586, y: 89, w: 80, h: 40, label: 'Grid' },
    { id: 'condenser', x: 300, y: 190, w: 104, h: 46, label: 'Condenser' },
    { id: 'tower', x: 450, y: 190, w: 100, h: 46, label: 'Cooling tower' },
  ]
  const flows: Flow[] = [
    {
      pts: [
        [110, 120],
        [150, 120],
      ],
      value: r.thermalMw,
      kind: 'useful',
      label: `${val(r.thermalMw, 'MW')} heat`,
      at: [130, 60],
      anchor: 'middle',
    },
    {
      pts: [
        [150, 196],
        [110, 196],
      ],
      kind: 'water',
      label: 'coolant back',
      at: [130, 240],
      anchor: 'middle',
    },
    {
      pts: [
        [236, 109],
        [300, 109],
      ],
      value: r.thermalMw,
      kind: 'useful',
      label: 'steam',
      at: [268, 84],
      anchor: 'middle',
    },
    {
      pts: [
        [404, 109],
        [446, 109],
      ],
      value: pMw,
      kind: 'useful',
    },
    {
      pts: [
        [538, 109],
        [586, 109],
      ],
      value: pMw,
      kind: 'useful',
      label: val(pMw, 'MW'),
      at: [626, 80],
      anchor: 'middle',
    },
    {
      pts: [
        [352, 134],
        [352, 190],
      ],
      value: r.rejectedMw,
      kind: 'loss',
      label: `${val(r.rejectedMw, 'MW')} rejected`,
      at: [340, 170],
      anchor: 'end',
    },
    {
      pts: [
        [404, 213],
        [450, 213],
      ],
      value: r.rejectedMw,
      kind: 'loss',
    },
    {
      pts: [
        [528, 190],
        [528, 158],
      ],
      value: r.rejectedMw,
      kind: 'loss',
      label: 'to the air',
      at: [546, 172],
    },
    {
      pts: [
        [330, 236],
        [330, 268],
        [193, 268],
        [193, 220],
      ],
      kind: 'water',
      label: 'feed water',
      at: [250, 286],
    },
  ]
  return (
    <Pfd
      nodes={nodes}
      flows={flows}
      vmax={r.thermalMw}
      selected={selected}
      frames={[{ x: 12, y: 50, w: 236, h: 222, label: 'Containment' }]}
      label={`Nuclear station process flow: ${val(r.thermalMw, 'MW')} of fission heat gives ${val(pMw, 'MW')}`}
      note={`${NOTE} Only the overall thermal efficiency is modelled, so all losses are shown as heat rejected.`}
    />
  )
}

export function PumpedPfd({ r, p, selected }: { r: PumpedResult; p: PumpedIn; selected?: string | null }) {
  const gen = p.mode === 'generate'
  const P = p.pMw
  // power during the mode shown [MW]
  const water = gen ? P / (p.etaTurbine * p.etaGen) : P * p.etaMotor * p.etaPump
  const shaft = gen ? P / p.etaGen : P * p.etaMotor
  const machLoss = gen ? water - shaft : shaft - water
  const elLoss = gen ? shaft - P : P - shaft
  const nodes: Node[] = [
    { id: 'upper', x: 14, y: 30, w: 130, h: 50, label: 'Upper reservoir' },
    { id: 'motorgen', x: 300, y: 84, w: 110, h: 50, label: 'Motor-generator', sub: gen ? 'as generator' : 'as motor' },
    { id: 'machine', x: 300, y: 180, w: 110, h: 50, label: 'Pump-turbine', sub: gen ? 'as turbine' : 'as pump' },
    { id: 'grid', x: 586, y: 89, w: 80, h: 40, label: 'Grid' },
    { id: 'lower', x: 520, y: 236, w: 146, h: 40, label: 'Lower reservoir' },
  ]
  const down: Pt[] = [
    [144, 55],
    [230, 55],
    [230, 205],
    [300, 205],
  ]
  const flows: Flow[] = gen
    ? [
        { pts: down, value: water, kind: 'useful', label: `water ${val(water, 'MW')}`, at: [220, 150], anchor: 'end' },
        {
          pts: [
            [330, 230],
            [330, 266],
          ],
          value: machLoss,
          kind: 'loss',
          label: `turbine loss ${val(machLoss, 'MW')}`,
          at: [338, 262],
        },
        {
          pts: [
            [355, 180],
            [355, 134],
          ],
          value: shaft,
          kind: 'useful',
          label: `shaft ${val(shaft, 'MW')}`,
          at: [368, 162],
        },
        {
          pts: [
            [355, 84],
            [355, 50],
          ],
          value: elLoss,
          kind: 'loss',
          label: `generator loss ${val(elLoss, 'MW')}`,
          at: [364, 56],
        },
        {
          pts: [
            [410, 109],
            [586, 109],
          ],
          value: P,
          kind: 'useful',
          label: `${val(P, 'MW')} to the grid`,
          at: [498, 94],
          anchor: 'middle',
        },
        {
          pts: [
            [410, 205],
            [480, 205],
            [480, 256],
            [520, 256],
          ],
          kind: 'water',
          label: `${grp(r.qGen, 0)} m³/s`,
          at: [430, 196],
        },
      ]
    : [
        {
          pts: [
            [586, 109],
            [410, 109],
          ],
          value: P,
          kind: 'useful',
          label: `${val(P, 'MW')} from the grid`,
          at: [498, 94],
          anchor: 'middle',
        },
        {
          pts: [
            [355, 84],
            [355, 50],
          ],
          value: elLoss,
          kind: 'loss',
          label: `motor loss ${val(elLoss, 'MW')}`,
          at: [364, 56],
        },
        {
          pts: [
            [355, 134],
            [355, 180],
          ],
          value: shaft,
          kind: 'useful',
          label: `shaft ${val(shaft, 'MW')}`,
          at: [368, 162],
        },
        {
          pts: [
            [330, 230],
            [330, 266],
          ],
          value: machLoss,
          kind: 'loss',
          label: `pump loss ${val(machLoss, 'MW')}`,
          at: [338, 262],
        },
        { pts: [...down].reverse(), value: water, kind: 'useful', label: `water raised ${val(water, 'MW')}`, at: [220, 150], anchor: 'end' },
        {
          pts: [
            [520, 256],
            [480, 256],
            [480, 205],
            [410, 205],
          ],
          kind: 'water',
          label: `${grp(r.qPump, 0)} m³/s`,
          at: [430, 196],
        },
      ]
  return (
    <Pfd
      nodes={nodes}
      flows={flows}
      vmax={Math.max(water, P)}
      selected={selected}
      label={`Pumped storage, ${gen ? 'generating' : 'pumping'}: ${val(P, 'MW')} ${gen ? 'to' : 'from'} the grid`}
      note={`${NOTE} Shown ${gen ? 'generating (peak)' : 'pumping (off-peak)'} at the machine rating.`}
    />
  )
}

export function PlantPfd({
  type,
  res,
  inputs,
  selected,
}: {
  type: PlantType
  res: { thermal?: ThermalResult; hydro?: HydroResult; nuclear?: NuclearResult; pumped?: PumpedResult }
  inputs: { pMw: number; headM?: number; pumped?: PumpedIn }
  selected?: string | null
}) {
  if (type === 'thermal' && res.thermal) return <ThermalPfd r={res.thermal} pMw={inputs.pMw} selected={selected} />
  if (type === 'hydro' && res.hydro) return <HydroPfd r={res.hydro} pMw={inputs.pMw} headM={inputs.headM ?? 0} selected={selected} />
  if (type === 'nuclear' && res.nuclear) return <NuclearPfd r={res.nuclear} pMw={inputs.pMw} selected={selected} />
  if (type === 'pumped' && res.pumped && inputs.pumped) return <PumpedPfd r={res.pumped} p={inputs.pumped} selected={selected} />
  return <p className="small muted">No diagram: the inputs are not valid.</p>
}

// ── SCADA schematic (illustration) ───────────────────────────────────────────────────────────────────────────

export interface ScadaBlock {
  id: string
  name: string
  what: string
}
export const SCADA_BLOCKS: ScadaBlock[] = [
  {
    id: 'rtu',
    name: 'RTU (remote terminal unit)',
    what: 'A computer in the substation that reads the transducers (MW, Mvar, voltage, current, frequency), the breaker and isolator positions and alarms, and carries out commands from the control centre (open or close a breaker, raise or lower a tap).',
  },
  {
    id: 'ied',
    name: 'IEDs (intelligent electronic devices)',
    what: 'Digital relays, meters and bay controllers with their own processors. They measure, protect and can report directly over the substation network — many RTU functions now live in them.',
  },
  {
    id: 'pmu',
    name: 'PMU (phasor measurement unit)',
    what: 'Measures voltage and current phasors — magnitude AND angle — stamped with GPS time, so measurements from substations far apart can be compared at the same instant. It streams them many times a second, much faster than SCADA scans.',
  },
  { id: 'gps', name: 'GPS time', what: 'Satellite time signals give every PMU the same clock, to a small fraction of a cycle: that is what makes the angles at different places comparable.' },
  {
    id: 'comms',
    name: 'Communication network',
    what: 'Carries measurements up and commands down: optical fibre (often in the earth wire of a line), power-line carrier, microwave or radio links, using standard telecontrol protocols.',
  },
  { id: 'fep', name: 'Front-end processors', what: 'Talk to the RTUs: poll them in turn (or receive their reports), check the data and pass it on to the SCADA server.' },
  {
    id: 'server',
    name: 'SCADA server and historian',
    what: 'The real-time database: every measured value and status, alarms when something leaves its limits, and a historian that stores it all for later analysis.',
  },
  {
    id: 'ems',
    name: 'EMS applications',
    what: 'The energy-management system turns the raw data into decisions: state estimation (the best consistent picture), load–frequency control / AGC, economic dispatch, contingency (security) analysis.',
  },
  { id: 'hmi', name: 'Operator HMI', what: 'The human–machine interface: the one-line diagrams, alarms and trends the operators watch, and the controls they use to send commands.' },
  {
    id: 'pdc',
    name: 'PDC (phasor data concentrator)',
    what: 'Collects the PMU streams, lines them up by their time stamps and feeds wide-area monitoring (WAMS): angles across the grid, oscillations, islanding.',
  },
]

export function ScadaDiagram({ selected, onSelect }: { selected: string | null; onSelect(id: string | null): void }) {
  const click = (id: string) => () => onSelect(selected === id ? null : id)
  const key = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(selected === id ? null : id)
    }
  }
  const Block = ({ id, x, y, w, h, text }: { id: string; x: number; y: number; w: number; h: number; text: string[] }) => {
    const b = SCADA_BLOCKS.find((q) => q.id === id)!
    return (
      <g className={`gen-sc-block ${selected === id ? 'is-sel' : ''}`} role="button" tabIndex={0} aria-pressed={selected === id} aria-label={b.name} onClick={click(id)} onKeyDown={key(id)}>
        <rect x={x} y={y} width={w} height={h} rx={6} />
        {text.map((t, k) => (
          <text key={k} x={x + w / 2} y={y + h / 2 + 4 + (k - (text.length - 1) / 2) * 13} textAnchor="middle">
            {t}
          </text>
        ))}
      </g>
    )
  }
  const subs = [
    { k: 1, x: 24, pmu: true },
    { k: 2, x: 252, pmu: false },
    { k: 3, x: 480, pmu: true },
  ]
  return (
    <figure className="gen-scada">
      <svg viewBox="0 0 680 352" role="group" aria-label="SCADA and wide-area monitoring: substations, communication, control centre (illustration)">
        <rect x={10} y={8} width={660} height={108} rx={10} className="gen-sc-centre" />
        <text x={20} y={26} className="gen-sc-title">
          Control centre
        </text>
        <Block id="fep" x={22} y={40} w={116} h={56} text={['Front-end', 'processors']} />
        <Block id="server" x={152} y={40} w={116} h={56} text={['SCADA server', '& historian']} />
        <Block id="ems" x={282} y={40} w={116} h={56} text={['EMS', 'applications']} />
        <Block id="hmi" x={412} y={40} w={116} h={56} text={['Operator', 'HMI']} />
        <Block id="pdc" x={542} y={40} w={116} h={56} text={['PDC', '(phasors)']} />
        {[138, 268, 398].map((x) => (
          <line key={x} x1={x} x2={x + 14} y1={68} y2={68} className="gen-sc-link" />
        ))}
        <line x1={80} x2={80} y1={96} y2={150} className="gen-sc-link" />
        <line x1={600} x2={600} y1={96} y2={150} className="gen-sc-link gen-sc-link--pmu" />
        <Block id="comms" x={40} y={150} w={600} h={36} text={['Communication network — fibre, power-line carrier, microwave, radio']} />
        {subs.map((s) => (
          <g key={s.k}>
            <rect x={s.x} y={222} width={176} height={124} rx={8} className="gen-sc-sub" />
            <text x={s.x + 10} y={338} className="gen-sc-title">
              Substation · bus {s.k}
            </text>
            <line x1={s.x + 47} x2={s.x + 47} y1={232} y2={186} className="gen-sc-link" />
            {s.pmu && <polyline points={`${s.x + 10},287 ${s.x + 5},287 ${s.x + 5},186`} className="gen-sc-link gen-sc-link--pmu" />}
            <Block id="rtu" x={s.x + 10} y={232} w={74} h={34} text={['RTU']} />
            <Block id="ied" x={s.x + 92} y={232} w={74} h={34} text={['IEDs']} />
            {s.pmu && <Block id="pmu" x={s.x + 10} y={272} w={74} h={30} text={['PMU']} />}
            {s.pmu && <Block id="gps" x={s.x + 92} y={272} w={74} h={30} text={['GPS clock']} />}
          </g>
        ))}
      </svg>
      <figcaption className="small muted">
        Illustration: the parts of a SCADA / EMS system and the paths of data — not a real network, no numbers. Solid lines: SCADA polling and reports; dashed: PMU streams (GPS-time-stamped). Select a
        block to read what it does.
      </figcaption>
    </figure>
  )
}

// ── the estimation network (calculated) ─────────────────────────────────────────────────────────────────────

const BUS_XY: Record<1 | 2 | 3, Pt> = { 1: [100, 64], 2: [420, 64], 3: [260, 236] }

export function EstimationNetwork({ out, enabled, bad }: { out: SeOutcome; enabled: Record<MeasId, boolean>; bad: MeasId | null }) {
  const defs = measDefs()
  const est = out.ok ? out : null
  const lines: Array<[1 | 2 | 3, 1 | 2 | 3, MeasId]> = [
    [1, 2, 'P12'],
    [1, 3, 'P13'],
    [2, 3, 'P23'],
  ]
  const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  const meterAt = (id: MeasId): Pt => {
    const d = defs[id]
    if (d.at.line) return lerp(BUS_XY[d.at.line[0]], BUS_XY[d.at.line[1]], 0.24)
    const b = d.at.bus!
    const p = BUS_XY[b]
    if (id === 'TH3') return [p[0] + 58, p[1] + 26]
    return b === 3 ? [p[0] - 58, p[1] + 26] : [p[0], p[1] - 34]
  }
  const status = (id: MeasId) => {
    if (!enabled[id]) return 'off'
    const m = est?.meas.find((q) => q.id === id)
    if (!m) return 'off'
    if (est?.flagged === id) return 'flag'
    if (m.critical) return 'crit'
    return 'ok'
  }
  const angle = (id: 1 | 2 | 3) => (est ? (id === 1 ? 0 : est.x[id - 2]) : null)
  return (
    <figure className="gen-net">
      <svg viewBox="-70 0 660 300" role="img" aria-label="Three-bus network with its meters">
        {lines.map(([i, j, id]) => {
          const a = BUS_XY[i]
          const b = BUS_XY[j]
          const m = lerp(a, b, 0.55)
          const f = est ? (((angle(i) as number) - (angle(j) as number)) / (id === 'P12' ? NET.x12 : id === 'P13' ? NET.x13 : NET.x23)) * BASE_MVA : null
          const dir = f !== null && f < 0 ? -1 : 1
          const ux = ((b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1])) * dir
          const uy = ((b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1])) * dir
          return (
            <g key={id}>
              <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="gen-net-line" />
              {f !== null && (
                <>
                  <polygon
                    points={`${m[0] + ux * 8},${m[1] + uy * 8} ${m[0] - ux * 6 - uy * 6},${m[1] - uy * 6 + ux * 6} ${m[0] - ux * 6 + uy * 6},${m[1] - uy * 6 - ux * 6}`}
                    className="gen-net-arrow"
                  />
                  <text
                    x={m[0] + (id === 'P12' ? 0 : id === 'P13' ? -16 : 16)}
                    y={m[1] + (id === 'P12' ? 22 : 4)}
                    textAnchor={id === 'P13' ? 'end' : id === 'P23' ? 'start' : 'middle'}
                    className="gen-net-val"
                  >
                    {fx(Math.abs(f), 1)} MW
                  </text>
                </>
              )}
            </g>
          )
        })}
        {([1, 2, 3] as const).map((b) => {
          const p = BUS_XY[b]
          const th = angle(b)
          return (
            <g key={b}>
              <line x1={p[0] - 34} x2={p[0] + 34} y1={p[1]} y2={p[1]} className="gen-net-bus" />
              <text x={p[0] + (b === 1 ? -40 : b === 2 ? 40 : 0)} y={p[1] + (b === 3 ? 46 : 4)} textAnchor={b === 1 ? 'end' : b === 2 ? 'start' : 'middle'} className="gen-net-busname">
                Bus {b}
                {b === 1 ? ' (gen.)' : ' (load)'}
              </text>
              {th !== null && (
                <text x={p[0] + (b === 1 ? -40 : b === 2 ? 40 : 0)} y={p[1] + (b === 3 ? 60 : 18)} textAnchor={b === 1 ? 'end' : b === 2 ? 'start' : 'middle'} className="gen-net-val">
                  θ̂ {b === 1 ? '0 (reference)' : `${fx(th / DEG, 3)}°`}
                </text>
              )}
            </g>
          )
        })}
        {(Object.keys(defs) as MeasId[]).map((id) => {
          const [x, y] = meterAt(id)
          const st = status(id)
          const k = defs[id].kind
          const shape =
            k === 'flow' ? (
              <rect x={x - 7} y={y - 7} width={14} height={14} rx={2} />
            ) : k === 'injection' ? (
              <circle cx={x} cy={y} r={8} />
            ) : (
              <polygon points={`${x},${y - 9} ${x + 9},${y} ${x},${y + 9} ${x - 9},${y}`} />
            )
          return (
            <g key={id} className={`gen-meter gen-meter--${st} ${bad === id ? 'is-bad' : ''}`}>
              <title>
                {defs[id].name}: {st === 'off' ? 'not used' : st === 'flag' ? 'flagged as bad data' : st === 'crit' ? 'critical — its error cannot be detected' : 'used'}
              </title>
              {shape}
              <text x={x} y={y + 4} textAnchor="middle" className="gen-meter-mark">
                {st === 'flag' ? '!' : st === 'crit' ? '?' : ''}
              </text>
              <text x={x + (id === 'P3' ? -12 : 12)} y={y - 10} textAnchor={id === 'P3' ? 'end' : 'start'} className="gen-meter-id">
                {id === 'TH3' ? 'θ₃' : id}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className="small muted">
        Schematic network (DC model). Squares: flow meters; circles: injection meters; diamond: the PMU angle at bus 3 (referenced to a PMU at bus 1). Calculated: estimated angles and flows from x̂; a
        meter marked ! is flagged by the largest-normalised-residual test, ? is critical (its error cannot be seen); hollow meters are not used.
      </figcaption>
    </figure>
  )
}

// ── reactor cut-away (illustration) ──────────────────────────────────────────────────────────────────────────

export function ReactorDiagram() {
  const id = useId()
  return (
    <figure className="gen-reactor">
      <svg viewBox="0 0 680 300" role="img" aria-label="Pressurised-water reactor: fuel, moderator and coolant, control rods, shielding (illustration)">
        <defs>
          <linearGradient id={`${id}w`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4f95ea" stopOpacity="0.35" />
            <stop offset="1" stopColor="#4f95ea" stopOpacity="0.15" />
          </linearGradient>
        </defs>
        <path d="M40 286 L40 110 Q40 24 170 24 Q300 24 300 110 L300 286 Z" className="gen-rx-shield" />
        <text x={56} y={276} className="gen-rx-label">
          Containment &amp; shielding
        </text>
        <rect x={110} y={70} width={90} height={190} rx={40} className="gen-rx-vessel" />
        <rect x={116} y={120} width={78} height={120} rx={8} fill={`url(#${id}w)`} />
        {Array.from({ length: 7 }, (_, k) => (
          <rect key={k} x={122 + k * 10} y={140} width={5} height={88} className="gen-rx-fuel" />
        ))}
        {[0, 1, 2].map((k) => (
          <rect key={k} x={129 + k * 20} y={84} width={5} height={84} className="gen-rx-rod" />
        ))}
        <path d="M200 140 L236 140 L236 96 L262 96" className="gen-rx-hot" />
        <path d="M262 236 L236 236 L236 220 L200 220" className="gen-rx-cold" />
        <rect x={262} y={70} width={30} height={180} rx={12} className="gen-rx-sg" />
        <path d="M292 100 L360 100" className="gen-rx-steam" />
        <path d="M360 220 L292 220" className="gen-rx-cold" />
        {(
          [
            [126, 136, 330, 150, 'Fuel: uranium oxide pellets in rods (U-235 fissions)'],
            [140, 90, 330, 60, 'Control rods: absorb neutrons — in to slow the reaction, out to speed it'],
            [176, 196, 330, 186, 'Water: moderator (slows neutrons) and coolant'],
            [244, 120, 330, 122, 'Hot coolant to the steam generator'],
            [278, 250, 330, 262, 'Steam generator: heat to a separate water loop → steam to the turbine'],
          ] as Array<[number, number, number, number, string]>
        ).map(([x1, y1, x2, y2, t]) => (
          <g key={t}>
            <line x1={x1} y1={y1} x2={x2 - 4} y2={y2 - 4} className="gen-rx-leader" />
            {wrap(t, 46).map((ln, j) => (
              <text key={j} x={x2} y={y2 + j * 13} className="gen-rx-label">
                {ln}
              </text>
            ))}
          </g>
        ))}
      </svg>
      <figcaption className="small muted">Illustration of a pressurised-water reactor (not to scale, no numbers).</figcaption>
    </figure>
  )
}
