import type { Element, NetlistSolution } from '../../circuits/netlist.ts'
import type { DiodeId } from '../../types/simulation.ts'
import type { CircuitModel } from '../engine.ts'
import { periodicSchedule, type Schedule } from '../schedule.ts'
import { BLEED, legDevices } from './model.ts'
import { resolveInverter, type InverterParams, type ResolvedInverter } from './modulation.ts'

/**
 * THREE-PHASE VSI WITH 120° CONDUCTION, on the generic switched-circuit engine. Each IGBT is gated for 120°
 * (or 180° — six-step — for comparison), in the firing order S1 … S6, one every 60°:
 *
 *   S1 (A up) 0°,  S2 (C down) 60°,  S3 (B up) 120°,  S4 (A down) 180°,  S5 (C up) 240°,  S6 (B down) 300°
 *
 * With 120°, exactly two switches are gated at any instant — one upper, one lower, in different legs — and the
 * third leg has no gate at all. Its voltage is NOT set by the modulator: while its phase current is non-zero a
 * freewheeling diode carries it and clamps the leg to a rail; once the current reaches zero the leg is open and
 * floats at the load neutral. With an R load the current stops at once (the textbook staircase); with an R-L
 * load the diode conducts for a while after every commutation — the circuit decides, not a formula.
 *
 * Every switch is an IGBT (gated, non-latching, forward only) with its antiparallel diode, as in the inverter
 * lab; the leg nodes have the same 1 MΩ bleed resistors. The load is a balanced star (R or R + L per phase)
 * with a floating neutral n.
 */
export interface Inv120Params extends InverterParams {
  /** Conduction angle of each switch [deg]. */
  conduction: 120 | 180
}

export interface Resolved120 extends ResolvedInverter {
  conduction: 120 | 180
}

export const INV120_DEFAULTS: Inv120Params = {
  topology: 'three',
  modulation: 'six-step',
  conduction: 120,
  vdc: 100,
  f1: 50,
  load: 'R',
  r: 10,
  l: 20e-3,
  alphaDeg: 30,
  m: 0.8,
  mf: 15,
  sampling: 'natural',
  devices: 'ideal',
  vce: 1.5,
  vfD: 1,
  ron: 0.02,
  td: 0,
  view: 'steady',
  periods: 2,
  stepsPerPeriod: 1200,
}

/** Gate start angle [deg] of each switch; switch k (1…6) starts at (k − 1)·60°. */
export const START_DEG: Record<string, number> = { S1: 0, S2: 60, S3: 120, S4: 180, S5: 240, S6: 300 }

export function resolve120(input: Partial<Inv120Params>): { params: Resolved120; issues: string[] } {
  const conduction = Number(input.conduction) === 180 ? 180 : 120
  // the 120°/180° commands come from this module; the shared resolver clamps the circuit values
  const { params, issues } = resolveInverter({ ...input, topology: 'three', modulation: 'six-step', td: 0 }, INV120_DEFAULTS)
  return { params: { ...params, conduction }, issues }
}

/** Is switch `id` gated at angle θ [deg]? */
export function gatedAt(p: Pick<Resolved120, 'conduction'>, id: string, thetaDeg: number): boolean {
  const u = (((thetaDeg - START_DEG[id]) % 360) + 360) % 360
  return u < p.conduction
}

/** One schedule per IGBT: ON for the conduction angle from its start angle (periodic). */
export function schedules120(p: Resolved120): Schedule[] {
  const T = p.period
  return Object.keys(START_DEG).map((id) => {
    const a = (START_DEG[id] / 360) * T
    const b = ((START_DEG[id] + p.conduction) / 360) * T
    return periodicSchedule(id, T, [
      { t: a, rising: true },
      { t: b, rising: false },
    ])
  })
}

