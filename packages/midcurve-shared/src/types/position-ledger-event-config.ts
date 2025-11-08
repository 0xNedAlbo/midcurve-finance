/**
 * Position Ledger Event Config Mapping
 *
 * Maps protocol identifiers to their configuration types.
 * Protocol-specific config definitions are in their respective directories
 * (e.g., uniswapv3/position-ledger-event-config.ts).
 *
 * This file only contains the mapping - keep it lightweight as more protocols are added.
 */

import type { UniswapV3LedgerEventConfig } from './uniswapv3/position-ledger-event-config.js';

// Re-export for convenience
export type { UniswapV3LedgerEventConfig } from './uniswapv3/position-ledger-event-config.js';

/**
 * Position Ledger Event Config Map
 *
 * Maps protocol identifiers to their configuration types.
 * Used by generic PositionLedgerEvent<P> for type safety.
 *
 * To add a new protocol:
 * 1. Create protocol-specific config in xxx/position-ledger-event-config.ts
 * 2. Import the config type here
 * 3. Add entry to this map
 * 4. Add corresponding entry to PositionLedgerEventStateMap
 *
 * @example
 * ```typescript
 * type Config = PositionLedgerEventConfigMap['uniswapv3']['config'];
 * // Config is UniswapV3LedgerEventConfig
 * ```
 */
export interface PositionLedgerEventConfigMap {
  uniswapv3: {
    /**
     * Protocol identifier
     */
    protocol: 'uniswapv3';

    /**
     * Configuration type for Uniswap V3 ledger events
     */
    config: UniswapV3LedgerEventConfig;

    /**
     * Token type used by Uniswap V3 (ERC-20 tokens)
     */
    tokenType: 'erc20';
  };
  // Future protocols:
  // orca: {
  //   protocol: 'orca';
  //   config: OrcaLedgerEventConfig;
  //   tokenType: 'solana-spl';
  // };
  // raydium: {
  //   protocol: 'raydium';
  //   config: RaydiumLedgerEventConfig;
  //   tokenType: 'solana-spl';
  // };
  // pancakeswapv3: {
  //   protocol: 'pancakeswapv3';
  //   config: PancakeSwapV3LedgerEventConfig;
  //   tokenType: 'erc20';
  // };
}

/**
 * Protocol identifier for ledger events
 * Derived from PositionLedgerEventConfigMap keys for type safety
 */
export type LedgerEventProtocol = keyof PositionLedgerEventConfigMap;
