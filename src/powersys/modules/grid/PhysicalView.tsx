import type { KeyboardEvent, ReactNode } from 'react'
import type { Solution } from '../../network/solve.ts'
import { inService } from '../../network/topology.ts'
import type { Network } from '../../network/types.ts'
import { fx } from '../../ui/format.ts'

/**
 * The Grid Explorer's physical view: the same network as the single-line diagram, drawn as you would see it —
 * power station, step-up transformer, transmission towers, substations, poles, the factory and the town. Every
 * object is the network component with the same id (select it here or on the diagram: it is the same thing), and
 * its colour, state and flow come from the same solution. Schematic, not to scale.
 */

type Pt = [number, number]
const GROUND = 310

/** Conductor routes for each branch (the middle phase carries the flow animation), in from → to order. */
const ROUTES: Record<string, Pt[][]> = {
  T1: [
    [
      [70, 276],
      [140, 276],
    ],
  ],
  L1: span3(
    [250, 206],
    [
      [300, 0],
      [385, 0],
      [470, 0],
    ],
    [520, 206],
  ),
  T2: [
    [
      [560, 206],
      [585, 236],
    ],
  ],
  L2: span3pole([660, 246], [800, 870], [930, 238]),
  T3: [
    [
      [958, 285],
      [985, 252],
    ],
  ],
}

/** A three-phase span over lattice towers: three conductors from the start gantry, over the towers, to the end. */
function span3(a: Pt, towers: Pt[], b: Pt): Pt[][] {
  const offs: Array<[number, number]> = [
    [-30, 186],
    [30, 186],
    [24, 208],
  ]
  return offs.map(([dx, y], k) => [[a[0], a[1] - 3 + k * 3] as Pt, ...towers.map(([x]) => [x + dx, y] as Pt), [b[0], b[1] - 3 + k * 3] as Pt])
}
function span3pole(a: Pt, poles: number[], b: Pt): Pt[][] {
  const offs: Array<[number, number]> = [
    [-14, 230],
    [0, 224],
    [14, 230],
  ]
  return offs.map(([dx, y], k) => [[a[0], a[1] - 3 + k * 3] as Pt, ...poles.map((x) => [x + dx, y] as Pt), [b[0], b[1] - 3 + k * 3] as Pt])
}

/** A conductor between support points, sagging between each pair. */
function catenary(p: Pt[], sag = 12): string {
  let d = `M${p[0][0]} ${p[0][1]}`
  for (let i = 1; i < p.length; i++) {
    const [x0, y0] = p[i - 1]
    const [x1, y1] = p[i]
    const span = Math.abs(x1 - x0)
    const s = span > 40 ? sag : 2
    d += ` Q${(x0 + x1) / 2} ${(y0 + y1) / 2 + s * 2} ${x1} ${y1}`
  }
  return d
}

function Tower({ x }: { x: number }) {
  const top = 168
  return (
    <g className="ps-struct">
      <path d={`M${x - 16} ${GROUND}L${x - 5} ${top + 10}M${x + 16} ${GROUND}L${x + 5} ${top + 10}M${x - 5} ${top + 10}L${x} ${top}L${x + 5} ${top + 10}`} />
      <path d={`M${x - 30} 186H${x + 30}M${x - 24} 208H${x + 24}`} />
      <path d={`M${x - 13} 280L${x + 11} 250L${x - 9} 222L${x + 7} 196M${x + 13} 280L${x - 11} 250L${x + 9} 222L${x - 7} 196`} className="ps-struct-thin" />
      {/* insulator strings */}
      <path d={`M${x - 30} 186v4M${x + 30} 186v4M${x + 24} 208v4`} className="ps-insulator" />
    </g>
  )
}

function Pole({ x }: { x: number }) {
  return (
    <g className="ps-struct">
      <path d={`M${x} ${GROUND}V218M${x - 18} 228H${x + 18}`} />
    </g>
  )
}

