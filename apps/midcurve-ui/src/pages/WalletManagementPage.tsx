/**
 * Wallet Management Page
 *
 * Full-page view for managing user wallet perimeter.
 * Supports wallet-type tabs (EVM now, Solana/Bitcoin future).
 */

import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../providers/AuthProvider';
import { EvmWalletTab } from '../components/wallets';
import { queryKeys } from '../lib/query-keys';
import { ArrowLeft, Wallet, RefreshCw } from 'lucide-react';

type WalletTab = 'evm' | 'solana' | 'bitcoin';

const TABS: { id: WalletTab; label: string; enabled: boolean }[] = [
  { id: 'evm', label: 'EVM', enabled: true },
  { id: 'solana', label: 'Solana', enabled: false },
  { id: 'bitcoin', label: 'Bitcoin', enabled: false },
];

export function WalletManagementPage() {
  const { user, status } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Read tab from URL, default to 'evm'
  const rawTab = searchParams.get('tab');
  const activeTab: WalletTab = (
    rawTab === 'solana' || rawTab === 'bitcoin' ? rawTab : 'evm'
  );

  const handleTabChange = (tab: WalletTab) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    setSearchParams(params);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: queryKeys.user.wallets() });
    setIsRefreshing(false);
  };

  // Auth redirect
  useEffect(() => {
    if (status === 'unauthenticated' || (!user && status !== 'loading')) {
      navigate('/?modal=signin');
    }
  }, [status, user, navigate]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  if (status === 'unauthenticated' || !user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      {/* Header */}
      <div className="bg-slate-800/50 border-b border-slate-700/50">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-4 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <Wallet className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-white">Wallet Management</h1>
                <p className="text-sm text-slate-400">
                  Manage your wallet perimeter for position tracking and PnL attribution
                </p>
              </div>
            </div>

            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="p-2 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Wallet Type Tabs */}
        <div className="flex border-b border-slate-700/50 mb-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => tab.enabled && handleTabChange(tab.id)}
              disabled={!tab.enabled}
              className={`px-4 py-3 font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-blue-400 border-b-2 border-blue-400 -mb-px cursor-pointer'
                  : tab.enabled
                    ? 'text-slate-400 hover:text-slate-200 cursor-pointer'
                    : 'text-slate-600 cursor-not-allowed'
              }`}
            >
              {tab.label}
              {!tab.enabled && (
                <span className="text-xs text-slate-600 ml-1">(Soon)</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'evm' && <EvmWalletTab />}
        {activeTab === 'solana' && (
          <div className="text-center py-16 text-slate-500">
            Solana wallet support coming soon
          </div>
        )}
        {activeTab === 'bitcoin' && (
          <div className="text-center py-16 text-slate-500">
            Bitcoin wallet support coming soon
          </div>
        )}
      </div>
    </div>
  );
}
