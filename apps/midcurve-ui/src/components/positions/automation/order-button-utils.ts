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
    direction: 'BASE_TO_QUOTE' | 'QUOTE_TO_BASE';
    quoteToken: string;
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
  // Filter for active orders of the specified trigger mode
  const relevantOrders = orders.filter((order) => {
    const config = order.config as CloseOrderConfig;
    return config.triggerMode === triggerMode && order.status === 'active';
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
 * Generate button label for an existing order.
 *
 * Format: "SL @{price}" or "SL @{price} => {token}"
 *
 * @param order - The close order
 * @param orderType - 'stopLoss' or 'takeProfit'
 * @param tokenConfig - Token configuration
 * @returns Button label string
 */
export function getOrderButtonLabel(
  order: SerializedCloseOrder,
  orderType: 'stopLoss' | 'takeProfit',
  tokenConfig: TokenConfig
): string {
  const config = order.config as CloseOrderConfig;
  const prefix = orderType === 'stopLoss' ? 'SL' : 'TP';

  // Get the relevant sqrtPriceX96 based on order type
  const sqrtPriceX96 =
    orderType === 'stopLoss' ? config.sqrtPriceX96Lower : config.sqrtPriceX96Upper;

  const priceDisplay = formatTriggerPrice(sqrtPriceX96, tokenConfig);

  // Check if swap is enabled
  if (config.swapConfig?.enabled) {
    return `${prefix} @${priceDisplay} => ${tokenConfig.quoteTokenSymbol}`;
  }

  return `${prefix} @${priceDisplay}`;
}

/**
 * Check if a close order has an active status (can be displayed on button).
 */
export function isOrderActive(order: SerializedCloseOrder): boolean {
  return order.status === 'active';
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
