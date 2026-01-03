/**
 * Autowallet Page Component
 *
 * Displays the user's automation wallet with:
 * - Wallet address
 * - Balances per chain
 * - Fund and refund actions
 * - Recent activity
 */

import { useState } from 'react';
import { Copy, Check, Wallet, ArrowLeft, RefreshCw, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAutowallet, useCreateAutowallet } from '@/hooks/automation';
import { ALL_EVM_CHAINS, CHAIN_METADATA } from '@/config/chains';
import { AutowalletBalanceCard } from './AutowalletBalanceCard';
import { FundAutowalletModal } from './FundAutowalletModal';
import { RefundAutowalletModal } from './RefundAutowalletModal';

/**
 * Get native token symbol for a chain
 */
function getNativeSymbol(chainId: number): string {
  switch (chainId) {
    case 56:
      return 'BNB';
    case 137:
      return 'MATIC';
    default:
      return 'ETH';
  }
}

export function AutowalletPage() {
  const navigate = useNavigate();
  const { data: wallet, isLoading, refetch, isRefetching } = useAutowallet();
  const { mutate: createWallet, isPending: isCreating } = useCreateAutowallet();

  const [copied, setCopied] = useState(false);
  const [fundModalState, setFundModalState] = useState<{ isOpen: boolean; chainId: number | null }>({
    isOpen: false,
    chainId: null,
  });
  const [refundModalState, setRefundModalState] = useState<{
    isOpen: boolean;
    chainId: number | null;
    balance: string;
    symbol: string;
  }>({
    isOpen: false,
    chainId: null,
    balance: '0',
    symbol: 'ETH',
  });

  const handleCopyAddress = async () => {
    if (!wallet?.address) return;
    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFund = (chainId: number) => {
    setFundModalState({ isOpen: true, chainId });
  };

  const handleRefund = (chainId: number, balance: string, symbol: string) => {
    setRefundModalState({
      isOpen: true,
      chainId,
      balance,
      symbol,
    });
  };

  // Get all supported chain IDs with their symbols
  const allChains = ALL_EVM_CHAINS.map((slug) => ({
    chainId: CHAIN_METADATA[slug].chainId,
    symbol: getNativeSymbol(CHAIN_METADATA[slug].chainId),
  }));

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
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <Wallet className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-white">Automation Wallet</h1>
                <p className="text-sm text-slate-400">
                  Executes your close orders when price triggers
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
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !wallet?.address ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center mx-auto mb-4">
              <Wallet className="w-8 h-8 text-slate-500" />
            </div>
            <h2 className="text-lg font-medium text-white mb-2">No Automation Wallet</h2>
            <p className="text-sm text-slate-400 max-w-md mx-auto mb-6">
              Create an automation wallet to enable automated close orders on your positions.
            </p>
            <button
              onClick={() => createWallet()}
              disabled={isCreating}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Automation Wallet'
              )}
            </button>
          </div>
        ) : (
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
              <p className="text-xs text-slate-500 mt-2">
                This wallet is used as the operator for your close orders. Fund it with gas to
                enable automated execution.
              </p>
            </div>

            {/* Balances */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
              <h2 className="text-sm font-medium text-slate-400 mb-4">Balances by Chain</h2>
              <div className="space-y-2">
                {allChains.map((chain) => (
                  <AutowalletBalanceCard
                    key={chain.chainId}
                    chainId={chain.chainId}
                    autowalletAddress={wallet.address as `0x${string}`}
                    symbol={chain.symbol}
                    onFund={() => handleFund(chain.chainId)}
                    onRefund={(balance) => handleRefund(chain.chainId, balance, chain.symbol)}
                  />
                ))}
              </div>
            </div>

            {/* Recent Activity */}
            {wallet.recentActivity && wallet.recentActivity.length > 0 && (
              <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-6">
                <h2 className="text-sm font-medium text-slate-400 mb-4">Recent Activity</h2>
                <div className="space-y-3">
                  {wallet.recentActivity.map((activity, index) => (
                    <div
                      key={`${activity.txHash}-${index}`}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            activity.type === 'execution'
                              ? 'bg-blue-500'
                              : activity.type === 'fund'
                              ? 'bg-green-500'
                              : 'bg-yellow-500'
                          }`}
                        />
                        <span className="text-slate-300">
                          {activity.type === 'execution'
                            ? 'Executed close order'
                            : activity.type === 'fund'
                            ? 'Funded'
                            : 'Refunded'}
                        </span>
                      </div>
                      <span className="text-slate-500">
                        {new Date(activity.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fund Modal */}
      {fundModalState.chainId && wallet?.address && (
        <FundAutowalletModal
          isOpen={fundModalState.isOpen}
          onClose={() => setFundModalState({ isOpen: false, chainId: null })}
          autowalletAddress={wallet.address}
          chainId={fundModalState.chainId}
        />
      )}

      {/* Refund Modal */}
      {refundModalState.chainId && wallet?.address && (
        <RefundAutowalletModal
          isOpen={refundModalState.isOpen}
          onClose={() =>
            setRefundModalState({ isOpen: false, chainId: null, balance: '0', symbol: 'ETH' })
          }
          chainId={refundModalState.chainId}
          currentBalance={refundModalState.balance}
          symbol={refundModalState.symbol}
          autowalletAddress={wallet.address}
        />
      )}
    </div>
  );
}
