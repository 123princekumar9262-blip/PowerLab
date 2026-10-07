import type { ResolvedParams } from '../../types/simulation.ts'
import { bisectRoot, extremes, firstRoot, simpson } from './numeric.ts'

/**
 * Closed-form steady-state theory for every rectifier × load.
 *
 * Method: write the steady-state waveforms as ANALYTIC functions of the source angle
 * θ = ωt + φ (piecewise, with transcendental switching angles found by root finding),
 * then evaluate averages/RMS/peaks by quadrature of those formulas. Nothing here uses
 * the circuit simulator — it is an independent derivation the simulation is checked against.
 *
 * Notation: n = pulses per cycle (1 half-wave, 2 full-wave); Vft / Ront = forward drop /
 * on-resistance in the conduction path (×2 for a bridge); θ₁ = asin(Vft/Vm).
 */

export type MeasureKey =
  | 'vinPeak'
  | 'vinRms'
  | 'voutAvg'
  | 'voutRms'
  | 'voutPeak'
  | 'voutMin'
  | 'ripplePP'
  | 'rippleFactor'
  | 'ioAvg'
  | 'ioRms'
  | 'ioPeak'
  | 'idPeak'
  | 'idAvg'
  | 'piv'
  | 'conductionAngleDeg'
  | 'turnOnAngleDeg'
  | 'turnOffAngleDeg'
  | 'rippleFrequency'
  | 'efficiency'

export interface TheoryValue {
  value: number
  formula: string
  /** exact = closed form (incl. quadrature/roots of closed forms); approx = textbook approximation. */
  kind: 'exact' | 'approx'
  /** Valid only if the inductor current is continuous (choke-input filter). */
  requiresContinuous?: boolean
}

export interface Theory {
  values: Partial<Record<MeasureKey, TheoryValue>>
  /** Textbook approximations shown next to the exact rows, for comparison. */
  approximations: Array<{ key: MeasureKey; label: string; value: number; formula: string }>
  /** Assumptions, operating mode and caveats, shown under the table. */
  notes: string[]
  /** Operating mode, when the theory distinguishes one. */
  mode?: 'continuous' | 'discontinuous'
}

const TWO_PI = 2 * Math.PI
const deg = (r: number) => (r * 180) / Math.PI

/** Analytic steady-state waveform over one source cycle [a, a + 2π]. */
interface Waveform {
  a: number
  /** Angles where the waveform is piecewise (integration is split there). */
  breaks: number[]
  vout(θ: number): number
  io(θ: number): number
  iD1(θ: number): number
  /** Current through the conduction path (for diode loss Vft·i + Ront·i²). */
  irect(θ: number): number
  /** Largest reverse voltage across any diode at θ. */
  piv(θ: number): number
  turnOn: number | null
  turnOff: number | null
}

function pathDrops(p: ResolvedParams) {
  const bridge = p.topology === 'bridge'
  return {
    n: p.topology === 'half-wave' ? 1 : 2,
    vft: bridge ? 2 * p.diode.vf : p.diode.vf,
    ront: bridge ? 2 * p.diode.ron : p.diode.ron,
  }
}

/** Reverse voltage on the blocking diodes, given the output voltage and path current. */
function pivAt(p: ResolvedParams, θ: number, vout: number, i: number): number {
  const vin = p.vm * Math.sin(θ)
  switch (p.topology) {
    case 'half-wave':
      return vout - vin // −vD1 = vK − vA = vout − vin
    case 'center-tap':
      return vout + Math.abs(vin) // −vD = vP − (±vin)
    case 'bridge':
      // Conducting pair: the blocking pair sees vout + Vf + Ron·i. All OFF: each shares (vout + |vin|)/2.
      return i > 0 ? vout + p.diode.vf + p.diode.ron * i : (vout + Math.abs(vin)) / 2
  }
}

function integrate(w: Waveform, f: (θ: number) => number): number {
  const pts = [w.a, ...w.breaks.filter((x) => x > w.a && x < w.a + TWO_PI).sort((x, y) => x - y), w.a + TWO_PI]
  let s = 0
  for (let k = 0; k + 1 < pts.length; k++) s += simpson(f, pts[k], pts[k + 1], 2000)
  return s
}

