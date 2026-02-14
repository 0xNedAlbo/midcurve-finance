import { useEffect, useCallback, useMemo, useState } from 'react';
import { Wallet, PlusCircle, MinusCircle, TrendingDown } from 'lucide-react';
import { formatUnits } from 'viem';
import { useAccount } from 'wagmi';
import type { PnLScenario } from '@midcurve/shared';
import {
  formatCompactValue,
  calculatePositionValue,
  tickToPrice,
  compareAddresses,
  UniswapV3Position,
  CloseOrderSimulationOverlay,
} from '@midcurve/shared';
import type { PoolSearchTokenInfo, SerializedUniswapV3CloseOrderConfig } from '@midcurve/api-shared';
import { InteractivePnLCurve } from '@/components/positions/pnl-curve/uniswapv3';
import { PnLScenarioTabs } from '@/components/positions/pnl-curve/pnl-scenario-tabs';
import { useIncreaseDepositWizard } from '../context/IncreaseDepositWizardContext';
import { IncreaseWizardSummaryPanel } from '../shared/IncreaseWizardSummaryPanel';
import { useCapitalCalculations } from '@/components/positions/wizard/create-position/uniswapv3/hooks/useCapitalCalculations';
import { useErc20TokenBalance } from '@/hooks/tokens/erc20/useErc20TokenBalance';

// Zoom constants
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.125;

