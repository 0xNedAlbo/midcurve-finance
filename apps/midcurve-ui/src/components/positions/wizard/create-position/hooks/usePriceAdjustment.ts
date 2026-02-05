/**
 * usePriceAdjustment Hook
 *
 * Watches pool price and recalculates position amounts to ensure they
 * never exceed the original approved/allocated amounts.
 *
 * Algorithm:
 * 1. Calculate L_base = liquidity when investing only the original base amount
 * 2. Calculate L_quote = liquidity when investing only the original quote amount
 * 3. Use min(L_base, L_quote) as the new liquidity
 * 4. Derive new token amounts from this reduced liquidity
 *
 * This guarantees that neither token amount ever exceeds the original allocation,
 * preventing transaction failures due to insufficient approvals or balances.
 */

import { useEffect, useMemo, useRef, useCallback } from 'react';
import type { UniswapV3Pool } from '@midcurve/shared';
import type { PoolSearchTokenInfo } from '@midcurve/api-shared';
import {
  getLiquidityFromTokenAmounts,
  getTokenAmountsFromLiquidity,
  calculatePositionValue,
} from '@midcurve/shared';
import { useWatchUniswapV3PoolPrice } from '@/hooks/pools/useWatchUniswapV3PoolPrice';

export interface UsePriceAdjustmentParams {
  /** The discovered pool with current state */
  discoveredPool: UniswapV3Pool | null;
  /** Original base amount as constraint (raw bigint string) */
  originalBaseAmount: string;
  /** Original quote amount as constraint (raw bigint string) */
  originalQuoteAmount: string;
  /** Lower tick of the position range */
  tickLower: number;
  /** Upper tick of the position range */
  tickUpper: number;
  /** Base token info */
  baseToken: PoolSearchTokenInfo | null;
  /** Quote token info */
  quoteToken: PoolSearchTokenInfo | null;
  /** Whether the hook is enabled */
  enabled: boolean;
  /** Optional polling interval in ms (default: 2000) */
  pollIntervalMs?: number;
}

export interface UsePriceAdjustmentReturn {
  /** Current status of the price adjustment */
  status: 'idle' | 'calculating' | 'ready' | 'error';
  /** Error message if status is 'error' */
  error: string | null;
  /** Adjusted base amount (raw bigint string) */
  adjustedBaseAmount: string;
  /** Adjusted quote amount (raw bigint string) */
  adjustedQuoteAmount: string;
  /** Adjusted liquidity (raw bigint string) */
  adjustedLiquidity: string;
  /** Adjusted total quote value (raw bigint string) */
  adjustedTotalQuoteValue: string;
  /** Current sqrt price X96 from the pool */
  currentSqrtPriceX96: bigint | undefined;
  /** Current tick from the pool */
  currentTick: number | undefined;
  /** Percentage change in price from original */
  priceChangePercent: number | null;
  /** Cancel the price watching subscription */
  cancel: () => Promise<void>;
}

/**
 * Determine if quote token is token0 in the pool
 */
function isQuoteToken0(
  pool: UniswapV3Pool,
  quoteToken: PoolSearchTokenInfo
): boolean {
  const token0Address = (pool.token0.config.address as string).toLowerCase();
  const quoteAddress = quoteToken.address.toLowerCase();
  return token0Address === quoteAddress;
}

/**
 * Calculate price change percentage between two sqrt prices
 */
function calculatePriceChangePercent(
  originalSqrtPriceX96: bigint,
  newSqrtPriceX96: bigint
): number {
  if (originalSqrtPriceX96 === 0n) return 0;

  // Price = sqrtPrice^2 / Q192
  // Price change = (newPrice - oldPrice) / oldPrice
  // = (newSqrt^2 - oldSqrt^2) / oldSqrt^2
  // = (newSqrt/oldSqrt)^2 - 1

  // Use floating point for percentage calculation (precision not critical here)
  const ratio = Number(newSqrtPriceX96) / Number(originalSqrtPriceX96);
  const priceRatio = ratio * ratio;
  return (priceRatio - 1) * 100;
}

