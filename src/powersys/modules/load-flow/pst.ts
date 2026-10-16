import { abs, add, C, conj, mul, polar, scale, sub, type Complex } from '../../engine/complex.ts'
import { lineFlow, type LineFlow } from './analysis.ts'
import { dcLoadFlow, type PhaseShift } from './dcflow.ts'
import { newtonRaphson, type NrRun } from './stepwise.ts'
import { activeLines, lfBuses, unreachable, type CaseLine, type LfCase } from './systems.ts'
import { ybusSteps } from './ybusSteps.ts'

/**
 * The phase-shifting transformer in the AC load flow — a complex-tap branch model built here (the shared network
 * code is not changed).
 *
 * An ideal phase shifter at the `from` end of line i–k turns the bus-i voltage into V_i′ = V_i·e^{jφ} on the line
 * side. Being ideal and lossless it passes the same complex power, so I_i′ = I_i·e^{jφ}. With the line's π model
 * (series y, j·b/2 at each end) between V_i′ and V_k:
 *   I_i = (y + jb/2)·V_i − y·e^{−jφ}·V_k        I_k = −y·e^{+jφ}·V_i + (y + jb/2)·V_k
 * so only the two off-diagonal entries change (|tap| = 1, the diagonals stay): Y_ik = −y·e^{−jφ}, Y_ki = −y·e^{+jφ}
 * — Y_bus is no longer symmetric. For a lossless line the flow is P_ik = (|V_i||V_k|/x)·sin(θ_i − θ_k + φ).
 * Sign convention: positive φ advances the line-side voltage at bus i and pushes active power from i towards k.
 */

const D2R = Math.PI / 180

export function pstLine(c: LfCase, pst: PhaseShift | null | undefined): CaseLine | undefined {
  return pst ? activeLines(c).find((l) => l.id === pst.line) : undefined
}

/** Y_bus of a case with a phase shifter in one line (φ = 0, or no shifter: the ordinary Y_bus, unchanged). */
export function pstYbus(c: LfCase, pst?: PhaseShift | null): Complex[][] {
  const Y = ybusSteps(c).Y.map((r) => [...r])
  const l = pstLine(c, pst)
  if (!l || !pst || pst.phiDeg === 0) return Y
  const d = l.r * l.r + l.x * l.x
  const y = C(l.r / d, -l.x / d)
  const phi = pst.phiDeg * D2R
  const { from: i, to: k } = l
  // remove the ordinary −y and put the rotated entries in their place
  Y[i][k] = sub(add(Y[i][k], y), mul(y, polar(1, -phi)))
  Y[k][i] = sub(add(Y[k][i], y), mul(y, polar(1, phi)))
  return Y
}

/** Flow on a line that has a phase shifter φ at its `from` end (I_i, I_k as above). */
export function pstLineFlow(c: LfCase, l: CaseLine, V: Complex[], phiRad: number): LineFlow {
  const d = l.r * l.r + l.x * l.x
  const y = C(l.r / d, -l.x / d)
  const h = C(0, l.b / 2)
  const Vi = mul(V[l.from], polar(1, phiRad)) // line-side voltage
  const Vk = V[l.to]
  const Is = mul(y, sub(Vi, Vk))
  const Iip = add(Is, mul(h, Vi)) // into the line at the line side of the shifter
  const Iki = add(scale(Is, -1), mul(h, Vk))
  const S = c.baseMva
  const Sik = scale(mul(Vi, conj(Iip)), S) // = V_i·I_i* (the ideal shifter passes the same power)
  const Ski = scale(mul(Vk, conj(Iki)), S)
  return {
    id: l.id,
    from: l.from,
    to: l.to,
    inService: true,
    pFromMw: Sik.re,
    qFromMvar: Sik.im,
    pToMw: Ski.re,
    qToMvar: Ski.im,
    lossMw: Sik.re + Ski.re,
    lossMvar: Sik.im + Ski.im,
    iSeriesPu: abs(Is),
    loadingPct: l.ratingMva ? (Math.max(abs(Sik), abs(Ski)) / l.ratingMva) * 100 : undefined,
  }
}

