"use client";

import { formatCompactValue } from "@/lib/fraction-format";
import { Clock, ExternalLink } from "lucide-react";

// Hedge ledger event types
type HedgeLedgerEventType =
  | "OPEN"
  | "INCREASE"
  | "DECREASE"
  | "CLOSE"
  | "FUNDING"
  | "FEE"
  | "LIQUIDATION";

// Simplified hedge ledger event for dummy data
interface HedgeLedgerEvent {
  id: string;
  hedgeId: string;
  eventType: HedgeLedgerEventType;
  timestamp: Date;
  deltaNotional: bigint;
  deltaCostBasis: bigint;
  deltaRealizedPnl: bigint;
  deltaMargin: bigint;
  price?: string;
  size?: string;
  fundingRate?: string;
  txHash?: string;
}

interface HedgeLedgerTableProps {
  events: HedgeLedgerEvent[];
  isLoading?: boolean;
  quoteTokenSymbol: string;
  quoteTokenDecimals: number;
  riskBaseSymbol: string; // Risk asset symbol (ETH, BTC) not token symbol (WETH, WBTC)
}

// Event type styling
const getEventTypeInfo = (eventType: HedgeLedgerEventType) => {
  switch (eventType) {
    case "OPEN":
      return {
        label: "Open",
        icon: "🟢",
        color: "text-green-400",
        bgColor: "bg-green-500/20",
      };
    case "INCREASE":
      return {
        label: "Increase",
        icon: "📈",
        color: "text-blue-400",
        bgColor: "bg-blue-500/20",
      };
    case "DECREASE":
      return {
        label: "Decrease",
        icon: "📉",
        color: "text-orange-400",
        bgColor: "bg-orange-500/20",
      };
    case "CLOSE":
      return {
        label: "Close",
        icon: "⬛",
        color: "text-slate-400",
        bgColor: "bg-slate-500/20",
      };
    case "FUNDING":
      return {
        label: "Funding",
        icon: "💰",
        color: "text-purple-400",
        bgColor: "bg-purple-500/20",
      };
    case "FEE":
      return {
        label: "Fee",
        icon: "💸",
        color: "text-amber-400",
        bgColor: "bg-amber-500/20",
      };
    case "LIQUIDATION":
      return {
        label: "Liquidation",
        icon: "🔴",
        color: "text-red-400",
        bgColor: "bg-red-500/20",
      };
    default:
      return {
        label: eventType,
        icon: "❓",
        color: "text-slate-400",
        bgColor: "bg-slate-500/20",
      };
  }
};

