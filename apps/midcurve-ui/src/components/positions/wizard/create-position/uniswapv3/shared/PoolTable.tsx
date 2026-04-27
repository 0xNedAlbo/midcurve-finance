import { useState, type ReactNode } from 'react';
import { Star, ChevronUp, ChevronDown } from 'lucide-react';
import type { PoolSearchResultItem } from '@midcurve/api-shared';
import type { PoolTableColumnId } from '@midcurve/shared';
import { LvrCoveragePill } from './LvrCoveragePill';

type SortColumn = 'tvlUSD' | 'volume24hUSD' | 'fees24hUSD' | 'apr7d' | 'volume7dAvgUSD';
type SortDirection = 'asc' | 'desc';

interface ColumnDef {
  id: PoolTableColumnId;
  label: string;
  align: 'left' | 'right';
  sortKey?: SortColumn;
  render: (pool: PoolSearchResultItem) => ReactNode;
}

interface PoolTableProps {
  pools: PoolSearchResultItem[];
  selectedPoolAddress: string | null;
  onSelectPool: (pool: PoolSearchResultItem) => void;
  onToggleFavorite?: (pool: PoolSearchResultItem) => void;
  isLoading?: boolean;
  visibleColumns: PoolTableColumnId[];
}

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

const formatPercent = (value: number) => `${value.toFixed(1)}%`;

const formatSignedPercent = (value: number | null) => {
  if (value === null) return 'n/a';
  const pct = value * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
};

const formatRatio = (value: number | null, digits = 2) => {
  if (value === null) return 'n/a';
  return value.toFixed(digits);
};

const formatRawPercent = (value: number | null) => {
  if (value === null) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
};

const formatFeeTier = (feeTier: number) => `${(feeTier / 10000).toFixed(2)}%`;

/**
 * APR may be unreliable when pool has low/no liquidity, volume, or fees.
 */
const shouldShowAprWarning = (pool: PoolSearchResultItem): boolean => {
  const tvl = parseFloat(pool.metrics.tvlUSD) || 0;
  const volume = parseFloat(pool.metrics.volume24hUSD) || 0;
  const fees = parseFloat(pool.metrics.fees24hUSD) || 0;
  const apr = pool.metrics.apr7d || 0;

  if (apr > 0 && tvl === 0) return true;
  if (apr > 0 && fees === 0) return true;
  if (volume === 0) return true;

  return false;
};

/**
 * Column registry. Display order is the array order; visibility is controlled
 * by the `visibleColumns` prop.
 */
const COLUMNS: ColumnDef[] = [
  {
    id: 'tvl',
    label: 'TVL',
    align: 'right',
    sortKey: 'tvlUSD',
    render: (pool) => formatCurrency(pool.metrics.tvlUSD),
  },
  {
    id: 'feeApr7d',
    label: 'ø APR 7d',
    align: 'right',
    sortKey: 'apr7d',
    render: (pool) => (
      <div className="flex items-center justify-end gap-1">
        <span className="text-green-400">{formatPercent(pool.metrics.apr7d)}</span>
        {shouldShowAprWarning(pool) && (
          <span
            className="text-yellow-400 text-xs font-bold cursor-help"
            title="APR may be unreliable: low TVL, volume, or fees"
          >
            !
          </span>
        )}
      </div>
    ),
  },
  {
    id: 'lvrCoverage',
    label: 'LVR-Coverage',
    align: 'right',
    render: (pool) => (
      <div className="flex justify-end">
        <LvrCoveragePill pool={pool} />
      </div>
    ),
  },
  {
    id: 'volume7dAvg',
    label: 'Volume 7d avg',
    align: 'right',
    sortKey: 'volume7dAvgUSD',
    render: (pool) => formatCurrency(pool.metrics.volume7dAvgUSD),
  },
  {
    id: 'fees24h',
    label: 'Fees 24h',
    align: 'right',
    sortKey: 'fees24hUSD',
    render: (pool) => formatCurrency(pool.metrics.fees24hUSD),
  },
  {
    id: 'lvrThreshold',
    label: 'LVR threshold',
    align: 'right',
    render: (pool) => formatRawPercent(pool.metrics.sigmaFilter.sigmaSqOver8_365d),
  },
  {
    id: 'margin',
    label: 'Margin',
    align: 'right',
    render: (pool) => {
      const v = pool.metrics.sigmaFilter.marginLongTerm;
      if (v === null) return <span className="text-slate-500">n/a</span>;
      const pct = v * 100;
      const cls = pct >= 0 ? 'text-green-400' : 'text-red-400';
      return <span className={cls}>{formatSignedPercent(v)}</span>;
    },
  },
  {
    id: 'coverageRatio',
    label: 'Coverage ratio',
    align: 'right',
    render: (pool) => formatRatio(pool.metrics.sigmaFilter.coverageLongTerm),
  },
  {
    id: 'sigmaPair365d',
    label: 'σ pair (365d)',
    align: 'right',
    render: (pool) => {
      const v = pool.metrics.volatility.pair.sigma365d.value;
      return formatRawPercent(v ?? null);
    },
  },
  {
    id: 'velocity',
    label: 'Velocity',
    align: 'right',
    render: (pool) => formatRatio(pool.metrics.volatility.velocity),
  },
  {
    id: 'verdict60d',
    label: 'Verdict 60d',
    align: 'right',
    render: (pool) => {
      const v = pool.metrics.sigmaFilter.verdictShortTerm;
      const cls =
        v === 'PASS'
          ? 'text-green-400'
          : v === 'FAIL'
            ? 'text-red-400'
            : 'text-slate-500';
      return <span className={cls}>{v === 'INSUFFICIENT_DATA' ? 'n/a' : v}</span>;
    },
  },
  {
    id: 'verdictAgreement',
    label: 'Agreement',
    align: 'right',
    render: (pool) => {
      const v = pool.metrics.sigmaFilter.verdictAgreement;
      const cls =
        v === 'AGREE'
          ? 'text-green-400'
          : v === 'DIVERGENT'
            ? 'text-yellow-400'
            : 'text-slate-500';
      return <span className={cls}>{v === 'INSUFFICIENT_DATA' ? 'n/a' : v}</span>;
    },
  },
];

