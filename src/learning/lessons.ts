import { DEFAULT_PARAMS } from '../simulation/params.ts'
import type { DiodeId, EventKind, LabParams, LoadType, RectifierTopology } from '../types/simulation.ts'

/** Where a lesson step puts the time cursor — always resolved against the simulation. */
export type CursorTarget =
  | { angleDeg: number } // that source angle, in the last (steady-state) cycle
  | { event: EventKind; device?: DiodeId } // first such event in the last cycle

export interface Quiz {
  question: string
  options: string[]
  answer: number
  explain: string
}

export interface LessonStep {
  title: string
  /** Text with {placeholders} filled from the simulation (see facts.ts). */
  body: string
  at?: CursorTarget
  whyOpen?: boolean
  energy?: boolean
  quiz?: Quiz
}

export interface Lesson {
  id: string
  title: string
  summary: string
  topology: RectifierTopology
  load: LoadType
  params: LabParams
  steps: LessonStep[]
}

type P = { source?: Partial<LabParams['source']>; diode?: Partial<LabParams['diode']>; load?: Partial<LabParams['load']>; cycles?: number }
const params = (o: P): LabParams => ({
  source: { ...DEFAULT_PARAMS.source, ...o.source },
  diode: { ...DEFAULT_PARAMS.diode, ...o.diode },
  load: { ...DEFAULT_PARAMS.load, ...o.load },
  sim: { ...DEFAULT_PARAMS.sim, cycles: o.cycles ?? 4 },
})

/**
 * Phase 8 — guided lessons. Each step positions the cursor on a meaningful instant
 * and narrates it with numbers read from the simulation (never hard-coded).
 */
