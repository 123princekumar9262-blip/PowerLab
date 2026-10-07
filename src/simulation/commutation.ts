import { isThreePhase, type CircuitEvent, type DiodeId, type ResolvedParams, type SimulationTrace } from '../types/simulation.ts'

/** Upper (+ rail) group of the three-phase rectifiers; the 3-pulse rectifier has only this group. */
const UPPER = new Set<DiodeId>(['D1', 'D3', 'D5', 'Da', 'Db', 'Dc'])
const LOWER = new Set<DiodeId>(['D2', 'D4', 'D6'])

/**
 * One commutation: the load current transferring from an outgoing device to an incoming one
 * in the same group. With source inductance Ls the transfer takes time — both conduct during
 * the overlap; μ is measured from the simulation's own switching events:
 *
 *   start = the incoming device's turn-ON event,  end = the outgoing device's turn-OFF event,
 *   μ = ω·(t_end − t_start)  [degrees]
 */
export interface Commutation {
  group: 'upper' | 'lower'
  outgoing: DiodeId
  incoming: DiodeId
  tStart: number
  tEnd: number
  /** Source angle (phase a) at start / end [°]. */
  thetaStartDeg: number
  thetaEndDeg: number
  /** Measured overlap angle μ [°] (0 when the transfer is instantaneous). */
  muDeg: number
  /** The preceding natural commutation point (two phase voltages equal), if found. */
  tNatural: number | null
  /** Device currents at the start and end of the overlap [A]. */
  iOut: [number, number]
  iIn: [number, number]
  /** Mean rectifier output current during the overlap, and its relative variation. */
  idMean: number
  idVariation: number
}

const wrap = (deg: number) => ((deg % 360) + 360) % 360

/** Every commutation in a three-phase run, from the switching events (empty for single-phase). */
export function detectCommutations(p: ResolvedParams, ids: readonly DiodeId[], trace: SimulationTrace, events: readonly CircuitEvent[]): Commutation[] {
  if (!isThreePhase(p.topology)) return []
  const T = p.period
  const tol = T * 1e-6
  const dt = p.dt
  const n = trace.length
  const k = (id: DiodeId) => ids.indexOf(id)
  const idx = (t: number) => Math.min(n - 1, Math.max(0, Math.round(t / dt)))
  const after = (t: number) => Math.min(n - 1, Math.ceil(t / dt - 1e-9) + 1)
  const before = (t: number) => Math.max(0, Math.floor(t / dt + 1e-9) - 1)
  const angle = (t: number) => wrap(((p.omega * t + p.phase) * 180) / Math.PI)
  const irect = (i: number) => {
    // Rectifier output current = Σ upper-device currents.
    let s = 0
    for (const id of ids) if (UPPER.has(id)) s += trace.diodes[k(id)].current[i]
    return s
  }
  const crossings = events.filter((e) => e.kind === 'phase-crossing').map((e) => e.time)
  const ons = events.filter((e) => e.kind === 'diode-on' && e.device && (UPPER.has(e.device) || LOWER.has(e.device)))
  const out: Commutation[] = []
  for (const on of ons) {
    const inc = on.device!
    const group = UPPER.has(inc) ? 'upper' : 'lower'
    const same = ids.filter((id) => id !== inc && (group === 'upper' ? UPPER.has(id) : LOWER.has(id)))
    // Outgoing device: still conducting right after the incoming one turned on (overlap), or one
    // that turned off at the very same instant (instantaneous commutation, μ = 0).
    const j = after(on.time)
    let outgoing = same.find((id) => trace.diodes[k(id)].on[j] === 1)
    let tEnd: number | null = null
    if (outgoing) {
      const offEv = events.find((e) => e.kind === 'diode-off' && e.device === outgoing && e.time >= on.time - tol)
      tEnd = offEv ? offEv.time : null
    } else {
      const simultaneous = events.find((e) => e.kind === 'diode-off' && e.device && same.includes(e.device) && Math.abs(e.time - on.time) <= tol)
      if (simultaneous) {
        outgoing = simultaneous.device!
        tEnd = on.time
      }
    }
    if (!outgoing || tEnd === null) continue // not a commutation (e.g. conduction re-starting from zero)
    const i0 = idx(on.time)
    const i1 = idx(tEnd)
    let sum = 0
    let lo = Infinity
    let hi = -Infinity
    for (let i = i0; i <= Math.max(i0, i1); i++) {
      const v = irect(i)
      sum += v
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    const idMean = sum / (Math.max(i0, i1) - i0 + 1)
    const tNatural = crossings.filter((t) => t <= on.time + tol).pop() ?? null
    out.push({
      group,
      outgoing,
      incoming: inc,
      tStart: on.time,
      tEnd,
      thetaStartDeg: angle(on.time),
      thetaEndDeg: angle(tEnd),
      muDeg: ((tEnd - on.time) / T) * 360,
      tNatural,
      // Just before the transfer starts and just after it ends (the samples on either side).
      iOut: [trace.diodes[k(outgoing)].current[before(on.time)], trace.diodes[k(outgoing)].current[after(tEnd)]],
      iIn: [trace.diodes[k(inc)].current[before(on.time)], trace.diodes[k(inc)].current[after(tEnd)]],
      idMean,
      idVariation: idMean > 0 ? (hi - lo) / idMean : Infinity,
    })
  }
  return out
}
