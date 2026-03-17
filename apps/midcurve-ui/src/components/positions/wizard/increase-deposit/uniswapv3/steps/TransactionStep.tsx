import { useMemo, useCallback, useEffect } from 'react';
import { useAccount, useChainId } from 'wagmi';
import type { Address } from 'viem';
import { getAddress } from 'viem';
import type { PoolSearchTokenInfo } from '@midcurve/api-shared';
import { getTokenAmountsFromLiquidity } from '@midcurve/shared';
import { useNavigate, useLocation } from 'react-router-dom';

import { useIncreaseDepositWizard } from '../context/IncreaseDepositWizardContext';
import { IncreaseWizardSummaryPanel } from '../shared/IncreaseWizardSummaryPanel';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { EvmSwitchNetworkPrompt } from '@/components/common/EvmSwitchNetworkPrompt';
import { useErc20TokenApprovalPrompt } from '@/components/common/Erc20TokenApprovalPrompt';
import { useEvmTransactionPrompt } from '@/components/common/EvmTransactionPrompt';
import { useWatchErc20TokenBalance } from '@/hooks/tokens/erc20/useWatchErc20TokenBalance';
import { usePriceAdjustment } from '@/components/positions/wizard/create-position/uniswapv3/hooks/usePriceAdjustment';
import { useIncreaseLiquidity } from '@/hooks/positions/uniswapv3/useIncreaseLiquidity';
import { useUniswapV3RefreshPosition } from '@/hooks/positions/uniswapv3/useUniswapV3RefreshPosition';
import { AddToPortfolioSection } from '@/components/positions/wizard/create-position/uniswapv3/shared/AddToPortfolioSection';
import { PriceAdjustmentStep } from '@/components/common/PriceAdjustmentStep';
import { usePriceAdjustmentInteraction } from '@/components/common/usePriceAdjustmentInteraction';
import { getChainSlugByChainId } from '@/config/chains';
import { NONFUNGIBLE_POSITION_MANAGER_ADDRESSES } from '@/config/contracts/nonfungible-position-manager';