export function ConfigureStep() {
  const {
    state,
    setBaseInput,
    setQuoteInput,
    setAllocatedAmounts,
    setStepValid,
    setInteractiveZoom,
  } = useIncreaseDepositWizard();

  const { address: walletAddress, isConnected } = useAccount();
  const [scenario, setScenario] = useState<PnLScenario>('combined');

  // Extract position data
  const position = state.position;
  const pool = position?.pool;
  const config = position?.config as { chainId: number; nftId: number; tickLower: number; tickUpper: number } | undefined;

  // Get base/quote tokens from position
  const baseToken = useMemo((): PoolSearchTokenInfo | null => {
    if (!pool) return null;
    const token = position?.isToken0Quote ? pool.token1 : pool.token0;
    return {
      address: (token.config as { address: string }).address,
      symbol: token.symbol,
      decimals: token.decimals,
    };
  }, [pool, position?.isToken0Quote]);

  const quoteToken = useMemo((): PoolSearchTokenInfo | null => {
    if (!pool) return null;
    const token = position?.isToken0Quote ? pool.token0 : pool.token1;
    return {
      address: (token.config as { address: string }).address,
      symbol: token.symbol,
      decimals: token.decimals,
    };
  }, [pool, position?.isToken0Quote]);

  const chainId = config?.chainId ?? 1;
  const tickLower = config?.tickLower ?? 0;
  const tickUpper = config?.tickUpper ?? 0;

  // Get token balances
  const { balanceBigInt: baseBalance, isLoading: isBaseBalanceLoading } = useErc20TokenBalance({
    walletAddress: walletAddress ?? null,
    tokenAddress: baseToken?.address ?? null,
    chainId,
    enabled: isConnected && !!baseToken?.address,
  });

  const { balanceBigInt: quoteBalance, isLoading: isQuoteBalanceLoading } = useErc20TokenBalance({
    walletAddress: walletAddress ?? null,
    tokenAddress: quoteToken?.address ?? null,
    chainId,
    enabled: isConnected && !!quoteToken?.address,
  });

  // Calculate allocations using the shared hook
  const calculations = useCapitalCalculations({
    baseInputAmount: state.baseInputAmount,
    quoteInputAmount: state.quoteInputAmount,
    discoveredPool: state.discoveredPool,
    baseToken,
    quoteToken,
    tickLower,
    tickUpper,
  });

  // Update context when calculations change
  useEffect(() => {
    setAllocatedAmounts(
      calculations.allocatedBaseAmount,
      calculations.allocatedQuoteAmount,
      calculations.totalQuoteValue,
      calculations.liquidity
    );
  }, [
    calculations.allocatedBaseAmount,
    calculations.allocatedQuoteAmount,
    calculations.totalQuoteValue,
    calculations.liquidity,
    setAllocatedAmounts,
  ]);

  // Update step validation
  useEffect(() => {
    setStepValid('configure', calculations.isValid);
  }, [calculations.isValid, setStepValid]);

  // Determine if base token is token0
  const isToken0Base = useMemo(() => {
    if (!state.discoveredPool || !baseToken) return false;
    return compareAddresses(
      state.discoveredPool.token0.config.address as string,
      baseToken.address
    ) === 0;
  }, [state.discoveredPool, baseToken]);

  // Calculate current price from sqrtPriceX96
  const currentPrice = useMemo(() => {
    if (!state.discoveredPool || !baseToken || !quoteToken) return 0;
    try {
      const sqrtPriceX96 = BigInt(state.discoveredPool.state.sqrtPriceX96 as string);
      const Q96 = 2n ** 96n;
      const Q192 = Q96 * Q96;
      const rawPriceNum = sqrtPriceX96 * sqrtPriceX96;
      const token0Decimals = state.discoveredPool.token0.decimals;
      const token1Decimals = state.discoveredPool.token1.decimals;

      let priceInQuote: number;
      if (isToken0Base) {
        const decimalDiff = token0Decimals - token1Decimals;
        if (decimalDiff >= 0) {
          const adjustment = 10n ** BigInt(decimalDiff);
          priceInQuote = Number(rawPriceNum * adjustment) / Number(Q192);
        } else {
          const adjustment = 10n ** BigInt(-decimalDiff);
          priceInQuote = Number(rawPriceNum) / Number(Q192 * adjustment);
        }
      } else {
        const decimalDiff = token1Decimals - token0Decimals;
        if (decimalDiff >= 0) {
          const adjustment = 10n ** BigInt(decimalDiff);
          priceInQuote = Number(Q192 * adjustment) / Number(rawPriceNum);
        } else {
          const adjustment = 10n ** BigInt(-decimalDiff);
          priceInQuote = Number(Q192) / Number(rawPriceNum * adjustment);
        }
      }
      return priceInQuote;
    } catch {
      return 0;
    }
  }, [state.discoveredPool, baseToken, quoteToken, isToken0Base]);

  // Slider bounds for PnL curve
  const [sliderBounds, setSliderBounds] = useState<{ min: number; max: number }>({ min: 0, max: 0 });
  const [userAdjustedBounds, setUserAdjustedBounds] = useState(false);

  useEffect(() => {
    if (currentPrice > 0 && !userAdjustedBounds) {
      setSliderBounds({ min: currentPrice * 0.5, max: currentPrice * 1.5 });
    }
  }, [currentPrice, userAdjustedBounds]);

  const handleSliderBoundsChange = useCallback((bounds: { min: number; max: number }) => {
    setSliderBounds(bounds);
    setUserAdjustedBounds(true);
  }, []);

  // Calculate combined cost basis (existing + additional)
  const combinedCostBasis = useMemo(() => {
    if (!state.discoveredPool || !position) return 0n;
    const existingLiquidity = BigInt(position.state.liquidity);
    const additionalLiquidity = BigInt(calculations.liquidity || '0');
    const combinedLiquidity = existingLiquidity + additionalLiquidity;
    if (combinedLiquidity === 0n) return 0n;

    try {
      const sqrtPriceX96 = BigInt(state.discoveredPool.state.sqrtPriceX96 as string);
      return calculatePositionValue(combinedLiquidity, sqrtPriceX96, tickLower, tickUpper, isToken0Base);
    } catch {
      return 0n;
    }
  }, [state.discoveredPool, position, calculations.liquidity, tickLower, tickUpper, isToken0Base]);

  // Extract SL/TP prices from active close orders
  const closeOrderPrices = useMemo(() => {
    let stopLossPrice: bigint | null = null;
    let takeProfitPrice: bigint | null = null;

    if (!state.activeCloseOrders.length || !state.discoveredPool || !baseToken || !quoteToken) {
      return { stopLossPrice, takeProfitPrice };
    }

    for (const order of state.activeCloseOrders) {
      const orderConfig = order.config as unknown as SerializedUniswapV3CloseOrderConfig;
      if (!orderConfig.triggerMode) continue;

      try {
        if (orderConfig.triggerMode === 'LOWER' && orderConfig.sqrtPriceX96Lower) {
          // SL order - convert sqrtPriceX96 to price
          const sqrtPriceX96 = BigInt(orderConfig.sqrtPriceX96Lower);
          const Q96 = 2n ** 96n;
          const Q192 = Q96 * Q96;
          const rawPriceNum = sqrtPriceX96 * sqrtPriceX96;
          const quoteDecimals = quoteToken.decimals;

          if (isToken0Base) {
            const token0Decimals = state.discoveredPool.token0.decimals;
            const token1Decimals = state.discoveredPool.token1.decimals;
            const decimalDiff = token0Decimals - token1Decimals;
            if (decimalDiff >= 0) {
              const adjustment = 10n ** BigInt(decimalDiff);
              stopLossPrice = (rawPriceNum * adjustment * 10n ** BigInt(quoteDecimals)) / Q192;
            } else {
              const adjustment = 10n ** BigInt(-decimalDiff);
              stopLossPrice = (rawPriceNum * 10n ** BigInt(quoteDecimals)) / (Q192 * adjustment);
            }
          } else {
            const token0Decimals = state.discoveredPool.token0.decimals;
            const token1Decimals = state.discoveredPool.token1.decimals;
            const decimalDiff = token1Decimals - token0Decimals;
            if (decimalDiff >= 0) {
              const adjustment = 10n ** BigInt(decimalDiff);
              stopLossPrice = (Q192 * adjustment * 10n ** BigInt(quoteDecimals)) / rawPriceNum;
            } else {
              const adjustment = 10n ** BigInt(-decimalDiff);
              stopLossPrice = (Q192 * 10n ** BigInt(quoteDecimals)) / (rawPriceNum * adjustment);
            }
          }
        }

        if (orderConfig.triggerMode === 'UPPER' && orderConfig.sqrtPriceX96Upper) {
          const sqrtPriceX96 = BigInt(orderConfig.sqrtPriceX96Upper);
          const Q96 = 2n ** 96n;
          const Q192 = Q96 * Q96;
          const rawPriceNum = sqrtPriceX96 * sqrtPriceX96;
          const quoteDecimals = quoteToken.decimals;

          if (isToken0Base) {
            const token0Decimals = state.discoveredPool.token0.decimals;
            const token1Decimals = state.discoveredPool.token1.decimals;
            const decimalDiff = token0Decimals - token1Decimals;
            if (decimalDiff >= 0) {
              const adjustment = 10n ** BigInt(decimalDiff);
              takeProfitPrice = (rawPriceNum * adjustment * 10n ** BigInt(quoteDecimals)) / Q192;
            } else {
              const adjustment = 10n ** BigInt(-decimalDiff);
              takeProfitPrice = (rawPriceNum * 10n ** BigInt(quoteDecimals)) / (Q192 * adjustment);
            }
          } else {
            const token0Decimals = state.discoveredPool.token0.decimals;
            const token1Decimals = state.discoveredPool.token1.decimals;
            const decimalDiff = token1Decimals - token0Decimals;
            if (decimalDiff >= 0) {
              const adjustment = 10n ** BigInt(decimalDiff);
              takeProfitPrice = (Q192 * adjustment * 10n ** BigInt(quoteDecimals)) / rawPriceNum;
            } else {
              const adjustment = 10n ** BigInt(-decimalDiff);
              takeProfitPrice = (Q192 * 10n ** BigInt(quoteDecimals)) / (rawPriceNum * adjustment);
            }
          }
        }
      } catch {
        // Ignore conversion errors for individual orders
      }
    }

    return { stopLossPrice, takeProfitPrice };
  }, [state.activeCloseOrders, state.discoveredPool, baseToken, quoteToken, isToken0Base]);

  // Auto-reset scenario when SL/TP is not available
  useEffect(() => {
    if (scenario === 'sl_triggered' && !closeOrderPrices.stopLossPrice) {
      setScenario('combined');
    }
    if (scenario === 'tp_triggered' && !closeOrderPrices.takeProfitPrice) {
      setScenario('combined');
    }
  }, [closeOrderPrices.stopLossPrice, closeOrderPrices.takeProfitPrice, scenario]);

  // Create simulation position for PnL curve
  // Shows COMBINED position (existing + additional liquidity)
  const simulationPosition = useMemo(() => {
    if (!state.discoveredPool || !position || combinedCostBasis === 0n) return null;

    const existingLiquidity = BigInt(position.state.liquidity);
    const additionalLiquidity = BigInt(calculations.liquidity || '0');
    const combinedLiquidity = existingLiquidity + additionalLiquidity;
    if (combinedLiquidity === 0n) return null;

    try {
      const basePosition = UniswapV3Position.forSimulation({
        pool: state.discoveredPool,
        isToken0Quote: !isToken0Base,
        tickLower,
        tickUpper,
        liquidity: combinedLiquidity,
        costBasis: combinedCostBasis,
      });

      return new CloseOrderSimulationOverlay({
        underlyingPosition: basePosition,
        stopLossPrice: closeOrderPrices.stopLossPrice,
        takeProfitPrice: closeOrderPrices.takeProfitPrice,
      });
    } catch {
      return null;
    }
  }, [state.discoveredPool, position, calculations.liquidity, isToken0Base, tickLower, tickUpper, combinedCostBasis, closeOrderPrices]);

  // Calculate PnL at range boundaries (respects SL/TP triggers via simulationPosition)
  const rangeBoundaryInfo = useMemo(() => {
    if (!state.discoveredPool || !baseToken || !quoteToken || !simulationPosition) return null;

    try {
      const baseTokenDecimals = isToken0Base
        ? state.discoveredPool.token0.decimals
        : state.discoveredPool.token1.decimals;

      const lowerPriceBigInt = tickToPrice(tickLower, baseToken.address, quoteToken.address, baseTokenDecimals);
      const upperPriceBigInt = tickToPrice(tickUpper, baseToken.address, quoteToken.address, baseTokenDecimals);

      const lowerPriceBigIntAdjusted = isToken0Base ? lowerPriceBigInt : upperPriceBigInt;
      const upperPriceBigIntAdjusted = isToken0Base ? upperPriceBigInt : lowerPriceBigInt;

      // Use simulationPosition (CloseOrderSimulationOverlay) so that
      // PnL at range bounds is capped by SL/TP triggers when applicable
      const lowerResult = simulationPosition.simulatePnLAtPrice(lowerPriceBigIntAdjusted);
      const upperResult = simulationPosition.simulatePnLAtPrice(upperPriceBigIntAdjusted);

      return {
        lowerPriceBigInt: lowerPriceBigIntAdjusted,
        upperPriceBigInt: upperPriceBigIntAdjusted,
        lowerPnlValue: lowerResult.pnlValue,
        upperPnlValue: upperResult.pnlValue,
        lowerPnlPercent: lowerResult.pnlPercent,
        upperPnlPercent: upperResult.pnlPercent,
      };
    } catch {
      return null;
    }
  }, [state.discoveredPool, baseToken, quoteToken, simulationPosition, isToken0Base, tickLower, tickUpper]);

  // Calculate PnL at close order trigger prices
  const slDrawdown = useMemo(() => {
    if (!closeOrderPrices.stopLossPrice || !simulationPosition) return null;
    try {
      const result = simulationPosition.simulatePnLAtPrice(closeOrderPrices.stopLossPrice);
      return { pnlValue: result.pnlValue };
    } catch {
      return null;
    }
  }, [closeOrderPrices.stopLossPrice, simulationPosition]);

  const tpRunup = useMemo(() => {
    if (!closeOrderPrices.takeProfitPrice || !simulationPosition) return null;
    try {
      const result = simulationPosition.simulatePnLAtPrice(closeOrderPrices.takeProfitPrice);
      return { pnlValue: result.pnlValue };
    } catch {
      return null;
    }
  }, [closeOrderPrices.takeProfitPrice, simulationPosition]);

  // Input handlers
  const handleBaseInputChange = useCallback((value: string) => {
    setBaseInput(value);
  }, [setBaseInput]);

  const handleQuoteInputChange = useCallback((value: string) => {
    setQuoteInput(value);
  }, [setQuoteInput]);

  const handleBaseMax = useCallback(() => {
    if (!baseBalance || !baseToken) return;
    const formatted = formatUnits(baseBalance, baseToken.decimals);
    setBaseInput(formatted);
  }, [baseBalance, baseToken, setBaseInput]);

  const handleQuoteMax = useCallback(() => {
    if (!quoteBalance || !quoteToken) return;
    const formatted = formatUnits(quoteBalance, quoteToken.decimals);
    setQuoteInput(formatted);
  }, [quoteBalance, quoteToken, setQuoteInput]);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setInteractiveZoom(Math.min(state.interactiveZoom + ZOOM_STEP, ZOOM_MAX));
  }, [state.interactiveZoom, setInteractiveZoom]);

  const handleZoomOut = useCallback(() => {
    setInteractiveZoom(Math.max(state.interactiveZoom - ZOOM_STEP, ZOOM_MIN));
  }, [state.interactiveZoom, setInteractiveZoom]);

  // ===== Render =====

  const renderInteractive = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Additional Deposit</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
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
            onClick={handleZoomIn}
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

      <div className="grid grid-cols-2 gap-4">
        <TokenAmountInput
          label={`${baseToken?.symbol || 'Base'} Amount`}
          value={state.baseInputAmount}
          onChange={handleBaseInputChange}
          onMax={handleBaseMax}
          balance={baseBalance}
          decimals={baseToken?.decimals ?? 18}
          symbol={baseToken?.symbol ?? ''}
          isBalanceLoading={isBaseBalanceLoading}
          isConnected={isConnected}
          placeholder="0.0"
        />
        <TokenAmountInput
          label={`${quoteToken?.symbol || 'Quote'} Amount`}
          value={state.quoteInputAmount}
          onChange={handleQuoteInputChange}
          onMax={handleQuoteMax}
          balance={quoteBalance}
          decimals={quoteToken?.decimals ?? 18}
          symbol={quoteToken?.symbol ?? ''}
          isBalanceLoading={isQuoteBalanceLoading}
          isConnected={isConnected}
          placeholder="0.0"
        />
      </div>
    </div>
  );

  const renderVisual = () => {
    const hasPoolData = state.discoveredPool && baseToken && quoteToken && sliderBounds.min > 0;

    if (hasPoolData) {
      const discoveredPool = state.discoveredPool!;
      return (
        <div className="h-full flex flex-col min-h-0">
          <PnLScenarioTabs
            scenario={scenario}
            onScenarioChange={setScenario}
            hasStopLoss={closeOrderPrices.stopLossPrice !== null}
            hasTakeProfit={closeOrderPrices.takeProfitPrice !== null}
          />
          <InteractivePnLCurve
            poolData={{
              token0Address: discoveredPool.token0.config.address as string,
              token0Decimals: discoveredPool.token0.decimals,
              token1Address: discoveredPool.token1.config.address as string,
              token1Decimals: discoveredPool.token1.decimals,
              feeBps: discoveredPool.feeBps,
              currentTick: discoveredPool.state.currentTick as number,
              sqrtPriceX96: discoveredPool.state.sqrtPriceX96 as string,
            }}
            baseToken={{
              address: baseToken!.address,
              symbol: baseToken!.symbol,
              decimals: baseToken!.decimals,
            }}
            quoteToken={{
              address: quoteToken!.address,
              symbol: quoteToken!.symbol,
              decimals: quoteToken!.decimals,
            }}
            position={simulationPosition}
            sliderBounds={sliderBounds}
            onSliderBoundsChange={handleSliderBoundsChange}
            scenario={scenario}
            // No tick/SL/TP change callbacks = range and triggers are non-draggable
            className="flex-1 min-h-0"
          />
          <p className="text-xs text-slate-400 mt-2 text-center shrink-0">
            <span className="font-semibold">Projected Risk Profile.</span> Shows position value after the increase.
          </p>
        </div>
      );
    }

    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-500">
        <div className="w-full max-w-md space-y-6">
          <div className="relative h-48 border-l-2 border-b-2 border-slate-700">
            <div className="absolute -left-8 top-1/2 -translate-y-1/2 -rotate-90 text-xs text-slate-600 whitespace-nowrap">
              Position Value
            </div>
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
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
            <p className="text-sm font-medium text-slate-400">PnL Curve Visualization</p>
            <p className="text-xs text-slate-500">
              Enter token amounts to see the projected risk profile
            </p>
          </div>
        </div>
      </div>
    );
  };

  const renderSummary = () => (
    <IncreaseWizardSummaryPanel
      nextDisabled={!calculations.isValid}
      rangePnl={rangeBoundaryInfo}
      slDrawdown={slDrawdown}
      tpRunup={tpRunup}
      stopLossPrice={closeOrderPrices.stopLossPrice}
      takeProfitPrice={closeOrderPrices.takeProfitPrice}
    />
  );

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}

