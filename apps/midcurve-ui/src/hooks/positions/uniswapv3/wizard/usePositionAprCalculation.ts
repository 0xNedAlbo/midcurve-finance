/**
 * Position APR Calculation Hook
 *
 * Calculates prospective APR for a Uniswap V3 position based on:
 * - Current pool fee tier and liquidity
 * - 24-hour trading volume (from subgraph metrics)
 * - User's position size and range
 * - Current pool price
 *
 * Uses usePoolMetrics hook to fetch fresh metrics data on-demand.
 */

import { useMemo } from "react";
import type { Erc20Token } from "@midcurve/shared";
import type { PoolDiscoveryResult } from "@midcurve/shared";
import type { EvmChainSlug } from "@/config/chains";
import {
  getTokenAmountsFromLiquidity,
  valueOfToken0AmountInToken1,
  valueOfToken1AmountInToken0,
  compareAddresses,
} from "@midcurve/shared";
import { usePoolMetrics } from "./usePoolMetrics";

interface UsePositionAprCalculationParams {
  chain: EvmChainSlug;
  pool: PoolDiscoveryResult<"uniswapv3">;
  liquidity: bigint;
  tickLower: number;
  tickUpper: number;
  baseToken: Erc20Token;
  quoteToken: Erc20Token;
}

interface AprCalculationResult {
  /** Daily fees in token0 (pool-wide) */
  dailyFeesToken0: bigint;
  /** Daily fees in token1 (pool-wide) */
  dailyFeesToken1: bigint;
  /** User's share of pool liquidity (0-100) */
  userSharePercent: number;
  /** User's daily fees in token0 */
  userFeesToken0: bigint;
  /** User's daily fees in token1 */
  userFeesToken1: bigint;
  /** User's daily fees in quote token value */
  userFeesQuoteValue: bigint;
  /** Position value in quote token */
  positionValueQuote: bigint;
  /** Daily APR (0-100) */
  dailyApr: number;
  /** Annualized APR (0-100) */
  annualizedApr: number;
  /** Whether position is out of range */
  isOutOfRange: boolean;
  /** Whether calculation has valid data */
  hasValidData: boolean;
}

/**
 * Calculate prospective APR for a position
 *
 * Algorithm:
 * 1. Calculate pool-wide daily fees from 24h volume × fee tier
 * 2. Calculate user's share of pool liquidity
 * 3. Calculate user's portion of daily fees
 * 4. Convert all fees to quote token value
 * 5. Calculate position value in quote token
 * 6. Calculate daily APR = (daily_fees / position_value) × 100
 * 7. Calculate annualized APR = daily_apr × 365
 */
