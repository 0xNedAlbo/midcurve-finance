/**
 * Order Button Utilities
 *
 * Shared utilities for Stop Loss and Take Profit action buttons.
 * Handles price formatting, order filtering, and label generation.
 */

import type { SerializedCloseOrder, TriggerMode } from '@midcurve/api-shared';
import { pricePerToken0InToken1, pricePerToken1InToken0, formatCompactValue } from '@midcurve/shared';

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
 * Typed config from SerializedCloseOrder
 */
interface CloseOrderConfig {
  triggerMode?: TriggerMode;
  sqrtPriceX96Lower?: string;
  sqrtPriceX96Upper?: string;
  swapConfig?: {
    enabled: boolean;
    direction: 'TOKEN0_TO_1' | 'TOKEN1_TO_0';
  };
}

/**
 * Format sqrtPriceX96 to human-readable price using proper token ordering.
 *
 * This is the same logic as CloseOrderCard.tsx formatTriggerPrice.
 * Determines token0/token1 ordering from addresses, not isToken0Quote.
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

/**
 * Convert sqrtPriceX96 to a numeric value for comparison.
 * Returns the price in quote token terms.
 */
function sqrtPriceX96ToNumber(
  sqrtPriceX96: string,
  tokenConfig: TokenConfig
): number {
  try {
    const sqrtPrice = BigInt(sqrtPriceX96);
    const baseIsToken0 =
      BigInt(tokenConfig.baseTokenAddress) < BigInt(tokenConfig.quoteTokenAddress);

    const price = baseIsToken0
      ? pricePerToken0InToken1(sqrtPrice, tokenConfig.baseTokenDecimals)
      : pricePerToken1InToken0(sqrtPrice, tokenConfig.baseTokenDecimals);

    // Convert to number with proper decimal scaling
    return Number(price) / Math.pow(10, tokenConfig.quoteTokenDecimals);
  } catch {
    return 0;
  }
}

/**
 * Find the close order with trigger price closest to current price.
 *
 * For LOWER (stop-loss): Uses sqrtPriceX96Lower
 * For UPPER (take-profit): Uses sqrtPriceX96Upper
 *
 * @param orders - Array of close orders to filter
 * @param currentPriceDisplay - Current price as display string (for parsing)
 * @param triggerMode - 'LOWER' for stop-loss, 'UPPER' for take-profit
 * @param tokenConfig - Token configuration for price conversion
 * @returns The closest order, or undefined if none found
 */
export function findClosestOrder(
  orders: SerializedCloseOrder[],
  currentPriceDisplay: string,
  triggerMode: TriggerMode,
  tokenConfig: TokenConfig
): SerializedCloseOrder | undefined {
  // Filter for active or triggering orders of the specified trigger mode
  // Include 'triggering' status to show executing state in UI
  const relevantOrders = orders.filter((order) => {
    const config = order.config as CloseOrderConfig;
    return (
      config.triggerMode === triggerMode &&
      (order.status === 'active' || order.status === 'triggering')
    );
  });

  if (relevantOrders.length === 0) return undefined;
  if (relevantOrders.length === 1) return relevantOrders[0];

  // Parse current price for comparison
  const currentPrice = parseFloat(currentPriceDisplay.replace(/,/g, ''));
  if (isNaN(currentPrice)) return relevantOrders[0];

  // Find order with trigger price closest to current price
  let closestOrder = relevantOrders[0];
  let closestDistance = Infinity;

  for (const order of relevantOrders) {
    const config = order.config as CloseOrderConfig;
    const sqrtPriceX96 =
      triggerMode === 'LOWER' ? config.sqrtPriceX96Lower : config.sqrtPriceX96Upper;

    if (!sqrtPriceX96) continue;

    const triggerPrice = sqrtPriceX96ToNumber(sqrtPriceX96, tokenConfig);
    const distance = Math.abs(triggerPrice - currentPrice);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestOrder = order;
    }
  }

  return closestOrder;
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
 * @param order - The close order
 * @param orderType - 'stopLoss' or 'takeProfit'
 * @param tokenConfig - Token configuration
 * @returns Structured label data for rendering
 */
export function getOrderButtonLabel(
  order: SerializedCloseOrder,
  orderType: 'stopLoss' | 'takeProfit',
  tokenConfig: TokenConfig
): OrderButtonLabel {
  const config = order.config as CloseOrderConfig;
  const prefix = orderType === 'stopLoss' ? 'SL' : 'TP';

  // Get the relevant sqrtPriceX96 based on order type
  const sqrtPriceX96 =
    orderType === 'stopLoss' ? config.sqrtPriceX96Lower : config.sqrtPriceX96Upper;

  const priceDisplay = formatTriggerPrice(sqrtPriceX96, tokenConfig);

  // Check if swap is enabled
  if (config.swapConfig?.enabled) {
    // Determine target token based on swap direction
    // First determine which token is token0 (lower address) vs token1 (higher address)
    const baseIsToken0 =
      BigInt(tokenConfig.baseTokenAddress) < BigInt(tokenConfig.quoteTokenAddress);

    // TOKEN0_TO_1 means swapping token0 → token1 (target is token1)
    // TOKEN1_TO_0 means swapping token1 → token0 (target is token0)
    const targetIsToken1 = config.swapConfig.direction === 'TOKEN0_TO_1';
    const targetIsBase = baseIsToken0 ? !targetIsToken1 : targetIsToken1;
    const targetSymbol = targetIsBase
      ? tokenConfig.baseTokenSymbol
      : tokenConfig.quoteTokenSymbol;
    return { prefix, priceDisplay, targetSymbol, hasSwap: true };
  }

  return { prefix, priceDisplay, hasSwap: false };
}

/**
 * Check if a close order has a displayable status (active or executing).
 */
export function isOrderActive(order: SerializedCloseOrder): boolean {
  return order.status === 'active' || order.status === 'triggering';
}

/**
 * Check if a close order is currently executing.
 */
export function isOrderExecuting(order: SerializedCloseOrder): boolean {
  return order.status === 'triggering';
}

/**
 * Get the trigger price from an order based on its type.
 */
export function getOrderTriggerPrice(
  order: SerializedCloseOrder,
  orderType: 'stopLoss' | 'takeProfit'
): string | undefined {
  const config = order.config as CloseOrderConfig;
  return orderType === 'stopLoss' ? config.sqrtPriceX96Lower : config.sqrtPriceX96Upper;
}
