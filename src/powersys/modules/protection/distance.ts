import { abs, add, arg, C, conj, div, mul, neg, ONE, polarDeg, scale, sub, ZERO, type Complex } from '../../engine/complex.ts'
import { solveComplex } from '../../engine/linalg.ts'
import { iBaseKa, zBaseOhm } from '../../network/perunit.ts'
import type { Line, Network } from '../../network/types.ts'
import { shiftSeq, toPhase, type FaultType, type Trio } from '../faults/sequence.ts'
import { faultNetwork, SETUP0 } from '../faults/study.ts'
import { faultStudy, sequenceModel, type FaultResult, type SeqModel } from '../faults/zbus.ts'

/*
 * Distance protection, built ON TOP of Module 4's validated fault model (faults/zbus.ts, faults/sequence.ts): nothing
 * here re-derives a fault equation. What this file adds is what Module 4 does not provide:
 *  - a fault part-way along a line: the line is split at the fault into two lines of the same per-km data, a new
 *    bus F is placed between them, and Module 4's sequenceModel + faultStudy solve the fault at F;
 *  - what a relay at a line end measures (the voltage of its bus and the current from its bus into its line);
 *  - an optional pre-fault power transfer (by superposition of the pre-fault state on Module 4's fault solution);
 *  - apparent impedance per measuring loop, the residual compensation k₀, mho zones, and the trip decisions.
 *
 * The study system is Module 4's network (generator G1 → T1 → 220 kV bus A → 120 km line L1 → 220 kV bus B → T2 …)
 * with two additions of this module: a 100 km "next line" L3 from B to a substation C (same per-km data as L1), and
 * optionally a remote grid infeed at B. With the infeed off and no fault on L3, the network is Module 4's own (L3 is a
 * dead-end line and changes no bus-fault result — tested).
 */

export const KV = 220
const BASE_NET = faultNetwork(SETUP0)
export const BASE_MVA = BASE_NET.baseMva
export const F_HZ = BASE_NET.fHz
/** Impedance and current bases at 220 kV [Ω, kA]. */
export const ZB = zBaseOhm(KV, BASE_MVA)
export const IB_KA = iBaseKa(KV, BASE_MVA)

/** Module 4's 220 kV line L1 — the protected line. */
export const LINE_L1 = BASE_NET.components.find((c) => c.id === 'L1') as Line
export const L1_KM = LINE_L1.lengthKm
/** The next line L3 (this module's addition): same construction as L1. */
export const L3_KM = 100
export const ROUTE_KM = L1_KM + L3_KM
export const Z1_KM: Complex = C(LINE_L1.rOhmPerKm, LINE_L1.xOhmPerKm)
export const Z0_KM: Complex = C(LINE_L1.r0OhmPerKm ?? 3 * LINE_L1.rOhmPerKm, LINE_L1.x0OhmPerKm ?? 3 * LINE_L1.xOhmPerKm)
/** Positive- and zero-sequence impedance of the whole line [Ω]. */
export const Z1L = scale(Z1_KM, L1_KM)
export const Z0L = scale(Z0_KM, L1_KM)
export const Z1L3 = scale(Z1_KM, L3_KM)

/** Residual (earth-return) compensation factor k₀ = (Z₀ − Z₁)/(3Z₁) — the same per km or for the whole line. */
export const k0Of = (z1: Complex, z0: Complex): Complex => div(sub(z0, z1), scale(z1, 3))
export const K0 = k0Of(Z1_KM, Z0_KM)

/** Instrument transformers at the relay (typical ratios): CT 800/1 A, VT 220 kV/110 V. */
export const CT_RATIO = 800
export const VT_RATIO = 2000
/** Smallest loop current the relay measures with [A primary]: 10 % of the CT rating (a typical setting). */
export const I_MIN_A = 0.1 * CT_RATIO
/** Breaker interrupting time [s]: 3 cycles at 50 Hz (a typical value). */
export const BREAKER_S = 0.06
/** The remote grid's X/R (typical). */
export const REMOTE_XR = 10

// ── the study system ─────────────────────────────────────────────────────────────────────────────────────────────

