/**
 * Numerical search helpers used to locate events between simulation samples.
 * Events are located to far below the timestep, so markers, conduction angles
 * and event explanations don't carry ±Δt quantisation error.
 */

/** Iterations of bisection: each halves the bracket, so 60 iterations shrink it by 2⁻⁶⁰ — below double precision of t. */
const BISECTION_ITERATIONS = 60

/**
 * Find the transition point of a predicate in [lo, hi], given pred(lo) = false and
 * pred(hi) = true. Returns the smallest x (to machine precision) at which pred holds.
 */
export function bisectTransition(lo: number, hi: number, pred: (x: number) => boolean): number {
  let a = lo
  let b = hi
  for (let i = 0; i < BISECTION_ITERATIONS && b - a > 0; i++) {
    const mid = a + (b - a) / 2
    if (mid <= a || mid >= b) break // bracket no longer representable — converged
    if (pred(mid)) b = mid
    else a = mid
  }
  return b
}

/** Golden ratio conjugate (√5 − 1)/2, the interval-shrink factor of golden-section search. */
const INV_PHI = (Math.sqrt(5) - 1) / 2
const GOLDEN_ITERATIONS = 80

/** Locate the maximum of a unimodal function on [lo, hi] by golden-section search. */
export function goldenSectionMax(lo: number, hi: number, f: (x: number) => number): number {
  let a = lo
  let b = hi
  let c = b - INV_PHI * (b - a)
  let d = a + INV_PHI * (b - a)
  let fc = f(c)
  let fd = f(d)
  for (let i = 0; i < GOLDEN_ITERATIONS && b - a > 0; i++) {
    if (fc > fd) {
      b = d
      d = c
      fd = fc
      c = b - INV_PHI * (b - a)
      fc = f(c)
    } else {
      a = c
      c = d
      fc = fd
      d = a + INV_PHI * (b - a)
      fd = f(d)
    }
  }
  return (a + b) / 2
}
