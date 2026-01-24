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
import { PoolService } from './pool-service.js';
import type { PoolDbResult } from './pool-service.js';
import {
  readPoolConfig,
  readPoolState,
  PoolConfigError,
  uniswapV3PoolAbi,
} from '../../utils/uniswapv3/index.js';
import { EvmConfig } from '../../config/evm.js';
import { Erc20TokenService } from '../token/erc20-token-service.js';
import { log } from '../../logging/index.js';

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
export class UniswapV3PoolService extends PoolService {
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
    super(dependencies);
    this._evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
    this._erc20TokenService =
      dependencies.erc20TokenService ??
      new Erc20TokenService({ prisma: this.prisma });
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
   * @returns The created pool with full Token objects
   * @throws Error if address format is invalid
   */
  async create(
    input: CreateUniswapV3PoolInput
  ): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'create', {
      address: input.config.address,
      chainId: input.config.chainId,
      token0Id: input.token0Id,
      token1Id: input.token1Id,
    });

    try {
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

      const result = await this.prisma.pool.create({
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
   * @returns Pool if found and is uniswapv3 protocol, null otherwise
   */
  override async findById(id: string): Promise<UniswapV3Pool | null> {
    log.methodEntry(this.logger, 'findById', { id });

    try {
      log.dbOperation(this.logger, 'findUnique', 'Pool', { id });

      const result = await this.prisma.pool.findUnique({
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
   * @returns Updated pool with full Token objects
   * @throws Error if pool not found or not uniswapv3 protocol
   */
  async update(
    id: string,
    input: UpdateUniswapV3PoolInput
  ): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'update', { id, input });

    try {
      // Build update data
      const data: Record<string, unknown> = {};

      if (input.feeBps !== undefined) {
        data.feeBps = input.feeBps;
      }

      // Handle config update with address normalization
      if (input.config !== undefined) {
        // Get existing pool to merge with partial config
        const existing = await this.findById(id);
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
        const existing = await this.findById(id);
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

      const result = await this.prisma.pool.update({
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
   * @returns Promise that resolves when deletion is complete
   * @throws Error if pool exists but is not uniswapv3 protocol
   * @throws Error if pool has dependent positions
   */
  override async delete(id: string): Promise<void> {
    log.methodEntry(this.logger, 'delete', { id });

    try {
      // Check if pool exists and verify protocol type
      log.dbOperation(this.logger, 'findUnique', 'Pool', { id });

      const existing = await this.prisma.pool.findUnique({
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

      // Call base implementation
      await super.delete(id);

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
   * @returns Updated pool with fresh on-chain state and full Token objects
   * @throws Error if pool not found
   * @throws Error if pool is not uniswapv3 protocol
   * @throws Error if chain is not supported
   * @throws Error if on-chain read fails
   */
  async refresh(id: string): Promise<UniswapV3Pool> {
    log.methodEntry(this.logger, 'refresh', { id });

    try {
      // 1. Get existing pool to verify it exists and get config
      const existing = await this.findById(id);

      if (!existing) {
        const error = new Error(`Pool not found: ${id}`);
        log.methodError(this.logger, 'refresh', error, { id });
        throw error;
      }

      this.logger.debug(
        {
          id,
          address: existing.address,
          chainId: existing.chainId,
        },
        'Refreshing pool state from on-chain data'
      );

      // 2. Verify chain is supported
      if (!this.evmConfig.isChainSupported(existing.chainId)) {
        const error = new Error(
          `Chain ${existing.chainId} is not supported or not configured. Please configure RPC_URL_* environment variable.`
        );
        log.methodError(this.logger, 'refresh', error, { id, chainId: existing.chainId });
        throw error;
      }

      // 3. Read fresh state from on-chain
      const client = this.evmConfig.getPublicClient(existing.chainId);

      this.logger.debug(
        { id, address: existing.address, chainId: existing.chainId },
        'Reading fresh pool state from contract'
      );

      let freshState: UniswapV3PoolState;
      try {
        freshState = await readPoolState(client, existing.address);
      } catch (error) {
        const wrappedError = new Error(
          `Failed to read pool state from contract at ${existing.address} on chain ${existing.chainId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        log.methodError(this.logger, 'refresh', wrappedError, {
          id,
          address: existing.address,
          chainId: existing.chainId,
        });
        throw wrappedError;
      }

      this.logger.info(
        {
          id,
          address: existing.address,
          chainId: existing.chainId,
          sqrtPriceX96: freshState.sqrtPriceX96.toString(),
          liquidity: freshState.liquidity.toString(),
          currentTick: freshState.currentTick,
        },
        'Fresh pool state read from contract'
      );

      // 4. Update pool state using update() method
      const updated = await this.update(id, {
        state: freshState,
      });

      this.logger.info(
        {
          id,
          address: existing.address,
          chainId: existing.chainId,
        },
        'Pool state refreshed successfully'
      );

      log.methodExit(this.logger, 'refresh', { id });
      return updated;
    } catch (error) {
      // Only log if not already logged
      if (
        !(error instanceof Error &&
          (error.message.includes('not found') ||
           error.message.includes('not supported') ||
           error.message.includes('Failed to read')))
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
   * Find pool by address and chain
   *
   * @param address - Pool address (normalized)
   * @param chainId - Chain ID
   * @returns Pool with full Token objects if found, null otherwise
   */
  private async findByAddressAndChain(
    address: string,
    chainId: number
  ): Promise<UniswapV3Pool | null> {
    log.dbOperation(this.logger, 'findFirst', 'Pool', {
      address,
      chainId,
      protocol: 'uniswapv3',
    });

    const result = await this.prisma.pool.findFirst({
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
