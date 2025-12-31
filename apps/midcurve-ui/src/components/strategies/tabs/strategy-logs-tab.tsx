/**
 * Strategy Logs Tab
 *
 * Displays execution logs for a strategy with:
 * - Log level filtering (DEBUG, INFO, WARN, ERROR)
 * - Infinite scroll pagination ("Load More")
 * - Real-time refresh capability
 */

import { useState } from "react";
import { RefreshCw, AlertCircle } from "lucide-react";
import type { LogLevel } from "@midcurve/api-shared";
import { useStrategyLogs, flattenLogPages } from "@/hooks/strategies/useStrategyLogs";
import { LogFilters, StrategyLogTable } from "../logs";

interface StrategyLogsTabProps {
  /**
   * Strategy ID to fetch logs for
   */
  strategyId: string;
}

export function StrategyLogsTab({ strategyId }: StrategyLogsTabProps) {
  // Filter state
  const [selectedLevel, setSelectedLevel] = useState<LogLevel | undefined>(undefined);

  // Fetch logs with infinite query
  const {
    data,
    isLoading,
    isError,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    refetch,
    isRefetching,
  } = useStrategyLogs({
    strategyId,
    level: selectedLevel,
    limit: 50,
  });

  // Flatten pages into single array
  const logs = flattenLogPages(data?.pages);

  // Handle level filter change
  const handleLevelChange = (level: LogLevel | undefined) => {
    setSelectedLevel(level);
  };

  // Error state
  if (isError) {
    return (
      <div className="py-12">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="p-4 bg-red-900/30 rounded-full mb-4">
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
          <h3 className="text-lg font-medium text-white mb-2">
            Failed to Load Logs
          </h3>
          <p className="text-slate-400 max-w-md mb-4">
            {error instanceof Error ? error.message : "An error occurred while fetching logs."}
          </p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors cursor-pointer"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-4">
      {/* Header with Filters and Refresh */}
      <div className="flex items-center justify-between">
        <LogFilters
          selectedLevel={selectedLevel}
          onLevelChange={handleLevelChange}
        />

        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="flex items-center gap-2 px-3 py-2 text-sm text-slate-300 hover:text-white bg-slate-700/50 hover:bg-slate-700 border border-slate-600/50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw
            className={`w-4 h-4 ${isRefetching ? "animate-spin" : ""}`}
          />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Log count */}
      {!isLoading && logs.length > 0 && (
        <div className="text-sm text-slate-400">
          Showing {logs.length} log{logs.length !== 1 ? "s" : ""}
          {hasNextPage && " (more available)"}
        </div>
      )}

      {/* Log Table */}
      <StrategyLogTable logs={logs} isLoading={isLoading} />

      {/* Load More Button */}
      {hasNextPage && (
        <div className="flex justify-center pt-4">
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            {isFetchingNextPage ? (
              <span className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Loading...
              </span>
            ) : (
              "Load More"
            )}
          </button>
        </div>
      )}
    </div>
  );
}
