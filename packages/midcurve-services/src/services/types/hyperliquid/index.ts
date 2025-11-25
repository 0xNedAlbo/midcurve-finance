/**
 * Hyperliquid service types
 *
 * DB serialization types and Zod schemas for Hyperliquid hedge data.
 */

// Zod schemas for DB validation
export {
  hyperliquidPerpHedgeConfigSchema,
  hyperliquidPerpHedgeStateSchema,
  type HyperliquidPerpHedgeConfigDB,
  type HyperliquidPerpHedgeStateDB,
} from './hedge-schemas.js';

// DB parse/serialize functions
export {
  parseHyperliquidPerpHedgeConfig,
  safeParseHyperliquidPerpHedgeConfig,
  serializeHyperliquidPerpHedgeConfig,
  parseHyperliquidPerpHedgeState,
  safeParseHyperliquidPerpHedgeState,
  serializeHyperliquidPerpHedgeState,
  dbConfigToShared,
  dbStateToShared,
} from './hedge-db.js';
