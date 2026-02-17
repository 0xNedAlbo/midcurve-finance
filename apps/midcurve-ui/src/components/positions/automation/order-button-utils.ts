/**
 * Order Button Utilities
 *
 * Shared utilities for Stop Loss and Take Profit action buttons.
 * Handles price formatting, order filtering, and visual state derivation.
 *
 * Button visual state is driven by monitoringState (execution lifecycle),
 * not by onChainStatus (registration state).
 */

import type { SerializedCloseOrder, TriggerMode, MonitoringState } from '@midcurve/api-shared';
import {
  pricePerToken0InToken1,
  pricePerToken1InToken0,
  formatCompactValue,
  tickToSqrtRatioX96,
} from '@midcurve/shared';

/**
 * Token configuration for price calculations
 */
export interface TokenConfig {
  baseTokenAddress: string;
  quoteTokenAddress: string;
  baseTokenDecimals: number;
  quoteTokenDecimals: number;
  baseTokenSymbol: string;
  quoteTokenSymbol: string;
}

/**
 * Visual state for the order button.
 * Derived from monitoringState, determines icon + color.
 */
export type OrderButtonVisualState = 'monitoring' | 'executing' | 'suspended';

/**
 * MonitoringState values that indicate an order should be visible in the button.
 * 'idle' orders are not shown (not yet being monitored or already terminal).
 */
const VISIBLE_MONITORING_STATES: MonitoringState[] = ['monitoring', 'triggered', 'suspended'];

/**
 * Find the order for a trigger mode that should be shown in the button.
 *
 * With the new data model there is at most 1 order per (position, triggerMode)
 * due to the unique constraint. We return it if it's in a visible state.
 */
export function findOrderForTriggerMode(
  orders: SerializedCloseOrder[],
  triggerMode: TriggerMode,
): SerializedCloseOrder | undefined {
  return orders.find(
    (order) =>
      order.triggerMode === triggerMode &&
      VISIBLE_MONITORING_STATES.includes(order.monitoringState)
  );
}

/**
 * Derive the visual state for a button from an order's monitoringState.
 *
 * - 'monitoring' → emerald (watching price)
 * - 'triggered'  → blue (execution in progress)
 * - 'suspended'  → red (execution failed, needs attention)
 */
export function getOrderButtonVisualState(order: SerializedCloseOrder): OrderButtonVisualState {
  if (order.monitoringState === 'triggered') return 'executing';
  if (order.monitoringState === 'suspended') return 'suspended';
  return 'monitoring';
}

/**
 * Structured label data for order buttons.
 * Allows components to render with icons instead of plain text.
 */
export interface OrderButtonLabel {
  /** Order type prefix: "SL" or "TP" */
  prefix: string;
  /** Formatted trigger price */
  priceDisplay: string;
  /** Target token symbol (when swap is enabled) */
  targetSymbol?: string;
  /** Whether swap is enabled for this order */
  hasSwap: boolean;
}

/**
 * Generate button label data for an existing order.
 *
 * Uses triggerTick (explicit column) for price formatting and
 * swapDirection (explicit column) for swap indicator.
 */
export function getOrderButtonLabel(
  order: SerializedCloseOrder,
  orderType: 'stopLoss' | 'takeProfit',
  tokenConfig: TokenConfig
): OrderButtonLabel {
  const prefix = orderType === 'stopLoss' ? 'SL' : 'TP';
  const priceDisplay = formatTriggerPriceFromTick(order.triggerTick, tokenConfig);

  // swapDirection is non-null when a post-close swap is configured
  if (order.swapDirection) {
    const baseIsToken0 =
      BigInt(tokenConfig.baseTokenAddress) < BigInt(tokenConfig.quoteTokenAddress);

    // TOKEN0_TO_1 means swapping token0 → token1 (target is token1)
    // TOKEN1_TO_0 means swapping token1 → token0 (target is token0)
    const targetIsToken1 = order.swapDirection === 'TOKEN0_TO_1';
    const targetIsBase = baseIsToken0 ? !targetIsToken1 : targetIsToken1;
    const targetSymbol = targetIsBase
      ? tokenConfig.baseTokenSymbol
      : tokenConfig.quoteTokenSymbol;
    return { prefix, priceDisplay, targetSymbol, hasSwap: true };
  }

  return { prefix, priceDisplay, hasSwap: false };
}

/**
 * Format a trigger tick to human-readable price.
 *
 * Converts tick → sqrtPriceX96 → price in quote token terms.
 */
export function formatTriggerPriceFromTick(
  triggerTick: number | null,
  tokenConfig: TokenConfig,
): string {
  if (triggerTick === null) return '-';

  try {
    const sqrtPriceX96 = BigInt(tickToSqrtRatioX96(triggerTick).toString());
    return formatTriggerPrice(sqrtPriceX96.toString(), tokenConfig);
  } catch {
    return '-';
  }
}

/**
 * Format sqrtPriceX96 to human-readable price using proper token ordering.
 *
 * Determines token0/token1 ordering from addresses, not isToken0Quote.
 * Kept for backward compatibility (used by CancelOrderConfirmModal, uniswapv3-actions).
 */
export function formatTriggerPrice(
  sqrtPriceX96: string | undefined,
  tokenConfig: TokenConfig
): string {
  if (!sqrtPriceX96 || sqrtPriceX96 === '0') return '-';

  try {
    const sqrtPrice = BigInt(sqrtPriceX96);
    const baseIsToken0 =
      BigInt(tokenConfig.baseTokenAddress) < BigInt(tokenConfig.quoteTokenAddress);

    // Get price in quote token raw units (quote per base)
    const price = baseIsToken0
      ? pricePerToken0InToken1(sqrtPrice, tokenConfig.baseTokenDecimals)
      : pricePerToken1InToken0(sqrtPrice, tokenConfig.baseTokenDecimals);

    return formatCompactValue(price, tokenConfig.quoteTokenDecimals);
  } catch {
    return '-';
  }
}
