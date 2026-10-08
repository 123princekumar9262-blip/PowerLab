import type { Element, NetlistSolution } from '../../circuits/netlist.ts'
import type { DiodeId } from '../../types/simulation.ts'
import type { CircuitModel } from '../engine.ts'
import { complementaryPair, type Schedule } from '../schedule.ts'
import { legCommands, resolveInverter, type InverterParams, type ResolvedInverter } from './modulation.ts'

/**
 * Voltage-source inverters as netlists. Every switch is an IGBT — a GATED, NON-LATCHING device that
 * conducts forward only while gated — with its own antiparallel diode. Whether the IGBT or the diode
 * of a position carries the current is decided by the circuit, from the sign of the current: an
 * inductive load drives current back through the diodes after every commutation.
 *
 *   HALF BRIDGE   +Vdc/2 ─S1/D1─ A ─S2/D2─ −Vdc/2,   load from A to the DC midpoint (ground)
 *   FULL BRIDGE   leg A: S1 (upper), S2 (lower); leg B: S3, S4;   load from A to B;  ground = DC −
 *   THREE-PHASE   legs A, B, C: S1/S4, S3/S6, S5/S2 (textbook numbering, firing order 1…6);
 *                 balanced star load (R + L per phase), floating neutral n;  ground = DC −
 *
 * Leg nodes also have a 1 MΩ bleed resistor to the DC negative (voltage-sensing resistors in a real
 * inverter). It keeps a node defined when every device of its leg is OFF with zero current; its current
 * (< Vdc/1 MΩ) is below 10⁻⁴ of the load current here.
 */
export const BLEED = 1e6

/** Device names per leg: [upper IGBT, upper diode, lower IGBT, lower diode]. */
export function legDevices(p: Pick<ResolvedInverter, 'topology'>): Array<[string, string, string, string]> {
  if (p.topology === 'half') return [['S1', 'D1', 'S2', 'D2']]
  if (p.topology === 'full')
    return [
      ['S1', 'D1', 'S2', 'D2'],
      ['S3', 'D3', 'S4', 'D4'],
    ]
  return [
    ['S1', 'D1', 'S4', 'D4'],
    ['S3', 'D3', 'S6', 'D6'],
    ['S5', 'D5', 'S2', 'D2'],
  ]
}

