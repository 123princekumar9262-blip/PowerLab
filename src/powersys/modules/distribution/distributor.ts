import { solveReal } from '../../engine/linalg.ts'

/*
 * Two-wire DC distributors — the classic textbook model, every number computed:
 *  · loads are constant currents (A) tapped at distances x from end A (m), plus an optional uniform load i (A/m);
 *  · each conductor has resistance r (Ω/km); current goes out on one conductor and back on the other, so a section
 *    of length ℓ has LOOP resistance 2·r·ℓ (the classic mistake is to use r·ℓ);
 *  · fed at one end (A), fed at both ends (V_A, V_B) or a ring main (fed at A, the ring closes back to A — the same
 *    as fed at both ends with equal voltages).
 * The method of section currents (this file's `solveDc`) is checked by an independent nodal conductance-matrix solve
 * (`nodalDc`).
 */

export type Feed = 'one' | 'both' | 'ring'
export const FEED_LABEL: Record<Feed, string> = { one: 'Fed at one end', both: 'Fed at both ends', ring: 'Ring main' }

export interface PointLoad {
  id: string
  /** Distance from end A [m]. */
  x: number
  /** Load current [A]. */
  I: number
}

export interface DcDistributor {
  /** Length A → B [m] (for a ring main: the length of the ring, opened out at the feed point). */
  L: number
  /** Resistance of EACH conductor [Ω/km]; the loop (go + return) is twice this. */
  rCond: number
  /** Voltage at the feed point A [V]. */
  VA: number
  /** Voltage at end B [V] (used only when fed at both ends). */
  VB: number
  feed: Feed
  loads: PointLoad[]
  /** Uniformly distributed load [A per metre of distributor] (0 = none). */
  i: number
}

export interface Section {
  x0: number
  x1: number
  /** Current just after x0 and just before x1, flowing from A towards B [A] (negative = towards A). */
  Iin: number
  Iout: number
  /** Loop resistance of the section [Ω]. */
  R: number
  /** Voltage drop V(x0) − V(x1) [V]. */
  drop: number
}

export interface DcNode {
  x: number
  V: number
  /** Concentrated load current at this point [A]. */
  load: number
  /** Ids of the loads at this point. */
  ids: string[]
}

export interface DcOk {
  ok: true
  /** Current supplied at A and at B (B = 0 when fed at one end) [A]. */
  IA: number
  IB: number
  /** VB actually used (= VA for a ring main; the computed end voltage when fed at one end). */
  VBused: number
  nodes: DcNode[]
  sections: Section[]
  /** The point of minimum potential: where the section current changes direction. */
  minX: number
  minV: number
  minKind: 'A' | 'load' | 'between' | 'end'
  /** Ids of the load(s) at the minimum point, when it is a load point. */
  minIds: string[]
  totalLoad: number
  /** Power lost in the two conductors [W]. */
  loss: number
  /** Voltage at any point x (0 ≤ x ≤ L) [V]. */
  V(x: number): number
  /** Current flowing at x (just after x) from A towards B [A]. */
  I(x: number): number
}
export interface DcErr {
  ok: false
  message: string
  field: 'load' | 'length' | 'resistance' | 'voltage' | 'uniform' | 'collapse'
}
export type DcResult = DcOk | DcErr

/** Loop resistance per metre [Ω/m] of a two-wire distributor whose conductors each have r Ω/km. */
export const loopPerM = (rCond: number) => (2 * rCond) / 1000

