/**
 * Uniswap V3 Pool Price Service
 *
 * Service for managing historic pool price snapshots for Uniswap V3 pools.
 * Handles serialization/deserialization of Uniswap V3-specific config and state.
 *
 * Pool prices are historic snapshots used for:
 * - PnL calculations (comparing current value to historic cost basis)
 * - Historical analysis and charting
 * - Performance tracking over time
 */

import { PoolPriceService } from "./pool-price-service.js";
import type { PoolPriceServiceDependencies } from "./pool-price-service.js";
import type {
    UniswapV3PoolPriceConfig,
    UniswapV3PoolPriceState,
} from "@midcurve/shared";
import type { UniswapV3PoolPrice } from "@midcurve/shared";
import type {
    CreatePoolPriceInput,
    UniswapV3PoolPriceDiscoverInput,
} from "../types/pool-price/pool-price-input.js";
import {
    parseUniswapV3PoolPriceConfig,
    serializeUniswapV3PoolPriceConfig,
    parseUniswapV3PoolPriceState,
    serializeUniswapV3PoolPriceState,
} from "../types/pool-price/uniswapv3/pool-price-db.js";
import type {
    UniswapV3PoolPriceConfigDB,
    UniswapV3PoolPriceStateDB,
} from "../types/pool-price/uniswapv3/pool-price-db.js";
import { log } from "../../logging/index.js";
import { uniswapV3PoolAbi } from "../../utils/uniswapv3/pool-abi.js";
import {
    pricePerToken0InToken1,
    pricePerToken1InToken0,
} from "@midcurve/shared";
import type { UniswapV3PoolConfig } from "@midcurve/shared";

/**
 * Uniswap V3 Pool Price Service
 *
 * Extends PoolPriceService with Uniswap V3-specific implementation.
 *
 * Features:
 * - Serialization of bigint values (sqrtPriceX96) to strings for database storage
 * - Protocol validation (ensures only 'uniswapv3' pool prices)
 * - Type-safe operations with UniswapV3PoolPrice
 */
export class UniswapV3PoolPriceService extends PoolPriceService<"uniswapv3"> {
    /**
     * Creates a new UniswapV3PoolPriceService instance
     *
     * @param dependencies - Optional dependencies object
     * @param dependencies.prisma - Prisma client instance (creates default if not provided)
     */
    constructor(dependencies: PoolPriceServiceDependencies = {}) {
        super(dependencies);
    }

    // ============================================================================
    // SERIALIZATION IMPLEMENTATION
    // ============================================================================

    /**
     * Parse config from database JSON to application type
     *
     * Config contains only primitives (number), so this is a pass-through.
     *
     * @param configDB - Config object from database
     * @returns Parsed config (unchanged)
     */
    parseConfig(configDB: unknown): UniswapV3PoolPriceConfig {
        return parseUniswapV3PoolPriceConfig(
            configDB as UniswapV3PoolPriceConfigDB
        );
    }

    /**
     * Serialize config from application type to database JSON
     *
     * Config contains only primitives (number), so this is a pass-through.
     *
     * @param config - Application config
     * @returns Serialized config (unchanged)
     */
    serializeConfig(config: UniswapV3PoolPriceConfig): unknown {
        return serializeUniswapV3PoolPriceConfig(config);
    }

    /**
     * Parse state from database JSON to application type
     *
     * Converts string values (sqrtPriceX96) to bigint.
     *
     * @param stateDB - State object from database
     * @returns Parsed state with bigint values
     */
    parseState(stateDB: unknown): UniswapV3PoolPriceState {
        return parseUniswapV3PoolPriceState(
            stateDB as UniswapV3PoolPriceStateDB
        );
    }

    /**
     * Serialize state from application type to database JSON
     *
     * Converts bigint values (sqrtPriceX96) to strings.
     *
     * @param state - Application state with bigint values
     * @returns Serialized state for database storage
     */
    serializeState(state: UniswapV3PoolPriceState): unknown {
        return serializeUniswapV3PoolPriceState(state);
    }

    // ============================================================================
    // DISCOVERY IMPLEMENTATION
    // ============================================================================

