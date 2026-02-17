import { useEffect, useMemo, useCallback } from 'react';
import { Check, Loader2, ArrowRight, Coins, PlusCircle, MinusCircle } from 'lucide-react';
import { useAccount, useChainId } from 'wagmi';
import type { PoolSearchTokenInfo } from '@midcurve/api-shared';
import type { SwapConfig } from '@midcurve/shared';
import {
  formatCompactValue,
  compareAddresses,
  tickToSqrtRatioX96,
  UniswapV3Position,
  CloseOrderSimulationOverlay,
  calculatePositionValue,
} from '@midcurve/shared';

import { useIncreaseDepositWizard } from '../context/IncreaseDepositWizardContext';
import { IncreaseWizardSummaryPanel } from '../shared/IncreaseWizardSummaryPanel';
import { useWatchErc20TokenBalance } from '@/hooks/tokens/erc20/useWatchErc20TokenBalance';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { EvmSwitchNetworkPrompt } from '@/components/common/EvmSwitchNetworkPrompt';
import { getChainSlugByChainId } from '@/config/chains';
import { InteractivePnLCurve } from '@/components/positions/pnl-curve/uniswapv3';

// Zoom constants
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.125;

function TokenLogo({ logoUrl, symbol }: { logoUrl?: string | null; symbol: string }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={symbol}
        className="w-5 h-5 rounded-full bg-slate-700"
        onError={(e) => {
          e.currentTarget.style.display = 'none';
          e.currentTarget.nextElementSibling?.classList.remove('hidden');
        }}
      />
    );
  }
  return (
    <div className="w-5 h-5 rounded-full bg-slate-600 flex items-center justify-center">
      <Coins className="w-3 h-3 text-slate-400" />
    </div>
  );
}

interface TokenBalanceRowProps {
  token: PoolSearchTokenInfo;
  walletBalance: bigint | undefined;
  requiredAmount: bigint;
  missingAmount: bigint;
  isLoading: boolean;
  logoUrl?: string | null;
  chainId: number;
  otherTokenSymbol: string;
}

