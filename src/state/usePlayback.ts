import { useEffect, useRef } from 'react'
import { SECONDS_PER_CYCLE_AT_1X } from './labState.ts'

/**
 * Advance the cursor through the existing simulation data in slow motion.
 * Playback only moves the cursor — it never re-computes physics.
 */
export function usePlayback(opts: {
  playing: boolean
  speed: number
  period: number
  duration: number
  cursorTime: number
  setCursor: (t: number) => void
}) {
  const { playing, speed, period, duration } = opts
  // Latest values without restarting the animation loop on every frame.
  const latest = useRef(opts)
  latest.current = opts

  useEffect(() => {
    if (!playing || !(duration > 0)) return
    let raf = 0
    let last = performance.now()
    // Keep a float time locally; the store snaps to samples when rendering.
    let t = latest.current.cursorTime >= duration ? 0 : latest.current.cursorTime
    const tick = (now: number) => {
      const wall = Math.min(0.1, (now - last) / 1000) // clamp to survive tab switches
      last = now
      // Simulated seconds advanced per wall second = speed · T / SECONDS_PER_CYCLE_AT_1X.
      t += (wall * speed * period) / SECONDS_PER_CYCLE_AT_1X
      if (t > duration) t = t % duration // loop
      latest.current.setCursor(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, period, duration])
}