export function usePositionAprCalculation({
  chain,
  pool,
  liquidity,
  tickLower,
  tickUpper,
  baseToken,
  quoteToken: _quoteToken,
}: UsePositionAprCalculationParams): AprCalculationResult {
  // Fetch fresh metrics from backend API
  const { metrics, isLoading: isMetricsLoading } = usePoolMetrics({
    chain,
    poolAddress: pool?.pool?.config?.address || null,
    enabled: !!pool?.pool?.config?.address,
  });

  return useMemo(() => {
    // Default empty result
    const emptyResult: AprCalculationResult = {
      dailyFeesToken0: 0n,
      dailyFeesToken1: 0n,
      userSharePercent: 0,
      userFeesToken0: 0n,
      userFeesToken1: 0n,
      userFeesQuoteValue: 0n,
      positionValueQuote: 0n,
      dailyApr: 0,
      annualizedApr: 0,
      isOutOfRange: false,
      hasValidData: false,
    };

    // Validate required data
    if (
      !pool?.pool?.state?.sqrtPriceX96 ||
      !pool?.pool?.state?.liquidity ||
      !pool?.pool?.state?.currentTick ||
      tickLower === undefined ||
      tickUpper === undefined ||
      isNaN(tickLower) ||
      isNaN(tickUpper)
    ) {
      return emptyResult;
    }

    // If liquidity is 0, return empty result (no position yet)
    if (liquidity === 0n) {
      return emptyResult;
    }

    try {
      const poolData = pool.pool;
      const currentTick = poolData.state.currentTick;
      const sqrtPriceX96 = BigInt(poolData.state.sqrtPriceX96);
      const poolLiquidity = BigInt(poolData.state.liquidity);

      // Check if position is out of range
      const isOutOfRange = currentTick < tickLower || currentTick >= tickUpper;

      // Determine if token0 is quote (token0 is quote if baseToken is token1)
      const isToken0Quote =
        compareAddresses(baseToken.config.address, poolData.token0.config.address) !== 0;

      // Check if we have metrics data from backend
      if (!metrics || isMetricsLoading) {
        return {
          ...emptyResult,
          hasValidData: false,
          isOutOfRange,
        };
      }

      // Parse token volumes from metrics (BigInt strings in token native decimals)
      const volumeToken0 = BigInt(metrics.volumeToken0);
      const volumeToken1 = BigInt(metrics.volumeToken1);

      // Parse fee tier from feeBps (e.g., 500 basis points = 0.05%)
      const feeTierBips = BigInt(poolData.config.feeBps);
      const FEE_DENOMINATOR = 1000000n;

      // Calculate daily fees from volume × fee tier
      // dailyFeesToken0 = volumeToken0 × (feeTierBips / 1000000)
      const dailyFeesToken0 = (volumeToken0 * feeTierBips) / FEE_DENOMINATOR;
      const dailyFeesToken1 = (volumeToken1 * feeTierBips) / FEE_DENOMINATOR;

      // If no volume, return 0% APR
      if (volumeToken0 === 0n && volumeToken1 === 0n) {
        return {
          ...emptyResult,
          hasValidData: true,
          isOutOfRange,
        };
      }

      // Calculate user's share of pool
      // User share = user_liquidity / (pool_liquidity + user_liquidity)
      const totalLiquidity = poolLiquidity + liquidity;
      const userSharePercent =
        totalLiquidity === 0n
          ? 0
          : Number((liquidity * 10000n) / totalLiquidity) / 100;

      // Calculate user's portion of daily fees
      const userFeesToken0 =
        totalLiquidity === 0n
          ? 0n
          : (dailyFeesToken0 * liquidity) / totalLiquidity;
      const userFeesToken1 =
        totalLiquidity === 0n
          ? 0n
          : (dailyFeesToken1 * liquidity) / totalLiquidity;

      // Convert fees to quote token value
      let userFeesQuoteValue: bigint;
      if (isToken0Quote) {
        // Quote is token0, convert token1 fees to token0
        const token1FeesInToken0 = valueOfToken1AmountInToken0(
          userFeesToken1,
          sqrtPriceX96
        );
        userFeesQuoteValue = userFeesToken0 + token1FeesInToken0;
      } else {
        // Quote is token1, convert token0 fees to token1
        const token0FeesInToken1 = valueOfToken0AmountInToken1(
          userFeesToken0,
          sqrtPriceX96
        );
        userFeesQuoteValue = token0FeesInToken1 + userFeesToken1;
      }

      // Calculate position value in quote token
      const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper
      );

      let positionValueQuote: bigint;
      if (isToken0Quote) {
        // Quote is token0, convert token1 to token0
        const token1ValueInToken0 = valueOfToken1AmountInToken0(
          token1Amount,
          sqrtPriceX96
        );
        positionValueQuote = token0Amount + token1ValueInToken0;
      } else {
        // Quote is token1, convert token0 to token1
        const token0ValueInToken1 = valueOfToken0AmountInToken1(
          token0Amount,
          sqrtPriceX96
        );
        positionValueQuote = token0ValueInToken1 + token1Amount;
      }

      // Calculate APR
      // Daily APR = (daily_fees_quote / position_value_quote) * 100
      // Annual APR = daily_apr * 365
      const dailyApr =
        positionValueQuote === 0n
          ? 0
          : Number((userFeesQuoteValue * 10000n) / positionValueQuote) / 100;

      const annualizedApr = dailyApr * 365;

      return {
        dailyFeesToken0,
        dailyFeesToken1,
        userSharePercent,
        userFeesToken0,
        userFeesToken1,
        userFeesQuoteValue,
        positionValueQuote,
        dailyApr,
        annualizedApr,
        isOutOfRange,
        hasValidData: true,
      };
    } catch (error) {
      console.error("[usePositionAprCalculation] Error calculating APR:", error);
      return emptyResult;
    }
  }, [pool, liquidity, tickLower, tickUpper, baseToken.config.address, metrics, isMetricsLoading]);
}
