/**
 * Catch-Up Module Exports
 *
 * Provides catch-up functionality for recovering missed position liquidity events
 * when the worker was offline.
 */

export { getLastProcessedBlock, setLastProcessedBlock, updateBlockIfHigher } from './block-tracker';
export { fetchHistoricalEvents, type FetchHistoricalEventsOptions, type HistoricalEvent } from './historical-event-fetcher';
export {
  executeCatchUp,
  executeCatchUpForChains,
  executeCatchUpNonFinalized,
  executeCatchUpNonFinalizedForChains,
  executeCatchUpFinalized,
  executeCatchUpFinalizedForChains,
  executeSinglePositionCatchUpNonFinalized,
  type CatchUpResult,
  type SinglePositionCatchUpResult,
} from './position-liquidity-catchup';

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
