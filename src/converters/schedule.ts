/**
 * Gate schedules: the COMMAND a modulator gives a controlled switch. A schedule is periodic: a sorted
 * list of edges inside one period [0, P). Gate commands are inputs (like the PWM signal on a real
 * gate driver); what the devices then do is decided by the circuit simulation.
 */
export interface Schedule {
  id: string
  /** Gate state at time t (the state after every edge at or before t). */
  at(t: number): boolean
  /** Edges with a < t ≤ b. */
  edgesIn(a: number, b: number): Array<{ t: number; rising: boolean }>
  /** The edges of one period (for modulator views and theory). */
  edges: ReadonlyArray<{ t: number; rising: boolean }>
  period: number
}

export function periodicSchedule(id: string, period: number, edgesIn: Array<{ t: number; rising: boolean }>, constant = false): Schedule {
  const edges = edgesIn
    .map((e) => ({ t: ((e.t % period) + period) % period, rising: e.rising }))
    .sort((x, y) => x.t - y.t)
  // Drop zero-width pulses (a rising and falling edge at the same instant cancel).
  const clean: Array<{ t: number; rising: boolean }> = []
  for (const e of edges) {
    const last = clean[clean.length - 1]
    if (last && Math.abs(last.t - e.t) <= period * 1e-12 && last.rising !== e.rising) clean.pop()
    else clean.push(e)
  }
  const ts = clean.map((e) => e.t)
  return {
    id,
    period,
    edges: clean,
    at(t) {
      if (!clean.length) return constant
      const u = t - period * Math.floor(t / period)
      // last edge with e.t ≤ u
      let lo = 0
      let hi = ts.length - 1
      let found = -1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (ts[mid] <= u) {
          found = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      return found >= 0 ? clean[found].rising : clean[clean.length - 1].rising
    },
    edgesIn(a, b) {
      const out: Array<{ t: number; rising: boolean }> = []
      if (!clean.length) return out
      const m0 = Math.floor(a / period) - 1
      const m1 = Math.ceil(b / period) + 1
      for (let m = m0; m <= m1; m++) for (const e of clean) {
        const t = m * period + e.t
        if (t > a && t <= b) out.push({ t, rising: e.rising })
      }
      return out
    },
  }
}

/** Constant gate (always on / always off). */
export const constantSchedule = (id: string, on: boolean, period: number): Schedule => periodicSchedule(id, period, [], on)

/**
 * Complementary pair with dead time from one leg command (true = upper ON): the upper gate rises
 * td after the command rises, the lower gate rises td after the command falls; both fall at once.
 */
export function complementaryPair(idUpper: string, idLower: string, period: number, command: Array<{ t: number; rising: boolean }>, td: number, initialUpper = false): [Schedule, Schedule] {
  const up: Array<{ t: number; rising: boolean }> = []
  const lo: Array<{ t: number; rising: boolean }> = []
  for (const e of command) {
    if (e.rising) {
      lo.push({ t: e.t, rising: false })
      up.push({ t: e.t + td, rising: true })
    } else {
      up.push({ t: e.t, rising: false })
      lo.push({ t: e.t + td, rising: true })
    }
  }
  return [periodicSchedule(idUpper, period, up, initialUpper), periodicSchedule(idLower, period, lo, !initialUpper)]
}
