import { abs, add, arg, C, conj, div, mul, polar, scale, sub, ZERO, type Complex } from '../../engine/complex.ts'
import type { LfBus } from '../../network/loadflow.ts'
import { injectionsPolar } from './stepwise.ts'

/**
 * Gauss–Seidel load flow with an acceleration factor α, for comparison with Newton–Raphson on the same system.
 * One iteration sweeps the non-slack buses in order, each using the newest voltages of the others:
 *   V_i ← (1/Y_ii)·[ (P_i − jQ_i)/V_i* − Σ_{k≠i} Y_ik·V_k ]       then  V_i ← V_i,old + α·(V_i,new − V_i,old)
 * A PV bus first gets Q_i = −Im{V_i*·Σ_k Y_ik V_k}; after the update its magnitude is reset to the set-point
 * (angle kept). A PV bus whose Q goes beyond a limit is held at the limit and treated as PQ, until its voltage
 * returns to the set-point's side.
 * Convergence is judged with the same power mismatch as Newton–Raphson (largest |ΔP|, |ΔQ|), so the two
 * convergence histories can be compared directly.
 */

export interface GsRun {
  converged: boolean
  iterations: number
  /** Largest power mismatch at the start and after each sweep [pu]. */
  history: number[]
  /** Largest voltage change in each sweep [pu]. */
  dvHistory: number[]
  /** Voltages after each sweep (the first entry is the start). */
  trace: Complex[][]
  V: Complex[]
  alpha: number
  error?: string
}

export function gaussSeidel(Y: Complex[][], buses: LfBus[], opts: { alpha?: number; tol?: number; maxIter?: number; keepTrace?: number } = {}): GsRun {
  const alpha = opts.alpha ?? 1
  const tol = opts.tol ?? 1e-8
  const maxIter = opts.maxIter ?? 2000
  const keep = opts.keepTrace ?? 12
  const n = buses.length
  const V: Complex[] = buses.map((b) => (b.type === 'pq' ? C(1) : C(b.v)))
  const history: number[] = []
  const dvHistory: number[] = []
  const trace: Complex[][] = [[...V]]
  const limited = new Array<boolean>(n).fill(false)
  const side = new Array<number>(n).fill(0)
  const qUsed = buses.map((b) => b.q)

  const mismatch = () => {
    const Vm = V.map(abs)
    const th = V.map(arg)
    const { P, Q } = injectionsPolar(Y, Vm, th)
    let m = 0
    buses.forEach((b, i) => {
      if (b.type === 'slack') return
      m = Math.max(m, Math.abs(b.p - P[i]))
      if (b.type === 'pq' || limited[i]) m = Math.max(m, Math.abs(qUsed[i] - Q[i]))
    })
    return m
  }
  history.push(mismatch())
  let it = 0
  while (history[history.length - 1] >= tol) {
    if (it >= maxIter) return { converged: false, iterations: it, history, dvHistory, trace, V, alpha, error: `No convergence in ${maxIter} iterations.` }
    let dvMax = 0
    for (let i = 0; i < n; i++) {
      const b = buses[i]
      if (b.type === 'slack') continue
      let s = ZERO
      for (let k = 0; k < n; k++) if (k !== i) s = add(s, mul(Y[i][k], V[k]))
      let q = b.q
      if (b.type === 'pv') {
        // a bus held at a limit is released only when its voltage is back on the set-point's side
        if (limited[i] && ((side[i] > 0 && abs(V[i]) > b.v) || (side[i] < 0 && abs(V[i]) < b.v))) limited[i] = false
        if (limited[i]) q = side[i] > 0 ? b.qMax! : b.qMin!
        else {
          q = -mul(conj(V[i]), add(s, mul(Y[i][i], V[i]))).im
          if (b.qMax !== undefined && q > b.qMax) {
            q = b.qMax
            limited[i] = true
            side[i] = 1
          } else if (b.qMin !== undefined && q < b.qMin) {
            q = b.qMin
            limited[i] = true
            side[i] = -1
          }
        }
      }
      qUsed[i] = q
      const vNew = div(sub(div(C(b.p, -q), conj(V[i])), s), Y[i][i])
      let vAcc = add(V[i], scale(sub(vNew, V[i]), alpha))
      if (b.type === 'pv' && !limited[i]) vAcc = polar(b.v, arg(vAcc))
      dvMax = Math.max(dvMax, abs(sub(vAcc, V[i])))
      V[i] = vAcc
    }
    it++
    dvHistory.push(dvMax)
    if (trace.length <= keep) trace.push([...V])
    const m = mismatch()
    history.push(m)
    if (!Number.isFinite(m) || m > 1e6) return { converged: false, iterations: it, history, dvHistory, trace, V, alpha, error: 'The iteration diverged.' }
  }
  return { converged: true, iterations: it, history, dvHistory, trace, V, alpha }
}
