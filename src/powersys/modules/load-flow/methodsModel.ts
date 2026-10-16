import type { Complex } from '../../engine/complex.ts'
import { dcLoadFlow, type DcResult, type PhaseShift } from './dcflow.ts'
import { FD_MAX_ITER, agreementBound, bDoublePrimeFull, bPrimeFull, decoupling, fastDecoupled, type Decoupling, type FdRun } from './fdlf.ts'
import { flowsFrom, pstSensitivity, solveAc, type AcSolution } from './pst.ts'
import { CASES, editCase, lfBuses, type CaseEdits, type LfCase } from './systems.ts'
import { ybusSteps } from './ybusSteps.ts'
import type { LineFlow } from './analysis.ts'

/**
 * Everything the "Other solution methods" view shows, computed for one case (with the student's operating changes
 * and an optional phase shifter): the Newton–Raphson reference, the fast decoupled run on the same data, the DC load
 * flow, and their comparisons. Pure functions — the view only formats these numbers.
 */

export type Method = 'nr' | 'fdlf' | 'dc'

export interface MethodsState {
  method: Method
  /** Line the phase shifter is in series with, and its angle [deg] (0 = no shift). */
  pstLine: string
  phiDeg: number
}

export const METHODS0: MethodsState = { method: 'nr', pstLine: '1–3', phiDeg: 0 }

export interface MethodsModel {
  c: LfCase
  pst: PhaseShift | null
  /** Y_bus with the phase shifter (if any) and without its angle (for B″). */
  Y: Complex[][]
  Y0: Complex[][]
  ac: AcSolution
  fd: FdRun
  fdLines: LineFlow[]
  dc: DcResult
  dec: Decoupling | null
  /** Largest |θ_FD − θ_NR| [rad] and |(|V|_FD − |V|_NR)| [pu] and the first-order bound on either. */
  agree: { dth: number; dv: number; bound: number } | null
  /** DC against AC, line by line [MW]. */
  dcRows: DcRow[]
}

export interface DcRow {
  id: string
  x: number
  inService: boolean
  dcMw: number
  acMw: number
  errMw: number
  /** Error relative to the AC flow [%] — null when the AC flow is too small for a percentage to mean anything. */
  errPct: number | null
}

/** A percentage is shown only when the AC flow is at least this share of the largest AC line flow. */
export const PCT_FLOOR = 0.05

export function lineOf(c: LfCase, id: string) {
  return c.lines.find((l) => l.id === id && l.inService !== false)
}

/** The phase shifter actually applied: on an in-service line of this case, else none. */
export function effectivePst(c: LfCase, s: Pick<MethodsState, 'pstLine' | 'phiDeg'>): PhaseShift | null {
  return lineOf(c, s.pstLine) && s.phiDeg !== 0 ? { line: s.pstLine, phiDeg: s.phiDeg } : null
}

export function dcRows(c: LfCase, dc: DcResult, ac: AcSolution): DcRow[] {
  if (!dc.ok || !ac.converged) return []
  const maxAc = Math.max(...ac.lines.map((l) => Math.abs(l.pFromMw)))
  return c.lines.map((l, j) => {
    const a = ac.lines[j]
    const d = dc.flows[j]
    const on = l.inService !== false
    const err = d.pMw - a.pFromMw
    return {
      id: l.id,
      x: l.x,
      inService: on,
      dcMw: d.pMw,
      acMw: a.pFromMw,
      errMw: on ? err : 0,
      errPct: on && Math.abs(a.pFromMw) >= PCT_FLOOR * maxAc ? (err / Math.abs(a.pFromMw)) * 100 : null,
    }
  })
}

