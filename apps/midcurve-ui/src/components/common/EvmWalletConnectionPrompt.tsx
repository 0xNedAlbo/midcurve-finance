'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';

interface EvmWalletConnectionPromptProps {
  title?: string;
  description?: string;
}

/**
 * EVM Wallet Connection Prompt Component
 *
 * Displays a styled prompt for users to connect their EVM-compatible wallet.
 * Uses RainbowKit's custom button API to match the app's link styling.
 *
 * Usage:
 * - Display when user needs to connect wallet before performing an action
 * - Automatically styled to match the app's design system
 * - EVM-specific (uses RainbowKit for Ethereum-compatible wallets)
 */
export function EvmWalletConnectionPrompt({
  title = 'Connect Wallet',
  description = 'Please connect your wallet to continue',
}: EvmWalletConnectionPromptProps) {
  return (
    <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex-grow">
          <h3 className="text-lg font-semibold text-white mb-1">{title}</h3>
          <p className="text-sm text-slate-400">{description}</p>
        </div>
        <div className="ml-4">
          <ConnectButton.Custom>
            {({ openConnectModal }) => (
              <button
                onClick={openConnectModal}
                className="text-blue-400 hover:text-blue-300 font-medium transition-colors cursor-pointer underline"
              >
                Connect Wallet
              </button>
            )}
          </ConnectButton.Custom>
        </div>
      </div>
    </div>
  );
}
