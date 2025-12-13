/**
 * Strategy Position Factory
 *
 * Creates typed strategy position instances from database rows.
 * Uses the positionType discriminator to select the correct implementation.
 */

import type { StrategyPositionInterface } from './strategy-position.interface.js';
import type { StrategyPositionType } from './strategy-position.types.js';
import { StrategyTreasury } from './treasury/strategy-treasury.js';

/**
 * Generic database row for strategy positions
 */
export interface StrategyPositionRow {
  id: string;
  strategyId: string;
  positionType: string;
  status: string;
  openedAt: Date | null;
  closedAt: Date | null;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Strategy Position Factory
 *
 * Creates typed strategy position instances from database rows.
 * Dispatches to the correct implementation based on positionType.
 */
export class StrategyPositionFactory {
  /**
   * Create a strategy position from a database row
   *
   * @param row - Database row with positionType discriminator
   * @returns Typed strategy position instance
   * @throws Error if position type is unknown
   */
  static fromDB(row: StrategyPositionRow): StrategyPositionInterface {
    const positionType = row.positionType as StrategyPositionType;

    switch (positionType) {
      case 'treasury':
        return StrategyTreasury.fromDB({
          ...row,
          positionType: 'treasury',
          status: row.status as 'pending' | 'active' | 'paused' | 'closed',
        });

      case 'uniswapv3':
        // TODO: Implement UniswapV3StrategyPosition
        throw new Error(`Position type 'uniswapv3' not yet implemented`);

      case 'hyperliquid':
        // TODO: Implement HyperliquidStrategyPosition
        throw new Error(`Position type 'hyperliquid' not yet implemented`);

      default:
        throw new Error(`Unknown position type: ${row.positionType}`);
    }
  }

  /**
   * Check if a position type is supported
   */
  static isSupported(positionType: string): positionType is StrategyPositionType {
    return ['treasury', 'uniswapv3', 'hyperliquid'].includes(positionType);
  }
}
