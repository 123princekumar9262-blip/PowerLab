import { useMemo, useState } from 'react'
import type { StateExplanation } from '../../explanations/index.ts'
import { measure } from '../../measurements/measurements.ts'
import { runSimulation } from '../../simulation/engine.ts'
import type { CircuitId, LabParams } from '../../types/simulation.ts'
import { formatDeg, formatV } from '../../utils/format.ts'
import type { Measurements } from '../../measurements/measurements.ts'

interface Props {
  ex: StateExplanation
  params: LabParams
  circuitId: CircuitId
  measurements: Measurements
}

/**
 * FIRING ANGLE α — what delaying the gate does, from the simulation: the conduction start,
 * the measured Vdc, and the same circuit simulated with α = 0 for reference. Plus the two
 * questions students ask: why is the SCR off, and why did it turn on now?
 */
export function FiringPanel({ ex, params, circuitId, measurements: m }: Props) {
  const fire = ex.firing
  const [open, setOpen] = useState<'off' | 'on' | null>(null)
  // Reference: the same circuit with α = 0 (natural triggering), simulated — not a formula.
  const ref = useMemo(() => {
    if (!fire) return null
    const ctl = params.control ?? { device: 'scr' as const, alphaDeg: 0, freewheel: false }
    return measure(runSimulation({ ...params, control: { ...ctl, alphaDeg: 0 } }, circuitId))
  }, [!!fire, params, circuitId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!fire) return null
  const α = fire.alphaDeg
  return (
    <section className="firing-panel" aria-labelledby="firing-title">
      <h2 id="firing-title" className="firing-title">
        Firing angle α = {formatDeg(α)}
      </h2>
      <ul className="firing-facts">
        <li>
          {α < 0.5
            ? 'α = 0°: every SCR is fired at its natural point — the instant a diode would start conducting. Maximum output: it behaves like the diode rectifier.'
            : `α = ${formatDeg(α)}: each SCR is fired ${formatDeg(α)} after its natural point. Until then it blocks even though it is forward biased.`}
        </li>
        {m.turnOnAngleDeg !== null && (
          <li>
            Measured: conduction starts at θ = {formatDeg(m.turnOnAngleDeg)} and the reference device conducts {formatDeg(m.conductionAngleDeg)} per cycle.
          </li>
        )}
        {ref && (
          <li>
            Average output: Vdc = <b>{formatV(m.voutAvg)}</b> at α = {formatDeg(α)}, versus {formatV(ref.voutAvg)} for the same circuit fired at α = 0 (both simulated).{' '}
            {m.voutAvg < 0
              ? 'Negative over this cycle: the inductor is still giving back energy it stored earlier — the run has not settled. With a passive R-L load the steady average cannot stay below zero (Vdc = R·Idc, since L·di/dt averages to zero); lasting inversion needs a source in the load, such as a motor’s back-EMF, which this lab does not model.'
              : ref.voutAvg > m.voutAvg
                ? 'Delaying the gate cuts off the first part of each pulse, so the average falls.'
                : ''}
          </li>
        )}
      </ul>
      <div className="why-actions">
        <button className={`text-btn ${open === 'off' ? 'is-on' : ''}`} aria-expanded={open === 'off'} onClick={() => setOpen(open === 'off' ? null : 'off')}>
          Why is the SCR OFF?
        </button>
        <button className={`text-btn ${open === 'on' ? 'is-on' : ''}`} aria-expanded={open === 'on'} onClick={() => setOpen(open === 'on' ? null : 'on')}>
          Why did it turn ON now?
        </button>
      </div>
      {open === 'off' && (
        <div className="firing-answer">
          {fire.whyOff.length ? fire.whyOff.map((t, k) => <p key={k}>{t}</p>) : <p>Every SCR is conducting at this instant. {fire.scrs.map((x) => x.text).join(' ')}</p>}
        </div>
      )}
      {open === 'on' && (
        <div className="firing-answer">
          {fire.whyOn.length ? fire.whyOn.map((t, k) => <p key={k}>{t}</p>) : <p>No SCR has turned on yet before this instant — move the cursor past the first firing.</p>}
        </div>
      )}
    </section>
  )
}
