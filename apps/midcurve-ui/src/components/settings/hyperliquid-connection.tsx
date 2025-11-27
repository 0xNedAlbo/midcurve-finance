"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle, XCircle, Trash2, Plus, Loader2, ExternalLink } from "lucide-react";
import {
  useHyperliquidWallets,
  useDeleteHyperliquidWallet,
} from "@/hooks/user/useHyperliquidWallets";
import { AddWalletForm } from "./add-wallet-form";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import type { HyperliquidWalletDisplay } from "@midcurve/api-shared";

/**
 * Calculate days until expiration
 */
function getDaysUntilExpiration(expiresAt: string): number {
  const now = new Date();
  const expiration = new Date(expiresAt);
  const diffMs = expiration.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Get expiration status: 'valid' | 'warning' | 'expired'
 */
function getExpirationStatus(expiresAt: string): "valid" | "warning" | "expired" {
  const days = getDaysUntilExpiration(expiresAt);
  if (days <= 0) return "expired";
  if (days <= 7) return "warning";
  return "valid";
}

/**
 * Format expiration text
 */
function formatExpiration(expiresAt: string): string {
  const days = getDaysUntilExpiration(expiresAt);
  if (days <= 0) return "Expired";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${days} days`;
}

interface WalletStatusCardProps {
  wallet: HyperliquidWalletDisplay;
  onDelete: () => void;
  isDeleting: boolean;
}

function WalletStatusCard({ wallet, onDelete, isDeleting }: WalletStatusCardProps) {
  const status = getExpirationStatus(wallet.expiresAt);
  const expirationText = formatExpiration(wallet.expiresAt);

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        {/* Wallet Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            {status === "valid" && (
              <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
            )}
            {status === "warning" && (
              <AlertTriangle className="w-5 h-5 text-yellow-400 flex-shrink-0" />
            )}
            {status === "expired" && (
              <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            )}
            <span className="text-white font-medium">{wallet.label}</span>
          </div>

          {/* Wallet Address */}
          <div className="flex items-center gap-2 mb-2">
            <code className="text-sm text-slate-300 font-mono bg-slate-900/50 px-2 py-1 rounded">
              {wallet.walletAddress}
            </code>
            <a
              href={`https://hyperliquid.xyz/account/${wallet.walletAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-blue-400 transition-colors cursor-pointer"
              title="View on Hyperliquid"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>

          {/* Expiration Status */}
          <p
            className={`text-sm ${
              status === "expired"
                ? "text-red-400"
                : status === "warning"
                ? "text-yellow-400"
                : "text-slate-400"
            }`}
          >
            {expirationText}
          </p>
        </div>

        {/* Delete Button */}
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          title="Remove wallet"
        >
          {isDeleting ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Trash2 className="w-5 h-5" />
          )}
        </button>
      </div>
    </div>
  );
}

export function HyperliquidConnection() {
  const [showAddForm, setShowAddForm] = useState(false);
  const [walletToDelete, setWalletToDelete] = useState<string | null>(null);

  const { data: wallets, isLoading, error } = useHyperliquidWallets();
  const deleteWallet = useDeleteHyperliquidWallet({
    onSuccess: () => {
      setWalletToDelete(null);
    },
    onError: () => {
      setWalletToDelete(null);
    },
  });

  const handleDeleteClick = (walletId: string) => {
    setWalletToDelete(walletId);
  };

  const handleConfirmDelete = () => {
    if (walletToDelete) {
      deleteWallet.mutate({ walletId: walletToDelete });
    }
  };

  const handleAddSuccess = () => {
    setShowAddForm(false);
  };

  // Get the active wallet (first one for now - can expand to support multiple later)
  const activeWallet = wallets?.find((w) => w.isActive);
  const hasWallet = !!activeWallet;

  return (
    <section className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-6">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">Hyperliquid Connection</h2>
          <p className="text-slate-400 text-sm">
            Connect your Hyperliquid API wallet to enable hedging features
          </p>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
          <span className="ml-2 text-slate-400">Loading wallets...</span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4 mb-4">
          <p className="text-red-400">Failed to load wallets: {error.message}</p>
        </div>
      )}

      {/* Content */}
      {!isLoading && !error && (
        <>
          {/* Connected Wallet */}
          {hasWallet && !showAddForm && (
            <WalletStatusCard
              wallet={activeWallet}
              onDelete={() => handleDeleteClick(activeWallet.id)}
              isDeleting={deleteWallet.isPending}
            />
          )}

          {/* No Wallet - Show Add Form or Button */}
          {!hasWallet && !showAddForm && (
            <div className="border-2 border-dashed border-slate-700 rounded-lg p-8 text-center">
              <div className="text-slate-400 mb-4">
                <Plus className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No Hyperliquid API wallet connected</p>
                <p className="text-sm text-slate-500 mt-1">
                  Add your API wallet private key to enable hedging
                </p>
              </div>
              <button
                onClick={() => setShowAddForm(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors cursor-pointer"
              >
                Add API Wallet
              </button>
            </div>
          )}

          {/* Add Form */}
          {showAddForm && (
            <AddWalletForm
              onSuccess={handleAddSuccess}
              onCancel={() => setShowAddForm(false)}
            />
          )}
        </>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={walletToDelete !== null}
        onClose={() => setWalletToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Remove API Wallet"
        message="Are you sure you want to remove this API wallet? This action cannot be undone and you will need to add a new wallet to use hedging features."
        confirmText="Remove Wallet"
        cancelText="Cancel"
        variant="danger"
        isLoading={deleteWallet.isPending}
      />
    </section>
  );
}
