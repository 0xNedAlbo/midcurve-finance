'use client';

import { useSwitchChain } from 'wagmi';
import type { EvmChainSlug } from '@/config/chains';
import { CHAIN_METADATA } from '@/config/chains';

interface NetworkSwitchStepProps {
  chain: EvmChainSlug;
  isWrongNetwork: boolean;
}

/**
 * Network Switch Step Component
 *
 * Displays a compact notice when the user's wallet is connected to the wrong network
 * and provides a small button to switch to the correct network.
 * Uses a single-line layout matching the position size config pattern.
 */
export function NetworkSwitchStep({ chain, isWrongNetwork }: NetworkSwitchStepProps) {
  const { switchChain } = useSwitchChain();
  const chainConfig = CHAIN_METADATA[chain];

  if (!isWrongNetwork) {
    return null;
  }

  const handleSwitchNetwork = () => {
    if (chainConfig && switchChain) {
      switchChain({ chainId: chainConfig.chainId });
    }
  };

  return (
    <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-300">
          Wrong network. Please switch to {chainConfig.name}
        </span>
        <button
          onClick={handleSwitchNetwork}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded cursor-pointer transition-colors"
        >
          Switch
        </button>
      </div>
    </div>
  );
}
