/**
 * Hyperliquid Hedge Zod Schemas
 *
 * Validates JSON stored in Prisma's config and state fields.
 * These schemas are used by the services layer for DB validation.
 */

import { z } from 'zod';

// =============================================================================
// Hedge Config Schema (Immutable)
// =============================================================================

/**
 * Hyperliquid Perp Hedge CONFIG (immutable per hedge)
 * Stored in Hedge.config (Prisma Json)
 */
export const hyperliquidPerpHedgeConfigSchema = z.object({
  schemaVersion: z.literal(1),

  exchange: z.literal('hyperliquid'),
  environment: z.union([z.literal('mainnet'), z.literal('testnet')]),
  dex: z.string(), // "" for default perp DEX

  account: z.object({
    userAddress: z.string(), // EVM address used on Hyperliquid
    accountType: z.union([
      z.literal('main'),
      z.literal('subaccount'),
      z.literal('apiWallet'),
      z.literal('multiSig'),
    ]),
    subAccountName: z.string().optional(), // one subaccount per hedge
  }),

  market: z.object({
    coin: z.string(), // e.g. "ETH"
    quote: z.string(), // e.g. "USD"
    szDecimals: z.number().int().optional(),
    maxLeverageHint: z.number().optional(),
    marginTableId: z.number().int().optional(),
  }),

  hedgeParams: z.object({
    direction: z.literal('short'), // this hedge is designed as a short-hedge
    marginMode: z.union([z.literal('cross'), z.literal('isolated')]),
    targetNotionalUsd: z.string(), // desired hedge size in quote units
    targetLeverage: z.number().optional(),
    reduceOnly: z.boolean(),
  }),

  riskLimits: z
    .object({
      maxLeverage: z.number().optional(),
      maxSizeUsd: z.string().optional(),
      stopLossPx: z.string().optional(),
      takeProfitPx: z.string().optional(),
      rebalanceThresholdBps: z.number().int().optional(), // e.g. 500 = 5%
    })
    .optional(),

  links: z
    .object({
      // Optional link back to CL position
      positionProtocol: z.literal('uniswapv3').optional(),
      positionChainId: z.number().int().optional(),
      positionPoolAddress: z.string().optional(),
      positionNftId: z.string().optional(),
    })
    .optional(),
});

export type HyperliquidPerpHedgeConfigDB = z.infer<
  typeof hyperliquidPerpHedgeConfigSchema
>;

// =============================================================================
// Hedge State Schema (Mutable)
// =============================================================================

const hedgePositionSchema = z.object({
  coin: z.string(),
  szi: z.string(), // signed size (Hyperliquid szi)
  side: z.union([z.literal('long'), z.literal('short')]),
  absSize: z.string(), // |szi|

  entryPx: z.string(),
  markPx: z.string().optional(),
  indexPx: z.string().optional(),
  liquidationPx: z.string().optional(),

  value: z.object({
    positionValue: z.string(),
    unrealizedPnl: z.string(),
    realizedPnl: z.string(),
    returnOnEquity: z.string().optional(),
  }),

  leverage: z.object({
    mode: z.union([z.literal('cross'), z.literal('isolated')]),
    value: z.number(),
    maxLeverage: z.number().optional(),
    marginUsed: z.string(),
  }),

  funding: z.object({
    cumFundingAllTime: z.string(),
    cumFundingSinceOpen: z.string(),
    cumFundingSinceChange: z.string(),
    currentFundingRate: z.string().optional(),
  }),

  lastChangeTime: z.number().optional(), // millis timestamp
});

const hedgeOrderSchema = z.object({
  oid: z.number().int(),
  cloid: z.string().optional(),
  side: z.union([z.literal('buy'), z.literal('sell')]),
  isReduceOnly: z.boolean(),
  isPositionTpsl: z.boolean(),

  orderType: z.string(), // e.g. "Limit", "Market", "Trigger"
  limitPx: z.string(),
  triggerPx: z.string().optional(),
  triggerCondition: z.string().optional(),
  isTrigger: z.boolean(),
  tif: z.string(), // e.g. "Gtc"

  sz: z.string(),
  origSz: z.string().optional(),

  coin: z.string(),
  createdAt: z.number(), // millis timestamp
  agentAddress: z.string().optional(),
  agentValidUntil: z.number().optional(),
});

/**
 * Hyperliquid Perp Hedge STATE (mutable per hedge)
 * Stored in Hedge.state (Prisma Json)
 */
export const hyperliquidPerpHedgeStateSchema = z.object({
  schemaVersion: z.literal(1),

  lastSyncAt: z.string(), // ISO timestamp
  lastSource: z.union([
    z.literal('info.webData2'),
    z.literal('info.clearinghouseState'),
    z.literal('ws.webData2'),
  ]),

  positionStatus: z.union([
    z.literal('none'),
    z.literal('open'),
    z.literal('closing'),
    z.literal('closed'),
    z.literal('liquidated'),
  ]),

  position: hedgePositionSchema.optional(),

  orders: z.object({
    open: z.array(hedgeOrderSchema),
    lastOrderCloid: z.string().optional(),
  }),

  accountSnapshot: z
    .object({
      accountValue: z.string(),
      totalNtlPos: z.string(),
      totalMarginUsed: z.string(),
      withdrawable: z.string(),
    })
    .optional(),

  raw: z
    .object({
      lastWebData2: z.unknown().optional(),
      lastClearinghouseState: z.unknown().optional(),
    })
    .optional(),
});

export type HyperliquidPerpHedgeStateDB = z.infer<
  typeof hyperliquidPerpHedgeStateSchema
>;
