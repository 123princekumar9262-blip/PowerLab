import type { ResolvedParams } from '../../types/simulation.ts'
import { deg, finish, fromWaveform, none, pathDrops, TWO_PI, type Theory, type Waveform } from './waveform.ts'

/**
 * Closed-form steady-state theory for three-phase rectifiers (independent of the simulator).
 *
 * θ is the angle of phase a:  va = Vm·sinθ,  vb = Vm·sin(θ − 120°),  vc = Vm·sin(θ + 120°).
 * (The acb sequence swaps b and c; envelopes and phase-a quantities are unchanged.)
 *
 * Uncontrolled:  half-wave  vo = max(va, vb, vc) − Vf              (3 pulses, f_r = 3f)
 *                bridge     vo = max(…) − min(…) − 2Vf             (6 pulses, f_r = 6f)
 * Controlled (SCR, firing angle α after each natural commutation point):
 *                bridge     each 60° segment: vo = √3·Vm·sin(ψ + 60° + α) − 2Vf
 *                half-wave  each 120° segment: vo = Vm·sin(ψ + 30° + α) − Vf
 *                half-controlled  vo = v(fired phase) − min(…) − 2Vf  (freewheels when that phase is lowest)
 * R load: current only while the drive is positive. RL load: the exact PERIODIC solution of
 * L·di/dt + R·i = v(θ) (continuous conduction assumed and then verified: i > 0 everywhere).
 *
 * Exact only for a balanced, impedance-free source without faults; otherwise notes and
 * approximations are given instead of numbers that would be wrong.
 */

const RAD = Math.PI / 180
const OFFSET = [0, -120 * RAD, 120 * RAD] // a, b, c (abc sequence)

const phaseV = (vm: number, k: number, θ: number) => vm * Math.sin(θ + OFFSET[k])
const wrap = (x: number) => ((x % TWO_PI) + TWO_PI) % TWO_PI

/**
 * Periodic solution of (ωL)·di/dθ + R·i = v(θ) over one period P [rad]: an exponential
 * integrator, exact for v piecewise-linear between grid points, on a 4000-point grid per 60°.
 */
export function periodicRL(v: (θ: number) => number, P: number, R: number, X: number, start = 0): (θ: number) => number {
  const n = Math.max(2000, Math.round((P / (Math.PI / 3)) * 4000))
  const h = P / n
  const tau = X / R // ωL/R in radians
  const E = Math.exp(-h / tau)
  const phi = 1 - (tau / h) * (1 - E)
  const step = (i0: number, v0: number, v1: number) => i0 * E + (v0 / R) * (1 - E) + ((v1 - v0) / R) * phi
  const vs = Array.from({ length: n + 1 }, (_, k) => v(start + k * h))
  // Response from i = 0, then choose i0 so that i(P) = i(0): i0 = iP / (1 − e^(−P/τ)).
  let i = 0
  for (let k = 0; k < n; k++) i = step(i, vs[k], vs[k + 1])
  const i0 = i / (1 - Math.exp(-P / tau))
  const grid = new Float64Array(n + 1)
  grid[0] = i0
  for (let k = 0; k < n; k++) grid[k + 1] = step(grid[k], vs[k], vs[k + 1])
  return (θ: number) => {
    const x = ((((θ - start) % P) + P) % P) / h
    const k = Math.min(n - 1, Math.floor(x))
    return grid[k] + (grid[k + 1] - grid[k]) * (x - k)
  }
}

