import type { InvState, LegState } from '../../converters/inverter/content.ts'
import type { ResolvedInverter } from '../../converters/inverter/modulation.ts'
import { SV_STATES } from '../../converters/inverter/modulation.ts'
import { legDevices } from '../../converters/inverter/model.ts'
import { formatA, formatSI, formatTime, formatV } from '../../utils/format.ts'

interface Props {
  st: InvState
  p: ResolvedInverter
  selected: string | null
  onSelect: (part: string) => void
  values: boolean
  /** Live numbers (Standard and Engineer); Beginner keeps names, set values and words. */
  live?: boolean
  showPath: boolean
}

const TOP = 48
const BOT = 222
const MID = (TOP + BOT) / 2

/**
 * Inverter schematic: DC source, legs (IGBT + antiparallel diode per position), load. The device
 * carrying each leg's current is highlighted (IGBT blue, diode green), gated switches show a dot, and
 * the load current arrow follows the simulated sign. Click any device or the load to inspect it.
 */
export function InverterDiagram(props: Props) {
  const { st, p } = props
  return (
    <>
      <svg className="buck-diagram inv-diagram" viewBox="0 0 690 270" role="group" aria-label={`${p.topology} inverter. ${st.legs.map((l) => `leg ${l.name}: ${l.conducting ?? 'none'}`).join('; ')}`}>
        {p.topology === 'three' ? <Three {...props} /> : <Single {...props} />}
      </svg>
      {p.modulation === 'svpwm' && <SpaceVectors st={st} p={p} live={props.live ?? true} />}
    </>
  )
}

function partProps(id: string, label: string, selected: string | null, onSelect: (x: string) => void) {
  return {
    'data-part': id,
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    'aria-pressed': selected === id,
    className: `cpart ${selected === id ? 'cpart--sel' : ''}`,
    onClick: () => onSelect(id),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(id)
      }
    },
  }
}

/** One switch position: IGBT (box) with its antiparallel diode to the right. */
function Position({ x, y0, y1, igbt, diode, leg, upper, selected, onSelect }: { x: number; y0: number; y1: number; igbt: string; diode: string; leg: LegState; upper: boolean; selected: string | null; onSelect: (x: string) => void }) {
  const cy = (y0 + y1) / 2
  const sOn = leg.conducting === igbt
  const dOn = leg.conducting === diode
  const gated = upper ? leg.gUp : leg.gLo
  return (
    <g>
      <line x1={x} x2={x} y1={y0} y2={cy - 16} className={`wire ${sOn ? 'wire--igbt' : ''}`} />
      <line x1={x} x2={x} y1={cy + 16} y2={y1} className={`wire ${sOn ? 'wire--igbt' : ''}`} />
      <g {...partProps(igbt, `${igbt} ${sOn ? 'conducting' : gated ? 'gated' : 'OFF'}`, selected, onSelect)}>
        <rect x={x - 14} y={cy - 16} width={28} height={32} rx={5} className={`pswitch ${sOn ? 'pswitch--on' : ''}`} />
        <text x={x} y={cy + 4} textAnchor="middle" className="dchip-text">
          {igbt}
        </text>
        {gated && <circle cx={x - 22} cy={cy} r={4} className="gate-dot" />}
      </g>
      {/* antiparallel diode: conducts upward (from the leg node toward the + rail) */}
      <g {...partProps(diode, `${diode} ${dOn ? 'conducting' : 'OFF'}`, selected, onSelect)}>
        <path d={`M${x} ${y0 + 6} H${x + 34} V${y1 - 6} H${x}`} className={`wire wire--thin ${dOn ? 'wire--diode' : ''}`} />
        <path d={`M${x + 24} ${cy + 8} H${x + 44} L${x + 34} ${cy - 8} Z`} className={`sym-fill ${dOn ? 'sym-fill--on-d' : ''}`} />
        <line x1={x + 24} x2={x + 44} y1={cy - 8} y2={cy - 8} className="sym" />
        <text x={x + 48} y={cy + 4} className="cvalue">
          {diode}
        </text>
      </g>
    </g>
  )
}

