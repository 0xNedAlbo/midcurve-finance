/**
 * Midcurve Finance - Shared Services
 *
 * Business logic for concentrated liquidity position management
 * across multiple DEX protocols:
 * - Uniswap V3 (Ethereum)
 * - Orca (Solana)
 * - Raydium (Solana)
 * - PancakeSwap (BSC)
 */

// Re-export shared types from @midcurve/shared
// These are used across API, UI, and Workers
export * from '@midcurve/shared';

// Export utilities
export * from './utils/index.js';

// Export configuration
export * from './config/index.js';

// Export logging utilities
export * from './logging/index.js';

// Export clients
export * from './clients/index.js';

// Export services
export * from './services/auth/index.js';
export * from './services/user/index.js';
export * from './services/token/index.js';
export * from './services/pool/index.js';
export * from './services/pool-price/index.js';
export * from './services/position/index.js';
export * from './services/position-list/index.js';
export * from './services/position-ledger/index.js';
export * from './services/position-apr/index.js';
export * from './services/quote-token/index.js';
export * from './services/pool-discovery/index.js';
export * from './services/cache/index.js';
export * from './services/block/index.js';
export * from './services/strategy/index.js';
export * from './services/manifest-verification/index.js';
export * from './services/strategy-position/index.js';
export * from './services/strategy-ledger/index.js';
export * from './services/strategy-metrics/index.js';
export * from './services/strategy-position-metrics/index.js';
export * from './services/automation/index.js';
export * from './services/pnl-curve/index.js';
export * from './services/notifications/index.js';

// Export service types
export * from './services/types/auth/index.js';
export * from './services/types/block/index.js';
export * from './services/types/strategy/index.js';
export * from './services/types/automation/index.js';
export * from './services/types/notifications/index.js';

// Export domain events
export * from './events/index.js';

// Export message queue utilities
export * from './mq/index.js';

// Export auth utilities (specific exports to avoid conflicts)
export {
  validateAndNormalizeAddress,
  validateChainId,
  isSupportedChainId,
  CHAIN_NAMES,
} from './utils/auth/index.js';

export const version = '0.1.0';
