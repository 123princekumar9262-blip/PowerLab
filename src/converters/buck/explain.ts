/** Buck explanations: the DC-DC family explanations (dcdc/explain.ts) under the buck names. */
export {
  dcdcStateAt as buckStateAt,
  dcdcWhy as buckWhy,
  formatSlopeA,
  formatSlopeV,
  INTERVAL_NAME,
  voltSecondFromSim,
  eventLabel,
  eventWhy,
  type DcdcPart as BuckPart,
  type DcdcState as BuckState,
  type WhyCard,
} from '../dcdc/explain.ts'
export { segmentAverage } from '../engine.ts'
