import { EV_TOPIC } from '../topics/ev.tsx'
import { EV_BATTERY_TOPIC } from '../topics/evBattery.tsx'
import { EV_DCDC_STAGE_TOPIC } from '../topics/evDcdcStage.tsx'
import { topicShell } from '../workspace/TopicShell.tsx'

/** Catalogue topic id → the simulation topic that implements it. */
export const TOPICS = { drivetrain: EV_TOPIC, battery: EV_BATTERY_TOPIC, 'dcdc-stage': EV_DCDC_STAGE_TOPIC }
export default topicShell('ev', TOPICS)
