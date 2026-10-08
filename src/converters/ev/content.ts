import type { CompareResult, CompareRow, Experiment, Lesson, PredictTask, StateView, TextbookValue, WhyCard } from '../../lab/types.ts'
import { formatA, formatSI, formatTime, formatV, formatW } from '../../utils/format.ts'
import type { RunEvent } from '../types.ts'
import { accelTheory, cycleTheory } from './theory.ts'
import { CYCLE_NAME, EV_DEFAULTS, forces, measureEv, refAt, regenMax, roadLoad, simulateEv, tractionMax, type EvMeasurements, type EvParams, type EvRun } from './vehicle.ts'

export { measureEv, simulateEv }

export interface EvState {
  k: number
  t: number
  v: number
  vref: number
  f: number
  fBrake: number
  fAero: number
  fRoad: number
  pWheel: number
  pBatt: number
  iBatt: number
  vBatt: number
  soc: number
  dist: number
  phase: 'standstill' | 'accelerating' | 'cruising' | 'regenerating' | 'braking (friction too)' | 'full throttle'
  /** The motor envelope at this speed: traction and regen force limits [N]. */
  fMax: number
  fRegenMax: number
}

export function evStateAt(r: EvRun, k: number): EvState {
  const p = r.params
  const i = Math.min(r.length - 1, Math.max(0, k))
  const s = r.signals
  const t = r.time[i]
  const v = s.vkmh[i] / 3.6
  const fr = forces(p, t, v)
  const fAero = p.kAero * v * v
  const phase: EvState['phase'] =
    p.cycle === 'accel'
      ? 'full throttle'
      : v < 0.01 && Math.abs(fr.fMotor) < 1e-6
        ? 'standstill'
        : fr.fBrake * v > 1
          ? 'braking (friction too)'
          : fr.fMotor < 0
            ? 'regenerating'
            : Math.abs(refAt(p, t).a) < 1e-9
              ? 'cruising'
              : 'accelerating'
  return {
    k: i,
    t,
    v,
    vref: s.vref ? s.vref[i] / 3.6 : v,
    f: s.f[i],
    fBrake: s.fbrake[i],
    fAero,
    fRoad: roadLoad(p, v),
    pWheel: s.pwheel[i],
    pBatt: s.pbatt[i],
    iBatt: s.ibatt[i],
    vBatt: p.voc - p.rb * s.ibatt[i],
    soc: s.soc[i],
    dist: s.dist[i],
    phase,
    fMax: tractionMax(p, v),
    fRegenMax: regenMax(p, v),
  }
}

export function evView(st: EvState): StateView {
  return {
    badge: { text: st.phase, tone: st.phase === 'regenerating' ? 'on' : st.phase === 'standstill' ? 'off' : 'idle' },
    rows: [
      { k: 't', v: formatTime(st.t), full: true },
      { k: 'speed', v: `${(st.v * 3.6).toFixed(1)} km/h`, tone: 'ok' },
      { k: 'motor force at the wheels', v: `${st.f.toFixed(0)} N` },
      { k: 'battery power', v: formatW(st.pBatt), tone: st.pBatt < 0 ? 'on-d' : undefined },
      { k: 'battery current', v: formatA(st.iBatt, true) },
      { k: 'state of charge', v: `${st.soc.toFixed(3)} %` },
      { k: 'aerodynamic drag', v: `${st.fAero.toFixed(0)} N`, min: 'standard' },
      { k: 'friction brake', v: `${st.fBrake.toFixed(0)} N`, min: 'standard' },
      { k: 'wheel power', v: formatW(st.pWheel), min: 'standard' },
      { k: 'battery terminal voltage', v: formatV(st.vBatt, false), min: 'engineer' },
      { k: 'motor limit (traction / regen)', v: `${st.fMax.toFixed(0)} / ${st.fRegenMax.toFixed(0)} N`, min: 'engineer', full: true },
      { k: 'distance', v: `${(st.dist / 1000).toFixed(3)} km`, min: 'engineer' },
    ],
    path: st.pBatt >= 0 ? `battery → inverter → motor → wheels (${formatW(st.pBatt)})` : `wheels → motor (as generator) → inverter → battery (${formatW(-st.pBatt)})`,
  }
}

