/**
 * UniswapV3PoolService
 *
 * Specialized service for Uniswap V3 pool management.
 * Handles address validation, normalization, token discovery, and pool state serialization.
 *
 * Returns UniswapV3Pool class instances for type-safe config/state access.
 */

import { PrismaClient } from '@midcurve/database';
import {
  UniswapV3Pool,
  UniswapV3PoolConfig,
  isValidAddress,
  normalizeAddress,
  stateToJSON,
} from '@midcurve/shared';
import type {
  UniswapV3PoolRow,
  UniswapV3PoolState,
  Erc20TokenRow,
} from '@midcurve/shared';
import type {
  UniswapV3PoolDiscoverInput,
  CreateUniswapV3PoolInput,
  UpdateUniswapV3PoolInput,
} from '../types/pool/pool-input.js';
import {
  readPoolConfig,
  readPoolState,
  PoolConfigError,
  uniswapV3PoolAbi,
} from '../../utils/uniswapv3/index.js';
import { EvmConfig } from '../../config/evm.js';
import { Erc20TokenService } from '../token/erc20-token-service.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Prisma transaction client type for use in transactional operations.
 * This is the client type available within a $transaction callback.
 */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Generic pool result from database (before conversion to class instance)
 * Matches Prisma Pool model output with included token relations
 */
export interface PoolDbResult {
  id: string;
  protocol: string;
  poolType: string;
  token0Id: string;
  token1Id: string;
  feeBps: number;
  config: unknown;
  state: unknown;
  createdAt: Date;
  updatedAt: Date;
  token0?: {
    id: string;
    tokenType: string;
    name: string;
    symbol: string;
    decimals: number;
    logoUrl: string | null;
    coingeckoId: string | null;
    marketCap: number | null;
    config: unknown;
    createdAt: Date;
    updatedAt: Date;
  };
  token1?: {
    id: string;
    tokenType: string;
    name: string;
    symbol: string;
    decimals: number;
    logoUrl: string | null;
    coingeckoId: string | null;
    marketCap: number | null;
    config: unknown;
    createdAt: Date;
    updatedAt: Date;
  };
}

/**
 * Dependencies for UniswapV3PoolService
 * All dependencies are optional and will use defaults if not provided
 */
export interface UniswapV3PoolServiceDependencies {
  /**
   * Prisma client for database operations
   * If not provided, a new PrismaClient instance will be created
   */
  prisma?: PrismaClient;

  /**
   * EVM configuration for chain RPC access
   * If not provided, the singleton EvmConfig instance will be used
   */
  evmConfig?: EvmConfig;

  /**
   * ERC-20 token service for token discovery
   * If not provided, a new Erc20TokenService instance will be created
   */
  erc20TokenService?: Erc20TokenService;
}

/**
 * UniswapV3PoolService
 *
 * Provides pool management for Uniswap V3 concentrated liquidity pools.
 * Returns UniswapV3Pool class instances for type-safe config/state access.
 */
export class UniswapV3PoolService {
  protected readonly _prisma: PrismaClient;
  protected readonly logger: ServiceLogger;
  protected readonly protocol = 'uniswapv3' as const;

  private readonly _evmConfig: EvmConfig;
  private readonly _erc20TokenService: Erc20TokenService;

  /**
   * Creates a new UniswapV3PoolService instance
   *
   * @param dependencies - Optional dependencies object
   * @param dependencies.prisma - Prisma client instance (creates default if not provided)
   * @param dependencies.evmConfig - EVM configuration instance (uses singleton if not provided)
   * @param dependencies.erc20TokenService - ERC-20 token service (creates default if not provided)
   */
  constructor(dependencies: UniswapV3PoolServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? new PrismaClient();
    this.logger = createServiceLogger('UniswapV3PoolService');
    this._evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
    this._erc20TokenService =
      dependencies.erc20TokenService ??
      new Erc20TokenService({ prisma: this._prisma });
  }

  /**
   * Get the Prisma client instance
   */
  protected get prisma(): PrismaClient {
    return this._prisma;
  }

  /**
   * Get the EVM configuration instance
   */
  protected get evmConfig(): EvmConfig {
    return this._evmConfig;
  }

