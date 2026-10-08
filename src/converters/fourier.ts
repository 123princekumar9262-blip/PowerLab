/**
 * Exact Fourier coefficients of a periodic signal given as piecewise-LINEAR segments (piecewise-
 * constant is the special case va = vb). Used for every spectrum in the platform: PWM pulse trains
 * (exact edges from the modulator) and simulated inverter waveforms (segments between samples, split
 * at switching events).
 *
 *   c_h = (2/P)·∫₀ᴾ v(t)·e^(−j·h·ω·t) dt,  ω = 2π/P   → amplitude |c_h|, phase arg(c_h)
 *   ∫ₐᵇ (α + β·t)·e^(k·t) dt = [e^(k·t)·((α + β·t)/k − β/k²)]ₐᵇ,   k = −j·h·ω
 */
export interface Segment {
  ta: number
  tb: number
  va: number
  vb: number
}

export interface Harmonic {
  h: number
  /** Peak amplitude |c_h| (for h = 0: the average). */
  amp: number
  /** Phase of the cosine series v = Σ amp·cos(hωt + phase). */
  phase: number
  re: number
  im: number
}

export function fourier(segments: Segment[], period: number, hMax: number): Harmonic[] {
  const w = (2 * Math.PI) / period
  const out: Harmonic[] = []
  // h = 0: the average.
  let avg = 0
  for (const s of segments) avg += 0.5 * (s.va + s.vb) * (s.tb - s.ta)
  avg /= period
  out.push({ h: 0, amp: avg, phase: 0, re: avg, im: 0 })
  for (let h = 1; h <= hMax; h++) {
    const kw = h * w // k = −j·kw
    let re = 0
    let im = 0
    for (const s of segments) {
      const dt = s.tb - s.ta
      if (dt <= 0) continue
      const beta = (s.vb - s.va) / dt
      const alpha = s.va - beta * s.ta
      // F(t) = e^(−j·kw·t)·[(α + β·t)/(−j·kw) − β/(−j·kw)²] = e^(−j·kw·t)·[j(α + β·t)/kw + β/kw²]
      const F = (t: number) => {
        const c = Math.cos(kw * t)
        const sn = -Math.sin(kw * t)
        const ar = beta / (kw * kw)
        const ai = (alpha + beta * t) / kw
        return [c * ar - sn * ai, c * ai + sn * ar]
      }
      const [r1, i1] = F(s.tb)
      const [r0, i0] = F(s.ta)
      re += r1 - r0
      im += i1 - i0
    }
    re *= 2 / period
    im *= 2 / period
    out.push({ h, amp: Math.hypot(re, im), phase: Math.atan2(im, re), re, im }) // v = Σ amp·cos(hωt + phase)
  }
  return out
}

/** RMS of a piecewise-linear periodic signal (exact). */
export function rmsOf(segments: Segment[], period: number): number {
  let s2 = 0
  for (const s of segments) {
    const dt = s.tb - s.ta
    s2 += (dt * (s.va * s.va + s.va * s.vb + s.vb * s.vb)) / 3
  }
  return Math.sqrt(s2 / period)
}

/** THD of a waveform from its RMS, average and fundamental: √(Vrms² − V0² − V1rms²) / V1rms. */
export function thdFrom(rms: number, avg: number, fundamentalAmp: number): number {
  const v1 = fundamentalAmp / Math.SQRT2
  return Math.sqrt(Math.max(0, rms * rms - avg * avg - v1 * v1)) / v1
}

/** Bessel function of the first kind J_n(x), integer n, by its power series (|x| ≲ 30 here). */
export function besselJ(n: number, x: number): number {
  if (n < 0) return (n % 2 === 0 ? 1 : -1) * besselJ(-n, x)
  if (x === 0) return n === 0 ? 1 : 0
  if (Math.abs(x) > 25) return besselAsym(n, x)
  const half = x / 2
  // term_k = (−1)^k (x/2)^(2k+n) / (k! (k+n)!)
  let term = 1
  for (let i = 1; i <= n; i++) term *= half / i
  let sum = term
  for (let k = 1; k < 300; k++) {
    term *= (-half * half) / (k * (k + n))
    sum += term
    if (Math.abs(term) < 1e-17 * Math.max(1, Math.abs(sum)) && k > half) break
  }
  return sum
}
function besselAsym(n: number, x: number): number {
  return Math.sqrt(2 / (Math.PI * x)) * Math.cos(x - (n * Math.PI) / 2 - Math.PI / 4)
}
