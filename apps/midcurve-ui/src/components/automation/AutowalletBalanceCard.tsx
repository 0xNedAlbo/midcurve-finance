/**
 * Autowallet Balance Card
 *
 * Displays the balance for a single chain with fund and refund buttons.
 * Fetches balance client-side using wagmi.
 */

import { useBalance } from 'wagmi';
import { getChainMetadataByChainId } from '@/config/chains';
import { formatCompactValue } from '@/lib/fraction-format';

interface AutowalletBalanceCardProps {
  chainId: number;
  autowalletAddress: `0x${string}`;
  symbol: string;
  onFund: () => void;
  onRefund: (balance: string) => void;
}

export function AutowalletBalanceCard({
  chainId,
  autowalletAddress,
  symbol,
  onFund,
  onRefund,
}: AutowalletBalanceCardProps) {
  const chainMetadata = getChainMetadataByChainId(chainId);

  // Fetch balance client-side
  const { data: balanceData, isLoading } = useBalance({
    address: autowalletAddress,
    chainId,
  });

  const hasBalance = balanceData && balanceData.value > 0n;
  const formattedBalance = balanceData
    ? formatCompactValue(balanceData.value, balanceData.decimals)
    : '0';

  return (
    <div className="flex items-center justify-between py-3 px-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
      <div className="flex items-center gap-3">
        {/* Chain icon placeholder */}
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm font-medium">
          {chainMetadata?.shortName?.charAt(0) || '?'}
        </div>

        <div>
          <p className="text-sm font-medium text-slate-200">
            {chainMetadata?.shortName || `Chain ${chainId}`}
          </p>
          <p className="text-xs text-slate-400">
            {isLoading ? (
              <span className="text-slate-500">Loading...</span>
            ) : (
              `${formattedBalance} ${symbol}`
            )}
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
            onClick={() => onRefund(balanceData?.value.toString() ?? '0')}
            className="px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-slate-300 hover:bg-slate-700/50 rounded transition-colors cursor-pointer"
          >
            Refund
          </button>
        )}
      </div>
    </div>
  );
}