export function evWhy(r: EvRun, st: EvState, m: EvMeasurements): WhyCard[] {
  const p = r.params
  const cards: WhyCard[] = []
  const now: Record<EvState['phase'], Omit<WhyCard, 'id' | 'question'>> = {
    standstill: {
      what: `The car is stopped; the battery only supplies the auxiliary load (${formatW(p.aux)}).`,
      why: 'No motion, no mechanical power — but heating, pumps and electronics keep drawing energy, which is why slow city traffic costs range.',
      equation: 'Pbatt = Paux',
      physics: `Over this cycle the auxiliaries used ${formatSI(p.aux * p.duration, 'J')}.`,
      whatIf: 'A higher auxiliary load hurts consumption most at low average speeds.',
    },
    accelerating: {
      what: `Accelerating at ${(st.v * 3.6).toFixed(1)} km/h: the motor pushes ${st.f.toFixed(0)} N, of which ${(st.f - st.fRoad).toFixed(0)} N accelerate the mass.`,
      why: 'Most of the force goes into kinetic energy ½·m·v² — energy that can partly come back when braking.',
      equation: 'F = m·a + ½·ρ·Cd·A·v² + Crr·m·g',
      physics: `Battery power ${formatW(st.pBatt)} = wheel power / η + auxiliaries.`,
      whatIf: 'A heavier car needs proportionally more force for the same acceleration.',
    },
    cruising: {
      what: `Cruising at ${(st.v * 3.6).toFixed(1)} km/h: the motor only overcomes drag (${st.fAero.toFixed(0)} N) and rolling resistance.`,
      why: 'At constant speed no energy goes into motion — every joule is lost to air and tyres. Drag grows with v², its power with v³.',
      equation: 'P = (Crr·m·g + ½·ρ·Cd·A·v²)·v / η + Paux',
      physics: `Battery power now ${formatW(st.pBatt)}.`,
      whatIf: 'Lower Cd·A helps at highway speed; lower mass hardly matters when cruising.',
    },
    regenerating: {
      what: `Braking with the motor: it works as a generator and returns ${formatW(-st.pBatt)} to the battery.`,
      why: 'The kinetic energy of the car is converted back into electricity instead of heat — minus the drivetrain losses on the way back.',
      equation: 'Pbatt = F·v·η + Paux  (F < 0)',
      physics: `Recovered over the cycle (SIMULATION): ${formatSI(m.eRegen, 'J')}.`,
      whatIf: 'If the braking force exceeds the motor\'s regen limit, the friction brakes take the rest — as heat.',
    },
    'braking (friction too)': {
      what: `Hard braking: the motor's regen limit is ${st.fRegenMax.toFixed(0)} N, so the friction brakes add ${st.fBrake.toFixed(0)} N.`,
      why: 'The motor (and the battery\'s charge power) can only absorb so much; anything above is burnt in the brake discs.',
      equation: 'F_brake = |F_req| − min(Tmax·G/r, Pregen/v)',
      physics: `Energy burnt in the brakes over the cycle: ${formatSI(m.eBrake, 'J')}.`,
      whatIf: 'A higher regen limit (or gentler braking) recovers more.',
    },
    'full throttle': {
      what: `Full throttle at ${(st.v * 3.6).toFixed(1)} km/h: the motor delivers ${st.f.toFixed(0)} N — ${st.v < p.vBase ? 'limited by its torque' : 'limited by its power'}.`,
      why: `Below the base speed ${(p.vBase * 3.6).toFixed(0)} km/h the force is constant (Tmax·G/r); above it the power is constant, so the force falls as 1/v.`,
      equation: 'F = min(Tmax·G/r, Pmax/v)',
      physics: `Drag now ${st.fAero.toFixed(0)} N; the battery delivers ${formatW(st.pBatt)} at ${formatA(st.iBatt)}.`,
      whatIf: 'More power shortens the high-speed part; more torque (or gear ratio) the low-speed part.',
    },
  }
  cards.push({ id: 'now', question: `What is happening now? (${st.phase})`, ...now[st.phase] })
  if (p.cycle !== 'accel')
    cards.push({
      id: 'energy',
      question: 'Where does the energy go over the cycle?',
      what: `SIMULATION: ${(m.eChem / 3600).toFixed(1)} Wh from the battery for ${(m.dist / 1000).toFixed(2)} km — ${m.consumption.toFixed(0)} Wh/km.`,
      why: 'Energy goes into drag and rolling resistance (lost), into motion (partly recovered by regeneration), into the drivetrain and battery losses, and into the auxiliaries.',
      equation: 'E = ∫ Pbatt dt,  consumption = E / distance',
      physics: `Regeneration returned ${(m.eRegen / 3600).toFixed(1)} Wh; drivetrain losses ${(m.eDriveLoss / 3600).toFixed(1)} Wh; battery resistance ${(m.eBattLoss / 3600).toFixed(2)} Wh; friction brakes ${(m.eBrake / 3600).toFixed(2)} Wh.`,
      whatIf: `At this consumption a full battery (${(p.capacity / 1000).toFixed(0)} kWh from ${(p.soc0 * 100).toFixed(0)} %) gives about ${m.range.toFixed(0)} km.`,
    })
  else {
    const th = accelTheory(p)
    cards.push({
      id: 'accel',
      question: 'What limits the acceleration?',
      what: `SIMULATION: 0–100 km/h in ${m.t100 === null ? '—' : formatTime(m.t100)}; ${m.vEnd.toFixed(0)} km/h after ${p.duration} s.`,
      why: 'At low speed the motor torque limits the force; above the base speed its power does, and drag grows with v² until it eats all the force at the top speed.',
      equation: 't = ∫ m·dv / (min(Tmax·G/r, Pmax/v) − ½·ρ·Cd·A·v² − Crr·m·g)',
      physics: `Top speed where the force runs out: ${th.vTop.toFixed(0)} km/h (THEORY). The constant-power estimate m·v²/(2·Pmax) gives ${th.t100Textbook.toFixed(2)} s — too optimistic.`,
      whatIf: 'A lighter car or more power shortens the time.',
    })
  }
  cards.push({
    id: 'battery',
    question: 'Why does the battery voltage sag?',
    what: `Now ${formatV(st.vBatt, false)} at ${formatA(st.iBatt, true)} (open-circuit ${formatV(p.voc, false)}).`,
    why: 'The internal resistance drops Rb·I: the harder you pull, the lower the terminal voltage and the more energy is lost as heat in the cells (Rb·I²).',
    equation: 'Pbatt = (Voc − Rb·I)·I  ⇒  I = (Voc − √(Voc² − 4·Rb·P))/(2·Rb)',
    physics: `Peak current over the run ${formatA(m.iPeak)}, battery loss ${(m.eBattLoss / 3600).toFixed(2)} Wh.`,
    whatIf: 'A higher pack voltage carries the same power with less current — and a quarter of the loss at twice the voltage.',
  })
  return cards
}