export function model120(): CircuitModel<Inv120Params, Resolved120> {
  return {
    kind: 'inv-120',
    resolve: resolve120,
    startupPeriods: (p) => {
      const tau = p.load === 'RL' ? p.l / p.r : 0
      return Math.max(3, Math.min(40, Math.ceil((5 * tau) / p.period) + 1))
    },
    build(p) {
      const schedules = schedules120(p)
      const gate = (id: string) => schedules.find((s) => s.id === id)!.at
      const names = legDevices(p)
      const els: Element[] = []
      let n = 0
      const nP = ++n
      els.push({ kind: 'V', id: 'Vdc', a: nP, b: 0, value: () => p.vdc })
      const legNodes: number[] = []
      for (let leg = 0; leg < 3; leg++) {
        const x = ++n
        legNodes.push(x)
        const [su, du, sl, dl] = names[leg]
        els.push(
          { kind: 'D', id: su as DiodeId, a: nP, b: x, vf: p.dev.vce, gate: gate(su), latch: false },
          { kind: 'D', id: du as DiodeId, a: x, b: nP, vf: p.dev.vfD },
          { kind: 'D', id: sl as DiodeId, a: x, b: 0, vf: p.dev.vce, gate: gate(sl), latch: false },
          { kind: 'D', id: dl as DiodeId, a: 0, b: x, vf: p.dev.vfD },
          { kind: 'R', id: `Rb${leg}`, a: x, b: 0, r: BLEED },
        )
      }
      const neutral = ++n
      ;['a', 'b', 'c'].forEach((ph, i) => {
        if (p.load === 'RL') {
          const m = ++n
          els.push({ kind: 'R', id: `R${ph}`, a: legNodes[i], b: m, r: p.r }, { kind: 'L', id: `L${ph}`, a: m, b: neutral, l: p.l })
        } else els.push({ kind: 'R', id: `R${ph}`, a: legNodes[i], b: neutral, r: p.r })
      })
      const idx = (id: string) => els.findIndex((e) => e.id === id)
      const iR = ['a', 'b', 'c'].map((ph) => idx(`R${ph}`))
      const iSrc = idx('Vdc')
      const scaleI = p.vdc / p.r
      return {
        net: { nodes: n, elements: els },
        diode: { kind: 'real', vf: 0, ron: p.dev.ron },
        schedules,
        devices: names.flat(),
        scale: new Array<number>(p.load === 'RL' ? 3 : 0).fill(scaleI),
        read(sol: NetlistSolution) {
          const v = sol.v
          const out: Record<string, number> = {}
          legNodes.forEach((x, i) => (out[`v${'abc'[i]}N`] = v[x]))
          out.vab = v[legNodes[0]] - v[legNodes[1]]
          out.vbc = v[legNodes[1]] - v[legNodes[2]]
          out.vca = v[legNodes[2]] - v[legNodes[0]]
          out.vnN = v[neutral]
          out.van = v[legNodes[0]] - v[neutral]
          out.vbn = v[legNodes[1]] - v[neutral]
          out.vcn = v[legNodes[2]] - v[neutral]
          out.ia = sol.i[iR[0]]
          out.ib = sol.i[iR[1]]
          out.ic = sol.i[iR[2]]
          out.vo = out.vab
          out.io = out.ia
          out.idc = -sol.i[iSrc]
          out.pdc = p.vdc * out.idc
          out.po = (out.ia * out.ia + out.ib * out.ib + out.ic * out.ic) * p.r
          for (const d of sol.diodes) out[`i${d.id}`] = d.current
          return out
        },
      }
    },
  }
}

// ── THEORY: the exact piecewise solution of the ideal circuit (independent of the netlist engine) ──────────

export type LegMode = 'up' | 'down' | 'open'
export interface Seg120 {
  ta: number
  tb: number
  /** How each leg is tied: to the + rail, to the − rail, or open (no device conducts). */
  legs: LegMode[]
  /** Gate state per leg: upper gated, lower gated, or neither. */
  gates: Array<'up' | 'down' | 'none'>
  /** Leg voltages to DC− and phase voltages to the load neutral (constant on the segment). */
  vx: number[]
  vph: number[]
  /** Phase currents at ta. */
  i0: number[]
}
export interface Theory120 {
  segs: Seg120[]
  tau: number
  /** Phase current x at time t (periodic). */
  at(x: number, t: number): number
  /** RMS and peak of the phase current, and the cycles the fixed-point iteration needed. */
  irms: number
  ipeak: number
  cycles: number
}

