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
import {
  UniswapV3VaultPosition,
  type UniswapV3VaultPositionRow,
} from './uniswapv3-vault/uniswapv3-vault-position.js';
import {
  UniswapV3StakingPosition,
  type UniswapV3StakingPositionRow,
} from './uniswapv3-staking/uniswapv3-staking-position.js';

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

      case 'uniswapv3-vault':
        return UniswapV3VaultPosition.fromDB(row as UniswapV3VaultPositionRow, token0, token1);

      case 'uniswapv3-staking':
        return UniswapV3StakingPosition.fromDB(row as UniswapV3StakingPositionRow, token0, token1);

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

      case 'uniswapv3-vault': {
        // fromJSON requires tokens — extract from pool if available
        const token0 = json.pool?.token0;
        const token1 = json.pool?.token1;
        if (!token0 || !token1) {
          throw new Error('UniswapV3VaultPosition.fromJSON requires pool.token0 and pool.token1');
        }
        // Token reconstruction handled by the concrete fromJSON
        return UniswapV3VaultPosition.fromJSON(json, token0 as unknown as TokenInterface, token1 as unknown as TokenInterface);
      }

      case 'uniswapv3-staking': {
        const token0 = json.pool?.token0;
        const token1 = json.pool?.token1;
        if (!token0 || !token1) {
          throw new Error('UniswapV3StakingPosition.fromJSON requires pool.token0 and pool.token1');
        }
        return UniswapV3StakingPosition.fromJSON(
          json,
          token0 as unknown as TokenInterface,
          token1 as unknown as TokenInterface,
        );
      }

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
    return ['uniswapv3', 'uniswapv3-vault', 'uniswapv3-staking'].includes(protocol);
  }
}
