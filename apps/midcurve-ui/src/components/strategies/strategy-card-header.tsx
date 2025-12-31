/**
 * StrategyCardHeader - Strategy identification and status display
 */

import { formatDistanceToNow } from "date-fns";
import { ExternalLink } from "lucide-react";

// Chain metadata for display
const CHAIN_METADATA: Record<number, { name: string; explorer: string }> = {
  1: { name: "Ethereum", explorer: "https://etherscan.io" },
  42161: { name: "Arbitrum", explorer: "https://arbiscan.io" },
  8453: { name: "Base", explorer: "https://basescan.org" },
  56: { name: "BSC", explorer: "https://bscscan.com" },
  137: { name: "Polygon", explorer: "https://polygonscan.com" },
  10: { name: "Optimism", explorer: "https://optimistic.etherscan.io" },
};

// Status colors
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-400",
  deploying: "bg-blue-500/20 text-blue-400",
  deployed: "bg-cyan-500/20 text-cyan-400",
  starting: "bg-blue-500/20 text-blue-400",
  active: "bg-green-500/20 text-green-400",
  shutting_down: "bg-orange-500/20 text-orange-400",
  shutdown: "bg-slate-500/20 text-slate-400",
};

interface StrategyCardHeaderProps {
  name: string;
  strategyType: string;
  status: string;
  quoteToken?: {
    symbol: string;
    logoUrl?: string | null;
  };
  chainId: number | null;
  contractAddress: string | null;
  createdAt: string;
}

export function StrategyCardHeader({
  name,
  strategyType,
  status,
  quoteToken,
  chainId,
  contractAddress,
  createdAt,
}: StrategyCardHeaderProps) {
  const chainMeta = chainId ? CHAIN_METADATA[chainId] : null;
  const statusColor = STATUS_COLORS[status] || STATUS_COLORS.pending;

  // Format age
  const age = formatDistanceToNow(new Date(createdAt), { addSuffix: false });

  return (
    <div className="flex flex-col gap-1.5 min-w-0 flex-shrink-0 w-[180px] md:w-[220px] lg:w-[280px]">
      {/* First line: Strategy name */}
      <div className="flex items-center gap-2">
        {/* Quote token logo if available */}
        {quoteToken?.logoUrl && (
          <img
            src={quoteToken.logoUrl}
            alt={quoteToken.symbol}
            className="w-5 h-5 rounded-full"
          />
        )}
        <span className="text-sm md:text-base lg:text-lg font-semibold text-white truncate">
          {name}
        </span>
      </div>

      {/* Second line: Strategy type, status, age */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Strategy type badge */}
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-slate-700/50 text-slate-300">
          {strategyType}
        </span>

        {/* Status badge */}
        <span
          className={`px-2 py-0.5 text-xs font-medium rounded-full ${statusColor}`}
        >
          {status.replace("_", " ")}
        </span>

        {/* Age */}
        <span className="text-xs text-slate-500">{age}</span>
      </div>

      {/* Third line: Chain and contract (if deployed) */}
      {chainId && contractAddress && (
        <div className="flex items-center gap-2 text-xs">
          {/* Chain badge */}
          {chainMeta && (
            <span className="px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-400">
              {chainMeta.name}
            </span>
          )}

          {/* Contract address link */}
          <a
            href={`${chainMeta?.explorer || "https://etherscan.io"}/address/${contractAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            title="View contract on explorer"
          >
            <span className="font-mono">
              {contractAddress.slice(0, 6)}...{contractAddress.slice(-4)}
            </span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
}
