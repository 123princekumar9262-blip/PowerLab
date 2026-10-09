import { DRIVE_TOPIC } from '../topics/drives.tsx'
import { topicShell } from '../workspace/TopicShell.tsx'

/** Catalogue topic id → the simulation topic that implements it. */
export const TOPICS = { 'dc-motor': DRIVE_TOPIC }
export default topicShell('drives', TOPICS)
