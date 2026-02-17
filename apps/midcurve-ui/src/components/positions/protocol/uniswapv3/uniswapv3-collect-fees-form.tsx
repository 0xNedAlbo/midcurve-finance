'use client';

import { useMemo } from 'react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { normalizeAddress } from '@midcurve/shared';
import { formatCompactValue } from '@/lib/fraction-format';
import type { UniswapV3PositionData } from '@/hooks/positions/uniswapv3/useUniswapV3Position';
import type { EvmChainSlug } from '@/config/chains';
import { CHAIN_METADATA } from '@/config/chains';
import { useCollectFees } from '@/hooks/positions/uniswapv3/useCollectFees';
import { EvmSwitchNetworkPrompt } from '@/components/common/EvmSwitchNetworkPrompt';
import { useEvmTransactionPrompt } from '@/components/common/EvmTransactionPrompt';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { EvmAccountSwitchPrompt } from '@/components/common/EvmAccountSwitchPrompt';

interface UniswapV3CollectFeesFormProps {
  position: UniswapV3PositionData;
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
 * - On-chain collect transaction via EvmTransactionPrompt
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

  // Validate chain configuration (needed before canCollect)
  const isWrongNetwork = !!(
    isConnected &&
    chainConfig &&
    connectedChainId !== chainConfig.chainId
  );

  const isWrongAccount = !!(
    isConnected &&
    walletAddress &&
    state.ownerAddress &&
    walletAddress.toLowerCase() !== state.ownerAddress.toLowerCase()
  );

  const canCollect =
    isConnected &&
    !isWrongNetwork &&
    !isWrongAccount &&
    unclaimedFees > 0n;

  // Transaction prompt (MUST be called before any returns)
  const collectFeesTx = useEvmTransactionPrompt({
    label: 'Collect Fees',
    buttonLabel: 'Collect',
    chainId: config.chainId,
    enabled: canCollect,
    txHash: collectFees.receipt?.transactionHash,
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

  // Token info for display
  const baseToken = position.isToken0Quote ? position.pool.token1 : position.pool.token0;
  const quoteToken = position.isToken0Quote ? position.pool.token0 : position.pool.token1;

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
        <EvmSwitchNetworkPrompt chain={chain} isWrongNetwork={isWrongNetwork} />
      )}

      {/* Collect Fees Transaction */}
      {isConnected && !isWrongAccount && collectFeesTx.element}

      {/* Finish Button - Small green button at bottom right, only shown after collection completes */}
      {collectFeesTx.isSuccess && (
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