function Leg({ x, st, idx, p, selected, onSelect }: { x: number; st: InvState; idx: number; p: ResolvedInverter; selected: string | null; onSelect: (s: string) => void }) {
  const [su, du, sl, dl] = legDevices(p)[idx]
  const leg = st.legs[idx]
  return (
    <g>
      <Position x={x} y0={TOP} y1={MID} igbt={su} diode={du} leg={leg} upper selected={selected} onSelect={onSelect} />
      <Position x={x} y0={MID} y1={BOT} igbt={sl} diode={dl} leg={leg} upper={false} selected={selected} onSelect={onSelect} />
      <circle cx={x} cy={MID} r={4} className="node-dot" />
      <text x={x - 8} y={MID - 6} textAnchor="end" className="clabel">
        {leg.name}
      </text>
    </g>
  )
}

function DcSource({ x, p, split }: { x: number; p: ResolvedInverter; split: boolean }) {
  const bat = (y: number, label: string) => (
    <g>
      <rect x={x - 18} y={y - 9} width={36} height={18} className="gap-mask" />
      <line x1={x - 16} x2={x + 16} y1={y - 6} y2={y - 6} className="sym" />
      <line x1={x - 9} x2={x + 9} y1={y + 6} y2={y + 6} className="sym sym--thick" />
      <text x={x + 22} y={y + 4} className="cvalue" textAnchor="start">
        {label}
      </text>
    </g>
  )
  return (
    <g>
      <line x1={x} x2={x} y1={TOP} y2={BOT} className="wire" />
      {split ? (
        <>
          {bat((TOP + MID) / 2, formatV(p.vdc / 2, false))}
          {bat((MID + BOT) / 2, formatV(p.vdc / 2, false))}
          <circle cx={x} cy={MID} r={4} className="node-dot" />
          <text x={x + 8} y={MID + 16} className="cvalue">
            0 (midpoint)
          </text>
        </>
      ) : (
        bat(MID, `Vdc ${formatV(p.vdc, false)}`)
      )}
    </g>
  )
}

/** R–L load drawn horizontally between x0 and x1 at y. */
function Load({ x0, x1, y, p, label, current, values, selected, onSelect, id, compact }: { x0: number; x1: number; y: number; p: ResolvedInverter; label: string; current: number; values: boolean; selected: string | null; onSelect: (s: string) => void; id: string; compact?: boolean }) {
  const w = x1 - x0
  const rx = x0 + w * 0.15
  const lx = x0 + w * 0.5
  return (
    <g {...partProps(id, `${label} load, current ${formatA(current, true)}`, selected, onSelect)}>
      <rect x={x0} y={y - 22} width={w} height={44} className="cpart-hit" />
      <line x1={x0} x2={rx} y1={y} y2={y} className="wire wire--load" />
      <rect x={rx} y={y - 8} width={w * 0.25} height={16} rx={2} className="sym-body" />
      <line x1={rx + w * 0.25} x2={lx} y1={y} y2={y} className="wire wire--load" />
      {p.load === 'RL' ? (
        <path d={`M${lx} ${y} ${Array.from({ length: 3 }, () => `a${(w * 0.3) / 6} ${(w * 0.3) / 6} 0 0 1 ${(w * 0.3) / 3} 0`).join(' ')}`} className="sym sym--coil" />
      ) : (
        <line x1={lx} x2={lx + w * 0.3} y1={y} y2={y} className="wire wire--load" />
      )}
      <line x1={lx + w * 0.3} x2={x1} y1={y} y2={y} className="wire wire--load" />
      {compact ? (
        <text x={x0 + 4} y={y - 8} textAnchor="start" className="cvalue cvalue--il">
          {label} {current >= 0 ? '→' : '←'} {values ? formatA(current, true) : ''}
        </text>
      ) : (
        <>
          <text x={(x0 + x1) / 2} y={y - 14} textAnchor="middle" className="cvalue">
            {label}: {formatSI(p.r, 'Ω')}
            {p.load === 'RL' ? ` + ${formatSI(p.l, 'H')}` : ''}
          </text>
          <text x={(x0 + x1) / 2} y={y + 24} textAnchor="middle" className="cvalue cvalue--il">
            {current >= 0 ? '→' : '←'} {values ? formatA(current, true) : ''}
          </text>
        </>
      )}
    </g>
  )
}

