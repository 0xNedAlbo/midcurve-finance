/**
 * PositionCardHeader - Protocol-agnostic position header
 *
 * Displays token pair and status badges.
 * Accepts protocol-specific badges via children prop.
 * Works for all protocols (Uniswap V3, Orca, etc.)
 */

import Image from "next/image";
import { formatProtocolName } from "@/lib/format-helpers";

interface Token {
  symbol: string;
  logoUrl?: string | null;
}

interface PositionCardHeaderProps {
  baseToken: Token;
  quoteToken: Token;
  status: "active" | "closed";
  protocol: string;
  statusLineBadges?: React.ReactNode; // Protocol-specific badges for first line (e.g., range status)
  protocolLineBadges?: React.ReactNode; // Protocol-specific badges for second line (e.g., chain, fee, NFT ID)
}

export function PositionCardHeader({
  baseToken,
  quoteToken,
  status,
  protocol,
  statusLineBadges,
  protocolLineBadges,
}: PositionCardHeaderProps) {
  // Token logos with fallback
  const baseLogo = baseToken.logoUrl || `/images/tokens/${baseToken.symbol.toLowerCase()}.svg`;
  const quoteLogo = quoteToken.logoUrl || `/images/tokens/${quoteToken.symbol.toLowerCase()}.svg`;

  const statusColor = status === "active"
    ? "text-green-400 bg-green-500/10 border-green-500/20"
    : "text-slate-400 bg-slate-500/10 border-slate-500/20";

  return (
    <div className="flex items-center gap-2 md:gap-3">
      {/* Token Icons */}
      <div className="flex items-center">
        <div className="flex items-center -space-x-2">
          <Image
            src={baseLogo}
            alt={baseToken.symbol}
            width={28}
            height={28}
            className="rounded-full border-2 border-slate-700 bg-slate-800 relative z-10 md:w-8 md:h-8"
          />
          <Image
            src={quoteLogo}
            alt={quoteToken.symbol}
            width={28}
            height={28}
            className="rounded-full border-2 border-slate-700 bg-slate-800 md:w-8 md:h-8"
          />
        </div>

        <div className="ml-2 md:ml-3">
          {/* Token Pair - Always on its own line */}
          <div className="font-semibold text-white text-base md:text-lg whitespace-nowrap mb-1">
            {baseToken.symbol}/{quoteToken.symbol}
          </div>

          {/* Status badges line - All badges together, won't wrap between them */}
          <div className="flex items-center gap-1 md:gap-2 flex-wrap">
            {/* Status Badge */}
            <span className={`px-1.5 md:px-2 py-0.5 rounded text-[10px] md:text-xs font-medium border ${statusColor}`}>
              {status === "active" ? "Active" : "Closed"}
            </span>

            {/* Protocol-specific badges (e.g., range status) */}
            {statusLineBadges}
          </div>

          {/* Protocol Name and Protocol-specific badges for third line */}
          <div className="text-xs md:text-sm text-slate-400 flex items-center gap-1 md:gap-2 flex-wrap mt-0.5">
            <span>{formatProtocolName(protocol)}</span>
            {protocolLineBadges}
          </div>
        </div>
      </div>
    </div>
  );
}
