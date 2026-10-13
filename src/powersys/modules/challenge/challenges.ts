import { DYNAMIC_CHALLENGES } from './dynamicChallenges.ts'
import { FAULT_CHALLENGES } from './faultChallenges.ts'
import { NETWORK_CHALLENGES } from './networkChallenges.ts'
import type { Challenge } from './types.ts'

/** Every challenge, in the order they are offered: steady state, faults and protection, dynamics. */
export const CHALLENGES: Challenge[] = [...NETWORK_CHALLENGES, ...FAULT_CHALLENGES, ...DYNAMIC_CHALLENGES]
