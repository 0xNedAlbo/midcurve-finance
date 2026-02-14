import { useMemo, useCallback } from 'react';
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
import { usePriceAdjustment } from '@/components/positions/wizard/create-position/uniswapv3/hooks/usePriceAdjustment';
import { useIncreaseLiquidity } from '@/hooks/positions/uniswapv3/useIncreaseLiquidity';
import { getChainSlugByChainId } from '@/config/chains';
import { NONFUNGIBLE_POSITION_MANAGER_ADDRESSES } from '@/config/contracts/nonfungible-position-manager';
import { PriceAdjustmentStep } from './PriceAdjustmentStep';

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
  const increaseLiquidityParams = useMemo(() => {
    if (!config || !allApprovalsDone || !priceAdjustmentReady) return null;
    if (adjustedAmounts.token0Amount === 0n && adjustedAmounts.token1Amount === 0n) return null;

    return {
      tokenId: BigInt(config.nftId),
      amount0Desired: adjustedAmounts.token0Amount,
      amount1Desired: adjustedAmounts.token1Amount,
      chainId: poolChainId,
      slippageBps: 50,
    };
  }, [config, allApprovalsDone, priceAdjustmentReady, adjustedAmounts, poolChainId]);

  const increaseLiquidity = useIncreaseLiquidity(increaseLiquidityParams);

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
    onExecute: () => increaseLiquidity.increase(),
    onReset: () => increaseLiquidity.reset(),
  });

  // Handle finish
  const handleFinish = useCallback(() => {
    navigate(returnTo);
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
            status={priceAdjustment.status}
            currentSqrtPriceX96={priceAdjustment.currentSqrtPriceX96}
            discoveredPool={state.discoveredPool}
            baseToken={baseToken}
            quoteToken={quoteToken}
            isIncreaseSuccess={increaseLiquidity.isSuccess}
          />

          {/* 4. Increase Liquidity */}
          {increasePrompt.element}
        </div>
      </div>
    );
  };

  const renderVisual = () => null;

  const renderSummary = () => (
    <IncreaseWizardSummaryPanel
      showFinish={increaseLiquidity.isSuccess}
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
