"use client";

import { useState } from "react";
import type { HyperliquidPerpHedge } from "@midcurve/shared";
import { HedgeCreateForm } from "./hedge-create-form";
import { HedgeSummaryCard } from "./hedge-summary-card";
import { HedgePnLComparison } from "./hedge-pnl-comparison";
import { HedgeMetricsCard } from "./hedge-metrics-card";
import { HedgeAdjustmentControls } from "./hedge-adjustment-controls";
import { HedgeLedgerTable, type HedgeLedgerEvent } from "./hedge-ledger-table";
import { Bug } from "lucide-react";

interface HedgeTabProps {
  // Position data
  baseAssetAmount: bigint;
  baseAssetDecimals: number;
  baseAssetSymbol: string;   // Position token symbol (WETH, WBTC)
  quoteTokenSymbol: string;  // Position quote token symbol (USDC)
  quoteTokenDecimals: number;
  currentPrice: number;

  // Risk layer symbols (ETH instead of WETH, USD instead of USDC)
  riskBaseSymbol: string;
  riskQuoteSymbol: string;

  // Position PnL for comparison
  positionUnrealizedPnl: bigint;
  positionRealizedPnl: bigint;

  // Hedge data (null if no hedge exists)
  hedge: HyperliquidPerpHedge | null;
  ledgerEvents: HedgeLedgerEvent[];
  isLoading?: boolean;
}

// Dummy data for testing active hedge state
const DUMMY_HEDGE: HyperliquidPerpHedge = {
  id: "hedge-dummy-001",
  createdAt: new Date("2024-01-15"),
  updatedAt: new Date(),
  userId: "user-001",
  positionId: "position-001",
  hedgeType: "hyperliquid-perp",
  protocol: "hyperliquid",
  notionalValue: 5000n * 10n ** 6n,
  costBasis: 4800n * 10n ** 6n,
  realizedPnl: 50n * 10n ** 6n,
  unrealizedPnl: 150n * 10n ** 6n,
  currentApr: 0.12,
  isActive: true,
  openedAt: new Date("2024-01-15"),
  closedAt: null,
  config: {
    schemaVersion: 1,
    exchange: "hyperliquid",
    environment: "mainnet",
    dex: "",
    account: {
      userAddress: "0x1234567890123456789012345678901234567890",
      accountType: "subaccount",
      subAccountName: "mc-abc123",
    },
    market: {
      coin: "ETH",
      quote: "USD",
      szDecimals: 4,
    },
    hedgeParams: {
      direction: "short",
      marginMode: "isolated",
      targetNotionalUsd: "5000",
      targetLeverage: 2,
      reduceOnly: false,
    },
  },
  state: {
    schemaVersion: 1,
    lastSyncAt: new Date().toISOString(),
    lastSource: "info.webData2",
    positionStatus: "open",
    position: {
      coin: "ETH",
      szi: "-1.5",
      side: "short",
      absSize: "1.5",
      entryPx: "3200",
      markPx: "3100",
      liquidationPx: "4500",
      value: {
        positionValue: "4650",
        unrealizedPnl: "150",
        realizedPnl: "50",
        returnOnEquity: "0.08",
      },
      leverage: {
        mode: "isolated",
        value: 2,
        marginUsed: "2325",
      },
      funding: {
        cumFundingAllTime: "-25.50",
        cumFundingSinceOpen: "-25.50",
        cumFundingSinceChange: "-5.00",
        currentFundingRate: "0.0001",
      },
    },
    orders: { open: [] },
    accountSnapshot: {
      accountValue: "2500",
      totalNtlPos: "4650",
      totalMarginUsed: "2325",
      withdrawable: "175",
    },
  },
};

