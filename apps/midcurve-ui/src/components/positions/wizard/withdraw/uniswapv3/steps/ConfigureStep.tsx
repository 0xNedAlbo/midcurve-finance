import { useEffect, useCallback, useMemo, useState } from 'react';
import { PlusCircle, MinusCircle, TrendingDown } from 'lucide-react';
import { useAccount } from 'wagmi';
import type { PnLScenario, SwapConfig } from '@midcurve/shared';
import {
  formatCompactValue,
  calculatePositionValue,
  tickToPrice,
  tickToSqrtRatioX96,
  compareAddresses,
  getTokenAmountsFromLiquidity,
  UniswapV3Position,
  CloseOrderSimulationOverlay,
} from '@midcurve/shared';
import type { PoolSearchTokenInfo } from '@midcurve/api-shared';
import { InteractivePnLCurve } from '@/components/positions/pnl-curve/uniswapv3';
import { PnLScenarioTabs } from '@/components/positions/pnl-curve/pnl-scenario-tabs';
import { useWithdrawWizard } from '../context/WithdrawWizardContext';
import { WithdrawWizardSummaryPanel } from '../shared/WithdrawWizardSummaryPanel';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { EvmSwitchNetworkPrompt } from '@/components/common/EvmSwitchNetworkPrompt';
import { EvmAccountSwitchPrompt } from '@/components/common/EvmAccountSwitchPrompt';
import { apiClientFn } from '@/lib/api-client';
import { getChainSlugByChainId } from '@/config/chains';

// Zoom constants
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.125;

