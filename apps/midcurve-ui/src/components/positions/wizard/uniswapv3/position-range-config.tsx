"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { PencilLine, PencilOff, TrendingUp } from "lucide-react";
import type { UniswapV3Pool, Erc20Token } from "@midcurve/shared";
import {
  tickToPrice,
  priceToTick,
  compareAddresses,
  getTickSpacing,
} from "@midcurve/shared";
import { formatCompactValue } from "@/lib/fraction-format";
import { TickMath } from "@uniswap/v3-sdk";
import { RangeSlider } from "./shared/range-slider";
import { PositionPnLCurve } from "./shared/position-pnl-curve";
import { calculatePositionValue } from "@midcurve/shared";

interface SliderBounds {
  min: number;
  max: number;
}

interface PositionRangeConfigProps {
  pool: UniswapV3Pool;
  baseToken: Erc20Token;
  quoteToken: Erc20Token;
  tickLower: number;
  tickUpper: number;
  liquidity?: bigint;
  onTickLowerChange: (_tick: number) => void;
  onTickUpperChange: (_tick: number) => void;
  onTickRangeChange: (_tickLower: number, _tickUpper: number) => void;
  aprValue?: string; // Prospective APR percentage (e.g., "25.50")
}

export function PositionRangeConfig({
  pool,
  baseToken,
  quoteToken,
  tickLower,
  tickUpper,
  liquidity: _liquidity,
  onTickLowerChange: _onTickLowerChange,
  onTickUpperChange: _onTickUpperChange,
  onTickRangeChange,
  aprValue,
}: PositionRangeConfigProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Slider bounds state - shared between RangeSlider and PositionPnLCurve
  const [sliderBounds, setSliderBounds] = useState<SliderBounds>(() => ({
    min: 0,
    max: 0,
  }));

  /**
   * Get current pool price for display
   * @returns Current price as a number (quote tokens per base token)
   * @example For WETH/USDC pool: 3000.5 (meaning 3000.5 USDC per 1 WETH)
   */
  const currentPrice = useMemo(() => {
    if (
      !pool?.state.currentTick ||
      !baseToken ||
      !quoteToken ||
      !pool.token0?.config?.address ||
      !pool.token1?.config?.address ||
      !baseToken.config?.address ||
      !quoteToken.config?.address
    ) {
      return 0;
    }

    try {
      // Determine which token is token0/token1
      const isBaseToken0 =
        compareAddresses(pool.token0.config.address, baseToken.config.address) ===
        0;

      const baseTokenDecimals = isBaseToken0
        ? pool.token0.decimals
        : pool.token1.decimals;

      // tickToPrice returns price in quote token decimals
      const priceBigInt = tickToPrice(
        pool.state.currentTick,
        baseToken.config.address,
        quoteToken.config.address,
        baseTokenDecimals
      );

      // Convert to human readable number using quote token decimals
      const divisor = 10n ** BigInt(quoteToken.decimals);
      return Number(priceBigInt) / Number(divisor);
    } catch (error) {
      console.error("Error getting current price:", error);
      return 0;
    }
  }, [baseToken, quoteToken, pool]);

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

  // Determine token roles for correct decimal scaling
  const isToken0Base = useMemo(() => {
    if (!pool?.token0?.config?.address || !baseToken?.config?.address) return false;
    return (
      compareAddresses(pool.token0.config.address, baseToken.config.address) ===
      0
    );
  }, [pool?.token0, baseToken]);


  // Helper function to convert tick to price (for RangeSlider)
  const convertTickToPrice = useCallback(
    (tick: number): number => {
      if (
        !baseToken?.config?.address ||
        !quoteToken?.config?.address ||
        !pool ||
        tick === undefined ||
        isNaN(tick)
      ) {
        return 0;
      }

      try {
        const baseTokenDecimals = isToken0Base
          ? pool.token0.decimals
          : pool.token1.decimals;

        const priceBigInt = tickToPrice(
          tick,
          baseToken.config.address,
          quoteToken.config.address,
          baseTokenDecimals
        );

        // Convert to number for RangeSlider
        const divisor = 10n ** BigInt(quoteToken.decimals);
        return Number(priceBigInt) / Number(divisor);
      } catch (error) {
        console.error("Error converting tick to price:", error);
        return 0;
      }
    },
    [baseToken, quoteToken, pool, isToken0Base]
  );

  // Helper function to convert price to tick (for RangeSlider)
  const convertPriceToTickValue = useCallback(
    (price: number): number => {
      if (
        !baseToken?.config?.address ||
        !quoteToken?.config?.address ||
        !pool?.config.tickSpacing ||
        !pool.token0?.decimals ||
        !pool.token1?.decimals ||
        price <= 0
      ) {
        return TickMath.MIN_TICK;
      }

      try {
        const baseTokenDecimals = isToken0Base
          ? pool.token0.decimals
          : pool.token1.decimals;

        const quoteTokenDecimals = quoteToken.decimals;

        // priceToTick expects price in quote token decimals as bigint
        const multiplier = 10n ** BigInt(quoteTokenDecimals);
        const priceBigInt = BigInt(Math.floor(price * Number(multiplier)));

        const tickSpacing = getTickSpacing(pool.config.feeBps);

        return priceToTick(
          priceBigInt,
          tickSpacing,
          baseToken.config.address,
          quoteToken.config.address,
          baseTokenDecimals
        );
      } catch (error) {
        console.error("Error converting price to tick:", error);
        return TickMath.MIN_TICK;
      }
    },
    [baseToken, quoteToken, pool, isToken0Base]
  );

  // Display prices for header
  const displayPrices = useMemo(() => {
    // Check for required data
    if (
      !baseToken?.config?.address ||
      !quoteToken?.config?.address ||
      !pool ||
      tickLower === undefined ||
      tickUpper === undefined ||
      isNaN(tickLower) ||
      isNaN(tickUpper)
    ) {
      return { lower: "—", upper: "—" };
    }

    try {
      const baseTokenDecimals = isToken0Base
        ? pool.token0.decimals
        : pool.token1.decimals;

      // Use tickToPrice from @midcurve/shared (same as currentPrice useMemo)
      const lowerPriceBigInt = tickToPrice(
        tickLower,
        baseToken.config.address,
        quoteToken.config.address,
        baseTokenDecimals
      );

      const upperPriceBigInt = tickToPrice(
        tickUpper,
        baseToken.config.address,
        quoteToken.config.address,
        baseTokenDecimals
      );

      // Format using quote token decimals
      return {
        lower: formatCompactValue(lowerPriceBigInt, quoteToken.decimals),
        upper: formatCompactValue(upperPriceBigInt, quoteToken.decimals),
      };
    } catch (error) {
      console.error("Error calculating display prices:", error);
      return { lower: "—", upper: "—" };
    }
  }, [tickLower, tickUpper, baseToken, quoteToken, pool, isToken0Base]);

  // Check if current price is out of range
  const isOutOfRange = useMemo(() => {
    if (
      !pool?.state.currentTick ||
      tickLower === undefined ||
      tickUpper === undefined ||
      isNaN(tickLower) ||
      isNaN(tickUpper)
    ) {
      return false;
    }
    return pool.state.currentTick < tickLower || pool.state.currentTick > tickUpper;
  }, [pool?.state.currentTick, tickLower, tickUpper]);

  // Calculate cost basis (initial position value at current price)
  const costBasis = useMemo(() => {
    if (!_liquidity || _liquidity === 0n || !pool?.state?.sqrtPriceX96) {
      return 0n;
    }

    try {
      // Ensure sqrtPriceX96 is BigInt (may come from API as string)
      const sqrtPriceX96 = typeof pool.state.sqrtPriceX96 === 'bigint'
        ? pool.state.sqrtPriceX96
        : BigInt(pool.state.sqrtPriceX96);

      // Calculate position value at current price
      return calculatePositionValue(
        _liquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper,
        isToken0Base
      );
    } catch (error) {
      console.error("Error calculating cost basis:", error);
      return 0n;
    }
  }, [_liquidity, pool?.state?.sqrtPriceX96, tickLower, tickUpper, isToken0Base]);

  return (
    <div className="space-y-4">
      {/* Header with Price Range display */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-300 font-medium flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          Price Range:
        </span>
        <div className="flex items-center gap-2">
          {isOutOfRange && (
            <span className="px-2 py-0.5 bg-red-500/20 border border-red-500/30 text-red-200 text-xs rounded-full font-medium">
              Out of Range
            </span>
          )}
          <span className="text-white font-medium">
            {displayPrices.lower} - {displayPrices.upper} {baseToken.symbol}/
            {quoteToken.symbol}
          </span>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-slate-700 rounded transition-colors cursor-pointer"
          >
            {isExpanded ? (
              <PencilOff className="w-4 h-4 text-slate-400" />
            ) : (
              <PencilLine className="w-4 h-4 text-slate-400" />
            )}
          </button>
        </div>
      </div>

      {/* Collapsible sections - only show when expanded */}
      {isExpanded && (
        <div className="space-y-6">
          {/* Range Selector with integrated APR */}
          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-lg p-6">
            <RangeSlider
              currentPrice={currentPrice}
              lowerPrice={convertTickToPrice(tickLower)}
              upperPrice={convertTickToPrice(tickUpper)}
              onRangeChange={(newLowerPrice, newUpperPrice) => {
                const newLowerTick = convertPriceToTickValue(newLowerPrice);
                const newUpperTick = convertPriceToTickValue(newUpperPrice);
                onTickRangeChange(newLowerTick, newUpperTick);
              }}
              quoteTokenSymbol={quoteToken.symbol}
              quoteTokenDecimals={quoteToken.decimals}
              aprValue={aprValue}
              aprLoading={false}
              sliderBounds={sliderBounds}
              onBoundsChange={setSliderBounds}
              className=""
            />

            {/* Risk Profile Section with PnL Curve */}
            {_liquidity && _liquidity > 0n && costBasis > 0n && (
              <div className="mt-4 pt-4 border-t border-slate-700/50">
                <PositionPnLCurve
                  pool={pool}
                  baseToken={baseToken}
                  quoteToken={quoteToken}
                  tickLower={tickLower}
                  tickUpper={tickUpper}
                  liquidity={_liquidity}
                  costBasis={costBasis}
                  sliderBounds={sliderBounds}
                  height={320}
                  className=""
                />
                <p className="text-xs text-slate-400 mt-2 text-center">
                  <span className="font-semibold">Risk Profile: PnL Curve.</span> Shows how your position value changes with price movements.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