/** Every line's flow from a set of bus voltages, with an optional phase shifter. */
export function flowsFrom(c: LfCase, V: Complex[], pst?: PhaseShift | null): LineFlow[] {
  const sl = pstLine(c, pst)
  return c.lines.map((l) =>
    l.inService === false
      ? { id: l.id, from: l.from, to: l.to, inService: false, pFromMw: 0, qFromMvar: 0, pToMw: 0, qToMvar: 0, lossMw: 0, lossMvar: 0, iSeriesPu: 0 }
      : sl && sl.id === l.id && pst
        ? pstLineFlow(c, l, V, pst.phiDeg * D2R)
        : lineFlow(c, l, V),
  )
}

export interface AcSolution {
  converged: boolean
  error?: string
  run: NrRun
  Y: Complex[][]
  V: Complex[]
  lines: LineFlow[]
  /** Slack generation [MW] and total line losses [MW]. */
  slackMw: number
  lossMw: number
}

/** The AC (Newton–Raphson, with the module's Q-limit handling) solution of a case with an optional phase shifter. */
export function solveAc(c: LfCase, pst?: PhaseShift | null): AcSolution {
  const Y = pstYbus(c, pst)
  const lb = lfBuses(c)
  const run = newtonRaphson(Y, lb)
  const slack = c.buses.findIndex((b) => b.type === 'slack')
  if (unreachable(c).length) return { converged: false, error: 'Part of the network is cut off from the slack bus.', run, Y, V: run.V, lines: [], slackMw: 0, lossMw: 0 }
  if (!run.converged) return { converged: false, error: run.error, run, Y, V: run.V, lines: [], slackMw: 0, lossMw: 0 }
  const lines = flowsFrom(c, run.V, pst)
  return {
    converged: true,
    run,
    Y,
    V: run.V,
    lines,
    slackMw: run.S[slack].re * c.baseMva + c.buses[slack].pLoadMw,
    lossMw: lines.reduce((a, l) => a + l.lossMw, 0),
  }
}

export interface PstPoint {
  phiDeg: number
  /** AC sending-end flow on the shifter's line [MW] (null where the AC load flow has no solution). */
  acMw: number | null
  dcMw: number
}

/** The shifter line's flow over a range of φ, AC and DC. */
export function pstSweep(c: LfCase, line: string, phis: number[]): PstPoint[] {
  return phis.map((phiDeg) => {
    const ac = solveAc(c, { line, phiDeg })
    const dc = dcLoadFlow(c, { line, phiDeg })
    return {
      phiDeg,
      acMw: ac.converged ? (ac.lines.find((l) => l.id === line)?.pFromMw ?? null) : null,
      dcMw: dc.flows.find((f) => f.id === line)?.pMw ?? 0,
    }
  })
}

/**
 * DC sensitivity of the shifter line's own flow to φ [MW per degree]: ΔP = φ/(x + X_rest), where X_rest is the
 * reactance between the line's two buses through the rest of the network. Computed from the DC model (it is linear),
 * and returned with X_rest = 1/(dP/dφ) − x [pu].
 */
export function pstSensitivity(c: LfCase, line: string): { mwPerDeg: number; xRest: number; x: number } | null {
  const l = activeLines(c).find((x) => x.id === line)
  if (!l) return null
  // no parallel path (decided from the topology, not from a tiny finite difference): the flow cannot be steered
  if (!hasParallelPath(c, line)) return { mwPerDeg: 0, x: l.x, xRest: Infinity }
  const a = dcLoadFlow(c, { line, phiDeg: 0 })
  const b = dcLoadFlow(c, { line, phiDeg: 1 })
  if (!a.ok || !b.ok) return null
  const dp = b.flows.find((f) => f.id === line)!.pMw - a.flows.find((f) => f.id === line)!.pMw
  const perRad = dp / c.baseMva / D2R
  return { mwPerDeg: dp, x: l.x, xRest: 1 / perRad - l.x }
}

/** Whether the line's two buses stay connected through the other in-service lines (i.e. it lies in a loop). */
export function hasParallelPath(c: LfCase, line: string): boolean {
  const l = activeLines(c).find((x) => x.id === line)
  if (!l) return false
  const others = activeLines(c).filter((x) => x !== l)
  const seen = new Set([l.from])
  const stack = [l.from]
  while (stack.length) {
    const i = stack.pop()!
    for (const o of others) {
      const k = o.from === i ? o.to : o.to === i ? o.from : -1
      if (k >= 0 && !seen.has(k)) {
        seen.add(k)
        stack.push(k)
      }
    }
  }
  return seen.has(l.to)
}
