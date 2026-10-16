/*
 * The stress colour scale shared by the 3D scene, the 2D cross-section and the legend: 0 kV/cm (blue) up to the
 * permissible stress G (orange); anything above G is drawn in the critical colour. The value is always printed beside
 * the colour, so colour is never the only cue.
 */

const STOPS: Array<[number, [number, number, number]]> = [
  [0, [0x2b, 0x4c, 0x8c]],
  [0.35, [0x2f, 0x9f, 0xb4]],
  [0.7, [0xe6, 0xc8, 0x4a]],
  [1, [0xf0, 0x7b, 0x2c]],
]
/** Above the permissible stress. */
export const OVER_COLOR = '#ff4d7a'

const hex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** RGB (0–1) for a stress as a fraction of the permissible stress. */
export function stressRgb(frac: number): [number, number, number] {
  if (!Number.isFinite(frac) || frac > 1 + 1e-9) return [1, 0x4d / 255, 0x7a / 255]
  const f = Math.max(0, frac)
  for (let i = 1; i < STOPS.length; i++) {
    const [f1, c1] = STOPS[i]
    const [f0, c0] = STOPS[i - 1]
    if (f <= f1) {
      const t = (f - f0) / (f1 - f0)
      return [0, 1, 2].map((k) => (c0[k] + (c1[k] - c0[k]) * t) / 255) as [number, number, number]
    }
  }
  return STOPS[STOPS.length - 1][1].map((v) => v / 255) as [number, number, number]
}

/** CSS colour for a stress as a fraction of the permissible stress. */
export const stressCss = (frac: number): string => hex(stressRgb(frac).map((v) => v * 255) as [number, number, number])

/** CSS gradient of the scale from 0 to G (for the legend bar). */
export const scaleGradient = (): string => `linear-gradient(90deg, ${STOPS.map(([f, c]) => `${hex(c)} ${(f * 100).toFixed(0)}%`).join(', ')})`
