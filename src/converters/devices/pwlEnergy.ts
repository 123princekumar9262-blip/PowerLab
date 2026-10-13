import type { PwlResult } from '../pwl.ts'

/**
 * Integrals of quantities f(x, t, mode) over a PWL SIMULATION run, using the simulator's own solution at its
 * samples AND at the instants it located inside a step (mode changes, input breakpoints — the "knots"). A power
 * with a kink or a jump at a mode change (a diode clamping, a gate edge) is then integrated piece by piece instead
 * of across the kink: the trapezoid rule on the simulated solution, with its event points.
 *
 * f is evaluated on each side of a knot (the old mode just before, the new mode just after), so a quantity that
 * jumps there (a terminal current when a diode clamps) is integrated exactly up to the jump. An input breakpoint
 * that falls exactly on a sample is treated the same way.
 */
export interface Cumulative {
  /** ∫f dt from 0 to each sample. */
  cum: Float64Array
  /** ∫f dt from 0 to t (any t inside the run; the knots inside the step are honoured). */
  at(t: number): number
}

type Pt = { t: number; left: number[]; right: number[] }

export function cumulatives(res: PwlResult, f: (x: number[], t: number, mode: string) => number[], breakpoints: number[] = []): Cumulative[] {
  const n = res.t.length
  const dim = res.x.length
  const xs = (k: number) => Array.from({ length: dim }, (_, i) => res.x[i][k])
  const T = res.t[n - 1]
  const dt = T / (n - 1)
  const before = (t: number) => t - Math.max(Math.abs(t), dt) * 1e-12
  const after = (t: number) => t + Math.max(Math.abs(t), dt) * 1e-12
  const onSample = new Set<number>()
  for (const b of breakpoints) {
    const k = Math.round(b / dt)
    if (k > 0 && k < n && Math.abs(res.t[k] - b) < 1e-9 * dt) onSample.add(k)
  }
  // each sample once (both sides only where an input jumps exactly there)
  const sampleRight: number[][] = new Array(n)
  const sampleLeft: number[][] = new Array(n)
  for (let k = 0; k < n; k++) {
    const x = xs(k)
    if (onSample.has(k)) {
      sampleLeft[k] = f(x, before(res.t[k]), res.modes[k - 1])
      sampleRight[k] = f(x, after(res.t[k]), res.modes[k])
    } else sampleLeft[k] = sampleRight[k] = f(x, res.t[k], res.modes[k])
  }
  const knots = [...res.knots].sort((a, b) => a.t - b.t)
  const inner: Pt[][] = new Array(n)
  let j = 0
  for (let k = 1; k < n; k++) {
    const t0 = res.t[k - 1]
    const t1 = res.t[k]
    let modePrev = res.modes[k - 1]
    while (j < knots.length && knots[j].t <= t0) j++
    const pts: Pt[] = []
    while (j < knots.length && knots[j].t < t1) {
      const q = knots[j]
      pts.push({ t: q.t, left: f(q.x, before(q.t), modePrev), right: f(q.x, after(q.t), q.mode) })
      modePrev = q.mode
      j++
    }
    inner[k] = pts
  }
  const m = sampleRight[0].length
  const stepPts = (k: number): Pt[] => [{ t: res.t[k - 1], left: sampleRight[k - 1], right: sampleRight[k - 1] }, ...inner[k], { t: res.t[k], left: sampleLeft[k], right: sampleLeft[k] }]
  const out: Cumulative[] = []
  for (let c = 0; c < m; c++) {
    const cum = new Float64Array(n)
    for (let k = 1; k < n; k++) {
      let s = 0
      let a: Pt = { t: res.t[k - 1], left: sampleRight[k - 1], right: sampleRight[k - 1] }
      for (const b of inner[k]) {
        s += 0.5 * (a.right[c] + b.left[c]) * (b.t - a.t)
        a = b
      }
      s += 0.5 * (a.right[c] + sampleLeft[k][c]) * (res.t[k] - a.t)
      cum[k] = cum[k - 1] + s
    }
    out.push({
      cum,
      at(t: number) {
        if (t <= res.t[0]) return 0
        if (t >= T) return cum[n - 1]
        const k = Math.min(n - 1, Math.max(1, Math.ceil(t / dt - 1e-9)))
        const pts = stepPts(k)
        let s = cum[k - 1]
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1]
          const b = pts[i]
          if (t >= b.t) {
            s += 0.5 * (a.right[c] + b.left[c]) * (b.t - a.t)
            continue
          }
          if (t > a.t) {
            const w = (t - a.t) / (b.t - a.t)
            const ft = a.right[c] + w * (b.left[c] - a.right[c])
            s += 0.5 * (a.right[c] + ft) * (t - a.t)
          }
          break
        }
        return s
      },
    })
  }
  return out
}

/** One integral (see cumulatives). */
export function cumulative(res: PwlResult, f: (x: number[], t: number, mode: string) => number, breakpoints: number[] = []): Cumulative {
  return cumulatives(res, (x, t, mode) => [f(x, t, mode)], breakpoints)[0]
}