/**
 * Ideal switches, Vf = 0, Ron = 0. On every interval the circuit is linear with one time constant τ = L/R:
 *  - all three legs tied to rails: vn = (vaN + vbN + vcN)/3, each phase current → (vxN − vn)/R exponentially;
 *  - one leg open (its current zero): the other two carry ±i, 2L·di/dt + 2R·i = vyN − vzN, the open phase
 *    voltage is 0 and the open leg sits at vn = (vyN + vzN)/2.
 * A leg without a gate is tied to a rail by a diode while its current flows (i > 0: lower diode, 0 V; i < 0:
 * upper diode, Vdc); the instant that current reaches zero is solved exactly (it is A + B·e^(−t/τ)). The
 * periodic steady state is the fixed point of one cycle, iterated until the currents repeat to 10⁻¹³.
 */
export function theory120(p: Resolved120): Theory120 {
  const T = p.period
  const V = p.vdc
  const tau = p.load === 'RL' ? p.l / p.r : 0
  const names = legDevices(p)
  const gateOf = (leg: number, t: number): 'up' | 'down' | 'none' => {
    const th = (t / T) * 360
    if (gatedAt(p, names[leg][0], th)) return 'up'
    if (gatedAt(p, names[leg][2], th)) return 'down'
    return 'none'
  }
  // gate change instants in one period
  const bounds = [...new Set([0, T, ...Object.values(START_DEG).flatMap((d) => [d, d + p.conduction].map((x) => (((x % 360) + 360) % 360 / 360) * T))])].sort((a, b) => a - b)
  const breaks: number[] = []
  for (const t of bounds) if (!breaks.length || t - breaks[breaks.length - 1] > T * 1e-12) breaks.push(t)
  if (breaks[breaks.length - 1] < T) breaks.push(T)
  const voltagesFor = (legs: LegMode[]) => {
    const vx = legs.map((m) => (m === 'up' ? V : m === 'down' ? 0 : NaN))
    const open = legs.indexOf('open')
    if (open < 0) {
      const vn = (vx[0] + vx[1] + vx[2]) / 3
      return { vx, vph: vx.map((x) => x - vn) }
    }
    const [y, z] = [0, 1, 2].filter((k) => k !== open)
    const vph = [0, 0, 0]
    vph[y] = (vx[y] - vx[z]) / 2
    vph[z] = -vph[y]
    vx[open] = (vx[y] + vx[z]) / 2
    return { vx, vph }
  }
  /** One cycle from currents i at t = 0; returns its segments and the currents at T. */
  const cycle = (iStart: number[]): { segs: Seg120[]; iEnd: number[] } => {
    const segs: Seg120[] = []
    let i = [...iStart]
    for (let b = 0; b + 1 < breaks.length; b++) {
      let t = breaks[b]
      const tEnd = breaks[b + 1]
      const gates = [0, 1, 2].map((leg) => gateOf(leg, (t + tEnd) / 2))
      for (let guard = 0; guard < 4 && t < tEnd; guard++) {
        // how each leg is tied now (gated, or by a diode while its current flows)
        const eps = 1e-12 * V / Math.max(p.r, 1e-12)
        const legs: LegMode[] = gates.map((g, k) => (g !== 'none' ? g : tau === 0 ? 'open' : i[k] > eps ? 'down' : i[k] < -eps ? 'up' : 'open'))
        // an R load: a diode cannot hold a current without inductance — an ungated leg is open at once
        const { vx, vph } = voltagesFor(legs)
        if (tau === 0) {
          const cur = vph.map((x) => x / p.r)
          segs.push({ ta: t, tb: tEnd, legs, gates, vx, vph, i0: cur })
          i = cur
          t = tEnd
          break
        }
        const A = vph.map((x) => x / p.r)
        // a diode-tied leg without a gate: when does its current reach zero?
        let tz = Infinity
        let zLeg = -1
        gates.forEach((g, k) => {
          if (g !== 'none' || legs[k] === 'open') return
          const r = -A[k] / (i[k] - A[k])
          if (r > 0 && r < 1) {
            const s = -tau * Math.log(r)
            if (t + s < tz) {
              tz = t + s
              zLeg = k
            }
          }
        })
        const tb = Math.min(tEnd, tz)
        segs.push({ ta: t, tb, legs, gates, vx, vph, i0: [...i] })
        const e = Math.exp(-(tb - t) / tau)
        i = i.map((x, k) => A[k] + (x - A[k]) * e)
        if (tb < tEnd && zLeg >= 0) i[zLeg] = 0
        // the two other currents are exactly opposite once a leg opens (Kirchhoff at n)
        t = tb
      }
    }
    return { segs, iEnd: i }
  }
  let i0 = [0, 0, 0]
  let res = cycle(i0)
  let cycles = 1
  if (tau > 0) {
    const scale = V / p.r
    for (; cycles < 400000; cycles++) {
      const d = Math.max(...res.iEnd.map((x, k) => Math.abs(x - i0[k])))
      if (d < 1e-13 * scale) break
      i0 = res.iEnd
      res = cycle(i0)
    }
  }
  const segs = res.segs
  const at = (x: number, t: number) => {
    const u = t - T * Math.floor(t / T)
    const s = segs.find((q) => u >= q.ta && u < q.tb) ?? segs[segs.length - 1]
    const A = s.vph[x] / p.r
    return tau === 0 ? A : A + (s.i0[x] - A) * Math.exp(-(u - s.ta) / tau)
  }
  // RMS (exact integral of (A + B·e^(−s/τ))²) and peak of phase a
  let s2 = 0
  let ipeak = 0
  for (const s of segs) {
    const A = s.vph[0] / p.r
    const D = s.tb - s.ta
    if (tau === 0) {
      s2 += A * A * D
      ipeak = Math.max(ipeak, Math.abs(A))
      continue
    }
    const B = s.i0[0] - A
    const e1 = Math.exp(-D / tau)
    s2 += A * A * D + 2 * A * B * tau * (1 - e1) + ((B * B * tau) / 2) * (1 - e1 * e1)
    ipeak = Math.max(ipeak, Math.abs(s.i0[0]), Math.abs(A + B * e1))
  }
  return { segs, tau, at, irms: Math.sqrt(s2 / T), ipeak, cycles }
}

