import { useMemo, useCallback, useState, useEffect } from 'react';
import {
  Shield,
  MinusCircle,
  PlusCircle,
  TrendingDown,
  Play,
  Pause,
  Pencil,
  XCircle,
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
import type { SerializedCloseOrder, AutomationState } from '@midcurve/api-shared';
import { InteractivePnLCurve } from '@/components/positions/pnl-curve/uniswapv3';
import { PnLScenarioTabs } from '@/components/positions/pnl-curve/pnl-scenario-tabs';
import { RiskTriggersSection } from '@/components/positions/wizard/create-position/uniswapv3/shared/RiskTriggersSection';
import { PostCloseSwapSection } from '@/components/positions/wizard/create-position/uniswapv3/shared/PostCloseSwapSection';
import { CloseOrderStatusBadge } from '@/components/positions/automation/CloseOrderStatusBadge';
import {
  useRiskTriggersWizard,
  computeSwapDirection,
} from '../context/RiskTriggersWizardContext';

// Zoom constants (same as ConfigureStep)
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.125;

/**
 * ManageStep — first wizard step when existing close orders are present.
 *
 * Reuses the same layout as ConfigureStep (PnL curve, SL/TP setup, summary)
 * but replaces the editable controls with action buttons:
 * Pause/Resume, Cancel, Change.
 */
export function ManageStep() {
  const {
    state,
    steps,
    goNext,
    goToStep,
    clearStopLoss,
    clearTakeProfit,
    setSlDesiredAutomationState,
    setTpDesiredAutomationState,
    setInteractiveZoom,
    setSummaryZoom,
  } = useRiskTriggersWizard();

  const [scenario, setScenario] = useState<PnLScenario>('combined');

  const position = state.position;
  const pool = state.discoveredPool;

  // Access closeOrders from position data
  const closeOrders = useMemo(() => {
    if (!position) return [];
    return (position as unknown as { closeOrders: SerializedCloseOrder[] }).closeOrders ?? [];
  }, [position]);

  // Token info (same as ConfigureStep)
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

  const isToken0Base = useMemo(() => {
    if (!pool || !tokenInfo) return false;
    return (
      compareAddresses(
        pool.token0.config.address as string,
        tokenInfo.baseToken.address
      ) === 0
    );
  }, [pool, tokenInfo]);

  // Find SL/TP orders
  const slTriggerMode = tokenInfo?.isToken0Quote ? 'UPPER' : 'LOWER';
  const tpTriggerMode = tokenInfo?.isToken0Quote ? 'LOWER' : 'UPPER';
  const activeStates: AutomationState[] = ['paused', 'monitoring', 'executing', 'retrying', 'failed', 'inactive'];

  const slOrder = useMemo(() => {
    return closeOrders.find(
      (o) => o.triggerMode === slTriggerMode && activeStates.includes(o.automationState)
    );
  }, [closeOrders, slTriggerMode]);

  const tpOrder = useMemo(() => {
    return closeOrders.find(
      (o) => o.triggerMode === tpTriggerMode && activeStates.includes(o.automationState)
    );
  }, [closeOrders, tpTriggerMode]);

  // Determine available actions
  const hasMonitoringOrder = slOrder?.automationState === 'monitoring' || tpOrder?.automationState === 'monitoring';
  const hasPausableOrder = hasMonitoringOrder;
  const hasResumableOrder =
    (slOrder && ['paused', 'failed'].includes(slOrder.automationState)) ||
    (tpOrder && ['paused', 'failed'].includes(tpOrder.automationState));

  // Action handlers
  const handleResume = useCallback(() => {
    if (slOrder && ['paused', 'failed'].includes(slOrder.automationState)) {
      setSlDesiredAutomationState('monitoring');
    }
    if (tpOrder && ['paused', 'failed'].includes(tpOrder.automationState)) {
      setTpDesiredAutomationState('monitoring');
    }
    const activationIndex = steps.findIndex((s) => s.id === 'activation');
    if (activationIndex >= 0) goToStep(activationIndex);
  }, [slOrder, tpOrder, setSlDesiredAutomationState, setTpDesiredAutomationState, steps, goToStep]);

  const handlePause = useCallback(() => {
    if (slOrder?.automationState === 'monitoring') {
      setSlDesiredAutomationState('paused');
    }
    if (tpOrder?.automationState === 'monitoring') {
      setTpDesiredAutomationState('paused');
    }
    const activationIndex = steps.findIndex((s) => s.id === 'activation');
    if (activationIndex >= 0) goToStep(activationIndex);
  }, [slOrder, tpOrder, setSlDesiredAutomationState, setTpDesiredAutomationState, steps, goToStep]);

  const handleChange = useCallback(() => {
    goNext();
  }, [goNext]);

  const handleCancel = useCallback(() => {
    if (slOrder) clearStopLoss();
    if (tpOrder) clearTakeProfit();
    const transactionIndex = steps.findIndex((s) => s.id === 'transaction');
    if (transactionIndex >= 0) goToStep(transactionIndex);
  }, [slOrder, tpOrder, clearStopLoss, clearTakeProfit, steps, goToStep]);

  // ============================================================
  // PnL Curve setup (reused from ConfigureStep, read-only)
  // ============================================================

  const currentPrice = useMemo(() => {
    if (!pool || !tokenInfo) return 0;
    try {
      const sqrtPriceX96 = BigInt(pool.state.sqrtPriceX96 as string);
      const Q96 = 2n ** 96n;
      const Q192 = Q96 * Q96;
      const rawPriceNum = sqrtPriceX96 * sqrtPriceX96;
      const token0Decimals = pool.token0.decimals;
      const token1Decimals = pool.token1.decimals;

      if (isToken0Base) {
        const decimalDiff = token0Decimals - token1Decimals;
        if (decimalDiff >= 0) {
          return Number(rawPriceNum * 10n ** BigInt(decimalDiff)) / Number(Q192);
        } else {
          return Number(rawPriceNum) / Number(Q192 * 10n ** BigInt(-decimalDiff));
        }
      } else {
        const decimalDiff = token1Decimals - token0Decimals;
        if (decimalDiff >= 0) {
          return Number(Q192 * 10n ** BigInt(decimalDiff)) / Number(rawPriceNum);
        } else {
          return Number(Q192) / Number(rawPriceNum * 10n ** BigInt(-decimalDiff));
        }
      }
    } catch {
      return 0;
    }
  }, [pool, tokenInfo, isToken0Base]);

  const [sliderBounds, setSliderBounds] = useState<{ min: number; max: number }>({ min: 0, max: 0 });
  const [userAdjustedBounds, setUserAdjustedBounds] = useState(false);

  useEffect(() => {
    if (currentPrice > 0 && !userAdjustedBounds) {
      setSliderBounds({ min: currentPrice * 0.5, max: currentPrice * 1.5 });
    }
  }, [currentPrice, userAdjustedBounds]);

  const handleSliderBoundsChange = useCallback(
    (bounds: { min: number; max: number }) => {
      setSliderBounds(bounds);
      setUserAdjustedBounds(true);
    },
    []
  );

  const positionConfig = useMemo(() => {
    if (!position) return null;
    const config = position.config as { tickLower: number; tickUpper: number };
    const posState = position.state as { liquidity: string };
    return {
      tickLower: config.tickLower,
      tickUpper: config.tickUpper,
      liquidity: BigInt(posState.liquidity),
    };
  }, [position]);

  const costBasis = useMemo(() => {
    if (!positionConfig || !pool || positionConfig.liquidity === 0n) return 0n;
    try {
      return calculatePositionValue(
        positionConfig.liquidity,
        BigInt(pool.state.sqrtPriceX96 as string),
        positionConfig.tickLower,
        positionConfig.tickUpper,
        isToken0Base
      );
    } catch {
      return 0n;
    }
  }, [positionConfig, pool, isToken0Base]);

  const simulationPosition = useMemo(() => {
    if (!pool || !positionConfig || positionConfig.liquidity === 0n || costBasis === 0n) return null;
    try {
      const isToken0Quote = !isToken0Base;
      const basePosition = UniswapV3Position.forSimulation({
        pool,
        isToken0Quote,
        tickLower: positionConfig.tickLower,
        tickUpper: positionConfig.tickUpper,
        liquidity: positionConfig.liquidity,
        costBasis: position?.currentCostBasis ? BigInt(position.currentCostBasis) : costBasis,
      });
      const slSwapConfig: SwapConfig | undefined = state.slSwapConfig.enabled
        ? { enabled: true, direction: computeSwapDirection(state.slSwapConfig.swapToQuote, isToken0Quote), slippageBps: state.slSwapConfig.slippageBps }
        : undefined;
      const tpSwapConfig: SwapConfig | undefined = state.tpSwapConfig.enabled
        ? { enabled: true, direction: computeSwapDirection(state.tpSwapConfig.swapToQuote, isToken0Quote), slippageBps: state.tpSwapConfig.slippageBps }
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
  }, [pool, positionConfig, isToken0Base, costBasis, position, state.stopLoss.priceBigint, state.takeProfit.priceBigint, state.slSwapConfig, state.tpSwapConfig]);

  // Risk metrics for summary
  const slPnlAtTrigger = useMemo(() => {
    if (!simulationPosition || !state.stopLoss.priceBigint) return null;
    try {
      const result = simulationPosition.simulatePnLAtPrice(state.stopLoss.priceBigint);
      return { pnlValue: result.pnlValue, pnlPercent: result.pnlPercent };
    } catch { return null; }
  }, [simulationPosition, state.stopLoss.priceBigint]);

  const tpPnlAtTrigger = useMemo(() => {
    if (!simulationPosition || !state.takeProfit.priceBigint) return null;
    try {
      const result = simulationPosition.simulatePnLAtPrice(state.takeProfit.priceBigint);
      return { pnlValue: result.pnlValue, pnlPercent: result.pnlPercent };
    } catch { return null; }
  }, [simulationPosition, state.takeProfit.priceBigint]);

  const slDrawdown = useMemo(() => {
    if (!simulationPosition) return null;
    try {
      const drawdown = simulationPosition.maxDrawdown();
      const pnlPercent = costBasis !== 0n ? Number((drawdown * 1000000n) / costBasis) / 10000 : null;
      return { pnlValue: -drawdown, pnlPercent: pnlPercent != null ? -pnlPercent : undefined };
    } catch { return null; }
  }, [simulationPosition, costBasis]);

  const tpRunup = useMemo(() => {
    if (!simulationPosition) return null;
    try {
      const runup = simulationPosition.maxRunup();
      if (runup === INFINITE_RUNUP) return { pnlValue: INFINITE_RUNUP, pnlPercent: undefined };
      const pnlPercent = costBasis !== 0n ? Number((runup * 1000000n) / costBasis) / 10000 : null;
      return { pnlValue: runup, pnlPercent: pnlPercent ?? undefined };
    } catch { return null; }
  }, [simulationPosition, costBasis]);

  // Zoom handlers
  const handleInteractiveZoomIn = useCallback(() => {
    setInteractiveZoom(Math.min(state.interactiveZoom + ZOOM_STEP, ZOOM_MAX));
  }, [state.interactiveZoom, setInteractiveZoom]);

  const handleInteractiveZoomOut = useCallback(() => {
    setInteractiveZoom(Math.max(state.interactiveZoom - ZOOM_STEP, ZOOM_MIN));
  }, [state.interactiveZoom, setInteractiveZoom]);

  const handleSummaryZoomIn = useCallback(() => {
    setSummaryZoom(Math.min(state.summaryZoom + ZOOM_STEP, ZOOM_MAX));
  }, [state.summaryZoom, setSummaryZoom]);

  const handleSummaryZoomOut = useCallback(() => {
    setSummaryZoom(Math.max(state.summaryZoom - ZOOM_STEP, ZOOM_MIN));
  }, [state.summaryZoom, setSummaryZoom]);

  // ============================================================
  // Interactive panel — SL/TP display + action buttons
  // ============================================================
  const renderInteractive = () => {
    if (!tokenInfo) return null;
    const quoteSymbol = tokenInfo.quoteToken.symbol;
    const quoteDecimals = tokenInfo.quoteToken.decimals;

    return (
      <div className="space-y-4">
        {/* Header with zoom controls (same as ConfigureStep) */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 pb-2 text-sm font-medium text-blue-400 border-b-2 border-blue-400">
            <Shield className="w-4 h-4" />
            SL/TP Setup
          </div>
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

        {/* SL/TP two-column display (same grid as ConfigureStep, read-only) */}
        <div className="pt-2">
          <div className="grid grid-cols-2 gap-3">
            {/* Stop Loss column */}
            <div className="bg-slate-700/30 rounded-lg p-3 border border-slate-600/50">
              <div className="flex items-center justify-between">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Stop Loss</div>
                {slOrder && <CloseOrderStatusBadge status={slOrder.automationState} size="sm" />}
              </div>
              {state.stopLoss.enabled && state.stopLoss.priceBigint ? (
                <span className="text-sm font-medium text-red-400">
                  {formatCompactValue(state.stopLoss.priceBigint, quoteDecimals)} {quoteSymbol}
                </span>
              ) : (
                <span className="text-sm text-slate-500">Not set</span>
              )}
            </div>

            {/* Take Profit column */}
            <div className="bg-slate-700/30 rounded-lg p-3 border border-slate-600/50">
              <div className="flex items-center justify-between">
                <div className="text-[10px] text-slate-400 uppercase tracking-wide">Take Profit</div>
                {tpOrder && <CloseOrderStatusBadge status={tpOrder.automationState} size="sm" />}
              </div>
              {state.takeProfit.enabled && state.takeProfit.priceBigint ? (
                <span className="text-sm font-medium text-green-400">
                  {formatCompactValue(state.takeProfit.priceBigint, quoteDecimals)} {quoteSymbol}
                </span>
              ) : (
                <span className="text-sm text-slate-500">Not set</span>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-2">
          {hasResumableOrder && (
            <button
              onClick={handleResume}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 rounded-lg transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              Resume
            </button>
          )}
          {hasPausableOrder && (
            <button
              onClick={handlePause}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium bg-slate-600/20 hover:bg-slate-600/30 border border-slate-500/30 text-slate-300 rounded-lg transition-colors cursor-pointer"
            >
              <Pause className="w-3.5 h-3.5" />
              Pause
            </button>
          )}
          <button
            onClick={handleCancel}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium bg-red-600/10 hover:bg-red-600/20 border border-red-500/20 text-red-300 rounded-lg transition-colors cursor-pointer"
          >
            <XCircle className="w-3.5 h-3.5" />
            Cancel
          </button>
          <button
            onClick={handleChange}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 rounded-lg transition-colors cursor-pointer"
          >
            <Pencil className="w-3.5 h-3.5" />
            Change
          </button>
        </div>
      </div>
    );
  };

  // ============================================================
  // Visual panel — PnL curve (same as ConfigureStep, read-only)
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
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                <path d="M 0 80 Q 20 75 35 50 T 50 30 T 65 30 T 100 30" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" className="text-slate-600" />
              </svg>
              <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-slate-600">
                Base Token Price
              </div>
            </div>
            <div className="text-center space-y-2">
              <TrendingDown className="w-8 h-8 mx-auto text-slate-600" />
              <p className="text-sm font-medium text-slate-400">PnL Curve Visualization</p>
              <p className="text-xs text-slate-500">Loading position data...</p>
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
            tickSpacing: pool.tickSpacing,
            currentTick: pool.state.currentTick as number,
            sqrtPriceX96: pool.state.sqrtPriceX96 as string,
          }}
          baseToken={tokenInfo.baseToken}
          quoteToken={tokenInfo.quoteToken}
          position={simulationPosition}
          sliderBounds={sliderBounds}
          onSliderBoundsChange={handleSliderBoundsChange}
          enableSLTPInteraction={false}
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
  // Summary panel (same as ConfigureStep)
  // ============================================================
  const renderSummary = () => {
    if (!tokenInfo) return null;
    const quoteDecimals = tokenInfo.quoteToken.decimals;
    const baseSymbol = tokenInfo.baseToken.symbol;
    const quoteSymbol = tokenInfo.quoteToken.symbol;

    return (
      <div className="h-full flex flex-col">
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
          <RiskTriggersSection
            stopLossPrice={state.stopLoss.enabled ? state.stopLoss.priceBigint : null}
            takeProfitPrice={state.takeProfit.enabled ? state.takeProfit.priceBigint : null}
            slPnlAtTrigger={slPnlAtTrigger}
            slDrawdown={slDrawdown}
            tpPnlAtTrigger={tpPnlAtTrigger}
            tpRunup={tpRunup}
            quoteTokenDecimals={quoteDecimals}
            quoteSymbol={quoteSymbol}
          />
          <PostCloseSwapSection
            slSwapConfig={state.slSwapConfig}
            tpSwapConfig={state.tpSwapConfig}
            baseSymbol={baseSymbol}
            quoteSymbol={quoteSymbol}
            hasStopLoss={state.stopLoss.enabled}
            hasTakeProfit={state.takeProfit.enabled}
          />
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
