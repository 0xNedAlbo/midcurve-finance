/**
 * Autowallet Balance Card
 *
 * Displays the balance for a single chain with fund and refund buttons.
 */

import { formatUnits } from 'viem';
import { getChainMetadataByChainId } from '@/config/chains';
import type { AutowalletChainBalance } from '@midcurve/api-shared';

interface AutowalletBalanceCardProps {
  balance: AutowalletChainBalance;
  onFund: () => void;
  onRefund: () => void;
}

export function AutowalletBalanceCard({
  balance,
  onFund,
  onRefund,
}: AutowalletBalanceCardProps) {
  const chainMetadata = getChainMetadataByChainId(balance.chainId);
  const formattedBalance = formatUnits(BigInt(balance.balance), balance.decimals);
  const hasBalance = BigInt(balance.balance) > 0n;

  return (
    <div className="flex items-center justify-between py-3 px-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
      <div className="flex items-center gap-3">
        {/* Chain icon placeholder */}
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm font-medium">
          {chainMetadata?.shortName?.charAt(0) || '?'}
        </div>

        <div>
          <p className="text-sm font-medium text-slate-200">
            {chainMetadata?.shortName || `Chain ${balance.chainId}`}
          </p>
          <p className="text-xs text-slate-400">
            {parseFloat(formattedBalance).toFixed(6)} {balance.symbol}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onFund}
          className="px-3 py-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-900/20 rounded transition-colors cursor-pointer"
        >
          Fund
        </button>

        {hasBalance && (
          <button
            onClick={onRefund}
            className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-300 hover:bg-slate-700/50 rounded transition-colors cursor-pointer"
          >
            Refund
          </button>
        )}
      </div>
    </div>
  );
}
