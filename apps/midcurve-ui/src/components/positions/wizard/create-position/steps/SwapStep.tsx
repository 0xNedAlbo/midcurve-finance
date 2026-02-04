/**
 * SwapStep Component
 *
 * Wizard step for acquiring required token amounts before opening a position.
 * Compares user's wallet balance against required amounts and provides links
 * to Cow Swap to acquire missing tokens.
 *
 * Features:
 * - Real-time balance tracking via WebSocket-backed subscriptions
 * - Token balance comparison table (Wallet | Required | Status)
 * - External Cow Swap links for acquiring missing tokens
 * - Wallet connection and network switching prompts
 * - Skip option for manual balance management
 */

'use client';

import { useEffect, useMemo, useCallback } from 'react';
import { Check, Loader2, ArrowRight, Coins, PlusCircle, MinusCircle } from 'lucide-react';
import { useAccount, useChainId } from 'wagmi';
import type { PoolSearchTokenInfo } from '@midcurve/api-shared';
import {
  formatCompactValue,
  compareAddresses,
  UniswapV3Position,
  CloseOrderSimulationOverlay,
} from '@midcurve/shared';

import { useCreatePositionWizard } from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';
import { AllocatedCapitalSection } from '../shared/AllocatedCapitalSection';
import { useWatchErc20TokenBalance } from '@/hooks/tokens/erc20/useWatchErc20TokenBalance';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { NetworkSwitchStep } from '@/components/positions/NetworkSwitchStep';
import { getChainSlugByChainId } from '@/config/chains';
import { InteractivePnLCurve } from '@/components/positions/pnl-curve/uniswapv3';

