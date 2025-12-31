/**
 * Strategy Ledger Event Types
 *
 * Unified event taxonomy for all strategy financial activity.
 * These events track all capital movements, income, and expenses.
 */

/**
 * Strategy Ledger Event Type
 *
 * Categorized by financial activity type:
 *
 * **Funding:**
 * - INVESTOR_DEPOSIT: External capital injection from investor
 * - INVESTOR_WITHDRAW: External capital withdrawal to investor
 *
 * **Asset Movement:**
 * - BUY: Purchase of an asset (increases holdings)
 * - SELL: Sale of an asset (decreases holdings)
 *
 * **Position Lifecycle:**
 * - POSITION_ENTER: Opening a new position (e.g., entering UniswapV3 LP)
 * - POSITION_INCREASE: Adding to an existing position
 * - POSITION_DECREASE: Reducing an existing position
 * - POSITION_EXIT: Closing a position entirely
 *
 * **Income:**
 * - FEE_EARNED: Trading fees collected from LP activity
 * - YIELD_EARNED: Yield from staking or lending
 * - FUNDING_RECEIVED: Funding rate payments received (perpetuals)
 * - FUNDING_PAID: Funding rate payments made (negative income)
 *
 * **Costs:**
 * - FEE_PAID: Transaction fees, exchange fees, etc.
 * - GAS_PAID: Network gas costs
 *
 * **Internal:**
 * - ALLOCATION_TO_POSITION: Capital allocated to a specific position
 * - ALLOCATION_FROM_POSITION: Capital returned from a position
 */
export type StrategyLedgerEventType =
  // Funding
  | 'INVESTOR_DEPOSIT'
  | 'INVESTOR_WITHDRAW'
  // Asset Movement
  | 'BUY'
  | 'SELL'
  // Position Lifecycle
  | 'POSITION_ENTER'
  | 'POSITION_INCREASE'
  | 'POSITION_DECREASE'
  | 'POSITION_EXIT'
  // Income
  | 'FEE_EARNED'
  | 'YIELD_EARNED'
  | 'FUNDING_RECEIVED'
  | 'FUNDING_PAID' // Negative income, not expense
  // Costs
  | 'FEE_PAID'
  | 'GAS_PAID'
  // Internal
  | 'ALLOCATION_TO_POSITION'
  | 'ALLOCATION_FROM_POSITION';

/**
 * Event type categories for grouping and filtering
 */
export const EVENT_TYPE_CATEGORIES = {
  funding: ['INVESTOR_DEPOSIT', 'INVESTOR_WITHDRAW'] as const,
  assetMovement: ['BUY', 'SELL'] as const,
  positionLifecycle: [
    'POSITION_ENTER',
    'POSITION_INCREASE',
    'POSITION_DECREASE',
    'POSITION_EXIT',
  ] as const,
  income: ['FEE_EARNED', 'YIELD_EARNED', 'FUNDING_RECEIVED', 'FUNDING_PAID'] as const,
  costs: ['FEE_PAID', 'GAS_PAID'] as const,
  internal: ['ALLOCATION_TO_POSITION', 'ALLOCATION_FROM_POSITION'] as const,
} as const;

/**
 * Check if an event type is a funding event
 */
export function isFundingEvent(eventType: StrategyLedgerEventType): boolean {
  return EVENT_TYPE_CATEGORIES.funding.includes(eventType as typeof EVENT_TYPE_CATEGORIES.funding[number]);
}

/**
 * Check if an event type is an asset movement event
 */
export function isAssetMovementEvent(eventType: StrategyLedgerEventType): boolean {
  return EVENT_TYPE_CATEGORIES.assetMovement.includes(eventType as typeof EVENT_TYPE_CATEGORIES.assetMovement[number]);
}

/**
 * Check if an event type is a position lifecycle event
 */
export function isPositionLifecycleEvent(eventType: StrategyLedgerEventType): boolean {
  return EVENT_TYPE_CATEGORIES.positionLifecycle.includes(eventType as typeof EVENT_TYPE_CATEGORIES.positionLifecycle[number]);
}

/**
 * Check if an event type is an income event
 */
export function isIncomeEvent(eventType: StrategyLedgerEventType): boolean {
  return EVENT_TYPE_CATEGORIES.income.includes(eventType as typeof EVENT_TYPE_CATEGORIES.income[number]);
}

/**
 * Check if an event type is a cost event
 */
export function isCostEvent(eventType: StrategyLedgerEventType): boolean {
  return EVENT_TYPE_CATEGORIES.costs.includes(eventType as typeof EVENT_TYPE_CATEGORIES.costs[number]);
}

/**
 * Check if an event type is an internal allocation event
 */
export function isInternalEvent(eventType: StrategyLedgerEventType): boolean {
  return EVENT_TYPE_CATEGORIES.internal.includes(eventType as typeof EVENT_TYPE_CATEGORIES.internal[number]);
}
