import type { Run120 } from '../../converters/inverter/analysis120.ts'
import type { State120 } from '../../converters/inverter/content120.ts'
import { legDevices } from '../../converters/inverter/model.ts'
import './conduction120.css'

const X0 = 96
const W = 570
const ORDER = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']
const ROLE: Record<string, string> = { S1: 'A up', S2: 'C down', S3: 'B up', S4: 'A down', S5: 'C up', S6: 'B down' }

/** Runs of a per-sample state over one displayed cycle, as [from°, to°, state]. */
function runsOf<T>(n: number, at: (j: number) => T): Array<[number, number, T]> {
  const out: Array<[number, number, T]> = []
  for (let j = 1; j <= n; j++) {
    const s = at(j)
    const last = out[out.length - 1]
    const a = ((j - 1) / n) * 360
    const b = (j / n) * 360
    if (last && last[2] === s) last[1] = b
    else out.push([a, b, s])
  }
  return out
}

/**
 * The firing sequence and what the circuit did with it, over one cycle: the six gate commands (from the
 * simulated gate traces) and, per leg, which device tied it to a rail — IGBT, freewheeling diode — or none
 * (the leg floats). The cursor marks the present angle.
 */
export function ConductionChart({ r, st }: { r: Run120; st: State120 }) {
  const p = r.params
  const n = p.stepsPerPeriod
  const k0 = r.steadyFrom
  const dev = (id: string) => r.devices.find((d) => d.id === id)
  const x = (deg: number) => X0 + (deg / 360) * W
  const yGate = (i: number) => 40 + i * 16
  const yLeg = (j: number) => 158 + j * 16
  const names = legDevices(p)
  const legState = (leg: number) => (j: number) => {
    const k = Math.min(r.length - 1, k0 + j)
    const [su, du, sl, dl] = names[leg]
    if (dev(su)?.on[k] || dev(sl)?.on[k]) return 'igbt'
    if (dev(du)?.on[k] || dev(dl)?.on[k]) return 'diode'
    return 'open'
  }
  const cursor = st.theta
  return (
    <svg className="c120-chart" viewBox="0 0 690 230" role="img" aria-label={`Firing sequence, ${p.conduction}° per switch; gated now: ${st.gated.join(', ')}`}>
      <text x={8} y={14} className="c120-head">
        Gate commands — {p.conduction}° each, one every 60°
      </text>
      {[0, 60, 120, 180, 240, 300, 360].map((d) => (
        <g key={d}>
          <path d={`M${x(d)} 34 V${yGate(5) + 12} M${x(d)} ${yLeg(0) - 2} V${yLeg(2) + 12}`} className="c120-grid" />
          <text x={x(d)} y={31} textAnchor="middle" className="c120-muted">
            {d}°
          </text>
        </g>
      ))}
      {ORDER.map((id, i) => {
        const g = dev(id)?.gate
        const runs = runsOf(n, (j) => (g ? g[Math.min(r.length - 1, k0 + j)] : 0))
        const now = st.gated.includes(id)
        return (
          <g key={id}>
            <text x={X0 - 6} y={yGate(i) + 9} textAnchor="end" className="c120-text">
              {id} · {ROLE[id]}
            </text>
            <rect x={X0} y={yGate(i)} width={W} height={10} rx={2} className="c120-track" />
            {runs
              .filter(([, , s]) => s === 1)
              .map(([a, b], q) => (
                <rect key={q} x={x(a)} y={yGate(i)} width={x(b) - x(a)} height={10} rx={2} className={`c120-gate ${now ? 'c120-gate--now' : ''}`} />
              ))}
          </g>
        )
      })}
      <text x={8} y={yLeg(0) - 6} className="c120-head">
        What each leg did (simulation)
      </text>
      {[0, 1, 2].map((leg) => {
        const runs = runsOf(n, legState(leg))
        return (
          <g key={leg}>
            <text x={X0 - 6} y={yLeg(leg) + 9} textAnchor="end" className="c120-text">
              Leg {'ABC'[leg]}
            </text>
            {runs.map(([a, b, s], q) => (
              <rect key={q} x={x(a)} y={yLeg(leg) + (s === 'open' ? 1 : 0)} width={Math.max(0.5, x(b) - x(a))} height={s === 'open' ? 8 : 10} rx={2} className={s === 'igbt' ? 'c120-igbt' : s === 'diode' ? 'c120-diode' : 'c120-open'} />
            ))}
          </g>
        )
      })}
      <path d={`M${x(cursor)} 34 V${yGate(5) + 12} M${x(cursor)} ${yLeg(0) - 2} V${yLeg(2) + 12}`} className="c120-cursor" />
      <g transform={`translate(${X0}, 222)`}>
        <rect y={-9} width={12} height={10} rx={2} className="c120-key-igbt" />
        <text x={18} className="c120-text">
          IGBT
        </text>
        <rect x={70} y={-9} width={12} height={10} rx={2} className="c120-key-diode" />
        <text x={88} className="c120-text">
          freewheeling diode
        </text>
        <rect x={250} y={-8} width={12} height={8} rx={2} className="c120-open" />
        <text x={268} className="c120-text">
          no device: the leg floats
        </text>
      </g>
    </svg>
  )
}
