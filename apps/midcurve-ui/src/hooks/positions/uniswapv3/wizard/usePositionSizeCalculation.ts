/**
 * Position Size Calculation Hook
 *
 * Hook for calculating position size and liquidity from investment amounts
 * Migrated from legacy project - uses @midcurve/shared utilities
 */

import { useMemo } from 'react';
import type { UniswapV3Pool, Erc20Token } from '@midcurve/shared';
import {
  getLiquidityFromInvestmentAmounts_withTick,
  getTokenAmountsFromLiquidity,
  compareAddresses,
} from '@midcurve/shared';

interface PositionSizeCalculationParams {
  baseAmount: bigint;
  quoteAmount: bigint;
  baseToken: Erc20Token;
  quoteToken: Erc20Token;
  pool: UniswapV3Pool;
  tickLower: number;
  tickUpper: number;
}

interface PositionSizeCalculationResult {
  liquidity: bigint;
  token0Amount: bigint;
  token1Amount: bigint;
  positionValueInQuote: bigint;
  isQuoteToken0: boolean;
}

/**
 * Calculate position size from investment amounts
 *
 * @param params Investment parameters including amounts, tokens, pool, and tick range
 * @returns Calculated position size data including liquidity and token amounts
 */
export function usePositionSizeCalculation({
  baseAmount,
  quoteAmount,
  baseToken,
  quoteToken,
  pool,
  tickLower,
  tickUpper,
}: PositionSizeCalculationParams): PositionSizeCalculationResult {
  return useMemo(() => {
    // Early return if required data is missing
    if (
      !baseToken?.config?.address ||
      !quoteToken?.config?.address ||
      !pool?.state?.sqrtPriceX96 ||
      tickLower === null ||
      tickUpper === null
    ) {
      return {
        liquidity: 0n,
        token0Amount: 0n,
        token1Amount: 0n,
        positionValueInQuote: 0n,
        isQuoteToken0: false,
      };
    }

    // Determine token ordering (quote token is token0 if its address is smaller)
    const isQuoteToken0 = compareAddresses(
      quoteToken.config.address,
      baseToken.config.address
    ) < 0;

    // Calculate liquidity from investment amounts
    let liquidity: bigint = 0n;
    if (pool.state.sqrtPriceX96 && (baseAmount > 0n || quoteAmount > 0n)) {
      try {
        // Ensure all parameters are the correct types
        const baseAmountBigInt = BigInt(baseAmount);
        const quoteAmountBigInt = BigInt(quoteAmount);
        const baseDecimalsNum = Number(baseToken.decimals);
        const quoteDecimalsNum = Number(quoteToken.decimals);
        const sqrtPriceX96BigInt = BigInt(pool.state.sqrtPriceX96);

        liquidity = getLiquidityFromInvestmentAmounts_withTick(
          baseAmountBigInt,
          baseDecimalsNum,
          quoteAmountBigInt,
          quoteDecimalsNum,
          isQuoteToken0,
          tickUpper,
          tickLower,
          sqrtPriceX96BigInt
        );
      } catch (error) {
        console.error('Error calculating liquidity:', error);
        liquidity = 0n;
      }
    }

    // Calculate resulting token amounts from liquidity
    let token0Amount: bigint = 0n;
    let token1Amount: bigint = 0n;
    if (liquidity > 0n && pool.state.sqrtPriceX96) {
      try {
        // Ensure all parameters are the correct types
        const liquidityBigInt = BigInt(liquidity);
        const sqrtPriceX96BigInt = BigInt(pool.state.sqrtPriceX96);
        const tickLowerNum = Number(tickLower);
        const tickUpperNum = Number(tickUpper);

        const tokenAmounts = getTokenAmountsFromLiquidity(
          liquidityBigInt,
          sqrtPriceX96BigInt,
          tickLowerNum,
          tickUpperNum
        );
        token0Amount = tokenAmounts.token0Amount;
        token1Amount = tokenAmounts.token1Amount;
      } catch (error) {
        console.error('Error calculating token amounts from liquidity:', error);
      }
    }

    // Calculate position value in quote token units
    // Convert base token amount to quote units and add quote amount
    const baseTokenAmount = isQuoteToken0 ? token1Amount : token0Amount;
    const quoteTokenAmount = isQuoteToken0 ? token0Amount : token1Amount;

    let positionValueInQuote: bigint = quoteTokenAmount;
    if (baseTokenAmount > 0n && pool.state.sqrtPriceX96) {
      try {
        // Convert base amount to quote units using current price
        const sqrtPriceX96 = BigInt(pool.state.sqrtPriceX96);

        if (isQuoteToken0) {
          // quote=token0, base=token1 -> price (quote/base) = Q192 / S^2
          const Q192 = 1n << 192n;
          const baseAsQuote =
            (baseTokenAmount * Q192) / (sqrtPriceX96 * sqrtPriceX96);
          positionValueInQuote += baseAsQuote;
        } else {
          // quote=token1, base=token0 -> price (quote/base) = S^2 / Q192
          const Q192 = 1n << 192n;
          const baseAsQuote =
            (baseTokenAmount * sqrtPriceX96 * sqrtPriceX96) / Q192;
          positionValueInQuote += baseAsQuote;
        }
      } catch (error) {
        console.error('Error calculating position value in quote:', error);
        // Fallback to just quote amount if conversion fails
        positionValueInQuote = quoteTokenAmount;
      }
    }

    return {
      liquidity,
      token0Amount,
      token1Amount,
      positionValueInQuote,
      isQuoteToken0,
    };
  }, [
    baseAmount,
    quoteAmount,
    baseToken?.config?.address,
    baseToken?.decimals,
    quoteToken?.config?.address,
    quoteToken?.decimals,
    pool?.state?.sqrtPriceX96,
    tickLower,
    tickUpper,
  ]);
}
