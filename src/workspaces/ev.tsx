import { EV_TOPIC } from '../topics/ev.tsx'
import { topicShell } from '../workspace/TopicShell.tsx'

/** Catalogue topic id → the simulation topic that implements it. */
export const TOPICS = { drivetrain: EV_TOPIC }
export default topicShell('ev', TOPICS)