export interface RouteOpts {
  /** A grid infeed at bus B (a second source, at the remote end of L1). */
  infeed: boolean
  /** Its short-circuit level [MVA]. */
  sscMva: number
  /** Pre-fault angle of A's source ahead of B's [°]: > 0 means A exports to B (needs the infeed). */
  deltaDeg: number
}
export const ROUTE0: RouteOpts = { infeed: false, sscMva: 2000, deltaDeg: 0 }

/** Module 4's network + the next line L3 (B → C) + the optional remote grid at B. */
export function routeNetwork(o: RouteOpts): Network {
  const n = faultNetwork(SETUP0)
  n.id = 'protection-route'
  n.buses.push({ id: 'hvC', name: 'Substation C 220 kV', kv: KV, x: 700, y: 60 })
  n.components.push({
    kind: 'line',
    id: 'L3',
    name: '220 kV line L3 (the next line)',
    from: 'hvB',
    to: 'hvC',
    lengthKm: L3_KM,
    rOhmPerKm: LINE_L1.rOhmPerKm,
    xOhmPerKm: LINE_L1.xOhmPerKm,
    bUsPerKm: LINE_L1.bUsPerKm,
    r0OhmPerKm: LINE_L1.r0OhmPerKm,
    x0OhmPerKm: LINE_L1.x0OhmPerKm,
    ratingMva: LINE_L1.ratingMva,
  })
  if (o.infeed) n.components.push({ kind: 'grid', id: 'GB', name: 'Remote grid at B', bus: 'hvB', vPu: 1, scMva: o.sscMva, xr: REMOTE_XR })
  return n
}

export type RelayId = 'RA' | 'RBA' | 'RBC'
export const RELAY_IDS: RelayId[] = ['RA', 'RBA', 'RBC']
export const RELAY_INFO: Record<RelayId, { bus: 'hvA' | 'hvB'; line: 'L1' | 'L3'; name: string; short: string; z1: Complex; km: number }> = {
  RA: { bus: 'hvA', line: 'L1', name: 'Relay at A on line L1 (looks towards B)', short: 'R_A', z1: Z1L, km: L1_KM },
  RBA: { bus: 'hvB', line: 'L1', name: 'Relay at B on line L1 (looks towards A)', short: 'R_BA', z1: Z1L, km: L1_KM },
  RBC: { bus: 'hvB', line: 'L3', name: 'Relay at B on line L3 (looks towards C)', short: 'R_BC', z1: Z1L3, km: L3_KM },
}

/** Where a relay's current is read: a branch end (`to` = into the line from the `to` bus, i.e. −i_to), plus the fault current when the fault sits at the relay's own line terminal. */
interface CurSpec {
  branch: string
  end: 'from' | 'to'
  plusFault: boolean
}

const EPS_KM = 1e-6

/** Place a fault at `km` along the route A → B → C (0…L1 is on L1; L1 itself is L1's terminal at B; beyond is on L3). */
function placeFault(base: Network, km: number): { net: Network; bus: string; cur: Record<RelayId, CurSpec>; onL1: boolean; m: number } {
  const x = Math.min(Math.max(km, 0), ROUTE_KM)
  const net: Network = { ...base, buses: [...base.buses], components: [...base.components] }
  const split = (id: 'L1' | 'L3', near: string, far: string, a: number) => {
    const ln = net.components.find((c) => c.id === id) as Line
    const total = ln.lengthKm
    net.components = net.components.filter((c) => c.id !== id)
    net.buses.push({ id: 'F', name: 'Fault point', kv: KV, x: 0, y: 0 })
    net.components.push({ ...ln, id: `${id}a`, from: near, to: 'F', lengthKm: a }, { ...ln, id: `${id}b`, from: far, to: 'F', lengthKm: total - a })
  }
  if (x <= EPS_KM)
    return {
      net,
      bus: 'hvA',
      onL1: true,
      m: 0,
      cur: { RA: { branch: 'L1', end: 'from', plusFault: true }, RBA: { branch: 'L1', end: 'to', plusFault: false }, RBC: { branch: 'L3', end: 'from', plusFault: false } },
    }
  if (x < L1_KM - EPS_KM) {
    split('L1', 'hvA', 'hvB', x)
    return {
      net,
      bus: 'F',
      onL1: true,
      m: x / L1_KM,
      cur: { RA: { branch: 'L1a', end: 'from', plusFault: false }, RBA: { branch: 'L1b', end: 'from', plusFault: false }, RBC: { branch: 'L3', end: 'from', plusFault: false } },
    }
  }
  if (x <= L1_KM)
    return {
      net,
      bus: 'hvB',
      onL1: true,
      m: 1,
      cur: { RA: { branch: 'L1', end: 'from', plusFault: false }, RBA: { branch: 'L1', end: 'to', plusFault: true }, RBC: { branch: 'L3', end: 'from', plusFault: false } },
    }
  const y = x - L1_KM
  if (y <= EPS_KM)
    return {
      net,
      bus: 'hvB',
      onL1: false,
      m: 0,
      cur: { RA: { branch: 'L1', end: 'from', plusFault: false }, RBA: { branch: 'L1', end: 'to', plusFault: false }, RBC: { branch: 'L3', end: 'from', plusFault: true } },
    }
  if (y < L3_KM - EPS_KM) {
    split('L3', 'hvB', 'hvC', y)
    return {
      net,
      bus: 'F',
      onL1: false,
      m: y / L3_KM,
      cur: { RA: { branch: 'L1', end: 'from', plusFault: false }, RBA: { branch: 'L1', end: 'to', plusFault: false }, RBC: { branch: 'L3a', end: 'from', plusFault: false } },
    }
  }
  return {
    net,
    bus: 'hvC',
    onL1: false,
    m: 1,
    cur: { RA: { branch: 'L1', end: 'from', plusFault: false }, RBA: { branch: 'L1', end: 'to', plusFault: false }, RBC: { branch: 'L3', end: 'from', plusFault: false } },
  }
}

