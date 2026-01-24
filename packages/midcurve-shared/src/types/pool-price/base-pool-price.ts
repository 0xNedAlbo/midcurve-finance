/**
 * Abstract Base PoolPrice
 *
 * Base class for protocol-specific pool price implementations.
 * Provides common functionality and enforces the PoolPriceInterface contract.
 *
 * Protocol implementations (e.g., UniswapV3PoolPrice) must extend this class
 * and implement abstract methods for protocol-specific behavior.
 */

import type { PoolPriceInterface } from './pool-price.interface.js';
import type {
  PoolPriceProtocol,
  PoolPriceJSON,
  BasePoolPriceParams,
} from './pool-price.types.js';

/**
 * BasePoolPrice
 *
 * Abstract base class implementing PoolPriceInterface.
 * Concrete pool price types (UniswapV3PoolPrice, etc.) extend this class.
 *
 * @example
 * ```typescript
 * class UniswapV3PoolPrice extends BasePoolPrice {
 *   readonly protocol: PoolPriceProtocol = 'uniswapv3';
 *   // ... protocol-specific implementation
 * }
 * ```
 */
export abstract class BasePoolPrice implements PoolPriceInterface {
  readonly id: string;
  readonly poolId: string;
  readonly timestamp: Date;
  readonly token1PricePerToken0: bigint;
  readonly token0PricePerToken1: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  /**
   * Protocol identifier - must be implemented by subclass.
   */
  abstract readonly protocol: PoolPriceProtocol;

  /**
   * Get config as generic Record (for PoolPriceInterface compliance).
   * Subclasses implement this to return their typed config as Record.
   */
  abstract get config(): Record<string, unknown>;

  /**
   * Get state as generic Record (for PoolPriceInterface compliance).
   * Subclasses implement this to return their typed state as Record.
   */
  abstract get state(): Record<string, unknown>;

  /**
   * Creates a new BasePoolPrice instance.
   *
   * @param params - Base pool price parameters
   */
  constructor(params: BasePoolPriceParams) {
    this.id = params.id;
    this.poolId = params.poolId;
    this.timestamp = params.timestamp;
    this.token1PricePerToken0 = params.token1PricePerToken0;
    this.token0PricePerToken1 = params.token0PricePerToken1;
    this.createdAt = params.createdAt;
    this.updatedAt = params.updatedAt;
  }

  /**
   * Serialize pool price to JSON format for API responses.
   *
   * Converts:
   * - Date objects to ISO 8601 strings
   * - bigint values to strings
   *
   * @returns PoolPriceJSON ready for API response
   */
  toJSON(): PoolPriceJSON {
    return {
      id: this.id,
      protocol: this.protocol,
      poolId: this.poolId,
      timestamp: this.timestamp.toISOString(),
      token1PricePerToken0: this.token1PricePerToken0.toString(),
      token0PricePerToken1: this.token0PricePerToken1.toString(),
      config: this.config,
      state: this.state,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
