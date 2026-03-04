'use client';

import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import type { UniswapV3PositionData } from '@/hooks/positions/uniswapv3/useUniswapV3Position';
import type { EvmChainSlug } from '@/config/chains';
import { CHAIN_METADATA } from '@/config/chains';
import { useBurnPosition } from '@/hooks/positions/uniswapv3/useBurnPosition';
import { useUniswapV3RefreshPosition } from '@/hooks/positions/uniswapv3/useUniswapV3RefreshPosition';
import { useEvmTransactionPrompt } from '@/components/common/EvmTransactionPrompt';
import { EvmSwitchNetworkPrompt } from '@/components/common/EvmSwitchNetworkPrompt';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { EvmAccountSwitchPrompt } from '@/components/common/EvmAccountSwitchPrompt';
import { AddToPortfolioSection } from '@/components/positions/wizard/create-position/uniswapv3/shared/AddToPortfolioSection';
import { InfoRow } from '../../info-row';
import { formatChainName } from '@/lib/position-helpers';

interface UniswapV3BurnNftFormProps {
  position: UniswapV3PositionData;
  onClose: () => void;
  onBurnSuccess?: () => void;
}

export function UniswapV3BurnNftForm({
  position,
  onClose,
  onBurnSuccess,
}: UniswapV3BurnNftFormProps) {
  const {
    address: walletAddress,
    isConnected,
    chainId: connectedChainId,
  } = useAccount();

  const config = position.config as { chainId: number; nftId: number };
  const state = position.state as { ownerAddress: string };

  const getChainSlugFromChainId = (chainId: number): EvmChainSlug | null => {
    const entry = Object.entries(CHAIN_METADATA).find(
      ([_, meta]) => meta.chainId === chainId
    );
    return entry ? (entry[0] as EvmChainSlug) : null;
  };

  const chain = getChainSlugFromChainId(config.chainId);
  const chainConfig = chain ? CHAIN_METADATA[chain] : null;

  const isWrongNetwork = !!(isConnected && chainConfig && connectedChainId !== chainConfig.chainId);
  const isWrongAccount = !!(
    isConnected &&
    walletAddress &&
    state.ownerAddress &&
    walletAddress.toLowerCase() !== state.ownerAddress.toLowerCase()
  );
  const canBurn = isConnected && !isWrongNetwork && !isWrongAccount;

  // All hooks must be called before any early returns
  const burnPosition = useBurnPosition({
    tokenId: BigInt(config.nftId),
    chainId: config.chainId,
  });

  const refreshPosition = useUniswapV3RefreshPosition();

  useEffect(() => {
    if (burnPosition.burnSuccess && !refreshPosition.isPending && !refreshPosition.isSuccess) {
      onBurnSuccess?.();
      refreshPosition.mutate({ chainId: config.chainId, nftId: config.nftId.toString() });
    }
  }, [burnPosition.burnSuccess, onBurnSuccess, config.chainId, config.nftId, refreshPosition]);

  const burnTx = useEvmTransactionPrompt({
    label: 'Burn NFT',
    buttonLabel: 'Burn',
    chainId: config.chainId,
    enabled: canBurn,
    txHash: burnPosition.burnTxHash,
    isSubmitting: burnPosition.isBurning,
    isWaitingForConfirmation: burnPosition.isWaitingForBurn,
    isSuccess: burnPosition.burnSuccess,
    error: burnPosition.burnError,
    onExecute: () => burnPosition.burn(),
    onReset: () => burnPosition.reset(),
  });

  if (!chain || !chainConfig) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400">
          Invalid chain configuration: Chain ID {config.chainId}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Description */}
      <p className="text-sm text-slate-300 leading-relaxed">
        Burning the position NFT will permanently destroy it on-chain. The
        position will no longer appear as active in your portfolio and cannot
        be reopened.
      </p>

      {/* Position Info */}
      <div className="bg-slate-700/30 rounded-lg p-4 space-y-2">
        <InfoRow label="NFT ID" value={`#${config.nftId}`} />
        <InfoRow
          label="Chain"
          value={formatChainName(config.chainId)}
          valueClassName="text-sm text-white"
        />
        <InfoRow
          label="Token Pair"
          value={`${position.pool.token0.symbol}/${position.pool.token1.symbol}`}
          valueClassName="text-sm text-white"
        />
      </div>

      {/* Wallet Connection */}
      {!isConnected && <EvmWalletConnectionPrompt />}

      {/* Account Switch */}
      {isConnected && isWrongAccount && state.ownerAddress && (
        <EvmAccountSwitchPrompt>
          <p className="text-sm text-slate-400">
            Position Owner: {state.ownerAddress.slice(0, 6)}...
            {state.ownerAddress.slice(-4)}
          </p>
        </EvmAccountSwitchPrompt>
      )}

      {/* Network Switch */}
      {isConnected && !isWrongAccount && (
        <EvmSwitchNetworkPrompt chain={chain} isWrongNetwork={isWrongNetwork} />
      )}

      {/* Transaction */}
      {isConnected && !isWrongAccount && (
        <div className="space-y-3">
          {burnTx.element}
          {burnTx.isSuccess && (
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

      {/* Finish Button */}
      {burnTx.isSuccess && (
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
