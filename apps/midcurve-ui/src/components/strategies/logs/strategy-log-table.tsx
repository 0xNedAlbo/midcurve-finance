/**
 * Strategy Log Table
 *
 * Displays strategy execution logs in a responsive table/card format.
 * Includes desktop table view and mobile card view.
 */

import type { StrategyLogData } from "@midcurve/api-shared";
import { LogLevelBadge } from "./log-level-badge";
import { formatEventDateTime } from "@/lib/date-utils";
import { Clock, Hash, FileText } from "lucide-react";

interface StrategyLogTableProps {
  /**
   * Array of log entries to display
   */
  logs: StrategyLogData[];

  /**
   * Whether data is currently loading
   */
  isLoading?: boolean;
}

/**
 * Truncate a hex string for display (e.g., topic hash)
 */
function truncateHex(hex: string, length = 8): string {
  if (!hex || hex.length <= length + 4) return hex;
  return `${hex.slice(0, length + 2)}...${hex.slice(-4)}`;
}

/**
 * Get the display message for a log entry
 * Prefers decoded data, falls back to truncated raw data
 */
function getDisplayMessage(log: StrategyLogData): string {
  if (log.dataDecoded) {
    return log.dataDecoded;
  }
  if (log.data && log.data !== "0x") {
    return truncateHex(log.data, 20);
  }
  return "-";
}

/**
 * Get the display topic for a log entry
 * Prefers decoded topic name, falls back to truncated hash
 */
function getDisplayTopic(log: StrategyLogData): string {
  if (log.topicName) {
    return log.topicName;
  }
  return truncateHex(log.topic, 8);
}

export function StrategyLogTable({ logs, isLoading }: StrategyLogTableProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="h-16 bg-slate-700/30 rounded-lg animate-pulse"
          />
        ))}
      </div>
    );
  }

  // Empty state
  if (logs.length === 0) {
    return (
      <div className="py-12">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="p-4 bg-slate-700/30 rounded-full mb-4">
            <FileText className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-medium text-white mb-2">No Logs Found</h3>
          <p className="text-slate-400 max-w-md">
            This strategy hasn't emitted any logs yet, or no logs match the
            current filter.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Desktop Table */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-700/30">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                Timestamp
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                Level
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                Topic
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                Message
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                Epoch
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {logs.map((log) => {
              const { date, time } = formatEventDateTime(log.timestamp);

              return (
                <tr
                  key={log.id}
                  className="hover:bg-slate-700/20 transition-colors"
                >
                  {/* Timestamp */}
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-300">
                    <div>{date}</div>
                    <div className="text-xs text-slate-500">{time}</div>
                  </td>

                  {/* Level */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <LogLevelBadge level={log.level} levelName={log.levelName} />
                  </td>

                  {/* Topic */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className="text-sm text-slate-300 font-mono"
                      title={log.topic}
                    >
                      {getDisplayTopic(log)}
                    </span>
                  </td>

                  {/* Message */}
                  <td className="px-4 py-3 text-sm text-slate-300 max-w-md">
                    <div
                      className="truncate"
                      title={log.dataDecoded || log.data}
                    >
                      {getDisplayMessage(log)}
                    </div>
                  </td>

                  {/* Epoch */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-sm text-slate-400 font-mono">
                      #{log.epoch}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="lg:hidden space-y-3">
        {logs.map((log) => {
          const { date, time } = formatEventDateTime(log.timestamp);

          return (
            <div
              key={log.id}
              className="bg-slate-700/20 rounded-lg p-4 space-y-3"
            >
              {/* Header: Level + Timestamp */}
              <div className="flex items-center justify-between">
                <LogLevelBadge level={log.level} levelName={log.levelName} />
                <div className="text-xs text-slate-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>
                    {date} {time}
                  </span>
                </div>
              </div>

              {/* Topic */}
              <div className="flex items-center gap-2">
                <Hash className="w-3.5 h-3.5 text-slate-500" />
                <span
                  className="text-sm text-slate-300 font-mono"
                  title={log.topic}
                >
                  {getDisplayTopic(log)}
                </span>
              </div>

              {/* Message */}
              <div className="text-sm text-slate-300">
                {getDisplayMessage(log)}
              </div>

              {/* Footer: Epoch + Correlation ID */}
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Epoch #{log.epoch}</span>
                <span className="font-mono" title={log.correlationId}>
                  {truncateHex(log.correlationId, 6)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
