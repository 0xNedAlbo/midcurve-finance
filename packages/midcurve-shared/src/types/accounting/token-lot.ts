/**
 * Token Lot Tracking Types
 *
 * Token lots track the cost basis of token acquisitions and disposals.
 * Domain events create/consume lots; journal entries are derived from lot cost basis.
 * This enables multiple cost basis tracking methods (FIFO, LIFO, HIFO, WAC).
 */

// =============================================================================
// Transfer Event Types
// =============================================================================

/**
 * All transfer event types that can create or consume token lots.
 * Used by both TokenLot (acquisition) and TokenLotDisposal (disposal).
 */
export type TokenLotTransferEvent =
  | 'INCREASE_POSITION'
  | 'DECREASE_POSITION'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'VAULT_MINT'
  | 'VAULT_BURN'
  | 'DEPOSIT_TO_PROTOCOL'
  | 'WITHDRAWAL_FROM_PROTOCOL';

/**
 * Transfer events that create new token lots (acquisitions).
 */
export type AcquisitionTransferEvent =
  | 'INCREASE_POSITION'
  | 'TRANSFER_IN'
  | 'VAULT_MINT'
  | 'WITHDRAWAL_FROM_PROTOCOL';

/**
 * Transfer events that consume existing token lots (disposals).
 */
export type DisposalTransferEvent =
  | 'DECREASE_POSITION'
  | 'TRANSFER_OUT'
  | 'VAULT_BURN'
  | 'DEPOSIT_TO_PROTOCOL';
