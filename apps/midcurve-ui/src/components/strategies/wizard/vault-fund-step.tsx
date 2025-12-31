"use client";

import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2,
  CheckCircle,
  XCircle,
  Fuel,
  AlertCircle,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import type { Address } from "viem";
import { formatEther } from "viem";

import { useFundVault } from "@/hooks/strategies/useFundVault";
import { getChainMetadataByChainId } from "@/config/chains";

interface VaultFundStepProps {
  /** Vault contract address */
  vaultAddress: string;
  /** Chain ID where vault is deployed */
  vaultChainId: number;
  /** ETH amount to deposit (from configuration) */
  ethFundingAmount: string;
  /** Callback when funding is complete */
  onFundingComplete: () => void;
}

export function VaultFundStep({
  vaultAddress,
  vaultChainId,
  ethFundingAmount,
  onFundingComplete,
}: VaultFundStepProps) {
  const navigate = useNavigate();
  const { address: userAddress, isConnected } = useAccount();
  const currentChainId = useChainId();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();

  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Fund vault hook
  const {
    fund,
    reset: resetFund,
    status: fundStatus,
    error: fundError,
    result: fundResult,
    isPending: isFundPending,
    isSuccess: isFundSuccess,
  } = useFundVault();

  // Check if user is on correct chain
  const isWrongChain = currentChainId !== vaultChainId;

  // Get human-readable chain name
  const chainName = useMemo(() => {
    const meta = getChainMetadataByChainId(vaultChainId);
    return meta?.shortName || `Chain ${vaultChainId}`;
  }, [vaultChainId]);

  // Handle chain switch
  const handleSwitchChain = async () => {
    try {
      await switchChainAsync({ chainId: vaultChainId });
    } catch (error) {
      console.error("Failed to switch chain:", error);
    }
  };

  // Handle fund
  const handleFund = async () => {
    if (!userAddress) return;

    try {
      await fund({
        vaultAddress: vaultAddress as Address,
        chainId: vaultChainId,
        ethAmount: ethFundingAmount,
      });
    } catch (error) {
      console.error("Vault funding failed:", error);
    }
  };

  // Handle retry
  const handleRetry = () => {
    resetFund();
  };

  // Copy to clipboard
  const copyToClipboard = async (value: string, field: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Success state
  if (isFundSuccess && fundResult) {
    return (
      <div className="space-y-6">
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-6 text-center">
          <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Vault Funded Successfully!
          </h3>
          <p className="text-slate-300">
            Your vault is now ready. The automation wallet has {ethFundingAmount} ETH
            available for gas costs.
          </p>
        </div>

        {/* Vault Details */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg divide-y divide-slate-700/50">
          <div className="p-4">
            <label className="block text-xs text-slate-400 mb-1">
              Vault Address
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm text-white font-mono bg-slate-700/50 px-3 py-2 rounded truncate">
                {vaultAddress}
              </code>
              <button
                onClick={() => copyToClipboard(vaultAddress, "vault")}
                className="p-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Copy to clipboard"
              >
                {copiedField === "vault" ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
          <div className="p-4">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">ETH Deposited</span>
              <span className="text-white font-medium">
                {formatEther(fundResult.amountWei)} ETH
              </span>
            </div>
          </div>
          <div className="p-4">
            <label className="block text-xs text-slate-400 mb-1">
              Transaction Hash
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm text-white font-mono bg-slate-700/50 px-3 py-2 rounded truncate">
                {fundResult.txHash}
              </code>
              <button
                onClick={() => copyToClipboard(fundResult.txHash, "tx")}
                className="p-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Copy to clipboard"
              >
                {copiedField === "tx" ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* What's Next */}
        <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg p-4">
          <p className="text-slate-300 text-sm font-medium mb-2">Setup Complete!</p>
          <p className="text-slate-400 text-sm">
            Your strategy is now fully deployed and funded. You can view it on your
            dashboard, start it, and begin automated operations.
          </p>
        </div>

        {/* Navigation */}
        <div className="flex justify-center">
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium cursor-pointer"
          >
            View Dashboard
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (fundError && fundStatus === "error") {
    return (
      <div className="space-y-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 text-center">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Funding Failed
          </h3>
          <p className="text-slate-300 mb-4">{fundError.message}</p>
          <button
            onClick={handleRetry}
            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium cursor-pointer"
          >
            Try Again
          </button>
        </div>

        {/* Vault info - always shown so user knows the address */}
        <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
          <label className="block text-xs text-slate-400 mb-1">
            Vault Address
          </label>
          <code className="block text-sm text-white font-mono bg-slate-700/50 px-3 py-2 rounded truncate">
            {vaultAddress}
          </code>
          <p className="text-slate-500 text-xs mt-2">
            Your vault is deployed but needs ETH funding. You can fund it manually
            if needed.
          </p>
        </div>
      </div>
    );
  }

  // Funding in progress
  if (isFundPending) {
    const statusLabel =
      fundStatus === "switching_chain"
        ? "Switching network..."
        : fundStatus === "awaiting_signature"
          ? "Waiting for signature..."
          : fundStatus === "confirming"
            ? "Confirming transaction..."
            : "Processing...";

    return (
      <div className="space-y-6">
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-6 text-center">
          <div className="relative w-16 h-16 mx-auto mb-4">
            <Fuel className="w-16 h-16 text-blue-400/30" />
            <Loader2 className="w-8 h-8 text-blue-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin" />
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">
            Funding Vault
          </h3>
          <p className="text-slate-300">{statusLabel}</p>
        </div>

        <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg p-4">
          <div className="flex justify-between items-center text-sm">
            <span className="text-slate-400">Amount</span>
            <span className="text-white font-medium">{ethFundingAmount} ETH</span>
          </div>
        </div>
      </div>
    );
  }

  // Pre-fund state - show info and fund button
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Fuel className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-slate-300 text-sm">
              Fund your vault with ETH to cover automation gas costs.{" "}
              <span className="text-white font-medium">You will sign a transaction.</span>
            </p>
          </div>
        </div>
      </div>

      {/* Vault Details */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg divide-y divide-slate-700/50">
        <div className="p-4">
          <label className="block text-xs text-slate-400 mb-1">
            Vault Address
          </label>
          <code className="block text-sm text-white font-mono bg-slate-700/50 px-3 py-2 rounded truncate">
            {vaultAddress}
          </code>
        </div>
        <div className="p-4">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Chain</span>
            <span className="text-white">{chainName}</span>
          </div>
        </div>
        <div className="p-4">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">ETH to Deposit</span>
            <span className="text-white font-medium text-lg">
              {ethFundingAmount} ETH
            </span>
          </div>
        </div>
      </div>

      {/* Wrong Chain Warning */}
      {isWrongChain && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-yellow-200 text-sm font-medium mb-2">
                Wrong Network
              </p>
              <p className="text-slate-300 text-sm mb-3">
                Please switch to {chainName} to fund the vault.
              </p>
              <button
                onClick={handleSwitchChain}
                disabled={isSwitchingChain}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-600 text-white text-sm rounded-lg transition-colors cursor-pointer"
              >
                {isSwitchingChain ? "Switching..." : `Switch to ${chainName}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Not Connected Warning */}
      {!isConnected && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
            <p className="text-red-200 text-sm">
              Please connect your wallet to fund the vault.
            </p>
          </div>
        </div>
      )}

      {/* Info */}
      <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg p-4">
        <p className="text-slate-400 text-sm">
          This ETH will be used by the automation wallet to pay for gas when
          executing strategy operations. You can deposit more ETH later through
          the dashboard.
        </p>
      </div>

      {/* Fund Button */}
      <div className="flex justify-center">
        <button
          onClick={handleFund}
          disabled={!isConnected || isWrongChain}
          className="flex items-center gap-2 px-8 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium cursor-pointer"
        >
          <Fuel className="w-5 h-5" />
          Send {ethFundingAmount} ETH to Vault
        </button>
      </div>
    </div>
  );
}
