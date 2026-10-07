import { sineSource, threePhaseSource, type Phase } from '../simulation/source.ts'
import {
  isThreePhase,
  type CircuitId,
  type DiodeId,
  type LoadType,
  type RectifierTopology,
  type ResolvedParams,
  type SignalId,
  type SignalValues,
} from '../types/simulation.ts'
import type { CircuitModel, ModelState } from './circuitModel.ts'
import { biasOf, solveNetlist, type Element, type Netlist, type StorageState } from './netlist.ts'

export interface RectifierState extends ModelState {
  storage: StorageState
}

/** Node indices of the rectifier's DC output (+ = P, − = N) and the netlist. */
interface Built {
  net: Netlist
  P: number
  N: number
  /** Node between L and the rest of the load (RL, RLC). */
  M: number
  diodeIds: DiodeId[]
  /** Combination bits that can never be ON (open / shorted diodes). */
  fixedOff: number
  /** True if a shorted diode keeps a path closed even with every other diode off. */
  hasShort: boolean
  /** Element indices of R, load L and C (−1 if absent). */
  kR: number
  kL: number
  kC: number
  /** Reference source voltage: vin (single-phase) or VaN (three-phase). */
  vin: (t: number) => number
  /** Three-phase EMFs (three-phase circuits only). */
  phase?: (x: Phase, t: number) => number
}

/** Large resistance that keeps a disconnected phase conductor's node defined [Ω]. */
const OPEN_PHASE_R = 1e9

function buildNetlist(p: ResolvedParams): Built {
  const els: Element[] = []
  let nodes = 0
  let P = 0
  let N = 0
  let diodeIds: DiodeId[] = []
  let vin = sineSource(p).v
  let phaseFn: Built['phase']

  switch (p.topology) {
    case 'half-wave':
      // 1 = source +, 2 = cathode (P); the return is the reference node.
      els.push({ kind: 'V', id: 'Vs', a: 1, b: 0, value: vin })
      els.push({ kind: 'D', id: 'D1', a: 1, b: 2 })
      nodes = 2
      P = 2
      diodeIds = ['D1']
      break
    case 'center-tap':
      // Center tap = reference. Upper winding: v1 = +vin. Lower winding: v2 = −vin.
      els.push({ kind: 'V', id: 'Vs1', a: 1, b: 0, value: vin })
      els.push({ kind: 'V', id: 'Vs2', a: 0, b: 2, value: vin })
      els.push({ kind: 'D', id: 'D1', a: 1, b: 3 })
      els.push({ kind: 'D', id: 'D2', a: 2, b: 3 })
      nodes = 3
      P = 3
      diodeIds = ['D1', 'D2']
      break
    case 'bridge':
      // AC inputs a = 1, b = 2; DC output p = 3 (+); the − output n is the reference node.
      els.push({ kind: 'V', id: 'Vs', a: 1, b: 2, value: vin })
      els.push({ kind: 'D', id: 'D1', a: 1, b: 3 }) // a → p
      els.push({ kind: 'D', id: 'D2', a: 2, b: 3 }) // b → p
      els.push({ kind: 'D', id: 'D3', a: 0, b: 1 }) // n → a
      els.push({ kind: 'D', id: 'D4', a: 0, b: 2 }) // n → b
      // With all four diodes OFF the source floats: pin its potential symmetrically.
      els.push({ kind: 'REF', id: 'Ref', a: 1, b: 2, p: 3, n: 0 })
      nodes = 3
      P = 3
      diodeIds = ['D1', 'D2', 'D3', 'D4']
      break
    default: {
      const b = buildThreePhase(p, els)
      nodes = b.nodes
      P = b.P
      N = b.N
      diodeIds = b.diodeIds
      vin = b.vin
      phaseFn = b.phase
    }
  }

  let M = P
  const R = p.resistance
  switch (p.load) {
    case 'R':
      els.push({ kind: 'R', id: 'R', a: P, b: N, r: R })
      break
    case 'RL':
      M = ++nodes
      els.push({ kind: 'L', id: 'L', a: P, b: M, l: p.inductance })
      els.push({ kind: 'R', id: 'R', a: M, b: N, r: R })
      break
    case 'RC':
      els.push({ kind: 'C', id: 'C', a: P, b: N, c: p.capacitance })
      els.push({ kind: 'R', id: 'R', a: P, b: N, r: R })
      break
    case 'RLC':
      M = ++nodes
      els.push({ kind: 'L', id: 'L', a: P, b: M, l: p.inductance })
      els.push({ kind: 'C', id: 'C', a: M, b: N, c: p.capacitance })
      els.push({ kind: 'R', id: 'R', a: M, b: N, r: R })
      break
  }
  // Freewheeling diode across the whole load (three-phase option): anode at −, cathode at +.
  if (isThreePhase(p.topology) && p.control.freewheel) {
    els.push({ kind: 'D', id: 'Dfw', a: N, b: P })
    diodeIds = [...diodeIds, 'Dfw']
  }

  // Apply faults to the diode elements and note which combination bits are fixed.
  let fixedOff = 0
  let hasShort = false
  let k = 0
  for (const e of els) {
    if (e.kind !== 'D') continue
    if (p.faults.diode?.id === e.id) {
      e.fault = p.faults.diode.kind
      fixedOff |= 1 << k
      if (e.fault === 'short') hasShort = true
    }
    if (p.faults.vfOverride?.id === e.id && p.diode.kind !== 'ideal') e.vf = p.faults.vfOverride.vf
    k++
  }

  const find = (id: string) => els.findIndex((e) => e.id === id)
  return { net: { nodes, elements: els }, P, N, M, diodeIds, fixedOff, hasShort, kR: find('R'), kL: find('L'), kC: find('C'), vin, phase: phaseFn }
}

