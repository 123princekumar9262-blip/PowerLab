import type { Experiment, Lesson, PredictTask, StateView, WhyCard } from '../../lab/types.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../../utils/format.ts'
import { sampleValues } from '../engine.ts'
import type { RunEvent } from '../types.ts'
import type { InverterMeasurements, InverterRun } from './analysis.ts'
import { legDevices } from './model.ts'
import { invCarrier, legReference, svDwell, sampleTime, type InverterParams } from './modulation.ts'

/** What each leg is doing at an instant — read from the simulated device states. */
export interface LegState {
  name: 'A' | 'B' | 'C'
  /** Gate command: upper switch commanded ON. */
  upper: boolean
  /** Gates as simulated (after dead time). */
  gUp: boolean
  gLo: boolean
  /** Device carrying the leg current now (or none). */
  conducting: string | null
  kind: 'igbt' | 'diode' | 'none'
  /** Current flowing OUT of the leg node into the load. */
  i: number
  /** Leg voltage (from DC− or the DC midpoint). */
  v: number
}

export interface InvState {
  k: number
  t: number
  /** Angle in the fundamental cycle [deg]. */
  theta: number
  legs: LegState[]
  vo: number
  io: number
  ia: number
  ib: number
  ic: number
  vnN: number
  van: number
  idc: number
  pdc: number
  po: number
  /** PWM: per-leg reference (per unit) and the carrier at the cursor. */
  refs: number[]
  carrier: number
  /** SVPWM: dwell times of the switching period containing the cursor. */
  sv: { sector: number; t1: number; t2: number; t0: number; thetaK: number } | null
  values: Record<string, number>
}

export function invStateAt(r: InverterRun, k: number): InvState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const v = sampleValues(r, i)
  const t = r.time[i]
  const tm = i === 0 ? t + 1e-12 : t - p.dt / 2
  const names = legDevices(p)
  const nLegs = p.topology === 'half' ? 1 : p.topology === 'full' ? 2 : 3
  const dev = (id: string) => r.devices.find((d) => d.id === id)
  const legs: LegState[] = []
  for (let leg = 0; leg < nLegs; leg++) {
    const [su, du, sl, dl] = names[leg]
    const on = [su, du, sl, dl].find((id) => dev(id)?.on[i] === 1) ?? null
    const legI = p.topology === 'three' ? v[`i${'abc'[leg]}`] : leg === 0 ? v.io : -v.io
    legs.push({
      name: 'ABC'[leg] as LegState['name'],
      upper: (dev(su)?.gate?.[i] ?? 0) === 1,
      gUp: (dev(su)?.gate?.[i] ?? 0) === 1,
      gLo: (dev(sl)?.gate?.[i] ?? 0) === 1,
      conducting: on,
      kind: on ? (on.startsWith('S') ? 'igbt' : 'diode') : 'none',
      i: legI,
      v: v[`v${'abc'[leg]}N`],
    })
  }
  const svOn = p.modulation === 'svpwm'
  return {
    k: i,
    t,
    theta: ((((p.omega * tm * 180) / Math.PI) % 360) + 360) % 360,
    legs,
    vo: v.vo,
    io: v.io,
    ia: v.ia ?? v.io,
    ib: v.ib ?? 0,
    ic: v.ic ?? 0,
    vnN: v.vnN ?? 0,
    van: v.van ?? v.vo,
    idc: v.idc,
    pdc: v.pdc,
    po: v.po,
    refs: legs.map((_l, leg) => legReference(p, leg, tm)),
    carrier: invCarrier(p, tm),
    sv: svOn ? svDwell(p, sampleTime(p, tm)) : null,
    values: v,
  }
}

const fmtDeg = (d: number) => `${d.toFixed(1)}°`

export function invView(st: InvState, r: InverterRun): StateView {
  const p = r.params
  const diode = st.legs.find((l) => l.kind === 'diode')
  const badge = diode ? { text: `${diode.conducting} freewheeling (current returns)`, tone: 'off' as const } : { text: st.pdc >= 0 ? 'Power flows DC → load' : 'Power flows load → DC', tone: 'on' as const }
  const rows: StateView['rows'] = [{ k: 't', v: `${formatTime(st.t)} · θ = ${fmtDeg(st.theta)}`, full: true }]
  for (const l of st.legs)
    rows.push({ k: `Leg ${l.name}`, v: l.conducting ? `${l.conducting} conducts · ${formatA(l.i, true)}` : `no device · ${formatA(l.i, true)}`, tone: l.kind === 'igbt' ? 'on-q' : l.kind === 'diode' ? 'on-d' : 'off', full: true })
  if (p.topology === 'three') {
    rows.push({ k: 'vab', v: formatV(st.vo) }, { k: 'van', v: formatV(st.van) }, { k: 'ia', v: formatA(st.ia, true) }, { k: 'ib', v: formatA(st.ib, true) }, { k: 'ic', v: formatA(st.ic, true), min: 'standard' }, { k: 'vnN (neutral)', v: formatV(st.vnN), min: 'standard' })
  } else rows.push({ k: 'vo', v: formatV(st.vo) }, { k: 'io', v: formatA(st.io, true) })
  rows.push({ k: 'P from DC', v: formatW(st.pdc), tone: st.pdc < 0 ? 'on-d' : undefined, min: 'standard' }, { k: 'idc', v: formatA(st.idc, true), min: 'engineer' })
  if (st.sv) rows.push({ k: 'sector', v: `${st.sv.sector + 1} · T1 ${formatTime(st.sv.t1)} · T2 ${formatTime(st.sv.t2)} · T0 ${formatTime(st.sv.t0)}`, full: true, min: 'standard' })
  else if (p.tc) rows.push({ k: 'carrier · refs', v: `${st.carrier.toFixed(3)} · ${st.refs.map((x) => x.toFixed(3)).join(' / ')}`, full: true, min: 'engineer' })
  for (const l of st.legs) rows.push({ k: `gates ${l.name}`, v: `upper ${l.gUp ? 'ON' : 'OFF'} · lower ${l.gLo ? 'ON' : 'OFF'}`, min: 'engineer', full: true })
  const path = st.legs.map((l) => (l.conducting ? `${l.conducting}` : '—')).join(', ')
  return { badge, rows, path: `${path} carry the current; ${diode ? 'a diode returns the inductive current to the DC source' : 'the IGBTs connect the load to the rails'}` }
}

