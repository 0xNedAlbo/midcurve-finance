/**
 * Hyperliquid Hedge DB Serialization
 *
 * Parse and serialize functions for Prisma JSON fields.
 * Uses Zod schemas for runtime validation.
 */

import type {
  HyperliquidPerpHedgeConfig,
  HyperliquidPerpHedgeState,
} from '@midcurve/shared';

import {
  hyperliquidPerpHedgeConfigSchema,
  hyperliquidPerpHedgeStateSchema,
  type HyperliquidPerpHedgeConfigDB,
  type HyperliquidPerpHedgeStateDB,
} from './hedge-schemas.js';

// =============================================================================
// Config Parse/Serialize
// =============================================================================

/**
 * Parse config JSON from database into typed object.
 *
 * @param json - Raw JSON from Prisma (unknown type)
 * @returns Validated and typed config object
 * @throws ZodError if validation fails
 */
export function parseHyperliquidPerpHedgeConfig(
  json: unknown
): HyperliquidPerpHedgeConfigDB {
  return hyperliquidPerpHedgeConfigSchema.parse(json);
}

/**
 * Safe parse that returns null on failure instead of throwing.
 */
export function safeParseHyperliquidPerpHedgeConfig(
  json: unknown
): HyperliquidPerpHedgeConfigDB | null {
  const result = hyperliquidPerpHedgeConfigSchema.safeParse(json);
  return result.success ? result.data : null;
}

/**
 * Serialize config object for database storage.
 *
 * Validates the object before returning to ensure consistency.
 *
 * @param config - Typed config object
 * @returns JSON-serializable object for Prisma
 */
export function serializeHyperliquidPerpHedgeConfig(
  config: HyperliquidPerpHedgeConfig
): HyperliquidPerpHedgeConfigDB {
  // Convert TypeScript interface to DB schema format
  const dbConfig: HyperliquidPerpHedgeConfigDB = {
    schemaVersion: 1,
    exchange: 'hyperliquid',
    environment: config.environment,
    dex: config.dex,
    account: {
      userAddress: config.account.userAddress,
      accountType: config.account.accountType,
      subAccountName: config.account.subAccountName,
    },
    market: {
      coin: config.market.coin,
      quote: config.market.quote,
      szDecimals: config.market.szDecimals,
      maxLeverageHint: config.market.maxLeverageHint,
      marginTableId: config.market.marginTableId,
    },
    hedgeParams: {
      direction: config.hedgeParams.direction,
      marginMode: config.hedgeParams.marginMode,
      targetNotionalUsd: config.hedgeParams.targetNotionalUsd,
      targetLeverage: config.hedgeParams.targetLeverage,
      reduceOnly: config.hedgeParams.reduceOnly,
    },
    riskLimits: config.riskLimits
      ? {
          maxLeverage: config.riskLimits.maxLeverage,
          maxSizeUsd: config.riskLimits.maxSizeUsd,
          stopLossPx: config.riskLimits.stopLossPx,
          takeProfitPx: config.riskLimits.takeProfitPx,
          rebalanceThresholdBps: config.riskLimits.rebalanceThresholdBps,
        }
      : undefined,
    links: config.links
      ? {
          positionProtocol: config.links.positionProtocol,
          positionChainId: config.links.positionChainId,
          positionPoolAddress: config.links.positionPoolAddress,
          positionNftId: config.links.positionNftId,
        }
      : undefined,
  };

  // Validate before returning
  return hyperliquidPerpHedgeConfigSchema.parse(dbConfig);
}

// =============================================================================
// State Parse/Serialize
// =============================================================================

/**
 * Parse state JSON from database into typed object.
 *
 * @param json - Raw JSON from Prisma (unknown type)
 * @returns Validated and typed state object
 * @throws ZodError if validation fails
 */
export function parseHyperliquidPerpHedgeState(
  json: unknown
): HyperliquidPerpHedgeStateDB {
  return hyperliquidPerpHedgeStateSchema.parse(json);
}

/**
 * Safe parse that returns null on failure instead of throwing.
 */