/** The pre-fault positive-sequence bus voltages with A's source at 1∠0 and the remote grid at 1∠−δ (loads neglected, as in Module 4). Null = every bus at 1.0 pu (no power transfer). */
export function prefaultVoltages(model: SeqModel, o: RouteOpts): Complex[] | null {
  if (!o.infeed || o.deltaDeg === 0) return null
  const n = model.busIds.length
  const inj: Complex[] = new Array(n).fill(ZERO)
  for (const s of model.sources) if (s.z1) inj[s.bus] = add(inj[s.bus], div(s.id === 'GB' ? polarDeg(1, -o.deltaDeg) : ONE, s.z1))
  const live = model.busIds.map((_, i) => i).filter((i) => model.seq[1].earthed[i])
  const x = solveComplex(
    live.map((i) => live.map((k) => model.seq[1].Y[i][k])),
    live.map((i) => inj[i]),
  )
  if (!x) return null
  const v: Complex[] = new Array(n).fill(ZERO)
  live.forEach((i, a) => (v[i] = x[a]))
  return v
}

export interface FaultSpec {
  /** Distance from A along the route [km]: 0…120 on L1, 120…220 on L3. */
  km: number
  type: FaultType
  /** Fault resistance [Ω]: per phase to the fault's star point (3-phase), phase to earth (L-G), between the phases (L-L), common path to earth (L-L-G). */
  rfOhm: number
}
export const FAULT0: FaultSpec = { km: 0.7 * L1_KM, type: '3ph', rfOhm: 0 }

/** What one relay measures [pu: phase-to-earth voltage of 220/√3 kV, current of the 220 kV base]. */
export interface RelayView {
  id: RelayId
  v012: Trio
  i012: Trio
  vabc: Trio
  iabc: Trio
}

export interface RouteFault {
  spec: FaultSpec
  opts: RouteOpts
  onL1: boolean
  /** Fraction along the faulted line (L1 or L3). */
  m: number
  /** Module 4's fault study of the network with the fault bus inserted. */
  result: FaultResult
  model: SeqModel
  /** Pre-fault voltage at the fault point [pu]. */
  vfPre: Complex
  relays: Record<RelayId, RelayView>
  /** Largest phase current in the fault [kA]. */
  faultKa: number
}

const branchI = (r: FaultResult, id: string, end: 'from' | 'to'): Trio => {
  const b = r.branches.find((x) => x.id === id)!
  return end === 'from' ? b.i012From : (b.i012To.map(neg) as Trio)
}
const addT = (a: Trio, b: Trio): Trio => [add(a[0], b[0]), add(a[1], b[1]), add(a[2], b[2])]

