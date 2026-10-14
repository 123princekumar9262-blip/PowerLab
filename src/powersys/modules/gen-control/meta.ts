import type { PsModuleMeta } from '../../types.ts'

export const meta: PsModuleMeta = {
  id: 'gen-control',
  n: 12,
  title: 'Generator & Frequency Control',
  short: 'Generator & Frequency Control',
  line: 'Holding voltage and frequency: AVR, governors and two-area load-frequency control',
  group: 'Operation and control',
  status: 'ready',
  learn: [
    'why a load change in one area lowers the frequency everywhere, and how the tie line shares it',
    'the two-area steady state with droop: Δf = −ΔP_L/(β₁ + β₂) and the tie-line flow',
    'the area control error ACE = ΔP_tie + B·Δf and how AGC returns Δf and the tie flow to zero',
    'the AVR loop: steady-state error 1/(1 + K) and the Routh limit on the amplifier gain',
  ],
  modes: ['learn', 'explore', 'experiment', 'verify', 'practise'],
  activities: [
    { id: 'tour', title: 'Follow a load step through two areas', mode: 'learn' },
    { id: 'explore-lfc', title: 'Run a load step with AGC on', mode: 'explore' },
    { id: 'explore-avr', title: 'Push the AVR gain past its stability limit', mode: 'explore' },
    { id: 'experiments', title: 'Run three what-if experiments', mode: 'experiment' },
    { id: 'verify', title: 'Check the numbers yourself', mode: 'verify' },
    { id: 'practice', title: 'Answer the practice questions', mode: 'practise' },
  ],
  keywords: ['load frequency control', 'lfc', 'two area', 'tie line', 'area control error', 'ace', 'agc', 'avr', 'excitation', 'governor', 'droop', 'frequency bias', 'routh', 'exciter', 'rocof'],
}