export function TransactionStep() {
  const { state } = useIncreaseDepositWizard();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string })?.returnTo || '/dashboard';
  const { address: walletAddress, isConnected } = useAccount();
  const walletChainId = useChainId();

  const position = state.position;
  const pool = position?.pool;
  const config = position?.config as { chainId: number; nftId: number; tickLower: number; tickUpper: number } | undefined;
  const poolChainId = config?.chainId ?? 1;
  const chainSlug = getChainSlugByChainId(poolChainId);
  const isWrongNetwork = isConnected && walletChainId !== poolChainId;
  const tickLower = config?.tickLower ?? 0;
  const tickUpper = config?.tickUpper ?? 0;

  const npmAddress = NONFUNGIBLE_POSITION_MANAGER_ADDRESSES[poolChainId] ?? null;

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

  // Watch wallet balances to cap increase amounts (prevents reverts when tolerance let user through with slightly less)
  const token0Address = pool ? (pool.token0.config as { address: string }).address : null;
  const token1Address = pool ? (pool.token1.config as { address: string }).address : null;
  const { balanceBigInt: token0Balance } = useWatchErc20TokenBalance({
    tokenAddress: token0Address,
    walletAddress: walletAddress ?? null,
    chainId: poolChainId,
    enabled: !!token0Address && !!walletAddress && isConnected && !isWrongNetwork,
  });
  const { balanceBigInt: token1Balance } = useWatchErc20TokenBalance({
    tokenAddress: token1Address,
    walletAddress: walletAddress ?? null,
    chainId: poolChainId,
    enabled: !!token1Address && !!walletAddress && isConnected && !isWrongNetwork,
  });

  // Original amounts for approvals
  const originalBaseAmount = BigInt(state.allocatedBaseAmount || '0');
  const originalQuoteAmount = BigInt(state.allocatedQuoteAmount || '0');

  // ===== Token Approvals (unified prompt components — same visual as create wizard) =====
  const baseApprovalPrompt = useErc20TokenApprovalPrompt({
    tokenAddress: (baseToken?.address ? getAddress(baseToken.address) : null) as Address | null,
    tokenSymbol: baseToken?.symbol || 'Base Token',
    tokenDecimals: baseToken?.decimals ?? 18,
    requiredAmount: originalBaseAmount,
    spenderAddress: npmAddress,
    chainId: poolChainId,
    enabled: !!baseToken?.address && !!walletAddress && !isWrongNetwork && originalBaseAmount > 0n,
  });

  const quoteApprovalPrompt = useErc20TokenApprovalPrompt({
    tokenAddress: (quoteToken?.address ? getAddress(quoteToken.address) : null) as Address | null,
    tokenSymbol: quoteToken?.symbol || 'Quote Token',
    tokenDecimals: quoteToken?.decimals ?? 18,
    requiredAmount: originalQuoteAmount,
    spenderAddress: npmAddress,
    chainId: poolChainId,
    enabled: !!quoteToken?.address && !!walletAddress && !isWrongNetwork && originalQuoteAmount > 0n,
  });

  const baseApprovalDone = originalBaseAmount === 0n || baseApprovalPrompt.isApproved;
  const quoteApprovalDone = originalQuoteAmount === 0n || quoteApprovalPrompt.isApproved;
  const allApprovalsDone = baseApprovalDone && quoteApprovalDone;

  // ===== Price Adjustment =====
  const priceAdjustment = usePriceAdjustment({
    discoveredPool: state.discoveredPool,
    originalBaseAmount: state.allocatedBaseAmount,
    originalQuoteAmount: state.allocatedQuoteAmount,
    tickLower,
    tickUpper,
    baseToken,
    quoteToken,
    enabled: isConnected && !isWrongNetwork && BigInt(state.additionalLiquidity || '0') > 0n,
    pollIntervalMs: 1000,
  });

  const priceAdjustmentReady = priceAdjustment.status === 'ready';
  const priceAdjustmentInteraction = usePriceAdjustmentInteraction(priceAdjustment);

  // Compute token0/token1 amounts from adjusted values
  const adjustedAmounts = useMemo(() => {
    if (!priceAdjustmentReady || !state.discoveredPool || !position) {
      return { token0Amount: 0n, token1Amount: 0n };
    }

    const adjustedLiquidity = BigInt(priceAdjustment.adjustedLiquidity || '0');
    if (adjustedLiquidity === 0n) {
      return { token0Amount: 0n, token1Amount: 0n };
    }

    try {
      const sqrtPriceX96 = priceAdjustment.currentSqrtPriceX96 ??
        BigInt(state.discoveredPool.state.sqrtPriceX96 as string);

      return getTokenAmountsFromLiquidity(
        adjustedLiquidity,
        sqrtPriceX96,
        tickLower,
        tickUpper
      );
    } catch {
      return { token0Amount: 0n, token1Amount: 0n };
    }
  }, [priceAdjustmentReady, priceAdjustment.adjustedLiquidity, priceAdjustment.currentSqrtPriceX96, state.discoveredPool, position, tickLower, tickUpper]);

  // ===== Increase Liquidity =====
  // Cap amounts to actual wallet balance (tolerance in SwapStep may allow up to 1% shortfall)
  const cappedToken0 = token0Balance !== undefined && token0Balance < adjustedAmounts.token0Amount ? token0Balance : adjustedAmounts.token0Amount;
  const cappedToken1 = token1Balance !== undefined && token1Balance < adjustedAmounts.token1Amount ? token1Balance : adjustedAmounts.token1Amount;

  const increaseLiquidityParams = useMemo(() => {
    if (!config || !allApprovalsDone || !priceAdjustmentReady) return null;
    if (cappedToken0 === 0n && cappedToken1 === 0n) return null;

    return {
      tokenId: BigInt(config.nftId),
      amount0Desired: cappedToken0,
      amount1Desired: cappedToken1,
      chainId: poolChainId,
      slippageBps: 50,
    };
  }, [config, allApprovalsDone, priceAdjustmentReady, cappedToken0, cappedToken1, poolChainId]);

  const increaseLiquidity = useIncreaseLiquidity(increaseLiquidityParams);

  const refreshPosition = useUniswapV3RefreshPosition();

  useEffect(() => {
    if (
      increaseLiquidity.isSuccess &&
      config &&
      !refreshPosition.isPending &&
      !refreshPosition.isSuccess
    ) {
      refreshPosition.mutate({ chainId: poolChainId, nftId: config.nftId.toString() });
    }
  }, [increaseLiquidity.isSuccess, config, poolChainId, refreshPosition]);

  // Transaction prompt for increase liquidity (same visual as create wizard's mint step)
  const increasePrompt = useEvmTransactionPrompt({
    label: 'Increase Liquidity',
    buttonLabel: 'Execute',
    retryButtonLabel: 'Retry',
    chainId: poolChainId,
    enabled: allApprovalsDone && priceAdjustmentReady && !!increaseLiquidityParams,
    showActionButton: allApprovalsDone && priceAdjustmentReady,
    txHash: increaseLiquidity.increaseTxHash,
    isSubmitting: increaseLiquidity.isIncreasing,
    isWaitingForConfirmation: increaseLiquidity.isWaitingForConfirmation,
    isSuccess: increaseLiquidity.isSuccess,
    error: increaseLiquidity.increaseError,
    revertMessage: 'The pool price likely moved beyond slippage tolerance while the transaction was pending. Click Retry to re-attempt with updated token amounts.',
    onExecute: () => increaseLiquidity.increase(),
    onReset: () => increaseLiquidity.reset(),
  });

  // Handle finish
  const handleFinish = useCallback(() => {
    navigate(returnTo, { replace: true });
  }, [navigate, returnTo]);

  // ===== Render =====

  const renderInteractive = () => {
    if (!isConnected) {
      return (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-white">Execute Transactions</h3>
          <EvmWalletConnectionPrompt
            title="Connect Wallet"
            description="Connect your wallet to approve tokens and execute the transaction"
          />
        </div>
      );
    }

    if (isWrongNetwork && chainSlug) {
      return (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-white">Execute Transactions</h3>
          <EvmSwitchNetworkPrompt chain={chainSlug} isWrongNetwork={isWrongNetwork} />
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <h3 className="text-lg font-semibold text-white">Execute Transactions</h3>

        <div className="space-y-3">
          {/* 1. Base Token Approval */}
          {originalBaseAmount > 0n && baseApprovalPrompt.element}

          {/* 2. Quote Token Approval */}
          {originalQuoteAmount > 0n && quoteApprovalPrompt.element}

          {/* 3. Confirm Pool Price */}
          <PriceAdjustmentStep
            status={allApprovalsDone ? priceAdjustment.status : 'idle'}
            currentSqrtPriceX96={priceAdjustment.currentSqrtPriceX96}
            discoveredPool={state.discoveredPool}
            baseToken={baseToken}
            quoteToken={quoteToken}
            isTxSuccess={increaseLiquidity.isSuccess}
            priceChangePercent={priceAdjustment.priceChangePercent}
            onAdjust={priceAdjustmentInteraction.handleAdjust}
            isRecalculating={priceAdjustmentInteraction.isRecalculating}
            hasAdjusted={priceAdjustmentInteraction.hasAdjusted}
            error={priceAdjustment.error}
          />

          {/* 4. Increase Liquidity */}
          {increasePrompt.element}

          {/* 5. Update position in portfolio */}
          {increaseLiquidity.isSuccess && (
            <AddToPortfolioSection
              isPending={refreshPosition.isPending}
              isSuccess={refreshPosition.isSuccess}
              isError={refreshPosition.isError}
              error={refreshPosition.error instanceof Error ? refreshPosition.error : null}
              label="Updating the position in your portfolio"
              onRetry={() => {
                if (config) {
                  refreshPosition.mutate({ chainId: poolChainId, nftId: config.nftId.toString() });
                }
              }}
            />
          )}
        </div>
      </div>
    );
  };

  const renderVisual = () => null;

  const renderSummary = () => (
    <IncreaseWizardSummaryPanel
      showFinish={refreshPosition.isSuccess || refreshPosition.isError}
      onFinish={handleFinish}
      nextDisabled={true}
    />
  );

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
