/**
 * RabbitMQ Message Types
 *
 * Defines the message structures for automation events.
 */

/**
 * Order trigger message - published when price condition is met
 */
export interface OrderTriggerMessage {
  /** Order ID from database */
  orderId: string;
  /** Position ID being closed */
  positionId: string;
  /** Pool address where trigger occurred */
  poolAddress: string;
  /** Chain ID */
  chainId: number;
  /** Current sqrtPriceX96 at trigger time */
  currentPrice: string;
  /** Trigger price boundary that was crossed */
  triggerPrice: string;
  /** Whether this was a lower or upper trigger */
  triggerSide: 'lower' | 'upper';
  /** Timestamp of trigger detection */
  triggeredAt: string;
}

// =============================================================================
// HEDGE VAULT MESSAGES
// =============================================================================

/**
 * Trigger type for hedge vault operations
 */
export type HedgeVaultTriggerType = 'sil' | 'tip' | 'reopen';

/**
 * Hedge vault trigger message - published when SIL/TIP/Reopen condition is met
 */
export interface HedgeVaultTriggerMessage {
  /** Vault ID from database */
  vaultId: string;
  /** On-chain vault contract address */
  vaultAddress: string;
  /** Pool address where trigger occurred */
  poolAddress: string;
  /** Chain ID */
  chainId: number;
  /** Type of trigger (sil, tip, reopen) */
  triggerType: HedgeVaultTriggerType;
  /** Current sqrtPriceX96 at trigger time */
  currentSqrtPriceX96: string;
  /** SIL trigger threshold */
  silSqrtPriceX96: string;
  /** TIP trigger threshold */
  tipSqrtPriceX96: string;
  /** Whether token0 is the quote token (for trigger logic) */
  token0IsQuote: boolean;
  /** Current block number (for reopen cooldown check) */
  currentBlock: string;
  /** Timestamp of trigger detection */
  triggeredAt: string;
}

/**
 * Serialize a message for publishing
 */
export function serializeMessage<T>(message: T): Buffer {
  return Buffer.from(JSON.stringify(message));
}

/**
 * Deserialize a message from consumption
 */
export function deserializeMessage<T>(buffer: Buffer): T {
  return JSON.parse(buffer.toString()) as T;
}
