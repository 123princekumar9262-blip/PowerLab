import type { GuideArticle } from './types.ts'

/** Control lab guide. Examples are confirmed by the closed-loop simulations (tests/guide.test.ts). */
export const CONTROL_GUIDE: GuideArticle[] = [
  {
    id: 'why-feedback',
    lab: 'control',
    title: 'Why a converter needs feedback',
    summary: 'A fixed duty gives a voltage that drifts with the load; a loop corrects it.',
    group: 'Converter loops',
    topics: ['buck'],
    blocks: [
      { kind: 'p', text: 'With a fixed duty (open loop) a buck gives Vout ≈ D·Vin only in the ideal case. Real resistances drop voltage, and the drop grows with the load current; a change of Vin moves the output too. A feedback loop measures Vout once per switching period, compares it with the reference Vref and adjusts the duty.' },
      { kind: 'eq', eq: { expr: 'd = Kp·e + Ki·∫e dt + Kd·de/dt,  e = Vref − Vout', note: 'PID controller. The integral term keeps changing the duty as long as any error remains.' } },
      { kind: 'p', text: 'Because of the integral term, the final error goes to zero as long as the loop is stable and the duty is not at its limit.' },
      { kind: 'h', text: 'Worked example' },
      {
        kind: 'example',
        text: 'Buck 24 V → 12 V, L = 100 µH with 50 mΩ resistance, C = 100 µF, 20 kHz; the load steps from 6 Ω to 3 Ω.',
        result: 'Open loop (D = 0.5): the output dips by 1.53 V and stays 0.21 V below 12 V. Closed loop: the dip is 1.27 V, the controller raises the duty to 50.9 %, and the output is back within 1 % after 1.55 ms.',
      },
      { kind: 'try', text: 'Open loop with the load step.', lab: 'control', topic: 'buck', query: { loop: 'open', refStep: 'off' } },
      { kind: 'try', text: 'Closed loop with the same load step.', lab: 'control', topic: 'buck', query: { loop: 'closed', refStep: 'off' } },
    ],
    whyPrompts: ['Why did Vout dip at the load step?', 'Why is there no steady-state error?'],
  },
  {
    id: 'crossover',
    lab: 'control',
    title: 'Crossover frequency and phase margin',
    summary: 'A faster loop responds sooner — until it starts to ring.',
    group: 'Converter loops',
    topics: ['buck'],
    blocks: [
      { kind: 'p', text: 'The crossover frequency fc is where the loop gain falls to 1: roughly the bandwidth of the loop. A higher fc corrects errors sooner. But the controller samples Vout only at the start of each switching period and holds that period’s duty: it always acts with a delay of the order of one period. A delay costs phase, and it costs more at a higher frequency. With less phase margin left at fc, the step response overshoots and rings.' },
      { kind: 'eq', eq: { expr: 'Phase lag of a delay td at the frequency fc: 360°·fc·td', note: 'For a delay of one period at fs = 20 kHz (td = 50 µs): 18° at fc = 1 kHz, 72° at fc = 4 kHz.' } },
      { kind: 'h', text: 'Worked example' },
      {
        kind: 'example',
        text: 'Buck loop (24 V, 20 kHz, auto-tuned PID), reference step 12 V → 15 V, no load step.',
        result: 'fc = 1 kHz: overshoot 2.9 %, settled within 2 % after 0.70 ms. fc = 4 kHz: overshoot 43.9 %, settled only after 3.7 ms.',
      },
      { kind: 'try', text: 'The reference step at fc = 1 kHz.', lab: 'control', topic: 'buck', query: { loadStep: 'off', fcTarget: '1000' } },
      { kind: 'try', text: 'The same step at fc = 4 kHz.', lab: 'control', topic: 'buck', query: { loadStep: 'off', fcTarget: '4000' } },
    ],
    whyPrompts: ['Why does Vout settle without ringing?', 'Why does Vout overshoot and ring?'],
  },
  {
    id: 'boost-rhp',
    lab: 'control',
    title: 'The boost loop and the right-half-plane zero',
    summary: 'In a boost, more duty first makes the output drop.',
    group: 'Converter loops',
    topics: ['boost'],
    blocks: [
      { kind: 'p', text: 'To deliver more current a boost must raise its duty. But a longer ON time also cuts the output off from the inductor for longer in that period, so Vout first drops before it rises. A fast controller would react to that dip by raising the duty even more. In the small-signal model this is a right-half-plane zero, and it limits how fast the loop may be.' },
      { kind: 'eq', eq: { expr: 'f_RHP = (1 − D)²·R/(2π·L)', note: 'It moves down as D grows: a loop tuned at one operating point can become unstable at a higher output voltage.' } },
      { kind: 'h', text: 'Worked example' },
      {
        kind: 'example',
        text: 'Boost 12 V → 24 V, then a reference step to 28 V; L = 100 µH, C = 100 µF, R = 24 Ω, 20 kHz, no load step.',
        result: 'fc = 100 Hz: overshoot 0.05 %, settled after 4.6 ms. fc = 400 Hz: after the step to 28 V the loop is unstable and the output never settles.',
      },
      { kind: 'try', text: 'The boost loop at fc = 100 Hz.', lab: 'control', topic: 'boost', query: { loadStep: 'off', fcTarget: '100' } },
      { kind: 'try', text: 'The same loop at fc = 400 Hz.', lab: 'control', topic: 'boost', query: { loadStep: 'off', fcTarget: '400' } },
    ],
    whyPrompts: ["Why can't the boost loop be made fast?", 'Why does Vout settle without ringing?'],
  },
]
