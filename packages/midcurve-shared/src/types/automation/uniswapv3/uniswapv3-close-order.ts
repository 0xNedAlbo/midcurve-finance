/**
 * UniswapV3 Close Order Config/State Types
 *
 * Platform-specific types for the CloseOrder JSON config/state columns.
 * These mirror the UniswapV3PositionCloser contract's on-chain state.
 *
 * Pattern: Same as Position model — generic Prisma columns for universal fields,
 * typed JSON config (immutable) and state (mutable) for protocol-specific data.
 */

// =============================================================================
// OnChainCloseOrder Config/State
// =============================================================================

/**
 * UniswapV3 Close Order Config (Immutable)
 *
 * Identity and registration data that doesn't change after order creation.
 * Stored in OnChainCloseOrder.config JSON column.
 */
export interface UniswapV3CloseOrderConfig {
  /** EVM chain ID */
  chainId: number;
  /** NFT token ID (bigint as string for JSON safety) */
  nftId: string;
  /** Trigger mode: 0=LOWER, 1=UPPER (matches contract TriggerMode enum) */
  triggerMode: number;
  /** Diamond proxy contract address (EIP-55 checksummed) */
  contractAddress: string;
}

/**
 * UniswapV3 Close Order State (Mutable)
 *
 * On-chain state refreshable via getOrder(nftId, triggerMode).
 * Stored in OnChainCloseOrder.state JSON column.
 */
export interface UniswapV3CloseOrderState {
  // === ON-CHAIN STATE (from contract CloseOrder struct) ===

  /** Trigger tick (int24), null if not set */
  triggerTick: number | null;
  /** Slippage tolerance in basis points (0-10000) */
  slippageBps: number | null;
  /** Payout address (EIP-55 checksummed) */
  payoutAddress: string | null;
  /** Automation operator address (EIP-55 checksummed) */
  operatorAddress: string | null;
  /** NFT owner at registration time (EIP-55 checksummed) */
  owner: string | null;
  /** UniswapV3 pool address (EIP-55 checksummed) */
  pool: string | null;
  /** Order expiry (ISO 8601 string, null = no expiry) */
  validUntil: string | null;
  /** Swap direction: 0=NONE, 1=TOKEN0_TO_1, 2=TOKEN1_TO_0 */
  swapDirection: number;
  /** Swap slippage tolerance in basis points (0-10000) */
  swapSlippageBps: number;

  // === REGISTRATION METADATA ===

  /** Transaction hash of the registerOrder call */
  registrationTxHash: string | null;
  /** When registration was confirmed (ISO 8601 string) */
  registeredAt: string | null;

  // === SYNC METADATA ===

  /** Block number of last chain read */
  lastSyncBlock: number | null;
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create orderIdentityHash for UniswapV3 close orders.
 *
 * Format: "uniswapv3/{chainId}/{nftId}/{triggerMode}"
 * Used as the unique on-chain identity key (replaces composite unique on chainId+nftId+triggerMode).
 */
export function createUniswapV3OrderIdentityHash(
  chainId: number,
  nftId: string,
  triggerMode: number
): string {
  return `uniswapv3/${chainId}/${nftId}/${triggerMode}`;
}

/**
 * Create empty UniswapV3 close order state (for initial creation before on-chain sync).
 */
export function createEmptyUniswapV3CloseOrderState(): UniswapV3CloseOrderState {
  return {
    triggerTick: null,
    slippageBps: null,
    payoutAddress: null,
    operatorAddress: null,
    owner: null,
    pool: null,
    validUntil: null,
    swapDirection: 0,
    swapSlippageBps: 0,
    registrationTxHash: null,
    registeredAt: null,
    lastSyncBlock: null,
  };
}

