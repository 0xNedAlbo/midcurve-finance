import { useCallback, useMemo, useState, useEffect } from 'react';
import {
  Shield,
  Target,
  ArrowRightLeft,
  Trash2,
  Plus,
  PlusCircle,
  MinusCircle,
  TrendingDown,
  AlertTriangle,
} from 'lucide-react';
import {
  formatCompactValue,
  calculatePositionValue,
  tickToPrice,
  compareAddresses,
  UniswapV3Position,
  CloseOrderSimulationOverlay,
} from '@midcurve/shared';
import { InteractivePnLCurve } from '@/components/positions/pnl-curve/uniswapv3';
import {
  useRiskTriggersWizard,
  type ConfigurationTab,
} from '../context/RiskTriggersWizardContext';

// Configuration section tabs
const CONFIG_TABS: {
  id: ConfigurationTab;
  label: string;
  description: string;
  icon: typeof Shield;
}[] = [
  {
    id: 'sl',
    label: 'SL Setup',
    description: 'Configure stop loss trigger and swap',
    icon: Shield,
  },
  {
    id: 'tp',
    label: 'TP Setup',
    description: 'Configure take profit trigger and swap',
    icon: Target,
  },
];

// Chains supported for Paraswap swap integration
const PARASWAP_PRODUCTION_CHAINS = [1, 42161, 8453, 10] as const;
const PARASWAP_SUPPORTED_CHAINS = import.meta.env.DEV
  ? [...PARASWAP_PRODUCTION_CHAINS, 31337]
  : PARASWAP_PRODUCTION_CHAINS;

const SWAP_SLIPPAGE_OPTIONS = [
  { value: 50, label: '0.5%' },
  { value: 100, label: '1%' },
  { value: 200, label: '2%' },
  { value: 300, label: '3%' },
  { value: 500, label: '5%' },
];

// Zoom constants
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.125;

