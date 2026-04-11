'use client';

import { useMemo, useEffect } from 'react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { formatCompactValue } from '@/lib/fraction-format';
import type { UniswapV3VaultPositionData } from '@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition';
import type {
  UniswapV3VaultPositionConfigResponse,
  UniswapV3VaultPositionStateResponse,
} from '@midcurve/api-shared';
import type { EvmChainSlug } from '@/config/chains';
import { CHAIN_METADATA } from '@/config/chains';
import { useVaultCollectFees } from '@/hooks/positions/uniswapv3-vault/useVaultCollectFees';
import { useUniswapV3VaultRefreshPosition } from '@/hooks/positions/uniswapv3-vault/useUniswapV3VaultRefreshPosition';
import { EvmSwitchNetworkPrompt } from '@/components/common/EvmSwitchNetworkPrompt';
import { useEvmTransactionPrompt } from '@/components/common/EvmTransactionPrompt';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { AddToPortfolioSection } from '@/components/positions/wizard/create-position/uniswapv3/shared/AddToPortfolioSection';

interface UniswapV3VaultCollectFeesFormProps {
  position: UniswapV3VaultPositionData;
  onClose: () => void;
  onCollectSuccess?: () => void;
}

export function UniswapV3VaultCollectFeesForm({
  position,
  onClose,
  onCollectSuccess,
}: UniswapV3VaultCollectFeesFormProps) {
  const {
    isConnected,
    chainId: connectedChainId,
  } = useAccount();

  const config = position.config as UniswapV3VaultPositionConfigResponse;
  const state = position.state as UniswapV3VaultPositionStateResponse;

  const getChainSlugFromChainId = (chainId: number): EvmChainSlug | null => {
    const entry = Object.entries(CHAIN_METADATA).find(
      ([_, meta]) => meta.chainId === chainId
    );
    return entry ? (entry[0] as EvmChainSlug) : null;
  };

  const chain = getChainSlugFromChainId(config.chainId);
  const chainConfig = chain ? CHAIN_METADATA[chain] : null;

  const unclaimedFees = BigInt(position.unclaimedYield || '0');
  const token0Amount = BigInt(state.unclaimedFees0 || '0');
  const token1Amount = BigInt(state.unclaimedFees1 || '0');

  const baseTokenAmount = position.isToken0Quote ? token1Amount : token0Amount;
  const quoteTokenAmount = position.isToken0Quote ? token0Amount : token1Amount;

  const collectParams = useMemo(() => {
    if (!isConnected || unclaimedFees === 0n) return null;
    return {
      vaultAddress: config.vaultAddress as Address,
      chainId: config.chainId,
    };
  }, [isConnected, unclaimedFees, config.vaultAddress, config.chainId]);

  const collectFees = useVaultCollectFees(collectParams);

  const refreshPosition = useUniswapV3VaultRefreshPosition();

  useEffect(() => {
    if (collectFees.isSuccess && !refreshPosition.isPending && !refreshPosition.isSuccess) {
      refreshPosition.mutate({ chainId: config.chainId, vaultAddress: config.vaultAddress });
    }
  }, [collectFees.isSuccess, config.chainId, config.vaultAddress, refreshPosition]);

  const isWrongNetwork = !!(
    isConnected &&
    chainConfig &&
    connectedChainId !== chainConfig.chainId
  );

  // Backend determines ownership via authenticated session
  const isNotOwner = !state.isOwnedByUser;

  const canCollect =
    isConnected &&
    !isWrongNetwork &&
    !isNotOwner &&
    unclaimedFees > 0n;

  const collectFeesTx = useEvmTransactionPrompt({
    label: 'Collect Fees',
    buttonLabel: 'Collect',
    chainId: config.chainId,
    enabled: canCollect,
    txHash: collectFees.collectTxHash,
    isSubmitting: collectFees.isCollecting,
    isWaitingForConfirmation: collectFees.isWaitingForConfirmation,
    isSuccess: collectFees.isSuccess,
    error: collectFees.error,
    onExecute: () => collectFees.collect(),
    onReset: () => collectFees.reset(),
    onStatusChange: (status) => {
      if (status === 'success') onCollectSuccess?.();
    },
  });

  if (!chain || !chainConfig) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400">
          Invalid chain configuration: Chain ID {config.chainId}
        </p>
        <p className="text-slate-400 text-sm mt-2">
          This position&apos;s fees cannot be collected at this time.
        </p>
      </div>
    );
  }

  const baseToken = position.isToken0Quote ? position.pool.token1 : position.pool.token0;
  const quoteToken = position.isToken0Quote ? position.pool.token0 : position.pool.token1;

  return (
    <div className="space-y-3">
      {/* Fee Preview Section */}
      <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-300 font-medium">Unclaimed Fees</span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">{baseToken.symbol}</span>
            <div className="flex items-center gap-1.5">
              <span className="text-white font-medium">
                {formatCompactValue(baseTokenAmount, baseToken.decimals)}
              </span>
              {baseToken.logoUrl && (
                <img
                  src={baseToken.logoUrl}
                  alt={baseToken.symbol}
                  className="w-4 h-4 rounded-full"
                />
              )}
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">{quoteToken.symbol}</span>
            <div className="flex items-center gap-1.5">
              <span className="text-white font-medium">
                {formatCompactValue(quoteTokenAmount, quoteToken.decimals)}
              </span>
              {quoteToken.logoUrl && (
                <img
                  src={quoteToken.logoUrl}
                  alt={quoteToken.symbol}
                  className="w-4 h-4 rounded-full"
                />
              )}
            </div>
          </div>

          <div className="flex items-center justify-between text-sm pt-2 border-t border-slate-700/50">
            <span className="text-slate-300 font-medium">Total Value</span>
            <span className="text-amber-400 font-semibold text-lg">
              {formatCompactValue(unclaimedFees, quoteToken.decimals)}{' '}
              {quoteToken.symbol}
            </span>
          </div>
        </div>
      </div>

      {!isConnected && <EvmWalletConnectionPrompt />}

      {isConnected && !isNotOwner && (
        <EvmSwitchNetworkPrompt chain={chain} isWrongNetwork={isWrongNetwork} />
      )}

      {isConnected && !isNotOwner && (
        <div className="space-y-3">
          {collectFeesTx.element}
          {collectFeesTx.isSuccess && (
            <AddToPortfolioSection
              isPending={refreshPosition.isPending}
              isSuccess={refreshPosition.isSuccess}
              isError={refreshPosition.isError}
              error={refreshPosition.error instanceof Error ? refreshPosition.error : null}
              label="Updating the position in your portfolio"
            />
          )}
        </div>
      )}

      {collectFeesTx.isSuccess && refreshPosition.isSuccess && (
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer"
          >
            Finish
          </button>
        </div>
      )}
    </div>
  );
}
