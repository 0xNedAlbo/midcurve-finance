/**
 * Close Order Input Types
 *
 * Input types for CloseOrderService and CloseOrderExecutionService.
 * These types are specific to the service layer — not shared with UI/API.
 *
 * All protocol-specific data flows through generic `config` and `state` JSON fields.
 * Callers are responsible for passing correctly-typed JSON matching the protocol.
 */

import type {
  OnChainOrderStatus,
  MonitoringState,
} from '@midcurve/shared';

// =============================================================================
// CLOSE ORDER INPUT TYPES
// =============================================================================

/**
 * Input for creating a new close order record.
 *
 * Used by the API registration flow when a user registers an order via the UI.
 * Typically the order is already confirmed on-chain before this is called.
 */
export interface CreateCloseOrderInput {
  protocol: string;
  positionId: string;
  sharedContractId?: string;
  orderIdentityHash: string;
  closeOrderHash?: string;
  onChainStatus?: OnChainOrderStatus;
  monitoringState?: MonitoringState;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
}

/**
 * Input for upserting an order from an on-chain event (OrderRegistered).
 *
 * Used by ProcessCloseOrderEventsRule when indexing contract events.
 * Upserts on orderIdentityHash unique constraint.
 * All fields are required since we have the full event data.
 */
export interface UpsertFromOnChainEventInput {
  protocol: string;
  positionId: string;
  sharedContractId?: string;
  orderIdentityHash: string;
  closeOrderHash: string;
  onChainStatus: OnChainOrderStatus;
  monitoringState?: MonitoringState;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
}

/**
 * Input for syncing all on-chain state from a getOrder() call.
 *
 * Used for periodic DB refresh from the contract.
 * onChainStatus is a top-level column; the rest goes into state JSON.
 */
export interface SyncFromChainInput {
  onChainStatus: OnChainOrderStatus;
  state: Record<string, unknown>;
}

/**
 * Options for finding close orders.
 */
export interface FindCloseOrderOptions {
  onChainStatus?: OnChainOrderStatus | OnChainOrderStatus[];
  monitoringState?: MonitoringState | MonitoringState[];
}

// =============================================================================
// CLOSE ORDER EXECUTION INPUT TYPES
// =============================================================================

/**
 * Input for creating a new execution attempt.
 *
 * Created by the trigger consumer when a price threshold is crossed.
 * Captures the trigger context in protocol-specific config JSON.
 */
export interface CreateCloseOrderExecutionInput {
  protocol: string;
  closeOrderId: string;
  positionId: string;
  triggeredAt: Date;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
}

/**
 * Input for marking an execution as completed (success).
 * State JSON contains protocol-specific results (txHash, amounts, etc.).
 */
export interface MarkCloseOrderExecutionCompletedInput {
  state: Record<string, unknown>;
}

/**
 * Input for marking an execution as failed (permanent failure).
 */
export interface MarkCloseOrderExecutionFailedInput {
  error: string;
}