    /**
     * Discover and create a historic pool price snapshot from on-chain data
     *
     * Fetches pool state at a specific block number from the blockchain,
     * calculates prices, and stores in database. Idempotent - returns existing
     * record if price already exists for the given pool and block.
     *
     * @param poolId - Pool ID to fetch price for
     * @param params - Discovery parameters (blockNumber)
     * @returns The discovered or existing pool price snapshot
     * @throws Error if pool not found, not uniswapv3, chain not supported, or RPC call fails
     */
    async discover(
        poolId: string,
        params: UniswapV3PoolPriceDiscoverInput
    ): Promise<UniswapV3PoolPrice> {
        log.methodEntry(this.logger, "discover", { poolId, params });

        try {
            // 1. Fetch pool from database (with tokens)
            const pool = await this.prisma.pool.findUnique({
                where: { id: poolId },
                include: {
                    token0: true,
                    token1: true,
                },
            });

            if (!pool) {
                const error = new Error(`Pool not found: ${poolId}`);
                log.methodError(this.logger, "discover", error, { poolId });
                throw error;
            }

            // 2. Validate pool protocol
            if (pool.protocol !== "uniswapv3") {
                const error = new Error(
                    `Invalid pool protocol '${pool.protocol}'. Expected 'uniswapv3'.`
                );
                log.methodError(this.logger, "discover", error, {
                    poolId,
                    protocol: pool.protocol,
                });
                throw error;
            }

            // 3. Parse pool config to get chainId and pool address
            const poolConfig = pool.config as unknown as UniswapV3PoolConfig;
            const { chainId, address: poolAddress } = poolConfig;

            // 4. Check for existing price snapshot at this block (idempotent)
            const existingPrice = await this.prisma.poolPrice.findFirst({
                where: {
                    poolId,
                    protocol: "uniswapv3",
                    config: {
                        path: ["blockNumber"],
                        equals: params.blockNumber,
                    },
                },
            });

            if (existingPrice) {
                this.logger.info(
                    { poolId, blockNumber: params.blockNumber },
                    "Pool price already exists, returning cached"
                );
                // Parse and return existing price
                return {
                    id: existingPrice.id,
                    createdAt: existingPrice.createdAt,
                    updatedAt: existingPrice.updatedAt,
                    protocol: "uniswapv3",
                    poolId: existingPrice.poolId,
                    timestamp: existingPrice.timestamp,
                    token1PricePerToken0: BigInt(
                        existingPrice.token1PricePerToken0
                    ),
                    token0PricePerToken1: BigInt(
                        existingPrice.token0PricePerToken1
                    ),
                    config: this.parseConfig(existingPrice.config),
                    state: this.parseState(existingPrice.state),
                };
            }

            // 5. Validate chain support
            if (!this.evmConfig.isChainSupported(chainId)) {
                const error = new Error(
                    `Chain ${chainId} is not supported. Please configure RPC_URL_${this.evmConfig
                        .getChainConfig(chainId)
                        ?.name.toUpperCase()}`
                );
                log.methodError(this.logger, "discover", error, { chainId });
                throw error;
            }

            // 6. Get public client for the chain
            const client = this.evmConfig.getPublicClient(chainId);

            // 7. Fetch block info to get timestamp
            this.logger.debug(
                { blockNumber: params.blockNumber },
                "Fetching block info"
            );
            const block = await client.getBlock({
                blockNumber: BigInt(params.blockNumber),
            });

            const blockTimestamp = Number(block.timestamp);
            const timestamp = new Date(blockTimestamp * 1000);

            // 8. Read pool state at specific block
            this.logger.debug(
                { poolAddress, blockNumber: params.blockNumber },
                "Reading pool slot0 at block"
            );

            let slot0Data: readonly [
                bigint,
                number,
                number,
                number,
                number,
                number,
                boolean
            ];
            let usedCurrentBlock = false;

            try {
                // Try to read at the specified historical block
                slot0Data = (await client.readContract({
                    address: poolAddress as `0x${string}`,
                    abi: uniswapV3PoolAbi,
                    functionName: "slot0",
                    blockNumber: BigInt(params.blockNumber),
                })) as readonly [
                    bigint,
                    number,
                    number,
                    number,
                    number,
                    number,
                    boolean
                ];
            } catch (historicalError) {
                // If historical block query fails (block too recent or not indexed yet),
                // fall back to current block as approximation
                this.logger.warn(
                    {
                        poolAddress,
                        blockNumber: params.blockNumber,
                        error: (historicalError as Error).message,
                    },
                    "Failed to read pool state at historical block, falling back to current block"
                );

                slot0Data = (await client.readContract({
                    address: poolAddress as `0x${string}`,
                    abi: uniswapV3PoolAbi,
                    functionName: "slot0",
                    // No blockNumber = current block
                })) as readonly [
                    bigint,
                    number,
                    number,
                    number,
                    number,
                    number,
                    boolean
                ];

                usedCurrentBlock = true;
            }

            const sqrtPriceX96 = slot0Data[0];
            const tick = slot0Data[1];

            if (usedCurrentBlock) {
                this.logger.info(
                    {
                        poolAddress,
                        requestedBlock: params.blockNumber,
                        sqrtPriceX96: sqrtPriceX96.toString(),
                    },
                    "Used current block price as fallback for recent transaction"
                );
            }

            // 9. Calculate prices using utility functions
            const token1PricePerToken0 = pricePerToken0InToken1(
                sqrtPriceX96,
                pool.token0.decimals
            );
            const token0PricePerToken1 = pricePerToken1InToken0(
                sqrtPriceX96,
                pool.token1.decimals
            );

            this.logger.debug(
                {
                    sqrtPriceX96: sqrtPriceX96.toString(),
                    tick,
                    token1PricePerToken0: token1PricePerToken0.toString(),
                    token0PricePerToken1: token0PricePerToken1.toString(),
                },
                "Calculated prices from pool state"
            );

            // 10. Create pool price record
            const poolPrice = await this.create({
                protocol: "uniswapv3",
                poolId,
                timestamp,
                token1PricePerToken0,
                token0PricePerToken1,
                config: {
                    blockNumber: params.blockNumber,
                    blockTimestamp,
                },
                state: {
                    sqrtPriceX96,
                    tick,
                },
            });

            this.logger.info(
                {
                    id: poolPrice.id,
                    poolId,
                    blockNumber: params.blockNumber,
                    timestamp,
                },
                "Pool price discovered and saved"
            );
            log.methodExit(this.logger, "discover", { id: poolPrice.id });
            return poolPrice;
        } catch (error) {
            log.methodError(this.logger, "discover", error as Error, {
                poolId,
                params,
            });
            throw error;
        }
    }

