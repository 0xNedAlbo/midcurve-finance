import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { RotateCcw, ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import { parsePositionHash } from "@midcurve/shared";
import { UniswapV3PositionCard } from "./protocol/uniswapv3/uniswapv3-position-card";
import { EmptyStateActions } from "./empty-state-actions";
import { usePositionsList } from "@/hooks/positions/usePositionsList";
import type { ListPositionsParams } from "@midcurve/api-shared";

interface PositionListProps {
  className?: string;
}

// Valid filter values for validation
const VALID_STATUS_VALUES = ["all", "active", "closed"] as const;
const VALID_PROTOCOL_VALUES = ["all", "uniswapv3"] as const;
const VALID_SORT_VALUES = ["positionOpenedAt", "totalApr", "currentValue"] as const;

export function PositionList({ className }: PositionListProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read and validate filters from URL parameters with defaults
  const statusParam = searchParams.get("status");
  const filterStatus = (VALID_STATUS_VALUES.includes(statusParam as any)
    ? statusParam
    : "active") as "all" | "active" | "closed";

  const protocolParam = searchParams.get("protocol");
  const filterProtocol = (VALID_PROTOCOL_VALUES.includes(protocolParam as any)
    ? protocolParam
    : "all") as typeof VALID_PROTOCOL_VALUES[number];

  const sortParam = searchParams.get("sortBy");
  const sortBy = (VALID_SORT_VALUES.includes(sortParam as any)
    ? sortParam
    : "totalApr") as ListPositionsParams["sortBy"];

  const sortDirectionParam = searchParams.get("sortDirection");
  const sortDirection = (sortDirectionParam === "asc" || sortDirectionParam === "desc"
    ? sortDirectionParam
    : "desc") as "asc" | "desc";

  const offsetParam = searchParams.get("offset");
  const offset = Math.max(0, parseInt(offsetParam || "0", 10));
  const limit = 20;

  // Build API query params
  const queryParams = useMemo<ListPositionsParams>(
    () => ({
      status: filterStatus,
      protocols: filterProtocol === "all" ? undefined : [filterProtocol],
      sortBy,
      sortDirection,
      limit,
      offset,
    }),
    [filterStatus, filterProtocol, sortBy, sortDirection, offset]
  );

  // Fetch positions from API (returns common fields + positionHash)
  const { data, isLoading, error, refetch } = usePositionsList(queryParams);

  // Parse and validate position hashes
  const positions = useMemo(() => {
    if (!data?.data) return [];
    return data.data.filter((item) => {
      if (!item?.positionHash) return false;
      try {
        parsePositionHash(item.positionHash);
        return true;
      } catch {
        console.warn(`[PositionList] Skipping invalid positionHash: "${item.positionHash}"`);
        return false;
      }
    });
  }, [data]);

  // Pagination info
  const pagination = data?.pagination;
  const hasMore = pagination ? pagination.hasMore : false;
  const total = pagination ? pagination.total : 0;

  // Update URL with new filter parameters
  const updateUrl = (updates: {
    status?: string;
    protocol?: string;
    sortBy?: string;
    sortDirection?: "asc" | "desc";
    offset?: number;
  }) => {
    const params = new URLSearchParams(searchParams.toString());

    if (updates.status !== undefined) {
      params.set("status", updates.status);
      params.set("offset", "0");
    }
    if (updates.protocol !== undefined) {
      params.set("protocol", updates.protocol);
      params.set("offset", "0");
    }
    if (updates.sortBy !== undefined) {
      params.set("sortBy", updates.sortBy);
      params.set("offset", "0");
    }
    if (updates.sortDirection !== undefined) {
      params.set("sortDirection", updates.sortDirection);
      params.set("offset", "0");
    }
    if (updates.offset !== undefined) {
      params.set("offset", String(updates.offset));
    }

    // Clean up stale chain param if present from old URLs
    params.delete("chain");

    setSearchParams(params);
  };

  const handleFilterChange = (filter: {
    status?: string;
    protocol?: string;
    sortBy?: string;
  }) => {
    updateUrl(filter);
  };

  const toggleSortDirection = () => {
    const newDirection = sortDirection === "desc" ? "asc" : "desc";
    updateUrl({ sortDirection: newDirection });
  };

  const handleLoadMore = () => {
    if (!isLoading && hasMore) {
      updateUrl({ offset: offset + limit });
    }
  };

  const handleDiscoverNewPositions = () => {
    refetch();
  };

  return (
    <div className={className}>
      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        {/* Status Filter */}
        <select
          value={filterStatus}
          onChange={(e) =>
            handleFilterChange({
              status: e.target.value as "active" | "closed" | "all",
            })
          }
          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        >
          <option value="all">All Positions</option>
          <option value="active">Active</option>
          <option value="closed">Closed</option>
        </select>

        {/* Protocol Filter */}
        <select
          value={filterProtocol}
          onChange={(e) => handleFilterChange({ protocol: e.target.value })}
          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        >
          <option value="all">All Protocols</option>
          <option value="uniswapv3">Uniswap V3</option>
        </select>

        {/* Sort By and Direction */}
        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => handleFilterChange({ sortBy: e.target.value })}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="positionOpenedAt">Sort by: Position Age</option>
            <option value="totalApr">Sort by: APR</option>
            <option value="currentValue">Sort by: Position Value</option>
          </select>

          <button
            onClick={toggleSortDirection}
            className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200 transition-colors cursor-pointer"
            title={sortDirection === "desc" ? "Sort descending (high to low)" : "Sort ascending (low to high)"}
          >
            {sortDirection === "desc" ? (
              <ArrowDownAZ className="w-4 h-4" />
            ) : (
              <ArrowUpAZ className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Refresh Button */}
        {filterStatus === "active" && (
          <button
            onClick={handleDiscoverNewPositions}
            disabled={isLoading}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200 transition-colors disabled:opacity-50 cursor-pointer"
            title="Search for new active positions on all chains"
          >
            <RotateCcw
              className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`}
            />
          </button>
        )}
      </div>

      {/* Error State */}
      {error && (
        <div className="text-center py-8">
          <p className="text-red-400 mb-4">
            Failed to load positions: {error.message}
          </p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4 mr-2 inline" />
            Retry
          </button>
        </div>
      )}

      {/* Loading State (Initial) */}
      {!error && isLoading && positions.length === 0 && (
        <div className="text-center py-8">
          <p className="text-slate-400">Loading positions...</p>
        </div>
      )}

      {/* Empty State */}
      {!error && !isLoading && positions.length === 0 && (
        <EmptyStateActions
          onImportSuccess={async () => {
            await refetch();
          }}
        />
      )}

      {/* Positions Grid */}
      {!error && positions.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4">
            {positions.map((item, index) => {
              try {
                const parsed = parsePositionHash(item.positionHash);
                switch (parsed.protocol) {
                  case "uniswapv3":
                    return (
                      <UniswapV3PositionCard
                        key={item.positionHash}
                        chainId={parsed.chainId}
                        nftId={parsed.nftId}
                        index={index}
                      />
                    );
                  default:
                    return null;
                }
              } catch {
                return null;
              }
            })}
          </div>

          {/* Load More Button */}
          {hasMore && (
            <div className="text-center mt-6">
              <button
                onClick={handleLoadMore}
                disabled={isLoading}
                className="px-6 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <RotateCcw className="w-4 h-4 mr-2 inline animate-spin" />
                    Loading more...
                  </>
                ) : (
                  `Load More (${total - positions.length} remaining)`
                )}
              </button>
            </div>
          )}

          {/* Pagination Info */}
          <div className="text-center mt-4 text-sm text-slate-400">
            Showing {positions.length} of {total} positions
          </div>
        </>
      )}
    </div>
  );
}
