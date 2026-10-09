import { controlTopic } from '../topics/control.tsx'
import { topicShell } from '../workspace/TopicShell.tsx'

/** Catalogue topic id → the simulation topic that implements it. */
export const TOPICS = { buck: controlTopic('buck'), boost: controlTopic('boost') }
export default topicShell('control', TOPICS)