/**
 * Three-phase netlists.
 *
 *   3ph-half-wave (3-pulse midpoint): neutral = reference; Da, Db, Dc from each phase to P;
 *     the load returns to the neutral. The diode whose phase is highest conducts.
 *   3ph-bridge (6-pulse): reference = DC − rail. Standard numbering, conduction sequence
 *     D1D2 → D2D3 → D3D4 → D4D5 → D5D6 → D6D1:
 *       upper (to +):  D1 phase a, D3 phase b, D5 phase c
 *       lower (from −): D4 phase a, D6 phase b, D2 phase c
 *     The source neutral floats; when every diode is off a REF constraint pins it midway.
 *   3ph-half-controlled: as the bridge, with SCRs on top and diodes below.
 * Optional source impedance Rs + Ls sits in series with each phase.
 */
function buildThreePhase(p: ResolvedParams, els: Element[]) {
  const src = threePhaseSource(p)
  const halfWave = p.topology === '3ph-half-wave'
  let nodes = 0
  const NEUTRAL = halfWave ? 0 : ++nodes // half-wave: the neutral is the load return
  const phases: Phase[] = ['a', 'b', 'c']
  const phaseNode: Record<Phase, number> = { a: 0, b: 0, c: 0 }
  const { rs, ls } = p.threePhase
  for (const x of phases) {
    let at = ++nodes
    if (p.faults.missingPhase === x) {
      // Disconnected phase conductor: no source; a 1 GΩ leak keeps the node defined.
      els.push({ kind: 'R', id: `Rleak${x}`, a: at, b: NEUTRAL, r: OPEN_PHASE_R })
      phaseNode[x] = at
      continue
    }
    els.push({ kind: 'V', id: `V${x}`, a: at, b: NEUTRAL, value: (t) => src.phase(x, t) })
    if (rs > 0) {
      const next = ++nodes
      els.push({ kind: 'R', id: `Rs${x}`, a: at, b: next, r: rs })
      at = next
    }
    if (ls > 0) {
      const next = ++nodes
      els.push({ kind: 'L', id: `Ls${x}`, a: at, b: next, l: ls })
      at = next
    }
    phaseNode[x] = at
  }
  const P = ++nodes
  const scr = p.control.device === 'scr'
  const alphaDeg = (p.control.alpha * 180) / Math.PI
  // Gate pulses: each SCR is fired α after its natural commutation instant — the moment its
  // phase becomes the highest (upper / half-wave: phase angle 30°) or lowest (lower: 210°).
  // Wide (120°) pulses keep the incoming partner gated, so discontinuous current re-starts.
  const gateFor = (x: Phase, natural: number) => (t: number) => {
    const d = (((src.phaseAngleDeg(x, t) - natural - alphaDeg) % 360) + 360) % 360
    return d < 120
  }

  let diodeIds: DiodeId[]
  if (halfWave) {
    const ids: Record<Phase, DiodeId> = { a: 'Da', b: 'Db', c: 'Dc' }
    for (const x of phases) els.push({ kind: 'D', id: ids[x], a: phaseNode[x], b: P, gate: scr ? gateFor(x, 30) : undefined })
    diodeIds = ['Da', 'Db', 'Dc']
    return { nodes, P, N: 0, diodeIds, vin: (t: number) => src.phase('a', t), phase: src.phase }
  }
  const upperScr = scr || p.topology === '3ph-half-controlled'
  const lowerScr = scr && p.topology === '3ph-bridge'
  // Element order = combination bit order = D1…D6.
  const bridge: Array<{ id: DiodeId; x: Phase; upper: boolean }> = [
    { id: 'D1', x: 'a', upper: true },
    { id: 'D2', x: 'c', upper: false },
    { id: 'D3', x: 'b', upper: true },
    { id: 'D4', x: 'a', upper: false },
    { id: 'D5', x: 'c', upper: true },
    { id: 'D6', x: 'b', upper: false },
  ]
  for (const d of bridge) {
    if (d.upper) els.push({ kind: 'D', id: d.id, a: phaseNode[d.x], b: P, gate: upperScr ? gateFor(d.x, 30) : undefined })
    else els.push({ kind: 'D', id: d.id, a: 0, b: phaseNode[d.x], gate: lowerScr ? gateFor(d.x, 210) : undefined })
  }
  els.push({ kind: 'REF', id: 'Ref', a: NEUTRAL, b: NEUTRAL, p: P, n: 0, watch: [phaseNode.a, phaseNode.b, phaseNode.c] })
  diodeIds = bridge.map((d) => d.id)
  return { nodes, P, N: 0, diodeIds, vin: (t: number) => src.phase('a', t), phase: src.phase }
}