/** A fault on the route, solved with Module 4's model, and what the three relays measure. */
export function routeFault(spec: FaultSpec, opts: RouteOpts = ROUTE0, base: Network = routeNetwork(opts)): RouteFault {
  const pl = placeFault(base, spec.km)
  const model = sequenceModel(pl.net)
  const pre = prefaultVoltages(model, opts)
  const at = (id: string) => model.busIds.indexOf(id)
  const vPre = (id: string) => (pre ? pre[at(id)] : ONE)
  const vf = vPre(pl.bus)
  const result = faultStudy(model, pl.bus, spec.type, C(spec.rfOhm / ZB), vf)
  const zL1 = div(Z1L, C(ZB))
  const zL3 = div(Z1L3, C(ZB))
  const preI: Record<RelayId, Complex> = {
    RA: pre ? div(sub(vPre('hvA'), vPre('hvB')), zL1) : ZERO,
    RBA: pre ? div(sub(vPre('hvB'), vPre('hvA')), zL1) : ZERO,
    RBC: pre ? div(sub(vPre('hvB'), vPre('hvC')), zL3) : ZERO,
  }
  const relays = {} as Record<RelayId, RelayView>
  for (const id of RELAY_IDS) {
    const c = pl.cur[id]
    const bus = result.buses[at(RELAY_INFO[id].bus)]
    // total = pre-fault state + the change Module 4 computes (its fault solution has no pre-fault current: V_i = V_f − Z·I)
    const v012: Trio = [bus.v012[0], add(sub(bus.v012[1], vf), vPre(RELAY_INFO[id].bus)), bus.v012[2]]
    let i012 = branchI(result, c.branch, c.end)
    if (c.plusFault) i012 = addT(i012, result.point.i012)
    i012 = [i012[0], add(i012[1], preI[id]), i012[2]]
    const sh = 30 * bus.shifts
    relays[id] = { id, v012, i012, vabc: toPhase(shiftSeq(v012, sh)), iabc: toPhase(shiftSeq(i012, sh)) }
  }
  return { spec, opts, onL1: pl.onL1, m: pl.m, result, model, vfPre: vf, relays, faultKa: result.faultKa }
}

// ── measuring loops and apparent impedance ───────────────────────────────────────────────────────────────────────

export type Loop = 'aE' | 'bE' | 'cE' | 'ab' | 'bc' | 'ca'
export const LOOPS: Loop[] = ['aE', 'bE', 'cE', 'ab', 'bc', 'ca']
export const LOOP_LABEL: Record<Loop, string> = { aE: 'a–E', bE: 'b–E', cE: 'c–E', ab: 'a–b', bc: 'b–c', ca: 'c–a' }
/** The loop that measures each fault type (phase a is the faulted phase for L-G; b and c for L-L and L-L-G, as in Module 4). */
export const LOOP_OF: Record<FaultType, Loop> = { '3ph': 'aE', slg: 'aE', ll: 'bc', dlg: 'bc' }

/** Loop voltage and current [pu]: phase–earth V_p / (I_p + k₀·3I₀) with 3I₀ = I_a + I_b + I_c; phase–phase (V_p − V_q)/(I_p − I_q). */
export function loopVI(loop: Loop, vabc: Trio, iabc: Trio, k0: Complex): { v: Complex; i: Complex } {
  const p = { a: 0, b: 1, c: 2 } as const
  if (loop.endsWith('E')) {
    const k = p[loop[0] as 'a' | 'b' | 'c']
    const ires = add(add(iabc[0], iabc[1]), iabc[2])
    return { v: vabc[k], i: add(iabc[k], mul(k0, ires)) }
  }
  const a = p[loop[0] as 'a' | 'b' | 'c']
  const b = p[loop[1] as 'a' | 'b' | 'c']
  return { v: sub(vabc[a], vabc[b]), i: sub(iabc[a], iabc[b]) }
}

/** Loop current in primary amperes. */
export const loopAmps = (i: Complex) => abs(i) * IB_KA * 1000

/** Apparent impedance of a loop [Ω primary]; null if the loop current is below the relay's minimum (it cannot measure). */
export function apparentOhm(loop: Loop, view: RelayView, k0: Complex): Complex | null {
  const { v, i } = loopVI(loop, view.vabc, view.iabc, k0)
  if (loopAmps(i) < I_MIN_A) return null
  return scale(div(v, i), ZB)
}

