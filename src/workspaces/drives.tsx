import { BLDC_TOPIC } from '../topics/bldc.tsx'
import { DRIVE_TOPIC } from '../topics/drives.tsx'
import { INDUCTION_TOPIC } from '../topics/induction.tsx'
import { PMSM_TOPIC } from '../topics/pmsm.tsx'
import { topicShell } from '../workspace/TopicShell.tsx'

/** Catalogue topic id → the simulation topic that implements it. */
export const TOPICS = { 'dc-motor': DRIVE_TOPIC, bldc: BLDC_TOPIC, pmsm: PMSM_TOPIC, induction: INDUCTION_TOPIC }
export default topicShell('drives', TOPICS)