export function invWhy(r: InverterRun, st: InvState, m: InverterMeasurements): WhyCard[] {
  const p = r.params
  const cards: WhyCard[] = []
  const V = p.vdc
  const lagDeg = p.load === 'RL' ? (Math.atan((p.omega * p.l) / p.r) * 180) / Math.PI : 0
  const dl = st.legs.find((l) => l.kind === 'diode')
  if (dl) {
    const upper = ['D1', 'D3', 'D5'].includes(dl.conducting!)
    // dead time: neither IGBT of the leg is gated — the current's direction alone picks the diode (and the rail)
    const deadTime = !dl.gUp && !dl.gLo
    cards.push({
      id: 'diode',
      question: `Why does ${dl.conducting} conduct (not the IGBT)?`,
      what: deadTime
        ? `Both gates of leg ${dl.name} are OFF (dead time), but its current is ${formatA(dl.i, true)} — flowing ${dl.i < 0 ? 'INTO' : 'OUT of'} the leg. ${dl.conducting} carries it and ties the leg to the ${upper ? 'upper' : 'lower'} rail.`
        : `Leg ${dl.name} is gated to the ${upper ? 'upper' : 'lower'} rail, but its current is ${formatA(dl.i, true)} — flowing ${dl.i < 0 ? 'INTO' : 'OUT of'} the leg.`,
      why: deadTime
        ? `During the dead time neither IGBT is ON, yet the inductive load keeps its current flowing. Only a diode can carry it, and the current's direction decides which one: here ${dl.conducting}, so the leg voltage is set by the current, not by the gates.`
        : `An IGBT conducts only forward (from its collector to its emitter). The ${upper ? 'upper' : 'lower'} IGBT cannot carry this current direction, so the diode beside it does. The inductive load keeps its current flowing after the switching instant, even though the voltage has already reversed.`,
      equation: `L·di/dt = v − R·i: the current needs time τ = L/R = ${formatTime(p.l / p.r)} to reverse`,
      physics: `While the diode conducts, current flows against the applied voltage: the load gives energy BACK to the DC source (P = ${formatW(st.pdc)} now; ${formatSI(m.eReturned, 'J')} per cycle).`,
      whatIf: 'With a purely resistive load the current reverses together with the voltage and no diode ever conducts.',
    })
  }
  const il = st.legs.find((l) => l.kind === 'igbt')
  if (il && !dl)
    cards.push({
      id: 'igbt',
      question: `Why is ${il.conducting} conducting?`,
      what: `Leg ${il.name} is switched to the ${il.gUp ? 'upper' : 'lower'} rail and its current (${formatA(il.i, true)}) flows in the IGBT's forward direction.`,
      why: 'The gate turns the IGBT ON; forward current then flows through it, connecting the leg to its rail.',
      equation: `v(leg) = ${il.gUp ? (p.topology === 'half' ? '+Vdc/2' : '+Vdc') : p.topology === 'half' ? '−Vdc/2' : '0'} (ideal switch)`,
      physics: 'The output voltage is set by the gate commands, not by the load: every leg is connected to one rail or the other.',
      whatIf: 'If the current reversed while the IGBT stays gated, the antiparallel diode would take over automatically.',
    })
  if (p.topology === 'three') {
    const vx = st.legs.map((l) => l.v)
    const sixStep = p.modulation === 'six-step'
    cards.push({
      id: 'van',
      question: sixStep ? 'Why does van have steps of Vdc/3?' : 'Why is the phase voltage van not simply the leg voltage?',
      what: `Leg voltages: vaN ${formatV(vx[0])}, vbN ${formatV(vx[1])}, vcN ${formatV(vx[2])}. The load neutral sits at vnN = ${formatV(st.vnN)}, so van = ${formatV(st.van)}.`,
      why: 'The star point of a balanced load is not connected to the DC supply: it settles at the average of the three leg voltages (the three phase currents must add to zero).',
      equation: `vnN = (vaN + vbN + vcN)/3 = ${formatV((vx[0] + vx[1] + vx[2]) / 3)},  van = vaN − vnN`,
      physics: sixStep
        ? 'With two legs up and one down (or one up, two down) the neutral is at 2/3 or 1/3 of Vdc, giving phase voltages of ±Vdc/3 and ±2Vdc/3: the six-step staircase.'
        : 'As the legs switch, the neutral jumps between 0, Vdc/3, 2Vdc/3 and Vdc, so van takes the levels 0, ±Vdc/3 and ±2Vdc/3; averaged over a carrier period it follows the sine reference.',
      whatIf: 'Triplen harmonics (3rd, 9th …) are the same in all three legs, so the neutral absorbs them: the phase and line voltages contain none.',
    })
  } else
    cards.push({
      id: 'vo',
      question: `Why is vo = ${formatV(st.vo)} now?`,
      what: p.topology === 'half' ? `The leg is connected to the ${st.legs[0].gUp || st.legs[0].v > 0 ? 'upper' : 'lower'} rail.` : `Leg A is at ${formatV(st.legs[0].v)}, leg B at ${formatV(st.legs[1].v)}.`,
      why: p.topology === 'half' ? 'The load sits between the leg and the DC midpoint, so it sees ±Vdc/2.' : 'The load sits between the two legs: it sees the difference of the leg voltages — +Vdc, −Vdc or 0 when both legs are on the same rail.',
      equation: p.topology === 'half' ? 'vo = ±Vdc/2' : `vo = vA − vB = ${formatV(st.legs[0].v)} − ${formatV(st.legs[1].v)}`,
      physics: p.modulation === 'quasi' ? `The zero intervals (both legs on the same rail, width 2α = ${2 * p.alphaDeg}°) shape the waveform: V1 = (4Vdc/π)·cos α and the h-th harmonic ∝ cos(h·α).` : p.tc ? 'Pulse-width modulation: the average of vo over one carrier period follows the sine reference.' : 'A square wave: the fundamental is 4/π times the step height, plus every odd harmonic at 1/h of it.',
      whatIf:
        p.modulation === 'quasi'
          ? 'At α = 30° the 3rd harmonic vanishes (cos 90° = 0).'
          : p.modulation === 'spwm-unipolar'
            ? 'Bipolar switching (vo only ±Vdc, never 0) would put the first harmonics around the carrier frequency instead of twice it.'
            : 'Unipolar switching (both legs modulated) would add a zero level and push the harmonics to twice the carrier frequency.',
    })
  if (p.load === 'RL')
    cards.push({
      id: 'lag',
      question: 'Why does the current lag the voltage?',
      what: `The current fundamental lags the voltage fundamental by φ = atan(ωL/R) = ${lagDeg.toFixed(1)}°.`,
      why: 'The inductor resists changes of current: the current builds up through the time constant L/R after each voltage step, so it reaches its peaks later than the voltage.',
      equation: `I1 = V1/|R + jωL| = V1/${formatSI(Math.hypot(p.r, p.omega * p.l), 'Ω')};  φ = ${lagDeg.toFixed(1)}°`,
      physics: `The inductor also filters the harmonics: at h·f1 its reactance is h times larger, so the current (THD ${(m.thdI * 100).toFixed(1)} %) is much smoother than the voltage (THD ${(m.thdV * 100).toFixed(1)} %).`,
      whatIf: 'A larger L means a larger lag, smoother current and longer diode conduction after every commutation.',
    })
  if (st.sv) {
    const s = st.sv
    cards.push({
      id: 'sv',
      question: `Which vectors are applied now (sector ${s.sector + 1})?`,
      what: `The reference vector is at ${fmtDeg((s.sector * 60) + (s.thetaK * 180) / Math.PI)}, inside sector ${s.sector + 1}. In this switching period: T1 = ${formatTime(s.t1)}, T2 = ${formatTime(s.t2)}, T0 = ${formatTime(s.t0)}.`,
      why: 'The inverter can only produce 6 active vectors and 2 zero vectors. Averaged over one switching period, the two vectors next to the reference plus the zero vectors reproduce it exactly (volt-second balance).',
      equation: 'T1 = √3·Ts·|Vref|/Vdc·sin(60° − θ),  T2 = √3·Ts·|Vref|/Vdc·sin θ,  T0 = Ts − T1 − T2',
      physics: `The largest vector the hexagon can hold in every direction has length Vdc/√3: m up to 2/√3 = 1.155, 15.5 % more than sine-triangle PWM (m = ${p.m.toFixed(3)} here).`,
      whatIf: 'Placing T0 as two equal halves (000 at the ends, 111 in the middle) centres every pulse — the seven-segment sequence used here.',
    })
  }
  if (p.tc && !st.sv)
    cards.push({
      id: 'pwm',
      question: 'Why do the pulses switch where they do?',
      what: `At this instant the carrier is ${st.carrier.toFixed(3)}; the leg references are ${st.refs.map((x) => x.toFixed(3)).join(', ')}.`,
      why: 'Each leg is switched up while its reference is above the triangle carrier. The references are sines (shifted 180° for leg B in unipolar mode, 120° in three-phase), so the pulse widths follow them.',
      equation: 'leg x up ⇔ r_x(t) > c(t);  V1 = m·Vdc (single-phase) or VLL1 = (√3/2)·m·Vdc',
      physics: `The output fundamental is ${formatV(m.v1, false)} (peak); the switching harmonics sit around mf = ${p.mf}${p.modulation === 'spwm-unipolar' ? ' — doubled to 2·mf in unipolar mode' : ''}, far from the fundamental, where the load inductance blocks them.`,
      whatIf: 'Raising mf moves the harmonics further away (smoother current) at the price of more switching losses.',
    })
  const dt = st.legs.find((l) => !l.gUp && !l.gLo)
  if (dt)
    cards.push({
      id: 'dead',
      question: `Why are both gates of leg ${dt.name} OFF?`,
      what: `Dead time: for ${formatTime(p.td)} after each command edge neither switch of the leg is gated.`,
      why: `This prevents a short circuit of the DC supply through the two switches. Meanwhile the load current (${formatA(dt.i, true)}) must still flow: it takes the diode on the ${dt.i > 0 ? 'lower' : 'upper'} side, so the leg sits at the ${dt.i > 0 ? 'lower' : 'upper'} rail.`,
      equation: `error per edge pair ≈ Vdc·td = ${formatSI(V * p.td, 'V·s')}`,
      physics: 'The voltage during the dead time depends on the current direction, not on the command: a small distortion that grows with td·fs.',
      whatIf: 'Compare the Analyze table with td = 0: the fundamental drops slightly and low-order harmonics appear.',
    })
  return cards
}

