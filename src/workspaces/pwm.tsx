import { PWM_TOPIC } from '../topics/pwm.tsx'
import { topicShell } from '../workspace/TopicShell.tsx'

/** Catalogue topic id → the simulation topic that implements it. */
export const TOPICS = { lab: PWM_TOPIC }
export default topicShell('pwm', TOPICS)
