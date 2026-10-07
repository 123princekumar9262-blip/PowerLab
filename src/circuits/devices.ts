import { isThreePhase, type DiodeId, type ResolvedParams } from '../types/simulation.ts'

/** Upper (to the + rail) devices of the three-phase rectifiers. */
const UPPER_3PH = new Set(['D1', 'D3', 'D5', 'Da', 'Db', 'Dc'])

/**
 * Is this device an SCR in the circuit as built? (The netlist gives exactly these devices a
 * gate.) Single-phase: every device when the controlled version is chosen; in the semi-controlled
 * bridge only the upper pair. Three-phase: the upper devices of a controlled or half-controlled
 * rectifier, and the lower ones of the fully controlled bridge.
 */
export function isScrDevice(p: ResolvedParams, id: DiodeId): boolean {
  if (id === 'Dfw') return false
  if (isThreePhase(p.topology)) {
    if (UPPER_3PH.has(id)) return p.control.device === 'scr' || p.topology === '3ph-half-controlled'
    return p.control.device === 'scr' && p.topology === '3ph-bridge'
  }
  if (p.topology === 'semi-bridge') return id === 'D1' || id === 'D2'
  return p.control.device === 'scr'
}

/** Display name: SCRs are T1, T2…; diodes keep D1, D2…; the freewheeling diode is Dfw. */
export function deviceName(p: ResolvedParams, id: DiodeId): string {
  return isScrDevice(p, id) ? id.replace('D', 'T') : id
}
