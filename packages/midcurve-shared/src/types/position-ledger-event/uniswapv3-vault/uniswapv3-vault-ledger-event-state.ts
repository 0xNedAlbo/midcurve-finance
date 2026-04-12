/**
 * UniswapV3 Vault Ledger Event State
 *
 * Discriminated union of vault-specific event data.
 * Each event type carries its own fields alongside the common base.
 *
 * Uses tokenAmounts[] arrays to align with the IMultiTokenVault interface
 * where tokenAmounts[0] = token0 amount, tokenAmounts[1] = token1 amount.
 */

// ============================================================================
// COMMON BASE
// ============================================================================

export interface UniswapV3VaultLedgerEventStateBase {
  /** Pool price in quote token units at event time */
  poolPrice: bigint;
  /** Token amounts involved in this event, indexed by token position (0=token0, 1=token1) */
  tokenAmounts: bigint[];
}

// ============================================================================
// EVENT-SPECIFIC INTERFACES
// ============================================================================

export interface UniswapV3VaultMintEvent extends UniswapV3VaultLedgerEventStateBase {
  eventType: 'VAULT_MINT';
  /** Shares minted */
  shares: bigint;
  /** Address that initiated the mint and provided the tokens */
  minter: string;
  /** Address that received the minted shares */
  recipient: string;
}

export interface UniswapV3VaultBurnEvent extends UniswapV3VaultLedgerEventStateBase {
  eventType: 'VAULT_BURN';
  /** Shares burned */
  shares: bigint;
  /** Address that burned the shares */
  burner: string;
  /** Address that received the redeemed token amounts */
  recipient: string;
}

export interface UniswapV3VaultCollectYieldEvent extends UniswapV3VaultLedgerEventStateBase {
  eventType: 'VAULT_COLLECT_YIELD';
  /** Address whose yield entitlement was collected */
  user: string;
  /** Address that received the yield tokens */
  recipient: string;
}

export interface UniswapV3VaultTransferInEvent extends UniswapV3VaultLedgerEventStateBase {
  eventType: 'VAULT_TRANSFER_IN';
  shares: bigint;
  from: string;
}

export interface UniswapV3VaultTransferOutEvent extends UniswapV3VaultLedgerEventStateBase {
  eventType: 'VAULT_TRANSFER_OUT';
  shares: bigint;
  to: string;
}

export interface UniswapV3VaultCloseOrderExecutedEvent extends UniswapV3VaultLedgerEventStateBase {
  eventType: 'VAULT_CLOSE_ORDER_EXECUTED';
  /** Shares closed by the order */
  shares: bigint;
  /** Address that received the final payout */
  payout: string;
  /** Pool tick at execution time */
  executionTick: number;
  /** Raw token amounts from vault burn (before fees/swap) */
  amount0Out: bigint;
  amount1Out: bigint;
  /** Operator fee amounts (0 if none) */
  feeAmount0: bigint;
  feeAmount1: bigint;
  /** Operator fee in basis points */
  feeBps: number;
  /** Total swap input across all phases (0 if no swap) */
  swapAmountIn: bigint;
  /** Total swap output across all phases */
  swapAmountOut: bigint;
  /** Net proceeds after fees and swap */
  finalAmount0: bigint;
  finalAmount1: bigint;
}

// ============================================================================
// UNION TYPE
// ============================================================================

export type UniswapV3VaultLedgerEventState =
  | UniswapV3VaultMintEvent
  | UniswapV3VaultBurnEvent
  | UniswapV3VaultCollectYieldEvent
  | UniswapV3VaultTransferInEvent
  | UniswapV3VaultTransferOutEvent
  | UniswapV3VaultCloseOrderExecutedEvent;

// ============================================================================
// JSON TYPES
// ============================================================================

export interface UniswapV3VaultLedgerEventStateBaseJSON {
  poolPrice: string;
  tokenAmounts: string[];
}

export type UniswapV3VaultLedgerEventStateJSON =
  | (UniswapV3VaultLedgerEventStateBaseJSON & {
      eventType: 'VAULT_MINT';
      shares: string;
      minter: string;
      recipient: string;
    })
  | (UniswapV3VaultLedgerEventStateBaseJSON & {
      eventType: 'VAULT_BURN';
      shares: string;
      burner: string;
      recipient: string;
    })
  | (UniswapV3VaultLedgerEventStateBaseJSON & {
      eventType: 'VAULT_COLLECT_YIELD';
      user: string;
      recipient: string;
    })
  | (UniswapV3VaultLedgerEventStateBaseJSON & {
      eventType: 'VAULT_TRANSFER_IN';
      shares: string;
      from: string;
    })
  | (UniswapV3VaultLedgerEventStateBaseJSON & {
      eventType: 'VAULT_TRANSFER_OUT';
      shares: string;
      to: string;
    })
  | (UniswapV3VaultLedgerEventStateBaseJSON & {
      eventType: 'VAULT_CLOSE_ORDER_EXECUTED';
      shares: string;
      payout: string;
      executionTick: number;
      amount0Out: string;
      amount1Out: string;
      feeAmount0: string;
      feeAmount1: string;
      feeBps: number;
      swapAmountIn: string;
      swapAmountOut: string;
      finalAmount0: string;
      finalAmount1: string;
    });

