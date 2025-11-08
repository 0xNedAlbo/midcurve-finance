/**
 * Position Ledger Event State Mapping
 *
 * Maps protocol identifiers to their state types.
 * Protocol-specific state definitions are in their respective directories
 * (e.g., uniswapv3/position-ledger-event-state.ts).
 *
 * This file only contains the mapping - keep it lightweight as more protocols are added.
 */

import type { UniswapV3LedgerEventState } from './uniswapv3/position-ledger-event-state.js';

// Re-export for convenience
export type {
  UniswapV3LedgerEventState,
  UniswapV3IncreaseLiquidityEvent,
  UniswapV3DecreaseLiquidityEvent,
  UniswapV3CollectEvent,
} from './uniswapv3/position-ledger-event-state.js';

/**
 * Position Ledger Event State Map
 *
 * Maps protocol identifiers to their state types.
 * Used by generic PositionLedgerEvent<P> for type safety.
 *
 * To add a new protocol:
 * 1. Create protocol-specific state in xxx/position-ledger-event-state.ts
 * 2. Import the state type here
 * 3. Add entry to this map
 * 4. Add corresponding entry to PositionLedgerEventConfigMap
 *
 * @example
 * ```typescript
 * type State = PositionLedgerEventStateMap['uniswapv3']['state'];
 * // State is UniswapV3LedgerEventState
 * ```
 */
export interface PositionLedgerEventStateMap {
  uniswapv3: {
    /**
     * State type for Uniswap V3 ledger events
     */
    state: UniswapV3LedgerEventState;
  };
  // Future protocols:
  // orca: {
  //   state: OrcaLedgerEventState;
  // };
  // raydium: {
  //   state: RaydiumLedgerEventState;
  // };
  // pancakeswapv3: {
  //   state: PancakeSwapV3LedgerEventState;
  // };
}
