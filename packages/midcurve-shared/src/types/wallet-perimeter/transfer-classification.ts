/**
 * Transfer Classification Types
 *
 * Used by ledger services to determine the financial impact of TRANSFER events.
 * The wallet perimeter service classifies transfers based on whether the source
 * and destination addresses belong to the user or to known protocols.
 */

/**
 * Classification of a position/token transfer.
 *
 * - internal_transfer: Between user's own wallets (no financial impact)
 * - deposit_to_protocol: Sent to a known protocol (vault, staking — stays in perimeter)
 * - withdrawal_from_protocol: Received from a known protocol
 * - transfer_out: Left the user's perimeter (sale, gift, loss)
 * - transfer_in: Entered the user's perimeter (received from external)
 * - unknown: Cannot determine (conservative: treated as within perimeter)
 */
export type TransferClassificationType =
  | 'internal_transfer'
  | 'deposit_to_protocol'
  | 'withdrawal_from_protocol'
  | 'transfer_out'
  | 'transfer_in'
  | 'unknown';

/**
 * Information about a known protocol counterparty in a transfer.
 */
export interface ProtocolCounterparty {
  protocolName: string;
  interactionType: string; // 'vault' | 'staking' | 'bridge' | 'router'
}

/**
 * Result of classifying a transfer event.
 *
 * The ledger service reads `withinPerimeter` to decide financial impact:
 * - true: lifecycle marker, no PnL realization
 * - false: position left perimeter, realize remaining value as PnL
 */
export interface TransferClassification {
  classification: TransferClassificationType;
  withinPerimeter: boolean;
  counterparty: ProtocolCounterparty | null;
}
