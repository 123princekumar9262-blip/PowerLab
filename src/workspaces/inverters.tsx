import { inverterTopic } from '../topics/inverters.tsx'
import { INV120_TOPIC } from '../topics/inverters120.tsx'
import { topicShell } from '../workspace/TopicShell.tsx'

/** Catalogue topic id → the simulation topic that implements it. */
export const TOPICS = { '1ph': inverterTopic('1ph'), '3ph': inverterTopic('3ph'), spwm: inverterTopic('spwm'), svpwm: inverterTopic('svpwm'), '120': INV120_TOPIC }
export default topicShell('inverters', TOPICS)
