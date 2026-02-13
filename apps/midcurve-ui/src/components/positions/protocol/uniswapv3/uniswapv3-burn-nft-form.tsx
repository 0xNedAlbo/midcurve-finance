'use client';

import { useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { useAccount } from 'wagmi';
import type { UniswapV3PositionData } from '@/hooks/positions/uniswapv3/useUniswapV3Position';
import type { EvmChainSlug } from '@/config/chains';
import { CHAIN_METADATA } from '@/config/chains';
import { useBurnPosition } from '@/hooks/positions/uniswapv3/useBurnPosition';
import { EvmSwitchNetworkPrompt } from '@/components/common/EvmSwitchNetworkPrompt';
import { TransactionStep } from '@/components/positions/TransactionStep';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { EvmAccountSwitchPrompt } from '@/components/common/EvmAccountSwitchPrompt';
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

  const burnPosition = useBurnPosition({
    tokenId: BigInt(config.nftId),
    chainId: config.chainId,
  });

  useEffect(() => {
    burnPosition.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (burnPosition.burnSuccess) {
      onBurnSuccess?.();
    }
  }, [burnPosition.burnSuccess, onBurnSuccess]);

  if (!chain || !chainConfig) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400">
          Invalid chain configuration: Chain ID {config.chainId}
        </p>
      </div>
    );
  }

  const isWrongNetwork = !!(
    isConnected &&
    connectedChainId !== chainConfig.chainId
  );

  const isWrongAccount = !!(
    isConnected &&
    walletAddress &&
    state.ownerAddress &&
    walletAddress.toLowerCase() !== state.ownerAddress.toLowerCase()
  );

  const canBurn = isConnected && !isWrongNetwork && !isWrongAccount;

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
        <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-white mb-4">Transaction</h3>
          <div className="space-y-3">
            <TransactionStep
              title="Burn NFT"
              description="Destroy the position NFT on-chain"
              isLoading={burnPosition.isBurning || burnPosition.isWaitingForBurn}
              isComplete={burnPosition.burnSuccess}
              isDisabled={
                !canBurn ||
                burnPosition.isBurning ||
                burnPosition.isWaitingForBurn ||
                burnPosition.burnSuccess
              }
              onExecute={() => burnPosition.burn()}
              showExecute={!burnPosition.burnSuccess}
              transactionHash={burnPosition.burnTxHash}
              chain={chain}
            />
          </div>

          {/* Error Display */}
          {burnPosition.burnError && (
            <div className="mt-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <div>
                  <h5 className="text-red-400 font-medium">Transaction Error</h5>
                  <p className="text-red-200/80 text-sm mt-1">
                    {burnPosition.burnError.message}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Finish Button */}
      {burnPosition.burnSuccess && (
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