export const LESSONS: Lesson[] = [
  {
    id: 'hw-r',
    title: 'The diode as a one-way valve',
    summary: 'Half-wave rectifier, resistive load, ideal diode.',
    topology: 'half-wave',
    load: 'R',
    params: params({ diode: { model: 'ideal' } }),
    steps: [
      {
        title: 'Positive half-cycle',
        at: { angleDeg: 45 },
        body: 'Vin = {vin}: the anode is above the cathode, so the ideal diode is forward biased and conducts. Watch the circuit — current flows source → D1 → R → back to the source, and Vout = {vout} follows Vin exactly.',
      },
      {
        title: 'The crest',
        at: { event: 'vin-positive-peak' },
        body: 'At the crest Vin = Vm = {vm}. A resistor responds instantly, so the current peaks at the same moment: Io,pk = Vm/R = {iopk}.',
      },
      {
        title: 'Negative half-cycle',
        at: { angleDeg: 270 },
        whyOpen: true,
        body: 'Vin = {vin}. If D1 were ON, current would have to flow backwards through it — impossible. So D1 blocks: Io = 0 and Vout = 0, and the whole source voltage sits across the diode. Its worst case is the peak inverse voltage, PIV = {piv}. Read the WHY chain on the right.',
      },
      {
        title: 'What reaches the load',
        body: 'Only the positive halves reach R. Averaged over a cycle, Vdc = Vm/π = {vdc} — that is the "DC" this rectifier delivers.',
        quiz: {
          question: 'You double R. What happens to the Vout waveform?',
          options: ['Its amplitude halves', 'Unchanged — only the current halves', 'Its amplitude doubles'],
          answer: 1,
          explain: 'With an ideal diode, Vout = Vin whenever D1 conducts — R does not appear. Io = Vout/R is what halves. Try it with the Resistance slider.',
        },
      },
    ],
  },
  {
    id: 'hw-real',
    title: 'The real diode needs 0.7 V',
    summary: 'Half-wave, R load, silicon diode (Vf = 0.7 V).',
    topology: 'half-wave',
    load: 'R',
    params: params({}),
    steps: [
      {
        title: 'Waiting for 0.7 V',
        at: { event: 'diode-on' },
        body: 'D1 turns on only when Vin reaches Vf = {vf}, at θ₁ = {theta1}. Just before that, Vin was positive but below the knee: forward biased, yet not conducting — the "dead zone".',
      },
      {
        title: 'A constant drop',
        at: { angleDeg: 90 },
        body: 'While conducting, the diode holds vD ≈ Vf, so Vout = Vin − Vf. The output peak is {vpk}, not {vm}.',
      },
      {
        title: 'Turning off early',
        at: { event: 'diode-off' },
        body: 'D1 turns off when Vin falls back to Vf, at 180° − θ₁. The conduction angle is γ = {gamma} — a little less than 180°.',
        quiz: {
          question: 'With Vrms = 3 V instead of 12 V, the conduction angle would be…',
          options: ['larger', 'smaller', 'the same'],
          answer: 1,
          explain: 'θ₁ = asin(Vf/Vm) grows as Vm shrinks, so each end of the half-cycle loses a bigger slice. Try Vrms = 3 V.',
        },
      },
    ],
  },
  {
    id: 'bridge-r',
    title: 'Full-wave bridge: both halves work',
    summary: 'Four diodes, two conducting at a time.',
    topology: 'bridge',
    load: 'R',
    params: params({}),
    steps: [
      {
        title: 'Terminal a positive',
        at: { angleDeg: 60 },
        body: 'Terminal a is positive: D1 and D4 conduct together. Follow the moving charge: a → D1 → load → D4 → b.',
      },
      {
        title: 'Terminal b positive',
        at: { angleDeg: 240 },
        body: 'Now b is positive and D2 and D3 take over. Look at the load: its current still flows top to bottom. Reversing the source did not reverse the load current — that is rectification.',
      },
      {
        title: 'Two pulses per cycle',
        body: 'The load gets a pulse every half-cycle: ripple frequency {fr}, and Vdc = {vdc} — about twice the half-wave value. The price: two diode drops (2·Vf) in the path, so Vo,pk = {vpk}.',
      },
      {
        title: 'Diode stress',
        at: { event: 'vin-negative-peak' },
        body: 'At the negative crest the blocking pair each holds about Vm: PIV = {piv}.',
        quiz: {
          question: 'Away from the zero crossings, how many bridge diodes conduct at once?',
          options: ['One', 'Two', 'All four'],
          answer: 1,
          explain: 'Current must cross the bridge twice — into the load through one diode, back to the source through another — so diodes always work in diagonal pairs.',
        },
      },
    ],
  },
  {
    id: 'ct-r',
    title: 'Center-tap: two windings, two diodes',
    summary: 'Full-wave with only two diodes — at a cost.',
    topology: 'center-tap',
    load: 'R',
    params: params({}),
    steps: [
      {
        title: 'Upper winding active',
        at: { angleDeg: 60 },
        body: 'The center-tapped winding provides +vin and −vin. The upper end is positive now, so D1 conducts through the upper half-winding; the lower half is idle.',
      },
      {
        title: 'Lower winding active',
        at: { angleDeg: 240 },
        body: 'Half a cycle later the lower end is positive: D2 conducts. Each half-winding works only half the time.',
      },
      {
        title: 'The price: PIV ≈ 2Vm',
        at: { event: 'vin-negative-peak' },
        whyOpen: true,
        body: 'D1 now has −Vm on its anode and the output (≈ +Vm) on its cathode: PIV = {piv}, about twice the bridge value.',
        quiz: {
          question: 'For the same output, which rectifier needs higher-voltage diodes?',
          options: ['Bridge', 'Center-tap', 'Same rating'],
          answer: 1,
          explain: 'A blocking center-tap diode sees vin from its own winding plus the output voltage ≈ 2Vm; a bridge diode sees about Vm.',
        },
      },
    ],
  },
  {
    id: 'hw-rl',
    title: 'Inductors keep current flowing',
    summary: 'Half-wave with an RL load: lag, negative output, extinction angle.',
    topology: 'half-wave',
    load: 'RL',
    params: params({ cycles: 6 }),
    steps: [
      {
        title: 'Current lags',
        at: { angleDeg: 60 },
        body: 'The current rises more slowly than Vin: the inductor resists change (vL = L·di/dt = {vl}, positive — it is absorbing energy).',
      },
      {
        title: 'Still rising after the crest',
        at: { angleDeg: 120 },
        body: 'Vin peaked at 90°, but io = {io} keeps rising a while longer — the current lags the voltage by the load angle.',
      },
      {
        title: 'Conducting with Vin < 0!',
        at: { angleDeg: 200 },
        whyOpen: true,
        body: 'Vin = {vin} is negative, yet D1 still conducts: the inductor, carrying {il}, reverses its voltage (vL = {vl}) and pushes the current on. Vout = {vout} follows Vin below zero. Read the WHY chain.',
        energy: true,
      },
      {
        title: 'Extinction',
        at: { event: 'diode-off' },
        body: 'At β = {beta} the stored energy is used up: the current reaches zero and D1 finally turns off. Conduction lasted γ = {gamma} (> 180°).',
        quiz: {
          question: 'If L is made larger, the extinction angle β moves…',
          options: ['earlier', 'later', 'it does not change'],
          answer: 1,
          explain: 'More inductance stores more energy and slows the current\'s decay, so it reaches zero later — and the negative area of Vout grows, lowering Vdc.',
        },
      },
    ],
  },
  {
    id: 'hw-rc',
    title: 'The capacitor filter',
    summary: 'Charging pulses, hold-up and ripple.',
    topology: 'half-wave',
    load: 'RC',
    params: params({ cycles: 6 }),
    steps: [
      {
        title: 'Waiting for the capacitor',
        at: { event: 'diode-on' },
        body: 'D1 turns on only when Vin − Vf catches up with the capacitor voltage, at θon = {theta1} — much later than with a resistive load.',
      },
      {
        title: 'The charging pulse',
        at: { angleDeg: 75 },
        body: 'The source refills C and feeds R at the same time. The diode current is large and brief (peak {idpk}) — the whole cycle\'s charge goes in during this short window.',
      },
      {
        title: 'Diode turns off',
        at: { event: 'diode-off' },
        body: 'At θoff = {beta} the source starts falling faster than C would discharge on its own, the diode current drops to zero and D1 turns off.',
      },
      {
        title: 'Hold-up',
        at: { angleDeg: 270 },
        whyOpen: true,
        body: 'Now C alone supplies R and Vout decays exponentially (RC = {tauC}). This droop is the ripple: {ripple} peak-to-peak.',
        quiz: {
          question: 'Doubling C makes the ripple roughly…',
          options: ['half as big', 'twice as big', 'unchanged'],
          answer: 0,
          explain: 'The capacitor discharges with time constant RC; doubling C halves the droop between pulses (ΔV ≈ Vpk/(f·R·C)). Try it — and watch the diode peak current grow.',
        },
      },
    ],
  },
  {
    id: 'bridge-rlc',
    title: 'The choke-input (LC) filter',
    summary: 'Continuous inductor current and a smooth output.',
    topology: 'bridge',
    load: 'RLC',
    params: params({ cycles: 12 }),
    steps: [
      {
        title: 'Current that never stops',
        at: { angleDeg: 45 },
        body: 'iL = {il} and never falls to zero (minimum {ilmin}): continuous conduction. The diodes simply hand the current from one pair to the other at each zero crossing.',
      },
      {
        title: 'Vrect vs Vout',
        at: { angleDeg: 0 },
        body: 'The rectifier output (grey Vrect) is the full-wave rectified sine; the inductor absorbs the difference, so the load voltage stays near its average.',
      },
      {
        title: 'Average out',
        body: 'With continuous iL, Vdc = 2Vm/π − 2Vf = {vdc} exactly, and the ripple is only {ripple}.',
        energy: true,
        quiz: {
          question: 'If L falls below the critical value (≈ R/3ω), the inductor current…',
          options: ['becomes discontinuous', 'gets larger', 'is unaffected'],
          answer: 0,
          explain: 'Below the critical inductance the current reaches zero each half-cycle and the filter behaves more like a capacitor filter (Vdc rises toward the peak).',
        },
      },
    ],
  },
  {
    id: 'energy',
    title: 'Follow the energy',
    summary: 'Where every joule goes in a bridge capacitor filter.',
    topology: 'bridge',
    load: 'RC',
    params: params({ cycles: 6 }),
    steps: [
      {
        title: 'Charging: the source pays',
        at: { angleDeg: 80 },
        energy: true,
        body: 'During the charging pulse the source supplies power; the capacitor absorbs some (charging) and R takes the rest. The ledger always sums to zero — energy is conserved.',
      },
      {
        title: 'Hold-up: the capacitor pays',
        at: { angleDeg: 150 },
        energy: true,
        body: 'All diodes are off and the source supplies nothing. The capacitor gives back its stored energy to keep R powered.',
      },
      {
        title: 'Per cycle',
        energy: true,
        body: 'Over a whole cycle the capacitor only borrows and repays. What the source delivers ends up in R or in the diodes: efficiency {eff}.',
      },
    ],
  },
]
