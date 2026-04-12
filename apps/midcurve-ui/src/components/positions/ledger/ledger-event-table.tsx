"use client";

import { useMemo } from "react";
import type { LedgerEventData } from "@midcurve/api-shared";
import { formatCompactValue } from "@/lib/fraction-format";
import { buildTxUrl, formatBlockNumber, truncateTxHash } from "@/lib/explorer-utils";
import { getEventTypeInfo, isCollectEvent, isVaultCollectEvent, isLifecycleEvent, isVaultLifecycleEvent, type EventType } from "@/lib/event-type-utils";
import { buildAddressUrl } from "@/lib/explorer-utils";
import { formatEventDateTime } from "@/lib/date-utils";
import { useChainSharedContract } from "@/hooks/automation/useChainSharedContract";
import { getNonfungiblePositionManagerAddress } from "@/config/contracts/nonfungible-position-manager";
import { ExternalLink, Clock } from "lucide-react";

const CONTRACT_DISPLAY_NAMES: Record<string, string> = {
  UniswapV3PositionCloser: "Position Closer",
  MidcurveSwapRouter: "Swap Router",
  UniswapV3VaultFactory: "Vault Factory",
  UniswapV3VaultPositionCloser: "Vault Position Closer",
  UniswapV3FeeCollector: "Fee Collector",
};


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
  // Build reverse lookup: address → display name for known contracts
  const { data: sharedContractData } = useChainSharedContract(chainId);
  const knownAddresses = useMemo(() => {
    const map = new Map<string, { name: string; address: string }>();

    // Add NFPM address
    const nfpmAddress = getNonfungiblePositionManagerAddress(chainId);
    if (nfpmAddress) {
      map.set(nfpmAddress.toLowerCase(), { name: "Uniswap NFPM", address: nfpmAddress });
    }

    // Add shared contracts
    if (sharedContractData?.contracts) {
      for (const [contractName, info] of Object.entries(sharedContractData.contracts)) {
        const displayName = CONTRACT_DISPLAY_NAMES[contractName] ?? contractName;
        map.set(info.contractAddress.toLowerCase(), { name: displayName, address: info.contractAddress });
      }
    }

    return map;
  }, [chainId, sharedContractData]);

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
          <img
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
          <img
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
          <img
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

  // Get fee recipient from event config
  const getFeeRecipient = (event: LedgerEventData): string => {
    const config = event.config as any;
    return config?.feeRecipient || "";
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

  // Truncate address for display: 0xAbCd...eF12
  const truncateAddress = (address: string): string => {
    if (!address || address.length < 14) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Render clickable address link
  const renderAddressLink = (address: string) => (
    <a
      href={buildAddressUrl(chainId, address)}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
    >
      {truncateAddress(address)}
    </a>
  );

  // Render known contract name or fallback to truncated address link
  const renderKnownAddressOrLink = (address: string) => {
    const known = address ? knownAddresses.get(address.toLowerCase()) : undefined;
    if (known) {
      return (
        <a
          href={buildAddressUrl(chainId, known.address)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
        >
          {known.name}
        </a>
      );
    }
    return renderAddressLink(address);
  };

  // Render lifecycle event details (MINT, BURN, TRANSFER)
  const renderLifecycleDetails = (event: LedgerEventData) => {
    const state = event.state as any;
    const eventType = event.eventType as EventType;

    if (eventType === "TRANSFER") {
      return (
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500">From:</span>
            {renderKnownAddressOrLink(state.from)}
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500">To:</span>
            {renderKnownAddressOrLink(state.to)}
          </div>
        </div>
      );
    }

    if (eventType === "MINT") {
      return (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-500">Minted to:</span>
          {renderKnownAddressOrLink(state.to)}
        </div>
      );
    }

    if (eventType === "BURN") {
      return (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-500">Burned by:</span>
          {renderKnownAddressOrLink(state.from)}
        </div>
      );
    }

    return null;
  };

  // Render vault lifecycle event details (VAULT_MINT, VAULT_BURN, VAULT_TRANSFER_IN/OUT)
  const renderVaultLifecycleDetails = (event: LedgerEventData) => {
    const state = event.state as any;
    const eventType = event.eventType as EventType;

    if (eventType === "VAULT_MINT") {
      return (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-500">Minted to</span>
          {renderKnownAddressOrLink(state.recipient)}
        </div>
      );
    }

    if (eventType === "VAULT_BURN") {
      return (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-500">Burned from</span>
          {renderKnownAddressOrLink(state.burner)}
        </div>
      );
    }

    if (eventType === "VAULT_TRANSFER_IN") {
      return (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-500">From:</span>
          {renderKnownAddressOrLink(state.from)}
        </div>
      );
    }

    if (eventType === "VAULT_TRANSFER_OUT") {
      return (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-500">To:</span>
          {renderKnownAddressOrLink(state.to)}
        </div>
      );
    }

    if (eventType === "VAULT_CLOSE_ORDER_EXECUTED") {
      return (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-500">Payout:</span>
          {renderKnownAddressOrLink(state.payout)}
        </div>
      );
    }

    return null;
  };

  // Render vault collect yield details
  const renderVaultCollectDetails = (event: LedgerEventData) => {
    const state = event.state as any;
    return (
      <div className="space-y-1">
        {state.recipient && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500">Recipient:</span>
            {renderKnownAddressOrLink(state.recipient)}
          </div>
        )}
        {renderTokenAmount(event.token0Amount, token0)}
        {renderTokenAmount(event.token1Amount, token1)}
      </div>
    );
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
                REALIZED PNL
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
              const feeRecipient = getFeeRecipient(event);

              return (
                <tr key={event.id} className={`hover:bg-slate-700/20 transition-colors ${event.isIgnored ? 'opacity-40' : ''}`}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300">
                    <div>{date}</div>
                    <div className="text-xs text-slate-500">{time}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className={`text-lg ${eventTypeInfo.color}`}>{eventTypeInfo.icon}</span>
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
                  <td className="px-6 py-4 text-sm">
                    {(() => {
                      const deltaPnlBigint = BigInt(event.deltaPnl || "0");
                      const pnlAfterBigint = BigInt(event.pnlAfter || "0");
                      const deltaColor = deltaPnlBigint > 0n
                        ? "text-emerald-400"
                        : deltaPnlBigint < 0n
                          ? "text-red-400"
                          : "text-slate-500";
                      const cumulativeColor = pnlAfterBigint > 0n
                        ? "text-emerald-400/70"
                        : pnlAfterBigint < 0n
                          ? "text-red-400/70"
                          : "text-slate-500";
                      return (
                        <div className="space-y-1">
                          <div className={`font-medium ${deltaColor}`}>
                            {deltaPnlBigint > 0n ? "+" : ""}
                            {formatValue(event.deltaPnl, quoteToken.decimals)} {quoteToken.symbol}
                          </div>
                          <div className={`text-xs ${cumulativeColor}`}>
                            &Sigma; {pnlAfterBigint > 0n ? "+" : ""}
                            {formatValue(event.pnlAfter, quoteToken.decimals)} {quoteToken.symbol}
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-400">
                    <div className="space-y-1">
                      {isLifecycleEvent(event.eventType as EventType) ? (
                        renderLifecycleDetails(event)
                      ) : isVaultLifecycleEvent(event.eventType as EventType) ? (
                        renderVaultLifecycleDetails(event)
                      ) : isVaultCollectEvent(event.eventType as EventType) ? (
                        renderVaultCollectDetails(event)
                      ) : isCollectEvent(event.eventType as EventType) ? (
                        <>
                          {/* Show fee recipient */}
                          {feeRecipient && (
                            <div className="flex items-center gap-1.5 text-xs mb-1">
                              <span className="text-slate-500">Recipient:</span>
                              {renderAddressLink(feeRecipient)}
                            </div>
                          )}
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
          const feeRecipient = getFeeRecipient(event);

          return (
            <div key={event.id} className={`p-4 space-y-3 ${event.isIgnored ? 'opacity-40' : ''}`}>
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
                  {(() => {
                    const deltaPnlBigint = BigInt(event.deltaPnl || "0");
                    const pnlAfterBigint = BigInt(event.pnlAfter || "0");
                    const deltaColor = deltaPnlBigint > 0n
                      ? "text-emerald-400"
                      : deltaPnlBigint < 0n
                        ? "text-red-400"
                        : "text-slate-500";
                    const cumulativeColor = pnlAfterBigint > 0n
                      ? "text-emerald-400/70"
                      : pnlAfterBigint < 0n
                        ? "text-red-400/70"
                        : "text-slate-500";
                    return (
                      <div className="flex items-center gap-3 mt-1">
                        <span className={`text-xs font-medium ${deltaColor}`}>
                          PnL: {deltaPnlBigint > 0n ? "+" : ""}
                          {formatValue(event.deltaPnl, quoteToken.decimals)} {quoteToken.symbol}
                        </span>
                        <span className={`text-xs ${cumulativeColor}`}>
                          (&Sigma; {pnlAfterBigint > 0n ? "+" : ""}
                          {formatValue(event.pnlAfter, quoteToken.decimals)})
                        </span>
                      </div>
                    );
                  })()}
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

              {isLifecycleEvent(event.eventType as EventType) ? (
                <div className="text-xs text-slate-400">
                  {renderLifecycleDetails(event)}
                </div>
              ) : isVaultLifecycleEvent(event.eventType as EventType) ? (
                <div className="text-xs text-slate-400">
                  {renderVaultLifecycleDetails(event)}
                </div>
              ) : isVaultCollectEvent(event.eventType as EventType) ? (
                <div className="text-xs text-slate-400">
                  {renderVaultCollectDetails(event)}
                </div>
              ) : (event.token0Amount !== "0" ||
                event.token1Amount !== "0" ||
                (isCollectEvent(event.eventType as EventType) &&
                  (fee0 !== "0" || fee1 !== "0"))) && (
                <div className="text-xs text-slate-400 space-y-1">
                  {isCollectEvent(event.eventType as EventType) ? (
                    <>
                      {feeRecipient && (
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-slate-500">Recipient:</span>
                          {renderAddressLink(feeRecipient)}
                        </div>
                      )}
                      {fee0 !== "0" && renderFeeAmount(fee0, token0)}
                      {fee1 !== "0" && renderFeeAmount(fee1, token1)}
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
