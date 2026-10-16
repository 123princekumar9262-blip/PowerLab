import { rampWave, surgeValue, type Analysis, type SepCase } from './waves.ts'

/*
 * The independent time-domain method: the method of characteristics (Bergeron) on a uniform grid of N sections,
 * stepping node voltages AND currents in time. Along dx/dt = +v the quantity v + Z_c·i is constant; along
 * dx/dt = −v, v − Z_c·i is constant. With Δt = Δx/v (Courant number 1) the characteristics run exactly from node to
 * node, so for a lossless uniform line the method has no discretisation error at the grid points — only rounding.
 *
 * It shares no code with the wave-function / lattice solution in waves.ts: here every node of the line is stored and
 * updated, the boundaries are solved node by node (source with R_s, resistive end, ideal-clamp arresters at any node).
 * Units: kV, kA inside (kV/Ω), µs, m.
 */

export interface GridConfig {
  /** Number of sections and their length [m]. */
  n: number
  dx: number
  zc: number
  /** Velocity [m/µs]. */
  v: number
  /** Source e(t) [kV] behind R_s [Ω] at node 0. */
  e(t: number): number
  rs: number
  /** Load at node n [Ω] (Infinity = open, 0 = short). */
  zl: number
  /** Ideal-clamp arresters: node index → residual voltage [kV]. */
  clamps?: Record<number, number>
  /** Steps to run (each Δt = dx/v). */
  steps: number
  /** Nodes to record. */
  record: number[]
}

export interface GridRun {
  dt: number
  t: number[]
  /** Recorded node voltages [kV] and currents just to the left of the node, + towards node n [A]. */
  v: Record<number, number[]>
  i: Record<number, number[]>
  /** Arrester currents at the clamped nodes [A]. */
  iArr: Record<number, number[]>
}

export function bergeronGrid(c: GridConfig): GridRun {
  const { n, zc } = c
  const dt = c.dx / c.v
  const clamps = c.clamps ?? {}
  let v = new Float64Array(n + 1)
  let iL = new Float64Array(n + 1) // current arriving from the left side of the node
  let iR = new Float64Array(n + 1) // current leaving on the right side of the node
  let nv = new Float64Array(n + 1)
  let niL = new Float64Array(n + 1)
  let niR = new Float64Array(n + 1)
  const out: GridRun = { dt, t: [], v: {}, i: {}, iArr: {} }
  for (const j of c.record) {
    out.v[j] = []
    out.i[j] = []
  }
  for (const j of Object.keys(clamps)) out.iArr[Number(j)] = []
  const clampAt = (j: number, v0: number) => {
    const r = clamps[j]
    return r !== undefined && Math.abs(v0) > r ? Math.sign(v0) * r : v0
  }
  for (let s = 0; s <= c.steps; s++) {
    const t = s * dt
    for (let j = 0; j <= n; j++) {
      // characteristics arriving at node j from the previous step (zero before t = 0)
      const alpha = j > 0 && s > 0 ? v[j - 1] + zc * iR[j - 1] : 0 // from the left: v + Z_c i
      const beta = j < n && s > 0 ? v[j + 1] - zc * iL[j + 1] : 0 // from the right: v − Z_c i
      let vj: number
      let il: number
      let ir: number
      if (j === 0) {
        // source: e = v + R_s i, and v − Z_c i = β
        ir = (c.e(t) - beta) / (c.rs + zc)
        vj = beta + zc * ir
        il = ir
      } else if (j === n) {
        // end: v + Z_c i = α, v = Z_L i_load, optional clamp in parallel
        const v0 = c.zl === Infinity ? alpha : (alpha * c.zl) / (c.zl + zc)
        vj = clampAt(j, v0)
        il = (alpha - vj) / zc
        ir = c.zl === Infinity ? 0 : c.zl === 0 ? il : vj / c.zl
      } else {
        const v0 = (alpha + beta) / 2
        vj = clampAt(j, v0)
        il = (alpha - vj) / zc
        ir = (vj - beta) / zc
      }
      nv[j] = vj
      niL[j] = il
      niR[j] = ir
    }
    ;[v, nv] = [nv, v]
    ;[iL, niL] = [niL, iL]
    ;[iR, niR] = [niR, iR]
    out.t.push(t)
    for (const j of c.record) {
      out.v[j].push(v[j])
      out.i[j].push(iL[j] * 1000)
    }
    for (const j of Object.keys(clamps)) {
      const jj = Number(j)
      out.iArr[jj].push((iL[jj] - iR[jj]) * 1000)
    }
  }
  return out
}

/** Run a module model on the grid: N sections, the time shown, recording the given nodes. */
export function gridForModel(an: Analysis, n = 200, record: number[] = [n]): GridRun {
  const m = an.model
  return bergeronGrid({
    n,
    dx: an.lengthM / n,
    zc: an.zc,
    v: an.line.v,
    e: (t) => surgeValue(m.surge, m.ekv, m.steep, t),
    rs: m.rs,
    zl: an.zl,
    clamps: m.arrester ? { [n]: m.vres } : undefined,
    steps: Math.round((an.window / an.T) * n),
    record,
  })
}

/**
 * The separation-distance circuit on the grid: an incoming ramp from a matched source (EMF 2·a(t) behind Z_c), a
 * line section of length d, the arrester node, the stub of length d and the open-ended transformer. m sections per d.
 */
export function gridSeparation(c: SepCase, m = 40, tEnd?: number): GridRun & { nodeA: number; nodeT: number } {
  if (!(c.dM > 0)) throw new Error('gridSeparation needs a separation d > 0')
  const n = 2 * m
  const dx = c.dM / m
  const dt = dx / c.v
  const end = tEnd ?? c.ekv / c.s + (6 * c.dM) / c.v + (0.25 * c.ekv) / c.s
  const run = bergeronGrid({
    n,
    dx,
    zc: c.zc,
    v: c.v,
    e: (t) => 2 * rampWave(c.s, c.ekv, t),
    rs: c.zc,
    zl: Infinity,
    clamps: { [m]: c.vres },
    steps: Math.ceil(end / dt) + m,
    record: [m, n],
  })
  // shift time so that t = 0 is the arrival of the wave at the arrester (it is launched m steps earlier)
  const shift = (xs: number[]) => xs.slice(m)
  return { ...run, t: run.t.slice(m).map((t) => t - m * dt), v: { [m]: shift(run.v[m]), [n]: shift(run.v[n]) }, i: run.i, nodeA: m, nodeT: n }
}