export function compareEv(r: EvRun, m: EvMeasurements): CompareResult {
  const p = r.params
  const rows: CompareRow[] = []
  const add = (key: string, label: string, unit: string, sim: number | null, exact: number | null, tb: number | null, formula: string, notes: string[], opts: { scale?: number; expected?: string } = {}) => {
    if (sim === null || exact === null) return
    const den = opts.scale ?? Math.max(Math.abs(exact), 1e-30)
    const error = Math.abs(sim - exact) / den
    const textbook: TextbookValue | null = tb === null ? null : { key, value: tb, formula, assumptions: notes }
    rows.push({ key, label, unit, sim, exact, error, tolerance: 0.005, pass: opts.expected ? true : error <= 0.005, absolute: opts.scale !== undefined, textbook, textbookError: tb !== null ? (sim - tb) / Math.max(Math.abs(tb), 1e-30) : null, expected: opts.expected })
  }
  if (p.cycle === 'accel') {
    const th = accelTheory(p)
    add('t100', '0–100 km/h', 's', m.t100, th.t100, th.t100Textbook, 'm·v²/(2·Pmax)', ['constant power from rest: no torque limit, no drag, no rolling resistance'])
    add('vEnd', `Speed after ${p.duration} s`, 'km/h', m.vEnd, th.vEnd, null, '', [])
    return {
      rows,
      allPass: rows.every((x) => x.pass),
      header: 'SIMULATION: fourth-order Runge–Kutta time-stepping of the vehicle at full throttle. THEORY: the time integral t(v) = ∫ m·dv/(F(v) − road load) by Gauss–Legendre quadrature, split at the base speed.',
      note: `Top speed (THEORY): ${th.vTop.toFixed(1)} km/h, where the motor's force equals the road load.`,
    }
  }
  const th = cycleTheory(p)
  const expected = th.limited ? `the motor cannot follow the cycle (limited ${(m.limitedFrac * 100).toFixed(1)} % of the time): the car falls behind, the theory assumes it keeps up` : undefined
  add('dist', 'Distance', 'm', m.dist, th.dist, null, '', [], { expected })
  add('eBatt', 'Battery energy (terminals)', 'J', m.eBatt, th.eBatt, null, '', [], { expected })
  add('eChem', 'Battery energy (drawn, incl. Rb loss)', 'J', m.eChem, th.eChem, th.eIdeal, 'E⁺wheel/η − η·E⁻wheel + Paux·T', ['ideal regeneration (no limit), no battery resistance'], { expected })
  add('cons', 'Consumption', 'Wh/km', m.consumption, th.consumption, th.dist > 1 ? th.eIdeal / 3600 / (th.dist / 1000) : null, 'ideal-regeneration energy / distance', ['no regen limit, no battery resistance'], { expected })
  add('eRegen', 'Energy recovered by regeneration', 'J', m.eRegen, th.eRegen, th.eNeg * p.eta, 'η·E⁻wheel', ['every braking joule through the motor'], { scale: Math.max(th.eRegen, 1e-3 * Math.abs(th.eChem), 1), expected })
  add('eBrake', 'Energy lost in the friction brakes', 'J', m.eBrake, th.eBrake, 0, '0', ['unlimited regeneration'], { scale: Math.max(th.eBrake, 1e-3 * Math.abs(th.eChem), 1), expected })
  if (m.pCruise !== null && th.pCruise !== null) add('pCruise', `Cruise power at ${m.vCruise!.toFixed(0)} km/h`, 'W', m.pCruise, th.pCruise, th.pCruise, '(Crr·m·g + ½·ρ·Cd·A·v²)·v/η + Paux', ['exact under the model'], { expected })
  return {
    rows,
    allPass: rows.every((x) => x.pass),
    header: `${CYCLE_NAME[p.cycle]}. SIMULATION: fourth-order Runge–Kutta time-stepping of the car, its driver and drivetrain. THEORY: the exact energy integrals of the perfectly followed cycle (Gauss–Legendre on every smooth piece). Textbook: ideal regeneration.`,
    note: 'Constant drivetrain efficiency and constant open-circuit voltage; the cycles are synthetic profiles shaped like the test cycles, not the official data.',
  }
}