function fromWaveform(p: ResolvedParams, w: Waveform, formulas: Partial<Record<MeasureKey, string>>): Theory['values'] {
  const avg = (f: (θ: number) => number) => integrate(w, f) / TWO_PI
  const vdc = avg(w.vout)
  const vrms = Math.sqrt(Math.max(0, avg((θ) => w.vout(θ) ** 2)))
  const ex = (f: (θ: number) => number) => extremes(f, w.a, w.a + TWO_PI)
  const vx = ex(w.vout)
  const R = p.resistance
  const pLoad = avg((θ) => R * w.io(θ) ** 2)
  const { vft, ront } = pathDrops(p)
  const pDiode = avg((θ) => vft * w.irect(θ) + ront * w.irect(θ) ** 2)
  const e = (value: number, key: MeasureKey, fallback: string): TheoryValue => ({ value, formula: formulas[key] ?? fallback, kind: 'exact' })
  const vals: Theory['values'] = {
    voutAvg: e(vdc, 'voutAvg', 'Vdc = (1/2π)∫vo dθ'),
    voutRms: e(vrms, 'voutRms', 'Vo,rms = √((1/2π)∫vo² dθ)'),
    voutPeak: e(vx.max, 'voutPeak', 'max vo(θ)'),
    voutMin: e(vx.min, 'voutMin', 'min vo(θ)'),
    ripplePP: e(vx.max - vx.min, 'ripplePP', 'max vo − min vo'),
    ioAvg: e(avg(w.io), 'ioAvg', 'Idc = (1/2π)∫io dθ'),
    ioRms: e(Math.sqrt(avg((θ) => w.io(θ) ** 2)), 'ioRms', 'Io,rms = √((1/2π)∫io² dθ)'),
    ioPeak: e(ex(w.io).max, 'ioPeak', 'max io(θ)'),
    idPeak: e(ex(w.iD1).max, 'idPeak', 'max iD1(θ)'),
    idAvg: e(avg(w.iD1), 'idAvg', 'ID1,avg = (1/2π)∫iD1 dθ'),
    piv: e(ex(w.piv).max, 'piv', 'max reverse vD'),
    efficiency: e(pLoad / (pLoad + pDiode || 1), 'efficiency', 'η = P_R / (P_R + P_diodes)'),
  }
  if (Math.abs(vdc) > p.vm * 1e-9) vals.rippleFactor = e(Math.sqrt(Math.max(0, vrms ** 2 - vdc ** 2)) / Math.abs(vdc), 'rippleFactor', 'RF = √(Vrms² − Vdc²)/Vdc')
  if (w.turnOn !== null && w.turnOff !== null) {
    vals.turnOnAngleDeg = e(deg(w.turnOn), 'turnOnAngleDeg', 'θon')
    vals.turnOffAngleDeg = e(deg(w.turnOff), 'turnOffAngleDeg', 'θoff')
    vals.conductionAngleDeg = e(deg(w.turnOff - w.turnOn), 'conductionAngleDeg', 'γ = θoff − θon')
  }
  return vals
}