export function ConfigureStep() {
  const {
    state,
    setWithdrawPercent,
    setBurnAfterWithdraw,
    setRefreshedSqrtPrice,
    setStepValid,
    setInteractiveZoom,
  } = useWithdrawWizard();

  const { address: walletAddress, isConnected, chainId: connectedChainId } = useAccount();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [scenario, setScenario] = useState<PnLScenario>('combined');

  // Extract position data
  const position = state.position;
  const pool = position?.pool;
  const config = position?.config as { chainId: number; nftId: number; tickLower: number; tickUpper: number; poolAddress: string } | undefined;
  const positionState = position?.state as { liquidity: string; ownerAddress: string } | undefined;

  const chainId = config?.chainId ?? 1;
  const tickLower = config?.tickLower ?? 0;
  const tickUpper = config?.tickUpper ?? 0;

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

  // Determine if base token is token0
  const isToken0Base = useMemo(() => {
    if (!state.discoveredPool || !baseToken) return false;
    return compareAddresses(
      state.discoveredPool.token0.config.address as string,
      baseToken.address
    ) === 0;
  }, [state.discoveredPool, baseToken]);

  // Network/account checks
  const chainSlug = getChainSlugByChainId(chainId);
  const isWrongNetwork = isConnected && connectedChainId !== chainId;
  const isWrongAccount = !!(
    isConnected &&
    walletAddress &&
    positionState?.ownerAddress &&
    walletAddress.toLowerCase() !== positionState.ownerAddress.toLowerCase()
  );

  // Use refreshed pool price or fallback to pool state
  const currentSqrtPriceX96 = useMemo(() => {
    if (state.refreshedSqrtPriceX96) return state.refreshedSqrtPriceX96;
    if (state.discoveredPool) return state.discoveredPool.state.sqrtPriceX96 as string;
    const poolState = pool?.state as { sqrtPriceX96: string } | undefined;
    return poolState?.sqrtPriceX96 ?? '0';
  }, [state.refreshedSqrtPriceX96, state.discoveredPool, pool]);

  // Refresh pool price
  const handleRefreshPool = useCallback(async () => {
    if (isRefreshing || !config) return;
    setIsRefreshing(true);
    try {
      const poolAddress = config.poolAddress;
      const response = await apiClientFn<{ pool: { state: { sqrtPriceX96: string } } }>(
        `/api/v1/pools/uniswapv3/${config.chainId}/${poolAddress}`,
        { method: 'GET' }
      );
      if (response.pool?.state?.sqrtPriceX96) {
        setRefreshedSqrtPrice(response.pool.state.sqrtPriceX96);
      }
    } catch (error) {
      console.error('Error refreshing pool price:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, config, setRefreshedSqrtPrice]);

  // Auto-refresh pool price on mount
  useEffect(() => {
    handleRefreshPool();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Calculate current position value in quote tokens
  const currentPositionValue = useMemo(() => {
    const liquidity = BigInt(positionState?.liquidity || '0');
    const sqrtPriceX96 = BigInt(currentSqrtPriceX96 || '0');
    if (liquidity === 0n || sqrtPriceX96 === 0n) return 0n;

    try {
      const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
        liquidity, sqrtPriceX96, tickLower, tickUpper
      );

      const isQuoteToken0 = position?.isToken0Quote;
      const baseTokenAmount = isQuoteToken0 ? token1Amount : token0Amount;
      const quoteTokenAmount = isQuoteToken0 ? token0Amount : token1Amount;

      let positionValueInQuote: bigint = quoteTokenAmount;
      if (baseTokenAmount > 0n) {
        const sqrtP2 = sqrtPriceX96 * sqrtPriceX96;
        const Q192 = 1n << 192n;
        if (isQuoteToken0) {
          positionValueInQuote += (baseTokenAmount * Q192) / sqrtP2;
        } else {
          positionValueInQuote += (baseTokenAmount * sqrtP2) / Q192;
        }
      }
      return positionValueInQuote;
    } catch {
      return 0n;
    }
  }, [positionState?.liquidity, currentSqrtPriceX96, tickLower, tickUpper, position?.isToken0Quote]);

  // Calculate liquidity to remove
  const liquidityToRemove = useMemo(() => {
    const currentLiquidity = BigInt(positionState?.liquidity || '0');
    const percentScaled = Math.floor(state.withdrawPercent * 100);
    return (currentLiquidity * BigInt(percentScaled)) / 10000n;
  }, [positionState?.liquidity, state.withdrawPercent]);

  // Percentage handler
  const handlePercentChange = useCallback((percent: number) => {
    setWithdrawPercent(percent);
  }, [setWithdrawPercent]);

  // Step validation
  useEffect(() => {
    const valid = state.withdrawPercent > 0 &&
      state.withdrawPercent <= 100 &&
      isConnected &&
      !isWrongNetwork &&
      !isWrongAccount;
    setStepValid('configure', valid);
  }, [state.withdrawPercent, isConnected, isWrongNetwork, isWrongAccount, setStepValid]);

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

  // Extract SL/TP prices and swap configs from active close orders
  const closeOrderPrices = useMemo(() => {
    let stopLossPrice: bigint | null = null;
    let takeProfitPrice: bigint | null = null;
    let slSwapConfig: SwapConfig | undefined;
    let tpSwapConfig: SwapConfig | undefined;

    if (!state.activeCloseOrders.length || !state.discoveredPool || !baseToken || !quoteToken) {
      return { stopLossPrice, takeProfitPrice, slSwapConfig, tpSwapConfig };
    }

    // When isToken0Quote, contract trigger modes are inverted relative to user price direction
    const isT0Q = position?.isToken0Quote ?? false;
    const slMode = isT0Q ? 'UPPER' : 'LOWER';
    const tpMode = isT0Q ? 'LOWER' : 'UPPER';

    for (const order of state.activeCloseOrders) {
      if (!order.triggerMode || order.triggerTick == null) continue;

      try {
        const sqrtPriceX96 = BigInt(tickToSqrtRatioX96(order.triggerTick).toString());
        const Q96 = 2n ** 96n;
        const Q192 = Q96 * Q96;
        const rawPriceNum = sqrtPriceX96 * sqrtPriceX96;
        const quoteDecimals = quoteToken.decimals;
        const token0Decimals = state.discoveredPool.token0.decimals;
        const token1Decimals = state.discoveredPool.token1.decimals;

        const computePrice = (): bigint => {
          if (isToken0Base) {
            const decimalDiff = token0Decimals - token1Decimals;
            if (decimalDiff >= 0) {
              return (rawPriceNum * 10n ** BigInt(decimalDiff) * 10n ** BigInt(quoteDecimals)) / Q192;
            } else {
              return (rawPriceNum * 10n ** BigInt(quoteDecimals)) / (Q192 * 10n ** BigInt(-decimalDiff));
            }
          } else {
            const decimalDiff = token1Decimals - token0Decimals;
            if (decimalDiff >= 0) {
              return (Q192 * 10n ** BigInt(decimalDiff) * 10n ** BigInt(quoteDecimals)) / rawPriceNum;
            } else {
              return (Q192 * 10n ** BigInt(quoteDecimals)) / (rawPriceNum * 10n ** BigInt(-decimalDiff));
            }
          }
        };

        const price = computePrice();
        if (order.triggerMode === slMode) stopLossPrice = price;
        if (order.triggerMode === tpMode) takeProfitPrice = price;
      } catch {
        // Ignore conversion errors for individual orders
      }

      // Extract swap config from explicit fields
      if (order.swapDirection !== null) {
        const cfg: SwapConfig = {
          enabled: true,
          direction: order.swapDirection!,
          slippageBps: order.swapSlippageBps ?? 100,
        };
        if (order.triggerMode === slMode) slSwapConfig = cfg;
        if (order.triggerMode === tpMode) tpSwapConfig = cfg;
      }
    }

    return { stopLossPrice, takeProfitPrice, slSwapConfig, tpSwapConfig };
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

  // Create simulation position for PnL curve — shows REMAINING position after withdrawal
  const simulationPosition = useMemo(() => {
    if (!state.discoveredPool || !position) return null;

    const existingLiquidity = BigInt(positionState?.liquidity || '0');
    const remainingLiquidity = existingLiquidity - liquidityToRemove;
    if (remainingLiquidity <= 0n) return null;

    try {
      const sqrtPriceX96 = BigInt(state.discoveredPool.state.sqrtPriceX96 as string);
      const costBasis = calculatePositionValue(remainingLiquidity, sqrtPriceX96, tickLower, tickUpper, isToken0Base);
      if (costBasis === 0n) return null;

      const basePosition = UniswapV3Position.forSimulation({
        pool: state.discoveredPool,
        isToken0Quote: !isToken0Base,
        tickLower,
        tickUpper,
        liquidity: remainingLiquidity,
        costBasis,
      });

      return new CloseOrderSimulationOverlay({
        underlyingPosition: basePosition,
        stopLossPrice: closeOrderPrices.stopLossPrice,
        takeProfitPrice: closeOrderPrices.takeProfitPrice,
        stopLossSwapConfig: closeOrderPrices.slSwapConfig,
        takeProfitSwapConfig: closeOrderPrices.tpSwapConfig,
      });
    } catch {
      return null;
    }
  }, [state.discoveredPool, position, positionState?.liquidity, liquidityToRemove, isToken0Base, tickLower, tickUpper, closeOrderPrices]);

  // Calculate PnL at range boundaries for remaining position
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
        <h3 className="text-lg font-semibold text-white">Configure Withdrawal</h3>
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

      {/* Percentage Slider */}
      <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-white font-medium">Withdrawal Amount</span>
          <span className="text-white font-medium">{state.withdrawPercent.toFixed(1)}%</span>
        </div>

        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={state.withdrawPercent}
          onChange={(e) => handlePercentChange(parseFloat(e.target.value))}
          className="w-full h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
                     [&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
        />

        {/* Position value display */}
        <div className="text-xs text-slate-400">
          Position Value:{' '}
          {formatCompactValue(currentPositionValue, quoteToken?.decimals ?? 18)}{' '}
          {quoteToken?.symbol}
        </div>
      </div>

      {/* Burn NFT checkbox — only visible at 100% withdrawal */}
      {state.withdrawPercent >= 100 && (
        <label className="flex items-start gap-3 p-3 bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg cursor-pointer">
          <input
            type="checkbox"
            checked={state.burnAfterWithdraw}
            onChange={(e) => setBurnAfterWithdraw(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
          />
          <div>
            <span className="text-sm text-white font-medium">Burn Position NFT</span>
            <p className="text-xs text-slate-400 mt-0.5">
              Permanently destroy the NFT after withdrawing all liquidity. The position cannot be reopened later.
            </p>
          </div>
        </label>
      )}

      {/* Wallet/Network/Owner Checks */}
      {!isConnected && (
        <EvmWalletConnectionPrompt
          title="Connect Wallet"
          description="Connect your wallet to withdraw from this position"
        />
      )}

      {isConnected && isWrongAccount && positionState?.ownerAddress && (
        <EvmAccountSwitchPrompt>
          <p className="text-sm text-slate-400">
            Position Owner: {positionState.ownerAddress.slice(0, 6)}...{positionState.ownerAddress.slice(-4)}
          </p>
        </EvmAccountSwitchPrompt>
      )}

      {isConnected && !isWrongAccount && isWrongNetwork && chainSlug && (
        <EvmSwitchNetworkPrompt
          chain={chainSlug}
          isWrongNetwork={isWrongNetwork}
        />
      )}
    </div>
  );

  const renderVisual = () => {
    const hasPoolData = state.discoveredPool && baseToken && quoteToken && sliderBounds.min > 0;

    // Full withdrawal — no remaining position to show
    if (state.withdrawPercent >= 100 && hasPoolData) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-slate-500">
          <div className="text-center space-y-2">
            <TrendingDown className="w-8 h-8 mx-auto text-slate-600" />
            <p className="text-sm font-medium text-slate-400">Full Withdrawal</p>
            <p className="text-xs text-slate-500">
              {state.burnAfterWithdraw
                ? 'Position will be fully withdrawn and the NFT will be burned'
                : 'No remaining position after full withdrawal'}
            </p>
          </div>
        </div>
      );
    }

    if (hasPoolData && simulationPosition) {
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
            className="flex-1 min-h-0"
          />
          <p className="text-xs text-slate-400 mt-2 text-center shrink-0">
            <span className="font-semibold">Remaining Risk Profile.</span> Shows position value after the withdrawal.
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
              Drag the slider to see the remaining position risk profile
            </p>
          </div>
        </div>
      </div>
    );
  };

  const renderSummary = () => (
    <WithdrawWizardSummaryPanel
      nextDisabled={state.withdrawPercent === 0 || !isConnected || isWrongNetwork || isWrongAccount}
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
