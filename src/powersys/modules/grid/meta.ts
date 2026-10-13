import type { PsModuleMeta } from '../../types.ts'

export const meta: PsModuleMeta = {
  id: 'grid',
  n: 1,
  title: 'Power Grid Explorer',
  short: 'Grid Explorer',
  line: 'Follow electricity from a power station to a town, through every voltage level',
  group: 'The grid and its quantities',
  status: 'ready',
  learn: ['what each part of the grid is and does', 'why power is transmitted at high voltage', 'how voltage, current, power and losses change along the way'],
  modes: ['learn', 'explore', 'experiment', 'verify', 'practise'],
  activities: [
    { id: 'tour', title: 'Follow the electricity', mode: 'learn' },
    { id: 'inspect', title: 'Inspect five parts of the grid', mode: 'explore' },
    {
      id: 'experiments',
      title: 'Run three what-if experiments',
      mode: 'experiment',
    },
    { id: 'verify', title: 'Check the numbers yourself', mode: 'verify' },
    {
      id: 'practice',
      title: 'Answer the practice questions',
      mode: 'practise',
    },
  ],
  keywords: ['grid', 'single line diagram', 'transmission', 'distribution', 'substation', 'step up', 'voltage levels', 'losses', 'breaker', 'power system'],
}
