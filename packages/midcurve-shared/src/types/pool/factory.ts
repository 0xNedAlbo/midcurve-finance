/**
 * Pool Factory
 *
 * Factory for creating protocol-specific pool instances from database rows.
 * Handles protocol discrimination and type-safe instantiation.
 */

import type { Erc20Token } from '../token/index.js';
import type { PoolInterface } from './pool.interface.js';
import type { Protocol, PoolRow, PoolJSON } from './pool.types.js';
import { UniswapV3Pool, type UniswapV3PoolRow } from './uniswapv3/index.js';

/**
 * PoolFactory
 *
 * Creates protocol-specific pool instances from generic database rows.
 * Centralizes protocol discrimination logic.
 *
 * @example
 * ```typescript
 * // From database with pre-fetched tokens
 * const row = await prisma.pool.findUnique({ where: { id } });
 * const token0 = Erc20Token.fromDB(token0Row);
 * const token1 = Erc20Token.fromDB(token1Row);
 * const pool = PoolFactory.fromDB(row, token0, token1);
 *
 * // Type narrowing based on protocol
 * if (pool.protocol === 'uniswapv3') {
 *   // TypeScript knows pool is UniswapV3Pool
 *   console.log(pool.tickSpacing);
 * }
 * ```
 */
export class PoolFactory {
  /**
   * Create a pool instance from a database row.
   *
   * @param row - Database row from Prisma
   * @param token0 - Pre-fetched token0 instance
   * @param token1 - Pre-fetched token1 instance
   * @returns Protocol-specific pool instance
   * @throws Error if protocol is unknown
   */
  static fromDB(
    row: PoolRow,
    token0: Erc20Token,
    token1: Erc20Token
  ): PoolInterface {
    const protocol = row.protocol as Protocol;

    switch (protocol) {
      case 'uniswapv3':
        return UniswapV3Pool.fromDB(row as UniswapV3PoolRow, token0, token1);

      default:
        throw new Error(`Unknown protocol: ${row.protocol}`);
    }
  }

  /**
   * Create a pool instance from JSON (API response).
   *
   * Deserializes a PoolJSON object back into a pool instance.
   * Routes to the appropriate concrete class based on protocol.
   *
   * @param json - JSON data from API response
   * @returns Protocol-specific pool instance
   * @throws Error if protocol is unknown
   */
  static fromJSON(json: PoolJSON): PoolInterface {
    const protocol = json.protocol as Protocol;

    switch (protocol) {
      case 'uniswapv3':
        return UniswapV3Pool.fromJSON(json);

      default:
        throw new Error(`Unknown protocol: ${json.protocol}`);
    }
  }

  /**
   * Check if a protocol string is supported.
   *
   * @param protocol - Protocol string to check
   * @returns True if protocol is supported
   */
  static isSupported(protocol: string): protocol is Protocol {
    return ['uniswapv3'].includes(protocol);
  }

  /**
   * Get all supported protocols.
   *
   * @returns Array of supported protocol identifiers
   */
  static getSupportedProtocols(): Protocol[] {
    return ['uniswapv3'];
  }
}
