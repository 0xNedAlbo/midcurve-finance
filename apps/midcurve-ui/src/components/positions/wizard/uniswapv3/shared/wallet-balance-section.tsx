'use client';

import { AlertCircle, Loader2 } from 'lucide-react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useSwitchChain } from 'wagmi';
import type { EvmChainSlug } from '@/config/chains';
import { formatCompactValue } from '@/lib/fraction-format';
import { CHAIN_METADATA } from '@/config/chains';

interface PoolData {
  token0: {
    address: string;
    symbol: string;
    decimals: number;
  };
  token1: {
    address: string;
    symbol: string;
    decimals: number;
  };
}

interface WalletBalanceSectionProps {
  pool: PoolData;
  baseTokenAddress: string;
  quoteTokenAddress: string;
  baseBalance: bigint;
  quoteBalance: bigint;
  baseBalanceLoading: boolean;
  quoteBalanceLoading: boolean;
  isConnected: boolean;
  isWrongNetwork: boolean;
  chain: EvmChainSlug;
}

/**
 * Displays wallet balance information and network switching UI
 *
 * Shows:
 * - Current wallet balances for both tokens
 * - Loading states while fetching balances
 * - Wrong network warning with switch button
 * - Connect wallet prompt if disconnected
 */
export function WalletBalanceSection({
  pool,
  baseTokenAddress,
  quoteTokenAddress,
  baseBalance,
  quoteBalance,
  baseBalanceLoading,
  quoteBalanceLoading,
  isConnected,
  isWrongNetwork,
  chain,
}: WalletBalanceSectionProps) {
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending: isSwitchingNetwork } = useSwitchChain();

  const chainConfig = CHAIN_METADATA[chain];
  const expectedChainName = chainConfig.name;
  const expectedChainId = chainConfig.chainId;

  // Get token data for display
  const baseTokenData =
    pool.token0.address.toLowerCase() === baseTokenAddress.toLowerCase()
      ? pool.token0
      : pool.token1;

  const quoteTokenData =
    pool.token0.address.toLowerCase() === quoteTokenAddress.toLowerCase()
      ? pool.token0
      : pool.token1;

  return (
    <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-300 font-medium">Wallet Balance</span>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              {isWrongNetwork ? (
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  <span className="text-amber-400 text-sm font-medium">
                    Wrong Network
                  </span>
                  <button
                    onClick={() => switchChain({ chainId: expectedChainId })}
                    disabled={isSwitchingNetwork}
                    className="text-amber-400 hover:text-amber-300 disabled:text-amber-400/50 underline decoration-dashed underline-offset-2 text-sm font-medium transition-colors flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isSwitchingNetwork ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Switching...
                      </>
                    ) : (
                      `Switch to ${expectedChainName}`
                    )}
                  </button>
                </div>
              ) : baseBalanceLoading || quoteBalanceLoading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                  <span className="text-slate-400 text-sm">Loading...</span>
                </div>
              ) : (
                <span className="text-white font-medium">
                  {formatCompactValue(baseBalance, baseTokenData.decimals)}{' '}
                  {baseTokenData.symbol} +{' '}
                  {formatCompactValue(quoteBalance, quoteTokenData.decimals)}{' '}
                  {quoteTokenData.symbol}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="text-slate-400 font-medium">
                -- {baseTokenData.symbol} + -- {quoteTokenData.symbol}
              </span>
              <button
                onClick={() => openConnectModal?.()}
                className="text-blue-400 hover:text-blue-300 text-xs font-medium transition-colors cursor-pointer ml-2"
              >
                Connect Wallet
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