function Single({ st, p, selected, onSelect, values, live = true }: Props) {
  const full = p.topology === 'full'
  const XA = 230
  const XB = 490
  return (
    <>
      <line x1={70} x2={full ? XB : XA} y1={TOP} y2={TOP} className="wire" />
      <line x1={70} x2={full ? XB : XA} y1={BOT} y2={BOT} className="wire" />
      <DcSource x={70} p={p} split={!full} />
      <Leg x={XA} st={st} idx={0} p={p} selected={selected} onSelect={onSelect} />
      {full ? (
        <>
          <Leg x={XB} st={st} idx={1} p={p} selected={selected} onSelect={onSelect} />
          <Load x0={XA + 60} x1={XB - 4} y={MID} p={p} label="load" current={st.io} values={values} selected={selected} onSelect={onSelect} id="load" />
          <line x1={XA} x2={XA + 60} y1={MID} y2={MID} className="wire wire--load" />
        </>
      ) : (
        <>
          <Load x0={XA + 60} x1={600} y={MID} p={p} label="load" current={st.io} values={values} selected={selected} onSelect={onSelect} id="load" />
          <line x1={XA} x2={XA + 60} y1={MID} y2={MID} className="wire wire--load" />
          <path d={`M600 ${MID} V${MID + 50} H70`} className="wire" strokeDasharray="4 4" />
          <text x={340} y={MID + 64} textAnchor="middle" className="cvalue">
            return to the DC midpoint
          </text>
        </>
      )}
      {live && (
        <text x={600} y={TOP + 4} textAnchor="end" className="cvalue cvalue--out">
          vo {formatV(st.vo)}
        </text>
      )}
      <text x={345} y={258} className="path-caption" textAnchor="middle">
        {live && `θ = ${st.theta.toFixed(1)}° · `}
        {st.legs.map((l) => `${l.name}: ${l.conducting ?? '—'}`).join(' · ')}
        {live && ` · P from DC ${st.pdc >= 0 ? '+' : ''}${formatSI(st.pdc, 'W')}`}
      </text>
    </>
  )
}

function Three({ st, p, selected, onSelect, values, live = true }: Props) {
  const xs = [200, 300, 400]
  const ys = [86, 135, 184]
  const xn = 640
  const cur = [st.ia, st.ib, st.ic]
  return (
    <>
      <line x1={60} x2={400} y1={TOP} y2={TOP} className="wire" />
      <line x1={60} x2={400} y1={BOT} y2={BOT} className="wire" />
      <DcSource x={60} p={p} split={false} />
      {xs.map((x, i) => (
        <Leg key={i} x={x} st={st} idx={i} p={p} selected={selected} onSelect={onSelect} />
      ))}
      {xs.map((x, i) => (
        <g key={`w${i}`}>
          <path d={`M${x} ${MID} H${x + 48} V${ys[i]} H${470}`} className="wire wire--load" />
          <Load compact x0={470} x1={xn - 10} y={ys[i]} p={p} label={'abc'[i]} current={cur[i]} values={values} selected={selected} onSelect={onSelect} id={`load-${'abc'[i]}`} />
        </g>
      ))}
      <line x1={xn - 10} x2={xn - 10} y1={ys[0]} y2={ys[2]} className="wire wire--load" />
      <circle cx={xn - 10} cy={ys[1]} r={4} className="node-dot" />
      <text x={xn - 4} y={ys[1] + 4} className="clabel">
        n
      </text>
      <text x={(470 + xn) / 2} y={ys[0] - 26} textAnchor="middle" className="cvalue">
        each phase: {formatSI(p.r, 'Ω')}
        {p.load === 'RL' ? ` + ${formatSI(p.l, 'H')}` : ''}
      </text>
      {values && (
        <text x={xn - 10} y={ys[2] + 30} textAnchor="end" className="cvalue">
          vnN {formatV(st.vnN)}
        </text>
      )}
      <text x={345} y={258} className="path-caption" textAnchor="middle">
        {live && `θ = ${st.theta.toFixed(1)}° · `}
        {st.legs.map((l) => `${l.name}: ${l.conducting ?? '—'}`).join(' · ')}
        {live && ` · vab ${formatV(st.vo)}`}
      </text>
    </>
  )
}