// ─── R load ───────────────────────────────────────────────────────────────────────
function resistive(p: ResolvedParams): Theory {
  const { n, vft, ront } = pathDrops(p)
  const { vm } = p
  const R = p.resistance
  const k = R / (R + ront)
  const ideal = p.diode.kind === 'ideal'
  if (!(vm > vft)) return none(p, ['The source peak never exceeds the diode drop: no conduction, all outputs are zero.'])
  const θ1 = Math.asin(vft / vm)
  const θ2 = Math.PI - θ1
  // One pulse (θ₁..θ₂) per half period; i = (Vm·sinθ − Vft)/(R + Ront), vo = R·i.
  const pulse = (θ: number) => {
    const t = ((θ % TWO_PI) + TWO_PI) % TWO_PI
    const u = n === 2 ? Math.abs(Math.sin(t)) : Math.sin(t)
    const half = n === 2 ? t % Math.PI : t
    if (half <= θ1 || half >= θ2) return 0
    return Math.max(0, (vm * u - vft) / (R + ront))
  }
  const w: Waveform = {
    a: 0,
    breaks: [θ1, θ2, Math.PI, Math.PI + θ1, Math.PI + θ2],
    vout: (θ) => R * pulse(θ),
    io: pulse,
    iD1: (θ) => (Math.sin(θ) > 0 ? pulse(θ) : 0),
    irect: pulse,
    piv: (θ) => pivAt(p, θ, R * pulse(θ), pulse(θ)),
    turnOn: θ1,
    turnOff: θ2,
  }
  const fw = n === 2
  const vals = fromWaveform(p, w, {
    voutAvg: ideal ? (fw ? 'Vdc = 2Vm/π' : 'Vdc = Vm/π') : `Vdc = ${fw ? '' : '½·'}k/π·[2Vm·cosθ₁ − Vft(π − 2θ₁)]`,
    voutRms: ideal ? (fw ? 'Vo,rms = Vm/√2' : 'Vo,rms = Vm/2') : 'Vo,rms = √(n/2π ∫θ₁..θ₂ vo² dθ)',
    voutPeak: ideal ? 'Vo,pk = Vm' : 'Vo,pk = (Vm − Vft)·R/(R + Ront)',
    voutMin: 'Vo,min = 0',
    ripplePP: 'ΔVo = Vo,pk − 0',
    ioAvg: 'Idc = Vdc/R',
    ioRms: 'Io,rms = Vo,rms/R',
    ioPeak: 'Io,pk = (Vm − Vft)/(R + Ront)',
    idAvg: fw ? 'ID,avg = Idc/2' : 'ID,avg = Idc',
    piv: p.topology === 'center-tap' ? 'PIV = Vm + Vo,pk  (≈ 2Vm)' : p.topology === 'bridge' ? 'PIV = Vo,pk + Vf + Ron·Ipk (≈ Vm)' : 'PIV = Vm',
    conductionAngleDeg: ideal ? 'γ = 180°' : 'γ = 180° − 2·asin(Vft/Vm)',
    turnOnAngleDeg: 'θ₁ = asin(Vft/Vm)',
    turnOffAngleDeg: 'θ₂ = 180° − θ₁',
    efficiency: 'η = Po / (Po + Vft·Idc + Ront·Irms²)',
  })
  return finish(p, vals, [], [k < 1 ? `Ron = ${p.diode.ron} Ω per diode acts as a series resistance (k = R/(R + Ront) = ${k.toFixed(4)}).` : ''])
}

