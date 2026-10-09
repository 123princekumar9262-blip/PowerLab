import { CORE_TOPIC } from '../topics/magnetics.tsx'
import { topicShell } from '../workspace/TopicShell.tsx'

/** Catalogue topic id → the simulation topic that implements it. */
export const TOPICS = { inductor: CORE_TOPIC }
export default topicShell('magnetics', TOPICS)