export function threePhaseTheory(p: ResolvedParams): Theory {
  const { vm } = p
  const { vft, ront } = pathDrops(p)
  const R = p.resistance
  const Reff = R + ront
  const X = p.omega * p.inductance
  const α = p.control.device === 'scr' ? p.control.alpha : 0
  const αDeg = deg(α)
  const half = p.topology === '3ph-half-wave'
  const halfCtl = p.topology === '3ph-half-controlled'
  const controlled = p.control.device === 'scr'
  const notes: string[] = []

  const ideal = p.threePhase.rs === 0 && p.threePhase.ls === 0
  const healthy = !p.faults.diode && !p.faults.missingPhase && !p.faults.imbalance && !p.faults.vfOverride
  if (!healthy) return none(p, ['A fault is applied: the textbook formulas assume a healthy, balanced rectifier. Compare the simulation with the healthy case instead (Experiment mode: Before / After).'])
  if (p.load === 'RC' || p.load === 'RLC') return none(p, ['No closed form is given here for three-phase capacitor filters; the simulation is exact (same solver as every other circuit).'])

  // Drive voltage v(θ) = source-side voltage across the load path minus device drops, and
  // which phase's upper device conducts (for D1 = phase a's upper device).
  let drive: (θ: number) => number
  let upperPhase: (θ: number) => number
  let period: number
  let start: number
  if (!controlled) {
    period = half ? (2 * Math.PI) / 3 : Math.PI / 3
    start = 30 * RAD
    upperPhase = (θ) => [0, 1, 2].reduce((best, k) => (phaseV(vm, k, θ) > phaseV(vm, best, θ) ? k : best), 0)
    drive = (θ) => {
      const v = [0, 1, 2].map((k) => phaseV(vm, k, θ))
      return (half ? Math.max(...v) : Math.max(...v) - Math.min(...v)) - vft
    }
  } else if (half) {
    period = (2 * Math.PI) / 3
    start = 30 * RAD + α
    // Segment k: phase k (a, b, c, a…) conducts from its natural point 30° + 120°k plus α.
    upperPhase = (θ) => Math.floor(wrap(θ - start) / period) % 3
    drive = (θ) => phaseV(vm, upperPhase(θ), θ) - vft
  } else if (!halfCtl) {
    period = Math.PI / 3
    start = 30 * RAD + α
    // Segment k pairs (upper, lower): (a,b) (a,c) (b,c) (b,a) (c,a) (c,b).
    const pairs = [
      [0, 1],
      [0, 2],
      [1, 2],
      [1, 0],
      [2, 0],
      [2, 1],
    ]
    upperPhase = (θ) => pairs[Math.floor(wrap(θ - start) / period) % 6][0]
    drive = (θ) => {
      const [u, l] = pairs[Math.floor(wrap(θ - start) / period) % 6]
      return phaseV(vm, u, θ) - phaseV(vm, l, θ) - vft
    }
  } else {
    period = TWO_PI
    start = 30 * RAD + α
    upperPhase = (θ) => Math.floor(wrap(θ - start) / ((2 * Math.PI) / 3)) % 3
    drive = (θ) => {
      const u = upperPhase(θ)
      const lo = Math.min(...[0, 1, 2].map((k) => phaseV(vm, k, θ)))
      return phaseV(vm, u, θ) - lo - vft
    }
  }
  // A freewheeling diode clamps the load voltage at −Vf (it takes over the current).
  const fw = p.control.freewheel
  const clampFw = (v: number) => (fw ? Math.max(v, -p.diode.vf) : v)

  let i: (θ: number) => number
  let vout: (θ: number) => number
  let mode: Theory['mode']
  if (p.load === 'R') {
    i = (θ) => Math.max(0, drive(θ)) / Reff
    vout = (θ) => R * i(θ)
    mode = undefined
  } else {
    const iPer = periodicRL((θ) => clampFw(drive(θ)), period, Reff, X, start)
    // Continuous conduction is the assumption — verify it.
    let iMin = Infinity
    for (let k = 0; k <= 720; k++) iMin = Math.min(iMin, iPer(start + (k / 720) * period))
    if (!(iMin > 0)) {
      return none(p, [
        `Discontinuous load current at α = ${αDeg.toFixed(0)}°: the current reaches zero inside each segment, so the closed-form (continuous-conduction) result does not apply. The simulation shows the exact behaviour.`,
      ])
    }
    i = iPer
    // Load voltage = drive minus the device resistance drop (or the freewheeling diode's clamp).
    vout = (θ) => {
      const d = drive(θ)
      return fw && d < -p.diode.vf ? -p.diode.vf : d - ront * i(θ)
    }
    mode = 'continuous'
    notes.push(`Continuous conduction verified: the periodic load current never falls below ${iMin.toPrecision(3)} A. Time constant L/R = ${(1000 * p.inductance / Reff).toFixed(2)} ms.`)
  }

  // Phase a's upper device (D1 / Da) carries the load current while it is the conducting upper.
  const conducting = (θ: number) => i(θ) > 0 && !(fw && drive(θ) < -p.diode.vf)
  const iD1 = (θ: number) => (upperPhase(θ) === 0 && conducting(θ) ? i(θ) : 0)
  const piv = (θ: number) => {
    const v = [0, 1, 2].map((k) => phaseV(vm, k, θ))
    // Half-wave: a blocking diode on phase y sees vo − vy (largest for the lowest phase).
    // Bridge: the blocking devices see the conducting line voltage: vo + Vf + Ron·i.
    return half ? vout(θ) - Math.min(...v) : vout(θ) + p.diode.vf + p.diode.ron * i(θ)
  }
  const breaks: number[] = []
  for (let a = start; a < start + TWO_PI; a += Math.PI / 3) breaks.push(wrap(a))
  if (half && !controlled) for (let a = 90 * RAD; a < TWO_PI; a += (2 * Math.PI) / 3) breaks.push(a)
  const continuousConduction = mode === 'continuous' || (p.load === 'R' && [...Array(721).keys()].every((k) => drive(start + (k / 720) * TWO_PI) > 0))
  const w: Waveform = {
    a: 0,
    breaks,
    vout,
    io: i,
    iD1,
    irect: (θ) => (conducting(θ) ? i(θ) : 0),
    piv,
    turnOn: continuousConduction ? 30 * RAD + α : null,
    turnOff: continuousConduction ? 30 * RAD + α + (half ? 120 : halfCtl ? 120 : 120) * RAD : null,
  }

  const k = '3√3·Vm/π'
  const formulas = !controlled
    ? {
        voutAvg: half ? 'Vdc = 3√3·Vm/(2π) − Vf = 1.17·Vph − Vf' : 'Vdc = 3√3·Vm/π − 2Vf = 1.35·VLL − 2Vf',
        voutPeak: half ? 'Vo,pk = Vm − Vf' : 'Vo,pk = √3·Vm − 2Vf',
        voutMin: half ? 'Vo,min = Vm·sin30° − Vf' : 'Vo,min = √3·Vm·sin60° − 2Vf',
        piv: 'PIV = √3·Vm = √2·VLL',
        conductionAngleDeg: 'γ = 120° per diode',
        turnOnAngleDeg: 'θon = 30° (phase a becomes highest)',
        turnOffAngleDeg: 'θoff = 150°',
      }
    : {
        voutAvg: halfCtl
          ? `Vdc = 3√3·Vm/(2π)·(1 + cos α) − 2Vf`
          : half
            ? p.load === 'R' && αDeg > 30
              ? 'Vdc = 3Vm/(2π)·[1 + cos(α + 30°)] (R, α > 30°)'
              : 'Vdc = 3√3·Vm/(2π)·cos α − Vf'
            : p.load === 'R' && αDeg > 60
              ? `Vdc = ${k}·[1 + cos(α + 60°)] (R, α > 60°)`
              : `Vdc = ${k}·cos α − 2Vf = 1.35·VLL·cos α − 2Vf`,
        conductionAngleDeg: 'γ = 120° (continuous)',
        turnOnAngleDeg: 'θon = 30° + α',
        turnOffAngleDeg: 'θoff = 150° + α',
      }
  const values = fromWaveform(p, w, formulas)
  // Conduction of phase a's upper device, measured on the theoretical current itself (a
  // freewheeling diode or discontinuous current can split or shorten it).
  let onCount = 0
  const N = 7200
  for (let k = 0; k < N; k++) if (iD1((k / N) * TWO_PI) > 0) onCount++
  const fwActive = fw && [...Array(721).keys()].some((k) => drive(start + (k / 720) * TWO_PI) < -p.diode.vf)
  if (values.conductionAngleDeg) values.conductionAngleDeg = { ...values.conductionAngleDeg, value: (onCount / N) * 360, formula: fwActive ? 'γ: until the freewheeling diode takes over' : values.conductionAngleDeg.formula }
  if (fwActive) {
    delete values.turnOnAngleDeg
    delete values.turnOffAngleDeg
    notes.push('The freewheeling diode conducts whenever the bridge output would go negative: the SCR pair turns off and the inductor current circulates through Dfw. Vdc rises compared with no freewheeling diode.')
  }
  if (controlled) delete values.piv // forward-blocking SCRs: PIV is not the simple diode formula
  if (!continuousConduction) {
    delete values.turnOnAngleDeg
    delete values.turnOffAngleDeg
    delete values.conductionAngleDeg
    notes.push('R load with large α: the current stops before the next firing pulse (discontinuous conduction), so each device conducts in two separated pieces.')
  }

  const approximations: Theory['approximations'] = []
  if (!ideal) {
    // Source impedance: commutation overlap (Ls) and resistive drop (Rs) lower the output.
    const drop = half ? (3 * p.omega * p.threePhase.ls) / (2 * Math.PI) + p.threePhase.rs : (3 * p.omega * p.threePhase.ls) / Math.PI + 2 * p.threePhase.rs
    const v0 = values.voutAvg?.value ?? 0
    approximations.push({ key: 'voutAvg', label: 'Vdc, ideal source (no Rs, Ls)', value: v0, formula: values.voutAvg?.formula ?? '' })
    approximations.push({ key: 'voutAvg', label: 'Vdc with source impedance', value: v0 / (1 + drop / Reff), formula: half ? 'Vdc ≈ Vdc0 − (3ωLs/2π + Rs)·Idc' : 'Vdc ≈ Vdc0 − (3ωLs/π + 2Rs)·Idc' })
    notes.push('Source impedance is present, so the ideal-source closed forms no longer apply exactly. During each commutation the source inductance makes THREE devices conduct for an overlap angle μ, which lowers Vdc. Compare the two approximate rows with the simulation.')
    return finish(p, {}, approximations, notes, mode)
  }
  if (controlled) notes.push(`Firing angle α = ${αDeg.toFixed(1)}°: each SCR is fired α after the instant its phase would naturally take over.`)
  return finish(p, values, approximations, notes, mode)
}
