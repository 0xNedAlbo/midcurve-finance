/**
 * UniswapV3 Vault Ledger Event State
 *
 * Discriminated union of vault-specific event data.
 * Each event type carries its own fields alongside the common base.
 */

// ============================================================================
// COMMON BASE
// ============================================================================

export interface UniswapV3VaultLedgerEventStateBase {
  /** Pool price in quote token units at event time */
  poolPrice: bigint;
  /** Token0 amount involved in this event */
  token0Amount: bigint;
  /** Token1 amount involved in this event */
  token1Amount: bigint;
}

// ============================================================================
// EVENT-SPECIFIC INTERFACES
// ============================================================================

export interface UniswapV3VaultMintEvent extends UniswapV3VaultLedgerEventStateBase {
  eventType: 'VAULT_MINT';
  /** Shares minted (Transfer value from 0x0 → owner) */
  shares: bigint;
}

export interface UniswapV3VaultBurnEvent extends UniswapV3VaultLedgerEventStateBase {
  eventType: 'VAULT_BURN';
  /** Shares burned (Transfer value from owner → 0x0) */
  shares: bigint;
}

export interface UniswapV3VaultCollectYieldEvent extends UniswapV3VaultLedgerEventStateBase {
  eventType: 'VAULT_COLLECT_YIELD';
  fee0: bigint;
  fee1: bigint;
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

// ============================================================================
// UNION TYPE
// ============================================================================

export type UniswapV3VaultLedgerEventState =
  | UniswapV3VaultMintEvent
  | UniswapV3VaultBurnEvent
  | UniswapV3VaultCollectYieldEvent
  | UniswapV3VaultTransferInEvent
  | UniswapV3VaultTransferOutEvent;

// ============================================================================
// JSON TYPES
// ============================================================================

export interface UniswapV3VaultLedgerEventStateBaseJSON {
  poolPrice: string;
  token0Amount: string;
  token1Amount: string;
}

export type UniswapV3VaultLedgerEventStateJSON =
  | (UniswapV3VaultLedgerEventStateBaseJSON & {
      eventType: 'VAULT_MINT';
      shares: string;
    })
  | (UniswapV3VaultLedgerEventStateBaseJSON & {
      eventType: 'VAULT_BURN';
      shares: string;
    })
  | (UniswapV3VaultLedgerEventStateBaseJSON & {
      eventType: 'VAULT_COLLECT_YIELD';
      fee0: string;
      fee1: string;
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
    });

// ============================================================================
// SERIALIZATION HELPERS
// ============================================================================

function baseToJSON(state: UniswapV3VaultLedgerEventStateBase): UniswapV3VaultLedgerEventStateBaseJSON {
  return {
    poolPrice: state.poolPrice.toString(),
    token0Amount: state.token0Amount.toString(),
    token1Amount: state.token1Amount.toString(),
  };
}

function baseFromJSON(json: UniswapV3VaultLedgerEventStateBaseJSON): UniswapV3VaultLedgerEventStateBase {
  return {
    poolPrice: BigInt(json.poolPrice),
    token0Amount: BigInt(json.token0Amount),
    token1Amount: BigInt(json.token1Amount),
  };
}

export function vaultLedgerEventStateToJSON(
  state: UniswapV3VaultLedgerEventState
): UniswapV3VaultLedgerEventStateJSON {
  const base = baseToJSON(state);
  switch (state.eventType) {
    case 'VAULT_MINT':
      return { ...base, eventType: 'VAULT_MINT', shares: state.shares.toString() };
    case 'VAULT_BURN':
      return { ...base, eventType: 'VAULT_BURN', shares: state.shares.toString() };
    case 'VAULT_COLLECT_YIELD':
      return { ...base, eventType: 'VAULT_COLLECT_YIELD', fee0: state.fee0.toString(), fee1: state.fee1.toString() };
    case 'VAULT_TRANSFER_IN':
      return { ...base, eventType: 'VAULT_TRANSFER_IN', shares: state.shares.toString(), from: state.from };
    case 'VAULT_TRANSFER_OUT':
      return { ...base, eventType: 'VAULT_TRANSFER_OUT', shares: state.shares.toString(), to: state.to };
  }
}

export function vaultLedgerEventStateFromJSON(
  json: UniswapV3VaultLedgerEventStateJSON
): UniswapV3VaultLedgerEventState {
  const base = baseFromJSON(json);
  switch (json.eventType) {
    case 'VAULT_MINT':
      return { ...base, eventType: 'VAULT_MINT', shares: BigInt(json.shares) };
    case 'VAULT_BURN':
      return { ...base, eventType: 'VAULT_BURN', shares: BigInt(json.shares) };
    case 'VAULT_COLLECT_YIELD':
      return { ...base, eventType: 'VAULT_COLLECT_YIELD', fee0: BigInt(json.fee0), fee1: BigInt(json.fee1) };
    case 'VAULT_TRANSFER_IN':
      return { ...base, eventType: 'VAULT_TRANSFER_IN', shares: BigInt(json.shares), from: json.from };
    case 'VAULT_TRANSFER_OUT':
      return { ...base, eventType: 'VAULT_TRANSFER_OUT', shares: BigInt(json.shares), to: json.to };
  }
}