export function ConfigureStep() {
  const {
    state,
    setConfigurationTab,
    setStopLossPrice,
    clearStopLoss,
    setTakeProfitPrice,
    clearTakeProfit,
    setSlSwapEnabled,
    setSlSwapSlippage,
    setTpSwapEnabled,
    setTpSwapSlippage,
    setInteractiveZoom,
    setSummaryZoom,
    goNext,
    hasChanges,
    slOperation,
    tpOperation,
  } = useRiskTriggersWizard();

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
      return new CloseOrderSimulationOverlay({
        underlyingPosition: basePosition,
        takeProfitPrice: state.takeProfit.priceBigint,
        stopLossPrice: state.stopLoss.priceBigint,
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

  // Switch to SL tab on curve interaction
  const handleSlTpInteraction = useCallback(() => {
    setConfigurationTab('sl');
  }, [setConfigurationTab]);

  // Calculate max drawdown (loss at SL price)
  const slDrawdown = useMemo(() => {
    if (!state.stopLoss.priceBigint || !simulationPosition) return null;
    try {
      const result = simulationPosition.simulatePnLAtPrice(
        state.stopLoss.priceBigint
      );
      return { pnlValue: result.pnlValue, pnlPercent: result.pnlPercent };
    } catch {
      return null;
    }
  }, [state.stopLoss.priceBigint, simulationPosition]);

  // Calculate max runup (profit at TP price)
  const tpRunup = useMemo(() => {
    if (!state.takeProfit.priceBigint || !simulationPosition) return null;
    try {
      const result = simulationPosition.simulatePnLAtPrice(
        state.takeProfit.priceBigint
      );
      return { pnlValue: result.pnlValue, pnlPercent: result.pnlPercent };
    } catch {
      return null;
    }
  }, [state.takeProfit.priceBigint, simulationPosition]);

  // Calculate PnL at upper range boundary (for max runup when no TP)
  const upperBoundaryRunup = useMemo(() => {
    if (!positionConfig || !tokenInfo || !pool || !simulationPosition)
      return null;
    try {
      const baseDecimals = isToken0Base
        ? pool.token0.decimals
        : pool.token1.decimals;
      const upperPriceBigInt = tickToPrice(
        positionConfig.tickUpper,
        tokenInfo.baseToken.address,
        tokenInfo.quoteToken.address,
        baseDecimals
      );
      const result = simulationPosition.simulatePnLAtPrice(upperPriceBigInt);
      return { pnlValue: result.pnlValue, pnlPercent: result.pnlPercent };
    } catch {
      return null;
    }
  }, [positionConfig, tokenInfo, pool, simulationPosition, isToken0Base]);

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

  // Get chain ID
  const chainId = useMemo(() => {
    if (!position) return 0;
    return (position.config as { chainId: number }).chainId;
  }, [position]);

  // Check if chain supports Paraswap
  const isSwapSupported = (
    PARASWAP_SUPPORTED_CHAINS as readonly number[]
  ).includes(chainId);

  // ============================================================
  // Swap config section (reused for both SL and TP tabs)
  // ============================================================
  const renderSwapConfig = (
    swapConfig: { enabled: boolean; slippageBps: number },
    setEnabled: (enabled: boolean) => void,
    setSlippage: (slippageBps: number) => void,
  ) => {
    if (!tokenInfo) return null;
    const baseSymbol = tokenInfo.baseToken.symbol;
    const quoteSymbol = tokenInfo.quoteToken.symbol;

    if (!isSwapSupported) {
      return (
        <div className="mt-4 p-3 bg-slate-700/20 rounded-lg">
          <p className="text-xs text-slate-500">
            Post-close swap not available on this chain. Supported: Ethereum,
            Arbitrum, Base, Optimism.
          </p>
        </div>
      );
    }

    return (
      <div className="mt-4 pt-4 border-t border-slate-600/30 space-y-3">
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">
          Post-Close Swap
        </div>

        {/* Toggle */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-300">Enable Swap</span>
          <button
            type="button"
            onClick={() => setEnabled(!swapConfig.enabled)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
              swapConfig.enabled ? 'bg-blue-600' : 'bg-slate-600'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                swapConfig.enabled ? 'translate-x-4.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {/* Swap details when enabled */}
        {swapConfig.enabled && (
          <div className="space-y-3">
            {/* Direction display */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-300">{baseSymbol}</span>
              <button
                disabled
                className="p-1 rounded bg-slate-700/50 text-slate-500 cursor-not-allowed"
                title="Swap direction change coming soon"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-slate-300">{quoteSymbol}</span>
            </div>

            {/* Slippage */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-slate-400 mr-1">Slippage:</span>
              {SWAP_SLIPPAGE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSlippage(value)}
                  className={`py-1 px-2 text-xs rounded border transition-colors cursor-pointer ${
                    swapConfig.slippageBps === value
                      ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                      : 'border-slate-600 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* High slippage warning */}
            {swapConfig.slippageBps > 300 && (
              <div className="flex items-start gap-1.5 p-2 bg-yellow-500/10 border border-yellow-500/20 rounded">
                <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-yellow-300">
                  High slippage may result in unfavorable swap rates.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ============================================================
  // SL Setup Tab
  // ============================================================
  const renderSlTab = () => {
    if (!tokenInfo) return null;
    const quoteSymbol = tokenInfo.quoteToken.symbol;
    const quoteDecimals = tokenInfo.quoteToken.decimals;
    const hasSl = state.stopLoss.enabled;

    return (
      <div>
        {/* Trigger card */}
        <div className="bg-slate-700/30 rounded-lg p-3 border border-slate-600/50">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">
              Stop Loss
            </div>
            {hasSl ? (
              <button
                onClick={clearStopLoss}
                className="p-0.5 text-orange-400 hover:text-orange-300 transition-colors cursor-pointer"
                title="Clear stop loss"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            ) : (
              <button
                onClick={handleAddStopLoss}
                disabled={currentPrice <= 0}
                className="p-0.5 text-orange-400 hover:text-orange-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="Add stop loss at -10%"
              >
                <Plus className="w-3 h-3" />
              </button>
            )}
          </div>
          {hasSl && state.stopLoss.priceBigint ? (
            <>
              <div className="text-sm font-medium text-red-400">
                {formatCompactValue(state.stopLoss.priceBigint, quoteDecimals)}{' '}
                {quoteSymbol}
              </div>
              <div className="mt-2 pt-2 border-t border-slate-600/50">
                <div className="text-[10px] text-slate-400 mb-0.5">
                  Max Drawdown
                </div>
                <div className="text-sm font-medium text-red-400">
                  {slDrawdown ? (
                    <>
                      {formatCompactValue(
                        slDrawdown.pnlValue,
                        quoteDecimals
                      )}{' '}
                      {quoteSymbol}
                      <span className="text-xs text-slate-500 ml-1">
                        ({slDrawdown.pnlPercent >= 0 ? '+' : ''}
                        {slDrawdown.pnlPercent.toFixed(1)}%)
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-500">--</span>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-slate-500">Not set</div>
              <div className="mt-2 pt-2 border-t border-slate-600/50">
                <div className="text-[10px] text-slate-400 mb-0.5">
                  Max Drawdown
                </div>
                <div className="text-sm font-medium text-slate-500">--</div>
              </div>
            </>
          )}

          {/* SL swap config */}
          {renderSwapConfig(state.slSwapConfig, setSlSwapEnabled, setSlSwapSlippage)}
        </div>
      </div>
    );
  };

  // ============================================================
  // TP Setup Tab
  // ============================================================
  const renderTpTab = () => {
    if (!tokenInfo) return null;
    const quoteSymbol = tokenInfo.quoteToken.symbol;
    const quoteDecimals = tokenInfo.quoteToken.decimals;
    const hasTp = state.takeProfit.enabled;

    return (
      <div>
        {/* Trigger card */}
        <div className="bg-slate-700/30 rounded-lg p-3 border border-slate-600/50">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-slate-400 uppercase tracking-wide">
              Take Profit
            </div>
            {hasTp ? (
              <button
                onClick={clearTakeProfit}
                className="p-0.5 text-orange-400 hover:text-orange-300 transition-colors cursor-pointer"
                title="Clear take profit"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            ) : (
              <button
                onClick={handleAddTakeProfit}
                disabled={currentPrice <= 0}
                className="p-0.5 text-orange-400 hover:text-orange-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="Add take profit at +10%"
              >
                <Plus className="w-3 h-3" />
              </button>
            )}
          </div>
          {hasTp && state.takeProfit.priceBigint ? (
            <>
              <div className="text-sm font-medium text-green-400">
                {formatCompactValue(
                  state.takeProfit.priceBigint,
                  quoteDecimals
                )}{' '}
                {quoteSymbol}
              </div>
              <div className="mt-2 pt-2 border-t border-slate-600/50">
                <div className="text-[10px] text-slate-400 mb-0.5">
                  Max Runup
                </div>
                <div className="text-sm font-medium text-green-400">
                  {tpRunup ? (
                    <>
                      {tpRunup.pnlValue >= 0n ? '+' : ''}
                      {formatCompactValue(
                        tpRunup.pnlValue,
                        quoteDecimals
                      )}{' '}
                      {quoteSymbol}
                      <span className="text-xs text-slate-500 ml-1">
                        ({tpRunup.pnlPercent >= 0 ? '+' : ''}
                        {tpRunup.pnlPercent.toFixed(1)}%)
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-500">--</span>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium text-slate-500">Not set</div>
              <div className="mt-2 pt-2 border-t border-slate-600/50">
                <div className="text-[10px] text-slate-400 mb-0.5">
                  Max Runup
                </div>
                <div className="text-sm font-medium text-slate-500">--</div>
              </div>
            </>
          )}

          {/* TP swap config */}
          {renderSwapConfig(state.tpSwapConfig, setTpSwapEnabled, setTpSwapSlippage)}
        </div>
      </div>
    );
  };

  // ============================================================
  // Tab content
  // ============================================================
  const renderTabContent = () => {
    switch (state.configurationTab) {
      case 'sl':
        return renderSlTab();
      case 'tp':
        return renderTpTab();
      default:
        return renderSlTab();
    }
  };

  // ============================================================
  // Interactive panel (left side - tabs + content)
  // ============================================================
  const renderInteractive = () => (
    <div className="space-y-4">
      {/* Header with tabs and zoom controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          {CONFIG_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setConfigurationTab(tab.id)}
                className={`flex items-center gap-1.5 pb-2 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
                  state.configurationTab === tab.id
                    ? 'text-blue-400 border-blue-400'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
                title={tab.description}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
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

      {/* Tab content */}
      <div className="pt-2">{renderTabContent()}</div>
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
          enableSLTPInteraction={true}
          onSlTpInteraction={handleSlTpInteraction}
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
  // Summary panel (right side)
  // ============================================================
  const renderSummary = () => {
    if (!tokenInfo) return null;
    const quoteDecimals = tokenInfo.quoteToken.decimals;
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
          {/* Trigger Prices */}
          <div className="p-3 bg-slate-700/30 rounded-lg space-y-2.5">
            <p className="text-xs text-slate-400">Trigger Prices</p>
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Stop Loss</span>
                {state.stopLoss.enabled && state.stopLoss.priceBigint ? (
                  <span className="text-red-400 font-medium">
                    {formatCompactValue(
                      state.stopLoss.priceBigint,
                      quoteDecimals
                    )}{' '}
                    {quoteSymbol}
                  </span>
                ) : (
                  <span className="text-slate-500">Not set</span>
                )}
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Take Profit</span>
                {state.takeProfit.enabled && state.takeProfit.priceBigint ? (
                  <span className="text-green-400 font-medium">
                    {formatCompactValue(
                      state.takeProfit.priceBigint,
                      quoteDecimals
                    )}{' '}
                    {quoteSymbol}
                  </span>
                ) : (
                  <span className="text-slate-500">Not set</span>
                )}
              </div>
            </div>
          </div>

          {/* Risk Profile */}
          <div className="p-3 bg-slate-700/30 rounded-lg space-y-2.5">
            <p className="text-xs text-slate-400">Risk Profile</p>
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Max Drawdown</span>
                {slDrawdown ? (
                  <span className="text-red-400 font-medium">
                    {formatCompactValue(slDrawdown.pnlValue, quoteDecimals)}{' '}
                    {quoteSymbol}
                    <span className="text-xs text-slate-500 ml-1">
                      ({slDrawdown.pnlPercent >= 0 ? '+' : ''}
                      {slDrawdown.pnlPercent.toFixed(1)}%)
                    </span>
                  </span>
                ) : (
                  <span className="text-red-400 font-medium">-100%</span>
                )}
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Max Runup</span>
                {tpRunup ? (
                  <span className="text-green-400 font-medium">
                    {tpRunup.pnlValue >= 0n ? '+' : ''}
                    {formatCompactValue(tpRunup.pnlValue, quoteDecimals)}{' '}
                    {quoteSymbol}
                    <span className="text-xs text-slate-500 ml-1">
                      ({tpRunup.pnlPercent >= 0 ? '+' : ''}
                      {tpRunup.pnlPercent.toFixed(1)}%)
                    </span>
                  </span>
                ) : upperBoundaryRunup ? (
                  <span className="text-green-400 font-medium">
                    {upperBoundaryRunup.pnlValue >= 0n ? '+' : ''}
                    {formatCompactValue(upperBoundaryRunup.pnlValue, quoteDecimals)}{' '}
                    {quoteSymbol}
                    <span className="text-xs text-slate-500 ml-1">
                      ({upperBoundaryRunup.pnlPercent >= 0 ? '+' : ''}
                      {upperBoundaryRunup.pnlPercent.toFixed(1)}%)
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-500">--</span>
                )}
              </div>
            </div>
          </div>

          {/* Post-Close Swap (per-order) */}
          {isSwapSupported && (
            <div className="p-3 bg-slate-700/30 rounded-lg space-y-2.5">
              <p className="text-xs text-slate-400">Post-Close Swap</p>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400">SL</span>
                  <span
                    className={
                      state.slSwapConfig.enabled
                        ? 'text-blue-400 font-medium'
                        : 'text-slate-500'
                    }
                  >
                    {state.slSwapConfig.enabled
                      ? `to ${quoteSymbol} (${(state.slSwapConfig.slippageBps / 100).toFixed(1)}%)`
                      : 'Disabled'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400">TP</span>
                  <span
                    className={
                      state.tpSwapConfig.enabled
                        ? 'text-blue-400 font-medium'
                        : 'text-slate-500'
                    }
                  >
                    {state.tpSwapConfig.enabled
                      ? `to ${quoteSymbol} (${(state.tpSwapConfig.slippageBps / 100).toFixed(1)}%)`
                      : 'Disabled'}
                  </span>
                </div>
              </div>
            </div>
          )}
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