export function PoolTable({
  pools,
  selectedPoolAddress,
  onSelectPool,
  onToggleFavorite,
  isLoading = false,
  visibleColumns,
}: PoolTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('tvlUSD');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const getNumericValue = (pool: PoolSearchResultItem, column: SortColumn): number => {
    switch (column) {
      case 'tvlUSD':
        return parseFloat(pool.metrics.tvlUSD) || 0;
      case 'volume24hUSD':
        return parseFloat(pool.metrics.volume24hUSD) || 0;
      case 'fees24hUSD':
        return parseFloat(pool.metrics.fees24hUSD) || 0;
      case 'volume7dAvgUSD':
        return parseFloat(pool.metrics.volume7dAvgUSD) || 0;
      case 'apr7d':
        return pool.metrics.apr7d || 0;
    }
  };

  const sortedPools = [...pools].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;

    const aValue = getNumericValue(a, sortColumn);
    const bValue = getNumericValue(b, sortColumn);

    if (sortDirection === 'asc') return aValue - bValue;
    return bValue - aValue;
  });

  const orderedVisibleColumns: ColumnDef[] = COLUMNS.filter((c) =>
    visibleColumns.includes(c.id)
  );

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
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left">
          <thead className="sticky top-0 z-10 bg-slate-800/90 backdrop-blur-sm">
            <tr className="border-b border-slate-700">
              <th className="pb-3 text-slate-400 font-medium w-10"></th>
              <th className="pb-3 text-slate-400 font-medium">Pool</th>
              {orderedVisibleColumns.map((col) => {
                const headerAlign = col.align === 'right' ? 'text-right' : 'text-left';
                if (!col.sortKey) {
                  return (
                    <th
                      key={col.id}
                      className={`pb-3 font-medium text-slate-400 ${headerAlign}`}
                    >
                      {col.label}
                    </th>
                  );
                }
                const sortKey = col.sortKey;
                const isActive = sortColumn === sortKey;
                return (
                  <th
                    key={col.id}
                    onClick={() => handleSort(sortKey)}
                    className={`pb-3 font-medium cursor-pointer select-none transition-colors hover:text-slate-200 ${
                      isActive ? 'text-blue-400' : 'text-slate-400'
                    } ${headerAlign}`}
                  >
                    <div
                      className={`flex items-center gap-1 ${
                        col.align === 'right' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      <span>{col.label}</span>
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
              })}
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
                        {(() => {
                          const isToken0Quote = pool.userProvidedInfo?.isToken0Quote;
                          const baseSymbol =
                            isToken0Quote === true ? pool.token1.symbol : pool.token0.symbol;
                          const quoteSymbol =
                            isToken0Quote === true ? pool.token0.symbol : pool.token1.symbol;
                          return `${baseSymbol} / ${quoteSymbol}`;
                        })()}
                      </span>
                      <span className="text-sm text-slate-400">
                        {pool.chainName} • {formatFeeTier(pool.feeTier)}
                      </span>
                    </div>
                  </td>
                  {orderedVisibleColumns.map((col) => (
                    <td
                      key={col.id}
                      className={`py-3 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                    >
                      {col.render(pool)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
