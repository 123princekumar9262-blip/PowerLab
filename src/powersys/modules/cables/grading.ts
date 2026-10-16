import { capacitanceGraded, equalPeakRadii, intersheathEqualPeak, intersheathGraded, type CableResult, type GradedOutcome, type GradedResult } from './calc.ts'

/*
 * The grading design the student edits in Explore: capacitance grading (layers of different ε_r) or intersheath
 * grading (metal intersheaths held at chosen potentials), with 2 or 3 layers. Boundaries are stored as fractions of the
 * insulation thickness and potentials as fractions of V, so they stay inside the cable when r, R or V change.
 */

export interface GradingState {
  kind: 'capacitance' | 'intersheath'
  n: 2 | 3
  /** Layer boundaries as fractions of the insulation thickness (the first n − 1 are used). */
  bounds: number[]
  /** Relative permittivities of the layers, inner first (the first n are used). */
  eps: number[]
  /** Intersheath potentials as fractions of V, inner first (the first n − 1 are used). */
  inter: number[]
}

export const GRADING0: GradingState = { kind: 'capacitance', n: 2, bounds: [0.4, 0.7], eps: [4, 3, 2.3], inter: [0.55, 0.25] }

/** [r, boundaries…, R] in cm. */
export const gradingRadii = (res: Pick<CableResult, 'r' | 'R'>, st: GradingState): number[] => [res.r, ...st.bounds.slice(0, st.n - 1).map((f) => res.r + f * (res.R - res.r)), res.R]

export function gradingOutcome(res: CableResult, st: GradingState): GradedOutcome {
  const radii = gradingRadii(res, st)
  if (st.kind === 'capacitance') return capacitanceGraded(res.c.vKv, radii, st.eps.slice(0, st.n))
  return intersheathGraded(
    res.c.vKv,
    radii,
    st.inter.slice(0, st.n - 1).map((f) => f * res.c.vKv),
    res.c.epsR,
  )
}

/** Are all the layers' maximum stresses within `tol` (relative) of each other? */
export const peaksEqual = (g: GradedResult, tol = 0.01): boolean => {
  const p = g.layers.map((l) => l.gMax)
  return (Math.max(...p) - Math.min(...p)) / Math.max(...p) <= tol
}

/**
 * The state that gives equal maximum stresses. Capacitance grading: boundaries from ε₁r₀ = ε₂r₁ = … (keeping the
 * permittivities); intersheath grading: the potentials for the chosen radii. A message when it is not possible here.
 */
export function equalPeakState(res: CableResult, st: GradingState): { ok: true; state: GradingState } | { ok: false; message: string } {
  if (st.kind === 'capacitance') {
    const eps = st.eps.slice(0, st.n)
    const rs = equalPeakRadii(res.r, eps)
    const fr = rs.map((x) => (x - res.r) / (res.R - res.r))
    const bad = fr.findIndex((f, i) => !(f > 0 && f < 1 && (i === 0 || f > fr[i - 1])))
    if (bad >= 0)
      return {
        ok: false,
        message: `With ε = ${eps.map((e) => e.toFixed(1)).join(', ')} the equal-peak boundaries ε₁r = ε₂r₁${st.n === 3 ? ' = ε₃r₂' : ''} would be at ${rs.map((x) => (x * 10).toFixed(1)).join(' and ')} mm — not in order inside the insulation (${(res.r * 10).toFixed(1)} to ${(res.R * 10).toFixed(1)} mm). The permittivities must fall outwards, and not too steeply for this thickness.`,
      }
    const bounds = [...st.bounds]
    fr.forEach((f, i) => (bounds[i] = f))
    return { ok: true, state: { ...st, bounds } }
  }
  const radii = gradingRadii(res, st)
  const pots = intersheathEqualPeak(res.c.vKv, radii)
  const inter = [...st.inter]
  pots.forEach((p, i) => (inter[i] = p / res.c.vKv))
  return { ok: true, state: { ...st, inter } }
}
