/**
 * UniswapV3 Staking Ledger Event State
 *
 * Discriminated union of staking-vault event-specific data.
 * Four event types:
 * - STAKING_DEPOSIT — initial Stake or top-up Stake
 * - STAKING_DISPOSE — Swap (executor settlement) or FlashClose (owner exit)
 * - STAKING_YIELD_TARGET_SET — marker (no financial impact)
 * - STAKING_PENDING_BPS_SET — marker (no financial impact)
 */

// ============================================================================
// COMMON BASE
// ============================================================================

export interface UniswapV3StakingLedgerEventStateBase {
  /** Pool sqrtPriceX96 (Q64.96) at event time */
  poolPrice: bigint;
  /** Token amounts involved in this event ([token0Amount, token1Amount]) */
  tokenAmounts: bigint[];
}

// ============================================================================
// EVENT-SPECIFIC INTERFACES
// ============================================================================

export interface UniswapV3StakingDepositEvent
  extends UniswapV3StakingLedgerEventStateBase {
  eventType: 'STAKING_DEPOSIT';
  /** True for the initial Stake, false for a top-up Stake */
  isInitial: boolean;
  /** Owner address (= position owner; vaults are owner-bound 1:1) */
  owner: string;
  /** Base-token amount deposited */
  baseAmount: bigint;
  /** Quote-token amount deposited */
  quoteAmount: bigint;
  /** Yield target supplied with the stake (initial: total; top-up: same as before, contract semantics) */
  yieldTarget: bigint;
  /** NFT token id minted by the vault */
  underlyingTokenId: number;
}

export interface UniswapV3StakingDisposeEvent
  extends UniswapV3StakingLedgerEventStateBase {
  eventType: 'STAKING_DISPOSE';
  /** Source of the dispose ('swap' or 'flashClose') */
  source: 'swap' | 'flashClose';
  /** Effective bps applied (1..10000) */
  effectiveBps: number;
  /** Address that triggered the dispose:
   *  - Swap: executor
   *  - FlashClose: owner */
  initiator: string;
  /** Principal portion (base) returned to unstakeBuffer */
  principalBase: bigint;
  /** Principal portion (quote) returned to unstakeBuffer */
  principalQuote: bigint;
  /** Yield portion (base) returned to rewardBuffer */
  yieldBase: bigint;
  /** Yield portion (quote) returned to rewardBuffer */
  yieldQuote: bigint;
  /** For source='swap': tokenIn/tokenOut/amountIn/amountOut from the Swap event payload.
   *  For source='flashClose': zeros (no executor swap leg). */
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOut: bigint;
}

export interface UniswapV3StakingYieldTargetSetEvent
  extends UniswapV3StakingLedgerEventStateBase {
  eventType: 'STAKING_YIELD_TARGET_SET';
  owner: string;
  oldTarget: bigint;
  newTarget: bigint;
}

export interface UniswapV3StakingPendingBpsSetEvent
  extends UniswapV3StakingLedgerEventStateBase {
  eventType: 'STAKING_PENDING_BPS_SET';
  owner: string;
  oldBps: number;
  newBps: number;
}

// ============================================================================
// UNION TYPE
// ============================================================================

export type UniswapV3StakingLedgerEventState =
  | UniswapV3StakingDepositEvent
  | UniswapV3StakingDisposeEvent
  | UniswapV3StakingYieldTargetSetEvent
  | UniswapV3StakingPendingBpsSetEvent;

// ============================================================================
// JSON TYPES
// ============================================================================

export interface UniswapV3StakingLedgerEventStateBaseJSON {
  poolPrice: string;
  tokenAmounts: string[];
}

export type UniswapV3StakingLedgerEventStateJSON =
  | (UniswapV3StakingLedgerEventStateBaseJSON & {
      eventType: 'STAKING_DEPOSIT';
      isInitial: boolean;
      owner: string;
      baseAmount: string;
      quoteAmount: string;
      yieldTarget: string;
      underlyingTokenId: number;
    })
  | (UniswapV3StakingLedgerEventStateBaseJSON & {
      eventType: 'STAKING_DISPOSE';
      source: 'swap' | 'flashClose';
      effectiveBps: number;
      initiator: string;
      principalBase: string;
      principalQuote: string;
      yieldBase: string;
      yieldQuote: string;
      tokenIn: string;
      tokenOut: string;
      amountIn: string;
      amountOut: string;
    })
  | (UniswapV3StakingLedgerEventStateBaseJSON & {
      eventType: 'STAKING_YIELD_TARGET_SET';
      owner: string;
      oldTarget: string;
      newTarget: string;
    })
  | (UniswapV3StakingLedgerEventStateBaseJSON & {
      eventType: 'STAKING_PENDING_BPS_SET';
      owner: string;
      oldBps: number;
      newBps: number;
    });

