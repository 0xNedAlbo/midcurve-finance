/**
 * Uniswap V3 Ledger Event State Types
 *
 * Raw event data from the blockchain (log data, event parameters, etc.).
 * State is a union type representing different event types from the NFT Position Manager.
 */

// ============================================================================
// INCREASE LIQUIDITY EVENT
// ============================================================================

/**
 * UniswapV3IncreaseLiquidityEvent
 *
 * Emitted when liquidity is added to a position.
 */
export interface UniswapV3IncreaseLiquidityEvent {
  /** Event type discriminator */
  eventType: 'INCREASE_LIQUIDITY';

  /** NFT token ID */
  tokenId: bigint;

  /** Amount of liquidity added */
  liquidity: bigint;

  /** Amount of token0 deposited */
  amount0: bigint;

  /** Amount of token1 deposited */
  amount1: bigint;
}

// ============================================================================
// DECREASE LIQUIDITY EVENT
// ============================================================================

/**
 * UniswapV3DecreaseLiquidityEvent
 *
 * Emitted when liquidity is removed from a position.
 */
export interface UniswapV3DecreaseLiquidityEvent {
  /** Event type discriminator */
  eventType: 'DECREASE_LIQUIDITY';

  /** NFT token ID */
  tokenId: bigint;

  /** Amount of liquidity removed */
  liquidity: bigint;

  /** Amount of token0 removed from position */
  amount0: bigint;

  /** Amount of token1 removed from position */
  amount1: bigint;
}

// ============================================================================
// COLLECT EVENT
// ============================================================================

/**
 * UniswapV3CollectEvent
 *
 * Emitted when tokens (fees + principal) are collected from a position.
 */
export interface UniswapV3CollectEvent {
  /** Event type discriminator */
  eventType: 'COLLECT';

  /** NFT token ID */
  tokenId: bigint;

  /** Recipient address */
  recipient: string;

  /** Amount of token0 collected (principal + fees) */
  amount0: bigint;

  /** Amount of token1 collected (principal + fees) */
  amount1: bigint;
}

// ============================================================================
// MINT EVENT (Lifecycle)
// ============================================================================

/**
 * UniswapV3MintEvent
 *
 * ERC-721 Transfer from address(0) — position NFT created.
 * Lifecycle event with no liquidity change.
 */
export interface UniswapV3MintEvent {
  /** Event type discriminator */
  eventType: 'MINT';

  /** NFT token ID */
  tokenId: bigint;

  /** Recipient address (the position owner) */
  to: string;
}

// ============================================================================
// BURN EVENT (Lifecycle)
// ============================================================================

/**
 * UniswapV3BurnEvent
 *
 * ERC-721 Transfer to address(0) — position NFT destroyed.
 * Lifecycle event with no liquidity change.
 */
export interface UniswapV3BurnEvent {
  /** Event type discriminator */
  eventType: 'BURN';

  /** NFT token ID */
  tokenId: bigint;

  /** Previous owner address */
  from: string;
}

// ============================================================================
// TRANSFER EVENT (Lifecycle)
// ============================================================================

/**
 * UniswapV3TransferEvent
 *
 * ERC-721 Transfer between non-zero addresses — ownership change.
 * Lifecycle event with no liquidity change.
 */
export interface UniswapV3TransferEvent {
  /** Event type discriminator */
  eventType: 'TRANSFER';

  /** NFT token ID */
  tokenId: bigint;

  /** Previous owner address */
  from: string;

  /** New owner address */
  to: string;
}

// ============================================================================
// UNION TYPE
// ============================================================================

/**
 * UniswapV3LedgerEventState
 *
 * Union type representing all event types from the NFT Position Manager.
 * Discriminated by `eventType` field for type narrowing.
 */
export type UniswapV3LedgerEventState =
  | UniswapV3IncreaseLiquidityEvent
  | UniswapV3DecreaseLiquidityEvent
  | UniswapV3CollectEvent
  | UniswapV3MintEvent
  | UniswapV3BurnEvent
  | UniswapV3TransferEvent;

// ============================================================================
// JSON INTERFACES
// ============================================================================

/**
 * JSON representation of IncreaseLiquidity event.
 */
export interface UniswapV3IncreaseLiquidityEventJSON {
  eventType: 'INCREASE_LIQUIDITY';
  tokenId: string;
  liquidity: string;
  amount0: string;
  amount1: string;
}