export function evEventLabel(e: RunEvent): string {
  const L: Record<string, string> = {
    'base-speed': 'Base speed: torque limit → power limit',
    '100kmh': '100 km/h',
    'peak-power': 'Peak battery power',
    'peak-regen': 'Peak regeneration',
    'friction-brake': 'Friction brakes needed',
  }
  return L[e.device ?? ''] ?? e.device ?? e.kind
}
export function evEventWhy(e: RunEvent): string {
  const v = `${(e.values.v ?? 0).toFixed(1)} km/h, battery ${formatW(e.values.p ?? 0)}.`
  if (e.device === 'base-speed') return `${v} Below here the force is capped by the motor's torque; above it by its power, so the force falls as 1/v.`
  if (e.device === 'friction-brake') return `${v} The braking force asked for exceeds the motor's regen limit: the rest becomes heat in the brakes.`
  if (e.device === 'peak-regen') return `${v} The largest braking power flows back into the battery here.`
  return `${v}`
}

type L = Lesson<EvParams, EvRun, EvMeasurements, EvState>
const tOf = (r: EvRun, test: (st: EvState) => boolean) => {
  for (let k = 0; k < r.length; k += 5) if (test(evStateAt(r, k))) return r.time[k]
  return r.params.duration
}

export const EV_LESSONS: L[] = [
  {
    id: 'city',
    title: 'Where the energy goes in the city',
    summary: 'Accelerate, cruise, brake — and get part of it back.',
    base: { cycle: 'urban' },
    steps: [
      {
        title: '1 · Accelerating stores kinetic energy',
        at: (r) => tOf(r, (s) => s.phase === 'accelerating' && s.v > 30 / 3.6),
        window: () => [100, 195],
        channels: ['vkmh', 'f', 'pbatt'],
        look: 'The battery power peaks while the car speeds up.',
        body: (st, _m, r) => `${(st.v * 3.6).toFixed(0)} km/h: the battery delivers ${formatW(st.pBatt)}. Most of it becomes kinetic energy — ½·m·v² = ${formatSI(0.5 * r.params.mass * st.v * st.v, 'J')} so far.`,
      },
      {
        title: '2 · Cruising: only drag and tyres',
        at: () => 150,
        window: () => [100, 195],
        channels: ['vkmh', 'f', 'pbatt'],
        look: 'At constant speed the power drops to a small, steady value.',
        body: (st) => `At ${(st.v * 3.6).toFixed(0)} km/h the motor needs only ${st.f.toFixed(0)} N (drag ${st.fAero.toFixed(0)} N): ${formatW(st.pBatt)} from the battery.`,
      },
      {
        title: '3 · Braking returns energy',
        at: (r) => tOf(r, (s) => s.t > 176 && s.phase === 'regenerating'),
        window: () => [100, 195],
        channels: ['vkmh', 'pbatt', 'ibatt'],
        look: 'The battery power goes negative: current flows into the battery.',
        body: (st, m) => `The motor brakes as a generator: ${formatW(-st.pBatt)} back into the battery. Over the cycle ${(m.eRegen / 3600).toFixed(1)} of ${((m.eChem + m.eRegen) / 3600).toFixed(1)} Wh came back — consumption ${m.consumption.toFixed(0)} Wh/km.`,
      },
    ],
  },
  {
    id: 'accel',
    title: '0–100 km/h: torque, then power',
    summary: 'Full throttle from rest — and why the force falls with speed.',
    base: { cycle: 'accel' },
    steps: [
      {
        title: '1 · Torque-limited',
        at: (r) => 0.5 * (r.events.find((e) => e.device === 'base-speed')?.time ?? 2),
        channels: ['vkmh', 'f', 'pbatt'],
        look: 'The force is flat; the power rises with speed.',
        body: (st, _m, r) => `Below ${(r.params.vBase * 3.6).toFixed(0)} km/h the motor gives its full torque: F = Tmax·G/r = ${st.f.toFixed(0)} N, and the power F·v grows with speed (${formatW(st.pWheel)} now).`,
      },
      {
        title: '2 · Power-limited',
        at: (r) => (r.events.find((e) => e.device === '100kmh')?.time ?? 8),
        channels: ['vkmh', 'f', 'pbatt'],
        look: 'The power is flat at Pmax; the force falls as 1/v — and the acceleration with it.',
        body: (st, m) => `At ${(st.v * 3.6).toFixed(0)} km/h the motor is at its power limit, F = Pmax/v = ${st.f.toFixed(0)} N. 0–100 km/h took ${formatTime(m.t100 ?? NaN)} (SIMULATION).`,
      },
    ],
  },
]

