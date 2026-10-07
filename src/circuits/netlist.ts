import { solveDense } from '../solvers/linear.ts'
import type { DiodeBias, DiodeId, DiodeModel } from '../types/simulation.ts'

/**
 * A circuit as a list of two-terminal elements between numbered nodes (0 = reference).
 * Every element's current is defined flowing a → b THROUGH the element.
 */
export type Element =
  | { kind: 'V'; id: string; a: number; b: number; value: (t: number) => number } // va − vb = value(t)
  | { kind: 'R'; id: string; a: number; b: number; r: number }
  | { kind: 'L'; id: string; a: number; b: number; l: number } // state: current a → b
  | { kind: 'C'; id: string; a: number; b: number; c: number } // state: voltage va − vb
  | {
      kind: 'D'
      id: DiodeId
      a: number // anode
      b: number // cathode
      /** Per-device forward voltage (e.g. a mismatched diode); defaults to the diode model's Vf. */
      vf?: number
      /**
       * Present for an SCR: is the gate pulse applied at time t? An SCR can only START
       * conducting while gated; once conducting it latches and behaves as a diode until
       * its current falls to zero.
       */
      gate?: (t: number) => boolean
      /** Fault: 'open' never conducts; 'short' is a 1 mΩ path in both directions. */
      fault?: 'open' | 'short'
    }
  /**
   * Potential reference for a sub-circuit that can float. When no ON diode touches
   * nodes a or b, the a–b sub-circuit (e.g. a bridge's AC source) is disconnected from
   * everything else and its absolute potential is undefined. Then KCL at `a` (redundant
   * in that state) is replaced by the symmetric constraint  va + vb = vp + vn,
   * which carries no current. Each blocking diode then shares the voltage, as in a real bridge.
   * `watch` lists the nodes whose diodes connect the floating part (default: a and b). For a
   * three-phase bridge a = b = the source neutral and `watch` = the three phase nodes, giving
   * vN = (vp + vn)/2 while every diode is off.
   */
  | { kind: 'REF'; id: string; a: number; b: number; p: number; n: number; watch?: number[] }

export interface Netlist {
  /** Number of nodes excluding the reference node 0. */
  nodes: number
  elements: Element[]
}

/** A shorted diode is modelled as this resistance in both directions [Ω]. */
export const SHORT_FAULT_R = 1e-3

/** Energy-storage state: one entry per L (its current) and per C (its voltage), in element order. */
export interface StorageState {
  iL: Float64Array
  vC: Float64Array
}

export interface NetlistSolution {
  /** Node voltages; index 0 is the reference (0 V). */
  v: Float64Array
  /** Current through each element (a → b), indexed like `elements`. */
  i: Float64Array
  diodes: Array<{ id: DiodeId; on: boolean; current: number; voltage: number; gate?: boolean }>
  storage: StorageState
  /** True if every diode satisfies its assumed state (ON: i > 0, OFF: v ≤ Vf). */
  consistent: boolean
  /** How badly the assumption is violated (0 when consistent); used only as a last resort. */
  violation: number
}

/**
 * Solve the network at time t + h, from storage state at time t, with the diode
 * ON/OFF combination held fixed (bit k of `combo` = diode k ON).
 *
 * Modified nodal analysis. Unknowns: node voltages, plus a branch current for every
 * voltage source, inductor, capacitor and ON diode. Branch equations:
 *   source      va − vb = V(t+h)
 *   ON diode    va − vb − Ron·i = Vf                (piecewise-linear diode, ON segment)
 *   OFF diode   (no element: an open circuit)
 *   inductor    i − (h/L)·(va − vb) = iL(t)         (backward Euler of L·di/dt = v)
 *   capacitor   (va − vb) − (h/C)·i = vC(t)         (backward Euler of C·dv/dt = i)
 * Backward Euler is used because it is L-stable: a diode switching an inductor or
 * capacitor never produces the numerical ringing the trapezoidal rule would.
 * With h = 0 the inductor is a current source iL(t) and the capacitor a voltage source vC(t)
 * — the correct instantaneous picture.
 */