// ============================================================================
// SERIALIZATION HELPERS
// ============================================================================

function baseToJSON(
  state: UniswapV3StakingLedgerEventStateBase,
): UniswapV3StakingLedgerEventStateBaseJSON {
  return {
    poolPrice: state.poolPrice.toString(),
    tokenAmounts: state.tokenAmounts.map((a) => a.toString()),
  };
}

function baseFromJSON(
  json: UniswapV3StakingLedgerEventStateBaseJSON,
): UniswapV3StakingLedgerEventStateBase {
  return {
    poolPrice: BigInt(json.poolPrice),
    tokenAmounts: json.tokenAmounts.map((a) => BigInt(a)),
  };
}

export function stakingLedgerEventStateToJSON(
  state: UniswapV3StakingLedgerEventState,
): UniswapV3StakingLedgerEventStateJSON {
  const base = baseToJSON(state);
  switch (state.eventType) {
    case 'STAKING_DEPOSIT':
      return {
        ...base,
        eventType: 'STAKING_DEPOSIT',
        isInitial: state.isInitial,
        owner: state.owner,
        baseAmount: state.baseAmount.toString(),
        quoteAmount: state.quoteAmount.toString(),
        yieldTarget: state.yieldTarget.toString(),
        underlyingTokenId: state.underlyingTokenId,
      };
    case 'STAKING_DISPOSE':
      return {
        ...base,
        eventType: 'STAKING_DISPOSE',
        source: state.source,
        effectiveBps: state.effectiveBps,
        initiator: state.initiator,
        principalBase: state.principalBase.toString(),
        principalQuote: state.principalQuote.toString(),
        yieldBase: state.yieldBase.toString(),
        yieldQuote: state.yieldQuote.toString(),
        tokenIn: state.tokenIn,
        tokenOut: state.tokenOut,
        amountIn: state.amountIn.toString(),
        amountOut: state.amountOut.toString(),
      };
    case 'STAKING_YIELD_TARGET_SET':
      return {
        ...base,
        eventType: 'STAKING_YIELD_TARGET_SET',
        owner: state.owner,
        oldTarget: state.oldTarget.toString(),
        newTarget: state.newTarget.toString(),
      };
    case 'STAKING_PENDING_BPS_SET':
      return {
        ...base,
        eventType: 'STAKING_PENDING_BPS_SET',
        owner: state.owner,
        oldBps: state.oldBps,
        newBps: state.newBps,
      };
  }
}

export function stakingLedgerEventStateFromJSON(
  json: UniswapV3StakingLedgerEventStateJSON,
): UniswapV3StakingLedgerEventState {
  const base = baseFromJSON(json);
  switch (json.eventType) {
    case 'STAKING_DEPOSIT':
      return {
        ...base,
        eventType: 'STAKING_DEPOSIT',
        isInitial: json.isInitial,
        owner: json.owner,
        baseAmount: BigInt(json.baseAmount),
        quoteAmount: BigInt(json.quoteAmount),
        yieldTarget: BigInt(json.yieldTarget),
        underlyingTokenId: json.underlyingTokenId,
      };
    case 'STAKING_DISPOSE':
      return {
        ...base,
        eventType: 'STAKING_DISPOSE',
        source: json.source,
        effectiveBps: json.effectiveBps,
        initiator: json.initiator,
        principalBase: BigInt(json.principalBase),
        principalQuote: BigInt(json.principalQuote),
        yieldBase: BigInt(json.yieldBase),
        yieldQuote: BigInt(json.yieldQuote),
        tokenIn: json.tokenIn,
        tokenOut: json.tokenOut,
        amountIn: BigInt(json.amountIn),
        amountOut: BigInt(json.amountOut),
      };
    case 'STAKING_YIELD_TARGET_SET':
      return {
        ...base,
        eventType: 'STAKING_YIELD_TARGET_SET',
        owner: json.owner,
        oldTarget: BigInt(json.oldTarget),
        newTarget: BigInt(json.newTarget),
      };
    case 'STAKING_PENDING_BPS_SET':
      return {
        ...base,
        eventType: 'STAKING_PENDING_BPS_SET',
        owner: json.owner,
        oldBps: json.oldBps,
        newBps: json.newBps,
      };
  }
}