export const EV_EXPERIMENTS: Array<Experiment<EvParams, EvMeasurements>> = [
  {
    id: 'mass',
    title: '30 % more mass',
    change: (p) => ({ mass: p.mass * 1.3 }),
    question: () => 'The car is 30 % heavier. On this cycle, the consumption…',
    choices: ['rises, but by less than 30 %', 'rises by more than 30 %', 'stays the same'],
    judge: (b, a) => (a.consumption / b.consumption > 1.005 && a.consumption / b.consumption < 1.3 ? 0 : a.consumption / b.consumption >= 1.3 ? 1 : 2),
    rows: ['consumption', 'eRegen', 'pPeak'],
    why: (b, a) => `${b.consumption.toFixed(1)} → ${a.consumption.toFixed(1)} Wh/km (+${((a.consumption / b.consumption - 1) * 100).toFixed(1)} %). The extra kinetic energy is partly recovered by regeneration (${(b.eRegen / 3600).toFixed(1)} → ${(a.eRegen / 3600).toFixed(1)} Wh), and drag and auxiliaries do not depend on mass.`,
  },
  {
    id: 'regen',
    title: 'Switch regeneration off',
    change: () => ({ pregen: 0 }),
    question: () => 'The motor no longer brakes (all braking by friction). The consumption…',
    choices: ['rises noticeably', 'stays almost the same', 'falls'],
    judge: (b, a) => (a.consumption / b.consumption > 1.05 ? 0 : a.consumption / b.consumption > 0.99 ? 1 : 2),
    rows: ['consumption', 'eRegen', 'eBrake'],
    why: (b, a) => `${b.consumption.toFixed(1)} → ${a.consumption.toFixed(1)} Wh/km: the ${(b.eRegen / 3600).toFixed(1)} Wh that regeneration recovered are now burnt in the brakes (${(a.eBrake / 3600).toFixed(1)} Wh).`,
  },
  {
    id: 'aero',
    title: 'Cd 20 % lower',
    change: (p) => ({ cd: p.cd * 0.8 }),
    question: () => 'The drag coefficient drops by 20 %. On this cycle the consumption falls by…',
    choices: ['less than 20 % — drag is only part of the load', 'exactly 20 %', 'more than 20 %'],
    judge: (b, a) => (a.consumption / b.consumption > 0.805 ? 0 : a.consumption / b.consumption > 0.795 ? 1 : 2),
    rows: ['consumption', 'pCruise'],
    why: (b, a) => `Consumption ${b.consumption.toFixed(1)} → ${a.consumption.toFixed(1)} Wh/km (−${((1 - a.consumption / b.consumption) * 100).toFixed(1)} %). Only the drag part shrinks; rolling resistance, acceleration, the drivetrain losses and the auxiliaries stay — try it on the highway cycle, where drag dominates.`,
  },
]

