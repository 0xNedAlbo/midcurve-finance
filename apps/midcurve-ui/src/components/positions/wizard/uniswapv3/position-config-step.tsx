"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { UniswapV3PoolDiscoveryResultResponse, Erc20TokenResponse } from "@midcurve/api-shared";
import type { EvmChainSlug } from "@/config/chains";
import { TickMath } from "@uniswap/v3-sdk";
import { getTickSpacing, compareAddresses, calculatePositionValue, tickToPrice } from "@midcurve/shared";
import { Eye } from "lucide-react";

import { PositionRangeConfig } from "./position-range-config";
import { PositionSizeConfig } from "./position-size-config";
import { InteractivePnLCurve } from "@/components/positions/pnl-curve/uniswapv3";
import type { TokenSearchResult } from "@/hooks/positions/uniswapv3/wizard/useTokenSearch";
import { usePositionAprCalculation } from "@/hooks/positions/uniswapv3/wizard/usePositionAprCalculation";
import { usePoolPrice } from "@/hooks/pools/usePoolPrice";

interface PositionConfigStepProps {
  chain: EvmChainSlug;
  baseToken: TokenSearchResult;
  quoteToken: TokenSearchResult;
  pool: UniswapV3PoolDiscoveryResultResponse;
  tickLower: number | null;
  tickUpper: number | null;
  liquidity: bigint;
  onConfigChange: (config: PositionConfig) => void;
  onValidationChange: (isValid: boolean) => void;
}

export interface PositionConfig {
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
}

