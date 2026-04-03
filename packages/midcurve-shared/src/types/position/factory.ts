/**
 * Position Factory
 *
 * Factory for creating position instances from database rows.
 * Handles protocol discrimination and delegates to appropriate concrete class.
 */

import type { TokenInterface } from '../token/index.js';
import type { PositionInterface } from './position.interface.js';
import type { PositionProtocol, PositionRow, PositionJSON } from './position.types.js';
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
 * // Resolve tokens from position config
 * const token0 = await tokenService.findByAddressAndChain(config.token0Address, config.chainId);
 * const token1 = await tokenService.findByAddressAndChain(config.token1Address, config.chainId);
 *
 * // Create position with direct token references
 * const position = PositionFactory.fromDB(row, token0, token1);
 * ```
 */
export class PositionFactory {
  /**
   * Create a position instance from a database row.
   *
   * @param row - Database row from Prisma
   * @param token0 - Pre-resolved token0 instance
   * @param token1 - Pre-resolved token1 instance
   * @returns PositionInterface instance (concrete type based on protocol)
   * @throws Error if protocol is unknown
   */
  static fromDB(row: PositionRow, token0: TokenInterface, token1: TokenInterface): PositionInterface {
    const protocol = row.protocol as PositionProtocol;

    switch (protocol) {
      case 'uniswapv3':
        return UniswapV3Position.fromDB(row as UniswapV3PositionRow, token0, token1);

      default:
        throw new Error(`Unknown position protocol: ${row.protocol}`);
    }
  }

  /**
   * Create a position instance from JSON (API response).
   *
   * Deserializes a PositionJSON object back into a position instance.
   * Routes to the appropriate concrete class based on protocol.
   *
   * @param json - JSON data from API response
   * @returns PositionInterface instance (concrete type based on protocol)
   * @throws Error if protocol is unknown
   */
  static fromJSON(json: PositionJSON): PositionInterface {
    const protocol = json.protocol as PositionProtocol;

    switch (protocol) {
      case 'uniswapv3':
        return UniswapV3Position.fromJSON(json);

      default:
        throw new Error(`Unknown position protocol: ${json.protocol}`);
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