/** What is wrong with the inputs (null when valid). */
export function validateDc(d: DcDistributor): DcErr | null {
  if (!(d.L > 0) || !Number.isFinite(d.L)) return { ok: false, field: 'length', message: 'The distributor length must be a positive number of metres.' }
  if (!(d.rCond > 0) || !Number.isFinite(d.rCond)) return { ok: false, field: 'resistance', message: 'The conductor resistance must be a positive number of Ω/km.' }
  if (!(d.VA > 0) || !Number.isFinite(d.VA)) return { ok: false, field: 'voltage', message: 'The feeding voltage V_A must be positive.' }
  if (d.feed === 'both' && (!(d.VB > 0) || !Number.isFinite(d.VB))) return { ok: false, field: 'voltage', message: 'The feeding voltage V_B must be positive.' }
  if (!(d.i >= 0) || !Number.isFinite(d.i)) return { ok: false, field: 'uniform', message: 'The uniform loading cannot be negative.' }
  for (const l of d.loads) {
    if (!Number.isFinite(l.I) || l.I < 0) return { ok: false, field: 'load', message: `Load ${l.id}: a load current cannot be negative (${l.I} A). A source along the distributor is not modelled.` }
    if (!Number.isFinite(l.x) || l.x < 0) return { ok: false, field: 'load', message: `Load ${l.id}: its position must be at or after end A.` }
    if (l.x > d.L + 1e-9) return { ok: false, field: 'load', message: `Load ${l.id} at ${l.x} m lies beyond the end of the ${d.L} m distributor. Move it, or lengthen the distributor.` }
  }
  return null
}

/** Group loads at the same position into nodes; always include the ends 0 and L. */
function nodeList(d: DcDistributor): DcNode[] {
  const xs = [...new Set([0, d.L, ...d.loads.map((l) => l.x)])].sort((a, b) => a - b)
  return xs.map((x) => {
    const at = d.loads.filter((l) => l.x === x)
    return { x, V: NaN, load: at.reduce((s, l) => s + l.I, 0), ids: at.map((l) => l.id) }
  })
}

/** Current fed in at A [A], by taking moments of the loads about B (fed at both ends / ring). */
export function feedCurrentA(d: DcDistributor): number {
  const total = d.loads.reduce((s, l) => s + l.I, 0) + d.i * d.L
  if (d.feed === 'one') return total
  const VB = d.feed === 'ring' ? d.VA : d.VB
  const rl = loopPerM(d.rCond)
  const moments = d.loads.reduce((s, l) => s + l.I * (d.L - l.x), 0) + (d.i * d.L * d.L) / 2
  return (d.VA - VB + rl * moments) / (rl * d.L)
}

/** Solve the distributor by section currents: I_A from moments, then KCL along the line and V drops section by section. */
export function solveDc(d: DcDistributor): DcResult {
  const bad = validateDc(d)
  if (bad) return bad
  const rl = loopPerM(d.rCond)
  const nodes = nodeList(d)
  const IA = feedCurrentA(d)
  const totalLoad = d.loads.reduce((s, l) => s + l.I, 0) + d.i * d.L
  const sections: Section[] = []
  let I = IA - nodes[0].load // current just after A
  let V = d.VA
  nodes[0].V = V
  let loss = 0
  for (let k = 0; k < nodes.length - 1; k++) {
    const x0 = nodes[k].x
    const x1 = nodes[k + 1].x
    const len = x1 - x0
    const Iout = I - d.i * len
    const drop = rl * (I * len - (d.i * len * len) / 2)
    // ∫ I(s)² ds over the section, I(s) = I − i·s (exact for the linear current)
    loss += rl * (I * I * len - I * d.i * len * len + (d.i * d.i * len ** 3) / 3)
    sections.push({ x0, x1, Iin: I, Iout, R: rl * len, drop })
    V -= drop
    nodes[k + 1].V = V
    I = Iout - nodes[k + 1].load
  }
  const IB = d.feed === 'one' ? 0 : -I // what is left after the last node flows in from B
  const VBused = nodes[nodes.length - 1].V

  const curAt = (x: number) => {
    // current just after x
    let s = IA - d.i * x
    for (const l of d.loads) if (l.x <= x) s -= l.I
    return s
  }
  const Vat = (x: number) => {
    const xc = Math.min(Math.max(x, 0), d.L)
    let k = 0
    while (k < sections.length - 1 && sections[k].x1 < xc) k++
    const sec = sections[k]
    const t = xc - sec.x0
    return nodes[k].V - rl * (sec.Iin * t - (d.i * t * t) / 2)
  }

  // the point of minimum potential: the first place where the current stops flowing from A towards B
  const tol = 1e-9 * Math.max(1, totalLoad)
  let minX = d.L
  let minKind: DcOk['minKind'] = 'end'
  if (IA - nodes[0].load <= tol) {
    minX = 0
    minKind = 'A'
  } else {
    for (let k = 0; k < sections.length; k++) {
      const s = sections[k]
      if (s.Iout <= tol && s.Iin > tol && d.i > 0) {
        minX = s.x0 + s.Iin / d.i
        minKind = 'between'
        if (minX >= s.x1 - 1e-9) {
          minX = s.x1
          minKind = k + 1 === nodes.length - 1 ? 'end' : 'load'
        }
        break
      }
      const after = s.Iout - nodes[k + 1].load
      if (k + 1 < nodes.length - 1 && after <= tol) {
        minX = s.x1
        minKind = 'load'
        break
      }
    }
  }
  if (minKind === 'load' && nodes.find((n) => n.x === minX)?.load === 0) minKind = 'between'
  const minV = Vat(minX)
  if (!(minV > 0) || nodes.some((n) => !(n.V > 0)))
    return {
      ok: false,
      field: 'collapse',
      message: `The voltage would fall to ${minV <= 0 ? 'zero or below' : 'an impossible value'} along the distributor: these constant-current loads cannot be supplied. Reduce the loads or the conductor resistance.`,
    }
  const minIds = nodes.find((n) => Math.abs(n.x - minX) < 1e-9)?.ids ?? []
  return { ok: true, IA, IB, VBused, nodes, sections, minX, minV, minKind, minIds, totalLoad, loss, V: Vat, I: curAt }
}

