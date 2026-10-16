import { luFactor, luSolve, sub2, bPrimeFull } from './fdlf.ts'
import { activeLines, lfBuses, unreachable, type LfCase } from './systems.ts'

/**
 * DC load flow. Four assumptions turn the AC equations into ONE linear system:
 *   1. every |V| = 1 pu;   2. r ≪ x, so r is ignored (no losses);   3. small angle differences, sin θ_ik ≈ θ_ik;
 *   4. reactive power is not considered.
 * Then the flow on a branch i–k is P_ik = (θ_i − θ_k)/x_ik and the bus equations are P = B′·θ (the same B′ as the fast
 * decoupled load flow: −1/x of every branch), solved once for the angles of the non-slack buses (θ_slack = 0).
 *
 * A phase-shifting transformer of angle φ in series with branch i–k adds φ to the angle difference across it:
 *   P_ik = (θ_i − θ_k + φ)/x_ik
 * Moving the known part φ/x to the right-hand side, the network is the one without the shift plus a pair of
 * equivalent injections — −φ/x at bus i and +φ/x at bus k:   B′·θ = P − P_φ,  P_φ,i = +φ/x, P_φ,k = −φ/x.
 * Sign convention: positive φ ADVANCES the voltage on the bus-i side of the series reactance, so it pushes active
 * power from i towards k.
 */

export interface PhaseShift {
  /** Line id the phase shifter is in series with (at its `from` bus). */
  line: string
  /** Phase shift φ [degrees]. */
  phiDeg: number
}

export interface DcFlow {
  id: string
  from: number
  to: number
  inService: boolean
  x: number
  /** Active power from `from` to `to` [MW]. */
  pMw: number
}

export interface DcResult {
  ok: boolean
  error?: string
  /** Bus angles [rad] (slack = 0). */
  th: number[]
  flows: DcFlow[]
  /** Net injection at every bus [MW]: specified, except the slack's, which is −Σ of the others (lossless). */
  pInjMw: number[]
  slack: number
  /** Reduced B′ (rows/columns `angIdx`) and the right-hand side used [pu]. */
  Bp: number[][]
  angIdx: number[]
  rhs: number[]
  /** The phase shifter's equivalent injections [pu] (zero without one). */
  pPhi: number[]
}

const D2R = Math.PI / 180

export function dcLoadFlow(c: LfCase, pst?: PhaseShift | null): DcResult {
  const n = c.buses.length
  const slack = c.buses.findIndex((b) => b.type === 'slack')
  const angIdx = c.buses.map((_, i) => i).filter((i) => i !== slack)
  const lb = lfBuses(c)
  const pPhi = new Array<number>(n).fill(0)
  const line = pst ? activeLines(c).find((l) => l.id === pst.line) : undefined
  const phi = line && pst ? pst.phiDeg * D2R : 0
  if (line) {
    pPhi[line.from] += phi / line.x
    pPhi[line.to] -= phi / line.x
  }
  const Bp = sub2(bPrimeFull(c), angIdx)
  const rhs = angIdx.map((i) => lb[i].p - pPhi[i])
  const fail = (error: string): DcResult => ({ ok: false, error, th: new Array(n).fill(0), flows: [], pInjMw: new Array(n).fill(0), slack, Bp, angIdx, rhs, pPhi })
  if (unreachable(c).length) return fail('Part of the network is cut off from the slack bus.')
  const f = luFactor(Bp)
  if (!f) return fail('B′ is singular — part of the network is not connected to the slack bus.')
  const x = luSolve(f, rhs)
  const th = new Array<number>(n).fill(0)
  angIdx.forEach((i, j) => (th[i] = x[j]))
  const S = c.baseMva
  const flows: DcFlow[] = c.lines.map((l) => {
    const on = l.inService !== false
    const shift = line && l.id === line.id ? phi : 0
    return { id: l.id, from: l.from, to: l.to, inService: on, x: l.x, pMw: on ? ((th[l.from] - th[l.to] + shift) / l.x) * S : 0 }
  })
  const pInjMw = lb.map((b) => b.p * S)
  pInjMw[slack] = -angIdx.reduce((s, i) => s + lb[i].p, 0) * S
  return { ok: true, th, flows, pInjMw, slack, Bp, angIdx, rhs, pPhi }
}

/** Net active power leaving each bus through its branches [MW] (KCL check: equals the injection). */
export function dcBusOutflow(c: LfCase, r: DcResult): number[] {
  const out = new Array<number>(c.buses.length).fill(0)
  for (const f of r.flows) {
    if (!f.inService) continue
    out[f.from] += f.pMw
    out[f.to] -= f.pMw
  }
  return out
}
