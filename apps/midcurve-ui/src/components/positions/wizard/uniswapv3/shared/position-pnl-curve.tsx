"use client";

import { useMemo } from "react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  Tooltip,
} from "recharts";
import {
  generatePnLCurve,
  tickToPrice,
  compareAddresses,
  getTickSpacing,
} from "@midcurve/shared";
import type { UniswapV3Pool, Erc20Token } from "@midcurve/shared";

interface PositionPnLCurveProps {
  pool: UniswapV3Pool;
  baseToken: Erc20Token;
  quoteToken: Erc20Token;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  costBasis: bigint; // Initial value for PnL calculation
  sliderBounds?: { min: number; max: number }; // Visual range bounds from slider
  height?: number;
  className?: string;
}

export function PositionPnLCurve({
  pool,
  baseToken,
  quoteToken,
  tickLower,
  tickUpper,
  liquidity,
  costBasis,
  sliderBounds,
  height = 400,
  className,
}: PositionPnLCurveProps) {
  // Calculate current price for entry point marker
  const currentPrice = useMemo(() => {
    if (!pool?.state?.currentTick || !baseToken || !quoteToken) {
      return 0;
    }

    try {
      // Determine which token is token0/token1
      const isBaseToken0 =
        compareAddresses(pool.token0.config.address, baseToken.config.address) === 0;

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
      console.error("Error calculating current price:", error);
      return 0;
    }
  }, [pool, baseToken, quoteToken]);

  // Calculate lower and upper prices for display
  const { lowerPrice, upperPrice } = useMemo(() => {
    if (!baseToken || !quoteToken) {
      return { lowerPrice: 0, upperPrice: 0 };
    }

    try {
      const isBaseToken0 =
        compareAddresses(pool.token0.config.address, baseToken.config.address) === 0;

      const baseTokenDecimals = isBaseToken0
        ? pool.token0.decimals
        : pool.token1.decimals;

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

      const divisor = 10n ** BigInt(quoteToken.decimals);

      return {
        lowerPrice: Number(lowerPriceBigInt) / Number(divisor),
        upperPrice: Number(upperPriceBigInt) / Number(divisor),
      };
    } catch (error) {
      console.error("Error calculating range prices:", error);
      return { lowerPrice: 0, upperPrice: 0 };
    }
  }, [baseToken, quoteToken, tickLower, tickUpper, pool]);

  // Generate PnL curve data
  const curveData = useMemo(() => {
    if (!baseToken?.config?.address || !quoteToken?.config?.address || liquidity === 0n) {
      return [];
    }

    try {
      // Get tick spacing from pool fee (feeBps)
      const tickSpacing = getTickSpacing(pool.feeBps);

      // Use slider bounds if available, otherwise use position range
      const visualMin = sliderBounds?.min ?? lowerPrice;
      const visualMax = sliderBounds?.max ?? upperPrice;

      // Calculate price range for curve using visual bounds
      const priceMinBigInt = BigInt(Math.floor(visualMin * Number(10n ** BigInt(quoteToken.decimals))));
      const priceMaxBigInt = BigInt(Math.floor(visualMax * Number(10n ** BigInt(quoteToken.decimals))));

      const priceMin = priceMinBigInt > 0n ? priceMinBigInt : 1n;
      const priceMax = priceMaxBigInt;

      // Generate curve data using shared utility
      const data = generatePnLCurve(
        liquidity,
        tickLower,
        tickUpper,
        costBasis,
        baseToken.config.address,
        quoteToken.config.address,
        baseToken.decimals,
        tickSpacing,
        { min: priceMin > 0n ? priceMin : 1n, max: priceMax }
      );

      // Convert BigInt values to numbers for display
      return data.map((point) => {
        const priceDisplay = Number(point.price) / Number(10n ** BigInt(quoteToken.decimals));
        const pnlDisplay = Number(point.pnl) / Number(10n ** BigInt(quoteToken.decimals));
        const positionValueDisplay = Number(point.positionValue) / Number(10n ** BigInt(quoteToken.decimals));

        return {
          price: priceDisplay,
          positionValue: positionValueDisplay,
          pnl: pnlDisplay,
          pnlPercent: point.pnlPercent,
          phase: point.phase,
          profitZone: pnlDisplay > 0 ? pnlDisplay : null,
          lossZone: pnlDisplay < 0 ? pnlDisplay : null,
        };
      });
    } catch (error) {
      console.error("Error generating PnL curve:", error);
      return [];
    }
  }, [
    baseToken,
    quoteToken,
    liquidity,
    tickLower,
    tickUpper,
    costBasis,
    lowerPrice,
    upperPrice,
    sliderBounds,
    pool.feeBps,
  ]);

  // Custom dot component for entry point
  const CustomDot = (props: any) => {
    const { cx, cy, index } = props;

    // Find the index of the point closest to current price
    if (!curveData.length) return null;

    const closestIndex = curveData.reduce((closest, point, i) => {
      const currentDiff = Math.abs(curveData[closest].price - currentPrice);
      const thisDiff = Math.abs(point.price - currentPrice);
      return thisDiff < currentDiff ? i : closest;
    }, 0);

    // Only show dot at the single closest point to current price
    if (index === closestIndex) {
      return (
        <circle
          cx={cx}
          cy={cy}
          r={6}
          fill="transparent"
          stroke="#60a5fa"
          strokeWidth={2}
        />
      );
    }
    return null;
  };

  // Custom tooltip component
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;

    const data = payload[0].payload;
    // Handle scatter points that might not have all properties
    if (!data.hasOwnProperty("positionValue")) return null;

    // Determine actual profit/loss status based on PnL value
    const isProfitable = data.pnl > 0;
    const statusLabel = isProfitable ? "Profit (Fees)" : "Loss (IL)";
    const statusColor = isProfitable ? "text-green-400" : "text-red-400";

    return (
      <div className="bg-slate-800/95 border border-slate-700 rounded-lg p-3 shadow-xl backdrop-blur-sm">
        <p className="text-slate-300 text-sm">
          <strong>Price:</strong> {quoteToken.symbol} {Number(label).toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </p>
        <p className="text-slate-300 text-sm">
          <strong>Position Value:</strong> {quoteToken.symbol} {data.positionValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </p>
        <p
          className={`text-sm font-medium ${
            data.pnl >= 0 ? "text-green-400" : "text-red-400"
          }`}
        >
          <strong>PnL:</strong> {quoteToken.symbol} {data.pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })} ({data.pnlPercent.toFixed(2)}%)
        </p>
        <p className={`text-xs ${statusColor}`}>
          Status: {statusLabel}
        </p>
      </div>
    );
  };

  if (curveData.length === 0) {
    return (
      <div className={`w-full ${className}`}>
        <div className="flex items-center justify-center h-64 text-slate-500">
          Unable to generate PnL curve. Please check position parameters.
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full ${className}`}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={curveData}
          margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />

          {/* Background zones based on profit/loss */}
          <Area
            type="monotone"
            dataKey="profitZone"
            fill="rgba(34, 197, 94, 0.3)"
            stroke="transparent"
            connectNulls={false}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="lossZone"
            fill="rgba(239, 68, 68, 0.3)"
            stroke="transparent"
            connectNulls={false}
            isAnimationActive={false}
          />

          <XAxis
            dataKey="price"
            type="number"
            scale="linear"
            domain={["dataMin", "dataMax"]}
            ticks={[lowerPrice, currentPrice, upperPrice]}
            tickFormatter={(value) => value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            stroke="#94a3b8"
            fontSize={12}
            axisLine={{ stroke: "#475569" }}
          />

          <YAxis
            domain={["auto", "auto"]}
            stroke="#94a3b8"
            fontSize={12}
            axisLine={{ stroke: "#475569" }}
            tick={(props) => {
              const { x, y, payload } = props;
              const isZero = Math.abs(payload.value) < 0.01;
              // Only show token symbol at zero line
              const label = isZero
                ? `${quoteToken.symbol} ${payload.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : payload.value.toLocaleString(undefined, { maximumFractionDigits: 0 });

              return (
                <text
                  x={x}
                  y={y}
                  dy={4}
                  textAnchor="end"
                  fill={isZero ? "#e2e8f0" : "#94a3b8"}
                  fontSize={12}
                  fontWeight={isZero ? "bold" : "normal"}
                >
                  {label}
                </text>
              );
            }}
          />

          {/* Lower range boundary */}
          <ReferenceLine
            x={lowerPrice}
            stroke="#06b6d4"
            strokeWidth={2}
            strokeDasharray="8 4"
            label={{
              value: "Min",
              position: "top",
              fill: "#06b6d4",
              fontSize: 12,
            }}
          />

          {/* Upper range boundary */}
          <ReferenceLine
            x={upperPrice}
            stroke="#06b6d4"
            strokeWidth={2}
            strokeDasharray="8 4"
            label={{
              value: "Max",
              position: "top",
              fill: "#06b6d4",
              fontSize: 12,
            }}
          />

          {/* Break-even line (PnL = 0) */}
          <ReferenceLine
            y={0}
            stroke="#64748b"
            strokeDasharray="3 3"
            strokeWidth={2}
          />

          {/* Main PnL curve */}
          <Line
            type="monotone"
            dataKey="pnl"
            stroke="#ffffff"
            strokeWidth={3}
            dot={<CustomDot />}
            activeDot={{
              r: 6,
              fill: "#ffffff",
              stroke: "#1e293b",
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />

          <Tooltip content={<CustomTooltip />} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
