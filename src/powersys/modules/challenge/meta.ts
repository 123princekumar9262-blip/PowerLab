import type { PsModuleMeta } from '../../types.ts'

export const meta: PsModuleMeta = {
  id: 'challenge',
  n: 7,
  title: "Engineer's Challenge",
  short: "Engineer's Challenge",
  line: 'Integrated problems that use every module: diagnose, design and decide',
  group: 'Practice',
  status: 'ready',
  learn: [
    'how engineers combine load flow, per unit, faults and stability to make a decision',
    'to design against real limits — voltage, thermal, breaking capacity, clearing time',
    'to check an answer by solving the system again',
  ],
  modes: ['practise', 'learn'],
  activities: [
    { id: 'ch-peak', title: 'Hold the voltage through the evening peak', mode: 'practise' },
    { id: 'ch-restore', title: 'Restore the town after a line fault', mode: 'practise' },
    { id: 'ch-breakers', title: 'Choose the circuit breakers', mode: 'practise' },
    { id: 'ch-grading', title: 'Grade the overcurrent relays', mode: 'practise' },
    { id: 'ch-cct', title: 'Is the protection fast enough?', mode: 'practise' },
    { id: 'ch-frequency', title: 'Survive the loss of the largest generator', mode: 'practise' },
  ],
  keywords: ['challenge', 'integrated', 'design', 'problem', 'exam', 'power system practice', 'voltage control', 'capacitor', 'restoration', 'switching'],
}
