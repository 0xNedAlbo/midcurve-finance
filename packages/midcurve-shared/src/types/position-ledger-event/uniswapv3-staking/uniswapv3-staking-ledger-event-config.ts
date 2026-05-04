/**
 * UniswapV3 Staking Ledger Event Configuration
 *
 * Immutable metadata for a UniswapV3StakingVault position event.
 * Beyond the common blockchain coordinates, persists the principal/yield
 * split for STAKING_DISPOSE events (per SPEC-0003b §6.4) so the journal-posting
 * rule can post Model A entries without re-reading chain state.
 *
 * For STAKING_DEPOSIT events, the dispose-related fields are zero.
 */

// ============================================================================
// CONFIG INTERFACE
// ============================================================================

/**
 * Source of a STAKING_DISPOSE event.
 * - 'swap': permissionless executor settlement via vault.swap()
 * - 'flashClose': owner-driven exit via vault.flashClose()
 *   (synthesized from FlashCloseInitiated + auto-drained Unstake/ClaimRewards
 *    in the same transaction)
 */
export type StakingDisposeSource = 'swap' | 'flashClose';

export interface UniswapV3StakingLedgerEventConfig {
  /** EVM chain ID where event occurred */
  chainId: number;

  /** Vault contract address (EIP-55 checksummed) */
  vaultAddress: string;

  /** Block number where event occurred */
  blockNumber: bigint;

  /** Transaction index within the block */
  txIndex: number;

  /** Log index within the transaction */
  logIndex: number;

  /** Transaction hash */
  txHash: string;

  /** Block hash (for reorg detection) */
  blockHash: string;

  /** Liquidity delta from the event (positive for STAKING_DEPOSIT, negative for STAKING_DISPOSE, 0 for markers) */
  deltaL: bigint;

  /** Underlying NFT liquidity AFTER the event */
  liquidityAfter: bigint;

  /**
   * Effective bps used by the contract for this event.
   * - 10000 for full STAKING_DEPOSIT (initial / top-up)
   * - 1..10000 for STAKING_DISPOSE (the bps that was actually applied)
   * - 0 for marker events
   */
  effectiveBps: number;

  /** Pool sqrt price (Q64.96) at event block */
  sqrtPriceX96: bigint;

  // ---- Component split (populated for STAKING_DISPOSE only; 0 otherwise) ----

  /** Base-token portion of disposed principal (= unstakeBuffer base delta) */
  principalBaseDelta: bigint;
  /** Quote-token portion of disposed principal (= unstakeBuffer quote delta) */
  principalQuoteDelta: bigint;
  /** Base-token portion of disposed yield (= rewardBuffer base delta) */
  yieldBaseDelta: bigint;
  /** Quote-token portion of disposed yield (= rewardBuffer quote delta) */
  yieldQuoteDelta: bigint;
  /** Total principal value in quote-token units (= principalBaseDelta × P + principalQuoteDelta) */
  principalQuoteValue: bigint;
  /** Total yield value in quote-token units (= yieldBaseDelta × P + yieldQuoteDelta) */
  yieldQuoteValue: bigint;

  /** Source of the dispose event (only meaningful for STAKING_DISPOSE) */
  source: StakingDisposeSource | null;
}

// ============================================================================
// JSON INTERFACE
// ============================================================================

export interface UniswapV3StakingLedgerEventConfigJSON {
  chainId: number;
  vaultAddress: string;
  blockNumber: string;
  txIndex: number;
  logIndex: number;
  txHash: string;
  blockHash: string;
  deltaL: string;
  liquidityAfter: string;
  effectiveBps: number;
  sqrtPriceX96: string;
  principalBaseDelta: string;
  principalQuoteDelta: string;
  yieldBaseDelta: string;
  yieldQuoteDelta: string;
  principalQuoteValue: string;
  yieldQuoteValue: string;
  source: StakingDisposeSource | null;
}

// ============================================================================
// SERIALIZATION HELPERS
// ============================================================================

export function stakingLedgerEventConfigToJSON(
  config: UniswapV3StakingLedgerEventConfig,
): UniswapV3StakingLedgerEventConfigJSON {
  return {
    chainId: config.chainId,
    vaultAddress: config.vaultAddress,
    blockNumber: config.blockNumber.toString(),
    txIndex: config.txIndex,
    logIndex: config.logIndex,
    txHash: config.txHash,
    blockHash: config.blockHash,
    deltaL: config.deltaL.toString(),
    liquidityAfter: config.liquidityAfter.toString(),
    effectiveBps: config.effectiveBps,
    sqrtPriceX96: config.sqrtPriceX96.toString(),
    principalBaseDelta: config.principalBaseDelta.toString(),
    principalQuoteDelta: config.principalQuoteDelta.toString(),
    yieldBaseDelta: config.yieldBaseDelta.toString(),
    yieldQuoteDelta: config.yieldQuoteDelta.toString(),
    principalQuoteValue: config.principalQuoteValue.toString(),
    yieldQuoteValue: config.yieldQuoteValue.toString(),
    source: config.source,
  };
}

export function stakingLedgerEventConfigFromJSON(
  json: UniswapV3StakingLedgerEventConfigJSON,
): UniswapV3StakingLedgerEventConfig {
  return {
    chainId: json.chainId,
    vaultAddress: json.vaultAddress,
    blockNumber: BigInt(json.blockNumber),
    txIndex: json.txIndex,
    logIndex: json.logIndex,
    txHash: json.txHash,
    blockHash: json.blockHash,
    deltaL: BigInt(json.deltaL),
    liquidityAfter: BigInt(json.liquidityAfter),
    effectiveBps: json.effectiveBps,
    sqrtPriceX96: BigInt(json.sqrtPriceX96),
    principalBaseDelta: BigInt(json.principalBaseDelta),
    principalQuoteDelta: BigInt(json.principalQuoteDelta),
    yieldBaseDelta: BigInt(json.yieldBaseDelta),
    yieldQuoteDelta: BigInt(json.yieldQuoteDelta),
    principalQuoteValue: BigInt(json.principalQuoteValue),
    yieldQuoteValue: BigInt(json.yieldQuoteValue),
    source: json.source,
  };
}
