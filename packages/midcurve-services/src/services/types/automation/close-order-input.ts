/**
 * Close Order Input Types
 *
 * Input types for OnChainCloseOrderService and CloseOrderExecutionService.
 * These types are specific to the service layer — not shared with UI/API.
 */

import type {
  OnChainOrderStatus,
  ContractTriggerMode,
  ContractSwapDirection,
  MonitoringState,
} from '@midcurve/shared';

// =============================================================================
// ON-CHAIN CLOSE ORDER INPUT TYPES
// =============================================================================

/**
 * Input for creating a new on-chain close order record.
 *
 * Used by the API registration flow when a user registers an order via the UI.
 * Typically the order is already confirmed on-chain before this is called.
 */
export interface CreateOnChainCloseOrderInput {
  positionId: string;
  chainId: number;
  nftId: string;
  triggerMode: ContractTriggerMode;
  contractAddress: string;
  sharedContractId?: string;

  onChainStatus?: OnChainOrderStatus;
  triggerTick?: number;
  slippageBps?: number;
  payoutAddress?: string;
  operatorAddress?: string;
  owner?: string;
  pool?: string;
  validUntil?: Date;

  swapDirection?: ContractSwapDirection;
  swapSlippageBps?: number;

  registrationTxHash?: string;
  registeredAt?: Date;
  closeOrderHash?: string;
  monitoringState?: MonitoringState;
}

/**
 * Input for upserting an order from an on-chain event (OrderRegistered).
 *
 * Used by ProcessCloseOrderEventsRule when indexing contract events.
 * Upserts on (chainId, nftId, triggerMode) unique constraint.
 * All on-chain fields are required since we have the full event data.
 */
export interface UpsertFromOnChainEventInput {
  positionId: string;
  chainId: number;
  nftId: string;
  triggerMode: ContractTriggerMode;
  contractAddress: string;
  sharedContractId?: string;

  onChainStatus: OnChainOrderStatus;
  triggerTick: number;
  slippageBps: number;
  payoutAddress: string;
  operatorAddress: string;
  owner: string;
  pool: string;
  validUntil: Date;
  swapDirection: ContractSwapDirection;
  swapSlippageBps: number;

  registrationTxHash: string;
  blockNumber: number;
  closeOrderHash: string;
}

/**
 * Input for syncing all on-chain fields from a getOrder() call.
 *
 * Used for periodic DB refresh from the contract's ViewFacet.
 * All fields are nullable since the order may be in NONE status.
 */
export interface SyncFromChainInput {
  onChainStatus: OnChainOrderStatus;
  triggerTick: number | null;
  slippageBps: number | null;
  payoutAddress: string | null;
  operatorAddress: string | null;
  owner: string | null;
  pool: string | null;
  validUntil: Date | null;
  swapDirection: ContractSwapDirection;
  swapSlippageBps: number;
  lastSyncBlock: number;
}

/**
 * Options for finding on-chain close orders.
 */
export interface FindOnChainCloseOrderOptions {
  onChainStatus?: OnChainOrderStatus | OnChainOrderStatus[];
  monitoringState?: MonitoringState | MonitoringState[];
  triggerMode?: ContractTriggerMode;
}

// =============================================================================
// CLOSE ORDER EXECUTION INPUT TYPES
// =============================================================================

/**
 * Input for creating a new execution attempt.
 *
 * Created by the trigger consumer when a price threshold is crossed.
 * Captures the trigger context (price, timestamp) at detection time.
 */
export interface CreateCloseOrderExecutionInput {
  onChainCloseOrderId: string;
  positionId: string;
  triggerSqrtPriceX96: string;
  triggeredAt: Date;
}

/**
 * Input for marking an execution as completed (success).
 */
export interface MarkCloseOrderExecutionCompletedInput {
  txHash: string;
  executionSqrtPriceX96?: string;
  executionFeeBps?: number;
  amount0Out?: string;
  amount1Out?: string;
  swapExecution?: Record<string, unknown>;
}

/**
 * Input for marking an execution as failed (permanent failure).
 */
export interface MarkCloseOrderExecutionFailedInput {
  error: string;
}