// Dummy ledger events
const DUMMY_LEDGER_EVENTS: HedgeLedgerEvent[] = [
  {
    id: "evt-001",
    hedgeId: "hedge-dummy-001",
    eventType: "OPEN",
    timestamp: new Date("2024-01-15T10:00:00Z"),
    deltaNotional: 5000n * 10n ** 6n,
    deltaCostBasis: 4800n * 10n ** 6n,
    deltaRealizedPnl: 0n,
    deltaMargin: 2400n * 10n ** 6n,
    price: "3200",
    size: "1.5",
  },
  {
    id: "evt-002",
    hedgeId: "hedge-dummy-001",
    eventType: "FUNDING",
    timestamp: new Date("2024-01-16T02:00:00Z"),
    deltaNotional: 0n,
    deltaCostBasis: 0n,
    deltaRealizedPnl: -5n * 10n ** 6n,
    deltaMargin: 0n,
    fundingRate: "-5.50",
  },
  {
    id: "evt-003",
    hedgeId: "hedge-dummy-001",
    eventType: "FUNDING",
    timestamp: new Date("2024-01-16T10:00:00Z"),
    deltaNotional: 0n,
    deltaCostBasis: 0n,
    deltaRealizedPnl: -8n * 10n ** 6n,
    deltaMargin: 0n,
    fundingRate: "-8.00",
  },
  {
    id: "evt-004",
    hedgeId: "hedge-dummy-001",
    eventType: "INCREASE",
    timestamp: new Date("2024-01-17T14:30:00Z"),
    deltaNotional: 500n * 10n ** 6n,
    deltaCostBasis: 500n * 10n ** 6n,
    deltaRealizedPnl: 0n,
    deltaMargin: 250n * 10n ** 6n,
    price: "3150",
    size: "0.16",
  },
  {
    id: "evt-005",
    hedgeId: "hedge-dummy-001",
    eventType: "FUNDING",
    timestamp: new Date("2024-01-17T18:00:00Z"),
    deltaNotional: 0n,
    deltaCostBasis: 0n,
    deltaRealizedPnl: 12n * 10n ** 6n,
    deltaMargin: 0n,
    fundingRate: "12.00",
  },
  {
    id: "evt-006",
    hedgeId: "hedge-dummy-001",
    eventType: "DECREASE",
    timestamp: new Date("2024-01-18T09:15:00Z"),
    deltaNotional: -300n * 10n ** 6n,
    deltaCostBasis: -280n * 10n ** 6n,
    deltaRealizedPnl: 20n * 10n ** 6n,
    deltaMargin: -150n * 10n ** 6n,
    price: "3050",
    size: "-0.1",
  },
];

export function HedgeTab({
  baseAssetAmount,
  baseAssetDecimals,
  baseAssetSymbol,
  quoteTokenSymbol,
  quoteTokenDecimals,
  currentPrice,
  riskBaseSymbol,
  riskQuoteSymbol,
  positionUnrealizedPnl,
  positionRealizedPnl,
  hedge,
  ledgerEvents,
  isLoading,
}: HedgeTabProps) {
  // Dev toggle for testing both states
  const [showDummyHedge, setShowDummyHedge] = useState(false);

  // Determine which hedge to display
  const displayHedge = showDummyHedge ? DUMMY_HEDGE : hedge;
  const displayEvents = showDummyHedge ? DUMMY_LEDGER_EVENTS : ledgerEvents;

  // Check if we're in development mode
  const isDev = process.env.NODE_ENV === "development";

  return (
    <div className="space-y-6">
      {/* Dev Toggle (only in development) */}
      {isDev && (
        <div className="flex items-center justify-end">
          <button
            onClick={() => setShowDummyHedge(!showDummyHedge)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-purple-600/20 text-purple-400 border border-purple-500/30 rounded-lg hover:bg-purple-600/30 transition-colors cursor-pointer"
          >
            <Bug className="w-3 h-3" />
            {showDummyHedge ? "Show Real State" : "Show Dummy Hedge"}
          </button>
        </div>
      )}

      {displayHedge ? (
        // Active Hedge View
        <div className="space-y-6">
          {/* Hedge Summary */}
          <HedgeSummaryCard hedge={displayHedge} />

          {/* PnL Comparison */}
          <HedgePnLComparison
            positionUnrealizedPnl={positionUnrealizedPnl}
            positionRealizedPnl={positionRealizedPnl}
            hedgeUnrealizedPnl={displayHedge.unrealizedPnl}
            hedgeRealizedPnl={displayHedge.realizedPnl}
            quoteTokenSymbol={quoteTokenSymbol}
            quoteTokenDecimals={quoteTokenDecimals}
          />

          {/* Hedge Metrics */}
          <HedgeMetricsCard
            hedge={displayHedge}
            targetBaseAssetAmount={baseAssetAmount}
            baseAssetDecimals={baseAssetDecimals}
            riskBaseSymbol={riskBaseSymbol}
            quoteTokenSymbol={quoteTokenSymbol}
            quoteTokenDecimals={quoteTokenDecimals}
          />

          {/* Adjustment Controls */}
          <HedgeAdjustmentControls
            hedge={displayHedge}
            targetBaseAssetAmount={baseAssetAmount}
            baseAssetDecimals={baseAssetDecimals}
            riskBaseSymbol={riskBaseSymbol}
            currentPrice={currentPrice}
          />

          {/* Hedge Ledger */}
          <HedgeLedgerTable
            events={displayEvents}
            isLoading={isLoading}
            quoteTokenSymbol={quoteTokenSymbol}
            quoteTokenDecimals={quoteTokenDecimals}
            riskBaseSymbol={riskBaseSymbol}
          />
        </div>
      ) : (
        // No Hedge - Show Create Form
        <HedgeCreateForm
          baseAssetAmount={baseAssetAmount}
          baseAssetDecimals={baseAssetDecimals}
          baseAssetSymbol={baseAssetSymbol}
          quoteTokenSymbol={quoteTokenSymbol}
          riskBaseSymbol={riskBaseSymbol}
          riskQuoteSymbol={riskQuoteSymbol}
          currentPrice={currentPrice}
        />
      )}
    </div>
  );
}