/** Primary ohms → the secondary ohms the relay is set in: Z_sec = Z_prim × CT ratio / VT ratio. */
export const secondaryOhm = (z: Complex) => scale(z, CT_RATIO / VT_RATIO)

// ── zones ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ZoneSettings {
  /** Reach of zones 1, 2, 3 as % of the relay's own line impedance Z₁L (along the line angle). */
  reachPct: [number, number, number]
  /** Time delays of zones 1, 2, 3 [s]. */
  timeS: [number, number, number]
  /** Residual compensation k₀ applied in the earth-fault loops. */
  k0On: boolean
}
/** Typical settings (not from a standard): 80 % instantaneous, 120 % after 0.3 s, 200 % after 0.8 s. */
export const ZONES0: ZoneSettings = { reachPct: [80, 120, 200], timeS: [0, 0.3, 0.8], k0On: true }

/** Why a set of settings cannot be used (empty = valid). */
export function zoneIssues(z: ZoneSettings): string[] {
  const out: string[] = []
  z.reachPct.forEach((r, k) => {
    if (!Number.isFinite(r) || r <= 0) out.push(`Zone ${k + 1} has no reach (${Number.isFinite(r) ? r : '—'} %): a zone must reach some way along the line.`)
    else if (r > 500) out.push(`Zone ${k + 1} reach of ${r} % is beyond this model’s range (≤ 500 %).`)
  })
  if (z.reachPct[1] <= z.reachPct[0]) out.push('Zone 2 must reach further than zone 1.')
  if (z.reachPct[2] <= z.reachPct[1]) out.push('Zone 3 must reach further than zone 2.')
  z.timeS.forEach((t, k) => {
    if (!Number.isFinite(t) || t < 0) out.push(`Zone ${k + 1} time must be zero or positive.`)
  })
  if (z.timeS[1] < z.timeS[0] || z.timeS[2] < z.timeS[1]) out.push('Zone times must not decrease from zone 1 to zone 3.')
  return out
}

/** A zone's reach as an impedance: (reach %) × Z₁L, at the line angle (the relay characteristic angle = line angle). */
export const reachOhm = (lineZ1: Complex, pct: number): Complex => scale(lineZ1, pct / 100)

/** Mho circle: through the origin, diameter = the reach. Inside ⇔ |Z − Z_r/2| ≤ |Z_r|/2. */
export const inMho = (z: Complex, reach: Complex): boolean => abs(sub(z, scale(reach, 0.5))) <= abs(reach) / 2
/** The same circle as a phase comparator (the second method): operate ⇔ angle between Z and Z_r − Z ≤ 90° ⇔ Re[(Z_r − Z)·Z*] ≥ 0. */
export const mhoComparator = (z: Complex, reach: Complex): boolean => mul(sub(reach, z), conj(z)).re >= 0

export type Zone = 0 | 1 | 2 | 3

export interface RelayDecision {
  relay: RelayId
  loop: Loop
  /** Apparent impedance [Ω primary]; null when the current is too small to measure. */
  z: Complex | null
  /** Loop current [A primary]. */
  iA: number
  /** 0 = in no zone. */
  zone: Zone
  /** Time the relay operates [s] (zone delay); null = it does not operate. */
  tripS: number | null
}

export function decide(id: RelayId, view: RelayView, type: FaultType, zones: ZoneSettings): RelayDecision {
  const loop = LOOP_OF[type]
  const k0 = zones.k0On ? K0 : ZERO
  const { i } = loopVI(loop, view.vabc, view.iabc, k0)
  const z = apparentOhm(loop, view, k0)
  let zone: Zone = 0
  if (z)
    for (const k of [1, 2, 3] as const)
      if (inMho(z, reachOhm(RELAY_INFO[id].z1, zones.reachPct[k - 1]))) {
        zone = k
        break
      }
  return { relay: id, loop, z, iA: loopAmps(i), zone, tripS: zone ? zones.timeS[zone - 1] : null }
}

// ── clearing: which breakers open, and what is left without supply ────────────────────────────────────────────────

export type CbId = 'cbA' | 'cbB1' | 'cbB2'
export const CB_OF: Record<RelayId, CbId> = { RA: 'cbA', RBA: 'cbB1', RBC: 'cbB2' }
export const CB_NAME: Record<CbId, string> = { cbA: 'CB A (line L1 at A)', cbB1: 'CB B1 (line L1 at B)', cbB2: 'CB B2 (line L3 at B)' }