/** Space-vector hexagon: the six active vectors, the present sector, the reference and the dwell times. */
function SpaceVectors({ st, p, live }: { st: InvState; p: ResolvedInverter; live: boolean }) {
  const R = 100
  const cx = 160
  const cy = 125
  const sv = st.sv
  const vert = (k: number) => [cx + R * Math.cos((k * Math.PI) / 3), cy - R * Math.sin((k * Math.PI) / 3)]
  const refAngle = sv ? (sv.sector * Math.PI) / 3 + sv.thetaK : 0
  // |Vref| / (2Vdc/3) = (m·Vdc/2)/(2Vdc/3) = 3m/4
  const rr = Math.min(1, (3 * p.m) / 4) * R
  const inscribed = (Math.sqrt(3) / 2) * R
  const Ts = p.tc
  return (
    <svg className="sv-diagram" viewBox="0 0 690 250" role="img" aria-label={`Space-vector hexagon, sector ${(sv?.sector ?? 0) + 1}`}>
      <polygon points={[0, 1, 2, 3, 4, 5].map((k) => vert(k).join(',')).join(' ')} className="sv-hex" />
      {sv && <polygon points={[[cx, cy], vert(sv.sector), vert(sv.sector + 1)].map((q) => q.join(',')).join(' ')} className="sv-sector" />}
      <circle cx={cx} cy={cy} r={inscribed} className="sv-limit" />
      <circle cx={cx} cy={cy} r={rr} className="sv-path" />
      {[0, 1, 2, 3, 4, 5].map((k) => {
        const [x, y] = vert(k)
        const s = SV_STATES[k]
        return (
          <g key={k}>
            <line x1={cx} y1={cy} x2={x} y2={y} className="sv-spoke" />
            <text x={cx + (R + 18) * Math.cos((k * Math.PI) / 3)} y={cy - (R + 18) * Math.sin((k * Math.PI) / 3) + 4} textAnchor="middle" className="cvalue">
              V{k + 1} ({s.join('')})
            </text>
          </g>
        )
      })}
      <line x1={cx} y1={cy} x2={cx + rr * Math.cos(refAngle)} y2={cy - rr * Math.sin(refAngle)} className="sv-ref" />
      <circle cx={cx + rr * Math.cos(refAngle)} cy={cy - rr * Math.sin(refAngle)} r={4} className="sv-ref-dot" />
      <text x={cx} y={cy + 4} textAnchor="middle" className="cvalue">
        V0, V7
      </text>
      {sv && (
        <g transform="translate(330, 40)">
          <text className="clabel">
            Sector {sv.sector + 1}
            {live && ` · θ in sector ${((sv.thetaK * 180) / Math.PI).toFixed(1)}°`}
          </text>
          {(
            [
              [`T1 · V${sv.sector + 1} (${SV_STATES[sv.sector].join('')})`, sv.t1, '#3987e5'],
              [`T2 · V${((sv.sector + 1) % 6) + 1} (${SV_STATES[(sv.sector + 1) % 6].join('')})`, sv.t2, '#199e70'],
              ['T0 · V0 (000) + V7 (111)', sv.t0, '#aeb7c5'],
            ] as const
          ).map(([label, t, col], k) => (
            <g key={k} transform={`translate(0, ${30 + k * 34})`}>
              <text className="cvalue">{label}</text>
              <rect y={6} width={270} height={10} rx={3} className="sv-track" />
              <rect y={6} width={(270 * t) / Ts} height={10} rx={3} fill={col} />
              {live && (
                <text x={276} y={15} className="cvalue">
                  {formatTime(t)}
                </text>
              )}
            </g>
          ))}
          {live && (
            <text y={146} className="cvalue">
              Ts = {formatTime(Ts)} · |Vref| = m·Vdc/2 = {formatV((p.m * p.vdc) / 2, false)}
            </text>
          )}
          <text y={164} className="cvalue">
            dashed circle: linear limit m = 2/√3
          </text>
        </g>
      )}
    </svg>
  )
}
