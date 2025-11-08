"use client";

import type { LedgerEventData } from "@midcurve/api-shared";
import { formatCompactValue } from "@/lib/fraction-format";
import { buildTxUrl, formatBlockNumber, truncateTxHash } from "@/lib/explorer-utils";
import { getEventTypeInfo, isCollectEvent, type EventType } from "@/lib/event-type-utils";
import { formatEventDateTime } from "@/lib/date-utils";
import { ExternalLink, Clock } from "lucide-react";
import Image from "next/image";

// Token type from position response (already serialized)
interface TokenInfo {
  symbol: string;
  decimals: number;
  logoUrl?: string;
}

interface LedgerEventTableProps {
  events: LedgerEventData[];
  isLoading?: boolean;
  chainId: number;
  quoteToken: TokenInfo;
  token0: TokenInfo;
  token1: TokenInfo;
}

export function LedgerEventTable({
  events,
  isLoading,
  chainId,
  quoteToken,
  token0,
  token1,
}: LedgerEventTableProps) {
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
          <p className="text-lg">No events found</p>
          <p className="text-sm mt-2">
            This position may be new or events may still be syncing.
          </p>
        </div>
      </div>
    );
  }

  // Helper to format values
  const formatValue = (amount: string, decimals: number): string => {
    if (!amount || amount === "0") return "0";
    try {
      const bigintAmount = BigInt(amount);
      return formatCompactValue(bigintAmount, decimals);
    } catch {
      return amount;
    }
  };

  // Helper to render token amount with logo
  const renderTokenAmount = (amount: string, token: TokenInfo) => {
    if (!amount || amount === "0") return null;

    return (
      <div className="flex items-center gap-2">
        {token.logoUrl && (
          <Image
            src={token.logoUrl}
            alt={token.symbol}
            width={16}
            height={16}
            className="rounded-full"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        <span>
          {formatValue(amount, token.decimals)} {token.symbol}
        </span>
      </div>
    );
  };

  // Helper to render principal amount (orange)
  const renderPrincipalAmount = (amount: string, token: TokenInfo) => {
    if (!amount || amount === "0") return null;

    return (
      <div className="flex items-center gap-2 text-orange-400">
        {token.logoUrl && (
          <Image
            src={token.logoUrl}
            alt={token.symbol}
            width={16}
            height={16}
            className="rounded-full"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        <span>
          Principal: {formatValue(amount, token.decimals)} {token.symbol}
        </span>
      </div>
    );
  };

  // Helper to render fee amount (purple)
  const renderFeeAmount = (amount: string, token: TokenInfo) => {
    if (!amount || amount === "0") return null;

    return (
      <div className="flex items-center gap-2 text-purple-400">
        {token.logoUrl && (
          <Image
            src={token.logoUrl}
            alt={token.symbol}
            width={16}
            height={16}
            className="rounded-full"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        <span>
          Fees: {formatValue(amount, token.decimals)} {token.symbol}
        </span>
      </div>
    );
  };

  // Calculate collected principal (CRITICAL for accuracy)
  const calculateCollectedPrincipal = (
    tokenDelta: string,
    collectedFee: string
  ): string => {
    if (!tokenDelta || tokenDelta === "0") return "0";

    try {
      const total = BigInt(tokenDelta);
      const fees = BigInt(collectedFee || "0");
      const principal = total - fees;
      return principal > 0n ? principal.toString() : "0";
    } catch {
      return "0";
    }
  };

  // Check if a COLLECT event includes principal withdrawal
  const hasPrincipalWithdrawal = (event: LedgerEventData): boolean => {
    if (!isCollectEvent(event.eventType as EventType)) return false;

    // Parse config to get fees
    const config = event.config as any;
    const feesCollected0 = config?.feesCollected0?.toString() || "0";
    const feesCollected1 = config?.feesCollected1?.toString() || "0";

    const principal0 = calculateCollectedPrincipal(event.token0Amount, feesCollected0);
    const principal1 = calculateCollectedPrincipal(event.token1Amount, feesCollected1);

    return principal0 !== "0" || principal1 !== "0";
  };

  // Get fee amounts from event config
  const getFeeAmounts = (event: LedgerEventData): { fee0: string; fee1: string } => {
    const config = event.config as any;
    return {
      fee0: config?.feesCollected0?.toString() || "0",
      fee1: config?.feesCollected1?.toString() || "0",
    };
  };

  // Get transaction hash from event config
  const getTxHash = (event: LedgerEventData): string => {
    const config = event.config as any;
    return config?.txHash || "";
  };

  // Get block number from event config
  const getBlockNumber = (event: LedgerEventData): string => {
    const config = event.config as any;
    return config?.blockNumber?.toString() || "";
  };

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700/50 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-700/50">
        <h3 className="text-lg font-semibold text-white">Position Ledger</h3>
        <p className="text-sm text-slate-400 mt-1">
          Complete history of your position&apos;s liquidity changes and fee collections
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
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                VALUE
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                DETAILS
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider">
                TRANSACTION
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {events.map((event) => {
              const { date, time } = formatEventDateTime(event.timestamp);
              const eventTypeInfo = getEventTypeInfo(event.eventType as EventType);
              const txHash = getTxHash(event);
              const blockNumber = getBlockNumber(event);
              const { fee0, fee1 } = getFeeAmounts(event);

              return (
                <tr key={event.id} className="hover:bg-slate-700/20 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">
                    <div>{date}</div>
                    <div className="text-xs text-slate-500">{time}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="text-lg">{eventTypeInfo.icon}</span>
                        <span className={`text-sm font-medium ${eventTypeInfo.color}`}>
                          {eventTypeInfo.label}
                        </span>
                      </div>
                      {hasPrincipalWithdrawal(event) && (
                        <div className="text-xs text-orange-400 ml-7">
                          Principal Withdrawal
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-300">
                    <div className="space-y-1">
                      {isCollectEvent(event.eventType as EventType) && event.rewards.length > 0 ? (
                        <div className="text-purple-400 font-medium">
                          {formatValue(
                            event.rewards.reduce((sum, r) => sum + BigInt(r.tokenValue), 0n).toString(),
                            quoteToken.decimals
                          )}{" "}
                          {quoteToken.symbol}
                        </div>
                      ) : (
                        <div className="font-medium">
                          {formatValue(event.tokenValue, quoteToken.decimals)} {quoteToken.symbol}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-400">
                    <div className="space-y-1">
                      {isCollectEvent(event.eventType as EventType) ? (
                        <>
                          {/* Show fees first */}
                          {fee0 !== "0" && renderFeeAmount(fee0, token0)}
                          {fee1 !== "0" && renderFeeAmount(fee1, token1)}
                          {/* Show principal amounts */}
                          {(() => {
                            const principal0 = calculateCollectedPrincipal(event.token0Amount, fee0);
                            const principal1 = calculateCollectedPrincipal(event.token1Amount, fee1);
                            return (
                              <>
                                {principal0 !== "0" && renderPrincipalAmount(principal0, token0)}
                                {principal1 !== "0" && renderPrincipalAmount(principal1, token1)}
                              </>
                            );
                          })()}
                        </>
                      ) : (
                        <>
                          {renderTokenAmount(event.token0Amount, token0)}
                          {renderTokenAmount(event.token1Amount, token1)}
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="space-y-1">
                      <a
                        href={buildTxUrl(chainId, txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center space-x-1 text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                      >
                        <span className="font-mono text-xs">{truncateTxHash(txHash)}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <div className="text-xs text-slate-500">
                        Block: {formatBlockNumber(blockNumber)}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Card View */}
      <div className="lg:hidden divide-y divide-slate-700/30">
        {events.map((event) => {
          const { date, time } = formatEventDateTime(event.timestamp);
          const eventTypeInfo = getEventTypeInfo(event.eventType as EventType);
          const txHash = getTxHash(event);
          const blockNumber = getBlockNumber(event);
          const { fee0, fee1 } = getFeeAmounts(event);

          return (
            <div key={event.id} className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-lg">{eventTypeInfo.icon}</span>
                    <span className={`text-sm font-medium ${eventTypeInfo.color}`}>
                      {eventTypeInfo.label}
                    </span>
                  </div>
                  {hasPrincipalWithdrawal(event) && (
                    <div className="text-xs text-orange-400 ml-7">
                      Principal Withdrawal
                    </div>
                  )}
                </div>
                <div className="text-xs text-slate-400">
                  <div>{date}</div>
                  <div>{time}</div>
                </div>
              </div>

              <div className="flex justify-between items-start">
                <div>
                  <div className="text-white font-medium">
                    {formatValue(event.tokenValue, quoteToken.decimals)} {quoteToken.symbol}
                  </div>
                </div>
                <a
                  href={buildTxUrl(chainId, txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1 text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                >
                  <span className="font-mono text-xs">{truncateTxHash(txHash)}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {(event.token0Amount !== "0" ||
                event.token1Amount !== "0" ||
                (isCollectEvent(event.eventType as EventType) &&
                  (fee0 !== "0" || fee1 !== "0"))) && (
                <div className="text-xs text-slate-400 space-y-1">
                  {isCollectEvent(event.eventType as EventType) ? (
                    <>
                      {/* Show fees first */}
                      {fee0 !== "0" && renderFeeAmount(fee0, token0)}
                      {fee1 !== "0" && renderFeeAmount(fee1, token1)}
                      {/* Show principal amounts */}
                      {(() => {
                        const principal0 = calculateCollectedPrincipal(event.token0Amount, fee0);
                        const principal1 = calculateCollectedPrincipal(event.token1Amount, fee1);
                        return (
                          <>
                            {principal0 !== "0" && renderPrincipalAmount(principal0, token0)}
                            {principal1 !== "0" && renderPrincipalAmount(principal1, token1)}
                          </>
                        );
                      })()}
                    </>
                  ) : (
                    <>
                      {renderTokenAmount(event.token0Amount, token0)}
                      {renderTokenAmount(event.token1Amount, token1)}
                    </>
                  )}
                </div>
              )}

              <div className="text-xs text-slate-500">
                Block: {formatBlockNumber(blockNumber)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