/** Points (x, V) of the voltage profile, exact at every node and densely sampled where the profile is curved. */
export function profile(d: DcDistributor, r: DcOk, perSection = 24): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  for (const s of r.sections) {
    const n = d.i > 0 ? perSection : 1
    for (let k = 0; k <= n; k++) {
      const x = s.x0 + ((s.x1 - s.x0) * k) / n
      if (pts.length && Math.abs(pts[pts.length - 1][0] - x) < 1e-12) continue
      pts.push([x, r.V(x)])
    }
  }
  if (r.minKind === 'between') {
    pts.push([r.minX, r.minV])
    pts.sort((a, b) => a[0] - b[0])
  }
  return pts
}

// ── the second, independent method: nodal analysis with the conductance matrix ───────────────────────────────

export interface NodalResult {
  xs: number[]
  V: number[]
  /** Section currents from node k to node k+1, taken from the node voltages: (V_k − V_k+1)/R_k ... plus half the
   *  uniform load of the section (see below) — i.e. the current just after node k. */
  Iafter: number[]
  IA: number
  IB: number
  /** The node with the lowest voltage (the first one, when several are equal to 1e-9 relative). */
  minNode: number
  /** The conductance matrix and right-hand side that were solved (for display). */
  G: number[][]
  b: number[]
  free: number[]
}

/**
 * Nodal analysis: G·V = I_injected at every node whose voltage is not fixed by a source. Each section is a
 * conductance 1/(2rℓ); a uniform load on a section is represented by half its current at each end node — exact for
 * the node voltages, because the drop over a uniformly loaded section is R·(I_in − iℓ/2).
 */
