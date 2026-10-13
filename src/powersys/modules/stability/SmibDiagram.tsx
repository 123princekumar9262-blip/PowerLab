import { fx } from '../../ui/format.ts'
import type { FaultAt } from './swing.ts'

/*
 * The system studied: a generator (E′ behind X′d, with its step-up transformer) feeding an HV bus, two parallel lines
 * to an infinite bus. Line 2 can be faulted at its HV-bus end or at its midpoint; its breakers open to clear the fault.
 */
export type NetState = 'pre' | 'fault' | 'post'

export function SmibDiagram({ Xg, Xl, E, V, fault, state, showFault = true }: { Xg: number; Xl: number; E: number; V: number; fault: FaultAt; state: NetState; showFault?: boolean }) {
  const open = state === 'post'
  const faulted = state === 'fault'
  const y1 = 40
  const y2 = 92
  const bus = 150
  const inf = 318
  const fx2 = fault === 'bus' ? 182 : 236
  const desc = `Generator with E′ = ${fx(E, 2)} pu behind X′d + X_T = ${fx(Xg, 2)} pu, two parallel lines of ${fx(Xl, 2)} pu each to an infinite bus at ${fx(V, 2)} pu. ${
    showFault ? `Line 2: ${state === 'pre' ? 'in service' : faulted ? `three-phase fault ${fault === 'bus' ? 'at its HV-bus end' : 'at its midpoint'}` : 'breakers open, fault cleared'}.` : ''
  }`
  return (
    <svg className="ps-st-sld" viewBox="0 0 380 132" role="img" aria-label={desc}>
      {/* generator */}
      <circle cx={30} cy={66} r={17} className="ps-st-sld-gen" />
      <path d="M21 66 q4.5 -8 9 0 t9 0" className="ps-st-sld-wave" />
      <text x={30} y={100} className="ps-st-sld-label" textAnchor="middle">
        E′ {fx(E, 2)}
      </text>
      <line x1={47} y1={66} x2={72} y2={66} className="ps-st-sld-wire" />
      <rect x={72} y={58} width={44} height={16} rx={2} className="ps-st-sld-x" />
      <text x={94} y={52} className="ps-st-sld-label" textAnchor="middle">
        X′d+X_T
      </text>
      <text x={94} y={88} className="ps-st-sld-val" textAnchor="middle">
        {fx(Xg, 2)}
      </text>
      <line x1={116} y1={66} x2={bus} y2={66} className="ps-st-sld-wire" />
      <line x1={bus} y1={28} x2={bus} y2={104} className="ps-st-sld-bus" />
      <text x={bus} y={120} className="ps-st-sld-label" textAnchor="middle">
        HV bus
      </text>
      {/* line 1 */}
      <line x1={bus} y1={y1} x2={inf} y2={y1} className="ps-st-sld-wire" />
      <rect x={214} y={y1 - 8} width={44} height={16} rx={2} className="ps-st-sld-x" />
      <text x={236} y={y1 - 13} className="ps-st-sld-label" textAnchor="middle">
        Line 1 · {fx(Xl, 2)}
      </text>
      {/* line 2: drawn as two halves so a midpoint fault has somewhere to be */}
      <line x1={bus} y1={y2} x2={164} y2={y2} className="ps-st-sld-wire" />
      <rect x={164} y={y2 - 6} width={12} height={12} className={`ps-st-sld-cb ${open ? 'is-open' : ''}`} />
      <line x1={176} y1={y2} x2={296} y2={y2} className={`ps-st-sld-wire ${open ? 'is-dead' : ''}`} />
      <rect x={196} y={y2 - 8} width={30} height={16} rx={2} className={`ps-st-sld-x ${open ? 'is-dead' : ''}`} />
      <rect x={246} y={y2 - 8} width={30} height={16} rx={2} className={`ps-st-sld-x ${open ? 'is-dead' : ''}`} />
      <rect x={296} y={y2 - 6} width={12} height={12} className={`ps-st-sld-cb ${open ? 'is-open' : ''}`} />
      <line x1={308} y1={y2} x2={inf} y2={y2} className="ps-st-sld-wire" />
      <text x={236} y={y2 - 13} className="ps-st-sld-label" textAnchor="middle">
        Line 2 · {fx(Xl, 2)}
      </text>
      {showFault && (
        <g className={`ps-st-sld-fault ${faulted ? 'is-on' : state === 'pre' ? 'is-armed' : 'is-cleared'}`}>
          <path d={`M${fx2} ${y2} l-5 10 h7 l-6 12`} />
          <text x={fx2 + 6} y={y2 + 26} className="ps-st-sld-val">
            {faulted ? 'fault' : state === 'pre' ? '' : 'cleared'}
          </text>
        </g>
      )}
      {/* infinite bus */}
      <line x1={inf} y1={28} x2={inf} y2={104} className="ps-st-sld-bus ps-st-sld-bus--inf" />
      <text x={inf + 8} y={60} className="ps-st-sld-label">
        ∞ bus
      </text>
      <text x={inf + 8} y={74} className="ps-st-sld-val">
        {fx(V, 2)}∠0°
      </text>
    </svg>
  )
}
