import { useMemo, useCallback } from 'react';
import { useAccount, useChainId } from 'wagmi';
import type { Address } from 'viem';
import { getTokenAmountsFromLiquidity } from '@midcurve/shared';
import { useNavigate, useLocation } from 'react-router-dom';

import { useWithdrawWizard } from '../context/WithdrawWizardContext';
import { WithdrawWizardSummaryPanel } from '../shared/WithdrawWizardSummaryPanel';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { EvmSwitchNetworkPrompt } from '@/components/common/EvmSwitchNetworkPrompt';
import { EvmAccountSwitchPrompt } from '@/components/common/EvmAccountSwitchPrompt';
import { useEvmTransactionPrompt } from '@/components/common/EvmTransactionPrompt';
import { useDecreaseLiquidity } from '@/hooks/positions/uniswapv3/useDecreaseLiquidity';
import { getChainSlugByChainId } from '@/config/chains';

export function TransactionStep() {
  const { state } = useWithdrawWizard();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string })?.returnTo || '/dashboard';
  const { address: walletAddress, isConnected } = useAccount();
  const walletChainId = useChainId();

  const position = state.position;
  const config = position?.config as { chainId: number; nftId: number; tickLower: number; tickUpper: number } | undefined;
  const positionState = position?.state as { liquidity: string; ownerAddress: string } | undefined;
  const poolChainId = config?.chainId ?? 1;
  const chainSlug = getChainSlugByChainId(poolChainId);
  const isWrongNetwork = isConnected && walletChainId !== poolChainId;
  const isWrongAccount = !!(
    isConnected &&
    walletAddress &&
    positionState?.ownerAddress &&
    walletAddress.toLowerCase() !== positionState.ownerAddress.toLowerCase()
  );

  // Calculate withdrawal parameters from context state
  const sqrtPriceX96 = useMemo(() => {
    if (state.refreshedSqrtPriceX96) return BigInt(state.refreshedSqrtPriceX96);
    if (state.discoveredPool) return BigInt(state.discoveredPool.state.sqrtPriceX96 as string);
    const poolState = position?.pool?.state as { sqrtPriceX96: string } | undefined;
    return BigInt(poolState?.sqrtPriceX96 ?? '0');
  }, [state.refreshedSqrtPriceX96, state.discoveredPool, position?.pool?.state]);

  const liquidityToRemove = useMemo(() => {
    const currentLiquidity = BigInt(positionState?.liquidity || '0');
    const percentScaled = Math.floor(state.withdrawPercent * 100);
    return (currentLiquidity * BigInt(percentScaled)) / 10000n;
  }, [positionState?.liquidity, state.withdrawPercent]);

  // Calculate min amounts with 1% slippage
  const { amount0Min, amount1Min } = useMemo(() => {
    if (liquidityToRemove === 0n || sqrtPriceX96 === 0n || !config) {
      return { amount0Min: 0n, amount1Min: 0n };
    }
    try {
      const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
        liquidityToRemove,
        sqrtPriceX96,
        config.tickLower,
        config.tickUpper
      );
      return {
        amount0Min: (token0Amount * 9900n) / 10000n,
        amount1Min: (token1Amount * 9900n) / 10000n,
      };
    } catch {
      return { amount0Min: 0n, amount1Min: 0n };
    }
  }, [liquidityToRemove, sqrtPriceX96, config]);

  // Prepare decrease liquidity parameters
  const decreaseParams = useMemo(() => {
    if (!config || !walletAddress || liquidityToRemove === 0n || isWrongNetwork || isWrongAccount) return null;

    return {
      tokenId: BigInt(config.nftId),
      liquidity: liquidityToRemove,
      amount0Min,
      amount1Min,
      chainId: poolChainId,
      recipient: walletAddress as Address,
      slippageBps: 100,
      burnAfterCollect: state.burnAfterWithdraw && state.withdrawPercent >= 100,
    };
  }, [config, walletAddress, liquidityToRemove, amount0Min, amount1Min, poolChainId, isWrongNetwork, isWrongAccount, state.burnAfterWithdraw, state.withdrawPercent]);

  const decreaseLiquidity = useDecreaseLiquidity(decreaseParams);

  // Transaction prompt
  const isBurning = state.burnAfterWithdraw && state.withdrawPercent >= 100;
  const withdrawPrompt = useEvmTransactionPrompt({
    label: isBurning ? 'Withdraw Liquidity & Burn NFT' : 'Withdraw Liquidity',
    buttonLabel: 'Execute',
    retryButtonLabel: 'Retry',
    chainId: poolChainId,
    enabled: !!decreaseParams,
    showActionButton: isConnected && !isWrongNetwork && !isWrongAccount,
    txHash: decreaseLiquidity.withdrawTxHash,
    isSubmitting: decreaseLiquidity.isWithdrawing,
    isWaitingForConfirmation: decreaseLiquidity.isWaitingForWithdraw,
    isSuccess: decreaseLiquidity.withdrawSuccess,
    error: decreaseLiquidity.withdrawError,
    onExecute: () => decreaseLiquidity.withdraw(),
    onReset: () => decreaseLiquidity.reset(),
  });

  // Handle finish — navigate back to origin page
  const handleFinish = useCallback(() => {
    navigate(returnTo);
  }, [navigate, returnTo]);

  // ===== Render =====

  const renderInteractive = () => {
    if (!isConnected) {
      return (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-white">Execute Transaction</h3>
          <EvmWalletConnectionPrompt
            title="Connect Wallet"
            description="Connect your wallet to execute the withdrawal"
          />
        </div>
      );
    }

    if (isWrongAccount && positionState?.ownerAddress) {
      return (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-white">Execute Transaction</h3>
          <EvmAccountSwitchPrompt>
            <p className="text-sm text-slate-400">
              Position Owner: {positionState.ownerAddress.slice(0, 6)}...{positionState.ownerAddress.slice(-4)}
            </p>
          </EvmAccountSwitchPrompt>
        </div>
      );
    }

    if (isWrongNetwork && chainSlug) {
      return (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-white">Execute Transaction</h3>
          <EvmSwitchNetworkPrompt chain={chainSlug} isWrongNetwork={isWrongNetwork} />
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <h3 className="text-lg font-semibold text-white">Execute Transaction</h3>

        <div className="space-y-3">
          {withdrawPrompt.element}
        </div>
      </div>
    );
  };

  const renderVisual = () => null;

  const renderSummary = () => (
    <WithdrawWizardSummaryPanel
      showFinish={decreaseLiquidity.isSuccess}
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
