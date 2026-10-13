import { DEVICE_MAP } from '../explanations/threePhase.ts'
import type { ResolvedParams, SimulationResult, SimulationSample } from '../types/simulation.ts'
import { formatA, formatV } from '../utils/format.ts'

/**
 * Three-phase rectifiers, Engineer: every device's reading at the cursor (current while it conducts, voltage
 * while it blocks, G while its gate pulse is on), in one row under the circuit. These numbers used to be
 * printed under each device in the schematic, where the 90-unit leg spacing kept them near 7 px on a laptop.
 */
export function DeviceReadings({ params: p, sample, result }: { params: ResolvedParams; sample: SimulationSample; result: SimulationResult }) {
  const upperScr = p.control.device === 'scr' || p.topology === '3ph-half-controlled'
  const lowerScr = p.control.device === 'scr' && p.topology === '3ph-bridge'
  const name = (id: string) => (id === 'Dfw' ? 'Dfw' : (DEVICE_MAP[id]?.upper ? upperScr : lowerScr) ? id.replace('D', 'T') : id)
  const gate = (id: string) => {
    const g = result.trace.diodes[result.diodeIds.indexOf(id as never)]?.gate
    return g ? g[sample.index] === 1 : null
  }
  return (
    <ul className="rx-devices" aria-label="Devices at the cursor">
      {sample.diodes.map((d) => {
        const g = gate(d.id)
        return (
          <li key={d.id} className={d.on ? 'is-on' : ''}>
            <b>{name(d.id)}</b> <span>{d.on ? formatA(d.current) : formatV(d.voltage)}</span>
            {g && <span className="rx-gate" title="gate pulse on">G</span>}
          </li>
        )
      })}
    </ul>
  )
}