const builtCache = new WeakMap<ResolvedParams, Built>()
function built(p: ResolvedParams): Built {
  let b = builtCache.get(p)
  if (!b) {
    b = buildNetlist(p)
    builtCache.set(p, b)
  }
  return b
}

/** Diode combinations ordered by distance from `prev` (fewest diodes flipped, then fewest ON). */
function comboOrder(prev: number, count: number, fixedOff: number): number[] {
  const all = Array.from({ length: 1 << count }, (_, c) => c).filter((c) => (c & fixedOff) === 0)
  const bits = (x: number) => {
    let k = 0
    for (; x; x &= x - 1) k++
    return k
  }
  return all.sort((x, y) => bits(x ^ prev) - bits(y ^ prev) || bits(x) - bits(y))
}
const orderCache = new Map<string, number[]>()
function orderFor(prev: number, count: number, fixedOff: number) {
  const key = `${prev}/${count}/${fixedOff}`
  let o = orderCache.get(key)
  if (!o) {
    o = comboOrder(prev, count, fixedOff)
    orderCache.set(key, o)
  }
  return o
}

export function signalsFor(topology: RectifierTopology, load: LoadType): SignalId[] {
  if (isThreePhase(topology)) {
    const s: SignalId[] = ['vin', 'vb', 'vc', 'vab', 'vbc', 'vca']
    if (load === 'RLC') s.push('vrect')
    s.push('vout', 'vd')
    if (load === 'RL' || load === 'RLC') s.push('vl')
    s.push('io', 'id', 'id2', 'id3')
    if (topology !== '3ph-half-wave') s.push('id4', 'id5', 'id6')
    if (load === 'RLC') s.push('il')
    if (load === 'RC' || load === 'RLC') s.push('ic')
    if (load === 'RL' || load === 'RLC') s.push('wl')
    if (load === 'RC' || load === 'RLC') s.push('wc')
    s.push('ps', 'pload', 'pd')
    return s
  }
  const fw = topology !== 'half-wave'
  const s: SignalId[] = ['vin']
  if (load === 'RLC') s.push('vrect')
  s.push('vout', 'vd')
  if (fw) s.push('vd2')
  if (load === 'RL' || load === 'RLC') s.push('vl')
  s.push('io', 'id')
  if (fw) s.push('id2')
  if (load === 'RLC') s.push('il')
  if (load === 'RC' || load === 'RLC') s.push('ic')
  if (load === 'RL' || load === 'RLC') s.push('wl')
  if (load === 'RC' || load === 'RLC') s.push('wc')
  s.push('ps', 'pload', 'pd')
  return s
}

const TOPOLOGY_NAMES: Record<RectifierTopology, string> = {
  'half-wave': 'Half-wave rectifier',
  'center-tap': 'Full-wave center-tap rectifier',
  bridge: 'Full-wave bridge rectifier',
  '3ph-half-wave': 'Three-phase half-wave (3-pulse) rectifier',
  '3ph-bridge': 'Three-phase bridge (6-pulse) rectifier',
  '3ph-half-controlled': 'Three-phase half-controlled bridge',
}

export function topologyName(t: RectifierTopology): string {
  return TOPOLOGY_NAMES[t]
}

const DIODE_SIGNALS: SignalId[] = ['id', 'id2', 'id3', 'id4', 'id5', 'id6']

/** Diode ids for a parameter set (the freewheeling diode and topology decide the count). */
export function diodeIdsFor(p: ResolvedParams): DiodeId[] {
  return built(p).diodeIds
}

