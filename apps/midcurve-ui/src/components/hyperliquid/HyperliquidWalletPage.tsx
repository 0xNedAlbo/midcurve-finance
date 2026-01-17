/**
 * Hyperliquid Wallet Page Component
 *
 * Displays the user's Hyperliquid API wallet with:
 * - Instructions for creating API wallet on hyperliquid.xyz
 * - Private key import form
 * - Wallet address display
 * - Delete wallet option
 *
 * Unlike automation wallets (generated), Hyperliquid wallets are imported
 * from user-provided private keys created on hyperliquid.xyz.
 */

import { useState } from 'react';
import { Copy, Check, Wallet, ArrowLeft, RefreshCw, Loader2, ExternalLink, Eye, EyeOff, Trash2, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useHyperliquidWallet, useImportHyperliquidWallet, useDeleteHyperliquidWallet } from '@/hooks/hyperliquid';

/**
 * Validate private key format (0x + 64 hex chars)
 */
function isValidPrivateKey(key: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(key);
}

export function HyperliquidWalletPage() {
  const navigate = useNavigate();
  const { data: wallet, isLoading, refetch, isRefetching } = useHyperliquidWallet();
  const { mutate: importWallet, isPending: isImporting } = useImportHyperliquidWallet();
  const { mutate: deleteWallet, isPending: isDeleting } = useDeleteHyperliquidWallet();

  const [copied, setCopied] = useState(false);
  const [privateKey, setPrivateKey] = useState('');
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [validityDays, setValidityDays] = useState<string>('');
  const [importError, setImportError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleCopyAddress = async () => {
    if (!wallet?.address) return;
    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleImport = () => {
    setImportError(null);

    if (!isValidPrivateKey(privateKey)) {
      setImportError('Invalid private key format. Expected 0x followed by 64 hex characters.');
      return;
    }

    // Parse validity days if provided
    const parsedValidityDays = validityDays ? parseInt(validityDays, 10) : undefined;
    if (parsedValidityDays !== undefined && (isNaN(parsedValidityDays) || parsedValidityDays < 1 || parsedValidityDays > 180)) {
      setImportError('Validity days must be between 1 and 180.');
      return;
    }

    importWallet(
      { privateKey, validityDays: parsedValidityDays },
      {
        onSuccess: () => {
          setPrivateKey('');
          setShowPrivateKey(false);
          setValidityDays('');
        },
        onError: (error) => {
          setImportError(error.message || 'Failed to import wallet');
        },
      }
    );
  };

  const handleDelete = () => {
    deleteWallet(undefined, {
      onSuccess: () => {
        setShowDeleteConfirm(false);
      },
      onError: (error) => {
        console.error('Failed to delete wallet:', error);
      },
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      {/* Header */}
      <div className="bg-slate-800/50 border-b border-slate-700/50">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-4 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
                <Wallet className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-white">Hyperliquid Wallet</h1>
                <p className="text-sm text-slate-400">
                  Trade on Hyperliquid to hedge your positions
                </p>
              </div>
            </div>

            <button
              onClick={() => refetch()}
              disabled={isRefetching}
              className="p-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-5 h-5 ${isRefetching ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !wallet ? (
          /* Empty State - Import Wallet */
          <div className="space-y-6">
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
              <div className="text-center mb-6">
                <div className="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center mx-auto mb-4">
                  <Wallet className="w-8 h-8 text-slate-500" />
                </div>
                <h2 className="text-lg font-medium text-white mb-2">Import Hyperliquid Wallet</h2>
                <p className="text-sm text-slate-400 max-w-md mx-auto">
                  Connect your Hyperliquid API wallet to enable automated hedging.
                </p>
              </div>

              {/* Instructions */}
              <div className="bg-slate-900/50 rounded-lg p-4 mb-6">
                <h3 className="text-sm font-medium text-white mb-3">Setup Instructions</h3>
                <ol className="space-y-2 text-sm text-slate-400">
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 font-medium">1.</span>
                    <span>
                      Go to{' '}
                      <a
                        href="https://app.hyperliquid.xyz/API"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-green-400 hover:text-green-300 underline cursor-pointer"
                      >
                        hyperliquid.xyz/API
                        <ExternalLink className="w-3 h-3 inline ml-1" />
                      </a>
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 font-medium">2.</span>
                    <span>Create a new API wallet in the API section</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 font-medium">3.</span>
                    <span>Copy the private key (shown only once!)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-green-400 font-medium">4.</span>
                    <span>Paste it below to import your wallet</span>
                  </li>
                </ol>
              </div>

              {/* Import Form */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    Private Key
                  </label>
                  <div className="relative">
                    <input
                      type={showPrivateKey ? 'text' : 'password'}
                      value={privateKey}
                      onChange={(e) => {
                        setPrivateKey(e.target.value);
                        setImportError(null);
                      }}
                      placeholder="0x..."
                      className="w-full px-4 py-3 pr-12 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPrivateKey(!showPrivateKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                    >
                      {showPrivateKey ? (
                        <EyeOff className="w-5 h-5" />
                      ) : (
                        <Eye className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Validity Days (optional) */}
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    Wallet Validity (optional)
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min="1"
                      max="180"
                      value={validityDays}
                      onChange={(e) => {
                        setValidityDays(e.target.value);
                        setImportError(null);
                      }}
                      placeholder="Days"
                      className="w-32 px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm"
                    />
                    <span className="text-sm text-slate-500">days (max 180)</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Hyperliquid API wallets can expire. If you set a validity period, we'll notify you 5 days before expiry and on the expiry date. Expired wallets cannot execute hedges.
                  </p>
                </div>

                {importError && (
                  <p className="text-sm text-red-400">{importError}</p>
                )}

                <button
                  onClick={handleImport}
                  disabled={isImporting || !privateKey}
                  className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    'Import Wallet'
                  )}
                </button>
              </div>

              {/* Security Note */}
              <p className="text-xs text-slate-500 mt-4 text-center">
                Your private key is encrypted and stored securely. We never have access to your main Hyperliquid account.
              </p>
            </div>
          </div>
        ) : (
          /* Wallet Exists State */
          <div className="space-y-6">
            {/* Wallet Address */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
              <h2 className="text-sm font-medium text-slate-400 mb-3">Wallet Address</h2>
              <div className="flex items-center gap-3">
                <code className="flex-1 text-sm font-mono text-white bg-slate-800/50 px-4 py-3 rounded-lg overflow-hidden text-ellipsis">
                  {wallet.address}
                </code>
                <button
                  onClick={handleCopyAddress}
                  className="p-3 text-slate-400 hover:text-white bg-slate-800/50 rounded-lg transition-colors cursor-pointer"
                >
                  {copied ? <Check className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>

              {/* Metadata */}
              <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                <span>Created: {new Date(wallet.createdAt).toLocaleDateString()}</span>
                {wallet.validUntil && (
                  <span>Valid until: {new Date(wallet.validUntil).toLocaleDateString()}</span>
                )}
                {wallet.lastUsedAt && (
                  <span>Last used: {new Date(wallet.lastUsedAt).toLocaleDateString()}</span>
                )}
              </div>
            </div>

            {/* Funding Instructions */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
              <h2 className="text-sm font-medium text-slate-400 mb-3">Funding</h2>
              <p className="text-sm text-slate-300 mb-4">
                Fund your API wallet on Hyperliquid to enable hedging. Midcurve cannot deposit or withdraw funds for you.
              </p>
              <a
                href="https://app.hyperliquid.xyz/portfolio"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-green-400 hover:text-green-300 text-sm cursor-pointer"
              >
                <span>Open Hyperliquid Portfolio</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>

            {/* Danger Zone */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-red-900/30 p-6">
              <h2 className="text-sm font-medium text-red-400 mb-3">Danger Zone</h2>
              <p className="text-sm text-slate-400 mb-4">
                Deleting your wallet will disable hedging functionality. You can import a new wallet later.
              </p>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded-lg text-sm transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                Delete Wallet
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <h3 className="text-lg font-medium text-white">Delete Hyperliquid Wallet?</h3>
            </div>

            <p className="text-sm text-slate-400 mb-6">
              This will remove your Hyperliquid API wallet from Midcurve. Any active hedging will be disabled.
              Your funds on Hyperliquid will not be affected.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete Wallet'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
