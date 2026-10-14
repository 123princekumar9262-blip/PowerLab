import { createContext, useContext, useId, type ReactNode } from 'react'
import { fx } from '../../ui/format.ts'
import type { AvrParams } from './avr.ts'
import type { LfcParams, LfcSnap } from './lfc.ts'

/*
 * The 2D diagrams of the module: the two-area load-frequency control block diagram (with the simulated values at the
 * time shown written on its signals) and the AVR loop. Both are GEOMETRY (the model's structure) with CALCULATED
 * labels; nothing on them is an illustration.
 */

function Block({
  x,
  y,
  w,
  h = 40,
  children,
  sub,
  dashed,
  tone,
  hl,
}: {
  x: number
  y: number
  w: number
  h?: number
  children: ReactNode
  sub?: string
  dashed?: boolean
  tone?: string
  hl?: boolean
}) {
  return (
    <g className={`ps-gc-block ${dashed ? 'is-off' : ''} ${hl ? 'is-hl' : ''}`}>
      <rect x={x} y={y - h / 2} width={w} height={h} rx={6} style={tone ? { stroke: tone } : undefined} />
      <text x={x + w / 2} y={sub ? y - 2 : y + 4} textAnchor="middle" className="ps-gc-block-t">
        {children}
      </text>
      {sub && (
        <text x={x + w / 2} y={y + 13} textAnchor="middle" className="ps-gc-block-s">
          {sub}
        </text>
      )}
    </g>
  )
}

function Sum({ x, y, signs }: { x: number; y: number; signs: Array<{ at: 'l' | 't' | 'b'; s: '+' | '−' }> }) {
  const pos = { l: [-15, -6], t: [6, -11], b: [6, 19] } as const
  return (
    <g className="ps-gc-sum">
      <circle cx={x} cy={y} r={9} />
      {signs.map((g, k) => (
        <text key={k} x={x + pos[g.at][0]} y={y + pos[g.at][1]} className="ps-gc-sign">
          {g.s}
        </text>
      ))}
    </g>
  )
}

const MarkerId = createContext('ps-gc-arrow')

function Wire({ d, arrow = true, tone, dashed }: { d: string; arrow?: boolean; tone?: string; dashed?: boolean }) {
  const mid = useContext(MarkerId)
  return <path d={d} className={`ps-gc-wire ${dashed ? 'is-off' : ''}`} markerEnd={arrow ? `url(#${mid})` : undefined} style={tone ? { stroke: tone } : undefined} />
}