export function safeParseHyperliquidPerpHedgeState(
  json: unknown
): HyperliquidPerpHedgeStateDB | null {
  const result = hyperliquidPerpHedgeStateSchema.safeParse(json);
  return result.success ? result.data : null;
}

/**
 * Serialize state object for database storage.
 *
 * Validates the object before returning to ensure consistency.
 *
 * @param state - Typed state object
 * @returns JSON-serializable object for Prisma
 */
export function serializeHyperliquidPerpHedgeState(
  state: HyperliquidPerpHedgeState
): HyperliquidPerpHedgeStateDB {
  // Convert TypeScript interface to DB schema format
  const dbState: HyperliquidPerpHedgeStateDB = {
    schemaVersion: 1,
    lastSyncAt: state.lastSyncAt,
    lastSource: state.lastSource,
    positionStatus: state.positionStatus,
    position: state.position
      ? {
          coin: state.position.coin,
          szi: state.position.szi,
          side: state.position.side,
          absSize: state.position.absSize,
          entryPx: state.position.entryPx,
          markPx: state.position.markPx,
          indexPx: state.position.indexPx,
          liquidationPx: state.position.liquidationPx,
          value: {
            positionValue: state.position.value.positionValue,
            unrealizedPnl: state.position.value.unrealizedPnl,
            realizedPnl: state.position.value.realizedPnl,
            returnOnEquity: state.position.value.returnOnEquity,
          },
          leverage: {
            mode: state.position.leverage.mode,
            value: state.position.leverage.value,
            maxLeverage: state.position.leverage.maxLeverage,
            marginUsed: state.position.leverage.marginUsed,
          },
          funding: {
            cumFundingAllTime: state.position.funding.cumFundingAllTime,
            cumFundingSinceOpen: state.position.funding.cumFundingSinceOpen,
            cumFundingSinceChange: state.position.funding.cumFundingSinceChange,
            currentFundingRate: state.position.funding.currentFundingRate,
          },
          lastChangeTime: state.position.lastChangeTime,
        }
      : undefined,
    orders: {
      open: state.orders.open.map((order) => ({
        oid: order.oid,
        cloid: order.cloid,
        side: order.side,
        isReduceOnly: order.isReduceOnly,
        isPositionTpsl: order.isPositionTpsl,
        orderType: order.orderType,
        limitPx: order.limitPx,
        triggerPx: order.triggerPx,
        triggerCondition: order.triggerCondition,
        isTrigger: order.isTrigger,
        tif: order.tif,
        sz: order.sz,
        origSz: order.origSz,
        coin: order.coin,
        createdAt: order.createdAt,
        agentAddress: order.agentAddress,
        agentValidUntil: order.agentValidUntil,
      })),
      lastOrderCloid: state.orders.lastOrderCloid,
    },
    accountSnapshot: state.accountSnapshot
      ? {
          accountValue: state.accountSnapshot.accountValue,
          totalNtlPos: state.accountSnapshot.totalNtlPos,
          totalMarginUsed: state.accountSnapshot.totalMarginUsed,
          withdrawable: state.accountSnapshot.withdrawable,
        }
      : undefined,
    raw: state.raw
      ? {
          lastWebData2: state.raw.lastWebData2,
          lastClearinghouseState: state.raw.lastClearinghouseState,
        }
      : undefined,
  };

  // Validate before returning
  return hyperliquidPerpHedgeStateSchema.parse(dbState);
}

// =============================================================================
// Type Conversion Helpers
// =============================================================================

/**
 * Convert DB config to shared type (they are compatible).
 * This is essentially a type assertion with runtime validation.
 */
export function dbConfigToShared(
  dbConfig: HyperliquidPerpHedgeConfigDB
): HyperliquidPerpHedgeConfig {
  return dbConfig as HyperliquidPerpHedgeConfig;
}

/**
 * Convert DB state to shared type (they are compatible).
 * This is essentially a type assertion with runtime validation.
 */
export function dbStateToShared(
  dbState: HyperliquidPerpHedgeStateDB
): HyperliquidPerpHedgeState {
  return dbState as HyperliquidPerpHedgeState;
}