function Gantry({ x0, x1, y }: { x0: number; x1: number; y: number }) {
  return (
    <g className="ps-struct">
      <path d={`M${x0} ${GROUND}V${y - 6}M${x1} ${GROUND}V${y - 6}M${x0 - 4} ${y - 6}H${x1 + 4}`} />
    </g>
  )
}

function Tank({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={3} className="ps-tank" />
      {Array.from({ length: Math.floor(w / 8) }, (_, k) => (
        <path key={k} d={`M${x + 5 + k * 8} ${y + 8}v${h - 14}`} className="ps-fin" />
      ))}
    </g>
  )
}

function House({ x, w, h, roof = 14 }: { x: number; w: number; h: number; roof?: number }) {
  return (
    <g>
      <rect x={x} y={GROUND - h} width={w} height={h} className="ps-building" />
      <path d={`M${x - 3} ${GROUND - h}L${x + w / 2} ${GROUND - h - roof}L${x + w + 3} ${GROUND - h}`} className="ps-roof" />
      <rect x={x + w / 2 - 4} y={GROUND - 12} width={8} height={12} className="ps-window" />
      <rect x={x + 4} y={GROUND - h + 6} width={7} height={6} className="ps-window ps-window--lit" />
    </g>
  )
}

export interface PhysicalProps {
  net: Network
  sol: Solution | null
  selected?: string | null
  onSelect?(id: string): void
  highlight?: string[]
  animate?: boolean
  showValues?: boolean
}