/**
 * Small token logo with fallback
 */
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

  // Build Cow Swap URL: https://swap.cow.fi/#/{chainId}/swap/{sellToken}/{buyToken}?buyAmount={amount}
  const cowSwapUrl = useMemo(() => {
    if (isSufficient || missingAmount === 0n) return null;
    // Convert missing amount to decimal string (without decimals for the URL)
    const buyAmountDecimal = Number(missingAmount) / (10 ** token.decimals);
    return `https://swap.cow.fi/#/${chainId}/swap/${otherTokenSymbol}/${token.symbol}?buyAmount=${buyAmountDecimal}`;
  }, [chainId, otherTokenSymbol, token.symbol, token.decimals, missingAmount, isSufficient]);

  return (
    <tr className="border-b border-slate-700/50 last:border-b-0">
      {/* Token */}
      <td className="py-3 px-3">
        <div className="flex items-center gap-2">
          <TokenLogo logoUrl={logoUrl} symbol={token.symbol} />
          <span className="text-white font-medium">{token.symbol}</span>
        </div>
      </td>

      {/* Wallet Balance */}
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

      {/* Required Amount */}
      <td className="py-3 px-3 text-right">
        <span className={`font-mono text-sm ${isSufficient ? 'text-white' : 'text-orange-400'}`}>
          {formatCompactValue(requiredAmount, token.decimals)}
        </span>
      </td>

      {/* Status */}
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

// Zoom constants (consistent with PositionConfigStep)
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.125;

export function SwapStep() {
  const { state, setStepValid, goNext, setNeedsSwap, setInteractiveZoom } = useCreatePositionWizard();
  const { address: walletAddress, isConnected } = useAccount();
  const walletChainId = useChainId();

  // Zoom handlers using context state
  const handleZoomIn = useCallback(() => {
    setInteractiveZoom(Math.min(state.interactiveZoom + ZOOM_STEP, ZOOM_MAX));
  }, [state.interactiveZoom, setInteractiveZoom]);

  const handleZoomOut = useCallback(() => {
    setInteractiveZoom(Math.max(state.interactiveZoom - ZOOM_STEP, ZOOM_MIN));
  }, [state.interactiveZoom, setInteractiveZoom]);

  // Get pool chain ID
  const poolChainId = state.discoveredPool?.chainId ?? state.selectedPool?.chainId ?? 1;
  const chainSlug = getChainSlugByChainId(poolChainId);
  const isWrongNetwork = isConnected && walletChainId !== poolChainId;

  // Watch base token balance (WebSocket-backed)
  const {
    balanceBigInt: baseBalance,
    isLoading: isBaseBalanceLoading,
  } = useWatchErc20TokenBalance({
    tokenAddress: state.baseToken?.address ?? null,
    walletAddress: walletAddress ?? null,
    chainId: poolChainId,
    enabled: isConnected && !isWrongNetwork && !!state.baseToken?.address,
  });

  // Watch quote token balance (WebSocket-backed)
  const {
    balanceBigInt: quoteBalance,
    isLoading: isQuoteBalanceLoading,
  } = useWatchErc20TokenBalance({
    tokenAddress: state.quoteToken?.address ?? null,
    walletAddress: walletAddress ?? null,
    chainId: poolChainId,
    enabled: isConnected && !isWrongNetwork && !!state.quoteToken?.address,
  });

  // Parse required amounts from wizard state
  const requiredBaseAmount = useMemo(() => {
    try {
      return BigInt(state.allocatedBaseAmount);
    } catch {
      return 0n;
    }
  }, [state.allocatedBaseAmount]);

  const requiredQuoteAmount = useMemo(() => {
    try {
      return BigInt(state.allocatedQuoteAmount);
    } catch {
      return 0n;
    }
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

  // Check if both balances are sufficient
  const bothSatisfied = useMemo(() => {
    // Need balances to be loaded
    if (baseBalance === undefined || quoteBalance === undefined) return false;
    return missingBaseAmount === 0n && missingQuoteAmount === 0n;
  }, [baseBalance, quoteBalance, missingBaseAmount, missingQuoteAmount]);

  // Update step validation when satisfaction changes
  useEffect(() => {
    setStepValid('swap', bothSatisfied);
  }, [bothSatisfied, setStepValid]);

  // Determine correct logo based on which token is base/quote
  const getTokenLogoUrl = (tokenAddress: string | undefined) => {
    if (!tokenAddress || !state.discoveredPool) return null;
    const normalizedAddress = tokenAddress.toLowerCase();
    if (state.discoveredPool.token0.address.toLowerCase() === normalizedAddress) {
      return state.discoveredPool.token0.logoUrl;
    }
    if (state.discoveredPool.token1.address.toLowerCase() === normalizedAddress) {
      return state.discoveredPool.token1.logoUrl;
    }
    return null;
  };

  const actualBaseLogoUrl = getTokenLogoUrl(state.baseToken?.address);
  const actualQuoteLogoUrl = getTokenLogoUrl(state.quoteToken?.address);

  // Determine if token0 is base (for PnL curve)
  const isToken0Base = useMemo(() => {
    if (!state.discoveredPool || !state.baseToken) return true;
    return compareAddresses(
      state.discoveredPool.token0.config.address as string,
      state.baseToken.address
    ) === 0;
  }, [state.discoveredPool, state.baseToken]);

  // Create simulation position for PnL curve (non-interactive display)
  const simulationPosition = useMemo(() => {
    const liquidityBigInt = BigInt(state.liquidity || '0');
    if (!state.discoveredPool || liquidityBigInt === 0n) {
      return null;
    }

    try {
      // Use effective tick range (from state or defaults)
      const effectiveTickLower = state.tickLower !== 0 ? state.tickLower : state.defaultTickLower;
      const effectiveTickUpper = state.tickUpper !== 0 ? state.tickUpper : state.defaultTickUpper;

      if (effectiveTickLower === 0 && effectiveTickUpper === 0) {
        return null;
      }

      // Calculate cost basis from allocated amounts
      const costBasis = BigInt(state.totalQuoteValue || '0');

      // Create base position using forSimulation factory
      const basePosition = UniswapV3Position.forSimulation({
        pool: state.discoveredPool,
        isToken0Quote: !isToken0Base,
        tickLower: effectiveTickLower,
        tickUpper: effectiveTickUpper,
        liquidity: liquidityBigInt,
        costBasis,
      });

      // Wrap in overlay (no SL/TP for display purposes)
      return new CloseOrderSimulationOverlay({
        underlyingPosition: basePosition,
        takeProfitPrice: null,
        stopLossPrice: null,
      });
    } catch {
      return null;
    }
  }, [state.discoveredPool, state.liquidity, state.tickLower, state.tickUpper, state.defaultTickLower, state.defaultTickUpper, state.totalQuoteValue, isToken0Base]);

  // Calculate current price for slider bounds (same logic as PositionConfigStep)
  const currentPrice = useMemo(() => {
    if (!state.discoveredPool || !state.baseToken || !state.quoteToken) {
      return 0;
    }

    try {
      const pool = state.discoveredPool;
      const sqrtPriceX96 = BigInt(pool.state.sqrtPriceX96 as string);

      // price = (sqrtPriceX96 / 2^96)^2
      const Q96 = 2n ** 96n;
      const Q192 = Q96 * Q96;

      const token0Decimals = pool.token0.decimals;
      const token1Decimals = pool.token1.decimals;
      const quoteDecimals = state.quoteToken.decimals;

      // Raw price is token1/token0 ratio
      const rawPriceNum = sqrtPriceX96 * sqrtPriceX96;

      // Calculate price as number with quote token decimals precision
      let priceBigint: bigint;
      if (isToken0Base) {
        // Price is token1/token0 (quote per base)
        const decimalDiff = token0Decimals - token1Decimals;
        if (decimalDiff >= 0) {
          const adjustment = 10n ** BigInt(decimalDiff);
          priceBigint = (rawPriceNum * adjustment * (10n ** BigInt(quoteDecimals))) / Q192;
        } else {
          const adjustment = 10n ** BigInt(-decimalDiff);
          priceBigint = (rawPriceNum * (10n ** BigInt(quoteDecimals))) / (Q192 * adjustment);
        }
      } else {
        // Price is token0/token1 (quote per base) = 1 / (token1/token0)
        const decimalDiff = token1Decimals - token0Decimals;
        if (decimalDiff >= 0) {
          const adjustment = 10n ** BigInt(decimalDiff);
          priceBigint = (Q192 * adjustment * (10n ** BigInt(quoteDecimals))) / rawPriceNum;
        } else {
          const adjustment = 10n ** BigInt(-decimalDiff);
          priceBigint = (Q192 * (10n ** BigInt(quoteDecimals))) / (rawPriceNum * adjustment);
        }
      }

      // Convert to number for slider bounds
      return Number(priceBigint) / (10 ** quoteDecimals);
    } catch {
      return 0;
    }
  }, [state.discoveredPool, state.baseToken, state.quoteToken, isToken0Base]);

  // Slider bounds: ±50% of current price (non-interactive, just for display)
  const sliderBounds = useMemo(() => {
    if (currentPrice <= 0) {
      return { min: 0, max: 0 };
    }
    return {
      min: currentPrice * 0.5,
      max: currentPrice * 1.5,
    };
  }, [currentPrice]);

  // Handle skip - proceed without swapping
  const handleSkip = () => {
    setNeedsSwap(false);
    goNext();
  };

  // ===== Render Functions =====

  const renderInteractive = () => {
    // Shared zoom controls component
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

    // Check prerequisites first
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
          <NetworkSwitchStep chain={chainSlug} isWrongNetwork={isWrongNetwork} />
        </div>
      );
    }

    // Loading state
    const isLoading = isBaseBalanceLoading || isQuoteBalanceLoading;

    // Main content: Token balance table (always shown)
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-white">Acquire Required Tokens</h3>
            {/* Only show Skip button when balances are insufficient */}
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

        {/* Token balance table */}
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
              {state.baseToken && state.quoteToken && (
                <TokenBalanceRow
                  token={state.baseToken}
                  walletBalance={baseBalance}
                  requiredAmount={requiredBaseAmount}
                  missingAmount={missingBaseAmount}
                  isLoading={isBaseBalanceLoading}
                  logoUrl={actualBaseLogoUrl}
                  chainId={poolChainId}
                  otherTokenSymbol={state.quoteToken.symbol}
                />
              )}
              {state.quoteToken && state.baseToken && (
                <TokenBalanceRow
                  token={state.quoteToken}
                  walletBalance={quoteBalance}
                  requiredAmount={requiredQuoteAmount}
                  missingAmount={missingQuoteAmount}
                  isLoading={isQuoteBalanceLoading}
                  logoUrl={actualQuoteLogoUrl}
                  chainId={poolChainId}
                  otherTokenSymbol={state.baseToken.symbol}
                />
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderVisual = () => {
    // Show PnL curve (non-interactive)
    const hasPoolData = state.discoveredPool &&
      state.baseToken &&
      state.quoteToken &&
      sliderBounds.min > 0;

    if (hasPoolData) {
      const pool = state.discoveredPool!;
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
            baseToken={{
              address: state.baseToken!.address,
              symbol: state.baseToken!.symbol,
              decimals: state.baseToken!.decimals,
            }}
            quoteToken={{
              address: state.quoteToken!.address,
              symbol: state.quoteToken!.symbol,
              decimals: state.quoteToken!.decimals,
            }}
            position={simulationPosition}
            sliderBounds={sliderBounds}
            // No interaction callbacks = non-interactive display
            className="flex-1 min-h-0"
          />
          <p className="text-xs text-slate-400 mt-2 text-center shrink-0">
            <span className="font-semibold">Risk Profile.</span> Shows how your position value changes with price movements.
          </p>
        </div>
      );
    }

    // Fallback placeholder when no pool data
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
    // Determine next button state - disabled when wallet not connected, wrong network,
    // balances loading, or balances insufficient
    const isLoading = isBaseBalanceLoading || isQuoteBalanceLoading;
    const nextDisabled = !isConnected || isWrongNetwork || !bothSatisfied || isLoading;

    return (
      <WizardSummaryPanel nextDisabled={nextDisabled}>
        <AllocatedCapitalSection
          allocatedBaseAmount={state.allocatedBaseAmount}
          allocatedQuoteAmount={state.allocatedQuoteAmount}
          totalQuoteValue={state.totalQuoteValue}
          baseToken={state.baseToken}
          quoteToken={state.quoteToken}
          baseLogoUrl={actualBaseLogoUrl}
          quoteLogoUrl={actualQuoteLogoUrl}
        />
      </WizardSummaryPanel>
    );
  };

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