export function invEventLabel(e: RunEvent): string {
  const d = e.device ?? ''
  switch (e.kind) {
    case 'gate-on':
      return `${d} gated ON`
    case 'gate-off':
      return `${d} gate removed`
    case 'igbt-on':
      return `${d} starts conducting`
    case 'igbt-off':
      return `${d} stops conducting`
    case 'diode-on':
      return `${d} starts conducting (freewheeling)`
    case 'diode-off':
      return `${d} stops conducting`
    default:
      return e.kind
  }
}
export function invEventWhy(e: RunEvent): string {
  const d = e.device ?? ''
  switch (e.kind) {
    case 'gate-on':
    case 'gate-off':
      return `The modulator ${e.kind === 'gate-on' ? 'commands' : 'removes'} ${d}. Which device then conducts depends on the direction of the load current.`
    case 'diode-on':
      return `The load current keeps its direction after the leg was switched: it now flows through ${d}, against the new voltage — energy returns to the DC source.`
    case 'diode-off':
      return `The load current reached zero (or the opposite switch took over); ${d} cannot carry reverse current.`
    case 'igbt-on':
      return `${d} is gated and the current flows in its forward direction.`
    case 'igbt-off':
      return `${d} lost its gate or its current reversed; the current moves to another device.`
    default:
      return ''
  }
}

