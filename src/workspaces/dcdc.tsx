import { dcdcShellTopic } from '../topics/dcdc.tsx'
import { topicShell } from '../workspace/TopicShell.tsx'

/** Catalogue topic id → the simulation topic that implements it. */
export const TOPICS = { buck: dcdcShellTopic('buck'), boost: dcdcShellTopic('boost'), 'buck-boost': dcdcShellTopic('buck-boost') }
export default topicShell('dc-dc', TOPICS)
