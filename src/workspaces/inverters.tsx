import { inverterTopic } from '../topics/inverters.tsx'
import { topicShell } from '../workspace/TopicShell.tsx'

/** Catalogue topic id → the simulation topic that implements it. */
export const TOPICS = { '1ph': inverterTopic('1ph'), '3ph': inverterTopic('3ph'), spwm: inverterTopic('spwm'), svpwm: inverterTopic('svpwm') }
export default topicShell('inverters', TOPICS)