const cyc = (r: InverterRun, deg: number) => r.params.period * (1 + deg / 360) - (r.params.periods === 1 ? r.params.period : 0)

export type InvKind = '1ph' | '3ph' | 'spwm' | 'svpwm'

export function invLessons(kind: InvKind): Array<Lesson<InverterParams, InverterRun, InverterMeasurements, InvState>> {
  if (kind === '1ph')
    return [
      {
        id: 'square',
        title: 'The H-bridge and the square wave',
        summary: 'Two legs, four switches: how DC becomes AC — and why the diodes are needed.',
        check: {
          question: 'Just after the output voltage of an H-bridge with an R-L load reverses, which devices carry the current?',
          options: ['the IGBTs that were just turned ON', 'the diodes beside the switches that were just turned ON', 'none: the current stops'],
          answer: 1,
          explain: 'The inductive load keeps its current flowing in the old direction, which the newly gated IGBTs cannot carry. The diodes across them conduct, and energy flows back to the DC source until the current reverses.',
        },
        base: { topology: 'full', modulation: 'square', load: 'RL' },
        steps: [
          {
            title: 'Diagonal pairs make +Vdc and −Vdc',
            at: (r) => cyc(r, 60),
            channels: ['vo', 'io'],
            look: 'vo is a square wave between +Vdc and −Vdc.',
            body: (st, _m, r) => `For the first half cycle S1 and S4 are switched on: leg A at +Vdc, leg B at 0, so vo = +Vdc = ${formatV(r.params.vdc, false)}. For the second half S3 and S2: vo = −Vdc. Now vo = ${formatV(st.vo)}.`,
          },
          {
            title: 'The current cannot follow instantly',
            at: (r) => cyc(r, 182),
            channels: ['vo', 'io'],
            look: 'Right after the voltage reverses the current is still positive.',
            body: (st, _m, r) => `The voltage has just reversed, but the inductor keeps io = ${formatA(st.io, true)}. It decays with τ = L/R = ${formatTime(r.params.l / r.params.r)} and only then reverses.`,
          },
          {
            title: 'The diodes carry the returning current',
            at: (r) => cyc(r, 182),
            channels: ['vo', 'io', 'iD2', 'iD3'],
            look: 'D2 and D3 conduct until io crosses zero.',
            body: (st) => {
              const d = st.legs.filter((l) => l.kind === 'diode').map((l) => l.conducting).join(' and ')
              return `S3 and S2 are gated, but they can only conduct forward. The positive load current therefore flows through ${d || 'the diodes'}: from the load back into the DC source. P from DC is ${formatW(st.pdc)} — negative: energy returns.`
            },
          },
          {
            title: 'The square wave contains every odd harmonic',
            at: (r) => cyc(r, 90),
            channels: ['vo', 'io'],
            look: 'Analyze → Spectrum: 1, 3, 5, 7 … with amplitudes 1/h.',
            body: (_st, m, r) => `Fundamental ${formatV(m.v1, false)} peak (THEORY 4·Vdc/π = ${formatV((4 * r.params.vdc) / Math.PI, false)}), 3rd ${formatV(m.vHarm[3]?.amp ?? 0, false)}, 5th ${formatV(m.vHarm[5]?.amp ?? 0, false)}. Voltage THD ${(m.thdV * 100).toFixed(1)} %; the inductor filters the current to THD ${(m.thdI * 100).toFixed(1)} %.`,
          },
        ],
      },
      {
        id: 'quasi',
        title: 'Quasi-square wave: removing the 3rd harmonic',
        summary: 'A zero interval of width 2α controls the fundamental and kills chosen harmonics.',
        check: {
          question: 'Which zero-interval half-width α removes the 3rd harmonic?',
          options: ['α = 15°', 'α = 30°', 'α = 60°'],
          answer: 1,
          explain: 'The h-th harmonic of the quasi-square wave is proportional to cos(h·α). For h = 3: cos(3·30°) = cos 90° = 0.',
        },
        base: { topology: 'full', modulation: 'quasi', alphaDeg: 30, load: 'RL' },
        steps: [
          {
            title: 'A third level: zero',
            at: (r) => cyc(r, 15),
            channels: ['vo', 'io'],
            look: 'vo is 0 for α on each side of every polarity change.',
            body: (st) => `Both legs sit on the same rail now, so vo = ${formatV(st.vo)}. Leg B switches 2α later than a square wave would.`,
          },
          {
            title: 'α = 30° removes the 3rd harmonic',
            at: (r) => cyc(r, 90),
            channels: ['vo', 'io'],
            look: 'Analyze → Spectrum: no bar at h = 3.',
            body: (_st, m) => `The h-th harmonic is (4Vdc/(hπ))·cos(h·α); at α = 30° cos(90°) = 0. SIMULATION: V3 = ${formatV(m.vHarm[3]?.amp ?? 0, false)}, while V5 = ${formatV(m.vHarm[5]?.amp ?? 0, false)}. The fundamental is cos 30° = 0.866 of the square wave's: ${formatV(m.v1, false)}.`,
          },
        ],
      },
    ]
  if (kind === '3ph')
    return [
      {
        id: 'sixstep',
        title: 'Six-step operation',
        summary: 'Three legs, 180° each: six switching states per cycle and a stepped phase voltage.',
        check: {
          question: 'In six-step operation, which levels does the phase voltage van take?',
          options: ['0 and ±Vdc', '±Vdc/3 and ±2Vdc/3', '±Vdc/2 only'],
          answer: 1,
          explain: 'The load’s star point sits at the average of the three leg voltages (1/3 or 2/3 of Vdc), so van = vaN − vnN steps through ±Vdc/3 and ±2Vdc/3.',
        },
        base: {},
        steps: [
          {
            title: 'Each leg is up for half a cycle, shifted by 120°',
            at: (r) => cyc(r, 30),
            channels: ['vaN', 'vbN', 'vcN'],
            look: 'Three square waves, 120° apart.',
            body: (st) => `Right now ${st.legs.filter((l) => l.gUp).map((l) => l.name).join(' and ')} ${st.legs.filter((l) => l.gUp).length > 1 ? 'are' : 'is'} up and ${st.legs.filter((l) => !l.gUp).map((l) => l.name).join(' and ')} down. Every 60° one leg changes: six states per cycle.`,
          },
          {
            title: 'The line voltage: quasi-square',
            at: (r) => cyc(r, 30),
            channels: ['vab', 'vbc'],
            look: 'vab has +Vdc, 0 and −Vdc, each 120° / 60° wide.',
            body: (_st, m, r) => `vab = vaN − vbN. It is zero whenever A and B sit on the same rail. Its fundamental is 2√3·Vdc/π = ${formatV((2 * Math.sqrt(3) * r.params.vdc) / Math.PI, false)} (SIMULATION ${formatV(m.v1, false)}).`,
          },
          {
            title: 'The neutral moves: six steps',
            at: (r) => cyc(r, 30),
            channels: ['van', 'vnN', 'ia'],
            look: 'van steps through ±Vdc/3, ±2Vdc/3.',
            body: (st) => `The load neutral floats at (vaN + vbN + vcN)/3 = ${formatV(st.vnN)}. van = vaN − vnN = ${formatV(st.van)}. No 3rd harmonic can flow: the three currents always add to zero.`,
          },
        ],
      },
    ]
  if (kind === 'spwm')
    return [
      {
        id: 'spwm',
        title: 'Sinusoidal PWM in an H-bridge',
        summary: 'Bipolar vs unipolar switching: same fundamental, very different harmonics.',
        check: {
          question: 'Switching from bipolar to unipolar SPWM at the same m, the fundamental of vo…',
          options: ['stays the same; the first harmonics move to about twice the carrier frequency', 'doubles', 'becomes smaller'],
          answer: 0,
          explain: 'Both give V1 = m·Vdc in the linear range. Unipolar switching adds a zero level, and the carrier components of the two legs cancel in vA − vB, so the first harmonic group moves to 2·mf.',
        },
        base: { modulation: 'spwm-bipolar' },
        steps: [
          {
            title: 'Bipolar: the diagonal pairs switch together',
            at: (r) => r.params.period / 4,
            window: (r) => [0, r.params.period],
            channels: ['vo', 'io'],
            look: 'vo jumps between +Vdc and −Vdc every carrier period.',
            body: (_st, m, r) => `Leg B is the complement of leg A: vo is always ±Vdc. The fundamental is m·Vdc = ${formatV(r.params.m * r.params.vdc, false)} (SIMULATION ${formatV(m.v1, false)}); the largest harmonic sits AT the carrier, h = mf = ${r.params.mf}: ${formatV(m.vHarm[r.params.mf]?.amp ?? 0, false)}.`,
          },
          {
            title: 'Unipolar: each leg has its own reference',
            params: { modulation: 'spwm-unipolar' },
            at: (r) => r.params.period / 4,
            window: (r) => [0, r.params.period],
            channels: ['vo', 'io'],
            look: 'vo takes +Vdc and 0 in the positive half cycle: three levels.',
            body: (_st, m, r) => `Leg B follows −r(t). Now vo switches between +Vdc and 0 (or 0 and −Vdc): smaller steps, and the harmonics at mf cancel — the first group moves to 2·mf = ${2 * r.params.mf} (SIMULATION at h = mf: ${formatV(m.vHarm[r.params.mf]?.amp ?? 0, false)}). Voltage THD ${(m.thdV * 100).toFixed(1)} %.`,
          },
          {
            title: 'Overmodulation',
            params: { modulation: 'spwm-bipolar', m: 1.3 },
            at: (r) => r.params.period / 4,
            window: (r) => [0, r.params.period],
            channels: ['vo', 'io'],
            look: 'Near the peaks the pulses merge: no switching for several carrier periods.',
            body: (_st, m, r) => `With m = 1.3 the reference exceeds the carrier near its peaks: pulses drop. V1 = ${formatV(m.v1, false)}, less than m·Vdc = ${formatV(1.3 * r.params.vdc, false)}, and low-order harmonics appear (3rd ${formatV(m.vHarm[3]?.amp ?? 0, false)}).`,
          },
        ],
      },
    ]
  return [
    {
      id: 'sv',
      title: 'Space-vector PWM',
      summary: 'Eight switching states, six sectors, dwell times — and 15 % more voltage than SPWM.',
      check: {
        question: 'Why can SVPWM reach about 15 % more line voltage than sine-triangle PWM?',
        options: ['It switches faster', 'It adds a common (zero-sequence) part to all three legs, which the line voltages do not see', 'It uses a higher DC voltage'],
        answer: 1,
        explain: 'The common part shifts the neutral but cancels in every line voltage. It lets the legs use the DC voltage better: the reference can reach Vdc/√3 (m = 2/√3) instead of Vdc/2.',
      },
      base: {},
      steps: [
        {
          title: 'Eight states, six active vectors',
          at: (r) => r.params.period * (20 / 360),
          window: (r) => [0, r.params.period],
          channels: ['vaN', 'vbN', 'vcN'],
          look: 'The hexagon: each leg state (a b c) is a vector.',
          body: (st) => `With three legs there are 2³ = 8 states. Six produce a voltage vector (100, 110, 010, 011, 001, 101) at 60° steps; 000 and 111 give zero. The reference is now in sector ${(st.sv?.sector ?? 0) + 1}.`,
        },
        {
          title: 'Dwell times from volt-second balance',
          at: (r) => r.params.period * (20 / 360),
          window: (r) => [0, r.params.period / 6],
          channels: ['vaN', 'vbN', 'vcN'],
          look: 'In each switching period: 000 → V1 → V2 → 111 → V2 → V1 → 000.',
          body: (st) => (st.sv ? `In this switching period T1 = ${formatTime(st.sv.t1)} (first adjacent vector), T2 = ${formatTime(st.sv.t2)} (second), T0 = ${formatTime(st.sv.t0)} split between 000 and 111. Their time-weighted average equals the reference vector.` : ''),
        },
        {
          title: 'The zero-sequence: why SVPWM reaches further',
          at: (r) => r.params.period / 4,
          window: (r) => [0, r.params.period],
          channels: ['vaN', 'van', 'vnN'],
          look: 'The leg voltages average to a "double-humped" curve, not a sine.',
          body: (_st, m, r) => `SVPWM is equivalent to adding −(max + min)/2 of the three references to each leg (a triplen "zero sequence"). The load cannot see it (the neutral absorbs it), but it lowers the leg peaks so m can reach 2/√3 = 1.155 before overmodulation. Here VLL1 = ${formatV(m.v1, false)}, THEORY (√3/2)·m·Vdc = ${formatV((Math.sqrt(3) / 2) * r.params.m * r.params.vdc, false)}.`,
        },
      ],
    },
  ]
}

