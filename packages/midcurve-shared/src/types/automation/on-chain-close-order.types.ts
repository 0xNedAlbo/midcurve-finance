/**
 * On-Chain Close Order Types
 *
 * Types that mirror the smart contract's OrderStatus, TriggerMode, and SwapDirection enums.
 * These represent on-chain state that can be read via getOrder(nftId, triggerMode).
 *
 * Separated from off-chain execution state (see close-order-execution.types.ts).
 */

// =============================================================================
// Contract Enum Mirrors
// =============================================================================

/**
 * On-chain order status — matches contract OrderStatus enum exactly.
 *
 * NONE:      No order exists at this (nftId, triggerMode) slot
 * ACTIVE:    Order is registered and can be executed
 * EXECUTED:  Order was executed successfully (slot can be overwritten by new registerOrder)
 * CANCELLED: Order was cancelled by owner (slot can be overwritten by new registerOrder)
 */
export const OnChainOrderStatus = {
  NONE: 0,
  ACTIVE: 1,
  EXECUTED: 2,
  CANCELLED: 3,
} as const;
export type OnChainOrderStatus =
  (typeof OnChainOrderStatus)[keyof typeof OnChainOrderStatus];

/**
 * Contract trigger mode — matches contract TriggerMode enum.
 *
 * LOWER: Trigger when currentTick <= triggerTick (stop loss for token0-is-quote)
 * UPPER: Trigger when currentTick >= triggerTick (take profit for token0-is-quote)
 *
 * Note: The semantic meaning (SL vs TP) depends on isToken0Quote of the position.
 */
export const ContractTriggerMode = {
  LOWER: 0,
  UPPER: 1,
} as const;
export type ContractTriggerMode =
  (typeof ContractTriggerMode)[keyof typeof ContractTriggerMode];

/**
 * Contract swap direction — matches contract SwapDirection enum.
 *
 * NONE:        No post-close swap
 * TOKEN0_TO_1: Swap token0 to token1
 * TOKEN1_TO_0: Swap token1 to token0
 */
export const ContractSwapDirection = {
  NONE: 0,
  TOKEN0_TO_1: 1,
  TOKEN1_TO_0: 2,
} as const;
export type ContractSwapDirection =
  (typeof ContractSwapDirection)[keyof typeof ContractSwapDirection];

// =============================================================================
// Off-chain Monitoring State
// =============================================================================

/**
 * Off-chain monitoring state for an on-chain close order.
 *
 * This is managed by our price monitor service and is NOT stored on-chain.
 *
 * idle:       Not being monitored (terminal on-chain status, or not yet started)
 * monitoring: Price monitor is actively watching for trigger condition
 * triggered:  Trigger detected, execution attempt in progress
 * suspended:  Monitoring paused (e.g., max retries exhausted, manual pause)
 */
export type MonitoringState = 'idle' | 'monitoring' | 'triggered' | 'suspended';
