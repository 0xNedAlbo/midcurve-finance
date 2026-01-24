'use client';

/**
 * HedgePnLCurve - PnL visualization for Hedge Vault positions
 *
 * Shows a modified PnL curve that reflects hedge vault behavior:
 * - Left of SIL: FLAT horizontal line at the PnL value at SIL price
 *   (position is closed, 100% quote token, no price risk)
 * - SIL to TIP: Standard UniswapV3 curved PnL (position active, rebalancing)
 * - Right of TIP: LINEAR upward line (position closed, 100% base token, full exposure)
 *
 * The left flat region "locks in" whatever PnL exists at SIL trigger.
 * The right linear region shows base token appreciation from TIP price onward.
 */

import { useMemo } from 'react';
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
} from 'recharts';
import {
  generatePnLCurve,
  tickToPrice,
  compareAddresses,
  getTickSpacing,
  pricePerToken0InToken1,
  pricePerToken1InToken0,
} from '@midcurve/shared';
import type { UniswapV3PoolResponse, Erc20TokenResponse } from '@midcurve/api-shared';
import { PnLCurveTooltip } from '@/components/positions/pnl-curve-tooltip';

interface HedgePnLCurveProps {
  pool: UniswapV3PoolResponse;
  baseToken: Erc20TokenResponse;
  quoteToken: Erc20TokenResponse;
  tickLower: number;
  tickUpper: number;
  silSqrtPriceX96: string;
  tipSqrtPriceX96: string;
  liquidity: bigint;
  costBasis: bigint;
  sliderBounds?: { min: number; max: number };
  height?: number;
  className?: string;
}

