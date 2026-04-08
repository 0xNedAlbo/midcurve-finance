/**
 * EVM Wallet Tab
 *
 * Shows the connected wallet with option to add it,
 * and lists all user-owned EVM wallets with remove option.
 */

import { useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { compareAddresses } from '@midcurve/shared';
import { useUserWallets, useAddWallet, useDeleteWallet } from '../../hooks/wallets';
import { WalletAvatar } from '../ui/wallet-avatar';
import { EvmWalletConnectionPrompt } from '../common/EvmWalletConnectionPrompt';
import { Plus, Trash2, Shield, CheckCircle, Loader2, AlertCircle } from 'lucide-react';

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function EvmWalletTab() {
  const { address: connectedAddress, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { data: walletsData, isLoading: isLoadingWallets } = useUserWallets();
  const addWallet = useAddWallet();
  const deleteWallet = useDeleteWallet();
  const [walletToDelete, setWalletToDelete] = useState<string | null>(null);

  const evmWallets = walletsData?.wallets.filter((w) => w.walletType === 'evm') ?? [];

  // Check if the connected wallet is already in the user's list
  const isConnectedWalletRegistered = connectedAddress
    ? evmWallets.some((w) => {
        const walletAddress = (w.config as { address?: string }).address;
        return walletAddress && compareAddresses(walletAddress, connectedAddress) === 0;
      })
    : false;

  const handleAddConnectedWallet = () => {
    if (!connectedAddress) return;
    addWallet.mutate({
      walletType: 'evm',
      address: connectedAddress,
      signMessageAsync,
    });
  };

  const handleDeleteWallet = (walletId: string) => {
    setWalletToDelete(null);
    deleteWallet.mutate(walletId);
  };

  return (
    <div className="space-y-8">
      {/* Connected Wallet Section */}
      <section>
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">
          Connected Wallet
        </h2>

        {!isConnected ? (
          <EvmWalletConnectionPrompt
            title="No Wallet Connected"
            description="Connect your wallet to add it to your wallet perimeter"
          />
        ) : (
          <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg px-3 py-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <WalletAvatar address={connectedAddress!} size={28} />
                <div>
                  <p className="text-sm text-white font-medium">
                    {shortenAddress(connectedAddress!)}
                  </p>
                  <p className="text-xs text-slate-400 font-mono">
                    {connectedAddress}
                  </p>
                </div>
              </div>

              {isConnectedWalletRegistered ? (
                <div className="flex items-center gap-2 text-sm text-green-400">
                  <CheckCircle className="w-4 h-4" />
                  In your wallets
                </div>
              ) : (
                <button
                  onClick={handleAddConnectedWallet}
                  disabled={addWallet.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white text-sm font-medium rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  {addWallet.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Signing...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Add to My Wallets
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Error state */}
            {addWallet.isError && (
              <div className="mt-3 flex items-center gap-2 text-sm text-red-400">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {addWallet.error.message}
              </div>
            )}
          </div>
        )}
      </section>

      {/* My Wallets Section */}
      <section>
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-4">
          My Wallets
        </h2>

        {isLoadingWallets ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
          </div>
        ) : evmWallets.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <p>No wallets registered yet.</p>
            <p className="text-sm mt-1">
              Your primary wallet will be added automatically on your next sign-in.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {evmWallets.map((wallet) => {
              const walletAddress = (wallet.config as { address?: string }).address ?? '';
              return (
                <div
                  key={wallet.id}
                  className="flex items-center justify-between bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg px-3 py-2.5"
                >
                  <div className="flex items-center gap-2.5">
                    <WalletAvatar address={walletAddress} size={28} />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm text-white font-medium">
                          {shortenAddress(walletAddress)}
                        </p>
                        {wallet.isPrimary && (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs font-medium rounded-full">
                            <Shield className="w-3 h-3" />
                            Primary
                          </span>
                        )}
                        {wallet.label && (
                          <span className="text-xs text-slate-500">{wallet.label}</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 font-mono">{walletAddress}</p>
                    </div>
                  </div>

                  {/* Delete button — not available for primary wallet */}
                  {!wallet.isPrimary && (
                    <div className="relative">
                      {walletToDelete === wallet.id ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleDeleteWallet(wallet.id)}
                            disabled={deleteWallet.isPending}
                            className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer"
                          >
                            {deleteWallet.isPending ? 'Removing...' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setWalletToDelete(null)}
                            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium rounded-lg transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setWalletToDelete(wallet.id)}
                          className="p-2 text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                          title="Remove wallet"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Delete error */}
        {deleteWallet.isError && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-400">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {deleteWallet.error.message}
          </div>
        )}
      </section>
    </div>
  );
}