export interface Clearing {
  /** Time each breaker has opened [s, relay time + breaker time]; null = stays closed. */
  open: Record<CbId, number | null>
  /** When the fault is disconnected from every source [s]; null = not cleared by these relays. */
  clearedS: number | null
  /** Relays that had started timing but reset because another breaker cleared the fault first. */
  reset: RelayId[]
  /** Parts without supply afterwards. */
  dead: { L1: boolean; B: boolean; L3: boolean }
  /** Two relays tripped at the same time for one fault (no discrimination). */
  tie: boolean
}

/**
 * The fault is fed from A's source (always) and from the remote grid at B (when present). Relays operate in the order
 * of their times; after each group of breakers opens, the fault is checked: if no source can still feed it, it is
 * cleared and the slower relays reset. Simplification (stated on screen): every relay's decision is the one it makes
 * with all breakers closed — the change of currents after a first breaker opens (sequential tripping) is not recomputed.
 */
export function clearing(d: Record<RelayId, RelayDecision>, onL1: boolean, infeed: boolean): Clearing {
  const open: Record<CbId, number | null> = { cbA: null, cbB1: null, cbB2: null }
  const fed = () => {
    const A = onL1 ? open.cbA === null : open.cbA === null && open.cbB2 === null
    const B = infeed && (onL1 ? open.cbB1 === null : open.cbB2 === null)
    return A || B
  }
  const times = [...new Set(RELAY_IDS.map((r) => d[r].tripS).filter((t): t is number => t !== null))].sort((a, b) => a - b)
  let clearedS: number | null = null
  const reset: RelayId[] = []
  let tie = false
  for (const t of times) {
    const group = RELAY_IDS.filter((r) => d[r].tripS === t)
    if (clearedS !== null) {
      reset.push(...group)
      continue
    }
    if (group.length > 1) tie = true
    for (const r of group) open[CB_OF[r]] = t + BREAKER_S
    if (!fed()) clearedS = t + BREAKER_S
  }
  const busB = infeed || (open.cbA === null && open.cbB1 === null)
  return {
    open,
    clearedS,
    reset,
    tie,
    dead: { L1: !(open.cbA === null || (infeed && open.cbB1 === null)), B: !busB, L3: !(busB && open.cbB2 === null) },
  }
}

export interface DistanceCase {
  fault: RouteFault
  decisions: Record<RelayId, RelayDecision>
  clearing: Clearing
}

export function distanceCase(spec: FaultSpec, opts: RouteOpts, zones: ZoneSettings): DistanceCase {
  const fault = routeFault(spec, opts)
  const decisions = Object.fromEntries(RELAY_IDS.map((r) => [r, decide(r, fault.relays[r], spec.type, zones)])) as Record<RelayId, RelayDecision>
  return { fault, decisions, clearing: clearing(decisions, fault.onL1, opts.infeed) }
}

// ── sweeps: the R–X trajectory and the time–distance characteristic ────────────────────────────────────────────────

export interface StepSeg {
  x0: number
  x1: number
  zone: Zone
  t: number | null
}
export interface Sweep {
  /** Fault positions [km] and R_A's apparent impedance there (null = not measurable). */
  points: Array<{ km: number; z: Complex | null }>
  /** Where each relay's zones reach along the route (computed fault by fault, boundaries refined by bisection). */
  steps: Record<RelayId, StepSeg[]>
}

const RANGE: Record<RelayId, [number, number]> = { RA: [0, ROUTE_KM], RBA: [0, L1_KM], RBC: [L1_KM, ROUTE_KM] }