export function HedgePnLCurve({
  pool,
  baseToken,
  quoteToken,
  tickLower,
  tickUpper,
  silSqrtPriceX96,
  tipSqrtPriceX96,
  liquidity,
  costBasis,
  sliderBounds,
  height = 400,
  className,
}: HedgePnLCurveProps) {
  // Calculate current price for entry point marker
  const currentPrice = useMemo(() => {
    if (!pool?.state?.currentTick || !baseToken || !quoteToken) {
      return 0;
    }

    try {
      const isBaseToken0 =
        compareAddresses(pool.token0.config.address, baseToken.config.address) === 0;

      const baseTokenDecimals = isBaseToken0
        ? pool.token0.decimals
        : pool.token1.decimals;

      const priceBigInt = tickToPrice(
        pool.state.currentTick,
        baseToken.config.address,
        quoteToken.config.address,
        baseTokenDecimals
      );

      const divisor = 10n ** BigInt(quoteToken.decimals);
      return Number(priceBigInt) / Number(divisor);
    } catch (error) {
      console.error('Error calculating current price:', error);
      return 0;
    }
  }, [pool, baseToken, quoteToken]);

  // Convert SIL/TIP sqrtPriceX96 to human-readable prices
  const { silPrice, tipPrice } = useMemo(() => {
    if (!silSqrtPriceX96 || !tipSqrtPriceX96 || !baseToken || !quoteToken) {
      return { silPrice: 0, tipPrice: 0 };
    }

    try {
      const baseIsToken0 =
        BigInt(baseToken.config.address) < BigInt(quoteToken.config.address);

      const silSqrt = BigInt(silSqrtPriceX96);
      const tipSqrt = BigInt(tipSqrtPriceX96);

      // Get price in quote token raw units (quote per base)
      const silPriceBigInt = baseIsToken0
        ? pricePerToken0InToken1(silSqrt, baseToken.decimals)
        : pricePerToken1InToken0(silSqrt, baseToken.decimals);

      const tipPriceBigInt = baseIsToken0
        ? pricePerToken0InToken1(tipSqrt, baseToken.decimals)
        : pricePerToken1InToken0(tipSqrt, baseToken.decimals);

      const divisor = 10n ** BigInt(quoteToken.decimals);

      return {
        silPrice: Number(silPriceBigInt) / Number(divisor),
        tipPrice: Number(tipPriceBigInt) / Number(divisor),
      };
    } catch (error) {
      console.error('Error calculating SIL/TIP prices:', error);
      return { silPrice: 0, tipPrice: 0 };
    }
  }, [silSqrtPriceX96, tipSqrtPriceX96, baseToken, quoteToken]);

  // Calculate position range prices
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

      const priceAtTickLower = tickToPrice(
        tickLower,
        baseToken.config.address,
        quoteToken.config.address,
        baseTokenDecimals
      );

      const priceAtTickUpper = tickToPrice(
        tickUpper,
        baseToken.config.address,
        quoteToken.config.address,
        baseTokenDecimals
      );

      const divisor = 10n ** BigInt(quoteToken.decimals);
      const isToken0Quote = !isBaseToken0;

      return {
        lowerPrice: isToken0Quote
          ? Number(priceAtTickUpper) / Number(divisor)
          : Number(priceAtTickLower) / Number(divisor),
        upperPrice: isToken0Quote
          ? Number(priceAtTickLower) / Number(divisor)
          : Number(priceAtTickUpper) / Number(divisor),
      };
    } catch (error) {
      console.error('Error calculating range prices:', error);
      return { lowerPrice: 0, upperPrice: 0 };
    }
  }, [baseToken, quoteToken, tickLower, tickUpper, pool]);

  // Generate hedge vault PnL curve data
  const curveData = useMemo(() => {
    if (
      !baseToken?.config?.address ||
      !quoteToken?.config?.address ||
      liquidity === 0n ||
      silPrice === 0 ||
      tipPrice === 0
    ) {
      return [];
    }

    try {
      const tickSpacing = getTickSpacing(pool.feeBps);

      // Use slider bounds if available
      const visualMin = sliderBounds?.min ?? Math.min(silPrice * 0.8, lowerPrice * 0.8);
      const visualMax = sliderBounds?.max ?? Math.max(tipPrice * 1.2, upperPrice * 1.2);

      const priceMinBigInt = BigInt(
        Math.floor(visualMin * Number(10n ** BigInt(quoteToken.decimals)))
      );
      const priceMaxBigInt = BigInt(
        Math.floor(visualMax * Number(10n ** BigInt(quoteToken.decimals)))
      );

      const priceMin = priceMinBigInt > 0n ? priceMinBigInt : 1n;
      const priceMax = priceMaxBigInt;

      // Generate standard PnL curve data
      const rawData = generatePnLCurve(
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

      const divisor = Number(10n ** BigInt(quoteToken.decimals));

      // Convert to display values
      const displayData = rawData.map((point) => ({
        price: Number(point.price) / divisor,
        pnl: Number(point.pnl) / divisor,
        positionValue: Number(point.positionValue) / divisor,
        pnlPercent: point.pnlPercent,
        phase: point.phase,
      }));

      // Find PnL values at SIL and TIP prices
      const silPnL = interpolatePnL(displayData, silPrice);
      const tipPnL = interpolatePnL(displayData, tipPrice);
      const tipValue = interpolatePositionValue(displayData, tipPrice);

      // Modify curve for hedge vault behavior
      return displayData.map((point) => {
        let hedgePnL: number;
        let zone: 'flat' | 'active' | 'linear';

        if (point.price <= silPrice) {
          // Left of SIL: FLAT horizontal line at SIL PnL
          hedgePnL = silPnL;
          zone = 'flat';
        } else if (point.price >= tipPrice) {
          // Right of TIP: LINEAR upward line
          // When above TIP, position is 100% base token
          // Linear increase based on price appreciation from TIP
          const priceIncrease = point.price - tipPrice;
          // The position value at TIP is all in base tokens
          // So the PnL increases linearly with price
          const baseTokenAmount = tipValue / tipPrice; // Approximate base token amount
          hedgePnL = tipPnL + priceIncrease * baseTokenAmount;
          zone = 'linear';
        } else {
          // Between SIL and TIP: Standard curve
          hedgePnL = point.pnl;
          zone = 'active';
        }

        return {
          price: point.price,
          pnl: hedgePnL,
          originalPnl: point.pnl,
          positionValue: point.positionValue,
          pnlPercent: point.pnlPercent,
          phase: point.phase,
          zone,
          profitZone: hedgePnL > 0 ? hedgePnL : null,
          lossZone: hedgePnL < 0 ? hedgePnL : null,
        };
      });
    } catch (error) {
      console.error('Error generating hedge PnL curve:', error);
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
    silPrice,
    tipPrice,
    sliderBounds,
    pool.feeBps,
  ]);

  // Custom dot component for current price
  const CustomDot = (props: any) => {
    const { cx, cy, index } = props;

    if (!curveData.length) return null;

    const closestIndex = curveData.reduce((closest, point, i) => {
      const currentDiff = Math.abs(curveData[closest].price - currentPrice);
      const thisDiff = Math.abs(point.price - currentPrice);
      return thisDiff < currentDiff ? i : closest;
    }, 0);

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

  // Recharts tooltip adapter
  const RechartsTooltipAdapter = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;

    const data = payload[0].payload;
    if (!data.hasOwnProperty('positionValue')) return null;

    return (
      <PnLCurveTooltip
        price={Number(label)}
        positionValue={data.positionValue}
        pnl={data.pnl}
        pnlPercent={data.pnlPercent}
        quoteToken={quoteToken}
      />
    );
  };

  if (curveData.length === 0) {
    return (
      <div className={`w-full ${className}`}>
        <div className="flex items-center justify-center h-64 text-slate-500">
          Configure SIL and TIP triggers to see the hedge curve
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
            domain={['dataMin', 'dataMax']}
            ticks={[silPrice, currentPrice, tipPrice]}
            tickFormatter={(value) =>
              value.toLocaleString(undefined, { maximumFractionDigits: 0 })
            }
            stroke="#94a3b8"
            fontSize={12}
            axisLine={{ stroke: '#475569' }}
          />

          <YAxis
            domain={['auto', 'auto']}
            stroke="#94a3b8"
            fontSize={12}
            axisLine={{ stroke: '#475569' }}
            tick={(props) => {
              const { x, y, payload } = props;
              const isZero = Math.abs(payload.value) < 0.01;
              const label = isZero
                ? `${quoteToken.symbol} ${payload.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : payload.value.toLocaleString(undefined, {
                    maximumFractionDigits: 0,
                  });

              return (
                <text
                  x={x}
                  y={y}
                  dy={4}
                  textAnchor="end"
                  fill={isZero ? '#e2e8f0' : '#94a3b8'}
                  fontSize={12}
                  fontWeight={isZero ? 'bold' : 'normal'}
                >
                  {label}
                </text>
              );
            }}
          />

          {/* SIL trigger line */}
          <ReferenceLine
            x={silPrice}
            stroke="#ef4444"
            strokeWidth={2}
            strokeDasharray="8 4"
            label={{
              value: 'SIL',
              position: 'top',
              fill: '#ef4444',
              fontSize: 12,
              fontWeight: 'bold',
            }}
          />

          {/* TIP trigger line */}
          <ReferenceLine
            x={tipPrice}
            stroke="#22c55e"
            strokeWidth={2}
            strokeDasharray="8 4"
            label={{
              value: 'TIP',
              position: 'top',
              fill: '#22c55e',
              fontSize: 12,
              fontWeight: 'bold',
            }}
          />

          {/* Position range boundaries (lighter, secondary) */}
          <ReferenceLine
            x={lowerPrice}
            stroke="#06b6d4"
            strokeWidth={1}
            strokeDasharray="4 4"
            opacity={0.5}
          />
          <ReferenceLine
            x={upperPrice}
            stroke="#06b6d4"
            strokeWidth={1}
            strokeDasharray="4 4"
            opacity={0.5}
          />

          {/* Break-even line (PnL = 0) */}
          <ReferenceLine
            y={0}
            stroke="#64748b"
            strokeDasharray="3 3"
            strokeWidth={2}
          />

          {/* Main hedge PnL curve */}
          <Line
            type="monotone"
            dataKey="pnl"
            stroke="#a855f7"
            strokeWidth={3}
            dot={<CustomDot />}
            activeDot={{
              r: 6,
              fill: '#a855f7',
              stroke: '#1e293b',
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />

          <Tooltip content={<RechartsTooltipAdapter />} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-red-500" />
          <span className="text-slate-400">SIL (Stop IL)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-green-500" />
          <span className="text-slate-400">TIP (Take IP)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-0.5 bg-violet-500" />
          <span className="text-slate-400">Hedge PnL</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Helper function to interpolate PnL at a specific price
 */
function interpolatePnL(
  data: Array<{ price: number; pnl: number }>,
  targetPrice: number
): number {
  if (data.length === 0) return 0;

  // Find the two points surrounding the target price
  let lowerPoint = data[0];
  let upperPoint = data[data.length - 1];

  for (let i = 0; i < data.length - 1; i++) {
    if (data[i].price <= targetPrice && data[i + 1].price >= targetPrice) {
      lowerPoint = data[i];
      upperPoint = data[i + 1];
      break;
    }
  }

  // Linear interpolation
  if (upperPoint.price === lowerPoint.price) {
    return lowerPoint.pnl;
  }

  const ratio =
    (targetPrice - lowerPoint.price) / (upperPoint.price - lowerPoint.price);
  return lowerPoint.pnl + ratio * (upperPoint.pnl - lowerPoint.pnl);
}

/**
 * Helper function to interpolate position value at a specific price
 */
function interpolatePositionValue(
  data: Array<{ price: number; positionValue: number }>,
  targetPrice: number
): number {
  if (data.length === 0) return 0;

  let lowerPoint = data[0];
  let upperPoint = data[data.length - 1];

  for (let i = 0; i < data.length - 1; i++) {
    if (data[i].price <= targetPrice && data[i + 1].price >= targetPrice) {
      lowerPoint = data[i];
      upperPoint = data[i + 1];
      break;
    }
  }

  if (upperPoint.price === lowerPoint.price) {
    return lowerPoint.positionValue;
  }

  const ratio =
    (targetPrice - lowerPoint.price) / (upperPoint.price - lowerPoint.price);
  return (
    lowerPoint.positionValue +
    ratio * (upperPoint.positionValue - lowerPoint.positionValue)
  );
}