// ─── RL load ──────────────────────────────────────────────────────────────────────
function inductive(p: ResolvedParams): Theory {
  const { n, vft, ront } = pathDrops(p)
  const { vm, omega } = p
  const R = p.resistance
  const Reff = R + ront
  const X = omega * p.inductance
  const Z = Math.hypot(Reff, X)
  const φ = Math.atan2(X, Reff) // load impedance angle
  const wt = X / Reff // ωτ, τ = L/Reff
  if (!(vm > vft)) return none(p, ['The source peak never exceeds the diode drop: no conduction.'])
  const θ1 = Math.asin(vft / vm)
  // Forced (sinusoidal steady-state) + natural (exponential) response from i(θ₁) = 0:
  //   i(θ) = (Vm/Z)·sin(θ − φ) − Vft/Reff + A·e^(−(θ−θ₁)/ωτ)
  const A = vft / Reff - (vm / Z) * Math.sin(θ1 - φ)
  const iPulse = (θ: number) => (vm / Z) * Math.sin(θ - φ) - vft / Reff + A * Math.exp(-(θ - θ1) / wt)
  // At θ₁ both i and di/dθ are zero (vin = Vft, i = 0 ⇒ L·di/dt = 0); i grows like (θ−θ₁)².
  // Start the root search a little past θ₁ so floating-point dust at θ₁ is not taken as β.
  const start = θ1 + 1e-5
  const notes = [`Z = √(R² + (ωL)²) = ${Z.toFixed(3)} Ω, φ = atan(ωL/R) = ${deg(φ).toFixed(2)}°, ωτ = ωL/R = ${wt.toFixed(3)}.`]

  if (n === 1) {
    // Half-wave: the pulse runs until the current returns to zero — the extinction angle β.
    const β = firstRoot(iPulse, start, θ1 + TWO_PI) ?? θ1 + TWO_PI
    const i = (θ: number) => (θ > θ1 && θ < β ? Math.max(0, iPulse(θ)) : 0)
    const vo = (θ: number) => (θ > θ1 && θ < β ? vm * Math.sin(θ) - vft - ront * i(θ) : 0)
    const w: Waveform = { a: θ1, breaks: [β], vout: vo, io: i, iD1: i, irect: i, piv: (θ) => pivAt(p, θ, vo(θ), i(θ)), turnOn: θ1, turnOff: β }
    notes.push(`Extinction angle β solves i(β) = 0 → β = ${deg(β).toFixed(2)}°. Between 180° and β the inductor's stored energy keeps D1 on while vin < 0, so vo goes negative.`)
    return finish(
      p,
      fromWaveform(p, w, {
        voutAvg: 'Vdc = R·Idc  (avg vL = 0)',
        ioAvg: 'Idc = (1/2π)∫θ₁..β i(θ) dθ',
        turnOffAngleDeg: 'β: i(β) = 0',
        turnOnAngleDeg: 'θ₁ = asin(Vf/Vm)',
        conductionAngleDeg: 'γ = β − θ₁',
        ioPeak: 'max i(θ), i = (Vm/Z)sin(θ−φ) − Vf/R + A·e^(−(θ−θ₁)/ωτ)',
      }),
      [],
      notes,
      'discontinuous',
    )
  }

  // Full-wave: does the pulse die before the next half-cycle takes over at θ = π?
  const βpulse = firstRoot(iPulse, start, Math.PI)
  if (βpulse !== null) {
    const i = (θ: number) => {
      const h = θ % Math.PI
      return h > θ1 && h < βpulse ? Math.max(0, iPulse(h)) : 0
    }
    const vo = (θ: number) => (i(θ) > 0 ? vm * Math.abs(Math.sin(θ)) - vft - ront * i(θ) : 0)
    const w: Waveform = {
      a: 0,
      breaks: [θ1, βpulse, Math.PI, Math.PI + θ1, Math.PI + βpulse],
      vout: vo,
      io: i,
      iD1: (θ) => (θ < Math.PI ? i(θ) : 0),
      irect: i,
      piv: (θ) => pivAt(p, θ, vo(θ), i(θ)),
      turnOn: θ1,
      turnOff: βpulse,
    }
    notes.push(`Discontinuous: each pulse dies at β = ${deg(βpulse).toFixed(2)}° before the next half-cycle begins.`)
    return finish(p, fromWaveform(p, w, { voutAvg: 'Vdc = R·Idc', turnOffAngleDeg: 'β: i(β) = 0' }), [], notes, 'discontinuous')
  }
  // Continuous: periodic solution over a half period with i(0) = i(π):
  //   i(θ) = (Vm/Z)·sin(θ − φ) − Vft/Reff + B·e^(−θ/ωτ),  B = 2(Vm/Z)·sinφ / (1 − e^(−π/ωτ))
  const B = (2 * (vm / Z) * Math.sin(φ)) / (1 - Math.exp(-Math.PI / wt))
  const ic = (θ: number) => {
    const h = ((θ % Math.PI) + Math.PI) % Math.PI
    return (vm / Z) * Math.sin(h - φ) - vft / Reff + B * Math.exp(-h / wt)
  }
  const vo = (θ: number) => vm * Math.abs(Math.sin(θ)) - vft - ront * ic(θ)
  const w: Waveform = {
    a: 0,
    breaks: [Math.PI],
    vout: vo,
    io: ic,
    iD1: (θ) => (θ < Math.PI ? ic(θ) : 0),
    irect: ic,
    piv: (θ) => pivAt(p, θ, vo(θ), ic(θ)),
    turnOn: 0,
    turnOff: Math.PI,
  }
  notes.push('Continuous conduction: the inductor current never reaches zero; the diodes commutate at every zero crossing of vin.')
  const vals = fromWaveform(p, w, {
    voutAvg: 'Vdc = 2Vm/π − Vft − Ront·Idc',
    ioAvg: 'Idc = (2Vm/π − Vft)/(R + Ront)',
    conductionAngleDeg: 'γ = 180° (continuous)',
    turnOnAngleDeg: 'θon = 0° (commutation)',
    turnOffAngleDeg: 'θoff = 180° (commutation)',
  })
  return finish(p, vals, [], notes, 'continuous')
}

