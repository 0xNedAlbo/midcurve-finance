/**
 * Strategy Position Types
 *
 * Type definitions for strategy-owned positions.
 * These are separate from user-owned positions (Position model).
 */

/**
 * Strategy position lifecycle status
 *
 * - pending: Created in DB, not yet active
 * - active: Position is active and being managed
 * - paused: Position is temporarily paused
 * - closed: Position has been closed
 */
export type StrategyPositionStatus = 'pending' | 'active' | 'paused' | 'closed';

/**
 * Strategy position type discriminator
 *
 * Extensible for future position types:
 * - 'hodl': Token basket holding position
 * - 'uniswapv3': Uniswap V3 concentrated liquidity position
 * - 'hyperliquid': Hyperliquid perpetuals position
 */
export type StrategyPositionType = 'hodl' | 'uniswapv3' | 'hyperliquid';

/**
 * JSON-serializable representation of a strategy position
 *
 * Used for API responses and database storage.
 */
export interface StrategyPositionJSON {
  id: string;
  strategyId: string;
  positionType: StrategyPositionType;
  status: StrategyPositionStatus;
  openedAt: string | null;
  closedAt: string | null;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Base parameters for creating any strategy position
 */
export interface BaseStrategyPositionParams {
  id: string;
  strategyId: string;
  status: StrategyPositionStatus;
  openedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