/** Sweep a fault of one type and resistance along the route. `n` samples; zone boundaries refined to 1e-4 km. */
export function sweep(type: FaultType, rfOhm: number, opts: RouteOpts, zones: ZoneSettings, n = 160): Sweep {
  const base = routeNetwork(opts)
  const at = (km: number) => {
    const f = routeFault({ km, type, rfOhm }, opts, base)
    return Object.fromEntries(RELAY_IDS.map((r) => [r, decide(r, f.relays[r], type, zones)])) as Record<RelayId, RelayDecision>
  }
  const xs: number[] = []
  for (let i = 0; i <= n; i++) xs.push((ROUTE_KM * i) / n)
  if (!xs.includes(L1_KM)) xs.push(L1_KM)
  xs.sort((a, b) => a - b)
  const ds = xs.map(at)
  const points = xs.map((km, i) => ({ km, z: ds[i].RA.z }))
  const steps = {} as Record<RelayId, StepSeg[]>
  for (const r of RELAY_IDS) {
    const [lo, hi] = RANGE[r]
    const idx = xs.map((_, i) => i).filter((i) => xs[i] >= lo - 1e-9 && xs[i] <= hi + 1e-9)
    const segs: StepSeg[] = []
    let start = xs[idx[0]]
    let zone = ds[idx[0]][r].zone
    for (let j = 1; j < idx.length; j++) {
      const z2 = ds[idx[j]][r].zone
      if (z2 === zone) continue
      // refine the boundary between two samples
      let a = xs[idx[j - 1]]
      let b = xs[idx[j]]
      for (let it = 0; it < 22 && b - a > 1e-4; it++) {
        const mid = (a + b) / 2
        if (at(mid)[r].zone === zone) a = mid
        else b = mid
      }
      segs.push({ x0: start, x1: (a + b) / 2, zone, t: zone ? zones.timeS[zone - 1] : null })
      start = (a + b) / 2
      zone = z2
    }
    segs.push({ x0: start, x1: hi, zone, t: zone ? zones.timeS[zone - 1] : null })
    steps[r] = segs
  }
  return { points, steps }
}

// ── an independent second method: the two-source circuit by hand (positive sequence, three-phase fault on L1) ──

/**
 * Source E_S behind Z_S at A, line Z_L, source E_R behind Z_R at B; a three-phase fault at fraction m through R_f.
 * Superposition: pre-fault current I_pre = (E_S − E_R)/(Z_S + Z_L + Z_R), pre-fault voltage at the fault
 * V_F0 = E_S − (Z_S + mZ_L)·I_pre, fault current I_F = V_F0/(Z_th + R_f) with Z_th = (Z_S + mZ_L) ‖ (Z_R + (1−m)Z_L);
 * the relay at A carries I_A = I_pre + I_F·(Z_R + (1−m)Z_L)/(Z_S + Z_L + Z_R) and sees V_A = E_S − Z_S·I_A.
 * Then Z_app = V_A/I_A = m·Z_L + R_f·(I_F/I_A) = m·Z_L + R_f·(1 + I_B/I_A). All in per unit.
 */
export function twoSource3ph(zs: Complex, zr: Complex | null, zl: Complex, m: number, rf: Complex, es: Complex = ONE, er: Complex = ONE) {
  const zA = add(zs, scale(zl, m))
  if (!zr) {
    // single source: everything flows from A
    const iF = div(es, add(zA, rf))
    const vA = sub(es, mul(zs, iF))
    return { iA: iF, iF, vA, zApp: div(vA, iF), iPre: ZERO }
  }
  const zB = add(zr, scale(zl, 1 - m))
  const tot = add(zA, zB)
  const iPre = div(sub(es, er), tot)
  const vF0 = sub(es, mul(zA, iPre))
  const zth = div(mul(zA, zB), tot)
  const iF = div(vF0, add(zth, rf))
  const iA = add(iPre, div(mul(iF, zB), tot))
  const vA = sub(es, mul(zs, iA))
  return { iA, iF, vA, zApp: div(vA, iA), iPre }
}

/** The positive-sequence source impedances of the study system [pu]: behind A (G1 + T1), the remote grid, and line L1. */
export function sourceImpedances(opts: RouteOpts): { zs: Complex; zr: Complex | null; zl: Complex } {
  const m = sequenceModel(routeNetwork(opts))
  const g = m.sources.find((s) => s.id === 'G1')!
  const t1 = m.branches.find((b) => b.id === 'T1')!
  const gb = m.sources.find((s) => s.id === 'GB')
  return { zs: add(g.z1!, t1.z1), zr: gb ? gb.z1 : null, zl: m.branches.find((b) => b.id === 'L1')!.z1 }
}

// ── directional element (quadrature polarisation) ───────────────────────────────────────────────────────────────

/** Relay characteristic angle: the angle by which the operating current leads the polarising voltage at maximum torque [°] (typical: 30° or 45°). */
export const RCA0 = 45