export function inverterModel(defaults: InverterParams, kind: string): CircuitModel<InverterParams, ResolvedInverter> {
  return {
    kind,
    resolve: (input) => resolveInverter(input, defaults),
    startupPeriods: (p) => {
      const tau = p.load === 'RL' ? p.l / p.r : 0
      return Math.max(3, Math.min(40, Math.ceil((5 * tau) / p.period) + 1))
    },
    build(p) {
      const cmds = legCommands(p)
      const names = legDevices(p)
      const schedules: Schedule[] = []
      const gates: Array<[(t: number) => boolean, (t: number) => boolean]> = []
      cmds.forEach((edges, leg) => {
        const [up, lo] = complementaryPair(names[leg][0], names[leg][2], p.period, edges, p.td, false)
        schedules.push(up, lo)
        gates.push([up.at, lo.at])
      })
      const els: Element[] = []
      let n = 0
      const half = p.topology === 'half'
      const nP = ++n
      const nN = half ? ++n : 0 // half bridge: DC− is its own node; ground is the midpoint
      if (half) {
        els.push({ kind: 'V', id: 'Vdc+', a: nP, b: 0, value: () => p.vdc / 2 }, { kind: 'V', id: 'Vdc-', a: 0, b: nN, value: () => p.vdc / 2 })
      } else els.push({ kind: 'V', id: 'Vdc', a: nP, b: 0, value: () => p.vdc })
      const legNodes: number[] = []
      cmds.forEach((_e, leg) => {
        const x = ++n
        legNodes.push(x)
        const [su, du, sl, dl] = names[leg]
        const [gu, gl] = gates[leg]
        els.push(
          // (device ids are free names here; the rectifier lab's DiodeId union does not apply)
          { kind: 'D', id: su as DiodeId, a: nP, b: x, vf: p.dev.vce, gate: gu, latch: false },
          { kind: 'D', id: du as DiodeId, a: x, b: nP, vf: p.dev.vfD },
          { kind: 'D', id: sl as DiodeId, a: x, b: nN, vf: p.dev.vce, gate: gl, latch: false },
          { kind: 'D', id: dl as DiodeId, a: nN, b: x, vf: p.dev.vfD },
          { kind: 'R', id: `Rb${leg}`, a: x, b: nN, r: BLEED },
        )
      })
      // Load(s): R in series with L (RL) or R alone.
      const loadBranch = (id: string, from: number, to: number) => {
        if (p.load === 'RL') {
          const m = ++n
          els.push({ kind: 'R', id: `R${id}`, a: from, b: m, r: p.r }, { kind: 'L', id: `L${id}`, a: m, b: to, l: p.l })
        } else els.push({ kind: 'R', id: `R${id}`, a: from, b: to, r: p.r })
      }
      let neutral = 0
      if (p.topology === 'half') loadBranch('a', legNodes[0], 0)
      else if (p.topology === 'full') loadBranch('a', legNodes[0], legNodes[1])
      else {
        neutral = ++n
        ;['a', 'b', 'c'].forEach((ph, i) => loadBranch(ph, legNodes[i], neutral))
      }
      const idx = (id: string) => els.findIndex((e) => e.id === id)
      const iR = ['a', 'b', 'c'].map((ph) => idx(`R${ph}`))
      const srcIdx = half ? [idx('Vdc+'), idx('Vdc-')] : [idx('Vdc')]
      const devIds = names.slice(0, cmds.length).flat()
      const scaleI = p.vdc / p.r
      const nL = p.load === 'RL' ? (p.topology === 'three' ? 3 : 1) : 0
      return {
        net: { nodes: n, elements: els },
        diode: { kind: 'real', vf: 0, ron: p.dev.ron },
        schedules,
        devices: devIds,
        scale: new Array<number>(nL).fill(scaleI),
        read(sol: NetlistSolution) {
          const v = sol.v
          const out: Record<string, number> = {}
          // Leg voltages: from DC− (full bridge, three-phase) or from the DC midpoint (half bridge).
          legNodes.forEach((x, i) => (out[`v${'abc'[i]}N`] = v[x]))
          if (p.topology === 'half') {
            out.vo = v[legNodes[0]]
            out.io = sol.i[iR[0]]
          } else if (p.topology === 'full') {
            out.vo = v[legNodes[0]] - v[legNodes[1]]
            out.io = sol.i[iR[0]]
          } else {
            out.vab = v[legNodes[0]] - v[legNodes[1]]
            out.vbc = v[legNodes[1]] - v[legNodes[2]]
            out.vca = v[legNodes[2]] - v[legNodes[0]]
            out.vnN = v[neutral]
            ;['a', 'b', 'c'].forEach((ph, i) => {
              out[`van${ph === 'a' ? '' : ph}`] = v[legNodes[i]] - v[neutral]
              out[`i${ph}`] = sol.i[iR[i]]
            })
            out.vo = out.vab
            out.io = out.ia
          }
          // DC source current (into the inverter) and power.
          if (half) {
            const iUp = -sol.i[srcIdx[0]]
            const iLow = -sol.i[srcIdx[1]]
            out.idc = iUp
            out.pdc = (p.vdc / 2) * iUp + (p.vdc / 2) * iLow
          } else {
            out.idc = -sol.i[srcIdx[0]]
            out.pdc = p.vdc * out.idc
          }
          out.po = p.topology === 'three' ? (out.ia * out.ia + out.ib * out.ib + out.ic * out.ic) * p.r : out.io * out.io * p.r
          for (const d of sol.diodes) out[`i${d.id}`] = d.current
          return out
        },
      }
    },
  }
}
