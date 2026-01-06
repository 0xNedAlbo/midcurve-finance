/**
 * Automation Log List
 *
 * Collapsible container for automation logs with:
 * - Expandable "Activity Log" header
 * - Level filter tabs (All/Info/Warn/Error)
 * - Auto-polling when active orders exist
 * - Log item list with pagination info
 */

import { useState } from 'react';
import { ScrollText, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { useAutomationLogs } from '@/hooks/automation';
import { AutomationLogItem } from './AutomationLogItem';

interface AutomationLogListProps {
  /**
   * Position ID to fetch logs for
   */
  positionId: string;

  /**
   * Chain ID for block explorer links
   */
  chainId?: number;

  /**
   * Whether the position has active orders (enables polling)
   */
  hasActiveOrders: boolean;
}

/**
 * Level filter options
 */
const LEVEL_FILTERS = [
  { value: undefined, label: 'All' },
  { value: 1, label: 'Info' },
  { value: 2, label: 'Warn' },
  { value: 3, label: 'Error' },
] as const;

export function AutomationLogList({
  positionId,
  chainId,
  hasActiveOrders,
}: AutomationLogListProps) {
  const [expanded, setExpanded] = useState(false);
  const [levelFilter, setLevelFilter] = useState<number | undefined>(undefined);

  const { data, isLoading, error, refetch, isFetching } = useAutomationLogs(
    {
      positionId,
      level: levelFilter,
      limit: 20,
      polling: hasActiveOrders,
    },
    { enabled: expanded }
  );

  const logs = data?.logs ?? [];
  const hasMore = data?.hasMore ?? false;

  return (
    <div className="mt-6 border-t border-slate-700/50 pt-4">
      {/* Header - always visible, clickable to expand */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        className="w-full flex items-center justify-between text-left cursor-pointer group"
      >
        <div className="flex items-center gap-2">
          <ScrollText className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-300">Activity Log</span>
          {expanded && logs.length > 0 && (
            <span className="text-xs text-slate-500">
              ({logs.length}
              {hasMore ? '+' : ''})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {expanded && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                refetch();
              }}
              disabled={isFetching}
              className="p-1 text-slate-400 hover:text-slate-300 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            </button>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-slate-400 group-hover:text-slate-300" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400 group-hover:text-slate-300" />
          )}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Level filter tabs */}
          <div className="flex gap-1">
            {LEVEL_FILTERS.map((filter) => (
              <button
                key={filter.label}
                onClick={() => setLevelFilter(filter.value)}
                className={`px-2 py-1 text-xs rounded transition-colors cursor-pointer ${
                  levelFilter === filter.value
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50'
                    : 'bg-slate-800/50 text-slate-400 border border-slate-700/50 hover:text-slate-300'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {/* Content */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-5 h-5 text-slate-400 animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-8 text-red-400 text-sm">
              Failed to load activity log
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">
              No activity recorded yet
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <AutomationLogItem key={log.id} log={log} chainId={chainId} />
              ))}
              {hasMore && (
                <div className="text-center py-2">
                  <span className="text-xs text-slate-500">
                    Showing latest {logs.length} events
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
