'use client';

import { useEffect, useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { normalizeAddress } from '@midcurve/shared';
import { formatCompactValue } from '@/lib/fraction-format';
import type { ListPositionData } from '@midcurve/api-shared';
import type { EvmChainSlug } from '@/config/chains';
import { CHAIN_METADATA } from '@/config/chains';
import { useCollectFees } from '@/hooks/positions/uniswapv3/useCollectFees';
import { useUpdatePositionWithEvents } from '@/hooks/positions/uniswapv3/useUpdatePositionWithEvents';
import { NetworkSwitchStep } from '@/components/positions/NetworkSwitchStep';
import { TransactionStep } from '@/components/positions/TransactionStep';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { EvmAccountSwitchPrompt } from '@/components/common/EvmAccountSwitchPrompt';

interface UniswapV3CollectFeesFormProps {
  position: ListPositionData;
  onClose: () => void;
  onCollectSuccess?: () => void;
}

/**
 * Uniswap V3 Collect Fees Form Component
 *
 * Allows users to collect accumulated fees from their Uniswap V3 position.
 * Features:
 * - Fee preview with token amounts + quote value
 * - Network validation
 * - On-chain collect transaction
 * - Automatic event seeding via PATCH endpoint
 * - Success/error handling
 */
export function UniswapV3CollectFeesForm({
  position,
  onClose,
  onCollectSuccess,
}: UniswapV3CollectFeesFormProps) {
  const {
    address: walletAddress,
    isConnected,
    chainId: connectedChainId,
  } = useAccount();

  const updateMutation = useUpdatePositionWithEvents();

  // Type assertion for config (we know it's Uniswap V3)
  const config = position.config as { chainId: number; nftId: number };
  const state = position.state as {
    ownerAddress: string;
    tokensOwed0: string;  // BigInt as string in API
    tokensOwed1: string;  // BigInt as string in API
    unclaimedFees0?: string;  // NEW - Optional for backward compatibility
    unclaimedFees1?: string;  // NEW - Optional for backward compatibility
  };

  // Map chainId to chain slug
  const getChainSlugFromChainId = (chainId: number): EvmChainSlug | null => {
    const entry = Object.entries(CHAIN_METADATA).find(
      ([_, meta]) => meta.chainId === chainId
    );
    return entry ? (entry[0] as EvmChainSlug) : null;
  };

  const chain = getChainSlugFromChainId(config.chainId);
  const chainConfig = chain ? CHAIN_METADATA[chain] : null;

  // Get unclaimed fees from position (total in quote tokens)
  const unclaimedFees = BigInt(position.unClaimedFees || '0');

  // Get individual token amounts from state (prefer unclaimedFees, fallback to tokensOwed)
  const token0Amount = BigInt(state.unclaimedFees0 || state.tokensOwed0 || '0');
  const token1Amount = BigInt(state.unclaimedFees1 || state.tokensOwed1 || '0');

  // Determine which is base/quote
  const baseTokenAmount = position.isToken0Quote ? token1Amount : token0Amount;
  const quoteTokenAmount = position.isToken0Quote ? token0Amount : token1Amount;

  // Prepare collect fees parameters (MUST be called before any returns)
  const collectParams = useMemo(() => {
    if (!walletAddress || unclaimedFees === 0n) {
      return null;
    }

    return {
      tokenId: BigInt(config.nftId),
      recipient: normalizeAddress(walletAddress) as Address,
      chainId: config.chainId,
    };
  }, [walletAddress, unclaimedFees, config.nftId, config.chainId]);

  // Collect fees hook (MUST be called before any returns)
  const collectFees = useCollectFees(collectParams);

  // Reset state when form opens (MUST be called before any returns)
  useEffect(() => {
    updateMutation.reset();
    collectFees.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Handle successful collection - seed events via PATCH endpoint (MUST be called before any returns)
  useEffect(() => {
    if (
      collectFees.isSuccess &&
      collectFees.receipt &&
      collectFees.collectedAmount0 !== undefined &&
      collectFees.collectedAmount1 !== undefined &&
      collectFees.collectLogIndex !== undefined &&
      !updateMutation.isPending &&
      !updateMutation.isSuccess
    ) {
      const normalizedWalletAddress = walletAddress
        ? normalizeAddress(walletAddress)
        : null;

      if (!normalizedWalletAddress) {
        console.error('Wallet address not available');
        return;
      }

      // Parse Collect event and seed via PATCH endpoint
      // Note: Transaction receipts don't include timestamps
      // Use current time as approximation - sync service will correct it later
      const collectEvent = {
        eventType: 'COLLECT' as const,
        timestamp: new Date().toISOString(),
        blockNumber: collectFees.receipt.blockNumber.toString(),
        transactionIndex: collectFees.receipt.transactionIndex,
        logIndex: collectFees.collectLogIndex,
        transactionHash: collectFees.receipt.transactionHash,
        amount0: collectFees.collectedAmount0.toString(),
        amount1: collectFees.collectedAmount1.toString(),
        recipient: normalizedWalletAddress,
      };

      updateMutation.mutate(
        {
          chainId: config.chainId,
          nftId: config.nftId.toString(),
          events: [collectEvent],
        },
        {
          onSuccess: () => {
            // Trigger success callback when position update completes
            onCollectSuccess?.();
          },
        }
      );
    }
  }, [
    collectFees.isSuccess,
    collectFees.receipt,
    collectFees.collectedAmount0,
    collectFees.collectedAmount1,
    collectFees.collectLogIndex,
    config.chainId,
    config.nftId,
    walletAddress,
    onCollectSuccess,
    updateMutation,
  ]);

  // Validate chain configuration
  if (!chain || !chainConfig) {
    console.error('Invalid chain configuration for chainId:', config.chainId);
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

  // Check if wallet is connected to the wrong network
  const isWrongNetwork = !!(
    isConnected &&
    connectedChainId !== chainConfig.chainId
  );

  // Check if connected wallet is the position owner
  const isWrongAccount = !!(
    isConnected &&
    walletAddress &&
    state.ownerAddress &&
    walletAddress.toLowerCase() !== state.ownerAddress.toLowerCase()
  );

  // Token info for display
  const baseToken = position.isToken0Quote ? position.pool.token1 : position.pool.token0;
  const quoteToken = position.isToken0Quote ? position.pool.token0 : position.pool.token1;

  // Handle collect execution
  const handleCollect = () => {
    collectFees.collect();
  };

  // Validation
  const canCollect =
    isConnected &&
    !isWrongNetwork &&
    !isWrongAccount &&
    unclaimedFees > 0n;

  return (
    <div className="space-y-3">
      {/* Fee Preview Section - Matching PositionSizeConfig header layout */}
      <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-4">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-300 font-medium">Unclaimed Fees</span>
          </div>

          {/* Base token amount */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">{baseToken.symbol}</span>
            <div className="flex items-center gap-1.5">
              <span className="text-white font-medium">
                {formatCompactValue(baseTokenAmount, baseToken.decimals)}
              </span>
              {baseToken.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={baseToken.logoUrl}
                  alt={baseToken.symbol}
                  className="w-4 h-4 rounded-full"
                />
              )}
            </div>
          </div>

          {/* Quote token amount */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">{quoteToken.symbol}</span>
            <div className="flex items-center gap-1.5">
              <span className="text-white font-medium">
                {formatCompactValue(quoteTokenAmount, quoteToken.decimals)}
              </span>
              {quoteToken.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={quoteToken.logoUrl}
                  alt={quoteToken.symbol}
                  className="w-4 h-4 rounded-full"
                />
              )}
            </div>
          </div>

          {/* Total value in quote token */}
          <div className="flex items-center justify-between text-sm pt-2 border-t border-slate-700/50">
            <span className="text-slate-300 font-medium">Total Value</span>
            <span className="text-amber-400 font-semibold text-lg">
              {formatCompactValue(unclaimedFees, quoteToken.decimals)}{' '}
              {quoteToken.symbol}
            </span>
          </div>
        </div>
      </div>

      {/* Wallet Connection Section */}
      {!isConnected && <EvmWalletConnectionPrompt />}

      {/* Account Switch Section */}
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
        <NetworkSwitchStep chain={chain} isWrongNetwork={isWrongNetwork} />
      )}

      {/* Transaction Steps */}
      {isConnected && !isWrongAccount && (
        <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-white mb-4">Transaction</h3>
          <div className="space-y-3">

            {/* Collect Fees Transaction */}
            <TransactionStep
              title="Collect Fees"
              description="Transfer all accumulated fees to your wallet"
              isLoading={
                collectFees.isCollecting || collectFees.isWaitingForConfirmation
              }
              isComplete={collectFees.isSuccess}
              isDisabled={!canCollect}
              onExecute={handleCollect}
              showExecute={!collectFees.isSuccess}
              transactionHash={collectFees.receipt?.transactionHash}
              chain={chain}
            />

            {/* Update Position (Backend) */}
            {collectFees.isSuccess && (
              <TransactionStep
                title="Update Position"
                description="Updating position data..."
                isLoading={updateMutation.isPending}
                isComplete={updateMutation.isSuccess}
                isDisabled={true}
                onExecute={() => {}}
                showExecute={false}
              />
            )}
          </div>

          {/* Error Display */}
          {collectFees.error && (
            <div className="mt-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <div>
                  <h5 className="text-red-400 font-medium">Transaction Error</h5>
                  <p className="text-red-200/80 text-sm mt-1">
                    {collectFees.error.message}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Finish Button - Small green button at bottom right, only shown after position update completes */}
      {updateMutation.isSuccess && (
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
