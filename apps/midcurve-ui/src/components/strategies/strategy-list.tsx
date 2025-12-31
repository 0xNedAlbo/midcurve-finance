/**
 * StrategyList - List of user's strategies with filtering and pagination
 *
 * Similar structure to PositionList but for strategies.
 */

import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { RotateCcw, ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import { StrategyCard } from "./strategy-card";
import { StrategyEmptyState } from "./strategy-empty-state";
import { useStrategiesList } from "@/hooks/strategies/useStrategiesList";
import type { ListStrategiesParams } from "@midcurve/api-shared";

// Valid filter values
const VALID_STATE_VALUES = ["all", "active", "pending", "shutdown"] as const;
const VALID_SORT_VALUES = ["createdAt", "updatedAt", "name"] as const;

interface StrategyListProps {
  className?: string;
}

export function StrategyList({ className }: StrategyListProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read and validate filters from URL parameters with defaults
  const stateParam = searchParams.get("strategyState");
  const filterState = (
    VALID_STATE_VALUES.includes(stateParam as any) ? stateParam : "all"
  ) as "all" | "active" | "pending" | "shutdown";

  const sortParam = searchParams.get("strategySortBy");
  const sortBy = (
    VALID_SORT_VALUES.includes(sortParam as any) ? sortParam : "createdAt"
  ) as ListStrategiesParams["sortBy"];

  const sortDirectionParam = searchParams.get("strategySortDirection");
  const sortDirection = (
    sortDirectionParam === "asc" || sortDirectionParam === "desc"
      ? sortDirectionParam
      : "desc"
  ) as "asc" | "desc";

  const offsetParam = searchParams.get("strategyOffset");
  const offset = Math.max(0, parseInt(offsetParam || "0", 10));
  const limit = 20;

  // Build API query params
  const queryParams = useMemo<ListStrategiesParams>(
    () => ({
      state: filterState,
      sortBy,
      sortDirection,
      limit,
      offset,
      includePositions: true, // Include positions for collapsible display
    }),
    [filterState, sortBy, sortDirection, offset]
  );

  // Fetch strategies from API
  const { data, isLoading, error, refetch } = useStrategiesList(queryParams);

  // Get strategies from response
  const strategies = data?.data ?? [];

  // Pagination info
  const pagination = data?.pagination;
  const hasMore = pagination ? pagination.hasMore : false;
  const total = pagination ? pagination.total : 0;

  // Update URL with new filter parameters
  const updateUrl = (updates: {
    state?: string;
    sortBy?: string;
    sortDirection?: "asc" | "desc";
    offset?: number;
  }) => {
    const params = new URLSearchParams(searchParams.toString());

    // Preserve the tab parameter
    params.set("tab", "strategies");

    // Apply updates with strategy-specific param names
    if (updates.state !== undefined) {
      params.set("strategyState", updates.state);
      params.set("strategyOffset", "0"); // Reset pagination on filter change
    }
    if (updates.sortBy !== undefined) {
      params.set("strategySortBy", updates.sortBy);
      params.set("strategyOffset", "0"); // Reset pagination on filter change
    }
    if (updates.sortDirection !== undefined) {
      params.set("strategySortDirection", updates.sortDirection);
      params.set("strategyOffset", "0"); // Reset pagination on sort direction change
    }
    if (updates.offset !== undefined) {
      params.set("strategyOffset", String(updates.offset));
    }

    setSearchParams(params);
  };

  // Handle filter changes
  const handleFilterChange = (filter: { state?: string; sortBy?: string }) => {
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

  return (
    <div className={className}>
      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        {/* State Filter */}
        <select
          value={filterState}
          onChange={(e) => handleFilterChange({ state: e.target.value })}
          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        >
          <option value="all">All Strategies</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="shutdown">Shutdown</option>
        </select>

        {/* Sort By and Direction */}
        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => handleFilterChange({ sortBy: e.target.value })}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          >
            <option value="createdAt">Sort by: Created</option>
            <option value="updatedAt">Sort by: Updated</option>
            <option value="name">Sort by: Name</option>
          </select>

          {/* Sort Direction Toggle */}
          <button
            onClick={toggleSortDirection}
            className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200 transition-colors cursor-pointer"
            title={
              sortDirection === "desc"
                ? "Sort descending (newest first)"
                : "Sort ascending (oldest first)"
            }
          >
            {sortDirection === "desc" ? (
              <ArrowDownAZ className="w-4 h-4" />
            ) : (
              <ArrowUpAZ className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Refresh Button */}
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200 transition-colors disabled:opacity-50 cursor-pointer"
          title="Refresh strategies"
        >
          <RotateCcw
            className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {/* Error State */}
      {error && (
        <div className="text-center py-8">
          <p className="text-red-400 mb-4">
            Failed to load strategies: {error.message}
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
      {!error && isLoading && strategies.length === 0 && (
        <div className="text-center py-8">
          <p className="text-slate-400">Loading strategies...</p>
        </div>
      )}

      {/* Empty State */}
      {!error && !isLoading && strategies.length === 0 && (
        <StrategyEmptyState
          onDeploySuccess={() => {
            refetch();
          }}
        />
      )}

      {/* Strategies Grid */}
      {!error && strategies.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4">
            {strategies.map((strategy, index) => (
              <StrategyCard
                key={strategy.id}
                strategy={strategy}
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
                  `Load More (${total - strategies.length} remaining)`
                )}
              </button>
            </div>
          )}

          {/* Pagination Info */}
          <div className="text-center mt-4 text-sm text-slate-400">
            Showing {strategies.length} of {total} strategies
          </div>
        </>
      )}
    </div>
  );
}