export function evPredictions(seed: number): Array<PredictTask<EvParams, EvMeasurements>> {
  const mass = [1400, 1700, 2100][seed % 3]
  return [
    {
      id: 'cruise',
      prompt: 'Highway cycle, cruising at 120 km/h: Cd·A = 0.644 m², m = 1700 kg, Crr = 0.01, η = 90 %, auxiliaries 500 W. Predict the battery power.',
      params: { cycle: 'highway' },
      kind: 'number',
      unit: 'W',
      answer: (m) => m.pCruise ?? NaN,
      tolerance: 0.05,
      hint: 'Drag ½·ρ·Cd·A·v² plus rolling Crr·m·g, times v, divided by η — plus the auxiliaries.',
      theory: (p) => {
        const v = 120 / 3.6
        const pw = (0.5 * 1.2 * p.cd * p.area * v * v + p.crr * p.mass * 9.81) * v
        return `P = (½·ρ·Cd·A·v² + Crr·m·g)·v/η + Paux = ${formatW(pw / p.eta + p.aux)}`
      },
    },
    {
      id: 't100',
      prompt: `Full throttle, m = ${mass} kg, Pmax = 150 kW, Tmax·G/r = 8.4 kN. Predict the 0–100 km/h time.`,
      params: { cycle: 'accel', mass },
      kind: 'number',
      unit: 's',
      answer: (m) => m.t100 ?? NaN,
      tolerance: 0.1,
      hint: 'Torque-limited (constant force) up to the base speed, then power-limited — and drag.',
      theory: (p) => `Constant power alone: m·v²/(2·Pmax) = ${((p.mass * (100 / 3.6) ** 2) / (2 * p.pmax)).toFixed(2)} s — the torque limit at low speed and the drag make it longer.`,
    },
  ]
}

export { EV_DEFAULTS }
