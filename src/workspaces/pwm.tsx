import { PWM_TOPIC } from '../topics/pwm.tsx'
import { PWM_MULTI_TOPIC } from '../topics/pwmMultiPulse.tsx'
import { topicShell } from '../workspace/TopicShell.tsx'

/** Catalogue topic id → the simulation topic that implements it. */
export const TOPICS = { lab: PWM_TOPIC, 'multi-pulse': PWM_MULTI_TOPIC }
export default topicShell('pwm', TOPICS)