export function methodsModel(c: LfCase, s: Pick<MethodsState, 'pstLine' | 'phiDeg'>): MethodsModel {
  const pst = effectivePst(c, s)
  const ac = solveAc(c, pst)
  const Y = ac.Y
  const Y0 = ybusSteps(c).Y
  const lb = lfBuses(c)
  const fd = fastDecoupled(Y, lb, bPrimeFull(c), bDoublePrimeFull(Y0))
  const dc = dcLoadFlow(c, pst)
  const nr = ac.run
  const dec = ac.converged ? decoupling(c, Y, nr.Vm, nr.th, nr.types) : null
  const agree =
    ac.converged && fd.converged
      ? {
          dth: Math.max(...nr.th.map((t, i) => Math.abs(t - fd.th[i]))),
          dv: Math.max(...nr.Vm.map((v, i) => Math.abs(v - fd.Vm[i]))),
          bound: agreementBound(Y, nr.Vm, nr.th, nr.types, nr.history[nr.history.length - 1], fd.history[fd.history.length - 1]),
        }
      : null
  return { c, pst, Y, Y0, ac, fd, fdLines: fd.converged ? flowsFrom(c, fd.V, pst) : [], dc, dec, agree, dcRows: dcRows(c, dc, ac) }
}

/** Iterations of NR and FDLF on a system's base case with every line resistance multiplied by `k` (the r/x study). */
export function rxStudy(sys: LfCase['id'], factors: number[]) {
  return factors.map((k) => {
    const base = CASES[sys]()
    const c = { ...base, lines: base.lines.map((l) => ({ ...l, r: l.r * k })) }
    const Y = ybusSteps(c).Y
    const lb = lfBuses(c)
    const ac = solveAc(c, null)
    const fd = fastDecoupled(Y, lb, bPrimeFull(c), bDoublePrimeFull(Y), { maxIter: FD_MAX_ITER })
    return { k, rx: Math.max(...c.lines.map((l) => l.r / l.x)), nr: ac.converged ? ac.run.iterations : null, fd: fd.converged ? fd.iterations : null }
  })
}

/** The phase shifter's effect on every line: AC and DC flows without and with it [MW]. */
export interface PstRow {
  id: string
  inService: boolean
  ac0: number | null
  ac1: number | null
  dc0: number
  dc1: number
}

export function pstTable(c: LfCase, line: string, phiDeg: number): { rows: PstRow[]; ac0: AcSolution; ac1: AcSolution; sens: ReturnType<typeof pstSensitivity> } {
  const ac0 = solveAc(c, null)
  const ac1 = solveAc(c, lineOf(c, line) ? { line, phiDeg } : null)
  const dc0 = dcLoadFlow(c, null)
  const dc1 = dcLoadFlow(c, lineOf(c, line) ? { line, phiDeg } : null)
  const rows = c.lines.map((l, j) => ({
    id: l.id,
    inService: l.inService !== false,
    ac0: ac0.converged ? ac0.lines[j].pFromMw : null,
    ac1: ac1.converged ? ac1.lines[j].pFromMw : null,
    dc0: dc0.flows[j]?.pMw ?? 0,
    dc1: dc1.flows[j]?.pMw ?? 0,
  }))
  return { rows, ac0, ac1, sens: pstSensitivity(c, line) }
}

/** The base case of a system with the student's operating edits (a helper for the view). */
export const editedCase = (sys: LfCase['id'], e: CaseEdits) => editCase(CASES[sys](), e)

/** A ratio in words with the number beside it, e.g. "2.7 times as many". */
export function timesWords(a: number, b: number): string {
  if (b === 0) return 'no'
  const r = a / b
  if (Math.abs(r - 1) < 0.05) return 'about as many'
  return r > 1 ? `${r.toFixed(1)} times as many` : `${(1 / r).toFixed(1)} times fewer`
}

/**
 * Two lines in parallel between buses A and B (DC model), carrying `total` pu from A to B. The phase shift in line 1
 * [degrees] that makes it carry `want` pu: line 2 then carries total − want = δ/x₂, so δ = (total − want)·x₂, and
 * line 1 needs (δ + φ)/x₁ = want → φ = want·x₁ − δ.
 */
export function parallelPstPhi(x1: number, x2: number, total: number, want: number): number {
  const delta = (total - want) * x2
  return ((want * x1 - delta) * 180) / Math.PI
}
