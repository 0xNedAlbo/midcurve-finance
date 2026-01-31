import { useState } from 'react';
import { Star, ChevronUp, ChevronDown } from 'lucide-react';
import type { PoolSearchResultItem } from '@midcurve/api-shared';

type SortColumn = 'tvlUSD' | 'volume24hUSD' | 'fees24hUSD' | 'apr7d';
type SortDirection = 'asc' | 'desc';

interface PoolTableProps {
  pools: PoolSearchResultItem[];
  selectedPoolAddress: string | null;
  onSelectPool: (pool: PoolSearchResultItem) => void;
  onToggleFavorite?: (pool: PoolSearchResultItem) => void;
  isLoading?: boolean;
}

export function PoolTable({
  pools,
  selectedPoolAddress,
  onSelectPool,
  onToggleFavorite,
  isLoading = false,
}: PoolTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('tvlUSD');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const formatCurrency = (value: string | number) => {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    if (numValue >= 1_000_000) {
      return `$${(numValue / 1_000_000).toFixed(1)}M`;
    }
    if (numValue >= 1_000) {
      return `$${(numValue / 1_000).toFixed(1)}K`;
    }
    return `$${numValue.toFixed(0)}`;
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  const formatFeeTier = (feeTier: number) => {
    // feeTier is in basis points (e.g., 3000 = 0.3%)
    return `${(feeTier / 10000).toFixed(2)}%`;
  };

  /**
   * Check if APR warning should be shown
   * APR may be unreliable when pool has low/no liquidity, volume, or fees
   */
  const shouldShowAprWarning = (pool: PoolSearchResultItem): boolean => {
    const tvl = parseFloat(pool.tvlUSD) || 0;
    const volume = parseFloat(pool.volume24hUSD) || 0;
    const fees = parseFloat(pool.fees24hUSD) || 0;
    const apr = pool.apr7d || 0;

    // Warning if APR > 0 but pool metrics suggest unreliable data
    if (apr > 0 && tvl === 0) return true; // Empty pool
    if (apr > 0 && fees === 0) return true; // No recent fees
    if (volume === 0) return true; // No trading activity

    return false;
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // Toggle direction if clicking same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Default to descending for new column
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const getNumericValue = (pool: PoolSearchResultItem, column: SortColumn): number => {
    switch (column) {
      case 'tvlUSD':
        return parseFloat(pool.tvlUSD) || 0;
      case 'volume24hUSD':
        return parseFloat(pool.volume24hUSD) || 0;
      case 'fees24hUSD':
        return parseFloat(pool.fees24hUSD) || 0;
      case 'apr7d':
        return pool.apr7d || 0;
    }
  };

  // Sort pools with favorites at top, then by selected column
  const sortedPools = [...pools].sort((a, b) => {
    // Favorites always first
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;

    // Then sort by selected column
    const aValue = getNumericValue(a, sortColumn);
    const bValue = getNumericValue(b, sortColumn);

    if (sortDirection === 'asc') {
      return aValue - bValue;
    }
    return bValue - aValue;
  });

  const SortHeader = ({
    column,
    label,
    className = '',
  }: {
    column: SortColumn;
    label: string;
    className?: string;
  }) => {
    const isActive = sortColumn === column;
    return (
      <th
        onClick={() => handleSort(column)}
        className={`pb-3 font-medium cursor-pointer select-none transition-colors hover:text-slate-200 ${
          isActive ? 'text-blue-400' : 'text-slate-400'
        } ${className}`}
      >
        <div className="flex items-center justify-end gap-1">
          <span>{label}</span>
          <span className="w-4 h-4 flex items-center justify-center">
            {isActive ? (
              sortDirection === 'desc' ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronUp className="w-4 h-4" />
              )
            ) : (
              <ChevronDown className="w-4 h-4 opacity-0 group-hover:opacity-30" />
            )}
          </span>
        </div>
      </th>
    );
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
              <th className="pb-3 text-slate-400 font-medium w-10"></th>
              <th className="pb-3 text-slate-400 font-medium">Pool</th>
              <SortHeader column="tvlUSD" label="TVL" className="text-right" />
              <SortHeader column="volume24hUSD" label="Volume 24h" className="text-right" />
              <SortHeader column="fees24hUSD" label="Fees 24h" className="text-right" />
              <SortHeader column="apr7d" label="ø APR 7d" className="text-right" />
            </tr>
          </thead>
          <tbody className="text-white">
            {sortedPools.map((pool) => {
              const poolKey = `${pool.chainId}:${pool.poolAddress}`;
              const isSelected = pool.poolAddress === selectedPoolAddress;
              return (
                <tr
                  key={poolKey}
                  onClick={() => onSelectPool(pool)}
                  className={`border-b border-slate-700/50 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-blue-600/20 hover:bg-blue-600/30'
                      : 'hover:bg-slate-700/30'
                  }`}
                >
                  <td className="py-3 pl-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite?.(pool);
                      }}
                      className="p-1 hover:bg-slate-600/50 rounded transition-colors cursor-pointer"
                      title={pool.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <Star
                        className={`w-4 h-4 ${
                          pool.isFavorite
                            ? 'text-yellow-400 fill-yellow-400'
                            : 'text-slate-500 hover:text-yellow-400'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="py-3">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {pool.token0.symbol} / {pool.token1.symbol}
                      </span>
                      <span className="text-sm text-slate-400">
                        {pool.chainName} • {formatFeeTier(pool.feeTier)}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 text-right">{formatCurrency(pool.tvlUSD)}</td>
                  <td className="py-3 text-right">{formatCurrency(pool.volume24hUSD)}</td>
                  <td className="py-3 text-right">{formatCurrency(pool.fees24hUSD)}</td>
                  <td className="py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-green-400">
                        {formatPercent(pool.apr7d)}
                      </span>
                      {shouldShowAprWarning(pool) && (
                        <span
                          className="text-yellow-400 text-xs font-bold cursor-help"
                          title="APR may be unreliable: low TVL, volume, or fees"
                        >
                          !
                        </span>
                      )}
                    </div>
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
