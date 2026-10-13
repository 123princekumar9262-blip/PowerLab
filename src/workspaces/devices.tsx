import { MOSFET_TOPIC } from '../topics/devices.tsx'
import { GAN_TOPIC, IGBT_TOPIC, SIC_TOPIC } from '../topics/devices-wbg.tsx'
import { DIODE_TOPIC } from '../topics/devicesDiode.tsx'
import { SCR_TOPIC } from '../topics/devicesScr.tsx'
import { topicShell } from '../workspace/TopicShell.tsx'

/** Catalogue topic id → the simulation topic that implements it. */
export const TOPICS = { mosfet: MOSFET_TOPIC, diode: DIODE_TOPIC, scr: SCR_TOPIC, igbt: IGBT_TOPIC, sic: SIC_TOPIC, gan: GAN_TOPIC }
export default topicShell('devices', TOPICS)