/** Build the model for any topology × load. */
export function rectifierModel(topology: RectifierTopology, load: LoadType): CircuitModel<RectifierState> {
  const hasL = load === 'RL' || load === 'RLC'
  const hasC = load === 'RC' || load === 'RLC'
  const signals = signalsFor(topology, load)
  const threePh = isThreePhase(topology)
  const staticIds: DiodeId[] = threePh
    ? topology === '3ph-half-wave'
      ? ['Da', 'Db', 'Dc']
      : ['D1', 'D2', 'D3', 'D4', 'D5', 'D6']
    : (['D1', 'D2', 'D3', 'D4'].slice(0, topology === 'half-wave' ? 1 : topology === 'center-tap' ? 2 : 4) as DiodeId[])

  const solveWith: CircuitModel<RectifierState>['solveWith'] = (p, state, t, h, combo) => {
    const b = built(p)
    const sol = solveNetlist(b.net, p.diode, state.storage, t, h, combo, state.combo)
    if (!sol) return null
    const storage = sol.storage
    // With every diode open (and no shorted diode), every inductor sits in a broken loop:
    // KCL already forces its current to zero; pin it exactly so no residue is carried forward.
    if (combo === 0 && !b.hasShort) storage.iL.fill(0)

    const els = b.net.elements
    const v = sol.v
    const iR = sol.i[b.kR]
    const vP = v[b.P]
    const vN = v[b.N]
    const values: SignalValues = {}
    const tt = t + h
    values.vin = b.vin(tt)
    if (b.phase) {
      const va = b.phase('a', tt)
      const vb = b.phase('b', tt)
      const vc = b.phase('c', tt)
      values.vb = vb
      values.vc = vc
      values.vab = va - vb
      values.vbc = vb - vc
      values.vca = vc - va
    }
    values.vrect = vP - vN
    values.vout = load === 'RLC' ? v[b.M] - vN : vP - vN
    values.io = iR
    values.vd = sol.diodes[0].voltage
    if (threePh) {
      sol.diodes.slice(0, 6).forEach((d, k) => {
        if (d.id !== 'Dfw') values[DIODE_SIGNALS[k]] = d.current
      })
    } else {
      values.id = sol.diodes[0].current
      if (sol.diodes.length > 1) {
        values.vd2 = sol.diodes[1].voltage
        values.id2 = sol.diodes[1].current
      }
    }
    if (hasL) {
      const iL = sol.i[b.kL]
      values.vl = vP - v[b.M]
      values.il = iL
      values.wl = 0.5 * p.inductance * iL * iL // energy in the magnetic field, ½·L·i²
    }
    if (hasC) {
      const k = b.kC
      const ce = els[k] as Extract<Element, { kind: 'C' }>
      const vC = v[ce.a] - v[ce.b]
      values.ic = sol.i[k]
      values.wc = 0.5 * p.capacitance * vC * vC // energy in the electric field, ½·C·v²
    }
    // Power: a source delivers V·(current leaving its + terminal) = V·(−i_branch).
    // Source impedance (Rs, Ls) losses/storage are counted with the diodes' path elements below.
    let ps = 0
    let pd = 0
    els.forEach((e, k) => {
      if (e.kind === 'V') ps += (v[e.a] - v[e.b]) * -sol.i[k]
      if (e.kind === 'R' && e.id !== 'R') pd += sol.i[k] * sol.i[k] * e.r // source resistance / leak
      if (e.kind === 'L' && e.id !== 'L') pd += (v[e.a] - v[e.b]) * sol.i[k] // source inductance (stored/returned)
    })
    for (const d of sol.diodes) pd += d.voltage * d.current
    values.ps = ps
    values.pload = iR * iR * p.resistance
    values.pd = pd

    return {
      solution: {
        signals: values,
        diodes: sol.diodes.map((d) => ({ ...d, bias: biasOf(d.on, d.voltage) })),
      },
      state: { storage, combo },
      consistent: sol.consistent,
      violation: sol.violation,
    }
  }

  return {
    id: `${topology}:${load}` as CircuitId,
    name: `${TOPOLOGY_NAMES[topology]} · ${load} load`,
    topology,
    load,
    signals,
    diodeIds: staticIds,
    diodeIdsFor,

    initialState: (p) => {
      const nL = built(p).net.elements.filter((e) => e.kind === 'L').length
      return { storage: { iL: new Float64Array(nL), vC: new Float64Array(hasC ? 1 : 0) }, combo: 0 }
    },

    solveWith,

    step(p, state, t, h) {
      // Assumed-state method over the whole diode network: try combinations, nearest
      // to the present one first, and keep the first that is self-consistent.
      const b = built(p)
      let best: ReturnType<typeof solveWith> = null
      for (const combo of orderFor(state.combo, b.diodeIds.length, b.fixedOff)) {
        const r = solveWith(p, state, t, h, combo)
        if (!r) continue
        if (r.consistent) return { ...r, fallback: false }
        if (!best || r.violation < best.violation) best = r
      }
      // No exactly consistent combination (only possible at a floating-point boundary):
      // use the least-violating one and let the engine count it.
      if (!best) throw new Error('No solvable diode combination')
      return { ...best, fallback: true }
    },
  }
}
