import type { MockPool } from '../context/CreatePositionWizardContext';

interface PoolTableProps {
  pools: MockPool[];
  selectedPoolId: string | null;
  onSelectPool: (pool: MockPool) => void;
  isLoading?: boolean;
}

export function PoolTable({
  pools,
  selectedPoolId,
  onSelectPool,
  isLoading = false,
}: PoolTableProps) {
  const formatCurrency = (value: number) => {
    if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `$${(value / 1_000).toFixed(1)}K`;
    }
    return `$${value.toFixed(0)}`;
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-slate-400">Loading pools...</div>
      </div>
    );
  }

  if (pools.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-slate-400">No pools found. Try different search criteria.</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <h3 className="text-lg font-semibold text-white mb-4">Available Pools</h3>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 bg-slate-800/90 backdrop-blur-sm">
            <tr className="border-b border-slate-700">
              <th className="pb-3 text-slate-400 font-medium">Pool</th>
              <th className="pb-3 text-slate-400 font-medium text-right">TVL</th>
              <th className="pb-3 text-slate-400 font-medium text-right">Volume 24h</th>
              <th className="pb-3 text-slate-400 font-medium text-right">Fees 24h</th>
              <th className="pb-3 text-slate-400 font-medium text-right">APR 7d</th>
            </tr>
          </thead>
          <tbody className="text-white">
            {pools.map((pool) => {
              const isSelected = pool.id === selectedPoolId;
              return (
                <tr
                  key={pool.id}
                  onClick={() => onSelectPool(pool)}
                  className={`border-b border-slate-700/50 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-blue-600/20 hover:bg-blue-600/30'
                      : 'hover:bg-slate-700/30'
                  }`}
                >
                  <td className="py-3">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {pool.token0.symbol} / {pool.token1.symbol}
                      </span>
                      <span className="text-sm text-slate-400">
                        {pool.chainName} • {pool.feeTier}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 text-right">{formatCurrency(pool.tvlUsd)}</td>
                  <td className="py-3 text-right">{formatCurrency(pool.volume24hUsd)}</td>
                  <td className="py-3 text-right">{formatCurrency(pool.fees24hUsd)}</td>
                  <td className="py-3 text-right text-green-400">
                    {formatPercent(pool.apr7d)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
