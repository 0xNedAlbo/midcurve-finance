/**
 * PortfolioSimulator
 *
 * Replaces UniswapV3PositionSimulator in the position detail overview tab.
 * Uses the SimulationEngine for path-aware trigger simulation and the
 * SimulationPnLCurve (Visx chart) for visualization.
 */

"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { SlidersHorizontal, RotateCcw } from "lucide-react";
import { formatCompactValue } from "@/lib/fraction-format";
import { extractCloseOrderData } from "@/lib/position-states";
import type { UniswapV3PositionData } from "@/hooks/positions/uniswapv3/useUniswapV3Position";
import {
  UniswapV3Position,
  UniswapV3Pool,
  tickToPrice,
  createUniswapV3SimulationEngine,
} from "@midcurve/shared";
import type { PoolJSON, SimulationEngine, SimulationResult, CurvePoint, TriggeredEvent } from "@midcurve/shared";
import { SimulationPnLCurve, type TriggerLineData } from "./pnl-curve/simulation-pnl-curve";

interface PortfolioSimulatorProps {
  position: UniswapV3PositionData;
}

export function PortfolioSimulator({ position }: PortfolioSimulatorProps) {
  const quoteToken = position.isToken0Quote ? position.pool.token0 : position.pool.token1;
  const baseToken = position.isToken0Quote ? position.pool.token1 : position.pool.token0;
  const baseTokenConfig = baseToken.config as { address: string };
  const quoteTokenConfig = quoteToken.config as { address: string };
  const positionConfig = position.config as { tickLower: number; tickUpper: number };
  const poolState = position.pool.state as { currentTick: number; sqrtPriceX96: string };

  // Calculate range prices
  const { lowerRangePrice, upperRangePrice, minPrice, maxPrice, currentPoolPrice } = useMemo(() => {
    const priceAtTickLower = tickToPrice(
      positionConfig.tickLower,
      baseTokenConfig.address,
      quoteTokenConfig.address,
      Number(baseToken.decimals),
    );
    const priceAtTickUpper = tickToPrice(
      positionConfig.tickUpper,
      baseTokenConfig.address,
      quoteTokenConfig.address,
      Number(baseToken.decimals),
    );
    const lower = position.isToken0Quote ? priceAtTickUpper : priceAtTickLower;
    const upper = position.isToken0Quote ? priceAtTickLower : priceAtTickUpper;

    const rangeWidth = upper - lower;
    const extension = (rangeWidth * 30n) / 100n;

    const currentPrice = tickToPrice(
      poolState.currentTick,
      baseTokenConfig.address,
      quoteTokenConfig.address,
      Number(baseToken.decimals),
    );

    return {
      lowerRangePrice: lower,
      upperRangePrice: upper,
      minPrice: lower - extension,
      maxPrice: upper + extension,
      currentPoolPrice: currentPrice,
    };
  }, [positionConfig, baseTokenConfig.address, quoteTokenConfig.address, baseToken.decimals, position.isToken0Quote, poolState.currentTick]);

  // Extract close order data
  const closeOrderData = useMemo(() => extractCloseOrderData(
    position.closeOrders,
    position.isToken0Quote,
    position.pool.token0.decimals,
    position.pool.token1.decimals,
    quoteToken.decimals,
  ), [position.closeOrders, position.isToken0Quote, position.pool.token0.decimals, position.pool.token1.decimals, quoteToken.decimals]);

  // Create simulation engine (useRef for mutability)
  const engineRef = useRef<SimulationEngine | null>(null);

  // Track the deps that should trigger engine recreation
  const engineDepsKey = useMemo(() => {
    return `${position.id}-${poolState.currentTick}-${position.state.liquidity}-${closeOrderData.stopLossPrice}-${closeOrderData.takeProfitPrice}`;
  }, [position.id, poolState.currentTick, position.state.liquidity, closeOrderData.stopLossPrice, closeOrderData.takeProfitPrice]);

  // Build or rebuild engine when deps change
  const engine = useMemo(() => {
    const pool = UniswapV3Pool.fromJSON(position.pool as unknown as PoolJSON);
    const simulationPosition = UniswapV3Position.forSimulation({
      pool,
      isToken0Quote: position.isToken0Quote,
      tickLower: positionConfig.tickLower,
      tickUpper: positionConfig.tickUpper,
      liquidity: BigInt(position.state.liquidity),
      costBasis: BigInt(position.costBasis),
    });

    const eng = createUniswapV3SimulationEngine({
      position: simulationPosition,
      isToken0Quote: position.isToken0Quote,
      currentPoolPrice,
      stopLossPrice: closeOrderData.stopLossPrice,
      takeProfitPrice: closeOrderData.takeProfitPrice,
      stopLossSwapConfig: closeOrderData.slSwapConfig,
      takeProfitSwapConfig: closeOrderData.tpSwapConfig,
    });

    engineRef.current = eng;
    return eng;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineDepsKey]);

  // Simulation state — simulatedPrice is the source of truth, sliderValue is derived
  const [simulatedPrice, setSimulatedPrice] = useState<bigint>(currentPoolPrice);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [curvePoints, setCurvePoints] = useState<CurvePoint[]>([]);
  const [triggeredEvents, setTriggeredEvents] = useState<readonly TriggeredEvent[]>([]);
  const [sliderBounds, setSliderBounds] = useState<{ min: number; max: number } | undefined>(undefined);

  // Effective price range for slider (tracks zoom when active)
  const quoteDivisor = useMemo(() => 10n ** BigInt(quoteToken.decimals), [quoteToken.decimals]);
  const effectiveMinPrice = useMemo(() => {
    if (!sliderBounds) return minPrice;
    return BigInt(Math.floor(sliderBounds.min * Number(quoteDivisor)));
  }, [sliderBounds, minPrice, quoteDivisor]);
  const effectiveMaxPrice = useMemo(() => {
    if (!sliderBounds) return maxPrice;
    return BigInt(Math.ceil(sliderBounds.max * Number(quoteDivisor)));
  }, [sliderBounds, maxPrice, quoteDivisor]);

  // Derive slider position from the locked simulated price
  const sliderValue = useMemo(() => {
    const range = effectiveMaxPrice - effectiveMinPrice;
    if (range <= 0n) return 50;
    const raw = Number((simulatedPrice - effectiveMinPrice) * 100n / range);
    return Math.max(0, Math.min(100, Math.round(raw)));
  }, [simulatedPrice, effectiveMinPrice, effectiveMaxPrice]);

  // Initial curve generation (before any slider interaction)
  useMemo(() => {
    const points = engine.generateCurvePoints(minPrice, maxPrice, 100);
    setCurvePoints(points);
    // Also run initial simulate at current pool price
    const result = engine.simulate(currentPoolPrice);
    setSimulationResult(result);
    setTriggeredEvents(engine.getTriggeredEvents());
  }, [engine, minPrice, maxPrice, currentPoolPrice]);

  // Regenerate curve points when zoom range changes
  useEffect(() => {
    if (!sliderBounds) return; // Only when zoomed (initial generation handled above)
    const eng = engineRef.current;
    if (!eng) return;
    const points = eng.generateCurvePoints(effectiveMinPrice, effectiveMaxPrice, 100);
    setCurvePoints(points);
  }, [effectiveMinPrice, effectiveMaxPrice, sliderBounds]);

  // Handle slider change — compute price from slider position, store as source of truth
  const handleSliderChange = useCallback((newSliderValue: number) => {
    const range = effectiveMaxPrice - effectiveMinPrice;
    const price = range > 0n
      ? effectiveMinPrice + (range * BigInt(newSliderValue)) / 100n
      : effectiveMinPrice;
    setSimulatedPrice(price);

    const eng = engineRef.current;
    if (!eng) return;

    const result = eng.simulate(price);
    setSimulationResult(result);
    setTriggeredEvents(eng.getTriggeredEvents());

    // Regenerate curve points (state may have changed due to triggers)
    const points = eng.generateCurvePoints(effectiveMinPrice, effectiveMaxPrice, 100);
    setCurvePoints(points);
  }, [effectiveMinPrice, effectiveMaxPrice]);

  // Handle reset
  const handleReset = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;

    eng.reset();
    setSimulatedPrice(currentPoolPrice);
    setSliderBounds(undefined);
    setSimulationResult(null);
    setTriggeredEvents([]);

    const points = eng.generateCurvePoints(minPrice, maxPrice, 100);
    setCurvePoints(points);

    // Simulate at current pool price
    const result = eng.simulate(currentPoolPrice);
    setSimulationResult(result);
    setTriggeredEvents(eng.getTriggeredEvents());
  }, [minPrice, maxPrice, currentPoolPrice]);

  // Build trigger line data for the chart
  const triggerLines: TriggerLineData[] = useMemo(() => {
    const lines: TriggerLineData[] = [];
    const firedIds = new Set(triggeredEvents.map(e => e.instrumentId));

    if (closeOrderData.stopLossPrice) {
      lines.push({
        id: 'stop_loss',
        label: 'SL',
        price: closeOrderData.stopLossPrice,
        fired: firedIds.has('stop_loss'),
      });
    }
    if (closeOrderData.takeProfitPrice) {
      lines.push({
        id: 'take_profit',
        label: 'TP',
        price: closeOrderData.takeProfitPrice,
        fired: firedIds.has('take_profit'),
      });
    }
    return lines;
  }, [closeOrderData, triggeredEvents]);

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <SlidersHorizontal className="w-5 h-5 text-purple-400" />
          </div>
          <h4 className="text-lg font-semibold text-white">Portfolio Simulation</h4>
        </div>
        <button
          onClick={handleReset}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-700/50 text-slate-300 border border-slate-600/50 hover:bg-slate-700 transition-colors cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" />
          Reset Simulation
        </button>
      </div>

      {/* Summary Cards */}
      {simulationResult && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          {/* Card 1: Prices */}
          <div className="bg-slate-700/30 rounded-lg px-3 py-2 border border-slate-600/30">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-300">Simulated Price</span>
              <span className="text-sm font-medium text-purple-400">
                {formatCompactValue(simulatedPrice, quoteToken.decimals)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-300">Current Price</span>
              <span className="text-sm text-blue-400">
                {formatCompactValue(currentPoolPrice, quoteToken.decimals)}
              </span>
            </div>
          </div>

          {/* Card 2: PnL */}
          <div className="bg-slate-700/30 rounded-lg px-3 py-2 border border-slate-600/30">
            <div className="text-xs text-slate-300 mb-1">PnL at Simulated Price</div>
            <div className={`text-sm font-medium ${simulationResult.pnlValue > 0n ? 'text-green-400' : simulationResult.pnlValue < 0n ? 'text-red-400' : 'text-slate-400'}`}>
              {formatCompactValue(simulationResult.pnlValue, quoteToken.decimals)} {quoteToken.symbol}
            </div>
            <div className={`text-xs ${simulationResult.pnlPercent >= 0 ? 'text-green-400/70' : 'text-red-400/70'}`}>
              {simulationResult.pnlPercent >= 0 ? '+' : ''}{simulationResult.pnlPercent.toFixed(2)}%
            </div>
          </div>

          {/* Card 3: Asset Composition */}
          <div className="bg-slate-700/30 rounded-lg px-3 py-2 border border-slate-600/30">
            <div className="text-xs text-slate-300 mb-1">Assets in Portfolio</div>
            <div className="flex items-center gap-1.5 text-sm text-white">
              {baseToken.logoUrl && <img src={baseToken.logoUrl} alt={baseToken.symbol} width={12} height={12} className="rounded-full" />}
              <span>{formatCompactValue(simulationResult.baseTokenAmount, baseToken.decimals)}</span>
              <span className="text-slate-500 text-xs">{baseToken.symbol}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm text-white">
              {quoteToken.logoUrl && <img src={quoteToken.logoUrl} alt={quoteToken.symbol} width={12} height={12} className="rounded-full" />}
              <span>{formatCompactValue(simulationResult.quoteTokenAmount, quoteToken.decimals)}</span>
              <span className="text-slate-500 text-xs">{quoteToken.symbol}</span>
            </div>
          </div>
        </div>
      )}

      {/* PnL Curve with integrated slider */}
      <div className="mb-4">
        <SimulationPnLCurve
          curvePoints={curvePoints}
          simulatedPrice={simulatedPrice}
          currentPoolPrice={currentPoolPrice}
          lowerRangePrice={lowerRangePrice}
          upperRangePrice={upperRangePrice}
          triggerLines={triggerLines}
          quoteToken={{ address: quoteTokenConfig.address, symbol: quoteToken.symbol, decimals: quoteToken.decimals }}
          baseToken={{ address: baseTokenConfig.address, symbol: baseToken.symbol, decimals: baseToken.decimals }}
          sliderBounds={sliderBounds}
          onSliderBoundsChange={setSliderBounds}
          sliderValue={sliderValue}
          onSliderChange={handleSliderChange}
          sliderMinPrice={effectiveMinPrice}
          sliderMaxPrice={effectiveMaxPrice}
          height={300}
        />
      </div>

      {/* Triggered Events */}
      {triggeredEvents.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {triggeredEvents.map((event, i) => (
            <div
              key={i}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
                event.instrumentId === 'stop_loss'
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'bg-green-500/20 text-green-400 border border-green-500/30'
              }`}
            >
              <span>{event.instrumentId === 'stop_loss' ? 'SL' : 'TP'} triggered at {formatCompactValue(event.triggeredAtPrice, quoteToken.decimals)} {quoteToken.symbol}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
