"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RotateCcw, ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import { PositionCard } from "./position-card";
import { EmptyStateActions } from "./empty-state-actions";
import { usePositionsList } from "@/hooks/positions/usePositionsList";
import type { ListPositionsParams } from "@midcurve/api-shared";

// Chain ID to name mapping for client-side filtering
const CHAIN_ID_TO_NAME: Record<number, string> = {
  1: "ethereum",
  42161: "arbitrum",
  8453: "base",
};

function getChainName(chainId: number): string {
  return CHAIN_ID_TO_NAME[chainId] || "unknown";
}

interface PositionListProps {
  className?: string;
}

// Valid filter values for validation
const VALID_STATUS_VALUES = ["all", "active", "closed"] as const;
const VALID_CHAIN_VALUES = ["all", "ethereum", "arbitrum", "base"] as const;
const VALID_SORT_VALUES = ["positionOpenedAt", "currentValue", "unrealizedPnl"] as const;

export function PositionList({ className }: PositionListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read and validate filters from URL parameters with defaults
  const statusParam = searchParams.get("status");
  const filterStatus = (VALID_STATUS_VALUES.includes(statusParam as any)
    ? statusParam
    : "active") as "all" | "active" | "closed";

  const chainParam = searchParams.get("chain");
  const filterChain = (VALID_CHAIN_VALUES.includes(chainParam as any)
    ? chainParam
    : "all");

  const sortParam = searchParams.get("sortBy");
  const sortBy = (VALID_SORT_VALUES.includes(sortParam as any)
    ? sortParam
    : "currentValue") as ListPositionsParams["sortBy"];

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
      sortBy,
      sortDirection,
      limit,
      offset,
    }),
    [filterStatus, sortBy, sortDirection, offset]
  );

  // Fetch positions from API
  const { data, isLoading, error, refetch } = usePositionsList(queryParams);

  // Client-side chain filtering (API doesn't support chain filter)
  const filteredPositions = useMemo(() => {
    if (!data?.data) return [];

    if (filterChain === "all") {
      return data.data;
    }

    return data.data.filter((position) => {
      // Extract chainId from position config (protocol-specific)
      if (position.protocol === "uniswapv3") {
        const config = position.config as { chainId: number };
        const chainName = getChainName(config.chainId);
        return chainName === filterChain;
      }
      return false;
    });
  }, [data, filterChain]);

  // Pagination info
  const pagination = data?.pagination;
  const hasMore = pagination ? pagination.hasMore : false;
  const total = pagination ? pagination.total : 0;

  // Update URL with new filter parameters
  const updateUrl = (updates: {
    status?: string;
    chain?: string;
    sortBy?: string;
    sortDirection?: "asc" | "desc";
    offset?: number;
  }) => {
    const params = new URLSearchParams(searchParams.toString());

    // Apply updates
    if (updates.status !== undefined) {
      params.set("status", updates.status);
      params.set("offset", "0"); // Reset pagination on filter change
    }
    if (updates.chain !== undefined) {
      params.set("chain", updates.chain);
      // No offset reset for client-side filter
    }
    if (updates.sortBy !== undefined) {
      params.set("sortBy", updates.sortBy);
      params.set("offset", "0"); // Reset pagination on filter change
    }
    if (updates.sortDirection !== undefined) {
      params.set("sortDirection", updates.sortDirection);
      params.set("offset", "0"); // Reset pagination on sort direction change
    }
    if (updates.offset !== undefined) {
      params.set("offset", String(updates.offset));
    }

    // Navigate with shallow routing (no page reload)
    router.push(`?${params.toString()}`, { scroll: false });
  };

  // Handle filter changes
  const handleFilterChange = (filter: {
    status?: string;
    chain?: string;
    sortBy?: string;
  }) => {
    updateUrl(filter);
  };

  // Toggle sort direction
  const toggleSortDirection = () => {
    const newDirection = sortDirection === "desc" ? "asc" : "desc";
    updateUrl({ sortDirection: newDirection });
  };

  // Load more handler
  const handleLoadMore = () => {
    if (!isLoading && hasMore) {
      updateUrl({ offset: offset + limit });
    }
  };

  // Placeholder discovery handler
  const handleDiscoverNewPositions = () => {
    console.log("Position discovery - functionality not implemented yet");
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
              status: e.target.value as "active" | "closed" | "archived",
            })
          }
          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        >
          <option value="all">All Positions</option>
          <option value="active">Active</option>
          <option value="closed">Closed</option>
        </select>

        {/* Chain Filter */}
        <select
          value={filterChain ?? undefined}
          onChange={(e) => handleFilterChange({ chain: e.target.value })}
          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        >
          <option value="all">All Chains</option>
          <option value="ethereum">Ethereum</option>
          <option value="arbitrum">Arbitrum</option>
          <option value="base">Base</option>
        </select>

        {/* Sort By and Direction */}
        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => handleFilterChange({ sortBy: e.target.value })}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="currentValue">Sort by: Current Value</option>
            <option value="positionOpenedAt">Sort by: Position Opened Date</option>
            <option value="unrealizedPnl">Sort by: Unrealized PnL</option>
          </select>

          {/* Sort Direction Toggle */}
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

        {/* Refresh Button - Only visible when "active" filter is selected */}
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
      {!error && isLoading && filteredPositions.length === 0 && (
        <div className="text-center py-8">
          <p className="text-slate-400">Loading positions...</p>
        </div>
      )}

      {/* Empty State */}
      {!error && !isLoading && filteredPositions.length === 0 && (
        <EmptyStateActions
          onWalletImportClick={() =>
            console.log("Wallet import modal - not implemented yet")
          }
          onImportSuccess={(position) =>
            console.log("Position imported:", position)
          }
        />
      )}

      {/* Positions Grid */}
      {!error && filteredPositions.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4">
            {filteredPositions.map((position, index) => (
              <PositionCard
                key={position.id}
                position={position}
                listIndex={index}
              />
            ))}
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
                  `Load More (${total - filteredPositions.length} remaining)`
                )}
              </button>
            </div>
          )}

          {/* Pagination Info */}
          <div className="text-center mt-4 text-sm text-slate-400">
            Showing {filteredPositions.length} of {total} positions
          </div>
        </>
      )}
    </div>
  );
}
