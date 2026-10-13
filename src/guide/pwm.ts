import type { GuideArticle } from './types.ts'

/** PWM lab guide. Examples are confirmed by the PWM simulations (tests/guide.test.ts). */
export const PWM_GUIDE: GuideArticle[] = [
  {
    id: 'duty-average',
    lab: 'pwm',
    title: 'Duty ratio and the average voltage',
    summary: 'A comparator turns a reference into pulses whose average follows it.',
    group: 'Fundamentals',
    topics: ['lab'],
    blocks: [
      { kind: 'p', text: 'A PWM signal is made by a comparator: the gate is HIGH while the reference is above the carrier (a triangle or a sawtooth) and LOW while it is below. A higher reference keeps the gate HIGH for longer in every carrier period.' },
      { kind: 'eq', eq: { expr: 'D = ton/Ts', note: 'Duty ratio: the fraction of each carrier period the output is high.' } },
      { kind: 'eq', eq: { expr: 'Vavg = D·Vdc,  Vrms = √D·Vdc', note: 'Unipolar output (0 or Vdc). The average is what a load with a slow response (a motor, an L-C filter) sees.' } },
      { kind: 'p', text: 'The pulses also contain harmonics at the carrier frequency and its multiples. A filter or an inductive load removes most of them and keeps the average.' },
      { kind: 'h', text: 'Worked example' },
      {
        kind: 'example',
        text: 'Vdc = 100 V, a constant reference giving D = 0.3, unipolar output, triangle carrier.',
        result: 'Average 30.0 V; RMS 54.8 V, which is √0.3·100 V.',
      },
      { kind: 'try', text: 'A constant reference at D = 0.3: move D and watch the average.', lab: 'pwm', topic: 'lab', query: { reference: 'dc', duty: '0.3', output: 'unipolar', periods: '4' } },
    ],
    whyPrompts: ['Why is the gate HIGH?', 'Why does the average follow the reference?'],
  },
  {
    id: 'sine-triangle',
    lab: 'pwm',
    title: 'Sine-triangle PWM and its spectrum',
    summary: 'Pulse widths that follow a sine: the fundamental plus carrier groups.',
    group: 'Fundamentals',
    topics: ['lab'],
    blocks: [
      { kind: 'p', text: 'With a sine reference the pulse width changes from one carrier period to the next and follows the sine. The local average of the output (over one carrier period) reproduces the sine; the modulation index m sets its amplitude.' },
      { kind: 'eq', eq: { expr: 'V1 = m·Vdc/2', note: 'Peak of the fundamental for a bipolar output of ±Vdc/2, linear range m ≤ 1.' } },
      { kind: 'eq', eq: { expr: 'Harmonics at h = k·mf ± j', note: 'mf = fc/f1 is the frequency ratio. The harmonics come in groups around mf, 2·mf, … — far above the fundamental when mf is large.' } },
      { kind: 'p', text: 'Natural sampling compares the reference with the carrier continuously. A digital controller samples the reference once per carrier period (regular sampling), which adds small low-order harmonics.' },
      { kind: 'h', text: 'Worked example' },
      {
        kind: 'example',
        text: 'Vdc = 100 V, m = 0.8, mf = 15 (f1 = 50 Hz), natural sampling, bipolar output.',
        result: 'Fundamental 40.0 V peak. The largest harmonic sits at h = 15 (40.9 V), with sidebands at h = 13 and 17 (11.0 V each). The 3rd and 5th harmonics are practically zero.',
      },
      { kind: 'try', text: 'Sine-triangle PWM at m = 0.8, mf = 15: open the spectrum.', lab: 'pwm', topic: 'lab', query: { reference: 'sine', m: '0.8', mf: '15', output: 'bipolar' } },
    ],
    whyPrompts: ['Why does the average follow the reference?', 'Why are there harmonics near 15·f1?'],
  },
  {
    id: 'multiple-pulse',
    lab: 'pwm',
    title: 'Multiple-pulse (uniform) PWM',
    summary: 'Several equal pulses per half-cycle move the harmonics up.',
    group: 'Methods',
    topics: ['multi-pulse'],
    blocks: [
      { kind: 'p', text: 'In uniform PWM a square reference meets a fast triangle: every half-cycle of the output contains p pulses of the same width δ. The full bridge steers them: positive pulses in the first half-cycle, negative pulses in the second.' },
      { kind: 'eq', eq: { expr: 'δ = M·180°/p', note: 'Width of each pulse; M is the modulation index (0 to 1).' } },
      { kind: 'eq', eq: { expr: 'Vrms = Vdc·√(p·δ/180°) = Vdc·√M', note: 'The RMS depends on M only, not on how the on-time is split.' } },
      { kind: 'p', text: 'One pulse per half-cycle has a large 3rd harmonic. Splitting it into p pulses moves the largest harmonics up to a band near 2p ± 1, which a load inductance filters more easily. The price: less fundamental for the same M.' },
      { kind: 'h', text: 'Worked example' },
      {
        kind: 'example',
        text: 'Full bridge, Vdc = 100 V, M = 0.5.',
        result: 'p = 1 (one 90° pulse): V1 = 90.0 V peak and the largest harmonic is the 3rd (30.0 V). p = 5 (five 18° pulses): V1 = 64.5 V and the largest harmonic moves to h = 9 (45.2 V). The RMS is 70.7 V in both cases.',
      },
      { kind: 'try', text: 'One pulse per half-cycle.', lab: 'pwm', topic: 'multi-pulse', query: { p: '1', m: '0.5' } },
      { kind: 'try', text: 'Five pulses per half-cycle: compare the spectrum.', lab: 'pwm', topic: 'multi-pulse', query: { p: '5', m: '0.5' } },
    ],
    whyPrompts: ['Why is each pulse this wide?', 'Why is the fundamental this size?'],
  },
]
