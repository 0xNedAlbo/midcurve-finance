/**
 * Abstract Base Pool
 *
 * Base class for protocol-specific pool implementations.
 * Provides common functionality and enforces the PoolInterface contract.
 *
 * Protocol implementations (e.g., UniswapV3Pool) must extend this class
 * and implement abstract methods for protocol-specific behavior.
 */

import type { TokenInterface } from '../token/index.js';
import type { PoolInterface } from './pool.interface.js';
import type { Protocol, PoolJSON, BasePoolParams } from './pool.types.js';

/**
 * BasePool
 *
 * Abstract base class implementing PoolInterface.
 * Concrete pool types (UniswapV3Pool, etc.) extend this class.
 *
 * @example
 * ```typescript
 * class UniswapV3Pool extends BasePool {
 *   readonly protocol: Protocol = 'uniswapv3';
 *   // ... protocol-specific implementation
 * }
 * ```
 */
export abstract class BasePool implements PoolInterface {
  readonly id: string;
  readonly token0: TokenInterface;
  readonly token1: TokenInterface;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  /**
   * Protocol identifier - must be implemented by subclass.
   */
  abstract readonly protocol: Protocol;

  /**
   * Get config as generic Record (for PoolInterface compliance).
   * Subclasses implement this to return their typed config as Record.
   */
  abstract get config(): Record<string, unknown>;

  /**
   * Get state as generic Record (for PoolInterface compliance).
   * Subclasses implement this to return their typed state as Record.
   */
  abstract get state(): Record<string, unknown>;

  /**
   * Creates a new BasePool instance.
   *
   * @param params - Base pool parameters
   */
  constructor(params: BasePoolParams) {
    this.id = params.id;
    this.token0 = params.token0;
    this.token1 = params.token1;
    this.createdAt = params.createdAt;
    this.updatedAt = params.updatedAt;
  }

  /**
   * Serialize pool to JSON format for API responses.
   *
   * Converts:
   * - Date objects to ISO 8601 strings
   * - Token objects to TokenJSON via their toJSON() methods
   *
   * @returns PoolJSON ready for API response
   */
  toJSON(): PoolJSON {
    return {
      id: this.id,
      protocol: this.protocol,
      token0: this.token0.toJSON(),
      token1: this.token1.toJSON(),
      config: this.config,
      state: this.state,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /**
   * Get a human-readable display name for the pool.
   * Subclasses can override to include protocol-specific details (e.g., fee tier).
   *
   * @returns "TOKEN0/TOKEN1" format
   * @example "WETH/USDC"
   */
  getDisplayName(): string {
    return `${this.token0.symbol}/${this.token1.symbol}`;
  }
}