/**
 * JSON representation of DecreaseLiquidity event.
 */
export interface UniswapV3DecreaseLiquidityEventJSON {
  eventType: 'DECREASE_LIQUIDITY';
  tokenId: string;
  liquidity: string;
  amount0: string;
  amount1: string;
}

/**
 * JSON representation of Collect event.
 */
export interface UniswapV3CollectEventJSON {
  eventType: 'COLLECT';
  tokenId: string;
  recipient: string;
  amount0: string;
  amount1: string;
}

/**
 * JSON representation of Mint event.
 */
export interface UniswapV3MintEventJSON {
  eventType: 'MINT';
  tokenId: string;
  to: string;
}

/**
 * JSON representation of Burn event.
 */
export interface UniswapV3BurnEventJSON {
  eventType: 'BURN';
  tokenId: string;
  from: string;
}

/**
 * JSON representation of Transfer event.
 */
export interface UniswapV3TransferEventJSON {
  eventType: 'TRANSFER';
  tokenId: string;
  from: string;
  to: string;
}

/**
 * Union type for JSON state.
 */
export type UniswapV3LedgerEventStateJSON =
  | UniswapV3IncreaseLiquidityEventJSON
  | UniswapV3DecreaseLiquidityEventJSON
  | UniswapV3CollectEventJSON
  | UniswapV3MintEventJSON
  | UniswapV3BurnEventJSON
  | UniswapV3TransferEventJSON;

// ============================================================================
// SERIALIZATION HELPERS
// ============================================================================

/**
 * Convert state to JSON for API responses.
 */
export function ledgerEventStateToJSON(
  state: UniswapV3LedgerEventState
): UniswapV3LedgerEventStateJSON {
  switch (state.eventType) {
    case 'INCREASE_LIQUIDITY':
      return {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: state.tokenId.toString(),
        liquidity: state.liquidity.toString(),
        amount0: state.amount0.toString(),
        amount1: state.amount1.toString(),
      };
    case 'DECREASE_LIQUIDITY':
      return {
        eventType: 'DECREASE_LIQUIDITY',
        tokenId: state.tokenId.toString(),
        liquidity: state.liquidity.toString(),
        amount0: state.amount0.toString(),
        amount1: state.amount1.toString(),
      };
    case 'COLLECT':
      return {
        eventType: 'COLLECT',
        tokenId: state.tokenId.toString(),
        recipient: state.recipient,
        amount0: state.amount0.toString(),
        amount1: state.amount1.toString(),
      };
    case 'MINT':
      return {
        eventType: 'MINT',
        tokenId: state.tokenId.toString(),
        to: state.to,
      };
    case 'BURN':
      return {
        eventType: 'BURN',
        tokenId: state.tokenId.toString(),
        from: state.from,
      };
    case 'TRANSFER':
      return {
        eventType: 'TRANSFER',
        tokenId: state.tokenId.toString(),
        from: state.from,
        to: state.to,
      };
  }
}

/**
 * Create state from JSON (database or API input).
 */
export function ledgerEventStateFromJSON(
  json: UniswapV3LedgerEventStateJSON
): UniswapV3LedgerEventState {
  switch (json.eventType) {
    case 'INCREASE_LIQUIDITY':
      return {
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: BigInt(json.tokenId),
        liquidity: BigInt(json.liquidity),
        amount0: BigInt(json.amount0),
        amount1: BigInt(json.amount1),
      };
    case 'DECREASE_LIQUIDITY':
      return {
        eventType: 'DECREASE_LIQUIDITY',
        tokenId: BigInt(json.tokenId),
        liquidity: BigInt(json.liquidity),
        amount0: BigInt(json.amount0),
        amount1: BigInt(json.amount1),
      };
    case 'COLLECT':
      return {
        eventType: 'COLLECT',
        tokenId: BigInt(json.tokenId),
        recipient: json.recipient,
        amount0: BigInt(json.amount0),
        amount1: BigInt(json.amount1),
      };
    case 'MINT':
      return {
        eventType: 'MINT',
        tokenId: BigInt(json.tokenId),
        to: json.to,
      };
    case 'BURN':
      return {
        eventType: 'BURN',
        tokenId: BigInt(json.tokenId),
        from: json.from,
      };
    case 'TRANSFER':
      return {
        eventType: 'TRANSFER',
        tokenId: BigInt(json.tokenId),
        from: json.from,
        to: json.to,
      };
  }
}