  /**
   * Get the ERC-20 token service instance
   */
  protected get erc20TokenService(): Erc20TokenService {
    return this._erc20TokenService;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Convert database result to UniswapV3Pool class instance.
   *
   * Uses UniswapV3Pool.fromDBWithTokens() which handles:
   * - Config deserialization via UniswapV3PoolConfig.fromJSON()
   * - State deserialization via stateFromJSON()
   * - Token conversion via Erc20Token.fromDB()
   *
   * @param dbResult - Raw database result from Prisma (with included tokens)
   * @returns UniswapV3Pool class instance
   */
  private mapToUniswapV3Pool(dbResult: PoolDbResult): UniswapV3Pool {
    // UniswapV3Pool.fromDBWithTokens expects token relations to be included
    if (!dbResult.token0 || !dbResult.token1) {
      throw new Error(
        'UniswapV3PoolService.mapToUniswapV3Pool requires token0 and token1 to be included'
      );
    }

    return UniswapV3Pool.fromDBWithTokens({
      id: dbResult.id,
      protocol: 'uniswapv3',
      poolType: dbResult.poolType,
      token0Id: dbResult.token0Id,
      token1Id: dbResult.token1Id,
      feeBps: dbResult.feeBps,
      config: dbResult.config as Record<string, unknown>,
      state: dbResult.state as Record<string, unknown>,
      createdAt: dbResult.createdAt,
      updatedAt: dbResult.updatedAt,
      token0: dbResult.token0 as Erc20TokenRow,
      token1: dbResult.token1 as Erc20TokenRow,
    } as UniswapV3PoolRow);
  }

  // ============================================================================
  // DISCOVERY
  // ============================================================================

  /**
   * Discover and create a Uniswap V3 pool from on-chain contract data
   *
   * Checks the database first for an existing pool. If not found:
   * 1. Validates and normalizes pool address
   * 2. Reads immutable pool config from on-chain (token0, token1, fee, tickSpacing)
   * 3. Discovers/fetches token0 and token1 via Erc20TokenService
   * 4. Reads current pool state from on-chain (sqrtPriceX96, liquidity, etc.)
   * 5. Saves pool to database with token ID references
   * 6. Returns Pool with full Token objects
   *
   * Discovery is idempotent - calling multiple times with the same address/chain
   * returns the existing pool.
   *
   * Note: Pool state can be refreshed later using the refresh() method to get
   * the latest on-chain values.
   *
   * @param params - Discovery parameters { poolAddress, chainId }
   * @returns The discovered or existing pool with full Token objects
   * @throws Error if address format is invalid
   * @throws Error if chain ID is not supported
   * @throws PoolConfigError if contract doesn't implement Uniswap V3 pool interface
   */
  async discover(
    params: UniswapV3PoolDiscoverInput
  ): Promise<UniswapV3Pool> {
    const { poolAddress, chainId } = params;
    log.methodEntry(this.logger, 'discover', { poolAddress, chainId });

    try {
      // 1. Validate pool address format
      if (!isValidAddress(poolAddress)) {
        const error = new Error(
          `Invalid pool address format: ${poolAddress}`
        );
        log.methodError(this.logger, 'discover', error, {
          poolAddress,
          chainId,
        });
        throw error;
      }

      // 2. Normalize to EIP-55
      const normalizedAddress = normalizeAddress(poolAddress);
      this.logger.debug(
        { original: poolAddress, normalized: normalizedAddress },
        'Pool address normalized for discovery'
      );

      // 3. Check database first (optimization)
      const existing = await this.findByAddressAndChain(
        normalizedAddress,
        chainId
      );

      if (existing) {
        this.logger.info(
          {
            id: existing.id,
            address: normalizedAddress,
            chainId,
            token0: existing.token0.symbol,
            token1: existing.token1.symbol,
          },
          'Pool already exists, refreshing state from on-chain'
        );

        // Refresh pool state to get current price/liquidity/tick
        const refreshed = await this.refresh(existing.id);

        log.methodExit(this.logger, 'discover', {
          id: refreshed.id,
          fromDatabase: true,
          refreshed: true,
        });
        return refreshed;
      }

      // 4. Verify chain is supported
      if (!this.evmConfig.isChainSupported(chainId)) {
        const error = new Error(
          `Chain ${chainId} is not configured. Supported chains: ${this.evmConfig
            .getSupportedChainIds()
            .join(', ')}`
        );
        log.methodError(this.logger, 'discover', error, { chainId });
        throw error;
      }

      this.logger.debug(
        { chainId },
        'Chain is supported, proceeding with on-chain discovery'
      );

      // 5. Read on-chain pool configuration
      const client = this.evmConfig.getPublicClient(chainId);
      this.logger.debug(
        { address: normalizedAddress, chainId },
        'Reading pool configuration from contract'
      );

      let config;
      try {
        config = await readPoolConfig(client, normalizedAddress, chainId);
      } catch (error) {
        if (error instanceof PoolConfigError) {
          log.methodError(this.logger, 'discover', error, {
            address: normalizedAddress,
            chainId,
          });
          throw error;
        }
        const wrappedError = new Error(
          `Failed to read pool configuration from contract at ${normalizedAddress} on chain ${chainId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        log.methodError(this.logger, 'discover', wrappedError, {
          address: normalizedAddress,
          chainId,
        });
        throw wrappedError;
      }

      this.logger.info(
        {
          address: normalizedAddress,
          chainId,
          token0: config.token0,
          token1: config.token1,
          feeBps: config.feeBps,
          tickSpacing: config.tickSpacing,
        },
        'Pool configuration read successfully from contract'
      );

      // 6. Discover tokens (creates if not exist)
      this.logger.debug(
        { token0: config.token0, token1: config.token1, chainId },
        'Discovering pool tokens'
      );

      const [token0, token1] = await Promise.all([
        this.erc20TokenService.discover({
          address: config.token0,
          chainId,
        }),
        this.erc20TokenService.discover({
          address: config.token1,
          chainId,
        }),
      ]);

      this.logger.info(
        {
          token0Id: token0.id,
          token0Symbol: token0.symbol,
          token1Id: token1.id,
          token1Symbol: token1.symbol,
        },
        'Pool tokens discovered successfully'
      );

      // 7. Read current pool state from on-chain
      const state = await readPoolState(client, normalizedAddress);

      // 8. Create pool using create() method (handles validation, normalization, and Token population)
      this.logger.debug(
        {
          address: normalizedAddress,
          chainId,
          token0Id: token0.id,
          token1Id: token1.id,
        },
        'Creating pool with discovered tokens'
      );

      const pool = await this.create({
        protocol: 'uniswapv3',
        poolType: 'CL_TICKS',
        token0Id: token0.id,
        token1Id: token1.id,
        feeBps: config.feeBps,
        config,
        state,
      });

      this.logger.info(
        {
          id: pool.id,
          address: normalizedAddress,
          chainId,
          token0: token0.symbol,
          token1: token1.symbol,
          feeBps: config.feeBps,
        },
        'Pool discovered and created successfully'
      );

      log.methodExit(this.logger, 'discover', { id: pool.id });
      return pool;
    } catch (error) {
      // Only log if not already logged
      if (
        !(error instanceof Error && error.message.includes('Invalid')) &&
        !(error instanceof PoolConfigError)
      ) {
        log.methodError(this.logger, 'discover', error as Error, {
          poolAddress,
          chainId,
        });
      }
      throw error;
    }
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  /**
   * Create a new Uniswap V3 pool
   *
   * Adds:
   * - Address validation and normalization (pool address in config)
   * - Token address validation and normalization (token0, token1 in config)
   * - Returns UniswapV3Pool class instance
   *
   * Note: This is a manual creation helper. For creating pools from on-chain data,
   * use discover() which handles token discovery and pool state fetching.
   *
   * @param input - Pool data to create (with token0Id, token1Id)
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns The created pool with full Token objects
   * @throws Error if address format is invalid
   */
  async create(
    input: CreateUniswapV3PoolInput,
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'create', {
      address: input.config.address,
      chainId: input.config.chainId,
      token0Id: input.token0Id,
      token1Id: input.token1Id,
      inTransaction: !!tx,
    });

    try {
      const client = tx ?? this.prisma;

      // Validate and normalize pool address
      if (!isValidAddress(input.config.address)) {
        const error = new Error(
          `Invalid pool address format: ${input.config.address}`
        );
        log.methodError(this.logger, 'create', error, { input });
        throw error;
      }

      // Validate and normalize token addresses
      if (!isValidAddress(input.config.token0)) {
        const error = new Error(
          `Invalid token0 address format: ${input.config.token0}`
        );
        log.methodError(this.logger, 'create', error, { input });
        throw error;
      }

      if (!isValidAddress(input.config.token1)) {
        const error = new Error(
          `Invalid token1 address format: ${input.config.token1}`
        );
        log.methodError(this.logger, 'create', error, { input });
        throw error;
      }

      // Create config class for serialization with normalized addresses
      const configData = {
        ...input.config,
        address: normalizeAddress(input.config.address),
        token0: normalizeAddress(input.config.token0),
        token1: normalizeAddress(input.config.token1),
      };
      const config = new UniswapV3PoolConfig(configData);

      // Serialize state
      const stateDB = stateToJSON(input.state);

      log.dbOperation(this.logger, 'create', 'Pool', {
        protocol: input.protocol,
        poolType: input.poolType,
      });

      const result = await client.pool.create({
        data: {
          protocol: input.protocol,
          poolType: input.poolType,
          token0Id: input.token0Id,
          token1Id: input.token1Id,
          feeBps: input.feeBps,
          config: config.toJSON() as object,
          state: stateDB as object,
        },
        include: {
          token0: true,
          token1: true,
        },
      });

      const pool = this.mapToUniswapV3Pool(result);

      this.logger.info(
        {
          id: pool.id,
          protocol: pool.protocol,
          poolType: pool.poolType,
        },
        'Pool created'
      );
      log.methodExit(this.logger, 'create', { id: pool.id });
      return pool;
    } catch (error) {
      // Only log if not already logged
      if (!(error instanceof Error && error.message.includes('Invalid'))) {
        log.methodError(this.logger, 'create', error as Error, { input });
      }
      throw error;
    }
  }

  /**
   * Find pool by ID
   *
   * Returns null if:
   * - Pool not found
   * - Pool is not uniswapv3 protocol
   *
   * @param id - Pool ID
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Pool if found and is uniswapv3 protocol, null otherwise
   */
  async findById(
    id: string,
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool | null> {
    log.methodEntry(this.logger, 'findById', { id, inTransaction: !!tx });

    try {
      const client = tx ?? this.prisma;
      log.dbOperation(this.logger, 'findUnique', 'Pool', { id });

      const result = await client.pool.findUnique({
        where: { id },
        include: {
          token0: true,
          token1: true,
        },
      });

      if (!result) {
        log.methodExit(this.logger, 'findById', { id, found: false });
        return null;
      }

      // Filter by protocol type
      if (result.protocol !== 'uniswapv3') {
        this.logger.debug(
          { id, protocol: result.protocol },
          'Pool found but is not uniswapv3 protocol'
        );
        log.methodExit(this.logger, 'findById', { id, found: false, reason: 'wrong_protocol' });
        return null;
      }

      // Map to UniswapV3Pool with full Token objects
      const pool = this.mapToUniswapV3Pool(result);

      log.methodExit(this.logger, 'findById', { id, found: true });
      return pool;
    } catch (error) {
      log.methodError(this.logger, 'findById', error as Error, { id });
      throw error;
    }
  }

  /**
   * Update pool
   *
   * Handles address normalization and returns UniswapV3Pool class instance.
   *
   * @param id - Pool ID
   * @param input - Update input with optional fields
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Updated pool with full Token objects
   * @throws Error if pool not found or not uniswapv3 protocol
   */
  async update(
    id: string,
    input: UpdateUniswapV3PoolInput,
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'update', { id, input, inTransaction: !!tx });

    try {
      const client = tx ?? this.prisma;

      // Build update data
      const data: Record<string, unknown> = {};

      if (input.feeBps !== undefined) {
        data.feeBps = input.feeBps;
      }

      // Handle config update with address normalization
      if (input.config !== undefined) {
        // Get existing pool to merge with partial config
        const existing = await this.findById(id, tx);
        if (!existing) {
          const error = new Error(`Pool ${id} not found`);
          log.methodError(this.logger, 'update', error, { id });
          throw error;
        }

        const mergedConfig = {
          ...existing.typedConfig.toJSON(),
          ...input.config,
        };

        // Normalize addresses if provided
        if (input.config.address) {
          if (!isValidAddress(input.config.address)) {
            const error = new Error(
              `Invalid pool address format: ${input.config.address}`
            );
            log.methodError(this.logger, 'update', error, { id, input });
            throw error;
          }
          mergedConfig.address = normalizeAddress(input.config.address);
        }

        if (input.config.token0) {
          if (!isValidAddress(input.config.token0)) {
            const error = new Error(
              `Invalid token0 address format: ${input.config.token0}`
            );
            log.methodError(this.logger, 'update', error, { id, input });
            throw error;
          }
          mergedConfig.token0 = normalizeAddress(input.config.token0);
        }

        if (input.config.token1) {
          if (!isValidAddress(input.config.token1)) {
            const error = new Error(
              `Invalid token1 address format: ${input.config.token1}`
            );
            log.methodError(this.logger, 'update', error, { id, input });
            throw error;
          }
          mergedConfig.token1 = normalizeAddress(input.config.token1);
        }

        const config = new UniswapV3PoolConfig(mergedConfig);
        data.config = config.toJSON() as object;
      }

      // Handle state update
      if (input.state !== undefined) {
        // Get existing pool to merge with partial state
        const existing = await this.findById(id, tx);
        if (!existing) {
          const error = new Error(`Pool ${id} not found`);
          log.methodError(this.logger, 'update', error, { id });
          throw error;
        }

        const mergedState: UniswapV3PoolState = {
          ...existing.typedState,
          ...input.state,
        };

        data.state = stateToJSON(mergedState) as object;
      }

      log.dbOperation(this.logger, 'update', 'Pool', { id, fields: Object.keys(data) });

      const result = await client.pool.update({
        where: { id },
        data,
        include: {
          token0: true,
          token1: true,
        },
      });

      const pool = this.mapToUniswapV3Pool(result);

      log.methodExit(this.logger, 'update', { id });
      return pool;
    } catch (error) {
      // Only log if not already logged
      if (!(error instanceof Error && error.message.includes('Invalid'))) {
        log.methodError(this.logger, 'update', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Delete pool
   *
   * Verifies protocol type and checks for dependent positions.
   * Silently succeeds if pool doesn't exist (idempotent).
   *
   * @param id - Pool ID
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Promise that resolves when deletion is complete
   * @throws Error if pool exists but is not uniswapv3 protocol
   * @throws Error if pool has dependent positions
   */
  async delete(id: string, tx?: PrismaTransactionClient): Promise<void> {
    log.methodEntry(this.logger, 'delete', { id, inTransaction: !!tx });

    try {
      const client = tx ?? this.prisma;

      // Check if pool exists and verify protocol type
      log.dbOperation(this.logger, 'findUnique', 'Pool', { id });

      const existing = await client.pool.findUnique({
        where: { id },
        include: {
          positions: {
            take: 1, // Just check if any exist
          },
        },
      });

      if (!existing) {
        this.logger.debug({ id }, 'Pool not found, delete operation is no-op');
        log.methodExit(this.logger, 'delete', { id, deleted: false });
        return;
      }

      // Verify protocol type
      if (existing.protocol !== 'uniswapv3') {
        const error = new Error(
          `Cannot delete pool ${id}: expected protocol 'uniswapv3', got '${existing.protocol}'`
        );
        log.methodError(this.logger, 'delete', error, { id, protocol: existing.protocol });
        throw error;
      }

      // Check for dependent positions
      if (existing.positions.length > 0) {
        const error = new Error(
          `Cannot delete pool ${id}: pool has dependent positions. Delete positions first.`
        );
        log.methodError(this.logger, 'delete', error, { id });
        throw error;
      }

      // Delete pool
      log.dbOperation(this.logger, 'delete', 'Pool', { id });
      await client.pool.delete({ where: { id } });

      this.logger.info(
        { id, protocol: existing.protocol, poolType: existing.poolType },
        'Pool deleted successfully'
      );

      log.methodExit(this.logger, 'delete', { id, deleted: true });
    } catch (error) {
      // Only log if not already logged
      if (!(error instanceof Error && error.message.includes('Cannot delete'))) {
        log.methodError(this.logger, 'delete', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Refresh pool state from on-chain data
   *
   * Fetches the current pool state from the blockchain and updates the database.
   * This is the primary method for updating pool state (vs update() which is a generic helper).
   *
   * Note: Only updates mutable state fields (sqrtPriceX96, liquidity, currentTick, feeGrowth).
   * Config fields (address, token addresses, fee, tickSpacing) are immutable and not updated.
   *
   * @param id - Pool ID
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Updated pool with fresh on-chain state and full Token objects
   * @throws Error if pool not found
   * @throws Error if pool is not uniswapv3 protocol
   * @throws Error if chain is not supported
   * @throws Error if on-chain read fails
   */
  async refresh(id: string, tx?: PrismaTransactionClient): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'refresh', { id, inTransaction: !!tx });

    try {
      // Delegate to refreshPoolState for the heavy lifting
      await this.refreshPoolState(id, tx);

      // Return the updated pool
      const updated = await this.findById(id, tx);
      if (!updated) {
        // This shouldn't happen since refreshPoolState would have thrown
        const error = new Error(`Pool not found after refresh: ${id}`);
        log.methodError(this.logger, 'refresh', error, { id });
        throw error;
      }

      log.methodExit(this.logger, 'refresh', { id });
      return updated;
    } catch (error) {
      // Only log if not already logged by refreshPoolState
      if (
        !(error instanceof Error &&
          (error.message.includes('not found') ||
           error.message.includes('not configured')))
      ) {
        log.methodError(this.logger, 'refresh', error as Error, { id });
      }
      throw error;
    }
  }

  // ============================================================================
  // QUERY METHODS
  // ============================================================================

  /**
   * Get current pool price from on-chain data
   *
   * Fetches only sqrtPriceX96 and currentTick from the pool contract.
   * This is a lightweight operation optimized for frequent price checks
   * without updating the database.
   *
   * @param chainId - Chain ID where the pool is deployed
   * @param poolAddress - Pool contract address
   * @returns Current price data { sqrtPriceX96, currentTick }
   * @throws Error if chain is not supported
   * @throws Error if pool address is invalid
   * @throws Error if on-chain read fails
   */
  async getPoolPrice(
    chainId: number,
    poolAddress: string
  ): Promise<{ sqrtPriceX96: string; currentTick: number }> {
    log.methodEntry(this.logger, 'getPoolPrice', { chainId, poolAddress });

    try {
      // 1. Validate pool address format
      if (!isValidAddress(poolAddress)) {
        const error = new Error(
          `Invalid pool address format: ${poolAddress}`
        );
        log.methodError(this.logger, 'getPoolPrice', error, {
          poolAddress,
          chainId,
        });
        throw error;
      }

      // 2. Normalize to EIP-55
      const normalizedAddress = normalizeAddress(poolAddress);

      // 3. Verify chain is supported
      if (!this.evmConfig.isChainSupported(chainId)) {
        const error = new Error(
          `Chain ${chainId} is not configured. Supported chains: ${this.evmConfig
            .getSupportedChainIds()
            .join(', ')}`
        );
        log.methodError(this.logger, 'getPoolPrice', error, { chainId });
        throw error;
      }

      // 4. Get public client for the chain
      const client = this.evmConfig.getPublicClient(chainId);

      // 5. Read slot0 to get current price and tick
      this.logger.debug(
        { poolAddress: normalizedAddress, chainId },
        'Reading slot0 from pool contract'
      );

      const slot0Data = (await client.readContract({
        address: normalizedAddress as `0x${string}`,
        abi: uniswapV3PoolAbi,
        functionName: 'slot0',
      })) as readonly [bigint, number, number, number, number, number, boolean];

      const sqrtPriceX96 = slot0Data[0];
      const currentTick = slot0Data[1];

      this.logger.info(
        {
          poolAddress: normalizedAddress,
          chainId,
          sqrtPriceX96: sqrtPriceX96.toString(),
          currentTick,
        },
        'Pool price fetched successfully'
      );

      log.methodExit(this.logger, 'getPoolPrice', {
        sqrtPriceX96: sqrtPriceX96.toString(),
        currentTick,
      });

      return {
        sqrtPriceX96: sqrtPriceX96.toString(),
        currentTick,
      };
    } catch (error) {
      // Only log if not already logged
      if (!(error instanceof Error && error.message.includes('Invalid'))) {
        log.methodError(this.logger, 'getPoolPrice', error as Error, {
          poolAddress,
          chainId,
        });
      }
      throw error;
    }
  }

  /**
   * Update pool price in the database.
   *
   * Simply persists the provided sqrtPriceX96 and currentTick to the database
   * without making any RPC calls.
   *
   * @param id - Pool database ID
   * @param priceData - Price data { sqrtPriceX96: bigint, currentTick: number }
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Updated pool
   */
  async setPoolPrice(
    id: string,
    priceData: { sqrtPriceX96: bigint; currentTick: number },
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'setPoolPrice', { id, inTransaction: !!tx });

    try {
      const updated = await this.update(
        id,
        {
          state: {
            sqrtPriceX96: priceData.sqrtPriceX96,
            currentTick: priceData.currentTick,
          },
        },
        tx
      );

      this.logger.debug(
        {
          id,
          sqrtPriceX96: priceData.sqrtPriceX96.toString(),
          currentTick: priceData.currentTick,
        },
        'Pool price updated'
      );

      log.methodExit(this.logger, 'setPoolPrice', { id });
      return updated;
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('not found'))) {
        log.methodError(this.logger, 'setPoolPrice', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Refresh pool price from on-chain data by pool ID.
   *
   * Fetches the current price from on-chain and persists it to the database.
   *
   * @param id - Pool database ID
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Current price data { sqrtPriceX96: string, currentTick: number }
   * @throws Error if pool not found
   * @throws Error if chain is not supported
   * @throws Error if on-chain read fails
   */
  async refreshPoolPrice(
    id: string,
    tx?: PrismaTransactionClient
  ): Promise<{ sqrtPriceX96: string; currentTick: number }> {
    log.methodEntry(this.logger, 'refreshPoolPrice', { id, inTransaction: !!tx });

    try {
      // 1. Get existing pool to get address and chainId
      const existing = await this.findById(id);
      if (!existing) {
        const error = new Error(`Pool not found: ${id}`);
        log.methodError(this.logger, 'refreshPoolPrice', error, { id });
        throw error;
      }

      // 2. Call getPoolPrice with the pool's address and chainId
      const priceData = await this.getPoolPrice(
        existing.chainId,
        existing.address
      );

      // 3. Persist to database
      await this.setPoolPrice(
        id,
        {
          sqrtPriceX96: BigInt(priceData.sqrtPriceX96),
          currentTick: priceData.currentTick,
        },
        tx
      );

      log.methodExit(this.logger, 'refreshPoolPrice', {
        id,
        sqrtPriceX96: priceData.sqrtPriceX96,
        currentTick: priceData.currentTick,
      });

      return priceData;
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('not found'))) {
        log.methodError(this.logger, 'refreshPoolPrice', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Update pool liquidity in the database.
   *
   * Simply persists the provided liquidity to the database
   * without making any RPC calls.
   *
   * @param id - Pool database ID
   * @param liquidity - Pool liquidity value
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Updated pool
   */
  async setPoolLiquidity(
    id: string,
    liquidity: bigint,
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'setPoolLiquidity', { id, inTransaction: !!tx });

    try {
      const updated = await this.update(
        id,
        {
          state: {
            liquidity,
          },
        },
        tx
      );

      this.logger.debug(
        {
          id,
          liquidity: liquidity.toString(),
        },
        'Pool liquidity updated'
      );

      log.methodExit(this.logger, 'setPoolLiquidity', { id });
      return updated;
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('not found'))) {
        log.methodError(this.logger, 'setPoolLiquidity', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Refresh pool liquidity from on-chain data by pool ID.
   *
   * Fetches the current liquidity from on-chain and persists it to the database.
   *
   * @param id - Pool database ID
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Current liquidity as string
   * @throws Error if pool not found
   * @throws Error if chain is not supported
   * @throws Error if on-chain read fails
   */
  async refreshPoolLiquidity(
    id: string,
    tx?: PrismaTransactionClient
  ): Promise<string> {
    log.methodEntry(this.logger, 'refreshPoolLiquidity', { id, inTransaction: !!tx });

    try {
      // 1. Get existing pool to get address and chainId
      const existing = await this.findById(id);
      if (!existing) {
        const error = new Error(`Pool not found: ${id}`);
        log.methodError(this.logger, 'refreshPoolLiquidity', error, { id });
        throw error;
      }

      // 2. Verify chain is supported
      if (!this.evmConfig.isChainSupported(existing.chainId)) {
        const error = new Error(
          `Chain ${existing.chainId} is not configured. Supported chains: ${this.evmConfig
            .getSupportedChainIds()
            .join(', ')}`
        );
        log.methodError(this.logger, 'refreshPoolLiquidity', error, {
          id,
          chainId: existing.chainId,
        });
        throw error;
      }

      // 3. Get public client for the chain
      const client = this.evmConfig.getPublicClient(existing.chainId);
      const poolAddress = existing.address as `0x${string}`;

      // 4. Read liquidity from pool contract
      this.logger.debug(
        { id, poolAddress, chainId: existing.chainId },
        'Reading liquidity from pool contract'
      );

      const liquidity = (await client.readContract({
        address: poolAddress,
        abi: uniswapV3PoolAbi,
        functionName: 'liquidity',
      })) as bigint;

      // 5. Persist to database
      await this.setPoolLiquidity(id, liquidity, tx);

      this.logger.info(
        {
          id,
          poolAddress,
          chainId: existing.chainId,
          liquidity: liquidity.toString(),
        },
        'Pool liquidity refreshed and persisted'
      );

      log.methodExit(this.logger, 'refreshPoolLiquidity', {
        id,
        liquidity: liquidity.toString(),
      });

      return liquidity.toString();
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          (error.message.includes('not found') ||
            error.message.includes('not configured'))
        )
      ) {
        log.methodError(this.logger, 'refreshPoolLiquidity', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Update pool fee growth in the database.
   *
   * Simply persists the provided feeGrowthGlobal0 and feeGrowthGlobal1 to the database
   * without making any RPC calls.
   *
   * @param id - Pool database ID
   * @param feeGrowthData - Fee growth data { feeGrowthGlobal0: bigint, feeGrowthGlobal1: bigint }
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Updated pool
   */
  async setPoolFeeGrowth(
    id: string,
    feeGrowthData: { feeGrowthGlobal0: bigint; feeGrowthGlobal1: bigint },
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'setPoolFeeGrowth', { id, inTransaction: !!tx });

    try {
      const updated = await this.update(
        id,
        {
          state: {
            feeGrowthGlobal0: feeGrowthData.feeGrowthGlobal0,
            feeGrowthGlobal1: feeGrowthData.feeGrowthGlobal1,
          },
        },
        tx
      );

      this.logger.debug(
        {
          id,
          feeGrowthGlobal0: feeGrowthData.feeGrowthGlobal0.toString(),
          feeGrowthGlobal1: feeGrowthData.feeGrowthGlobal1.toString(),
        },
        'Pool fee growth updated'
      );

      log.methodExit(this.logger, 'setPoolFeeGrowth', { id });
      return updated;
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('not found'))) {
        log.methodError(this.logger, 'setPoolFeeGrowth', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Refresh pool fee growth from on-chain data by pool ID.
   *
   * Fetches the current fee growth values from on-chain and persists them to the database.
   *
   * @param id - Pool database ID
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Current fee growth data { feeGrowthGlobal0: string, feeGrowthGlobal1: string }
   * @throws Error if pool not found
   * @throws Error if chain is not supported
   * @throws Error if on-chain read fails
   */
  async refreshPoolFeeGrowth(
    id: string,
    tx?: PrismaTransactionClient
  ): Promise<{ feeGrowthGlobal0: string; feeGrowthGlobal1: string }> {
    log.methodEntry(this.logger, 'refreshPoolFeeGrowth', { id, inTransaction: !!tx });

    try {
      // 1. Get existing pool to get address and chainId
      const existing = await this.findById(id);
      if (!existing) {
        const error = new Error(`Pool not found: ${id}`);
        log.methodError(this.logger, 'refreshPoolFeeGrowth', error, { id });
        throw error;
      }

      // 2. Verify chain is supported
      if (!this.evmConfig.isChainSupported(existing.chainId)) {
        const error = new Error(
          `Chain ${existing.chainId} is not configured. Supported chains: ${this.evmConfig
            .getSupportedChainIds()
            .join(', ')}`
        );
        log.methodError(this.logger, 'refreshPoolFeeGrowth', error, {
          id,
          chainId: existing.chainId,
        });
        throw error;
      }

      // 3. Get public client for the chain
      const client = this.evmConfig.getPublicClient(existing.chainId);
      const poolAddress = existing.address as `0x${string}`;

      // 4. Read feeGrowthGlobal0X128 and feeGrowthGlobal1X128 in parallel
      this.logger.debug(
        { id, poolAddress, chainId: existing.chainId },
        'Reading fee growth from pool contract'
      );

      const [feeGrowthGlobal0, feeGrowthGlobal1] = await Promise.all([
        client.readContract({
          address: poolAddress,
          abi: uniswapV3PoolAbi,
          functionName: 'feeGrowthGlobal0X128',
        }) as Promise<bigint>,
        client.readContract({
          address: poolAddress,
          abi: uniswapV3PoolAbi,
          functionName: 'feeGrowthGlobal1X128',
        }) as Promise<bigint>,
      ]);

      // 5. Persist to database
      await this.setPoolFeeGrowth(
        id,
        {
          feeGrowthGlobal0,
          feeGrowthGlobal1,
        },
        tx
      );

      this.logger.info(
        {
          id,
          poolAddress,
          chainId: existing.chainId,
          feeGrowthGlobal0: feeGrowthGlobal0.toString(),
          feeGrowthGlobal1: feeGrowthGlobal1.toString(),
        },
        'Pool fee growth refreshed and persisted'
      );

      log.methodExit(this.logger, 'refreshPoolFeeGrowth', {
        id,
        feeGrowthGlobal0: feeGrowthGlobal0.toString(),
        feeGrowthGlobal1: feeGrowthGlobal1.toString(),
      });

      return {
        feeGrowthGlobal0: feeGrowthGlobal0.toString(),
        feeGrowthGlobal1: feeGrowthGlobal1.toString(),
      };
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          (error.message.includes('not found') ||
            error.message.includes('not configured'))
        )
      ) {
        log.methodError(this.logger, 'refreshPoolFeeGrowth', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Update complete pool state in the database.
   *
   * Simply persists all state fields to the database without making any RPC calls.
   * This is the most efficient way to update all state fields at once.
   *
   * @param id - Pool database ID
   * @param stateData - Complete state data
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Updated pool
   */
  async setPoolState(
    id: string,
    stateData: {
      sqrtPriceX96: bigint;
      currentTick: number;
      liquidity: bigint;
      feeGrowthGlobal0: bigint;
      feeGrowthGlobal1: bigint;
    },
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'setPoolState', { id, inTransaction: !!tx });

    try {
      const updated = await this.update(
        id,
        {
          state: {
            sqrtPriceX96: stateData.sqrtPriceX96,
            currentTick: stateData.currentTick,
            liquidity: stateData.liquidity,
            feeGrowthGlobal0: stateData.feeGrowthGlobal0,
            feeGrowthGlobal1: stateData.feeGrowthGlobal1,
          },
        },
        tx
      );

      this.logger.debug(
        {
          id,
          sqrtPriceX96: stateData.sqrtPriceX96.toString(),
          currentTick: stateData.currentTick,
          liquidity: stateData.liquidity.toString(),
          feeGrowthGlobal0: stateData.feeGrowthGlobal0.toString(),
          feeGrowthGlobal1: stateData.feeGrowthGlobal1.toString(),
        },
        'Pool state updated'
      );

      log.methodExit(this.logger, 'setPoolState', { id });
      return updated;
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('not found'))) {
        log.methodError(this.logger, 'setPoolState', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Refresh complete pool state from on-chain data by pool ID.
   *
   * Fetches all state values (price, liquidity, fee growth) from on-chain
   * in parallel and persists them to the database in a single update.
   *
   * This is more efficient than calling individual refresh methods separately
   * as it batches both RPC reads and database writes.
   *
   * @param id - Pool database ID
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Complete state data with all fields as strings
   * @throws Error if pool not found
   * @throws Error if chain is not supported
   * @throws Error if on-chain read fails
   */
  async refreshPoolState(
    id: string,
    tx?: PrismaTransactionClient
  ): Promise<{
    sqrtPriceX96: string;
    currentTick: number;
    liquidity: string;
    feeGrowthGlobal0: string;
    feeGrowthGlobal1: string;
  }> {
    log.methodEntry(this.logger, 'refreshPoolState', { id, inTransaction: !!tx });

    try {
      // 1. Get existing pool to get address and chainId
      const existing = await this.findById(id);
      if (!existing) {
        const error = new Error(`Pool not found: ${id}`);
        log.methodError(this.logger, 'refreshPoolState', error, { id });
        throw error;
      }

      // 2. Verify chain is supported
      if (!this.evmConfig.isChainSupported(existing.chainId)) {
        const error = new Error(
          `Chain ${existing.chainId} is not configured. Supported chains: ${this.evmConfig
            .getSupportedChainIds()
            .join(', ')}`
        );
        log.methodError(this.logger, 'refreshPoolState', error, {
          id,
          chainId: existing.chainId,
        });
        throw error;
      }

      // 3. Get public client for the chain
      const client = this.evmConfig.getPublicClient(existing.chainId);
      const poolAddress = existing.address as `0x${string}`;

      // 4. Read all state values in parallel
      this.logger.debug(
        { id, poolAddress, chainId: existing.chainId },
        'Reading complete pool state from contract'
      );

      const [slot0Data, liquidity, feeGrowthGlobal0, feeGrowthGlobal1] =
        await Promise.all([
          client.readContract({
            address: poolAddress,
            abi: uniswapV3PoolAbi,
            functionName: 'slot0',
          }) as Promise<
            readonly [bigint, number, number, number, number, number, boolean]
          >,
          client.readContract({
            address: poolAddress,
            abi: uniswapV3PoolAbi,
            functionName: 'liquidity',
          }) as Promise<bigint>,
          client.readContract({
            address: poolAddress,
            abi: uniswapV3PoolAbi,
            functionName: 'feeGrowthGlobal0X128',
          }) as Promise<bigint>,
          client.readContract({
            address: poolAddress,
            abi: uniswapV3PoolAbi,
            functionName: 'feeGrowthGlobal1X128',
          }) as Promise<bigint>,
        ]);

      const sqrtPriceX96 = slot0Data[0];
      const currentTick = slot0Data[1];

      // 5. Persist all state to database in single update
      await this.setPoolState(
        id,
        {
          sqrtPriceX96,
          currentTick,
          liquidity,
          feeGrowthGlobal0,
          feeGrowthGlobal1,
        },
        tx
      );

      this.logger.info(
        {
          id,
          poolAddress,
          chainId: existing.chainId,
          sqrtPriceX96: sqrtPriceX96.toString(),
          currentTick,
          liquidity: liquidity.toString(),
          feeGrowthGlobal0: feeGrowthGlobal0.toString(),
          feeGrowthGlobal1: feeGrowthGlobal1.toString(),
        },
        'Pool state refreshed and persisted'
      );

      log.methodExit(this.logger, 'refreshPoolState', { id });

      return {
        sqrtPriceX96: sqrtPriceX96.toString(),
        currentTick,
        liquidity: liquidity.toString(),
        feeGrowthGlobal0: feeGrowthGlobal0.toString(),
        feeGrowthGlobal1: feeGrowthGlobal1.toString(),
      };
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          (error.message.includes('not found') ||
            error.message.includes('not configured'))
        )
      ) {
        log.methodError(this.logger, 'refreshPoolState', error as Error, { id });
      }
      throw error;
    }
  }

  /**
   * Find pool by address and chain
   *
   * @param address - Pool address (normalized or not - will be normalized internally)
   * @param chainId - Chain ID
   * @param tx - Optional Prisma transaction client for batching operations
   * @returns Pool with full Token objects if found, null otherwise
   */
  async findByAddressAndChain(
    address: string,
    chainId: number,
    tx?: PrismaTransactionClient
  ): Promise<UniswapV3Pool | null> {
    log.dbOperation(this.logger, 'findFirst', 'Pool', {
      address,
      chainId,
      protocol: 'uniswapv3',
      inTransaction: !!tx,
    });

    const client = tx ?? this.prisma;

    const result = await client.pool.findFirst({
      where: {
        protocol: 'uniswapv3',
        // Query config JSON field for address and chainId
        config: {
          path: ['address'],
          equals: address,
        },
      },
      include: {
        token0: true,
        token1: true,
      },
    });

    if (!result) {
      return null;
    }

    // Map to UniswapV3Pool
    const pool = this.mapToUniswapV3Pool(result);

    // Verify chainId matches (additional safeguard)
    if (pool.chainId !== chainId) {
      return null;
    }

    return pool;
  }
}