// ============================================================================
// Token Amount Input Component (local, same pattern as create wizard)
// ============================================================================

interface TokenAmountInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onMax: () => void;
  balance: bigint | undefined;
  decimals: number;
  symbol: string;
  isBalanceLoading: boolean;
  isConnected: boolean;
  placeholder?: string;
}

function TokenAmountInput({
  label,
  value,
  onChange,
  onMax,
  balance,
  decimals,
  symbol,
  isBalanceLoading,
  isConnected,
  placeholder = '0.0',
}: TokenAmountInputProps) {
  const renderBalance = () => {
    if (!isConnected) {
      return <span className="text-slate-500">-- {symbol}</span>;
    }
    if (isBalanceLoading) {
      return <span>Loading...</span>;
    }
    return (
      <span>
        {formatCompactValue(balance ?? 0n, decimals)} {symbol}
      </span>
    );
  };

  const isMaxDisabled = !isConnected || !balance || balance === 0n;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm text-slate-400">{label}</label>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Wallet className="w-3 h-3" />
          {renderBalance()}
        </div>
      </div>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            const val = e.target.value;
            if (val === '' || /^[0-9]*\.?[0-9]*$/.test(val)) {
              onChange(val);
            }
          }}
          placeholder={placeholder}
          className="w-full px-3 py-2 pr-14 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm"
        />
        <button
          onClick={onMax}
          disabled={isMaxDisabled}
          className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-0.5 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:text-slate-500"
        >
          MAX
        </button>
      </div>
    </div>
  );
}
