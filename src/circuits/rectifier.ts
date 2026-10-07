import { sineSource } from '../simulation/source.ts'
import type { CircuitId, DiodeId, LoadType, RectifierTopology, ResolvedParams, SignalId, SignalValues } from '../types/simulation.ts'
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
  /** Element indices of R, L and C (−1 if absent). */
  kR: number
  kL: number
  kC: number
  vin: (t: number) => number
}

function buildNetlist(p: ResolvedParams): Built {
  const vin = sineSource(p).v
  const els: Element[] = []
  let nodes: number
  let P: number
  let N: number
  let diodeIds: DiodeId[]

  switch (p.topology) {
    case 'half-wave':
      // 1 = source +, 2 = cathode (P); the return is the reference node.
      els.push({ kind: 'V', id: 'Vs', a: 1, b: 0, value: vin })
      els.push({ kind: 'D', id: 'D1', a: 1, b: 2 })
      nodes = 2
      P = 2
      N = 0
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
      N = 0
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
      N = 0
      diodeIds = ['D1', 'D2', 'D3', 'D4']
      break
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
  const find = (id: string) => els.findIndex((e) => e.id === id)
  return { net: { nodes, elements: els }, P, N, M, diodeIds, kR: find('R'), kL: find('L'), kC: find('C'), vin }
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
function comboOrder(prev: number, count: number): number[] {
  const all = Array.from({ length: 1 << count }, (_, c) => c)
  const bits = (x: number) => {
    let k = 0
    for (; x; x &= x - 1) k++
    return k
  }
  return all.sort((x, y) => bits(x ^ prev) - bits(y ^ prev) || bits(x) - bits(y))
}
const orderCache = new Map<string, number[]>()
function orderFor(prev: number, count: number) {
  const key = `${prev}/${count}`
  let o = orderCache.get(key)
  if (!o) {
    o = comboOrder(prev, count)
    orderCache.set(key, o)
  }
  return o
}

export function signalsFor(topology: RectifierTopology, load: LoadType): SignalId[] {
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
}

/** Build the model for any topology × load. */
export function rectifierModel(topology: RectifierTopology, load: LoadType): CircuitModel<RectifierState> {
  const diodeCount = topology === 'half-wave' ? 1 : topology === 'center-tap' ? 2 : 4
  const hasL = load === 'RL' || load === 'RLC'
  const hasC = load === 'RC' || load === 'RLC'
  const signals = signalsFor(topology, load)

  const solveWith: CircuitModel<RectifierState>['solveWith'] = (p, state, t, h, combo) => {
    const b = built(p)
    const sol = solveNetlist(b.net, p.diode, state.storage, t, h, combo)
    if (!sol) return null
    const storage = sol.storage
    // With every diode open, the inductor's only path is broken: KCL already forces its
    // current to zero; pin it exactly so no floating-point residue is carried forward.
    if (hasL && combo === 0) storage.iL[0] = 0

    const els = b.net.elements
    const v = sol.v
    const iR = sol.i[b.kR]
    const vP = v[b.P]
    const vN = v[b.N]
    const values: SignalValues = {}
    values.vin = b.vin(t + h)
    values.vrect = vP - vN
    values.vout = load === 'RLC' ? v[b.M] - vN : vP - vN
    values.io = iR
    const d1 = sol.diodes[0]
    values.vd = d1.voltage
    values.id = d1.current
    if (sol.diodes.length > 1) {
      values.vd2 = sol.diodes[1].voltage
      values.id2 = sol.diodes[1].current
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
    let ps = 0
    let pd = 0
    els.forEach((e, k) => {
      if (e.kind === 'V') ps += (v[e.a] - v[e.b]) * -sol.i[k]
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
    diodeIds: ['D1', 'D2', 'D3', 'D4'].slice(0, diodeCount) as DiodeId[],

    initialState: () => ({
      storage: { iL: new Float64Array(hasL ? 1 : 0), vC: new Float64Array(hasC ? 1 : 0) },
      combo: 0,
    }),

    solveWith,

    step(p, state, t, h) {
      // Assumed-state method over the whole diode network: try combinations, nearest
      // to the present one first, and keep the first that is self-consistent.
      let best: ReturnType<typeof solveWith> = null
      for (const combo of orderFor(state.combo, diodeCount)) {
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