// ─── RC load (capacitor-input filter) ─────────────────────────────────────────────
function capacitive(p: ResolvedParams): Theory {
  const { n, vft } = pathDrops(p)
  const { vm, omega } = p
  const R = p.resistance
  const C = p.capacitance
  const wRC = omega * R * C
  if (!(vm > vft)) return none(p, ['The source peak never exceeds the diode drop: no conduction.'])
  if (p.diode.ron > 0) return none(p, ['The closed-form capacitor-filter solution assumes Ron = 0 (the capacitor voltage then follows the source exactly while charging). Compare with the simulation qualitatively.'])
  const P = TWO_PI / n
  // Charging: vo = u(θ) − Vft, diode current iD = ωC·Vm·cosθ + (Vm·sinθ − Vft)/R. Turn-off where iD = 0.
  const θoff = bisectRoot((θ) => wRC * vm * Math.cos(θ) + vm * Math.sin(θ) - vft, Math.PI / 2, Math.PI)
  const V0 = vm * Math.sin(θoff) - vft
  // Discharge: vo = V0·e^(−(θ−θoff)/ωRC). Turn-on when the rising source catches up: Vm·|sin θ| − Vft = vo.
  const decay = (θ: number) => V0 * Math.exp(-(θ - θoff) / wRC)
  const θonNext = bisectRoot((θ) => vm * Math.abs(Math.sin(θ)) - vft - decay(θ), P, P + Math.PI / 2)
  const θon = θonNext - P
  const inPulse = (θ: number) => {
    const h = ((θ - θon) % P + P) % P + θon // angle within the pulse frame [θon, θon + P)
    return { h, on: h <= θoff }
  }
  const vo = (θ: number) => {
    const { h, on } = inPulse(θ)
    return on ? vm * Math.sin(h) - vft : decay(h)
  }
  const irect = (θ: number) => {
    const { h, on } = inPulse(θ)
    return on ? Math.max(0, wRC * vm * Math.cos(h) / R + (vm * Math.sin(h) - vft) / R) : 0
  }
  const w: Waveform = {
    a: θon,
    breaks: n === 1 ? [θoff] : [θoff, θon + Math.PI, θoff + Math.PI],
    vout: vo,
    io: (θ) => vo(θ) / R,
    iD1: (θ) => (((θ % TWO_PI) + TWO_PI) % TWO_PI < Math.PI ? irect(θ) : 0),
    irect,
    piv: (θ) => pivAt(p, θ, vo(θ), irect(θ)),
    turnOn: θon,
    turnOff: θoff,
  }
  const vals = fromWaveform(p, w, {
    turnOffAngleDeg: 'θoff: ωRC·cosθ + sinθ = Vft/Vm',
    turnOnAngleDeg: 'θon: Vm·sinθ − Vft = vo(θoff)·e^(−(θ−θoff)/ωRC)',
    voutPeak: 'Vo,pk = Vm − Vft',
    voutMin: 'Vo,min = vo(θon)',
    ripplePP: 'ΔV = Vo,pk − Vo,min',
    idPeak: 'iD(θon) = ωC·Vm·cosθon + vo(θon)/R',
    ioAvg: 'Idc = Vdc/R',
    idAvg: n === 2 ? 'ID,avg = Idc/2' : 'ID,avg = Idc',
  })
  const fr = n * p.frequency
  const dvApprox = (vm - vft) / (fr * R * C)
  const approximations: Theory['approximations'] = [
    { key: 'ripplePP', label: 'Ripple (textbook)', value: dvApprox, formula: `ΔV ≈ Vo,pk/(${n === 2 ? '2' : ''}f·R·C)` },
    { key: 'voutAvg', label: 'Vdc (textbook)', value: vm - vft - dvApprox / 2, formula: 'Vdc ≈ Vo,pk − ΔV/2' },
  ]
  return finish(p, vals, approximations, [
    `ωRC = ${wRC.toFixed(2)}. Exact solution: charge while vo follows the source, decay exponentially through R after θoff, recharge at θon.`,
    'The textbook ripple formula assumes the capacitor discharges for the whole period with constant current — compare it with the exact row.',
  ])
}

