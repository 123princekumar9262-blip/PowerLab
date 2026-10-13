import type { GuideArticle } from './types.ts'
import { RECTIFIER_GUIDE } from './rectifiers.ts'
import { DCDC_GUIDE } from './dcdc.ts'
import { PWM_GUIDE } from './pwm.ts'
import { INVERTER_GUIDE } from './inverters.ts'
import { DEVICES_GUIDE } from './devices.ts'
import { MAGNETICS_GUIDE } from './magnetics.ts'
import { CONTROL_GUIDE } from './control.ts'
import { DRIVES_GUIDE } from './drives.ts'
import { THERMAL_GUIDE } from './thermal.ts'
import { EV_GUIDE } from './ev.ts'

/**
 * The Lab guide's articles, lab by lab in the catalogue's order and, inside a lab, in learning order.
 * Plain data: no engine imports, so the guide loads without any physics. Every worked example is
 * confirmed by the real simulation, and every "Try it" opens a READY workspace topic with values the
 * workspace accepts — both checked by tests/guide.test.ts.
 */
export const GUIDE: GuideArticle[] = [
  ...RECTIFIER_GUIDE,
  ...DCDC_GUIDE,
  ...PWM_GUIDE,
  ...INVERTER_GUIDE,
  ...DEVICES_GUIDE,
  ...MAGNETICS_GUIDE,
  ...CONTROL_GUIDE,
  ...DRIVES_GUIDE,
  ...THERMAL_GUIDE,
  ...EV_GUIDE,
]