export function nodalDc(d: DcDistributor): NodalResult | null {
  if (validateDc(d)) return null
  const rl = loopPerM(d.rCond)
  const nodes = nodeList(d)
  const n = nodes.length
  const xs = nodes.map((nd) => nd.x)
  const draw = nodes.map((nd) => nd.load)
  for (let k = 0; k < n - 1; k++) {
    const half = (d.i * (xs[k + 1] - xs[k])) / 2
    draw[k] += half
    draw[k + 1] += half
  }
  const g = xs.slice(0, -1).map((x, k) => {
    const len = xs[k + 1] - x
    return len > 0 ? 1 / (rl * len) : Infinity
  })
  const fixed = new Map<number, number>([[0, d.VA]])
  if (d.feed === 'both') fixed.set(n - 1, d.VB)
  if (d.feed === 'ring') fixed.set(n - 1, d.VA)
  const free = xs.map((_, k) => k).filter((k) => !fixed.has(k))
  const idx = new Map(free.map((k, j) => [k, j]))
  const G = free.map(() => free.map(() => 0))
  const b = free.map((k) => -draw[k])
  for (let k = 0; k < n - 1; k++) {
    const gk = g[k]
    if (!Number.isFinite(gk)) return null // two nodes at one point cannot happen (they are merged)
    for (const [p, q] of [
      [k, k + 1],
      [k + 1, k],
    ]) {
      const ip = idx.get(p)
      if (ip === undefined) continue
      G[ip][ip] += gk
      const iq = idx.get(q)
      if (iq !== undefined) G[ip][iq] -= gk
      else b[ip] += gk * fixed.get(q)!
    }
  }
  const sol = free.length ? solveReal(G, b) : []
  if (!sol) return null
  const V = xs.map((_, k) => (fixed.has(k) ? fixed.get(k)! : sol[idx.get(k)!]))
  // current just after node k = conductance current + the half of this section's uniform load drawn at node k... the
  // conductance current equals I_in − iℓ/2, so I_in = g(V_k − V_k+1) + iℓ/2
  const Iafter = xs.slice(0, -1).map((x, k) => g[k] * (V[k] - V[k + 1]) + (d.i * (xs[k + 1] - x)) / 2)
  const IA = Iafter[0] + nodes[0].load
  const IB = d.feed === 'one' ? 0 : -(Iafter[n - 2] - d.i * (xs[n - 1] - xs[n - 2])) + nodes[n - 1].load
  const vmin = Math.min(...V)
  const minNode = V.findIndex((v) => v - vmin <= 1e-9 * Math.max(1, Math.abs(vmin)))
  return { xs, V, Iafter, IA, IB, minNode, G, b, free }
}

/** The same distributor with its uniform load replaced by N concentrated loads i·L/N at x = L/N, 2L/N, …, L. */
export function discretiseUniform(d: DcDistributor, N: number): DcDistributor {
  const extra: PointLoad[] = Array.from({ length: N }, (_, k) => ({ id: `u${k + 1}`, x: ((k + 1) * d.L) / N, I: (d.i * d.L) / N }))
  return { ...d, i: 0, loads: [...d.loads, ...extra] }
}

/** Closed forms for a distributor fed at one end with only a uniform load i: drop at x and total drop. */
export const uniformDropAt = (i: number, rLoopPerM: number, L: number, x: number) => i * rLoopPerM * (L * x - (x * x) / 2)
export const uniformTotalDrop = (i: number, rLoopPerM: number, L: number) => (i * rLoopPerM * L * L) / 2

/** Conductor cross-section [mm²] that gives a resistance of r Ω/km for a resistivity ρ [Ω·mm²/m]. */
export const areaFor = (rCondPerKm: number, rho: number) => (rho * 1000) / rCondPerKm

/** Resistivities at 20 °C [Ω·mm²/m] (annealed copper 1.72 × 10⁻⁸ Ω·m; hard-drawn aluminium about 2.82 × 10⁻⁸ Ω·m). */
export const RHO = { copper: 0.0172, aluminium: 0.0282 }

/** The default case (illustrative values): a 400 m two-wire 220 V DC distributor with four loads. */
export function defaultDc(feed: Feed = 'one'): DcDistributor {
  return {
    L: 400,
    rCond: 0.1,
    VA: 220,
    VB: 220,
    feed,
    i: 0,
    loads: [
      { id: 'L1', x: 100, I: 50 },
      { id: 'L2', x: 200, I: 40 },
      { id: 'L3', x: 300, I: 60 },
      { id: 'L4', x: 350, I: 30 },
    ],
  }
}