function TokenBalanceRow({
  token,
  walletBalance,
  requiredAmount,
  missingAmount,
  isLoading,
  logoUrl,
  chainId,
  otherTokenSymbol,
}: TokenBalanceRowProps) {
  const isSufficient = missingAmount === 0n;

  const cowSwapUrl = useMemo(() => {
    if (isSufficient || missingAmount === 0n) return null;
    const buyAmountDecimal = Number(missingAmount) / (10 ** token.decimals);
    return `https://swap.cow.fi/#/${chainId}/swap/${otherTokenSymbol}/${token.symbol}?buyAmount=${buyAmountDecimal}`;
  }, [chainId, otherTokenSymbol, token.symbol, token.decimals, missingAmount, isSufficient]);

  return (
    <tr className="border-b border-slate-700/50 last:border-b-0">
      <td className="py-3 px-3">
        <div className="flex items-center gap-2">
          <TokenLogo logoUrl={logoUrl} symbol={token.symbol} />
          <span className="text-white font-medium">{token.symbol}</span>
        </div>
      </td>
      <td className="py-3 px-3 text-right">
        {isLoading ? (
          <span className="text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin inline" />
          </span>
        ) : (
          <span className="text-slate-300 font-mono text-sm">
            {walletBalance !== undefined
              ? formatCompactValue(walletBalance, token.decimals)
              : '-'}
          </span>
        )}
      </td>
      <td className="py-3 px-3 text-right">
        <span className={`font-mono text-sm ${isSufficient ? 'text-white' : 'text-orange-400'}`}>
          {formatCompactValue(requiredAmount, token.decimals)}
        </span>
      </td>
      <td className="py-3 px-3 text-right">
        {isSufficient ? (
          <span className="flex items-center justify-end gap-1 text-green-400">
            <Check className="w-4 h-4" />
            <span className="text-sm">OK</span>
          </span>
        ) : (
          <a
            href={cowSwapUrl ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 text-sm font-medium cursor-pointer flex items-center gap-1 justify-end"
          >
            Swap
            <ArrowRight className="w-3 h-3" />
          </a>
        )}
      </td>
    </tr>
  );
}

export function SwapStep() {
  const { state, setStepValid, goNext, setInteractiveZoom } = useIncreaseDepositWizard();
  const { address: walletAddress, isConnected } = useAccount();
  const walletChainId = useChainId();

  // Extract position data
  const position = state.position;
  const pool = position?.pool;
  const config = position?.config as { chainId: number; nftId: number; tickLower: number; tickUpper: number } | undefined;
  const poolChainId = config?.chainId ?? 1;
  const chainSlug = getChainSlugByChainId(poolChainId);
  const isWrongNetwork = isConnected && walletChainId !== poolChainId;
  const tickLower = config?.tickLower ?? 0;
  const tickUpper = config?.tickUpper ?? 0;

  // Get base/quote tokens
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

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setInteractiveZoom(Math.min(state.interactiveZoom + ZOOM_STEP, ZOOM_MAX));
  }, [state.interactiveZoom, setInteractiveZoom]);

  const handleZoomOut = useCallback(() => {
    setInteractiveZoom(Math.max(state.interactiveZoom - ZOOM_STEP, ZOOM_MIN));
  }, [state.interactiveZoom, setInteractiveZoom]);

  // Watch token balances
  const {
    balanceBigInt: baseBalance,
    isLoading: isBaseBalanceLoading,
  } = useWatchErc20TokenBalance({
    tokenAddress: baseToken?.address ?? null,
    walletAddress: walletAddress ?? null,
    chainId: poolChainId,
    enabled: isConnected && !isWrongNetwork && !!baseToken?.address,
  });

  const {
    balanceBigInt: quoteBalance,
    isLoading: isQuoteBalanceLoading,
  } = useWatchErc20TokenBalance({
    tokenAddress: quoteToken?.address ?? null,
    walletAddress: walletAddress ?? null,
    chainId: poolChainId,
    enabled: isConnected && !isWrongNetwork && !!quoteToken?.address,
  });

  // Parse required amounts
  const requiredBaseAmount = useMemo(() => {
    try { return BigInt(state.allocatedBaseAmount); } catch { return 0n; }
  }, [state.allocatedBaseAmount]);

  const requiredQuoteAmount = useMemo(() => {
    try { return BigInt(state.allocatedQuoteAmount); } catch { return 0n; }
  }, [state.allocatedQuoteAmount]);

  // Calculate missing amounts
  const missingBaseAmount = useMemo(() => {
    if (baseBalance === undefined) return requiredBaseAmount;
    return requiredBaseAmount > baseBalance ? requiredBaseAmount - baseBalance : 0n;
  }, [baseBalance, requiredBaseAmount]);

  const missingQuoteAmount = useMemo(() => {
    if (quoteBalance === undefined) return requiredQuoteAmount;
    return requiredQuoteAmount > quoteBalance ? requiredQuoteAmount - quoteBalance : 0n;
  }, [quoteBalance, requiredQuoteAmount]);

  const bothSatisfied = useMemo(() => {
    if (baseBalance === undefined || quoteBalance === undefined) return false;
    return missingBaseAmount === 0n && missingQuoteAmount === 0n;
  }, [baseBalance, quoteBalance, missingBaseAmount, missingQuoteAmount]);

  useEffect(() => {
    setStepValid('swap', bothSatisfied);
  }, [bothSatisfied, setStepValid]);

  // Logo URLs
  const getTokenLogoUrl = (tokenAddress: string | undefined) => {
    if (!tokenAddress || !pool) return null;
    const normalizedAddress = tokenAddress.toLowerCase();
    const t0Addr = (pool.token0.config as { address: string }).address.toLowerCase();
    const t1Addr = (pool.token1.config as { address: string }).address.toLowerCase();
    if (t0Addr === normalizedAddress) return pool.token0.logoUrl;
    if (t1Addr === normalizedAddress) return pool.token1.logoUrl;
    return null;
  };

  const baseLogoUrl = getTokenLogoUrl(baseToken?.address);
  const quoteLogoUrl = getTokenLogoUrl(quoteToken?.address);

  // PnL curve data
  const isToken0Base = useMemo(() => {
    if (!state.discoveredPool || !baseToken) return true;
    return compareAddresses(
      state.discoveredPool.token0.config.address as string,
      baseToken.address
    ) === 0;
  }, [state.discoveredPool, baseToken]);

  // Close order prices and swap configs
  const closeOrderPrices = useMemo(() => {
    let stopLossPrice: bigint | null = null;
    let takeProfitPrice: bigint | null = null;
    let slSwapConfig: SwapConfig | undefined;
    let tpSwapConfig: SwapConfig | undefined;

    if (!state.activeCloseOrders.length || !state.discoveredPool || !baseToken || !quoteToken) {
      return { stopLossPrice, takeProfitPrice, slSwapConfig, tpSwapConfig };
    }

    for (const order of state.activeCloseOrders) {
      if (!order.triggerMode || order.triggerTick == null) continue;

      try {
        const sqrtPriceX96 = BigInt(tickToSqrtRatioX96(order.triggerTick).toString());
        const quoteDecimals = quoteToken.decimals;
        const Q96 = 2n ** 96n;
        const Q192 = Q96 * Q96;
        const rawPriceNum = sqrtPriceX96 * sqrtPriceX96;
        const token0Decimals = state.discoveredPool.token0.decimals;
        const token1Decimals = state.discoveredPool.token1.decimals;

        const computePrice = (): bigint => {
          if (isToken0Base) {
            const decimalDiff = token0Decimals - token1Decimals;
            const adjustment = 10n ** BigInt(Math.abs(decimalDiff));
            return decimalDiff >= 0
              ? (rawPriceNum * adjustment * 10n ** BigInt(quoteDecimals)) / Q192
              : (rawPriceNum * 10n ** BigInt(quoteDecimals)) / (Q192 * adjustment);
          } else {
            const decimalDiff = token1Decimals - token0Decimals;
            const adjustment = 10n ** BigInt(Math.abs(decimalDiff));
            return decimalDiff >= 0
              ? (Q192 * adjustment * 10n ** BigInt(quoteDecimals)) / rawPriceNum
              : (Q192 * 10n ** BigInt(quoteDecimals)) / (rawPriceNum * adjustment);
          }
        };

        const price = computePrice();
        if (order.triggerMode === 'LOWER') stopLossPrice = price;
        if (order.triggerMode === 'UPPER') takeProfitPrice = price;
      } catch { /* ignore */ }

      // Extract swap config from explicit fields
      if (order.swapDirection !== null) {
        const cfg: SwapConfig = {
          enabled: true,
          direction: order.swapDirection!,
          slippageBps: order.swapSlippageBps ?? 100,
        };
        if (order.triggerMode === 'LOWER') slSwapConfig = cfg;
        if (order.triggerMode === 'UPPER') tpSwapConfig = cfg;
      }
    }

    return { stopLossPrice, takeProfitPrice, slSwapConfig, tpSwapConfig };
  }, [state.activeCloseOrders, state.discoveredPool, baseToken, quoteToken, isToken0Base]);

  // Simulation position for PnL curve
  const simulationPosition = useMemo(() => {
    if (!state.discoveredPool || !position) return null;
    const existingLiquidity = BigInt(position.state.liquidity);
    const additionalLiquidity = BigInt(state.additionalLiquidity || '0');
    const combinedLiquidity = existingLiquidity + additionalLiquidity;
    if (combinedLiquidity === 0n) return null;

    try {
      const sqrtPriceX96 = BigInt(state.discoveredPool.state.sqrtPriceX96 as string);
      const costBasis = calculatePositionValue(combinedLiquidity, sqrtPriceX96, tickLower, tickUpper, isToken0Base);
      if (costBasis === 0n) return null;

      const basePosition = UniswapV3Position.forSimulation({
        pool: state.discoveredPool,
        isToken0Quote: !isToken0Base,
        tickLower,
        tickUpper,
        liquidity: combinedLiquidity,
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
  }, [state.discoveredPool, position, state.additionalLiquidity, tickLower, tickUpper, isToken0Base, closeOrderPrices]);

  // Current price for slider bounds
  const currentPrice = useMemo(() => {
    if (!state.discoveredPool || !baseToken || !quoteToken) return 0;
    try {
      const sqrtPriceX96 = BigInt(state.discoveredPool.state.sqrtPriceX96 as string);
      const Q96 = 2n ** 96n;
      const Q192 = Q96 * Q96;
      const rawPriceNum = sqrtPriceX96 * sqrtPriceX96;
      const token0Decimals = state.discoveredPool.token0.decimals;
      const token1Decimals = state.discoveredPool.token1.decimals;
      const quoteDecimals = quoteToken.decimals;

      let priceBigint: bigint;
      if (isToken0Base) {
        const decimalDiff = token0Decimals - token1Decimals;
        const adjustment = 10n ** BigInt(Math.abs(decimalDiff));
        priceBigint = decimalDiff >= 0
          ? (rawPriceNum * adjustment * 10n ** BigInt(quoteDecimals)) / Q192
          : (rawPriceNum * 10n ** BigInt(quoteDecimals)) / (Q192 * adjustment);
      } else {
        const decimalDiff = token1Decimals - token0Decimals;
        const adjustment = 10n ** BigInt(Math.abs(decimalDiff));
        priceBigint = decimalDiff >= 0
          ? (Q192 * adjustment * 10n ** BigInt(quoteDecimals)) / rawPriceNum
          : (Q192 * 10n ** BigInt(quoteDecimals)) / (rawPriceNum * adjustment);
      }
      return Number(priceBigint) / (10 ** quoteDecimals);
    } catch {
      return 0;
    }
  }, [state.discoveredPool, baseToken, quoteToken, isToken0Base]);

  const sliderBounds = useMemo(() => {
    if (currentPrice <= 0) return { min: 0, max: 0 };
    return { min: currentPrice * 0.5, max: currentPrice * 1.5 };
  }, [currentPrice]);

  const handleSkip = () => goNext();

  // ===== Render =====

  const renderInteractive = () => {
    const zoomControls = (
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
    );

    if (!isConnected) {
      return (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Acquire Required Tokens</h3>
            {zoomControls}
          </div>
          <EvmWalletConnectionPrompt
            title="Connect Wallet"
            description="Connect your wallet to check token balances and swap if needed"
          />
        </div>
      );
    }

    if (isWrongNetwork && chainSlug) {
      return (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Acquire Required Tokens</h3>
            {zoomControls}
          </div>
          <EvmSwitchNetworkPrompt chain={chainSlug} isWrongNetwork={isWrongNetwork} />
        </div>
      );
    }

    const isLoading = isBaseBalanceLoading || isQuoteBalanceLoading;

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-white">Acquire Required Tokens</h3>
            {!bothSatisfied && !isLoading && (
              <button
                onClick={handleSkip}
                className="text-sm text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Skip
              </button>
            )}
          </div>
          {zoomControls}
        </div>

        <div className="bg-slate-800/30 rounded-lg border border-slate-700/50 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700/50 text-xs text-slate-400 uppercase tracking-wide">
                <th className="py-2 px-3 text-left font-medium">Token</th>
                <th className="py-2 px-3 text-right font-medium">Wallet</th>
                <th className="py-2 px-3 text-right font-medium">Required</th>
                <th className="py-2 px-3 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {baseToken && quoteToken && (
                <TokenBalanceRow
                  token={baseToken}
                  walletBalance={baseBalance}
                  requiredAmount={requiredBaseAmount}
                  missingAmount={missingBaseAmount}
                  isLoading={isBaseBalanceLoading}
                  logoUrl={baseLogoUrl}
                  chainId={poolChainId}
                  otherTokenSymbol={quoteToken.symbol}
                />
              )}
              {quoteToken && baseToken && (
                <TokenBalanceRow
                  token={quoteToken}
                  walletBalance={quoteBalance}
                  requiredAmount={requiredQuoteAmount}
                  missingAmount={missingQuoteAmount}
                  isLoading={isQuoteBalanceLoading}
                  logoUrl={quoteLogoUrl}
                  chainId={poolChainId}
                  otherTokenSymbol={baseToken.symbol}
                />
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderVisual = () => {
    const hasPoolData = state.discoveredPool && baseToken && quoteToken && sliderBounds.min > 0;

    if (hasPoolData) {
      const discoveredPool = state.discoveredPool!;
      return (
        <div className="h-full flex flex-col min-h-0">
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
            baseToken={{ address: baseToken!.address, symbol: baseToken!.symbol, decimals: baseToken!.decimals }}
            quoteToken={{ address: quoteToken!.address, symbol: quoteToken!.symbol, decimals: quoteToken!.decimals }}
            position={simulationPosition}
            sliderBounds={sliderBounds}
            className="flex-1 min-h-0"
          />
          <p className="text-xs text-slate-400 mt-2 text-center shrink-0">
            <span className="font-semibold">Projected Risk Profile.</span> Shows position value after the increase.
          </p>
        </div>
      );
    }

    return (
      <div className="h-full flex items-center justify-center bg-slate-700/20 rounded-lg border border-slate-600/30">
        <div className="text-center p-8 max-w-sm">
          <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Coins className="w-8 h-8 text-blue-400" />
          </div>
          <p className="text-slate-300 mb-2">
            Position risk profile will appear here.
          </p>
        </div>
      </div>
    );
  };

  const renderSummary = () => {
    const isLoading = isBaseBalanceLoading || isQuoteBalanceLoading;
    const nextDisabled = !isConnected || isWrongNetwork || !bothSatisfied || isLoading;

    return (
      <IncreaseWizardSummaryPanel
        showSkip={!bothSatisfied && !isLoading}
        onSkip={handleSkip}
        skipLabel="Skip"
        nextDisabled={nextDisabled}
        stopLossPrice={closeOrderPrices.stopLossPrice}
        takeProfitPrice={closeOrderPrices.takeProfitPrice}
      />
    );
  };

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
