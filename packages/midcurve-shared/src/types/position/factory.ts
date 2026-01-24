/**
 * Position Factory
 *
 * Factory for creating position instances from database rows.
 * Handles protocol discrimination and delegates to appropriate concrete class.
 */

import type { UniswapV3Pool } from '../pool/index.js';
import type { PositionInterface } from './position.interface.js';
import type { PositionProtocol, PositionRow } from './position.types.js';
import {
  UniswapV3Position,
  type UniswapV3PositionRow,
} from './uniswapv3/uniswapv3-position.js';

// ============================================================================
// POSITION FACTORY
// ============================================================================

/**
 * PositionFactory
 *
 * Creates position instances from database rows.
 * Discriminates on protocol field to create the correct concrete type.
 *
 * @example
 * ```typescript
 * // From Prisma query with pool included
 * const row = await prisma.position.findUnique({
 *   where: { id },
 *   include: { pool: { include: { token0: true, token1: true } } },
 * });
 *
 * // Create pool first
 * const pool = UniswapV3Pool.fromDB(row.pool, token0, token1);
 *
 * // Then create position
 * const position = PositionFactory.fromDB(row, pool);
 *
 * // position is now typed as PositionInterface
 * // For protocol-specific access, use type narrowing:
 * if (position.protocol === 'uniswapv3') {
 *   const uniPosition = position as UniswapV3Position;
 *   console.log(uniPosition.nftId); // Type-safe access
 * }
 * ```
 */
export class PositionFactory {
  /**
   * Create a position instance from a database row.
   *
   * @param row - Database row from Prisma
   * @param pool - Pre-loaded UniswapV3Pool instance
   * @returns PositionInterface instance (concrete type based on protocol)
   * @throws Error if protocol is unknown
   */
  static fromDB(row: PositionRow, pool: UniswapV3Pool): PositionInterface {
    const protocol = row.protocol as PositionProtocol;

    switch (protocol) {
      case 'uniswapv3':
        return UniswapV3Position.fromDB(row as UniswapV3PositionRow, pool);

      default:
        throw new Error(`Unknown position protocol: ${row.protocol}`);
    }
  }

  /**
   * Check if a protocol string is a supported PositionProtocol.
   *
   * @param protocol - Protocol string to check
   * @returns True if protocol is supported
   */
  static isSupported(protocol: string): protocol is PositionProtocol {
    return ['uniswapv3'].includes(protocol);
  }
}
