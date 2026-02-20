/**
 * Close Order Input Types
 *
 * Input types for CloseOrderService.
 * These types are specific to the service layer — not shared with UI/API.
 *
 * All protocol-specific data flows through generic `config` and `state` JSON fields.
 * Callers are responsible for passing correctly-typed JSON matching the protocol.
 */

import type { AutomationState } from '@midcurve/shared';

// =============================================================================
// CLOSE ORDER INPUT TYPES
// =============================================================================

/**
 * Input for creating a new close order record.
 *
 * Called when an OrderRegistered event is received from the chain.
 * Orders are only created in the DB after on-chain confirmation.
 */
export interface CreateCloseOrderInput {
  protocol: string;
  positionId: string;
  sharedContractId?: string;
  orderIdentityHash: string;
  closeOrderHash?: string;
  automationState?: AutomationState;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
}

/**
 * Input for syncing all on-chain state from a getOrder() call.
 *
 * Used for periodic DB refresh from the contract.
 */
export interface SyncFromChainInput {
  state: Record<string, unknown>;
}

/**
 * Options for finding close orders.
 */
export interface FindCloseOrderOptions {
  automationState?: AutomationState | AutomationState[];
}