function Val({ x, y, children, anchor = 'start', tone }: { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end'; tone?: string }) {
  return (
    <text x={x} y={y} textAnchor={anchor} className="ps-gc-val" style={tone ? { fill: tone } : undefined}>
      {children}
    </text>
  )
}

const A1 = 'var(--gc-a1)'
const A2 = 'var(--gc-a2)'
const TIE = 'var(--gc-tie)'
const AGC = 'var(--gc-agc)'

/**
 * The linearised two-area model as a block diagram. Area 1 on top, area 2 below, the tie line between them.
 * `at` — the simulated values at the time shown (null: structure only).
 */
export function TwoAreaDiagram({ p, at, highlight = [], label }: { p: LfcParams; at: LfcSnap | null; highlight?: string[]; label?: string }) {
  const W = 820
  const H = 340
  const mid = useId()
  const hl = (id: string) => highlight.includes(id)
  const row = (k: 1 | 2) => {
    const y = k === 1 ? 70 : 270
    const up = k === 1 ? -1 : 1 // the droop feedback runs on the outer side of each row
    const a = k === 1 ? p.a1 : p.a2
    const tone = k === 1 ? A1 : A2
    const agc = k === 1 ? p.agc1 : p.agc2
    const df = at ? (k === 1 ? at.df1 : at.df2) : null
    const pm = at ? (k === 1 ? at.pm1 : at.pm2) : null
    const ace = at ? (k === 1 ? at.ace1 : at.ace2) : null
    const dPL = k === 1 ? p.dPL1 : p.dPL2
    const yFb = y + up * 52
    return (
      <g key={k} aria-label={`Area ${k}`}>
        <text x={8} y={y + up * 44 + (k === 1 ? 4 : 4)} className="ps-gc-area" style={{ fill: tone }}>
          Area {k}
        </text>
        {/* AGC: −K_I/s acting on ACE */}
        <Block
          x={14}
          y={y}
          w={104}
          dashed={!agc}
          tone={agc ? AGC : undefined}
          sub={agc ? `ACE${k === 1 ? '₁' : '₂'} = ${k === 1 ? '' : '−'}ΔP_tie + B${k === 1 ? '₁' : '₂'}Δf${k === 1 ? '₁' : '₂'}` : 'AGC off'}
          hl={hl(`agc${k}`)}
        >
          −K_I / s
        </Block>
        {ace !== null && agc && (
          <Val x={66} y={y + up * 34} anchor="middle" tone={AGC}>
            ACE {fx(ace, 4)} pu
          </Val>
        )}
        <Wire d={`M118 ${y} H${150 - 10}`} dashed={!agc} />
        <Sum
          x={150}
          y={y}
          signs={[
            { at: 'l', s: '+' },
            { at: k === 1 ? 't' : 'b', s: '−' },
          ]}
        />
        <Wire d={`M159 ${y} H186`} />
        <Block x={186} y={y} w={96} sub={`T_g = ${fx(a.Tg, 2)} s`} hl={hl(`gov${k}`)}>
          1 / (1 + sT_g)
        </Block>
        <Wire d={`M282 ${y} H304`} />
        <Block x={304} y={y} w={96} sub={`T_t = ${fx(a.Tt, 2)} s`} hl={hl(`turb${k}`)}>
          1 / (1 + sT_t)
        </Block>
        <Wire d={`M400 ${y} H${440 - 10}`} />
        {pm !== null && (
          <Val x={404} y={y - 8} tone={tone}>
            ΔP_m {fx(pm, 3)}
          </Val>
        )}
        <Sum
          x={440}
          y={y}
          signs={[
            { at: 'l', s: '+' },
            { at: k === 1 ? 't' : 'b', s: '−' },
            { at: k === 1 ? 'b' : 't', s: k === 1 ? '−' : '+' },
          ]}
        />
        {/* the load step */}
        <Wire d={`M440 ${y + up * 34} V${y + up * 10}`} />
        <text x={448} y={y + up * 30 + 4} className="ps-gc-in">
          ΔP_L{k === 1 ? '₁' : '₂'} = {fx(dPL, 2)} pu
        </text>
        <Wire d={`M449 ${y} H478`} />
        <Block x={478} y={y} w={124} sub={`H = ${fx(a.H, 1)} s · D = ${fx(a.D, 2)}`} hl={hl(`mass${k}`)}>
          1 / (2Hs + D)
        </Block>
        <Wire d={`M602 ${y} H700`} />
        <circle cx={640} cy={y} r={3} className="ps-gc-node" />
        <text x={704} y={y + 4} className="ps-gc-out" style={{ fill: tone }}>
          Δf{k === 1 ? '₁' : '₂'}
        </text>
        {df !== null && (
          <Val x={704} y={y + 20} tone={tone}>
            {fx(df, 4)} Hz
          </Val>
        )}
        {/* droop feedback 1/R */}
        <Wire d={`M640 ${y} V${yFb} H${400}`} arrow={false} />
        <Block x={304} y={yFb} w={96} h={30} hl={hl(`droop${k}`)}>
          1 / R = {fx(1 / a.R, 1)}
        </Block>
        <Wire d={`M304 ${yFb} H150 V${y + up * 10}`} />
      </g>
    )
  }
  return (
    <MarkerId.Provider value={mid}>
      <svg viewBox={`0 0 ${W} ${H}`} className="ps-gc-diagram" role="img" aria-label={label ?? 'Block diagram of the two-area load-frequency control model'}>
        <defs>
          <marker id={mid} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="ps-gc-arrowhead" />
          </marker>
        </defs>
        {row(1)}
        {row(2)}
        {/* the tie line: Δf₁ − Δf₂ → 2πT₁₂/s → ΔP_tie12, out of area 1 (−) and into area 2 (+) */}
        <Wire d={`M660 70 V${170 - 10}`} tone={TIE} />
        <Wire d={`M660 270 V${170 + 10}`} tone={TIE} />
        <circle cx={660} cy={70} r={3} className="ps-gc-node" />
        <circle cx={660} cy={270} r={3} className="ps-gc-node" />
        <Sum
          x={660}
          y={170}
          signs={[
            { at: 't', s: '+' },
            { at: 'b', s: '−' },
          ]}
        />
        <Wire d={`M651 170 H${600}`} tone={TIE} />
        <Block x={500} y={170} w={100} tone={TIE} sub={`T₁₂ = ${fx(p.T12, 3)} pu/rad`} hl={hl('tie')}>
          2π·T₁₂ / s
        </Block>
        <Wire d={`M500 170 H440`} arrow={false} tone={TIE} />
        <circle cx={440} cy={170} r={3} className="ps-gc-node" style={{ fill: TIE }} />
        <Wire d={`M440 170 V${70 + 10}`} tone={TIE} />
        <Wire d={`M440 170 V${270 - 10}`} tone={TIE} />
        <text x={448} y={166} className="ps-gc-out" style={{ fill: TIE }}>
          ΔP_tie12
        </text>
        {at && (
          <Val x={448} y={184} tone={TIE}>
            {fx(at.tie, 4)} pu
          </Val>
        )}
        {p.T12 <= 0 && (
          <text x={550} y={204} textAnchor="middle" className="ps-gc-in">
            no tie line (T₁₂ = 0): two islands
          </text>
        )}
        {at && (
          <text x={W - 6} y={H - 6} textAnchor="end" className="ps-gc-in">
            values at t = {fx(at.t, 2)} s · powers in pu of {p.sBase} MW · Δf in Hz (model in pu of {p.f0} Hz)
          </text>
        )}
      </svg>
    </MarkerId.Provider>
  )
}

/** The AVR loop: amplifier, exciter, generator field and voltage sensor, each a gain and one lag. */
export function AvrDiagram({ p, highlight = [], stable }: { p: AvrParams; highlight?: string[]; stable?: boolean }) {
  const id = useId()
  const y = 60
  const hl = (k: string) => highlight.includes(k)
  return (
    <svg
      viewBox="0 0 790 150"
      className="ps-gc-diagram ps-gc-avr"
      role="img"
      aria-label={`AVR block diagram: amplifier K_A = ${p.KA}, exciter, generator field, sensor${stable === false ? ' — unstable' : ''}`}
    >
      <defs>
        <marker id={`${id}-a`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" className="ps-gc-arrowhead" />
        </marker>
      </defs>
      <text x={8} y={y + 4} className="ps-gc-in">
        ΔV_ref
      </text>
      <path d={`M54 ${y} H${96 - 10}`} className="ps-gc-wire" markerEnd={`url(#${id}-a)`} />
      <Sum
        x={96}
        y={y}
        signs={[
          { at: 'l', s: '+' },
          { at: 'b', s: '−' },
        ]}
      />
      <path d={`M105 ${y} H124`} className="ps-gc-wire" markerEnd={`url(#${id}-a)`} />
      <text x={112} y={y - 8} className="ps-gc-in">
        e
      </text>
      <Block x={124} y={y} w={156} hl={hl('amp')} sub="amplifier" tone={stable === false ? 'var(--critical)' : undefined}>
        {`${fx(p.KA, 1)} / (1 + ${fx(p.TA, 2)}s)`}
      </Block>
      <path d={`M280 ${y} H302`} className="ps-gc-wire" markerEnd={`url(#${id}-a)`} />
      <Block x={302} y={y} w={156} hl={hl('exc')} sub="exciter">
        {`${fx(p.KE, 2)} / (1 + ${fx(p.TE, 2)}s)`}
      </Block>
      <path d={`M458 ${y} H480`} className="ps-gc-wire" markerEnd={`url(#${id}-a)`} />
      <Block x={480} y={y} w={156} hl={hl('gen')} sub="generator field">
        {`${fx(p.KG, 2)} / (1 + ${fx(p.TG, 2)}s)`}
      </Block>
      <path d={`M636 ${y} H726`} className="ps-gc-wire" markerEnd={`url(#${id}-a)`} />
      <text x={732} y={y + 4} className="ps-gc-out">
        ΔV_t
      </text>
      <circle cx={676} cy={y} r={3} className="ps-gc-node" />
      <path d={`M676 ${y} V120 H${480 + 156}`} className="ps-gc-wire" markerEnd={`url(#${id}-a)`} />
      <Block x={480} y={120} w={156} h={34} hl={hl('sensor')} sub="sensor">
        {`${fx(p.KR, 2)} / (1 + ${fx(p.TR, 2)}s)`}
      </Block>
      <path d={`M480 120 H96 V${y + 10}`} className="ps-gc-wire" markerEnd={`url(#${id}-a)`} />
      <text x={104} y={114} className="ps-gc-in">
        ΔV_s
      </text>
    </svg>
  )
}
