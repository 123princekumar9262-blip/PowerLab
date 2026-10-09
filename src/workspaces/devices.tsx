import { MOSFET_TOPIC } from '../topics/devices.tsx'
import { topicShell } from '../workspace/TopicShell.tsx'

/** Catalogue topic id → the simulation topic that implements it. */
export const TOPICS = { mosfet: MOSFET_TOPIC }
export default topicShell('devices', TOPICS)