export function usePriceAdjustment({
  discoveredPool,
  originalBaseAmount,
  originalQuoteAmount,
  tickLower,
  tickUpper,
  baseToken,
  quoteToken,
  enabled,
  pollIntervalMs = 2000,
}: UsePriceAdjustmentParams): UsePriceAdjustmentReturn {
  // Track original sqrtPrice for comparison
  const originalSqrtPriceRef = useRef<bigint | null>(null);

  // Store original sqrt price when first loaded
  useEffect(() => {
    if (discoveredPool && originalSqrtPriceRef.current === null) {
      originalSqrtPriceRef.current = BigInt(discoveredPool.state.sqrtPriceX96 as string);
    }
  }, [discoveredPool]);

  // Watch pool price using the WebSocket-backed hook
  const {
    sqrtPriceX96BigInt: currentSqrtPriceX96,
    currentTick,
    isLoading,
    cancel,
  } = useWatchUniswapV3PoolPrice({
    poolAddress: discoveredPool?.address ?? null,
    chainId: discoveredPool?.chainId ?? 0,
    enabled: enabled && !!discoveredPool,
    pollIntervalMs,
  });

  // Calculate adjusted amounts based on current price
  const calculation = useMemo(() => {
    // Return idle state if not ready
    if (!discoveredPool || !baseToken || !quoteToken || !enabled) {
      return {
        status: 'idle' as const,
        adjustedBaseAmount: '0',
        adjustedQuoteAmount: '0',
        adjustedLiquidity: '0',
        adjustedTotalQuoteValue: '0',
        priceChangePercent: null,
      };
    }

    // Use current price from watcher, or fallback to pool's stored price if watcher fails
    const effectiveSqrtPriceX96 = currentSqrtPriceX96 ??
      (discoveredPool.state.sqrtPriceX96 ? BigInt(discoveredPool.state.sqrtPriceX96 as string) : null);

    // Return calculating state while loading (but only if we don't have a fallback)
    if (isLoading && !effectiveSqrtPriceX96) {
      return {
        status: 'calculating' as const,
        adjustedBaseAmount: '0',
        adjustedQuoteAmount: '0',
        adjustedLiquidity: '0',
        adjustedTotalQuoteValue: '0',
        priceChangePercent: null,
      };
    }

    // If we still don't have a price, keep calculating
    if (!effectiveSqrtPriceX96) {
      return {
        status: 'calculating' as const,
        adjustedBaseAmount: '0',
        adjustedQuoteAmount: '0',
        adjustedLiquidity: '0',
        adjustedTotalQuoteValue: '0',
        priceChangePercent: null,
      };
    }

    // Parse original amounts
    const origBaseAmount = BigInt(originalBaseAmount || '0');
    const origQuoteAmount = BigInt(originalQuoteAmount || '0');

    // If no original amounts, nothing to adjust
    if (origBaseAmount === 0n && origQuoteAmount === 0n) {
      return {
        status: 'idle' as const,
        adjustedBaseAmount: '0',
        adjustedQuoteAmount: '0',
        adjustedLiquidity: '0',
        adjustedTotalQuoteValue: '0',
        priceChangePercent: null,
      };
    }

    // Validate tick range
    if (tickLower >= tickUpper) {
      return {
        status: 'error' as const,
        adjustedBaseAmount: '0',
        adjustedQuoteAmount: '0',
        adjustedLiquidity: '0',
        adjustedTotalQuoteValue: '0',
        priceChangePercent: null,
      };
    }

    try {
      const quoteIsToken0 = isQuoteToken0(discoveredPool, quoteToken);
      const baseIsToken0 = !quoteIsToken0;

      // Map original amounts to token0/token1
      const origToken0Amount = baseIsToken0 ? origBaseAmount : origQuoteAmount;
      const origToken1Amount = baseIsToken0 ? origQuoteAmount : origBaseAmount;

      // Calculate liquidity using BOTH original amounts
      // This gives us the maximum liquidity achievable with the given constraints
      const maxLiquidity = getLiquidityFromTokenAmounts(
        effectiveSqrtPriceX96,
        tickLower,
        tickUpper,
        origToken0Amount,
        origToken1Amount
      );

      if (maxLiquidity === 0n) {
        // Cannot create position - fall back to original amounts
        return {
          status: 'ready' as const,
          adjustedBaseAmount: origBaseAmount.toString(),
          adjustedQuoteAmount: origQuoteAmount.toString(),
          adjustedLiquidity: '0',
          adjustedTotalQuoteValue: '0',
          priceChangePercent: calculatePriceChangePercent(
            originalSqrtPriceRef.current ?? effectiveSqrtPriceX96,
            effectiveSqrtPriceX96
          ),
        };
      }

      // Calculate token amounts from this liquidity at the current price
      const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
        maxLiquidity,
        effectiveSqrtPriceX96,
        tickLower,
        tickUpper
      );

      // Check if we exceed original amounts and scale down if needed
      let finalLiquidity = maxLiquidity;
      let finalToken0 = token0Amount;
      let finalToken1 = token1Amount;

      // If token0 exceeds original, scale down proportionally
      if (finalToken0 > origToken0Amount && origToken0Amount > 0n) {
        const scale = (origToken0Amount * 10000n) / finalToken0;
        finalLiquidity = (finalLiquidity * scale) / 10000n;
        const scaled = getTokenAmountsFromLiquidity(
          finalLiquidity,
          effectiveSqrtPriceX96,
          tickLower,
          tickUpper
        );
        finalToken0 = scaled.token0Amount;
        finalToken1 = scaled.token1Amount;
      }

      // If token1 still exceeds original, scale down again
      if (finalToken1 > origToken1Amount && origToken1Amount > 0n) {
        const scale = (origToken1Amount * 10000n) / finalToken1;
        finalLiquidity = (finalLiquidity * scale) / 10000n;
        const scaled = getTokenAmountsFromLiquidity(
          finalLiquidity,
          effectiveSqrtPriceX96,
          tickLower,
          tickUpper
        );
        finalToken0 = scaled.token0Amount;
        finalToken1 = scaled.token1Amount;
      }

      // Map back to base/quote
      const adjustedBase = baseIsToken0 ? finalToken0 : finalToken1;
      const adjustedQuote = quoteIsToken0 ? finalToken0 : finalToken1;

      // Final safety check - cap at original amounts
      const finalBase = adjustedBase > origBaseAmount ? origBaseAmount : adjustedBase;
      const finalQuote = adjustedQuote > origQuoteAmount ? origQuoteAmount : adjustedQuote;

      // Calculate total position value in quote terms
      const totalQuoteValue = calculatePositionValue(
        finalLiquidity,
        effectiveSqrtPriceX96,
        tickLower,
        tickUpper,
        baseIsToken0
      );

      // Calculate price change percentage
      const priceChangePercent = calculatePriceChangePercent(
        originalSqrtPriceRef.current ?? effectiveSqrtPriceX96,
        effectiveSqrtPriceX96
      );

      return {
        status: 'ready' as const,
        adjustedBaseAmount: finalBase.toString(),
        adjustedQuoteAmount: finalQuote.toString(),
        adjustedLiquidity: finalLiquidity.toString(),
        adjustedTotalQuoteValue: totalQuoteValue.toString(),
        priceChangePercent,
      };
    } catch (err) {
      console.error('Price adjustment calculation error:', err, {
        effectiveSqrtPriceX96: effectiveSqrtPriceX96?.toString(),
        tickLower,
        tickUpper,
        origBaseAmount: origBaseAmount.toString(),
        origQuoteAmount: origQuoteAmount.toString(),
      });
      // On calculation error, fall back to using original amounts (no adjustment)
      // This ensures the UI doesn't get stuck in error state
      return {
        status: 'ready' as const,
        adjustedBaseAmount: origBaseAmount.toString(),
        adjustedQuoteAmount: origQuoteAmount.toString(),
        adjustedLiquidity: '0',
        adjustedTotalQuoteValue: '0',
        priceChangePercent: 0,
      };
    }
  }, [
    discoveredPool,
    baseToken,
    quoteToken,
    originalBaseAmount,
    originalQuoteAmount,
    tickLower,
    tickUpper,
    currentSqrtPriceX96,
    isLoading,
    enabled,
  ]);

  // Build error message
  // Note: We ignore watchError because we fall back to the pool's stored price
  const error = useMemo(() => {
    // Don't show errors - we always fall back to a usable state
    return null;
  }, [calculation.status]);

  // Wrap cancel in useCallback for stable reference
  const stableCancel = useCallback(async () => {
    await cancel();
  }, [cancel]);

  return {
    status: calculation.status,
    error,
    adjustedBaseAmount: calculation.adjustedBaseAmount,
    adjustedQuoteAmount: calculation.adjustedQuoteAmount,
    adjustedLiquidity: calculation.adjustedLiquidity,
    adjustedTotalQuoteValue: calculation.adjustedTotalQuoteValue,
    currentSqrtPriceX96,
    currentTick,
    priceChangePercent: calculation.priceChangePercent,
    cancel: stableCancel,
  };
}
