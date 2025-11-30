"use client";

import { useState } from "react";
import { CheckCircle, Plus, Loader2, ExternalLink, Wallet } from "lucide-react";
import {
  useAutomationWallet,
  useCreateAutomationWallet,
} from "@/hooks/user/useAutomationWallet";
import type { AutomationWalletDisplay } from "@midcurve/api-shared";

/**
 * Format date for display
 */
function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface WalletCardProps {
  wallet: AutomationWalletDisplay;
}

function WalletCard({ wallet }: WalletCardProps) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        {/* Wallet Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
            <span className="text-white font-medium">{wallet.label}</span>
          </div>

          {/* Wallet Address */}
          <div className="flex items-center gap-2 mb-2">
            <code className="text-sm text-slate-300 font-mono bg-slate-900/50 px-2 py-1 rounded">
              {wallet.walletAddress}
            </code>
            <a
              href={`https://etherscan.io/address/${wallet.walletAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-blue-400 transition-colors cursor-pointer"
              title="View on Etherscan"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>

          {/* Creation Date & Provider */}
          <div className="flex items-center gap-4 text-sm text-slate-400">
            <span>Created {formatDate(wallet.createdAt)}</span>
            <span className="text-slate-600">|</span>
            <span className="capitalize">
              {wallet.keyProvider === "aws-kms" ? "KMS-backed" : "Local dev"}
            </span>
          </div>
        </div>

        {/* Status Badge */}
        <div className="px-2 py-1 bg-green-900/30 text-green-400 text-xs font-medium rounded">
          Active
        </div>
      </div>
    </div>
  );
}

export function AutomationWalletSection() {
  const [isCreating, setIsCreating] = useState(false);

  const { data: wallet, isLoading, error } = useAutomationWallet();
  const createWallet = useCreateAutomationWallet({
    onSuccess: () => {
      setIsCreating(false);
    },
    onError: () => {
      setIsCreating(false);
    },
  });

  const handleCreateClick = () => {
    setIsCreating(true);
    createWallet.mutate(undefined);
  };

  const hasWallet = !!wallet;

  return (
    <section className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-6">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">Automation Wallet</h2>
          <p className="text-slate-400 text-sm">
            Secure KMS-backed wallet for automated strategy execution
          </p>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
          <span className="ml-2 text-slate-400">Loading wallet...</span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4 mb-4">
          <p className="text-red-400">Failed to load wallet: {error.message}</p>
        </div>
      )}

      {/* Content */}
      {!isLoading && !error && (
        <>
          {/* Has Wallet */}
          {hasWallet && <WalletCard wallet={wallet} />}

          {/* No Wallet - Show Create Button */}
          {!hasWallet && (
            <div className="border-2 border-dashed border-slate-700 rounded-lg p-8 text-center">
              <div className="text-slate-400 mb-4">
                <Wallet className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No automation wallet created</p>
                <p className="text-sm text-slate-500 mt-1">
                  Create a secure wallet for automated strategy execution
                </p>
              </div>
              <button
                onClick={handleCreateClick}
                disabled={isCreating || createWallet.isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {isCreating || createWallet.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating Wallet...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Create Automation Wallet
                  </>
                )}
              </button>
            </div>
          )}

          {/* Info Box */}
          <div className="mt-4 bg-slate-900/50 border border-slate-700/30 rounded-lg p-4">
            <h3 className="text-sm font-medium text-slate-300 mb-2">
              About Automation Wallets
            </h3>
            <ul className="text-sm text-slate-400 space-y-1 list-disc list-inside">
              <li>Private key is generated and stored in AWS KMS (Hardware Security Module)</li>
              <li>The key never leaves the secure hardware - all signing happens in KMS</li>
              <li>You can have one automation wallet per account</li>
              <li>Used for automated strategy execution without manual approval</li>
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