// ─── RLC load (choke-input LC filter) ─────────────────────────────────────────────
function lcFilter(p: ResolvedParams): Theory {
  const { n, vft, ront } = pathDrops(p)
  const { vm, omega } = p
  const R = p.resistance
  const values: Theory['values'] = {}
  const notes: string[] = []
  const approximations: Theory['approximations'] = []
  if (n === 1) {
    notes.push('Half-wave with an LC filter has no freewheeling path: the inductor current must fall to zero every cycle (discontinuous). There is no closed form — study it in the simulation.')
    return finish(p, values, approximations, notes, 'discontinuous')
  }
  // Critical inductance (2nd-harmonic approximation): continuous iL if L > R/(3ω).
  const Lc = R / (3 * omega)
  const continuous = p.inductance > Lc
  notes.push(`Critical inductance Lc ≈ R/(3ω) = ${(Lc * 1e3).toFixed(2)} mH (approx.). L = ${(p.inductance * 1e3).toFixed(1)} mH → ${continuous ? 'continuous' : 'discontinuous'} inductor current expected.`)
  if (continuous) {
    // Continuous iL: vrect = |vin| − Vft − Ront·iL always; avg vL = 0, avg iC = 0 ⇒ Vdc = avg(vrect) − Ront·Idc.
    const idc = (2 * vm / Math.PI - vft) / (R + ront)
    values.voutAvg = { value: R * idc, formula: 'Vdc = 2Vm/π − Vft − Ront·Idc', kind: 'exact', requiresContinuous: true }
    values.ioAvg = { value: idc, formula: 'Idc = (2Vm/π − Vft)/(R + Ront)', kind: 'exact', requiresContinuous: true }
    values.idAvg = { value: idc / 2, formula: 'ID,avg = Idc/2', kind: 'exact', requiresContinuous: true }
    values.conductionAngleDeg = { value: 180, formula: 'γ = 180° (continuous)', kind: 'exact', requiresContinuous: true }
    // Ripple: dominant 2nd harmonic of the rectified wave, amplitude 4Vm/(3π), through the L–C divider.
    const w2 = 2 * omega
    const gain = 1 / Math.abs(w2 * w2 * p.inductance * p.capacitance - 1)
    approximations.push({ key: 'ripplePP', label: 'Ripple (2nd harmonic)', value: 2 * (4 * vm / (3 * Math.PI)) * gain, formula: 'ΔV ≈ (8Vm/3π)/|(2ω)²LC − 1|' })
    notes.push('With continuous inductor current the rectifier output is exactly |vin| − Vft at every instant, so Vdc is exact; the ripple is a harmonic approximation.')
  } else {
    notes.push('Discontinuous inductor current: no closed form. Vdc rises toward the peak as L → 0 (capacitor-filter behaviour).')
  }
  return finish(p, values, approximations, notes, continuous ? 'continuous' : 'discontinuous')
}

function none(p: ResolvedParams, notes: string[]): Theory {
  return finish(p, {}, [], notes)
}

/** Rows every circuit shares: source values and ripple frequency. */
function finish(p: ResolvedParams, values: Theory['values'], approximations: Theory['approximations'], notes: string[], mode?: Theory['mode']): Theory {
  const { n, vft } = pathDrops(p)
  const conducts = p.vm > vft
  return {
    values: {
      vinPeak: { value: p.vm, formula: 'Vm = √2·Vrms', kind: 'exact' },
      vinRms: { value: p.vrms, formula: 'Vrms = Vm/√2', kind: 'exact' },
      ...(conducts ? { rippleFrequency: { value: n * p.frequency, formula: n === 2 ? 'f_r = 2f' : 'f_r = f', kind: 'exact' as const } } : {}),
      ...values,
    },
    approximations,
    notes: notes.filter(Boolean),
    mode,
  }
}

export function theoryFor(p: ResolvedParams): Theory {
  switch (p.load) {
    case 'R':
      return resistive(p)
    case 'RL':
      return inductive(p)
    case 'RC':
      return capacitive(p)
    case 'RLC':
      return lcFilter(p)
  }
}
