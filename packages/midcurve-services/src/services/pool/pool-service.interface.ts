/**
 * Pool Service Interface
 *
 * Common interface for all pool service implementations.
 * Defines the contract for basic pool operations that are
 * protocol-agnostic at the interface level.
 */

import type { PoolInterface } from '@midcurve/shared';
import type { PrismaTransactionClient } from './uniswapv3-pool-service.js';

/**
 * PoolServiceInterface
 *
 * Common interface for all pool service implementations.
 * Defines the contract for basic pool operations that are
 * protocol-agnostic at the interface level.
 *
 * Protocol-specific parameters use `unknown` type - implementations
 * should validate and cast to their specific types.
 */
export interface PoolServiceInterface {
  /**
   * Protocol identifier for this service
   */
  readonly protocol: string;

  /**
   * Discover and create a pool from on-chain contract data
   * Checks database first, creates if not found
   *
   * @param params - Protocol-specific discovery parameters
   * @returns The discovered or existing pool
   */
  discover(params: unknown): Promise<PoolInterface>;

  /**
   * Create a new pool
   *
   * @param input - Protocol-specific create input
   * @param tx - Optional transaction client
   * @returns The created pool
   */
  create(input: unknown, tx?: PrismaTransactionClient): Promise<PoolInterface>;

  /**
   * Find pool by database ID
   * Returns null if pool not found or wrong protocol
   */
  findById(id: string, tx?: PrismaTransactionClient): Promise<PoolInterface | null>;

  /**
   * Update pool
   *
   * @param id - Pool ID
   * @param input - Protocol-specific update input
   * @param tx - Optional transaction client
   * @returns Updated pool
   */
  update(id: string, input: unknown, tx?: PrismaTransactionClient): Promise<PoolInterface>;

  /**
   * Delete pool by ID
   * Verifies protocol and checks for dependent positions
   * Silently succeeds if pool doesn't exist (idempotent)
   */
  delete(id: string, tx?: PrismaTransactionClient): Promise<void>;

  /**
   * Refresh pool state from on-chain data
   * Implementation is protocol-specific
   */
  refresh(id: string, tx?: PrismaTransactionClient): Promise<PoolInterface>;

  /**
   * Create a pool hash from raw parameters
   * Format is protocol-specific
   *
   * @param params - Protocol-specific parameters needed to create the hash
   * @returns Human-readable composite key
   */
  createHash(params: Record<string, unknown>): string;

  /**
   * Create a pool hash from a pool instance
   * Format is protocol-specific
   *
   * @param pool - Pool instance to create hash from
   * @returns Human-readable composite key
   * @throws Error if pool protocol doesn't match the service's protocol
   */
  createHashFromPool(pool: PoolInterface): string;

  /**
   * Find pool by its hash
   *
   * @param hash - Pool hash (e.g., "uniswapv3/1/0x...")
   * @param tx - Optional transaction client
   * @returns Pool if found, null otherwise
   */
  findByHash(hash: string, tx?: PrismaTransactionClient): Promise<PoolInterface | null>;
}
