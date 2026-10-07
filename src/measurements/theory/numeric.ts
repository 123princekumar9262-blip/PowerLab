/**
 * Numerical helpers for evaluating CLOSED-FORM theory: Simpson quadrature of analytic
 * waveforms and root finding for transcendental angles (extinction, turn-on, turn-off).
 * These are independent of the circuit simulator — they never touch the netlist or engine.
 */

/** Composite Simpson's rule of f on [a, b] with N (even) intervals. Error ~ (b−a)·h⁴·f''''. */
export function simpson(f: (x: number) => number, a: number, b: number, N = 4000): number {
  if (!(b > a)) return 0
  const n = N % 2 ? N + 1 : N
  const h = (b - a) / n
  let s = f(a) + f(b)
  for (let k = 1; k < n; k++) s += (k % 2 ? 4 : 2) * f(a + k * h)
  return (s * h) / 3
}

/** Bisection root of f on [a, b] given a sign change. */
export function bisectRoot(f: (x: number) => number, a: number, b: number): number {
  let fa = f(a)
  let lo = a
  let hi = b
  for (let i = 0; i < 100; i++) {
    const m = 0.5 * (lo + hi)
    const fm = f(m)
    if (fm === 0) return m
    if (fm > 0 === fa > 0) {
      lo = m
      fa = fm
    } else hi = m
  }
  return 0.5 * (lo + hi)
}

/** First root of f after a (scanning in `steps` intervals up to b); null if f keeps its sign. */
export function firstRoot(f: (x: number) => number, a: number, b: number, steps = 20000): number | null {
  const h = (b - a) / steps
  let x0 = a
  let f0 = f(a)
  for (let k = 1; k <= steps; k++) {
    const x1 = a + k * h
    const f1 = f(x1)
    if (f0 === 0) return x0
    if (f1 === 0 || f1 > 0 !== f0 > 0) return bisectRoot(f, x0, x1)
    x0 = x1
    f0 = f1
  }
  return null
}

/** Max and min of f on [a, b] by dense sampling (for peak values of analytic waveforms). */
export function extremes(f: (x: number) => number, a: number, b: number, N = 20000): { max: number; min: number } {
  let max = -Infinity
  let min = Infinity
  for (let k = 0; k <= N; k++) {
    const v = f(a + ((b - a) * k) / N)
    if (v > max) max = v
    if (v < min) min = v
  }
  return { max, min }
}
