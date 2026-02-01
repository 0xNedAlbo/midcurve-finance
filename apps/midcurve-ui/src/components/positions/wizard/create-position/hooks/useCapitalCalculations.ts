import { useMemo } from 'react';
import { parseUnits } from 'viem';
import { TickMath } from '@uniswap/v3-sdk';
import type { UniswapV3Pool } from '@midcurve/shared';
import type { PoolSearchTokenInfo } from '@midcurve/api-shared';
import {
  getLiquidityFromInvestmentAmounts,
  getTokenAmountsFromLiquidity,
  calculatePositionValue,
} from '@midcurve/shared';

// Q192 constant for price calculations
const Q192 = 2n ** 192n;

interface UseCapitalCalculationsParams {
  baseInputAmount: string;      // Human-readable input (e.g., "1.5")
  quoteInputAmount: string;     // Human-readable input (e.g., "1000")
  discoveredPool: UniswapV3Pool | null;
  baseToken: PoolSearchTokenInfo | null;
  quoteToken: PoolSearchTokenInfo | null;
  tickLower: number;
  tickUpper: number;
}

interface UseCapitalCalculationsReturn {
  allocatedBaseAmount: string;   // Raw bigint as string
  allocatedQuoteAmount: string;  // Raw bigint as string
  totalQuoteValue: string;       // Raw bigint as string
  liquidity: string;             // Raw bigint as string
  isValid: boolean;
}

/**
 * Parse a human-readable amount string to raw bigint
 */
function parseAmount(amount: string, decimals: number): bigint {
  if (!amount || amount.trim() === '') return 0n;
  try {
    // Handle edge cases
    const trimmed = amount.trim();
    if (trimmed === '.' || trimmed === '0.' || trimmed === '') return 0n;
    return parseUnits(trimmed, decimals);
  } catch {
    return 0n;
  }
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
 * Hook to calculate capital allocation using independent/custom mode.
 * User enters both token amounts, and we calculate the resulting liquidity
 * and position value.
 */
export function useCapitalCalculations({
  baseInputAmount,
  quoteInputAmount,
  discoveredPool,
  baseToken,
  quoteToken,
  tickLower,
  tickUpper,
}: UseCapitalCalculationsParams): UseCapitalCalculationsReturn {
  return useMemo(() => {
    // Return zeros if missing required data
    if (!discoveredPool || !baseToken || !quoteToken || tickLower >= tickUpper) {
      return {
        allocatedBaseAmount: '0',
        allocatedQuoteAmount: '0',
        totalQuoteValue: '0',
        liquidity: '0',
        isValid: false,
      };
    }

    const sqrtPriceX96 = BigInt(discoveredPool.state.sqrtPriceX96 as string);
    const quoteIsToken0 = isQuoteToken0(discoveredPool, quoteToken);
    const baseIsToken0 = !quoteIsToken0;

    // Get sqrt prices for tick bounds
    const sqrtPriceLowerX96 = BigInt(TickMath.getSqrtRatioAtTick(tickLower).toString());
    const sqrtPriceUpperX96 = BigInt(TickMath.getSqrtRatioAtTick(tickUpper).toString());

    // Parse input amounts
    const baseAmountRaw = parseAmount(baseInputAmount, baseToken.decimals);
    const quoteAmountRaw = parseAmount(quoteInputAmount, quoteToken.decimals);

    let liquidity = 0n;
    let allocatedBaseAmount = 0n;
    let allocatedQuoteAmount = 0n;
    let totalQuoteValue = 0n;

    try {
      // Custom/independent mode: User enters both amounts independently
      // Sum to total quote value, then calculate optimal allocation
      if (baseAmountRaw <= 0n && quoteAmountRaw <= 0n) {
        return {
          allocatedBaseAmount: '0',
          allocatedQuoteAmount: '0',
          totalQuoteValue: '0',
          liquidity: '0',
          isValid: false,
        };
      }

      // Convert base amount to quote value at current price
      const sqrtP2 = sqrtPriceX96 * sqrtPriceX96;
      let baseAsQuote: bigint;

      if (quoteIsToken0) {
        // quote=token0, base=token1 -> price (quote/base) = Q192 / S^2
        baseAsQuote = (baseAmountRaw * Q192) / sqrtP2;
      } else {
        // quote=token1, base=token0 -> price (quote/base) = S^2 / Q192
        baseAsQuote = (baseAmountRaw * sqrtP2) / Q192;
      }

      // Total investment in quote terms
      const totalQuoteInput = quoteAmountRaw + baseAsQuote;
      if (totalQuoteInput <= 0n) {
        return {
          allocatedBaseAmount: '0',
          allocatedQuoteAmount: '0',
          totalQuoteValue: '0',
          liquidity: '0',
          isValid: false,
        };
      }

      // Calculate liquidity from total investment
      liquidity = getLiquidityFromInvestmentAmounts(
        0n,
        baseToken.decimals,
        totalQuoteInput,
        quoteToken.decimals,
        quoteIsToken0,
        sqrtPriceLowerX96,
        sqrtPriceUpperX96,
        sqrtPriceX96
      );

      if (liquidity <= 0n) {
        return {
          allocatedBaseAmount: '0',
          allocatedQuoteAmount: '0',
          totalQuoteValue: '0',
          liquidity: '0',
          isValid: false,
        };
      }

      // Get optimal token amounts from liquidity
      const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper
      );

      // Map to base/quote
      allocatedBaseAmount = baseIsToken0 ? token0Amount : token1Amount;
      allocatedQuoteAmount = quoteIsToken0 ? token0Amount : token1Amount;

      // Calculate total value
      totalQuoteValue = calculatePositionValue(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
        baseIsToken0
      );
    } catch (error) {
      console.error('Capital calculation error:', error);
      return {
        allocatedBaseAmount: '0',
        allocatedQuoteAmount: '0',
        totalQuoteValue: '0',
        liquidity: '0',
        isValid: false,
      };
    }

    const isValid = liquidity > 0n && totalQuoteValue > 0n;

    return {
      allocatedBaseAmount: allocatedBaseAmount.toString(),
      allocatedQuoteAmount: allocatedQuoteAmount.toString(),
      totalQuoteValue: totalQuoteValue.toString(),
      liquidity: liquidity.toString(),
      isValid,
    };
  }, [
    baseInputAmount,
    quoteInputAmount,
    discoveredPool,
    baseToken,
    quoteToken,
    tickLower,
    tickUpper,
  ]);
}
