/**
 * PoolTableSection
 *
 * Container for the pool search table: owns the visible-column persistence
 * (`useGetPoolTableColumns`) and renders the section header, gear icon
 * (column manager), and the presentational `PoolTable`.
 */

import type { PoolSearchResultItem } from '@midcurve/api-shared';
import type { PoolTableColumnId } from '@midcurve/shared';
import { useGetPoolTableColumns } from '@/hooks/user-settings/usePoolTableColumns';
import { PoolTable } from './PoolTable';
import { PoolTableColumnManager } from './PoolTableColumnManager';

interface PoolTableSectionProps {
  pools: PoolSearchResultItem[];
  selectedPoolAddress: string | null;
  onSelectPool: (pool: PoolSearchResultItem) => void;
  onToggleFavorite?: (pool: PoolSearchResultItem) => void;
  isLoading?: boolean;
}

const FALLBACK_COLUMNS: PoolTableColumnId[] = ['tvl', 'feeApr7d', 'lvrCoverage'];

export function PoolTableSection({
  pools,
  selectedPoolAddress,
  onSelectPool,
  onToggleFavorite,
  isLoading,
}: PoolTableSectionProps) {
  const { data } = useGetPoolTableColumns();
  const visibleColumns = data?.visibleColumns ?? FALLBACK_COLUMNS;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Available Pools</h3>
        <PoolTableColumnManager visibleColumns={visibleColumns} />
      </div>
      <div className="flex-1 min-h-0">
        <PoolTable
          pools={pools}
          selectedPoolAddress={selectedPoolAddress}
          onSelectPool={onSelectPool}
          onToggleFavorite={onToggleFavorite}
          isLoading={isLoading}
          visibleColumns={visibleColumns}
        />
      </div>
    </div>
  );
}