export function PositionConfigStep({
  chain,
  baseToken,
  quoteToken: _quoteToken,
  pool: initialPool,
  tickLower: initialTickLower,
  tickUpper: initialTickUpper,
  liquidity: initialLiquidity,
  onConfigChange,
  onValidationChange,
}: PositionConfigStepProps) {
  // Local state for pool (allows updating with fresh price data)
  const [pool, setPool] = useState<UniswapV3PoolDiscoveryResultResponse>(initialPool);

  // Local state for position configuration
  const [tickLower, setTickLower] = useState<number>(() => {
    if (initialTickLower !== null && !isNaN(initialTickLower)) {
      return initialTickLower;
    }
    // Default: ±10% around current price
    const currentTick = pool.pool.state.currentTick;
    const tickSpacing = getTickSpacing(pool.pool.config.feeBps);
    const lowerTick = Math.floor((currentTick - 2000) / tickSpacing) * tickSpacing;
    return Math.max(TickMath.MIN_TICK, lowerTick);
  });

  const [tickUpper, setTickUpper] = useState<number>(() => {
    if (initialTickUpper !== null && !isNaN(initialTickUpper)) {
      return initialTickUpper;
    }
    // Default: ±10% around current price
    const currentTick = pool.pool.state.currentTick;
    const tickSpacing = getTickSpacing(pool.pool.config.feeBps);
    const upperTick = Math.ceil((currentTick + 2000) / tickSpacing) * tickSpacing;
    return Math.min(TickMath.MAX_TICK, upperTick);
  });

  const [liquidity, setLiquidity] = useState<bigint>(initialLiquidity);

  // Slider bounds for PnL curve visualization
  const [sliderBounds, setSliderBounds] = useState<{ min: number; max: number }>({ min: 0, max: 0 });

  // Hook for fetching current pool price (for refresh button)
  const {
    sqrtPriceX96: latestSqrtPriceX96,
    currentTick: latestCurrentTick,
    refetch: refetchPoolPrice,
  } = usePoolPrice({
    chainId: pool.pool.config.chainId.toString(),
    poolAddress: pool.pool.config.address,
    enabled: true,
  });

  // Update pool state when fresh price data arrives
  useEffect(() => {
    if (latestSqrtPriceX96 && latestCurrentTick !== undefined) {
      setPool((prevPool) => ({
        ...prevPool,
        pool: {
          ...prevPool.pool,
          state: {
            ...prevPool.pool.state,
            sqrtPriceX96: latestSqrtPriceX96.toString(),
            currentTick: latestCurrentTick,
          },
        },
      }));
    }
  }, [latestSqrtPriceX96, latestCurrentTick]);

  /**
   * Map pool tokens to base/quote based on user's selection
   * The pool contains full token information with addresses in config
   */
  const { basePoolToken, quotePoolToken } = useMemo((): {
    basePoolToken: Erc20TokenResponse;
    quotePoolToken: Erc20TokenResponse;
  } => {
    // Determine which pool token is base and which is quote
    const isToken0Base =
      compareAddresses(pool.pool.token0.config.address, baseToken.address) === 0;

    if (isToken0Base) {
      return {
        basePoolToken: pool.pool.token0,
        quotePoolToken: pool.pool.token1,
      };
    } else {
      return {
        basePoolToken: pool.pool.token1,
        quotePoolToken: pool.pool.token0,
      };
    }
  }, [pool, baseToken.address]);

  // Determine if base token is token0
  const isToken0Base = useMemo(() => {
    return compareAddresses(pool.pool.token0.config.address, baseToken.address) === 0;
  }, [pool.pool.token0.config.address, baseToken.address]);

  // Calculate current price for slider bounds initialization
  const currentPrice = useMemo(() => {
    if (!pool?.pool?.state?.currentTick || !basePoolToken || !quotePoolToken) {
      return 0;
    }

    try {
      const baseTokenDecimals = isToken0Base
        ? pool.pool.token0.decimals
        : pool.pool.token1.decimals;

      const priceBigInt = tickToPrice(
        pool.pool.state.currentTick,
        basePoolToken.config.address,
        quotePoolToken.config.address,
        baseTokenDecimals
      );

      const divisor = 10n ** BigInt(quotePoolToken.decimals);
      return Number(priceBigInt) / Number(divisor);
    } catch (error) {
      console.error("Error calculating current price:", error);
      return 0;
    }
  }, [pool, basePoolToken, quotePoolToken, isToken0Base]);

  // Initialize slider bounds when current price is available
  useEffect(() => {
    if (currentPrice > 0 && sliderBounds.min === 0 && sliderBounds.max === 0) {
      const DEFAULT_RANGE_PERCENT = 50; // ±50% default range
      setSliderBounds({
        min: currentPrice * (1 - DEFAULT_RANGE_PERCENT / 100),
        max: currentPrice * (1 + DEFAULT_RANGE_PERCENT / 100),
      });
    }
  }, [currentPrice, sliderBounds.min, sliderBounds.max]);

  // Calculate cost basis (position value at current price)
  const costBasis = useMemo(() => {
    if (!liquidity || liquidity === 0n || !pool?.pool?.state?.sqrtPriceX96) {
      return 0n;
    }

    try {
      const sqrtPriceX96 = typeof pool.pool.state.sqrtPriceX96 === "bigint"
        ? pool.pool.state.sqrtPriceX96
        : BigInt(pool.pool.state.sqrtPriceX96);

      return calculatePositionValue(
        liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
        isToken0Base
      );
    } catch (error) {
      console.error("Error calculating cost basis:", error);
      return 0n;
    }
  }, [liquidity, pool?.pool?.state?.sqrtPriceX96, tickLower, tickUpper, isToken0Base]);

  // Calculate prospective APR
  const aprCalculation = usePositionAprCalculation({
    chain,
    pool,
    liquidity,
    tickLower,
    tickUpper,
    baseToken: basePoolToken,
    quoteToken: quotePoolToken,
  });

  // Update parent whenever config changes
  useEffect(() => {
    onConfigChange({
      tickLower,
      tickUpper,
      liquidity,
    });
  }, [tickLower, tickUpper, liquidity, onConfigChange]);

  // Validate configuration
  useEffect(() => {
    const isValid =
      tickLower < tickUpper &&
      tickLower >= TickMath.MIN_TICK &&
      tickUpper <= TickMath.MAX_TICK &&
      liquidity > 0n;

    onValidationChange(isValid);
  }, [tickLower, tickUpper, liquidity, onValidationChange]);

  // Handle tick range change from PositionRangeConfig
  const handleTickRangeChange = useCallback(
    (newTickLower: number, newTickUpper: number) => {
      setTickLower(newTickLower);
      setTickUpper(newTickUpper);
    },
    []
  );

  // Handle liquidity change from PositionSizeConfig
  const handleLiquidityChange = useCallback((newLiquidity: bigint) => {
    setLiquidity(newLiquidity);
  }, []);

  return (
    <div className="space-y-6">
      {/* Risk Profile Visualization - Always visible when position has liquidity */}
      {liquidity > 0n && costBasis > 0n && sliderBounds.min > 0 && (
        <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-lg p-4">
          <InteractivePnLCurve
            poolData={{
              token0Address: pool.pool.token0.config.address,
              token0Decimals: pool.pool.token0.decimals,
              token1Address: pool.pool.token1.config.address,
              token1Decimals: pool.pool.token1.decimals,
              feeBps: pool.pool.feeBps,
              currentTick: pool.pool.state.currentTick,
              sqrtPriceX96: pool.pool.state.sqrtPriceX96,
            }}
            baseToken={{
              address: basePoolToken.config.address,
              symbol: basePoolToken.symbol,
              decimals: basePoolToken.decimals,
            }}
            quoteToken={{
              address: quotePoolToken.config.address,
              symbol: quotePoolToken.symbol,
              decimals: quotePoolToken.decimals,
            }}
            tickLower={tickLower}
            tickUpper={tickUpper}
            liquidity={liquidity}
            costBasis={costBasis}
            sliderBounds={sliderBounds}
            onSliderBoundsChange={setSliderBounds}
            height={320}
          />
          <p className="text-xs text-slate-400 mt-2 text-center">
            <span className="font-semibold">Risk Profile.</span> Shows how your position value changes with price movements.
          </p>
        </div>
      )}

      {/* Position Size Configuration */}
      <PositionSizeConfig
        pool={pool.pool}
        baseToken={basePoolToken}
        quoteToken={quotePoolToken}
        tickLower={tickLower}
        tickUpper={tickUpper}
        liquidity={liquidity}
        onLiquidityChange={handleLiquidityChange}
        chain={chain}
        label="Position Size:"
        onRefreshPool={refetchPoolPrice}
      />

      {/* Prospective APR */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-300 font-medium">Prospective APR:</span>
          <div className="flex items-center gap-2">
            <span className={`font-medium text-lg ${
              aprCalculation.hasValidData && aprCalculation.annualizedApr > 0
                ? aprCalculation.isOutOfRange
                  ? "text-yellow-400"
                  : "text-green-400"
                : "text-white"
            }`}>
              {aprCalculation.hasValidData && liquidity > 0n
                ? `${aprCalculation.annualizedApr.toFixed(2)}%`
                : "—"}
            </span>
            <button
              className="p-1.5 text-slate-400 hover:text-slate-300 transition-colors cursor-pointer"
              title="View APR calculation details"
            >
              <Eye className="w-5 h-5" />
            </button>
          </div>
        </div>
        {aprCalculation.isOutOfRange && liquidity > 0n && (
          <div className="text-xs text-yellow-400">
            ⚠ Position is currently out of range - no fees being collected
          </div>
        )}
      </div>

      {/* Position Range Configuration */}
      <PositionRangeConfig
        pool={pool.pool}
        baseToken={basePoolToken}
        quoteToken={quotePoolToken}
        tickLower={tickLower}
        tickUpper={tickUpper}
        liquidity={liquidity}
        onTickLowerChange={setTickLower}
        onTickUpperChange={setTickUpper}
        onTickRangeChange={handleTickRangeChange}
        aprValue={
          aprCalculation.hasValidData && liquidity > 0n
            ? aprCalculation.annualizedApr.toFixed(2)
            : undefined
        }
      />

      {/* Validation Info */}
      {liquidity === 0n && (
        <div className="text-center text-sm text-slate-400">
          Enter token amounts to configure your position
        </div>
      )}
    </div>
  );
}
