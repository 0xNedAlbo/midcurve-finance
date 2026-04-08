/**
 * UniswapV3 Vault Ledger Event Configuration
 *
 * Immutable metadata for a vault position event.
 * Contains blockchain ordering information and share/liquidity state at event time.
 */

// ============================================================================
// CONFIG INTERFACE
// ============================================================================

export interface UniswapV3VaultLedgerEventConfig {
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

  /** Shares involved in this event */
  shares: bigint;

  /** User's share balance after this event */
  sharesAfter: bigint;

  /** Vault total supply after this event */
  totalSupplyAfter: bigint;

  /** Vault's NFT liquidity after this event */
  liquidityAfter: bigint;

  /** Pool price at event time (sqrtPriceX96) */
  sqrtPriceX96: bigint;
}

// ============================================================================
// JSON INTERFACE
// ============================================================================

export interface UniswapV3VaultLedgerEventConfigJSON {
  chainId: number;
  vaultAddress: string;
  blockNumber: string;
  txIndex: number;
  logIndex: number;
  txHash: string;
  blockHash: string;
  shares: string;
  sharesAfter: string;
  totalSupplyAfter: string;
  liquidityAfter: string;
  sqrtPriceX96: string;
}

// ============================================================================
// SERIALIZATION HELPERS
// ============================================================================

export function vaultLedgerEventConfigToJSON(
  config: UniswapV3VaultLedgerEventConfig
): UniswapV3VaultLedgerEventConfigJSON {
  return {
    chainId: config.chainId,
    vaultAddress: config.vaultAddress,
    blockNumber: config.blockNumber.toString(),
    txIndex: config.txIndex,
    logIndex: config.logIndex,
    txHash: config.txHash,
    blockHash: config.blockHash,
    shares: config.shares.toString(),
    sharesAfter: config.sharesAfter.toString(),
    totalSupplyAfter: config.totalSupplyAfter.toString(),
    liquidityAfter: config.liquidityAfter.toString(),
    sqrtPriceX96: config.sqrtPriceX96.toString(),
  };
}

export function vaultLedgerEventConfigFromJSON(
  json: UniswapV3VaultLedgerEventConfigJSON
): UniswapV3VaultLedgerEventConfig {
  return {
    chainId: json.chainId,
    vaultAddress: json.vaultAddress,
    blockNumber: BigInt(json.blockNumber),
    txIndex: json.txIndex,
    logIndex: json.logIndex,
    txHash: json.txHash,
    blockHash: json.blockHash,
    shares: BigInt(json.shares),
    sharesAfter: BigInt(json.sharesAfter),
    totalSupplyAfter: BigInt(json.totalSupplyAfter),
    liquidityAfter: BigInt(json.liquidityAfter),
    sqrtPriceX96: BigInt(json.sqrtPriceX96),
  };
}
