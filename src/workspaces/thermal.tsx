import { THERMAL_TOPIC } from '../topics/engineering.tsx'
import { topicShell } from '../workspace/TopicShell.tsx'

/** Catalogue topic id → the simulation topic that implements it. */
export const TOPICS = { switch: THERMAL_TOPIC }
export default topicShell('thermal', TOPICS)
