/**
 * Automation Input Types
 *
 * Input types for Automation service layer operations.
 * These types are NOT shared with UI/API - they're specific to the service layer.
 */

import type {
  AutomationContractType,
  CloseOrderType,
  CloseOrderStatus,
  TriggerMode,
} from '@midcurve/shared';

// =============================================================================
// AUTOMATION CONTRACT INPUT TYPES
// =============================================================================

/**
 * Input type for deploying a new automation contract
 */
export interface DeployContractInput {
  /**
   * User ID who owns this contract
   */
  userId: string;

  /**
   * Contract type (protocol)
   */
  contractType: AutomationContractType;

  /**
   * Chain ID to deploy on
   */
  chainId: number;
}

/**
 * Input for updating contract state after deployment
 */
export interface UpdateContractDeploymentInput {
  /**
   * Deployed contract address
   */
  contractAddress: string;

  /**
   * Deployment transaction hash
   */
  deploymentTxHash: string;

  /**
   * Operator address
   */
  operatorAddress: string;

  /**
   * NFPM address for UniswapV3
   */
  nfpmAddress?: string;
}

/**
 * Options for finding automation contracts
 */
export interface FindContractOptions {
  /**
   * Filter by contract type
   */
  contractType?: AutomationContractType;

  /**
   * Filter by chain ID
   */
  chainId?: number;

  /**
   * Filter by active status
   */
  isActive?: boolean;
}

// =============================================================================
// CLOSE ORDER INPUT TYPES
// =============================================================================

/**
 * Input type for registering a new close order
 */
export interface RegisterCloseOrderInput {
  /**
   * Contract ID this order belongs to
   */
  contractId: string;

  /**
   * Order type (protocol)
   */
  orderType: CloseOrderType;

  /**
   * Position ID to close when triggered
   */
  positionId: string;

  /**
   * NFT ID (token ID from NFPM)
   */
  nftId: bigint;

  /**
   * Pool address
   */
  poolAddress: string;

  /**
   * Trigger mode (LOWER, UPPER, or BOTH)
   */
  triggerMode: TriggerMode;

  /**
   * Lower price threshold (sqrtPriceX96 format)
   * Required if triggerMode is LOWER or BOTH
   */
  sqrtPriceX96Lower?: bigint;

  /**
   * Upper price threshold (sqrtPriceX96 format)
   * Required if triggerMode is UPPER or BOTH
   */
  sqrtPriceX96Upper?: bigint;

  /**
   * Address to receive closed position tokens
   */
  payoutAddress: string;

  /**
   * Operator address
   */
  operatorAddress: string;

  /**
   * Order expiration
   */
  validUntil: Date;

  /**
   * Maximum slippage in basis points (e.g., 50 = 0.5%)
   */
  slippageBps: number;
}

/**
 * Input for updating a close order
 */
export interface UpdateCloseOrderInput {
  /**
   * New lower price threshold
   */
  sqrtPriceX96Lower?: bigint;

  /**
   * New upper price threshold
   */
  sqrtPriceX96Upper?: bigint;

  /**
   * New slippage in basis points
   */
  slippageBps?: number;
}

/**
 * Options for finding close orders
 */
export interface FindCloseOrderOptions {
  /**
   * Filter by order type (protocol)
   */
  orderType?: CloseOrderType;

  /**
   * Filter by status
   */
  status?: CloseOrderStatus | CloseOrderStatus[];

  /**
   * Filter by position ID
   */
  positionId?: string;

  /**
   * Filter by contract ID
   */
  contractId?: string;

  /**
   * Filter by pool address
   */
  poolAddress?: string;

  /**
   * Filter by chain ID (via contract)
   */
  chainId?: number;
}

/**
 * Input for marking order as registered (on-chain confirmed)
 */
export interface MarkOrderRegisteredInput {
  /**
   * Close ID from the contract
   */
  closeId: number;

  /**
   * Registration transaction hash
   */
  registrationTxHash: string;
}

/**
 * Input for marking order as triggered
 */
export interface MarkOrderTriggeredInput {
  /**
   * Price that triggered the order (sqrtPriceX96)
   */
  triggerSqrtPriceX96: bigint;
}

/**
 * Input for marking order as executed
 */
export interface MarkOrderExecutedInput {
  /**
   * Execution transaction hash
   */
  executionTxHash: string;

  /**
   * Fee charged in basis points
   */
  executionFeeBps: number;

  /**
   * Amount of token0 received
   */
  amount0Out: bigint;

  /**
   * Amount of token1 received
   */
  amount1Out: bigint;
}

// =============================================================================
// POOL SUBSCRIPTION INPUT TYPES
// =============================================================================

/**
 * Input for creating/updating a pool subscription
 */
export interface UpdatePoolSubscriptionInput {
  /**
   * Pool ID (from Pool table)
   */
  poolId: string;

  /**
   * Whether subscription is active
   */
  isActive?: boolean;

  /**
   * Number of active orders for this pool
   */
  activeOrderCount?: number;

  /**
   * Last known sqrtPriceX96
   */
  lastSqrtPriceX96?: bigint;

  /**
   * Last known tick
   */
  lastTick?: number;
}

/**
 * Options for finding pool subscriptions
 */
export interface FindPoolSubscriptionOptions {
  /**
   * Filter by active status
   */
  isActive?: boolean;

  /**
   * Filter by having active orders
   */
  hasActiveOrders?: boolean;
}
