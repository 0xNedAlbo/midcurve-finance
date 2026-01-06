/**
 * Automation Log Item
 *
 * Displays a single automation log entry with:
 * - Level-colored indicator
 * - Timestamp and message
 * - Expandable JSON context
 * - Clickable transaction hash link
 */

import { useState } from 'react';
import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Info,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import type {
  AutomationLogData,
  AutomationLogLevel,
  AutomationLogType,
} from '@midcurve/api-shared';

interface AutomationLogItemProps {
  /**
   * The log entry data
   */
  log: AutomationLogData;

  /**
   * Chain ID for block explorer links
   */
  chainId?: number;
}

/**
 * Configuration for each log level
 */
const LEVEL_CONFIG = {
  0: { icon: Info, color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-700/30' }, // DEBUG
  1: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' }, // INFO
  2: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' }, // WARN
  3: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' }, // ERROR
} as const;

/**
 * Icons for specific log types (optional override)
 */
const LOG_TYPE_ICONS: Partial<Record<AutomationLogType, typeof CheckCircle>> = {
  ORDER_EXECUTED: CheckCircle,
  ORDER_FAILED: XCircle,
  ORDER_TRIGGERED: AlertTriangle,
};

/**
 * Block explorer URLs by chain ID
 */
const BLOCK_EXPLORERS: Record<number, string> = {
  1: 'https://etherscan.io/tx/',
  42161: 'https://arbiscan.io/tx/',
  8453: 'https://basescan.org/tx/',
  137: 'https://polygonscan.com/tx/',
  10: 'https://optimistic.etherscan.io/tx/',
  56: 'https://bscscan.com/tx/',
  31337: '', // Local chain - no explorer
};

/**
 * Get block explorer URL for a transaction hash
 */
function getExplorerUrl(chainId: number | undefined, txHash: string): string | null {
  if (!chainId || chainId === 31337) return null; // No explorer for local chain
  const baseUrl = BLOCK_EXPLORERS[chainId];
  if (!baseUrl) return null;
  return `${baseUrl}${txHash}`;
}

/**
 * Format timestamp to relative time or date
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Truncate a string with ellipsis
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '...';
}

export function AutomationLogItem({ log, chainId }: AutomationLogItemProps) {
  const [expanded, setExpanded] = useState(false);

  const levelConfig = LEVEL_CONFIG[log.level as AutomationLogLevel] ?? LEVEL_CONFIG[1];
  const LevelIcon = LOG_TYPE_ICONS[log.logType] ?? levelConfig.icon;

  const hasContext = log.context && Object.keys(log.context).length > 0;
  const txHash = log.context?.txHash;
  const explorerUrl = txHash ? getExplorerUrl(chainId ?? log.context?.chainId, txHash) : null;

  return (
    <div className={`rounded-lg border ${levelConfig.border} ${levelConfig.bg}`}>
      {/* Main row */}
      <div
        className={`flex items-start gap-3 p-3 ${hasContext ? 'cursor-pointer hover:bg-slate-800/30' : ''} transition-colors`}
        onClick={() => hasContext && setExpanded(!expanded)}
      >
        {/* Expand indicator */}
        <div className="mt-0.5 w-4 h-4 flex-shrink-0">
          {hasContext ? (
            expanded ? (
              <ChevronDown className="w-4 h-4 text-slate-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-500" />
            )
          ) : (
            <span className="w-4" />
          )}
        </div>

        {/* Level icon */}
        <LevelIcon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${levelConfig.color}`} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-slate-200">{log.message}</span>
            {txHash && explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="font-mono">{truncate(txHash, 14)}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {txHash && !explorerUrl && (
              <span className="text-xs text-slate-500 font-mono">{truncate(txHash, 14)}</span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {formatTimestamp(log.createdAt)}
          </div>
        </div>

        {/* Level badge */}
        <span
          className={`text-xs px-2 py-0.5 rounded ${levelConfig.bg} ${levelConfig.color} border ${levelConfig.border}`}
        >
          {log.levelName}
        </span>
      </div>

      {/* Expanded context */}
      {expanded && hasContext && (
        <div className="px-3 pb-3 pt-0 ml-11">
          <div className="bg-slate-900/50 rounded p-2 text-xs font-mono text-slate-400 overflow-x-auto">
            <pre className="whitespace-pre-wrap break-words">
              {JSON.stringify(log.context, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