export function solveNetlist(
  net: Netlist,
  diode: DiodeModel,
  state: StorageState,
  t: number,
  h: number,
  combo: number,
  /** Diode combination at the start of the step — an SCR that was conducting stays latched. */
  prevCombo: number = combo,
): NetlistSolution | null {
  const { elements } = net
  const nn = net.nodes
  // Assign branch-current unknowns.
  const branchOf = new Int32Array(elements.length).fill(-1)
  let impossible = false
  let nb = 0
  let dk = 0
  elements.forEach((e, k) => {
    if (e.kind === 'V' || e.kind === 'L' || e.kind === 'C') branchOf[k] = nb++
    else if (e.kind === 'D') {
      // A shorted diode is stamped as a resistor (no branch unknown); an open one never conducts.
      if (combo & (1 << dk) && e.fault !== 'short') {
        if (e.fault === 'open') impossible = true
        branchOf[k] = nb++
      }
      dk++
    }
  })
  if (impossible) return null
  const n = nn + nb
  const A = new Float64Array(n * n)
  const rhs = new Float64Array(n)
  const at = (r: number, c: number, v: number) => {
    A[r * n + c] += v
  }
  const node = (x: number) => x - 1 // matrix row of node x (node 0 has no row)

  let li = 0
  let ci = 0
  elements.forEach((e, k) => {
    switch (e.kind) {
      case 'R': {
        const g = 1 / e.r
        if (e.a) at(node(e.a), node(e.a), g)
        if (e.b) at(node(e.b), node(e.b), g)
        if (e.a && e.b) {
          at(node(e.a), node(e.b), -g)
          at(node(e.b), node(e.a), -g)
        }
        break
      }
      case 'REF':
        break // applied after all stamps (it replaces a row)
      case 'V':
      case 'L':
      case 'C':
      case 'D': {
        if (e.kind === 'D' && e.fault === 'short') {
          // A shorted diode: a 1 mΩ conductance in both directions.
          const g = 1 / SHORT_FAULT_R
          if (e.a) at(node(e.a), node(e.a), g)
          if (e.b) at(node(e.b), node(e.b), g)
          if (e.a && e.b) {
            at(node(e.a), node(e.b), -g)
            at(node(e.b), node(e.a), -g)
          }
          break
        }
        const br = branchOf[k]
        if (br < 0) break // OFF diode: open circuit
        const row = nn + br
        // KCL: branch current leaves node a, enters node b.
        if (e.a) at(node(e.a), row, 1)
        if (e.b) at(node(e.b), row, -1)
        // Branch equation in terms of (va − vb).
        const vab = (coef: number) => {
          if (e.a) at(row, node(e.a), coef)
          if (e.b) at(row, node(e.b), -coef)
        }
        if (e.kind === 'V') {
          vab(1)
          rhs[row] = e.value(t + h)
        } else if (e.kind === 'D') {
          vab(1)
          at(row, row, -diode.ron)
          rhs[row] = e.vf ?? diode.vf
        } else if (e.kind === 'L') {
          at(row, row, 1)
          vab(-h / e.l)
          rhs[row] = state.iL[li]
        } else {
          vab(1)
          at(row, row, -h / e.c)
          rhs[row] = state.vC[ci]
        }
        break
      }
    }
    if (e.kind === 'L') li++
    if (e.kind === 'C') ci++
  })

  // Floating-reference constraints (see the REF element).
  let dIdx = 0
  const onNodes = new Set<number>()
  elements.forEach((e) => {
    if (e.kind !== 'D') return
    if (combo & (1 << dIdx) || e.fault === 'short') {
      onNodes.add(e.a)
      onNodes.add(e.b)
    }
    dIdx++
  })
  for (const e of elements) {
    if (e.kind !== 'REF' || (e.watch ?? [e.a, e.b]).some((q) => onNodes.has(q))) continue
    const row = node(e.a)
    for (let c = 0; c < n; c++) A[row * n + c] = 0
    const add = (q: number, coef: number) => {
      if (q) A[row * n + node(q)] += coef
    }
    add(e.a, 1)
    add(e.b, 1)
    add(e.p, -1)
    add(e.n, -1)
    rhs[row] = 0
  }

  const x = solveDense(A, rhs, n)
  if (!x) return null

  const v = new Float64Array(nn + 1)
  for (let q = 1; q <= nn; q++) v[q] = x[q - 1]
  const i = new Float64Array(elements.length)
  const iL = new Float64Array(state.iL.length)
  const vC = new Float64Array(state.vC.length)
  const diodes: NetlistSolution['diodes'] = []
  let violation = 0
  li = 0
  ci = 0
  dk = 0
  elements.forEach((e, k) => {
    if (e.kind === 'REF') return
    const vab = v[e.a] - v[e.b]
    if (e.kind === 'R') i[k] = vab / e.r
    else if (e.kind === 'D' && e.fault === 'short') i[k] = vab / SHORT_FAULT_R
    else if (branchOf[k] >= 0) i[k] = x[nn + branchOf[k]]
    if (e.kind === 'L') iL[li++] = i[k]
    if (e.kind === 'C') vC[ci++] = vab
    if (e.kind === 'D') {
      const bit = 1 << dk
      dk++
      if (e.fault === 'short') {
        diodes.push({ id: e.id, on: true, current: i[k], voltage: vab })
        return
      }
      const on = (combo & bit) !== 0
      const vf = e.vf ?? diode.vf
      // Consistency of the assumed state:
      //   ON  is valid only if the diode current is forward (i > 0)
      //   OFF is valid only if the diode voltage does not exceed its knee (v ≤ Vf)
      // SCR: it may only turn ON while gated (or if it was already conducting — latching),
      //   and while un-gated and not conducting it may block a FORWARD voltage.
      const gated = e.gate ? e.gate(t + h) : true
      const wasOn = (prevCombo & bit) !== 0
      if (on && !(i[k] > 0)) violation += Math.abs(i[k]) + 1e-30
      if (on && !gated && !wasOn) violation += 1
      const canBlockForward = e.gate !== undefined && !gated && !wasOn
      if (!on && vab > vf && !canBlockForward && e.fault !== 'open') violation += vab - vf
      diodes.push({ id: e.id, on, current: on ? i[k] : 0, voltage: vab, gate: e.gate ? gated : undefined })
    }
  })
  return { v, i, diodes, storage: { iL, vC }, consistent: violation === 0, violation }
}

/** Bias classification for display, from the solved state and voltage. */
export function biasOf(on: boolean, voltage: number): DiodeBias {
  if (on) return 'forward-conducting'
  if (voltage > 0) return 'forward-below-threshold'
  if (voltage < 0) return 'reverse'
  return 'zero'
}
