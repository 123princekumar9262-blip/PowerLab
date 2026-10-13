import { dcdcShellTopic } from '../topics/dcdc.tsx'
import { DCDC_ADVANCED_TOPICS } from '../topics/dcdcAdvanced.tsx'
import type { AnyTopic } from '../lab/types.ts'
import { topicShell } from '../workspace/TopicShell.tsx'

/** Catalogue topic id → the simulation topic that implements it (AnyTopic: the advanced converters have their own parameter and run types). */
export const TOPICS: Record<string, AnyTopic> = { buck: dcdcShellTopic('buck'), boost: dcdcShellTopic('boost'), 'buck-boost': dcdcShellTopic('buck-boost'), ...DCDC_ADVANCED_TOPICS }
export default topicShell('dc-dc', TOPICS)
