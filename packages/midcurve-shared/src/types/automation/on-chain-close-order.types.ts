/**
 * Close Order Types
 *
 * Contract enum mirrors (OrderStatus, TriggerMode, SwapDirection) for reading on-chain state,
 * plus the off-chain AutomationState that tracks our system's lifecycle for each order.
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
// Automation State
// =============================================================================

/**
 * Off-chain automation lifecycle state for a close order.
 *
 * monitoring: Price monitor is watching for trigger condition
 * executing:  Execution in progress (simulation/signing/broadcasting)
 * retrying:   Execution failed, waiting before retry (60s delay)
 * failed:     Max execution attempts exhausted (terminal — user must re-register)
 *
 * Note: Executed orders are deleted from the DB (execution history lives in AutomationLog).
 */
export const AUTOMATION_STATES = ['monitoring', 'executing', 'retrying', 'failed'] as const;
export type AutomationState = (typeof AUTOMATION_STATES)[number];
