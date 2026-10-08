import { LabShell, type TopicEntry } from '../lab/LabShell.tsx'
import { dcdcTopic } from '../../topics/dcdc.tsx'

const ENTRIES: TopicEntry[] = [
  { id: 'buck', label: 'Buck', title: 'Step-down converter', topic: dcdcTopic('buck') },
  { id: 'boost', label: 'Boost', title: 'Step-up converter', topic: dcdcTopic('boost') },
  { id: 'buck-boost', label: 'Buck-Boost', title: 'Inverting buck-boost converter', topic: dcdcTopic('buck-boost') },
  { id: 'advanced', label: 'Advanced', title: 'Planned: Ćuk, SEPIC, flyback, forward', topic: null },
]

/** DC-DC environment: Buck → Boost → Buck-Boost → Advanced. */
export function DcdcLab() {
  return <LabShell eyebrow="DC-DC converters" entries={ENTRIES} />
}