/**
 * THEORY: fractions of the cycle (Σ over the three legs) during which a freewheeling diode conducts, and during
 * which a leg is open (no device conducts). A diode conducts in an ungated leg tied to a rail, and in a gated
 * leg whose current flows against its IGBT (the zero crossing inside a segment is exact).
 */
export function fractions120(p: Resolved120, th: Theory120): { diode: number; open: number } {
  let diode = 0
  let open = 0
  for (const s of th.segs) {
    const D = s.tb - s.ta
    for (let k = 0; k < 3; k++) {
      if (s.legs[k] === 'open') {
        open += D
        continue
      }
      if (s.gates[k] === 'none') {
        diode += D
        continue
      }
      const A = s.vph[k] / p.r
      const i0 = s.i0[k]
      const bad = (x: number) => (s.gates[k] === 'up' ? x < 0 : x > 0)
      if (th.tau === 0) {
        if (bad(A)) diode += D
        continue
      }
      const B = i0 - A
      const iEnd = A + B * Math.exp(-D / th.tau)
      let sz = -1
      if (B !== 0 && -A / B > 0) sz = -th.tau * Math.log(-A / B)
      if (sz > 0 && sz < D) diode += bad(i0) ? sz : D - sz
      else if (bad(0.5 * (i0 + iEnd))) diode += D
    }
  }
  return { diode: diode / p.period, open: open / p.period }
}