const ratio = (a: number, b: number) => (Math.abs(b) > 1e-12 ? a / b : NaN)

export function invExperiments(kind: InvKind): Array<Experiment<InverterParams, InverterMeasurements>> {
  const lExp: Experiment<InverterParams, InverterMeasurements> = {
    id: 'inductance',
    title: 'Increase the load inductance',
    change: (p) => ({ load: 'RL', l: Math.min(0.5, p.l * 3) }),
    question: (p) => `L goes from ${formatSI(p.l, 'H')} to ${formatSI(Math.min(0.5, p.l * 3), 'H')}. What happens to the current THD and the diode conduction?`,
    choices: ['THD falls, diodes conduct longer', 'THD rises, diodes conduct less', 'Nothing changes'],
    judge: (b, a) => (a.thdI < b.thdI && a.diodeFraction > b.diodeFraction ? 0 : a.thdI > b.thdI && a.diodeFraction < b.diodeFraction ? 1 : 2),
    rows: ['thdI', 'diodeFraction', 'i1', 'eReturned'],
    why: (b, a) => `Current THD ${(b.thdI * 100).toFixed(1)} % → ${(a.thdI * 100).toFixed(1)} %: the reactance hωL blocks the harmonics more. Diode conduction ${(b.diodeFraction * 100).toFixed(1)} % → ${(a.diodeFraction * 100).toFixed(1)} %: the current lags more, so after each switching it keeps the old direction longer and returns through the diodes. Energy returned per cycle: ${formatSI(b.eReturned, 'J')} → ${formatSI(a.eReturned, 'J')}.`,
  }
  const rExp: Experiment<InverterParams, InverterMeasurements> = {
    id: 'rload',
    title: 'Make the load purely resistive',
    change: () => ({ load: 'R' }),
    question: () => 'The inductor is removed (R load). Do the freewheeling diodes still conduct?',
    choices: ['No — the current reverses with the voltage', 'Yes, just as much', 'Yes, even more'],
    judge: (b, a) => (a.diodeFraction < 1e-6 ? 0 : Math.abs(a.diodeFraction - b.diodeFraction) < 0.01 ? 1 : 2),
    rows: ['diodeFraction', 'thdI', 'eReturned'],
    why: (b, a) => `Diode conduction: ${(b.diodeFraction * 100).toFixed(1)} % → ${(a.diodeFraction * 100).toFixed(2)} %. A resistor's current always has the sign of its voltage, so the IGBTs carry it all; nothing returns to the DC source (${formatSI(a.eReturned, 'J')}). The current is now as distorted as the voltage (THD ${(a.thdI * 100).toFixed(1)} %).`,
  }
  if (kind === '1ph')
    return [
      {
        id: 'alpha',
        title: 'Quasi-square: α = 30°',
        change: () => ({ topology: 'full', modulation: 'quasi', alphaDeg: 30 }),
        question: () => 'Switch from a square wave to a quasi-square wave with α = 30°. What happens to the 3rd harmonic?',
        choices: ['It disappears', 'It doubles', 'It stays the same'],
        judge: (b, a) => ((a.vHarm[3]?.amp ?? 0) < 0.001 * a.v1 ? 0 : (a.vHarm[3]?.amp ?? 0) > 1.5 * (b.vHarm[3]?.amp ?? 0) ? 1 : 2),
        rows: ['v1', 'v3', 'thdV'],
        why: (b, a) => `V3: ${formatV(b.vHarm[3]?.amp ?? 0, false)} → ${formatV(a.vHarm[3]?.amp ?? 0, false)}. The h-th harmonic of a quasi-square wave is (4Vdc/(hπ))·cos(hα): at α = 30° the 3rd is cos 90° = 0. The fundamental drops by cos 30° (${formatV(b.v1, false)} → ${formatV(a.v1, false)}) and the THD falls to ${(a.thdV * 100).toFixed(1)} %.`,
      },
      lExp,
      rExp,
      {
        id: 'half',
        title: 'Half bridge instead of full bridge',
        change: () => ({ topology: 'half', modulation: 'square' }),
        question: () => 'Same Vdc, one leg instead of two. What happens to the fundamental output voltage?',
        choices: ['It halves', 'It stays the same', 'It doubles'],
        judge: (b, a) => (Math.abs(ratio(a.v1, b.v1) - 0.5) < 0.02 ? 0 : Math.abs(ratio(a.v1, b.v1) - 1) < 0.02 ? 1 : 2),
        rows: ['v1', 'irms', 'pLoad'],
        why: (b, a) => `V1: ${formatV(b.v1, false)} → ${formatV(a.v1, false)}. A half bridge connects the load between ONE leg and the DC midpoint: it only sees ±Vdc/2. Power drops to a quarter (${formatW(b.pLoad)} → ${formatW(a.pLoad)}).`,
      },
    ]
  if (kind === '3ph')
    return [
      lExp,
      rExp,
      {
        id: 'vdc',
        title: 'Double the DC voltage',
        change: (p) => ({ vdc: Math.min(1000, p.vdc * 2) }),
        question: () => 'Vdc doubles. What happens to the load power?',
        choices: ['×4', '×2', 'unchanged'],
        judge: (b, a) => (Math.abs(ratio(a.pLoad, b.pLoad) - 4) < 0.1 ? 0 : Math.abs(ratio(a.pLoad, b.pLoad) - 2) < 0.1 ? 1 : 2),
        rows: ['v1', 'irms', 'pLoad'],
        why: (b, a) => `Every voltage doubles, so every current doubles and the power ×${ratio(a.pLoad, b.pLoad).toFixed(2)}. Six-step has no control over the amplitude: only Vdc sets it — which is why PWM is used to vary the output.`,
      },
    ]
  if (kind === 'spwm')
    return [
      {
        id: 'unipolar',
        title: 'Bipolar → unipolar',
        change: () => ({ modulation: 'spwm-unipolar' }),
        question: (p) => `Switch from bipolar to unipolar SPWM (mf = ${p.mf}). Where is the first group of switching harmonics?`,
        choices: ['Around 2·mf', 'Around mf', 'At low orders (3, 5, 7)'],
        judge: (_b, a) => {
          const mf = Math.round((a.vHarm.length - 11) / 4)
          return (a.vHarm[mf]?.amp ?? 0) < 0.01 * a.v1 ? 0 : 1
        },
        rows: ['v1', 'thdV', 'thdI'],
        why: (b, a) => `The fundamental is unchanged (${formatV(b.v1, false)} → ${formatV(a.v1, false)}), but the voltage THD falls ${(b.thdV * 100).toFixed(1)} % → ${(a.thdV * 100).toFixed(1)} %. In unipolar mode the two legs' carrier-frequency components are equal and cancel in vo = vA − vB; the first surviving group sits at 2·mf, so the current is smoother (THD ${(b.thdI * 100).toFixed(1)} % → ${(a.thdI * 100).toFixed(1)} %).`,
      },
      {
        id: 'mf',
        title: 'Double mf',
        change: (p) => ({ mf: Math.min(99, p.mf * 2 + 1) }),
        question: () => 'The carrier becomes twice as fast. What happens to the current THD?',
        choices: ['It falls', 'It rises', 'It stays the same'],
        judge: (b, a) => (a.thdI < 0.8 * b.thdI ? 0 : a.thdI > 1.2 * b.thdI ? 1 : 2),
        rows: ['v1', 'thdV', 'thdI'],
        why: (b, a) => `Current THD ${(b.thdI * 100).toFixed(2)} % → ${(a.thdI * 100).toFixed(2)} %. The voltage THD barely changes (${(b.thdV * 100).toFixed(1)} % → ${(a.thdV * 100).toFixed(1)} %) — the same harmonic energy, but at twice the frequency, where the load reactance is twice as high.`,
      },
      {
        id: 'm',
        title: 'Halve the modulation index',
        change: (p) => ({ m: p.m / 2 }),
        question: (p) => `m goes from ${p.m.toFixed(2)} to ${(p.m / 2).toFixed(2)}. What happens to V1?`,
        choices: ['It halves', 'It stays the same', 'It doubles'],
        judge: (b, a) => (Math.abs(ratio(a.v1, b.v1) - 0.5) < 0.03 ? 0 : 1),
        rows: ['v1', 'i1', 'thdV'],
        why: (b, a) => `V1 ${formatV(b.v1, false)} → ${formatV(a.v1, false)} (×${ratio(a.v1, b.v1).toFixed(3)}): in the linear range the fundamental is proportional to m — the way an inverter controls its output amplitude.`,
      },
    ]
  return [
    {
      id: 'svvsspwm',
      title: 'SVPWM vs SPWM at the same m',
      change: () => ({ modulation: 'spwm' }),
      question: () => 'Same m, same mf: switch from SVPWM to sine-triangle PWM. What happens to the line voltage fundamental?',
      choices: ['About the same (both linear)', 'SPWM is much higher', 'SPWM is much lower'],
      judge: (b, a) => (Math.abs(ratio(a.v1, b.v1) - 1) < 0.02 ? 0 : a.v1 > b.v1 ? 1 : 2),
      rows: ['v1', 'thdV', 'thdI', 'vnNrms'],
      why: (b, a) => `VLL1 ${formatV(b.v1, false)} → ${formatV(a.v1, false)}: inside the linear range both give (√3/2)·m·Vdc. The difference is in the zero sequence (neutral voltage RMS ${formatV(b.vnNrms, false)} → ${formatV(a.vnNrms, false)}) and in the harmonic spread; SVPWM's advantage shows at m > 1, where SPWM saturates.`,
    },
    {
      id: 'linear',
      title: 'Push m to 1.15',
      change: () => ({ m: 1.15 }),
      question: () => 'm = 1.15: inside SVPWM\'s linear range, beyond SPWM\'s. Is VLL1 still (√3/2)·m·Vdc?',
      choices: ['Yes (within regular-sampling effects)', 'No, it saturates'],
      judge: (_b, a) => {
        const vdc = 100
        return Math.abs(a.v1 / ((Math.sqrt(3) / 2) * 1.15 * vdc) - 1) < 0.02 ? 0 : 1
      },
      rows: ['v1', 'thdV'],
      why: (_b, a) => `VLL1 = ${formatV(a.v1, false)} vs (√3/2)·1.15·Vdc = ${formatV((Math.sqrt(3) / 2) * 1.15 * 100, false)}. The hexagon's inscribed circle has radius Vdc/√3, i.e. m = 2/√3 ≈ 1.155: SVPWM stays linear almost to there.`,
    },
    lExp,
  ]
}

