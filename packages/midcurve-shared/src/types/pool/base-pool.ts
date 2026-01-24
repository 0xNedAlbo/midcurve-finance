/**
 * Abstract Base Pool
 *
 * Base class for protocol-specific pool implementations.
 * Provides common functionality and enforces the PoolInterface contract.
 *
 * Protocol implementations (e.g., UniswapV3Pool) must extend this class
 * and implement abstract methods for protocol-specific behavior.
 */

import type { Erc20Token } from '../token/index.js';
import type { PoolInterface } from './pool.interface.js';
import type { Protocol, PoolType, PoolJSON, BasePoolParams } from './pool.types.js';

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
  readonly poolType: PoolType;
  readonly token0: Erc20Token;
  readonly token1: Erc20Token;
  readonly feeBps: number;
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
    this.poolType = params.poolType;
    this.token0 = params.token0;
    this.token1 = params.token1;
    this.feeBps = params.feeBps;
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
      poolType: this.poolType,
      token0: this.token0.toJSON(),
      token1: this.token1.toJSON(),
      feeBps: this.feeBps,
      config: this.config,
      state: this.state,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  /**
   * Get a human-readable display name for the pool.
   *
   * @returns "TOKEN0/TOKEN1 (fee%)" format
   * @example "WETH/USDC (0.3%)"
   */
  getDisplayName(): string {
    const feePercent = this.feeBps / 100;
    return `${this.token0.symbol}/${this.token1.symbol} (${feePercent}%)`;
  }
}