// Format date and time
const formatEventDateTime = (date: Date) => {
  return {
    date: date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    time: date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
};

export function HedgeLedgerTable({
  events,
  isLoading,
  quoteTokenSymbol,
  quoteTokenDecimals,
  riskBaseSymbol,
}: HedgeLedgerTableProps) {
  // Sort events by timestamp in descending order (latest first)
  const sortedEvents = [...events].sort(
    (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
  );

  if (isLoading) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-slate-700 rounded w-1/3"></div>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-slate-700/30 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 p-8 text-center">
        <div className="text-slate-400 mb-4">
          <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg">No hedge events found</p>
          <p className="text-sm mt-2">
            Events will appear here once you open a hedge.
          </p>
        </div>
      </div>
    );
  }

  // Format price
  const formatPrice = (price: string | undefined) => {
    if (!price) return "-";
    const num = parseFloat(price);
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Format size
  const formatSize = (size: string | undefined) => {
    if (!size) return "-";
    const num = parseFloat(size);
    return `${num >= 0 ? "+" : ""}${num.toFixed(4)}`;
  };

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-700/50">
        <h3 className="text-lg font-semibold text-white">Hedge Ledger</h3>
        <p className="text-sm text-slate-400 mt-1">
          Complete history of hedge size changes and funding payments
        </p>
        <div className="text-xs text-slate-500 mt-2">
          Total Events: {events.length}
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-700/30">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                DATE & TIME
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                EVENT TYPE
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-300 uppercase tracking-wider">
                SIZE DELTA
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-300 uppercase tracking-wider">
                PRICE
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-300 uppercase tracking-wider">
                PNL IMPACT
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-slate-300 uppercase tracking-wider">
                FUNDING
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {sortedEvents.map((event) => {
              const { date, time } = formatEventDateTime(event.timestamp);
              const eventTypeInfo = getEventTypeInfo(event.eventType);

              return (
                <tr key={event.id} className="hover:bg-slate-700/20 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">
                    <div>{date}</div>
                    <div className="text-xs text-slate-500">{time}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      <span className="text-lg">{eventTypeInfo.icon}</span>
                      <span className={`text-sm font-medium ${eventTypeInfo.color}`}>
                        {eventTypeInfo.label}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                    {event.size ? (
                      <span className={parseFloat(event.size) >= 0 ? "text-green-400" : "text-red-400"}>
                        {formatSize(event.size)} {riskBaseSymbol}
                      </span>
                    ) : (
                      <span className="text-slate-500">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-slate-300">
                    {formatPrice(event.price)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                    <span className={
                      event.deltaRealizedPnl > 0n
                        ? "text-green-400"
                        : event.deltaRealizedPnl < 0n
                          ? "text-red-400"
                          : "text-slate-500"
                    }>
                      {event.deltaRealizedPnl !== 0n
                        ? `${event.deltaRealizedPnl > 0n ? "+" : ""}${formatCompactValue(event.deltaRealizedPnl, quoteTokenDecimals)} ${quoteTokenSymbol}`
                        : "-"}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                    {event.eventType === "FUNDING" && event.fundingRate ? (
                      <div>
                        <div className={
                          parseFloat(event.fundingRate) >= 0
                            ? "text-green-400"
                            : "text-red-400"
                        }>
                          {parseFloat(event.fundingRate) >= 0 ? "+" : ""}
                          ${parseFloat(event.fundingRate).toFixed(4)}
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-500">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="lg:hidden divide-y divide-slate-700/30">
        {sortedEvents.map((event) => {
          const { date, time } = formatEventDateTime(event.timestamp);
          const eventTypeInfo = getEventTypeInfo(event.eventType);

          return (
            <div key={event.id} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="text-lg">{eventTypeInfo.icon}</span>
                  <span className={`text-sm font-medium ${eventTypeInfo.color}`}>
                    {eventTypeInfo.label}
                  </span>
                </div>
                <div className="text-xs text-slate-400 text-right">
                  <div>{date}</div>
                  <div>{time}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                {event.size && (
                  <div>
                    <div className="text-xs text-slate-400">Size Delta</div>
                    <div className={parseFloat(event.size) >= 0 ? "text-green-400" : "text-red-400"}>
                      {formatSize(event.size)} {riskBaseSymbol}
                    </div>
                  </div>
                )}
                {event.price && (
                  <div>
                    <div className="text-xs text-slate-400">Price</div>
                    <div className="text-slate-300">{formatPrice(event.price)}</div>
                  </div>
                )}
                {event.deltaRealizedPnl !== 0n && (
                  <div>
                    <div className="text-xs text-slate-400">PnL Impact</div>
                    <div className={
                      event.deltaRealizedPnl > 0n ? "text-green-400" : "text-red-400"
                    }>
                      {event.deltaRealizedPnl > 0n ? "+" : ""}
                      {formatCompactValue(event.deltaRealizedPnl, quoteTokenDecimals)} {quoteTokenSymbol}
                    </div>
                  </div>
                )}
                {event.eventType === "FUNDING" && event.fundingRate && (
                  <div>
                    <div className="text-xs text-slate-400">Funding</div>
                    <div className={
                      parseFloat(event.fundingRate) >= 0 ? "text-green-400" : "text-red-400"
                    }>
                      {parseFloat(event.fundingRate) >= 0 ? "+" : ""}
                      ${parseFloat(event.fundingRate).toFixed(4)}
                    </div>
                  </div>
                )}
              </div>

              {event.txHash && (
                <a
                  href={`https://app.hyperliquid.xyz/tx/${event.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1 text-blue-400 hover:text-blue-300 transition-colors cursor-pointer text-xs"
                >
                  <span>View Transaction</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Export the event type for use in dummy data
export type { HedgeLedgerEvent, HedgeLedgerEventType };
