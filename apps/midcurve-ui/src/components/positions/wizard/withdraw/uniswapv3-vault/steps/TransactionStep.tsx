import { useMemo, useCallback, useEffect } from 'react';
import { useAccount, useChainId } from 'wagmi';
import type { Address } from 'viem';
import type {
  UniswapV3VaultPositionConfigResponse,
  UniswapV3VaultPositionStateResponse,
} from '@midcurve/api-shared';
import { useNavigate, useLocation } from 'react-router-dom';

import { useVaultWithdrawWizard } from '../context/VaultWithdrawWizardContext';
import { VaultWithdrawWizardSummaryPanel } from '../shared/VaultWithdrawWizardSummaryPanel';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { EvmSwitchNetworkPrompt } from '@/components/common/EvmSwitchNetworkPrompt';
import { EvmAccountSwitchPrompt } from '@/components/common/EvmAccountSwitchPrompt';
import { useEvmTransactionPrompt } from '@/components/common/EvmTransactionPrompt';
import { useVaultBurn } from '@/hooks/positions/uniswapv3-vault/useVaultBurn';
import { useUniswapV3VaultRefreshPosition } from '@/hooks/positions/uniswapv3-vault/useUniswapV3VaultRefreshPosition';
import { AddToPortfolioSection } from '@/components/positions/wizard/create-position/uniswapv3/shared/AddToPortfolioSection';
import { getChainSlugByChainId } from '@/config/chains';

export function TransactionStep() {
  const { state } = useVaultWithdrawWizard();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string })?.returnTo || '/dashboard';
  const { address: walletAddress, isConnected } = useAccount();
  const walletChainId = useChainId();

  const position = state.position;
  const config = position?.config as UniswapV3VaultPositionConfigResponse | undefined;
  const positionState = position?.state as UniswapV3VaultPositionStateResponse | undefined;
  const poolChainId = config?.chainId ?? 1;
  const chainSlug = getChainSlugByChainId(poolChainId);
  const isWrongNetwork = isConnected && walletChainId !== poolChainId;
  const isWrongAccount = !!(
    isConnected &&
    walletAddress &&
    config?.ownerAddress &&
    walletAddress.toLowerCase() !== config.ownerAddress.toLowerCase()
  );

  // Calculate shares to burn from context state
  const sharesToBurn = useMemo(() => {
    if (!positionState) return 0n;
    return BigInt(positionState.sharesBalance) * BigInt(Math.floor(state.withdrawPercent * 100)) / 10000n;
  }, [positionState, state.withdrawPercent]);

  // Expected amounts from quoteBurn (set by ConfigureStep)
  const expectedAmount0 = useMemo(() => {
    return state.quotedAmounts ? BigInt(state.quotedAmounts.amount0) : 0n;
  }, [state.quotedAmounts]);

  const expectedAmount1 = useMemo(() => {
    return state.quotedAmounts ? BigInt(state.quotedAmounts.amount1) : 0n;
  }, [state.quotedAmounts]);

  // Prepare vault burn parameters
  const burnParams = useMemo(() => {
    if (!config || !walletAddress || sharesToBurn === 0n || isWrongNetwork || isWrongAccount) return null;

    return {
      vaultAddress: config.vaultAddress as Address,
      shares: sharesToBurn,
      expectedAmount0,
      expectedAmount1,
      chainId: poolChainId,
      slippageBps: 100,
    };
  }, [config, walletAddress, sharesToBurn, expectedAmount0, expectedAmount1, poolChainId, isWrongNetwork, isWrongAccount]);

  const vaultBurn = useVaultBurn(burnParams);

  const refreshPosition = useUniswapV3VaultRefreshPosition();

  useEffect(() => {
    if (
      vaultBurn.isSuccess &&
      config &&
      !refreshPosition.isPending &&
      !refreshPosition.isSuccess
    ) {
      refreshPosition.mutate({ chainId: poolChainId, vaultAddress: config.vaultAddress });
    }
  }, [vaultBurn.isSuccess, config, poolChainId, refreshPosition]);

  // Transaction prompt
  const withdrawPrompt = useEvmTransactionPrompt({
    label: 'Burn Vault Shares',
    buttonLabel: 'Execute',
    retryButtonLabel: 'Retry',
    chainId: poolChainId,
    enabled: !!burnParams,
    showActionButton: isConnected && !isWrongNetwork && !isWrongAccount,
    txHash: vaultBurn.withdrawTxHash,
    isSubmitting: vaultBurn.isWithdrawing,
    isWaitingForConfirmation: vaultBurn.isWaitingForWithdraw,
    isSuccess: vaultBurn.isSuccess,
    error: vaultBurn.withdrawError,
    revertMessage: 'The pool price likely moved beyond slippage tolerance. Click Retry to re-attempt the withdrawal.',
    onExecute: () => vaultBurn.withdraw(),
    onReset: () => vaultBurn.reset(),
  });

  // Handle finish — navigate back to origin page
  const handleFinish = useCallback(() => {
    navigate(returnTo, { replace: true });
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

    if (isWrongAccount && config?.ownerAddress) {
      return (
        <div className="space-y-6">
          <h3 className="text-lg font-semibold text-white">Execute Transaction</h3>
          <EvmAccountSwitchPrompt>
            <p className="text-sm text-slate-400">
              Vault Owner: {config.ownerAddress.slice(0, 6)}...{config.ownerAddress.slice(-4)}
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

          {/* 2. Update position in portfolio */}
          {vaultBurn.isSuccess && (
            <AddToPortfolioSection
              isPending={refreshPosition.isPending}
              isSuccess={refreshPosition.isSuccess}
              isError={refreshPosition.isError}
              error={refreshPosition.error instanceof Error ? refreshPosition.error : null}
              label="Updating the position in your portfolio"
              onRetry={() => {
                if (config) {
                  refreshPosition.mutate({ chainId: poolChainId, vaultAddress: config.vaultAddress });
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
    <VaultWithdrawWizardSummaryPanel
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
