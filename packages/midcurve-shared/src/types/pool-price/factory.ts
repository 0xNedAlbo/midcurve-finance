/**
 * PoolPrice Factory
 *
 * Factory for creating protocol-specific pool price instances from database rows.
 * Handles protocol discrimination and type-safe instantiation.
 */

import type { PoolPriceInterface } from './pool-price.interface.js';
import type { PoolPriceProtocol, PoolPriceRow } from './pool-price.types.js';
import {
  UniswapV3PoolPrice,
  type UniswapV3PoolPriceRow,
} from './uniswapv3/index.js';

/**
 * PoolPriceFactory
 *
 * Creates protocol-specific pool price instances from generic database rows.
 * Centralizes protocol discrimination logic.
 *
 * @example
 * ```typescript
 * // From database
 * const row = await prisma.poolPrice.findUnique({ where: { id } });
 * const poolPrice = PoolPriceFactory.fromDB(row);
 *
 * // Type narrowing based on protocol
 * if (poolPrice.protocol === 'uniswapv3') {
 *   // TypeScript knows poolPrice is UniswapV3PoolPrice
 *   console.log(poolPrice.sqrtPriceX96);
 * }
 * ```
 */
export class PoolPriceFactory {
  /**
   * Create a pool price instance from a database row.
   *
   * @param row - Database row from Prisma
   * @returns Protocol-specific pool price instance
   * @throws Error if protocol is unknown
   */
  static fromDB(row: PoolPriceRow): PoolPriceInterface {
    const protocol = row.protocol as PoolPriceProtocol;

    switch (protocol) {
      case 'uniswapv3':
        return UniswapV3PoolPrice.fromDB(row as UniswapV3PoolPriceRow);

      default:
        throw new Error(`Unknown pool price protocol: ${row.protocol}`);
    }
  }

  /**
   * Check if a protocol string is supported.
   *
   * @param protocol - Protocol string to check
   * @returns True if protocol is supported
   */
  static isSupported(protocol: string): protocol is PoolPriceProtocol {
    return ['uniswapv3'].includes(protocol);
  }

  /**
   * Get all supported protocols.
   *
   * @returns Array of supported protocol identifiers
   */
  static getSupportedProtocols(): PoolPriceProtocol[] {
    return ['uniswapv3'];
  }
}
