/**
 * Position Ledger Event Types
 *
 * Type definitions for position ledger events.
 */

// ============================================================================
// PROTOCOL TYPES
// ============================================================================

/**
 * Supported protocols for ledger events
 */
export type LedgerEventProtocol = 'uniswapv3';

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * Position Event Types
 *
 * Liquidity events:
 * - INCREASE_POSITION: Liquidity added to position (capital deployed)
 * - DECREASE_POSITION: Liquidity removed from position (partial close)
 * - COLLECT: Tokens withdrawn from position (fees + principal)
 *
 * Lifecycle events (deltaLiquidity = 0):
 * - MINT: Position NFT minted (position created on-chain)
 * - BURN: Position NFT burned (position destroyed on-chain)
 * - TRANSFER: Position NFT ownership changed
 */
export type EventType =
  | 'INCREASE_POSITION'
  | 'DECREASE_POSITION'
  | 'COLLECT'
  | 'MINT'
  | 'BURN'
  | 'TRANSFER';

// ============================================================================
// REWARD STRUCTURE
// ============================================================================

/**
 * Reward
 *
 * Represents a reward token collected from a position.
 */
export interface Reward {
  /** Token identifier (address for ERC-20, mint for SPL) */
  tokenId: string;

  /** Amount of reward token in smallest units */
  tokenAmount: bigint;

  /** Value of reward in quote token units */
  tokenValue: bigint;
}

/**
 * RewardJSON
 *
 * JSON representation of Reward with bigint as string.
 */
export interface RewardJSON {
  tokenId: string;
  tokenAmount: string;
  tokenValue: string;
}

/**
 * Convert Reward to JSON.
 */
export function rewardToJSON(reward: Reward): RewardJSON {
  return {
    tokenId: reward.tokenId,
    tokenAmount: reward.tokenAmount.toString(),
    tokenValue: reward.tokenValue.toString(),
  };
}

/**
 * Convert JSON to Reward.
 */
export function rewardFromJSON(json: RewardJSON): Reward {
  return {
    tokenId: json.tokenId,
    tokenAmount: BigInt(json.tokenAmount),
    tokenValue: BigInt(json.tokenValue),
  };
}

// ============================================================================
// JSON INTERFACE
// ============================================================================

/**
 * PositionLedgerEventJSON
 *
 * JSON representation for API responses.
 * All Date fields are ISO strings, all bigint fields are strings.
 */
export interface PositionLedgerEventJSON {
  id: string;
  createdAt: string;
  updatedAt: string;
  positionId: string;
  protocol: LedgerEventProtocol;
  previousId: string | null;
  timestamp: string;
  eventType: EventType;
  inputHash: string;
  poolPrice: string;
  token0Amount: string;
  token1Amount: string;
  tokenValue: string;
  rewards: RewardJSON[];
  deltaCostBasis: string;
  costBasisAfter: string;
  deltaPnl: string;
  pnlAfter: string;
  deltaCollectedFees: string;
  collectedFeesAfter: string;
  deltaRealizedCashflow: string;
  realizedCashflowAfter: string;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
}

// ============================================================================
// BASE PARAMS
// ============================================================================

/**
 * BasePositionLedgerEventParams
 *
 * Parameters for constructing any position ledger event.
 */
export interface BasePositionLedgerEventParams {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  positionId: string;
  previousId: string | null;
  timestamp: Date;
  eventType: EventType;
  inputHash: string;
  poolPrice: bigint;
  token0Amount: bigint;
  token1Amount: bigint;
  tokenValue: bigint;
  rewards: Reward[];
  deltaCostBasis: bigint;
  costBasisAfter: bigint;
  deltaPnl: bigint;
  pnlAfter: bigint;
  deltaCollectedFees: bigint;
  collectedFeesAfter: bigint;
  deltaRealizedCashflow: bigint;
  realizedCashflowAfter: bigint;
}

// ============================================================================
// DATABASE ROW
// ============================================================================

/**
 * PositionLedgerEventRow
 *
 * Database row interface for factory method.
 */
export interface PositionLedgerEventRow {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  positionId: string;
  protocol: string;
  previousId: string | null;
  timestamp: Date;
  eventType: string;
  inputHash: string;
  poolPrice: bigint;
  token0Amount: bigint;
  token1Amount: bigint;
  tokenValue: bigint;
  rewards: unknown[];
  deltaCostBasis: bigint;
  costBasisAfter: bigint;
  deltaPnl: bigint;
  pnlAfter: bigint;
  deltaCollectedFees: bigint;
  collectedFeesAfter: bigint;
  deltaRealizedCashflow: bigint;
  realizedCashflowAfter: bigint;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
}