export function PhysicalView({ net, sol, selected, onSelect, highlight, animate = true, showValues = true }: PhysicalProps) {
  const hl = highlight && highlight.length ? new Set(highlight) : null
  const comp = (id: string) => net.components.find((c) => c.id === id)
  const busOn = (id: string) => sol?.bus[id]?.energized ?? true
  const on = (id: string): boolean => {
    const c = comp(id)
    if (!c) return busOn(id)
    if (c.kind === 'line' || c.kind === 'transformer') return inService(net, c) && busOn(c.from) && busOn(c.to)
    if (c.kind === 'load' || c.kind === 'generator' || c.kind === 'grid') return inService(net, c) && busOn(c.bus)
    return c.closed
  }
  const cls = (id: string, extra = '') => `ps-el ${extra} ${selected === id ? 'is-selected' : ''} ${hl && !hl.has(id) ? 'is-dim' : ''} ${hl?.has(id) ? 'is-hl' : ''} ${on(id) ? '' : 'is-dead'}`
  const name = (id: string) => comp(id)?.name ?? net.buses.find((b) => b.id === id)?.name ?? id
  const act = (id: string) =>
    onSelect
      ? {
          role: 'button',
          tabIndex: 0,
          'aria-label': `${name(id)}${on(id) ? '' : ' (not energised)'}`,
          'aria-pressed': selected === id,
          onClick: (e: { stopPropagation(): void }) => {
            e.stopPropagation()
            onSelect(id)
          },
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onSelect(id)
            }
          },
        }
      : {}
  const conductors = (id: string, lv: string, sag?: number) => {
    const r = sol?.branch[id]
    const fwd = (r?.pFromMw ?? 0) >= 0
    const p = Math.abs(r?.pFromMw ?? 0)
    const routes = ROUTES[id]
    const mid = routes[Math.floor(routes.length / 2)]
    const path = (pts: Pt[]) => catenary(pts, sag)
    return (
      <>
        {routes.map((pts, k) => (
          <path key={k} d={path(pts)} className={`ps-wire ps-wire--thin ps-lv--${lv}`} />
        ))}
        <path d={path(mid)} className="ps-hit" />
        {animate && on(id) && p > 0.05 && (
          <path
            d={path(fwd ? mid : [...mid].reverse())}
            className="ps-flow"
            style={{
              animationDuration: `${Math.max(0.6, Math.min(6, 60 / p))}s`,
            }}
          />
        )}
      </>
    )
  }
  const breaker = (id: string, x: number, y: number) => {
    const c = comp(id)
    if (c?.kind !== 'breaker') return null
    return (
      <g
        className={`ps-el ps-breaker ${c.closed ? 'is-closed' : 'is-open'} ${selected === id ? 'is-selected' : ''} ${hl && !hl.has(id) ? 'is-dim' : ''}`}
        {...act(id)}
        aria-label={`${c.name}: ${c.closed ? 'closed' : 'open'}`}
      >
        <rect x={x - 6} y={y - 6} width={12} height={12} rx={2} />
      </g>
    )
  }
  const tag = (x: number, y: number, text: ReactNode, anchor: 'start' | 'middle' | 'end' = 'middle') => (
    <text x={x} y={y} className="ps-tag" textAnchor={anchor}>
      {text}
    </text>
  )
  const v = (bus: string) => (sol?.bus[bus]?.energized ? `${fx(sol.bus[bus].kv, 1)} kV` : 'no supply')
  const mw = (id: string) => {
    const r = sol?.branch[id]
    return r && on(id) ? `${fx(Math.abs(r.pFromMw), 1)} MW` : '0 MW'
  }

  const zones: Array<{
    x0: number
    x1: number
    lv: string
    title: string
    value: string
  }> = [
    {
      x0: 4,
      x1: 186,
      lv: 'mv',
      title: 'Generation · 13.8 kV',
      value: `${v('gen')} · ${fx(sol?.source.G1?.pMw ?? 0, 1)} MW`,
    },
    {
      x0: 190,
      x1: 566,
      lv: 'ehv',
      title: 'Transmission · 220 kV',
      value: `${v('hvA')} → ${v('hvB')} · ${mw('L1')}`,
    },
    {
      x0: 570,
      x1: 906,
      lv: 'hv',
      title: 'Sub-transmission · 33 kV',
      value: `${v('mvA')} → ${v('mvB')} · ${mw('L2')}`,
    },
    {
      x0: 910,
      x1: 1096,
      lv: 'mv',
      title: 'Distribution · 11 kV',
      value: `${v('lv')} · ${sol?.load.town?.served ? `${fx(sol.load.town.pMw, 1)} MW` : 'no supply'}`,
    },
  ]

  return (
    <svg className={`ps-sld ps-phys ${animate ? 'is-animated' : ''}`} viewBox="0 64 1100 262" role="group" aria-label="Physical view of the grid: power station to town">
      {/* voltage zones */}
      {zones.map((z) => (
        <g key={z.title} className={`ps-zone ps-lv--${z.lv}`} aria-hidden="true">
          <rect x={z.x0} y={74} width={z.x1 - z.x0} height={4} rx={2} className="ps-zone-bar" />
          <text x={z.x0 + 2} y={95} className="ps-zone-title">
            {z.title}
          </text>
          {showValues && sol && (
            <text x={z.x0 + 2} y={111} className="ps-zone-value">
              {z.value}
            </text>
          )}
        </g>
      ))}
      <path d={`M0 ${GROUND}H1100`} className="ps-ground" />

      {/* power station + generator */}
      <g className={cls('G1')} {...act('G1')}>
        <rect x={10} y={225} width={102} height={85} className="ps-building" />
        <rect x={86} y={140} width={18} height={85} className="ps-building" />
        <rect x={10} y={232} width={102} height={4} className="ps-building-band" />
        <circle cx={46} cy={276} r={20} className="ps-gen ps-lv--mv" />
        <path d="M36 276q5 -8 10 0t10 0" className="ps-gen-wave" />
        {tag(60, 132, 'G1')}
      </g>
      {/* generator bus duct */}
      <g className={cls('gen')} {...act('gen')}>
        <path d="M66 276H76" className="ps-wire ps-lv--mv" />
      </g>
      {/* step-up transformer */}
      <g className={cls('T1')} {...act('T1')}>
        {conductors('T1', 'mv')}
        <Tank x={140} y={255} w={44} h={55} />
        <path d="M150 255v-18M162 255v-18M174 255v-18" className="ps-bushing" />
        <path d="M174 237L205 206" className="ps-wire ps-wire--thin ps-lv--ehv" />
        {tag(162, 228, 'T1')}
      </g>
      {/* 220 kV switchyard */}
      <g className={cls('hvA')} {...act('hvA')}>
        <Gantry x0={205} x1={245} y={206} />
        <path d="M200 206H250" className="ps-wire ps-lv--ehv" />
      </g>
      {/* 220 kV line */}
      <g className={cls('L1')} {...act('L1')}>
        {[300, 385, 470].map((x) => (
          <Tower key={x} x={x} />
        ))}
        {conductors('L1', 'ehv')}
        {tag(427, 160, 'L1 · 120 km')}
      </g>
      {breaker('CB1', 262, 206)}
      {/* grid substation */}
      <g className={cls('hvB')} {...act('hvB')}>
        <Gantry x0={520} x1={560} y={206} />
        <path d="M515 206H565" className="ps-wire ps-lv--ehv" />
      </g>
      <g className={cls('T2')} {...act('T2')}>
        {conductors('T2', 'ehv')}
        <Tank x={575} y={256} w={42} h={54} />
        <path d="M585 256v-20M597 256v-20M609 256v-20" className="ps-bushing" />
        <path d="M612 250L630 246" className="ps-wire ps-wire--thin ps-lv--hv" />
        {tag(596, 228, 'T2')}
      </g>
      <g className={cls('mvA')} {...act('mvA')}>
        <Gantry x0={632} x1={658} y={246} />
        <path d="M628 246H662" className="ps-wire ps-lv--hv" />
      </g>
      {/* factory at 33 kV */}
      <g className={cls('factory')} {...act('factory')}>
        <path d="M660 250L692 266" className="ps-wire ps-wire--thin ps-lv--hv" />
        <rect x={688} y={266} width={92} height={44} className="ps-building" />
        <path d="M688 266l15 -14v14l15 -14v14l15 -14v14l15 -14v14l15 -14v14l17 -14v14" className="ps-roof" />
        {tag(734, 300, 'Factory')}
      </g>
      {breaker('CB3', 676, 258)}
      {/* 33 kV line on poles */}
      <g className={cls('L2')} {...act('L2')}>
        {[800, 870].map((x) => (
          <Pole key={x} x={x} />
        ))}
        {conductors('L2', 'hv', 7)}
        {tag(835, 212, 'L2 · 10 km')}
      </g>
      {breaker('CB2', 690, 238)}
      {/* distribution substation */}
      <g className={cls('mvB')} {...act('mvB')}>
        <path d="M918 238H944" className="ps-wire ps-lv--hv" />
        <path d="M922 310V238M940 310V238" className="ps-struct" />
      </g>
      <g className={cls('T3')} {...act('T3')}>
        <path d="M932 238V272" className="ps-wire ps-wire--thin ps-lv--hv" />
        <rect x={912} y={262} width={56} height={48} className="ps-fence" />
        <Tank x={922} y={272} w={30} h={38} />
        {conductors('T3', 'mv')}
        {tag(940, 256, 'T3')}
      </g>
      {/* town feeders and the town */}
      <g className={cls('lv')} {...act('lv')}>
        <path d="M985 252H1000" className="ps-wire ps-lv--mv" />
        <path d="M992 310V244" className="ps-struct" />
      </g>
      <g className={cls('town')} {...act('town')}>
        <path d="M1000 252H1094" className="ps-wire ps-wire--thin ps-lv--mv" />
        <path d="M1040 310V246M1084 310V246" className="ps-struct" />
        <House x={1003} w={28} h={30} />
        <House x={1046} w={24} h={40} roof={10} />
        <House x={1074} w={20} h={26} />
        {tag(1050, 232, 'Town')}
      </g>
      {breaker('CB4', 1006, 252)}
    </svg>
  )
}