// ============================================================================
// SERIALIZATION HELPERS
// ============================================================================

function baseToJSON(state: UniswapV3VaultLedgerEventStateBase): UniswapV3VaultLedgerEventStateBaseJSON {
  return {
    poolPrice: state.poolPrice.toString(),
    tokenAmounts: state.tokenAmounts.map((a) => a.toString()),
  };
}

function baseFromJSON(json: UniswapV3VaultLedgerEventStateBaseJSON): UniswapV3VaultLedgerEventStateBase {
  return {
    poolPrice: BigInt(json.poolPrice),
    tokenAmounts: json.tokenAmounts.map((a) => BigInt(a)),
  };
}

export function vaultLedgerEventStateToJSON(
  state: UniswapV3VaultLedgerEventState
): UniswapV3VaultLedgerEventStateJSON {
  const base = baseToJSON(state);
  switch (state.eventType) {
    case 'VAULT_MINT':
      return { ...base, eventType: 'VAULT_MINT', shares: state.shares.toString(), minter: state.minter, recipient: state.recipient };
    case 'VAULT_BURN':
      return { ...base, eventType: 'VAULT_BURN', shares: state.shares.toString(), burner: state.burner, recipient: state.recipient };
    case 'VAULT_COLLECT_YIELD':
      return { ...base, eventType: 'VAULT_COLLECT_YIELD', user: state.user, recipient: state.recipient };
    case 'VAULT_TRANSFER_IN':
      return { ...base, eventType: 'VAULT_TRANSFER_IN', shares: state.shares.toString(), from: state.from };
    case 'VAULT_TRANSFER_OUT':
      return { ...base, eventType: 'VAULT_TRANSFER_OUT', shares: state.shares.toString(), to: state.to };
    case 'VAULT_CLOSE_ORDER_EXECUTED':
      return {
        ...base, eventType: 'VAULT_CLOSE_ORDER_EXECUTED',
        shares: state.shares.toString(), payout: state.payout, executionTick: state.executionTick,
        amount0Out: state.amount0Out.toString(), amount1Out: state.amount1Out.toString(),
        feeAmount0: state.feeAmount0.toString(), feeAmount1: state.feeAmount1.toString(), feeBps: state.feeBps,
        swapAmountIn: state.swapAmountIn.toString(), swapAmountOut: state.swapAmountOut.toString(),
        finalAmount0: state.finalAmount0.toString(), finalAmount1: state.finalAmount1.toString(),
      };
  }
}

export function vaultLedgerEventStateFromJSON(
  json: UniswapV3VaultLedgerEventStateJSON
): UniswapV3VaultLedgerEventState {
  const base = baseFromJSON(json);
  switch (json.eventType) {
    case 'VAULT_MINT':
      return { ...base, eventType: 'VAULT_MINT', shares: BigInt(json.shares), minter: json.minter, recipient: json.recipient };
    case 'VAULT_BURN':
      return { ...base, eventType: 'VAULT_BURN', shares: BigInt(json.shares), burner: json.burner, recipient: json.recipient };
    case 'VAULT_COLLECT_YIELD':
      return { ...base, eventType: 'VAULT_COLLECT_YIELD', user: json.user, recipient: json.recipient };
    case 'VAULT_TRANSFER_IN':
      return { ...base, eventType: 'VAULT_TRANSFER_IN', shares: BigInt(json.shares), from: json.from };
    case 'VAULT_TRANSFER_OUT':
      return { ...base, eventType: 'VAULT_TRANSFER_OUT', shares: BigInt(json.shares), to: json.to };
    case 'VAULT_CLOSE_ORDER_EXECUTED':
      return {
        ...base, eventType: 'VAULT_CLOSE_ORDER_EXECUTED',
        shares: BigInt(json.shares), payout: json.payout, executionTick: json.executionTick,
        amount0Out: BigInt(json.amount0Out), amount1Out: BigInt(json.amount1Out),
        feeAmount0: BigInt(json.feeAmount0), feeAmount1: BigInt(json.feeAmount1), feeBps: json.feeBps,
        swapAmountIn: BigInt(json.swapAmountIn), swapAmountOut: BigInt(json.swapAmountOut),
        finalAmount0: BigInt(json.finalAmount0), finalAmount1: BigInt(json.finalAmount1),
      };
  }
}
