"use client";

import Image from "next/image";
import { formatCompactValue } from "@/lib/fraction-format";
import { calculatePositionStates, calculateBreakEvenPrice } from "@/lib/position-states";
import { usePnLDisplayValues } from "@/hooks/positions/usePnLDisplayValues";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Minus,
} from "lucide-react";
import type { GetUniswapV3PositionResponse } from "@midcurve/api-shared";
import { UniswapV3RangeStatusLine } from "./uniswapv3-range-status-line";
import { UniswapV3MiniPnLCurve } from "./uniswapv3-mini-pnl-curve";

interface UniswapV3OverviewTabProps {
  position: GetUniswapV3PositionResponse;
}

export function UniswapV3OverviewTab({ position }: UniswapV3OverviewTabProps) {
  // Get quote token info for formatting
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;
  const baseToken = position.isToken0Quote
    ? position.pool.token1
    : position.pool.token0;
  const quoteTokenDecimals = quoteToken.decimals;

  // PnL breakdown data
  const pnlBreakdown = {
    currentValue: position.currentValue,
    currentCostBasis: position.currentCostBasis,
    realizedPnL: position.realizedPnl,
    collectedFees: position.collectedFees,
    unclaimedFees: position.unClaimedFees,
  };

  // Get formatted display values
  const pnlDisplayValues = usePnLDisplayValues(pnlBreakdown, quoteTokenDecimals);

  // Calculate position states for all three scenarios
  const positionStates = calculatePositionStates(position, pnlBreakdown);

  // Calculate break-even price (only for active positions)
  const breakEvenPrice = position.isActive
    ? calculateBreakEvenPrice(position, pnlBreakdown)
    : null;

  // Calculate human-readable prices for curve markers (unused for now)
  // const baseTokenConfig = baseToken.config as { address: string };
  // const quoteTokenConfig = quoteToken.config as { address: string };
  // const positionConfig = position.config as { tickLower: number; tickUpper: number };

  // const lowerRangePrice =
  //   Number(
  //     tickToPrice(
  //       positionConfig.tickLower,
  //       baseTokenConfig.address,
  //       quoteTokenConfig.address,
  //       Number(baseToken.decimals)
  //     )
  //   ) / Number(10n ** BigInt(quoteToken.decimals));

  // const upperRangePrice =
  //   Number(
  //     tickToPrice(
  //       positionConfig.tickUpper,
  //       baseTokenConfig.address,
  //       quoteTokenConfig.address,
  //       Number(baseToken.decimals)
  //     )
  //   ) / Number(10n ** BigInt(quoteToken.decimals));

  // const poolStateData = position.pool.state as { sqrtPriceX96: string; currentTick: number };
  // const currentPoolPrice =
  //   Number(
  //     tickToPrice(
  //       poolStateData.currentTick,
  //       baseTokenConfig.address,
  //       quoteTokenConfig.address,
  //       Number(baseToken.decimals)
  //     )
  //   ) / Number(10n ** BigInt(quoteToken.decimals));

  return (
    <div className="space-y-6">
      {/* Range Status Line */}
      <UniswapV3RangeStatusLine position={position as any} />

      {/* Position Values Overview */}
      <div
        className={`grid grid-cols-1 gap-6 ${
          breakEvenPrice !== null ? "md:grid-cols-4" : "md:grid-cols-3"
        }`}
      >
        {/* Current Value */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <DollarSign className="w-5 h-5 text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-white">Current Value</h3>
          </div>
          <div className="text-2xl font-bold text-white">
            {pnlDisplayValues.currentValue
              ? formatCompactValue(
                  pnlDisplayValues.currentValue,
                  quoteTokenDecimals
                )
              : "0"}{" "}
            {quoteToken.symbol}
          </div>
          <div className="text-sm text-slate-400 mt-1">
            Total position value in quote token
          </div>
        </div>

        {/* Total PnL */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div
              className={`p-2 rounded-lg ${(() => {
                if (!pnlDisplayValues.totalPnL) return "bg-slate-500/20";
                return pnlDisplayValues.totalPnL > 0n
                  ? "bg-green-500/20"
                  : pnlDisplayValues.totalPnL < 0n
                  ? "bg-red-500/20"
                  : "bg-slate-500/20";
              })()}`}
            >
              {(() => {
                if (!pnlDisplayValues.totalPnL)
                  return <BarChart3 className="w-5 h-5 text-slate-400" />;
                return pnlDisplayValues.totalPnL > 0n ? (
                  <TrendingUp className="w-5 h-5 text-green-400" />
                ) : pnlDisplayValues.totalPnL < 0n ? (
                  <TrendingDown className="w-5 h-5 text-red-400" />
                ) : (
                  <BarChart3 className="w-5 h-5 text-slate-400" />
                );
              })()}
            </div>
            <h3 className="text-lg font-semibold text-white">Total PnL</h3>
          </div>
          <div
            className={`text-2xl font-bold ${(() => {
              if (!pnlDisplayValues.totalPnL) return "text-slate-400";
              return pnlDisplayValues.totalPnL > 0n
                ? "text-green-400"
                : pnlDisplayValues.totalPnL < 0n
                ? "text-red-400"
                : "text-slate-400";
            })()}`}
          >
            {pnlDisplayValues.totalPnL
              ? formatCompactValue(pnlDisplayValues.totalPnL, quoteTokenDecimals)
              : "0"}{" "}
            {quoteToken.symbol}
          </div>
          <div className="text-sm text-slate-400 mt-1">
            Including all fees and realized PnL
          </div>
        </div>

        {/* Unclaimed Fees */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-500/20 rounded-lg">
              <Target className="w-5 h-5 text-amber-400" />
            </div>
            <h3 className="text-lg font-semibold text-white">Unclaimed Fees</h3>
          </div>
          <div
            className={`text-2xl font-bold ${
              pnlDisplayValues.unclaimedFees && pnlDisplayValues.unclaimedFees > 0n
                ? "text-amber-400"
                : "text-white"
            }`}
          >
            {pnlDisplayValues.unclaimedFees
              ? formatCompactValue(pnlDisplayValues.unclaimedFees, quoteTokenDecimals)
              : "0"}{" "}
            {quoteToken.symbol}
          </div>
          <div className="text-sm text-slate-400 mt-1">
            Fees earned but not yet collected
          </div>
        </div>

        {/* Break-Even Price */}
        {breakEvenPrice !== null && (
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-slate-500/20 rounded-lg">
                <Target className="w-5 h-5 text-slate-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Break-Even Price</h3>
            </div>
            <div className="text-2xl font-bold text-white">
              {formatCompactValue(breakEvenPrice, quoteToken.decimals)}{" "}
              {quoteToken.symbol}
            </div>
            <div className="text-sm text-slate-400 mt-1">
              Price where total PnL equals zero
            </div>
          </div>
        )}
      </div>

      {/* Position States Section */}
      <div className="space-y-4">
        <h3 className="text-xl font-semibold text-white mb-6">Position States</h3>

        <div className="space-y-6">
          {/* Current Position State */}
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Minus className="w-5 h-5 text-blue-400" />
              </div>
              <h4 className="text-lg font-semibold text-white">Current State</h4>
            </div>

            <div className="flex gap-6">
              {/* Left Half - Data */}
              <div className="flex-1 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Base Token:</span>
                  <div className="flex items-center gap-2 text-white">
                    {baseToken.logoUrl && (
                      <Image
                        src={baseToken.logoUrl}
                        alt={baseToken.symbol}
                        width={16}
                        height={16}
                        className="rounded-full"
                      />
                    )}
                    <span>
                      {formatCompactValue(
                        positionStates.current.baseTokenAmount,
                        baseToken.decimals
                      )}{" "}
                      {baseToken.symbol}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Quote Token:</span>
                  <div className="flex items-center gap-2 text-white">
                    {quoteToken.logoUrl && (
                      <Image
                        src={quoteToken.logoUrl}
                        alt={quoteToken.symbol}
                        width={16}
                        height={16}
                        className="rounded-full"
                      />
                    )}
                    <span>
                      {formatCompactValue(
                        positionStates.current.quoteTokenAmount,
                        quoteToken.decimals
                      )}{" "}
                      {quoteToken.symbol}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Pool Price:</span>
                  <span className="text-white">
                    {formatCompactValue(
                      positionStates.current.poolPrice,
                      quoteToken.decimals
                    )}{" "}
                    {quoteToken.symbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Position Value:</span>
                  <span className="text-white">
                    {formatCompactValue(
                      positionStates.current.positionValue,
                      quoteToken.decimals
                    )}{" "}
                    {quoteToken.symbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">PnL Including Fees:</span>
                  <span
                    className={`${
                      positionStates.current.pnlIncludingFees > 0n
                        ? "text-green-400"
                        : positionStates.current.pnlIncludingFees < 0n
                        ? "text-red-400"
                        : "text-slate-400"
                    }`}
                  >
                    {formatCompactValue(
                      positionStates.current.pnlIncludingFees,
                      quoteToken.decimals
                    )}{" "}
                    {quoteToken.symbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">PnL Excluding Fees:</span>
                  <span
                    className={`${
                      positionStates.current.pnlExcludingFees > 0n
                        ? "text-green-400"
                        : positionStates.current.pnlExcludingFees < 0n
                        ? "text-red-400"
                        : "text-slate-400"
                    }`}
                  >
                    {formatCompactValue(
                      positionStates.current.pnlExcludingFees,
                      quoteToken.decimals
                    )}{" "}
                    {quoteToken.symbol}
                  </span>
                </div>
              </div>

              {/* Right Half - Mini PnL Curve */}
              <div className="flex-1 flex items-center justify-center">
                <UniswapV3MiniPnLCurve
                  position={position as any}
                  width={240}
                  height={144}
                  // Current state - use actual pool tick (no override needed)
                />
              </div>
            </div>
          </div>

          {/* Position at Lower Range */}
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-500/20 rounded-lg">
                <ChevronDown className="w-5 h-5 text-red-400" />
              </div>
              <h4 className="text-lg font-semibold text-white">Lower Range</h4>
            </div>

            <div className="flex gap-6">
              {/* Left Half - Data */}
              <div className="flex-1 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Base Token:</span>
                  <div className="flex items-center gap-2 text-white">
                    {baseToken.logoUrl && (
                      <Image
                        src={baseToken.logoUrl}
                        alt={baseToken.symbol}
                        width={16}
                        height={16}
                        className="rounded-full"
                      />
                    )}
                    <span>
                      {formatCompactValue(
                        positionStates.lowerRange.baseTokenAmount,
                        baseToken.decimals
                      )}{" "}
                      {baseToken.symbol}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Quote Token:</span>
                  <div className="flex items-center gap-2 text-white">
                    {quoteToken.logoUrl && (
                      <Image
                        src={quoteToken.logoUrl}
                        alt={quoteToken.symbol}
                        width={16}
                        height={16}
                        className="rounded-full"
                      />
                    )}
                    <span>
                      {formatCompactValue(
                        positionStates.lowerRange.quoteTokenAmount,
                        quoteToken.decimals
                      )}{" "}
                      {quoteToken.symbol}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Pool Price:</span>
                  <span className="text-white">
                    {formatCompactValue(
                      positionStates.lowerRange.poolPrice,
                      quoteToken.decimals
                    )}{" "}
                    {quoteToken.symbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Position Value:</span>
                  <span className="text-white">
                    {formatCompactValue(
                      positionStates.lowerRange.positionValue,
                      quoteToken.decimals
                    )}{" "}
                    {quoteToken.symbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">PnL Including Fees:</span>
                  <span
                    className={`${
                      positionStates.lowerRange.pnlIncludingFees > 0n
                        ? "text-green-400"
                        : positionStates.lowerRange.pnlIncludingFees < 0n
                        ? "text-red-400"
                        : "text-slate-400"
                    }`}
                  >
                    {formatCompactValue(
                      positionStates.lowerRange.pnlIncludingFees,
                      quoteToken.decimals
                    )}{" "}
                    {quoteToken.symbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">PnL Excluding Fees:</span>
                  <span
                    className={`${
                      positionStates.lowerRange.pnlExcludingFees > 0n
                        ? "text-green-400"
                        : positionStates.lowerRange.pnlExcludingFees < 0n
                        ? "text-red-400"
                        : "text-slate-400"
                    }`}
                  >
                    {formatCompactValue(
                      positionStates.lowerRange.pnlExcludingFees,
                      quoteToken.decimals
                    )}{" "}
                    {quoteToken.symbol}
                  </span>
                </div>
              </div>

              {/* Right Half - Mini PnL Curve */}
              <div className="flex-1 flex items-center justify-center">
                <UniswapV3MiniPnLCurve
                  position={position as any}
                  width={240}
                  height={144}
                  overrideTick={(position.config as { tickLower: number }).tickLower}
                />
              </div>
            </div>
          </div>

          {/* Position at Upper Range */}
          <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <ChevronUp className="w-5 h-5 text-green-400" />
              </div>
              <h4 className="text-lg font-semibold text-white">Upper Range</h4>
            </div>

            <div className="flex gap-6">
              {/* Left Half - Data */}
              <div className="flex-1 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Base Token:</span>
                  <div className="flex items-center gap-2 text-white">
                    {baseToken.logoUrl && (
                      <Image
                        src={baseToken.logoUrl}
                        alt={baseToken.symbol}
                        width={16}
                        height={16}
                        className="rounded-full"
                      />
                    )}
                    <span>
                      {formatCompactValue(
                        positionStates.upperRange.baseTokenAmount,
                        baseToken.decimals
                      )}{" "}
                      {baseToken.symbol}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Quote Token:</span>
                  <div className="flex items-center gap-2 text-white">
                    {quoteToken.logoUrl && (
                      <Image
                        src={quoteToken.logoUrl}
                        alt={quoteToken.symbol}
                        width={16}
                        height={16}
                        className="rounded-full"
                      />
                    )}
                    <span>
                      {formatCompactValue(
                        positionStates.upperRange.quoteTokenAmount,
                        quoteToken.decimals
                      )}{" "}
                      {quoteToken.symbol}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Pool Price:</span>
                  <span className="text-white">
                    {formatCompactValue(
                      positionStates.upperRange.poolPrice,
                      quoteToken.decimals
                    )}{" "}
                    {quoteToken.symbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Position Value:</span>
                  <span className="text-white">
                    {formatCompactValue(
                      positionStates.upperRange.positionValue,
                      quoteToken.decimals
                    )}{" "}
                    {quoteToken.symbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">PnL Including Fees:</span>
                  <span
                    className={`${
                      positionStates.upperRange.pnlIncludingFees > 0n
                        ? "text-green-400"
                        : positionStates.upperRange.pnlIncludingFees < 0n
                        ? "text-red-400"
                        : "text-slate-400"
                    }`}
                  >
                    {formatCompactValue(
                      positionStates.upperRange.pnlIncludingFees,
                      quoteToken.decimals
                    )}{" "}
                    {quoteToken.symbol}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">PnL Excluding Fees:</span>
                  <span
                    className={`${
                      positionStates.upperRange.pnlExcludingFees > 0n
                        ? "text-green-400"
                        : positionStates.upperRange.pnlExcludingFees < 0n
                        ? "text-red-400"
                        : "text-slate-400"
                    }`}
                  >
                    {formatCompactValue(
                      positionStates.upperRange.pnlExcludingFees,
                      quoteToken.decimals
                    )}{" "}
                    {quoteToken.symbol}
                  </span>
                </div>
              </div>

              {/* Right Half - Mini PnL Curve */}
              <div className="flex-1 flex items-center justify-center">
                <UniswapV3MiniPnLCurve
                  position={position as any}
                  width={240}
                  height={144}
                  overrideTick={(position.config as { tickUpper: number }).tickUpper}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