    // ============================================================================
    // CRUD OVERRIDES WITH TYPE SAFETY
    // ============================================================================

    /**
     * Create a new Uniswap V3 pool price snapshot
     *
     * Overrides base implementation to add protocol validation.
     * Ensures that only 'uniswapv3' pool prices are created.
     *
     * @param input - Pool price data to create
     * @returns The created pool price with generated id and timestamps
     * @throws Error if protocol is not 'uniswapv3'
     */
    override async create(
        input: CreatePoolPriceInput<"uniswapv3">
    ): Promise<UniswapV3PoolPrice> {
        // Validate protocol
        if (input.protocol !== "uniswapv3") {
            const error = new Error(
                `Invalid protocol '${input.protocol}' for UniswapV3PoolPriceService. Expected 'uniswapv3'.`
            );
            log.methodError(this.logger, "create", error, {
                protocol: input.protocol,
            });
            throw error;
        }

        return super.create(input);
    }

    /**
     * Find pool price by ID
     *
     * Overrides base implementation to add protocol validation.
     * Ensures that the returned pool price is a Uniswap V3 pool price.
     *
     * @param id - Pool price ID
     * @returns Pool price if found and is 'uniswapv3' protocol, null otherwise
     */
    override async findById(id: string): Promise<UniswapV3PoolPrice | null> {
        const poolPrice = await super.findById(id);

        if (!poolPrice) {
            return null;
        }

        // Validate protocol
        if (poolPrice.protocol !== "uniswapv3") {
            this.logger.warn(
                { id, protocol: poolPrice.protocol },
                "Pool price found but is not uniswapv3 protocol"
            );
            return null;
        }

        return poolPrice;
    }

    /**
     * Find all pool prices for a specific pool
     *
     * Returns only Uniswap V3 pool prices for the specified pool.
     *
     * @param poolId - Pool ID
     * @returns Array of Uniswap V3 pool prices, ordered by timestamp (newest first)
     */
    override async findByPoolId(poolId: string): Promise<UniswapV3PoolPrice[]> {
        const poolPrices = await super.findByPoolId(poolId);

        // Filter to only uniswapv3 protocol (should all be uniswapv3 if pool is uniswapv3)
        return poolPrices.filter((pp) => pp.protocol === "uniswapv3");
    }

    /**
     * Find pool prices for a specific pool within a time range
     *
     * Returns only Uniswap V3 pool prices within the specified time range.
     *
     * @param poolId - Pool ID
     * @param startTime - Start of time range (inclusive)
     * @param endTime - End of time range (inclusive)
     * @returns Array of Uniswap V3 pool prices within time range, ordered by timestamp (oldest first)
     */
    override async findByPoolIdAndTimeRange(
        poolId: string,
        startTime: Date,
        endTime: Date
    ): Promise<UniswapV3PoolPrice[]> {
        const poolPrices = await super.findByPoolIdAndTimeRange(
            poolId,
            startTime,
            endTime
        );

        // Filter to only uniswapv3 protocol (should all be uniswapv3 if pool is uniswapv3)
        return poolPrices.filter((pp) => pp.protocol === "uniswapv3");
    }

    /**
     * Delete pool price
     *
     * Overrides base implementation to add protocol validation.
     * Ensures that only Uniswap V3 pool prices are deleted.
     *
     * @param id - Pool price ID
     * @throws Error if pool price is not 'uniswapv3' protocol
     */
    override async delete(id: string): Promise<void> {
        // Fetch first to validate protocol
        const poolPrice = await super.findById(id);

        if (!poolPrice) {
            // Already doesn't exist, no-op
            return;
        }

        if (poolPrice.protocol !== "uniswapv3") {
            const error = new Error(
                `Cannot delete pool price with protocol '${poolPrice.protocol}' using UniswapV3PoolPriceService`
            );
            log.methodError(this.logger, "delete", error, {
                id,
                protocol: poolPrice.protocol,
            });
            throw error;
        }

        await super.delete(id);
    }
}
