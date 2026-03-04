/**
 * Catch-Up Module Exports
 *
 * Provides catch-up functionality for recovering missed close order events
 * when the worker was offline.
 */

export {
  getCloseOrderLastProcessedBlock,
  setCloseOrderLastProcessedBlock,
  updateCloseOrderBlockIfHigher,
  executeCloseOrderCatchUpNonFinalized,
  executeCloseOrderCatchUpFinalized,
  executeCloseOrderCatchUpNonFinalizedForChains,
  executeCloseOrderCatchUpFinalizedForChains,
} from './close-order-catchup';
export type { CatchUpResult as CloseOrderCatchUpResult } from './close-order-catchup';
