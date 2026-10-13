/**
 * Complex arithmetic for the power-system calculations (phasors, impedances, admittances, complex power).
 * Plain immutable values: { re, im }. Angles are in radians unless a name says Deg.
 */
export interface Complex {
  re: number
  im: number
}

export const C = (re: number, im = 0): Complex => ({ re, im })
export const ZERO: Complex = C(0, 0)
export const ONE: Complex = C(1, 0)

export const add = (a: Complex, b: Complex): Complex => C(a.re + b.re, a.im + b.im)
export const sub = (a: Complex, b: Complex): Complex => C(a.re - b.re, a.im - b.im)
export const mul = (a: Complex, b: Complex): Complex => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re)
export const scale = (a: Complex, k: number): Complex => C(a.re * k, a.im * k)
export const neg = (a: Complex): Complex => C(-a.re, -a.im)
export const conj = (a: Complex): Complex => C(a.re, -a.im)
export const abs = (a: Complex): number => Math.hypot(a.re, a.im)
export const arg = (a: Complex): number => Math.atan2(a.im, a.re)
export const isZero = (a: Complex, tol = 0): boolean => abs(a) <= tol

/** a / b; throws on division by an exactly zero complex number (callers check first where it can happen). */
export function div(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im
  if (d === 0) throw new RangeError('complex division by zero')
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d)
}
export const inv = (a: Complex): Complex => div(ONE, a)

/** A phasor from magnitude and angle (radians). */
export const polar = (mag: number, ang: number): Complex => C(mag * Math.cos(ang), mag * Math.sin(ang))
/** A phasor from magnitude and angle (degrees). */
export const polarDeg = (mag: number, deg: number): Complex => polar(mag, (deg * Math.PI) / 180)
export const deg = (rad: number): number => (rad * 180) / Math.PI
export const rad = (d: number): number => (d * Math.PI) / 180
export const sum = (xs: Complex[]): Complex => xs.reduce(add, ZERO)

/** The operator a = 1∠120° used by symmetrical components. */
export const A_OP: Complex = polarDeg(1, 120)
