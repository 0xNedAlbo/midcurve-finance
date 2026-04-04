/**
 * Uniswap V3 Ledger Event State Types
 *
 * Raw event data from the blockchain (log data, event parameters, etc.).
 * State is a union type representing different event types from the NFT Position Manager.
 */

// ============================================================================
// COMMON FIELDS (present on all event types)
// ============================================================================

/**
 * Common fields shared by all UniswapV3 ledger event state variants.
 * These are computed financial data stored alongside the raw event data.
 */
export interface UniswapV3LedgerEventStateBase {
  /** Pool price at event time in quote token units (bigint) */
  poolPrice: bigint;

  /** Token0 amount involved in this event (bigint) */
  token0Amount: bigint;

  /** Token1 amount involved in this event (bigint) */
  token1Amount: bigint;
}

// ============================================================================
// INCREASE LIQUIDITY EVENT
// ============================================================================

/**
 * UniswapV3IncreaseLiquidityEvent
 *
 * Emitted when liquidity is added to a position.
 */
export interface UniswapV3IncreaseLiquidityEvent extends UniswapV3LedgerEventStateBase {
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
export interface UniswapV3DecreaseLiquidityEvent extends UniswapV3LedgerEventStateBase {
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
export interface UniswapV3CollectEvent extends UniswapV3LedgerEventStateBase {
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
export interface UniswapV3MintEvent extends UniswapV3LedgerEventStateBase {
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
export interface UniswapV3BurnEvent extends UniswapV3LedgerEventStateBase {
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
export interface UniswapV3TransferEvent extends UniswapV3LedgerEventStateBase {
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
 * Common JSON fields shared by all event state variants.
 */
export interface UniswapV3LedgerEventStateBaseJSON {
  poolPrice: string;
  token0Amount: string;
  token1Amount: string;
}

/**
 * JSON representation of IncreaseLiquidity event.
 */
export interface UniswapV3IncreaseLiquidityEventJSON extends UniswapV3LedgerEventStateBaseJSON {
  eventType: 'INCREASE_LIQUIDITY';
  tokenId: string;
  liquidity: string;
  amount0: string;
  amount1: string;
}

/**
 * JSON representation of DecreaseLiquidity event.
 */
export interface UniswapV3DecreaseLiquidityEventJSON extends UniswapV3LedgerEventStateBaseJSON {
  eventType: 'DECREASE_LIQUIDITY';
  tokenId: string;
  liquidity: string;
  amount0: string;
  amount1: string;
}

/**
 * JSON representation of Collect event.
 */
export interface UniswapV3CollectEventJSON extends UniswapV3LedgerEventStateBaseJSON {
  eventType: 'COLLECT';
  tokenId: string;
  recipient: string;
  amount0: string;
  amount1: string;
}

/**
 * JSON representation of Mint event.
 */
export interface UniswapV3MintEventJSON extends UniswapV3LedgerEventStateBaseJSON {
  eventType: 'MINT';
  tokenId: string;
  to: string;
}

/**
 * JSON representation of Burn event.
 */
export interface UniswapV3BurnEventJSON extends UniswapV3LedgerEventStateBaseJSON {
  eventType: 'BURN';
  tokenId: string;
  from: string;
}

/**
 * JSON representation of Transfer event.
 */
export interface UniswapV3TransferEventJSON extends UniswapV3LedgerEventStateBaseJSON {
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
/**
 * Serialize the common base fields to JSON.
 */
function baseStateToJSON(state: UniswapV3LedgerEventStateBase): UniswapV3LedgerEventStateBaseJSON {
  return {
    poolPrice: state.poolPrice.toString(),
    token0Amount: state.token0Amount.toString(),
    token1Amount: state.token1Amount.toString(),
  };
}

export function ledgerEventStateToJSON(
  state: UniswapV3LedgerEventState
): UniswapV3LedgerEventStateJSON {
  const base = baseStateToJSON(state);
  switch (state.eventType) {
    case 'INCREASE_LIQUIDITY':
      return {
        ...base,
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: state.tokenId.toString(),
        liquidity: state.liquidity.toString(),
        amount0: state.amount0.toString(),
        amount1: state.amount1.toString(),
      };
    case 'DECREASE_LIQUIDITY':
      return {
        ...base,
        eventType: 'DECREASE_LIQUIDITY',
        tokenId: state.tokenId.toString(),
        liquidity: state.liquidity.toString(),
        amount0: state.amount0.toString(),
        amount1: state.amount1.toString(),
      };
    case 'COLLECT':
      return {
        ...base,
        eventType: 'COLLECT',
        tokenId: state.tokenId.toString(),
        recipient: state.recipient,
        amount0: state.amount0.toString(),
        amount1: state.amount1.toString(),
      };
    case 'MINT':
      return {
        ...base,
        eventType: 'MINT',
        tokenId: state.tokenId.toString(),
        to: state.to,
      };
    case 'BURN':
      return {
        ...base,
        eventType: 'BURN',
        tokenId: state.tokenId.toString(),
        from: state.from,
      };
    case 'TRANSFER':
      return {
        ...base,
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
/**
 * Parse the common base fields from JSON.
 */
function baseStateFromJSON(json: UniswapV3LedgerEventStateBaseJSON): UniswapV3LedgerEventStateBase {
  return {
    poolPrice: BigInt(json.poolPrice),
    token0Amount: BigInt(json.token0Amount),
    token1Amount: BigInt(json.token1Amount),
  };
}

export function ledgerEventStateFromJSON(
  json: UniswapV3LedgerEventStateJSON
): UniswapV3LedgerEventState {
  const base = baseStateFromJSON(json);
  switch (json.eventType) {
    case 'INCREASE_LIQUIDITY':
      return {
        ...base,
        eventType: 'INCREASE_LIQUIDITY',
        tokenId: BigInt(json.tokenId),
        liquidity: BigInt(json.liquidity),
        amount0: BigInt(json.amount0),
        amount1: BigInt(json.amount1),
      };
    case 'DECREASE_LIQUIDITY':
      return {
        ...base,
        eventType: 'DECREASE_LIQUIDITY',
        tokenId: BigInt(json.tokenId),
        liquidity: BigInt(json.liquidity),
        amount0: BigInt(json.amount0),
        amount1: BigInt(json.amount1),
      };
    case 'COLLECT':
      return {
        ...base,
        eventType: 'COLLECT',
        tokenId: BigInt(json.tokenId),
        recipient: json.recipient,
        amount0: BigInt(json.amount0),
        amount1: BigInt(json.amount1),
      };
    case 'MINT':
      return {
        ...base,
        eventType: 'MINT',
        tokenId: BigInt(json.tokenId),
        to: json.to,
      };
    case 'BURN':
      return {
        ...base,
        eventType: 'BURN',
        tokenId: BigInt(json.tokenId),
        from: json.from,
      };
    case 'TRANSFER':
      return {
        ...base,
        eventType: 'TRANSFER',
        tokenId: BigInt(json.tokenId),
        from: json.from,
        to: json.to,
      };
  }
}
