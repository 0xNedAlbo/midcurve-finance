import { useCallback, useMemo, useState, useEffect } from 'react';
import {
  Shield,
  Trash2,
  PlusCircle,
  MinusCircle,
  TrendingDown,
} from 'lucide-react';
import type { PnLScenario, SwapConfig } from '@midcurve/shared';
import {
  formatCompactValue,
  calculatePositionValue,
  compareAddresses,
  UniswapV3Position,
  CloseOrderSimulationOverlay,
  INFINITE_RUNUP,
} from '@midcurve/shared';
import { InteractivePnLCurve } from '@/components/positions/pnl-curve/uniswapv3';
import { PnLScenarioTabs } from '@/components/positions/pnl-curve/pnl-scenario-tabs';
import { RiskTriggersSection } from '@/components/positions/wizard/create-position/uniswapv3/shared/RiskTriggersSection';
import { PostCloseSwapSection } from '@/components/positions/wizard/create-position/uniswapv3/shared/PostCloseSwapSection';
import {
  useRiskTriggersWizard,
  computeSwapDirection,
  type SwapConfigState,
} from '../context/RiskTriggersWizardContext';

// Zoom constants
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.125;

export function ConfigureStep() {
  const {
    state,
    setStopLossPrice,
    clearStopLoss,
    setTakeProfitPrice,
    clearTakeProfit,
    setSlSwapEnabled,
    setSlSwapToQuote,
    setTpSwapEnabled,
    setTpSwapToQuote,
    setInteractiveZoom,
    setSummaryZoom,
    goNext,
    hasChanges,
    slOperation,
    tpOperation,
  } = useRiskTriggersWizard();

  const [scenario, setScenario] = useState<PnLScenario>('combined');

  // Auto-reset scenario when SL/TP is cleared
  useEffect(() => {
    if (scenario === 'sl_triggered' && !state.stopLoss.enabled) {
      setScenario('combined');
    }
    if (scenario === 'tp_triggered' && !state.takeProfit.enabled) {
      setScenario('combined');
    }
  }, [state.stopLoss.enabled, state.takeProfit.enabled, scenario]);

  const position = state.position;
  const pool = state.discoveredPool;

  // Extract token info from position
  const tokenInfo = useMemo(() => {
    if (!position) return null;
    const baseToken = position.isToken0Quote
      ? position.pool.token1
      : position.pool.token0;
    const quoteToken = position.isToken0Quote
      ? position.pool.token0
      : position.pool.token1;
    return {
      baseToken: {
        address: (baseToken.config as { address: string }).address,
        symbol: baseToken.symbol,
        decimals: baseToken.decimals,
      },
      quoteToken: {
        address: (quoteToken.config as { address: string }).address,
        symbol: quoteToken.symbol,
        decimals: quoteToken.decimals,
      },
      isToken0Quote: position.isToken0Quote,
    };
  }, [position]);

  // Determine if base token is token0
  const isToken0Base = useMemo(() => {
    if (!pool || !tokenInfo) return false;
    return (
      compareAddresses(
        pool.token0.config.address as string,
        tokenInfo.baseToken.address
      ) === 0
    );
  }, [pool, tokenInfo]);

  // Calculate current price for slider bounds and SL/TP defaults
  const currentPrice = useMemo(() => {
    if (!pool || !tokenInfo) return 0;
    try {
      const sqrtPriceX96 = BigInt(pool.state.sqrtPriceX96 as string);
      const Q96 = 2n ** 96n;
      const Q192 = Q96 * Q96;
      const rawPriceNum = sqrtPriceX96 * sqrtPriceX96;
      const token0Decimals = pool.token0.decimals;
      const token1Decimals = pool.token1.decimals;

      let priceInQuote: number;
      if (isToken0Base) {
        const decimalDiff = token0Decimals - token1Decimals;
        if (decimalDiff >= 0) {
          const adjustment = 10n ** BigInt(decimalDiff);
          priceInQuote =
            Number(rawPriceNum * adjustment) / Number(Q192);
        } else {
          const adjustment = 10n ** BigInt(-decimalDiff);
          priceInQuote =
            Number(rawPriceNum) / Number(Q192 * adjustment);
        }
      } else {
        const decimalDiff = token1Decimals - token0Decimals;
        if (decimalDiff >= 0) {
          const adjustment = 10n ** BigInt(decimalDiff);
          priceInQuote =
            Number(Q192 * adjustment) / Number(rawPriceNum);
        } else {
          const adjustment = 10n ** BigInt(-decimalDiff);
          priceInQuote =
            Number(Q192) / Number(rawPriceNum * adjustment);
        }
      }
      return priceInQuote;
    } catch {
      return 0;
    }
  }, [pool, tokenInfo, isToken0Base]);

  // Slider bounds for PnL curve
  const [sliderBounds, setSliderBounds] = useState<{
    min: number;
    max: number;
  }>({ min: 0, max: 0 });
  const [userAdjustedBounds, setUserAdjustedBounds] = useState(false);

  useEffect(() => {
    if (currentPrice > 0 && !userAdjustedBounds) {
      setSliderBounds({
        min: currentPrice * 0.5,
        max: currentPrice * 1.5,
      });
    }
  }, [currentPrice, userAdjustedBounds]);

  const handleSliderBoundsChange = useCallback(
    (bounds: { min: number; max: number }) => {
      setSliderBounds(bounds);
      setUserAdjustedBounds(true);
    },
    []
  );

  // Extract position data
  const positionConfig = useMemo(() => {
    if (!position) return null;
    const config = position.config as {
      tickLower: number;
      tickUpper: number;
    };
    const posState = position.state as { liquidity: string };
    return {
      tickLower: config.tickLower,
      tickUpper: config.tickUpper,
      liquidity: BigInt(posState.liquidity),
    };
  }, [position]);

  // Cost basis from position
  const costBasis = useMemo(() => {
    if (!positionConfig || !pool || positionConfig.liquidity === 0n) return 0n;
    try {
      const sqrtPriceX96 = BigInt(pool.state.sqrtPriceX96 as string);
      return calculatePositionValue(
        positionConfig.liquidity,
        sqrtPriceX96,
        positionConfig.tickLower,
        positionConfig.tickUpper,
        isToken0Base
      );
    } catch {
      return 0n;
    }
  }, [positionConfig, pool, isToken0Base]);

  // Create simulation position with CloseOrderSimulationOverlay
  const simulationPosition = useMemo(() => {
    if (
      !pool ||
      !positionConfig ||
      positionConfig.liquidity === 0n ||
      costBasis === 0n
    ) {
      return null;
    }
    try {
      const basePosition = UniswapV3Position.forSimulation({
        pool,
        isToken0Quote: !isToken0Base,
        tickLower: positionConfig.tickLower,
        tickUpper: positionConfig.tickUpper,
        liquidity: positionConfig.liquidity,
        costBasis: position?.currentCostBasis
          ? BigInt(position.currentCostBasis)
          : costBasis,
      });
      // Build SwapConfig objects from wizard state
      const isToken0Quote = !isToken0Base;
      const slSwapConfig: SwapConfig | undefined = state.slSwapConfig.enabled
        ? {
            enabled: true,
            direction: computeSwapDirection(state.slSwapConfig.swapToQuote, isToken0Quote),
            slippageBps: state.slSwapConfig.slippageBps,
          }
        : undefined;
      const tpSwapConfig: SwapConfig | undefined = state.tpSwapConfig.enabled
        ? {
            enabled: true,
            direction: computeSwapDirection(state.tpSwapConfig.swapToQuote, isToken0Quote),
            slippageBps: state.tpSwapConfig.slippageBps,
          }
        : undefined;

      return new CloseOrderSimulationOverlay({
        underlyingPosition: basePosition,
        takeProfitPrice: state.takeProfit.priceBigint,
        stopLossPrice: state.stopLoss.priceBigint,
        stopLossSwapConfig: slSwapConfig,
        takeProfitSwapConfig: tpSwapConfig,
      });
    } catch {
      return null;
    }
  }, [
    pool,
    positionConfig,
    isToken0Base,
    costBasis,
    position,
    state.stopLoss.priceBigint,
    state.takeProfit.priceBigint,
    state.slSwapConfig.enabled,
    state.slSwapConfig.slippageBps,
    state.slSwapConfig.swapToQuote,
    state.tpSwapConfig.enabled,
    state.tpSwapConfig.slippageBps,
    state.tpSwapConfig.swapToQuote,
  ]);

  // Convert price to bigint (quote token units)
  const priceToBigint = useCallback(
    (price: number): bigint => {
      const quoteDecimals = tokenInfo?.quoteToken.decimals ?? 18;
      return BigInt(
        Math.floor(price * Number(10n ** BigInt(quoteDecimals)))
      );
    },
    [tokenInfo]
  );

  // Add SL at -10% from current price
  const handleAddStopLoss = useCallback(() => {
    if (currentPrice <= 0) return;
    const slPrice = currentPrice * 0.9;
    setStopLossPrice(priceToBigint(slPrice));
  }, [currentPrice, priceToBigint, setStopLossPrice]);

  // Add TP at +10% from current price
  const handleAddTakeProfit = useCallback(() => {
    if (currentPrice <= 0) return;
    const tpPrice = currentPrice * 1.1;
    setTakeProfitPrice(priceToBigint(tpPrice));
  }, [currentPrice, priceToBigint, setTakeProfitPrice]);

  // Handle SL/TP price changes from curve drag
  const handleStopLossPriceChange = useCallback(
    (price: bigint | null) => {
      if (price === null) {
        clearStopLoss();
      } else {
        setStopLossPrice(price);
      }
    },
    [setStopLossPrice, clearStopLoss]
  );

  const handleTakeProfitPriceChange = useCallback(
    (price: bigint | null) => {
      if (price === null) {
        clearTakeProfit();
      } else {
        setTakeProfitPrice(price);
      }
    },
    [setTakeProfitPrice, clearTakeProfit]
  );

  // Risk metrics computed by overlay
  const slDrawdown = useMemo(() => {
    if (!simulationPosition) return null;
    try {
      const drawdown = simulationPosition.maxDrawdown();
      const pnlPercent = costBasis !== 0n
        ? Number((drawdown * 1000000n) / costBasis) / 10000
        : null;
      return { pnlValue: -drawdown, pnlPercent: pnlPercent != null ? -pnlPercent : undefined };
    } catch { return null; }
  }, [simulationPosition, costBasis]);

  const tpRunup = useMemo(() => {
    if (!simulationPosition) return null;
    try {
      const runup = simulationPosition.maxRunup();
      if (runup === INFINITE_RUNUP) return { pnlValue: INFINITE_RUNUP, pnlPercent: undefined };
      const pnlPercent = costBasis !== 0n
        ? Number((runup * 1000000n) / costBasis) / 10000
        : null;
      return { pnlValue: runup, pnlPercent: pnlPercent ?? undefined };
    } catch { return null; }
  }, [simulationPosition, costBasis]);

  // Zoom handlers
  const handleInteractiveZoomIn = useCallback(() => {
    setInteractiveZoom(
      Math.min(state.interactiveZoom + ZOOM_STEP, ZOOM_MAX)
    );
  }, [state.interactiveZoom, setInteractiveZoom]);

  const handleInteractiveZoomOut = useCallback(() => {
    setInteractiveZoom(
      Math.max(state.interactiveZoom - ZOOM_STEP, ZOOM_MIN)
    );
  }, [state.interactiveZoom, setInteractiveZoom]);

  const handleSummaryZoomIn = useCallback(() => {
    setSummaryZoom(Math.min(state.summaryZoom + ZOOM_STEP, ZOOM_MAX));
  }, [state.summaryZoom, setSummaryZoom]);

  const handleSummaryZoomOut = useCallback(() => {
    setSummaryZoom(Math.max(state.summaryZoom - ZOOM_STEP, ZOOM_MIN));
  }, [state.summaryZoom, setSummaryZoom]);

  // ============================================================
  // "Exit to" dropdown (matches Create Position pattern)
  // ============================================================
  const renderExitToDropdown = (
    swapConfig: SwapConfigState,
    setEnabled: (enabled: boolean) => void,
    setSwapToQuote: (swapToQuote: boolean) => void,
  ) => {
    const baseSymbol = tokenInfo?.baseToken.symbol || 'Base';
    const quoteSymbol = tokenInfo?.quoteToken.symbol || 'Quote';

    const currentValue = !swapConfig.enabled
      ? 'both'
      : swapConfig.swapToQuote
        ? 'quote'
        : 'base';

    const handleChange = (value: string) => {
      if (value === 'both') {
        setEnabled(false);
      } else {
        setEnabled(true);
        setSwapToQuote(value === 'quote');
      }
    };

    return (
      <div className="mt-3 flex items-center gap-2">
        <span className="text-sm text-slate-400">Exit to</span>
        <select
          value={currentValue}
          onChange={(e) => handleChange(e.target.value)}
          className="bg-slate-700/50 border border-slate-600 rounded px-2 py-1 text-sm text-slate-200 cursor-pointer focus:outline-none focus:border-blue-500"
        >
          <option value="quote">{quoteSymbol}</option>
          <option value="base">{baseSymbol}</option>
          <option value="both">{baseSymbol} + {quoteSymbol}</option>
        </select>
        <button
          type="button"
          className="ml-auto text-sm text-blue-400 underline decoration-dashed cursor-pointer hover:text-blue-300"
        >
          Advanced Settings
        </button>
      </div>
    );
  };

  // ============================================================
  // Unified SL/TP Setup (two columns)
  // ============================================================
  const renderSltpSection = () => {
    if (!tokenInfo) return null;
    const quoteSymbol = tokenInfo.quoteToken.symbol;
    const quoteDecimals = tokenInfo.quoteToken.decimals;
    const hasSl = state.stopLoss.enabled;
    const hasTp = state.takeProfit.enabled;

    return (
      <div className="grid grid-cols-2 gap-3">
        {/* Stop Loss column */}
        <div className="bg-slate-700/30 rounded-lg p-3 border border-slate-600/50">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">Stop Loss</div>
          {hasSl && state.stopLoss.priceBigint ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-red-400">
                {formatCompactValue(state.stopLoss.priceBigint, quoteDecimals)} {quoteSymbol}
              </span>
              <button
                onClick={clearStopLoss}
                className="p-0.5 text-orange-400 hover:text-orange-300 transition-colors cursor-pointer"
                title="Clear stop loss"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleAddStopLoss}
              disabled={currentPrice <= 0}
              className="text-sm text-blue-400 underline decoration-dashed cursor-pointer hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Stop Loss
            </button>
          )}
          {hasSl && renderExitToDropdown(state.slSwapConfig, setSlSwapEnabled, setSlSwapToQuote)}
        </div>

        {/* Take Profit column */}
        <div className="bg-slate-700/30 rounded-lg p-3 border border-slate-600/50">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide">Take Profit</div>
          {hasTp && state.takeProfit.priceBigint ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-green-400">
                {formatCompactValue(state.takeProfit.priceBigint, quoteDecimals)} {quoteSymbol}
              </span>
              <button
                onClick={clearTakeProfit}
                className="p-0.5 text-orange-400 hover:text-orange-300 transition-colors cursor-pointer"
                title="Clear take profit"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={handleAddTakeProfit}
              disabled={currentPrice <= 0}
              className="text-sm text-blue-400 underline decoration-dashed cursor-pointer hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Take Profit
            </button>
          )}
          {hasTp && renderExitToDropdown(state.tpSwapConfig, setTpSwapEnabled, setTpSwapToQuote)}
        </div>
      </div>
    );
  };

  // ============================================================
  // Interactive panel (left side - SL/TP config)
  // ============================================================
  const renderInteractive = () => (
    <div className="space-y-4">
      {/* Header with title and zoom controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 pb-2 text-sm font-medium text-blue-400 border-b-2 border-blue-400">
          <Shield className="w-4 h-4" />
          SL/TP Setup
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleInteractiveZoomOut}
            disabled={state.interactiveZoom <= ZOOM_MIN}
            className={`p-1 rounded transition-colors cursor-pointer ${
              state.interactiveZoom <= ZOOM_MIN
                ? 'text-slate-600 cursor-not-allowed'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
            title="Zoom out"
          >
            <MinusCircle className="w-4 h-4" />
          </button>
          <button
            onClick={handleInteractiveZoomIn}
            disabled={state.interactiveZoom >= ZOOM_MAX}
            className={`p-1 rounded transition-colors cursor-pointer ${
              state.interactiveZoom >= ZOOM_MAX
                ? 'text-slate-600 cursor-not-allowed'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
            title="Zoom in"
          >
            <PlusCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* SL/TP two-column config */}
      <div className="pt-2">{renderSltpSection()}</div>
    </div>
  );

  // ============================================================
  // Visual panel (PnL curve)
  // ============================================================
  const renderVisual = () => {
    if (!pool || !tokenInfo || sliderBounds.min <= 0) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-slate-500">
          <div className="w-full max-w-md space-y-6">
            <div className="relative h-48 border-l-2 border-b-2 border-slate-700">
              <div className="absolute -left-8 top-1/2 -translate-y-1/2 -rotate-90 text-xs text-slate-600 whitespace-nowrap">
                Position Value
              </div>
              <svg
                className="absolute inset-0 w-full h-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <path
                  d="M 0 80 Q 20 75 35 50 T 50 30 T 65 30 T 100 30"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                  className="text-slate-600"
                />
              </svg>
              <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-slate-600">
                Base Token Price
              </div>
            </div>
            <div className="text-center space-y-2">
              <TrendingDown className="w-8 h-8 mx-auto text-slate-600" />
              <p className="text-sm font-medium text-slate-400">
                PnL Curve Visualization
              </p>
              <p className="text-xs text-slate-500">
                Loading position data...
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="h-full flex flex-col min-h-0">
        <PnLScenarioTabs
          scenario={scenario}
          onScenarioChange={setScenario}
          hasStopLoss={state.stopLoss.enabled}
          hasTakeProfit={state.takeProfit.enabled}
        />
        <InteractivePnLCurve
          poolData={{
            token0Address: pool.token0.config.address as string,
            token0Decimals: pool.token0.decimals,
            token1Address: pool.token1.config.address as string,
            token1Decimals: pool.token1.decimals,
            feeBps: pool.feeBps,
            currentTick: pool.state.currentTick as number,
            sqrtPriceX96: pool.state.sqrtPriceX96 as string,
          }}
          baseToken={tokenInfo.baseToken}
          quoteToken={tokenInfo.quoteToken}
          position={simulationPosition}
          sliderBounds={sliderBounds}
          onSliderBoundsChange={handleSliderBoundsChange}
          onStopLossPriceChange={handleStopLossPriceChange}
          onTakeProfitPriceChange={handleTakeProfitPriceChange}
          enableSLTPInteraction={scenario === 'combined'}
          scenario={scenario}
          className="flex-1 min-h-0"
        />
        <p className="text-xs text-slate-400 mt-2 text-center shrink-0">
          <span className="font-semibold">Risk Profile.</span> Shows how your
          position value changes with price movements.
        </p>
      </div>
    );
  };

  // ============================================================
  // Summary panel (right side) — uses shared components
  // ============================================================
  const renderSummary = () => {
    if (!tokenInfo) return null;
    const quoteDecimals = tokenInfo.quoteToken.decimals;
    const baseSymbol = tokenInfo.baseToken.symbol;
    const quoteSymbol = tokenInfo.quoteToken.symbol;

    return (
      <div className="h-full flex flex-col">
        {/* Header with zoom controls */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Summary</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={handleSummaryZoomOut}
              disabled={state.summaryZoom <= ZOOM_MIN}
              className={`p-1 rounded transition-colors cursor-pointer ${
                state.summaryZoom <= ZOOM_MIN
                  ? 'text-slate-600 cursor-not-allowed'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
              title="Zoom out"
            >
              <MinusCircle className="w-4 h-4" />
            </button>
            <button
              onClick={handleSummaryZoomIn}
              disabled={state.summaryZoom >= ZOOM_MAX}
              className={`p-1 rounded transition-colors cursor-pointer ${
                state.summaryZoom >= ZOOM_MAX
                  ? 'text-slate-600 cursor-not-allowed'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
              title="Zoom in"
            >
              <PlusCircle className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-auto">
          {/* Risk Profile (shared component) */}
          <RiskTriggersSection
            stopLossPrice={state.stopLoss.enabled ? state.stopLoss.priceBigint : null}
            takeProfitPrice={state.takeProfit.enabled ? state.takeProfit.priceBigint : null}
            slDrawdown={slDrawdown}
            tpRunup={tpRunup}
            quoteTokenDecimals={quoteDecimals}
            quoteSymbol={quoteSymbol}
          />

          {/* Post-Close Swap (shared component) */}
          <PostCloseSwapSection
            slSwapConfig={state.slSwapConfig}
            tpSwapConfig={state.tpSwapConfig}
            baseSymbol={baseSymbol}
            quoteSymbol={quoteSymbol}
            hasStopLoss={state.stopLoss.enabled}
            hasTakeProfit={state.takeProfit.enabled}
          />
        </div>

        {/* Continue button */}
        <div className="mt-4 pt-4 border-t border-slate-700/50">
          <button
            onClick={goNext}
            disabled={!hasChanges && slOperation === 'NOOP' && tpOperation === 'NOOP'}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {hasChanges ? 'Continue' : 'No Changes'}
          </button>
        </div>
      </div>
    );
  };

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
