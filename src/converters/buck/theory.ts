/**
 * Buck theory — the DC-DC family theory (dcdc/theory.ts) applied to the buck. Kept under the buck
 * names used by the buck panels and tests.
 */
export {
  dcdcExact as buckExact,
  dcdcBoundary as buckBoundary,
  dcdcTextbook as buckTextbook,
  dcdcVoutEstimate as buckVoutEstimate,
  type DcdcExact as BuckExact,
  type DcdcMetrics as BuckMetrics,
  type TextbookValue,
} from '../dcdc/theory.ts'