export interface DirResult {
  /** Phase a element (I_a with V_bc) or phase b element (I_b with V_ca). */
  element: 'a' | 'b'
  iOp: Complex
  vPol: Complex
  /** Angle of I_op ahead of V_pol [°], in (−180, 180]. */
  angleDeg: number
  /** Torque ∝ |I||V|cos(angle − RCA) [pu]. */
  torque: number
  /** null = a quantity is too small to decide. */
  forward: boolean | null
  why: 'ok' | 'no-current' | 'no-voltage'
}

/**
 * The 90° (quadrature) connection: the phase-a element compares I_a with V_bc, which lags V_a by 90° in a balanced
 * system and is not collapsed by an earth fault on phase a. Forward ⇔ T = Re[I_op · V_pol* · e^(−jα)] > 0, i.e. the
 * current within ±90° of the line at α ahead of V_pol. Phase-b element (I_b, V_ca) for faults between b and c.
 */
export function directional(view: RelayView, type: FaultType, rcaDeg = RCA0): DirResult {
  const el = type === 'll' || type === 'dlg' ? 'b' : 'a'
  const [va, vb, vc] = view.vabc
  const iOp = el === 'a' ? view.iabc[0] : view.iabc[1]
  const vPol = el === 'a' ? sub(vb, vc) : sub(vc, va)
  const ang = ((arg(iOp) - arg(vPol)) * 180) / Math.PI
  const angleDeg = ang > 180 ? ang - 360 : ang <= -180 ? ang + 360 : ang
  const torque = mul(mul(iOp, conj(vPol)), polarDeg(1, -rcaDeg)).re
  const noI = loopAmps(iOp) < I_MIN_A
  const noV = abs(vPol) < 0.05 * Math.sqrt(3)
  return { element: el, iOp, vPol, angleDeg, torque, forward: noI || noV ? null : torque > 0, why: noI ? 'no-current' : noV ? 'no-voltage' : 'ok' }
}

/** A non-directional overcurrent relay's pick-up for comparison [A] (illustrative). */
export const OC_PICKUP_A = 400

// ── load encroachment ──────────────────────────────────────────────────────────────────────────────────────────

/** The heaviest load assumed for the check: L1's thermal rating (Module 4's data) at 0.9 pu voltage, power factor ≥ 0.85 (illustrative assumptions). */
export const LOAD_MVA = LINE_L1.ratingMva ?? 250
export const LOAD_VPU = 0.9
export const LOAD_PF = 0.85

/** Where a mho circle of reach Z_r crosses a ray at angle φ: |Z_r|·cos(θ_r − φ) (0 if the ray misses the circle). */
export const mhoReachAt = (reach: Complex, phiRad: number) => Math.max(0, abs(reach) * Math.cos(arg(reach) - phiRad))

export function loadCheck(zones: ZoneSettings) {
  const zMin = (LOAD_VPU * KV) ** 2 / LOAD_MVA
  const phi = Math.acos(LOAD_PF)
  const reach = reachOhm(Z1L, zones.reachPct[2])
  // the worst load angle inside ±φ is the one closest to the line angle (+φ for lagging export)
  const reachAtLoad = mhoReachAt(reach, phi)
  return { zMin, phiDeg: (phi * 180) / Math.PI, reachAtLoad, margin: zMin - reachAtLoad, encroaches: reachAtLoad >= zMin }
}

/** Pre-fault load impedance seen by R_A [Ω] (only with a power transfer), or null. */
export function preloadImpedance(opts: RouteOpts): Complex | null {
  if (!opts.infeed || opts.deltaDeg === 0) return null
  const m = sequenceModel(routeNetwork(opts))
  const v = prefaultVoltages(m, opts)
  if (!v) return null
  const a = m.busIds.indexOf('hvA')
  const b = m.busIds.indexOf('hvB')
  const i = div(sub(v[a], v[b]), div(Z1L, C(ZB)))
  return scale(div(v[a], i), ZB)
}

/** "fault on L1 at 84.0 km (70 % of L1)" */
export function whereText(km: number): string {
  if (km <= L1_KM) return `on L1, ${km.toFixed(1)} km from A (${((km / L1_KM) * 100).toFixed(1)} % of L1)`
  return `on L3, ${(km - L1_KM).toFixed(1)} km beyond B (${(((km - L1_KM) / L3_KM) * 100).toFixed(1)} % of L3)`
}