export function invPredictions(kind: InvKind, seed: number): Array<PredictTask<InverterParams, InverterMeasurements>> {
  const vdc = [100, 200, 400][seed % 3]
  const alpha = [15, 20, 30, 36][seed % 4]
  const m = [0.5, 0.6, 0.8, 0.9][seed % 4]
  if (kind === '1ph')
    return [
      { id: 'v1', prompt: `Full-bridge square wave, Vdc = ${vdc} V. Predict the peak fundamental of vo.`, params: { topology: 'full', modulation: 'square', vdc }, kind: 'number', unit: 'V', answer: (x) => x.v1, tolerance: 0.02, hint: 'Fourier series of a square wave of height Vdc.', theory: (p) => `V1 = 4·Vdc/π = ${formatV((4 * p.vdc) / Math.PI, false)}` },
      { id: 'quasi', prompt: `Quasi-square wave, Vdc = 100 V, α = ${alpha}°. Predict the peak fundamental.`, params: { topology: 'full', modulation: 'quasi', vdc: 100, alphaDeg: alpha }, kind: 'number', unit: 'V', answer: (x) => x.v1, tolerance: 0.02, hint: 'Each zero interval removes a little of the fundamental.', theory: (p) => `V1 = (4·Vdc/π)·cos α = ${formatV(((4 * p.vdc) / Math.PI) * Math.cos((p.alphaDeg * Math.PI) / 180), false)}` },
    ]
  if (kind === '3ph')
    return [
      { id: 'vll', prompt: `Six-step inverter, Vdc = ${vdc} V. Predict the peak fundamental of the line voltage vab.`, params: { vdc }, kind: 'number', unit: 'V', answer: (x) => x.v1, tolerance: 0.02, hint: 'vab is a quasi-square wave with 60° zero intervals.', theory: (p) => `VLL1 = 2√3·Vdc/π = ${formatV((2 * Math.sqrt(3) * p.vdc) / Math.PI, false)}` },
      { id: 'h3', prompt: 'Six-step inverter: is there a 3rd harmonic in the line voltage?', params: {}, kind: 'choice', choices: ['No', 'Yes'], answer: (x) => ((x.vHarm[3]?.amp ?? 0) < 1e-3 * x.v1 ? 0 : 1), hint: 'Triplen harmonics are equal in the three legs.', theory: () => 'Line-voltage harmonics: h = 6k ± 1 only' },
    ]
  if (kind === 'spwm')
    return [
      { id: 'v1', prompt: `Bipolar SPWM, Vdc = ${vdc} V, m = ${m}. Predict the peak fundamental of vo.`, params: { modulation: 'spwm-bipolar', vdc, m }, kind: 'number', unit: 'V', answer: (x) => x.v1, tolerance: 0.02, hint: 'Linear range: proportional to m.', theory: (p) => `V1 = m·Vdc = ${formatV(p.m * p.vdc, false)}` },
      { id: 'uni', prompt: 'Unipolar SPWM: at which order is the first large group of switching harmonics?', params: { modulation: 'spwm-unipolar' }, kind: 'choice', choices: ['Around mf', 'Around 2·mf', 'At 3, 5, 7'], answer: (x) => {
        let best = 2
        for (const h of x.vHarm) if (h.h >= 2 && h.amp > (x.vHarm[best]?.amp ?? 0)) best = h.h
        const mf = Math.round((x.vHarm.length - 11) / 4)
        return Math.abs(best - 2 * mf) <= 3 ? 1 : Math.abs(best - mf) <= 3 ? 0 : 2
      }, hint: 'The two legs\' carrier components cancel in vA − vB.', theory: () => 'First group at 2·mf ± 1 (Bessel series of the two legs)' },
    ]
  return [
    { id: 'vll', prompt: `SVPWM, Vdc = ${vdc} V, m = ${m}. Predict the peak fundamental of vab.`, params: { vdc, m }, kind: 'number', unit: 'V', answer: (x) => x.v1, tolerance: 0.02, hint: 'Same as SPWM inside the linear range.', theory: (p) => `VLL1 = (√3/2)·m·Vdc = ${formatV((Math.sqrt(3) / 2) * p.m * p.vdc, false)}` },
    { id: 'limit', prompt: 'Which modulation index is the largest SVPWM can produce without overmodulation?', params: {}, kind: 'choice', choices: ['m = 1', 'm = 2/√3 ≈ 1.155', 'm = 4/π ≈ 1.27'], answer: () => 1, hint: 'The largest circle inside the hexagon.', theory: () => 'Inscribed circle radius Vdc/√3 ⇒ m = 2/√3' },
  ]
}

