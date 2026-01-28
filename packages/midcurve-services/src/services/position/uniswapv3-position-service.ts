/**
 * UniswapV3PositionService
 *
 * Specialized service for Uniswap V3 position management.
 * Handles serialization/deserialization of Uniswap V3 position config and state.
 */

import { PrismaClient } from "@midcurve/database";
import type {
    UniswapV3PositionConfigData,
    UniswapV3PositionState,
    PositionProtocol,
    PositionInterface,
    PositionRow,
    Erc20TokenRow,
    UniswapV3PoolRow,
} from "@midcurve/shared";
import {
    UniswapV3Position,
    PositionFactory,
    Erc20Token,
    PoolFactory,
} from "@midcurve/shared";
import type { UniswapV3Pool } from "@midcurve/shared";
import type {
    UniswapV3PositionDiscoverInput,
    CreateUniswapV3PositionInput,
    UpdateAnyPositionInput,
} from "../types/position/position-input.js";
import { createServiceLogger, log } from "../../logging/index.js";
import type { ServiceLogger } from "../../logging/index.js";
import { getDomainEventPublisher } from "../../events/index.js";
import type { DomainEventPublisher } from "../../events/index.js";
import { EvmConfig } from "../../config/evm.js";
import {
    getPositionManagerAddress,
    UNISWAP_V3_POSITION_MANAGER_ABI,
    type UniswapV3PositionData,
} from "../../config/uniswapv3.js";
import {
    isValidAddress,
    normalizeAddress,
    compareAddresses,
} from "@midcurve/shared";
import { UniswapV3PoolService } from "../pool/uniswapv3-pool-service.js";
import type { PrismaTransactionClient } from "../../clients/prisma/index.js";
import { EtherscanClient } from "../../clients/etherscan/index.js";
import { UniswapV3PositionLedgerService } from "../position-ledger-deprecated/uniswapv3-position-ledger-service.js";
import { UniswapV3QuoteTokenService } from "../quote-token/uniswapv3-quote-token-service.js";
import { EvmBlockService } from "../block/evm-block-service.js";
import { PositionAprService } from "../position-apr/position-apr-service.js";
import { UniswapV3PoolPriceService } from "../pool-price/uniswapv3-pool-price-service.js";
import { UniswapV3LedgerEventService } from "../position-ledger/uniswapv3-ledger-event-service.js";
import type { Address } from "viem";
import { calculatePositionValue } from "@midcurve/shared";
import { tickToPrice } from "@midcurve/shared";
import { calculateUnclaimedFeeAmounts } from "@midcurve/shared";
import { uniswapV3PoolAbi } from "../../utils/uniswapv3/pool-abi.js";
import { calculateTokenValueInQuote } from "../../utils/uniswapv3/ledger-calculations.js";

/**
 * Fee state for a position
 *
 * Contains all fee-related fields that can be refreshed independently.
 */
export interface PositionFeeState {
    /** Fee growth inside the position's tick range for token0 */
    feeGrowthInside0LastX128: bigint;
    /** Fee growth inside the position's tick range for token1 */
    feeGrowthInside1LastX128: bigint;
    /** Checkpointed tokens owed for token0 (fees + uncollected principal) */
    tokensOwed0: bigint;
    /** Checkpointed tokens owed for token1 (fees + uncollected principal) */
    tokensOwed1: bigint;
    /** Unclaimed fees in token0 (set to tokensOwed0 in granular refresh) */
    unclaimedFees0: bigint;
    /** Unclaimed fees in token1 (set to tokensOwed1 in granular refresh) */
    unclaimedFees1: bigint;
    /** Fee growth outside lower tick for token0 (from pool.ticks(tickLower)) */
    tickLowerFeeGrowthOutside0X128: bigint;
    /** Fee growth outside lower tick for token1 (from pool.ticks(tickLower)) */
    tickLowerFeeGrowthOutside1X128: bigint;
    /** Fee growth outside upper tick for token0 (from pool.ticks(tickUpper)) */
    tickUpperFeeGrowthOutside0X128: bigint;
    /** Fee growth outside upper tick for token1 (from pool.ticks(tickUpper)) */
    tickUpperFeeGrowthOutside1X128: bigint;
}

/**
 * Database result interface for position queries.
 * Note: Prisma stores bigint as string in the database, so we use string here.
 * The mapToPosition method handles conversion to native bigint for PositionRow.
 */
export interface PositionDbResult {
    id: string;
    positionHash: string | null;
    createdAt: Date;
    updatedAt: Date;
    protocol: string;
    positionType: string;
    userId: string;
    currentValue: string; // Prisma returns bigint as string
    currentCostBasis: string;
    realizedPnl: string;
    unrealizedPnl: string;
    realizedCashflow: string;
    unrealizedCashflow: string;
    collectedFees: string;
    unClaimedFees: string;
    lastFeesCollectedAt: Date;
    totalApr: number | null;
    priceRangeLower: string;
    priceRangeUpper: string;
    poolId: string;
    isToken0Quote: boolean;
    pool: any; // Pool with token0, token1 from include
    positionOpenedAt: Date;
    positionClosedAt: Date | null;
    isActive: boolean;
    config: Record<string, unknown>;
    state: Record<string, unknown>;
}

/**
 * Dependencies for UniswapV3PositionService
 * All dependencies are optional and will use defaults if not provided
 */
export interface UniswapV3PositionServiceDependencies {
    /**
     * Prisma client for database operations
     * If not provided, a new PrismaClient instance will be created
     */
    prisma?: PrismaClient;

    /**
     * Domain event publisher for publishing position events
     * If not provided, uses the singleton instance
     */
    eventPublisher?: DomainEventPublisher;

    /**
     * EVM configuration for chain RPC access
     * If not provided, the singleton EvmConfig instance will be used
     */
    evmConfig?: EvmConfig;

    /**
     * UniswapV3 pool service for pool discovery
     * If not provided, a new UniswapV3PoolService instance will be created
     */
    poolService?: UniswapV3PoolService;

    /**
     * Etherscan client for fetching position events (needed for burned positions)
     * If not provided, the singleton EtherscanClient instance will be used
     */
    etherscanClient?: EtherscanClient;

    /**
     * Uniswap V3 position ledger service for fetching position history
     * If not provided, a new UniswapV3PositionLedgerService instance will be created
     */
    ledgerService?: import("../position-ledger-deprecated/uniswapv3-position-ledger-service.js").UniswapV3PositionLedgerService;

    /**
     * Uniswap V3 quote token service for automatic quote token determination
     * If not provided, a new UniswapV3QuoteTokenService instance will be created
     */
    quoteTokenService?: UniswapV3QuoteTokenService;

    /**
     * EVM block service for finalized block queries
     * If not provided, a new EvmBlockService instance will be created
     */
    evmBlockService?: EvmBlockService;

    /**
     * Position APR service for APR period calculation
     * If not provided, a new PositionAprService instance will be created
     */
    aprService?: PositionAprService;

    /**
     * Pool price service for historic price discovery at ledger event blocks
     * If not provided, a new UniswapV3PoolPriceService instance will be created
     */
    poolPriceService?: UniswapV3PoolPriceService;
}

/**
 * UniswapV3PositionService
 *
 * Provides position management for Uniswap V3 concentrated liquidity positions.
 * Implements serialization methods for Uniswap V3-specific config and state types.
 */
export class UniswapV3PositionService {
    protected readonly protocol: PositionProtocol = "uniswapv3";
    protected readonly _prisma: PrismaClient;
    protected readonly logger: ServiceLogger;
    protected readonly eventPublisher: DomainEventPublisher;
    private readonly _evmConfig: EvmConfig;
    private readonly _poolService: UniswapV3PoolService;
    private readonly _etherscanClient: EtherscanClient;
    private readonly _ledgerService: UniswapV3PositionLedgerService;
    private readonly _quoteTokenService: UniswapV3QuoteTokenService;
    private readonly _evmBlockService: EvmBlockService;
    private readonly _aprService: PositionAprService;
    private readonly _poolPriceService: UniswapV3PoolPriceService;

    /**
     * Creates a new UniswapV3PositionService instance
     *
     * @param dependencies - Optional dependencies object
     * @param dependencies.prisma - Prisma client instance (creates default if not provided)
     * @param dependencies.eventPublisher - Domain event publisher (uses singleton if not provided)
     * @param dependencies.evmConfig - EVM configuration instance (uses singleton if not provided)
     * @param dependencies.poolService - UniswapV3 pool service (creates default if not provided)
     * @param dependencies.etherscanClient - Etherscan client instance (uses singleton if not provided)
     * @param dependencies.ledgerService - UniswapV3 position ledger service (creates default if not provided)
     * @param dependencies.quoteTokenService - UniswapV3 quote token service (creates default if not provided)
     */
    constructor(dependencies: UniswapV3PositionServiceDependencies = {}) {
        // Initialize base class properties
        this._prisma = dependencies.prisma ?? new PrismaClient();
        this.logger = createServiceLogger(this.constructor.name);
        this.eventPublisher =
            dependencies.eventPublisher ?? getDomainEventPublisher();

        // Initialize UniswapV3-specific dependencies
        this._evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
        this._poolService =
            dependencies.poolService ??
            new UniswapV3PoolService({ prisma: this._prisma });
        this._etherscanClient =
            dependencies.etherscanClient ?? EtherscanClient.getInstance();
        this._ledgerService =
            dependencies.ledgerService ??
            new UniswapV3PositionLedgerService({
                prisma: this._prisma,
                positionService: this, // Pass self to break circular dependency
            });
        this._quoteTokenService =
            dependencies.quoteTokenService ??
            new UniswapV3QuoteTokenService({ prisma: this._prisma });
        this._evmBlockService =
            dependencies.evmBlockService ??
            new EvmBlockService({ evmConfig: this._evmConfig });
        this._aprService =
            dependencies.aprService ??
            new PositionAprService({ prisma: this._prisma });
        this._poolPriceService =
            dependencies.poolPriceService ??
            new UniswapV3PoolPriceService({ prisma: this._prisma });
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
     * Get the UniswapV3 pool service instance
     */
    protected get poolService(): UniswapV3PoolService {
        return this._poolService;
    }

    /**
     * Get the Etherscan client instance
     */
    protected get etherscanClient(): EtherscanClient {
        return this._etherscanClient;
    }

    /**
     * Get the position ledger service instance
     */
    protected get ledgerService(): UniswapV3PositionLedgerService {
        return this._ledgerService;
    }

    /**
     * Get the quote token service instance
     */
    protected get quoteTokenService(): UniswapV3QuoteTokenService {
        return this._quoteTokenService;
    }

    /**
     * Get the EVM block service instance
     */
    protected get evmBlockService(): EvmBlockService {
        return this._evmBlockService;
    }

    /**
     * Get the APR service instance
     */
    protected get aprService(): PositionAprService {
        return this._aprService;
    }

    /**
     * Get the pool price service instance
     */
    protected get poolPriceService(): UniswapV3PoolPriceService {
        return this._poolPriceService;
    }

    // ============================================================================
    // ABSTRACT METHOD IMPLEMENTATIONS - SERIALIZATION
    // ============================================================================

    /**
     * Parse config from database JSON to application type
     *
     * For Uniswap V3, config contains only primitive types (no bigint),
     * so this is essentially a pass-through with type casting.
     *
     * @param configDB - Config object from database (JSON)
     * @returns Parsed Uniswap V3 config
     */
    parseConfig(configDB: unknown): UniswapV3PositionConfigData {
        const db = configDB as {
            chainId: number | string;
            nftId: number | string;
            poolAddress: string;
            tickUpper: number | string;
            tickLower: number | string;
        };

        // Defensive type conversion for JSON deserialization
        // PostgreSQL JSON columns may return numbers as strings
        const chainId =
            typeof db.chainId === "number" ? db.chainId : Number(db.chainId);
        const nftId =
            typeof db.nftId === "number" ? db.nftId : Number(db.nftId);
        const tickUpper =
            typeof db.tickUpper === "number"
                ? db.tickUpper
                : Number(db.tickUpper);
        const tickLower =
            typeof db.tickLower === "number"
                ? db.tickLower
                : Number(db.tickLower);

        return {
            chainId,
            nftId,
            poolAddress: db.poolAddress,
            tickUpper,
            tickLower,
        };
    }

    /**
     * Serialize config from application type to database JSON
     *
     * For Uniswap V3, config contains only primitive types (no bigint),
     * so this is essentially a pass-through.
     *
     * @param config - Application config
     * @returns Serialized config for database storage (JSON-serializable)
     */
    serializeConfig(config: UniswapV3PositionConfigData): unknown {
        return {
            chainId: config.chainId,
            nftId: config.nftId,
            poolAddress: config.poolAddress,
            tickUpper: config.tickUpper,
            tickLower: config.tickLower,
        };
    }

    /**
     * Parse state from database JSON to application type
     *
     * Converts string values to bigint for Uniswap V3 state fields
     * (liquidity, feeGrowth values, tokensOwed).
     *
     * @param stateDB - State object from database (JSON with string values)
     * @returns Parsed Uniswap V3 state with bigint values
     */
    parseState(stateDB: unknown): UniswapV3PositionState {
        const db = stateDB as {
            ownerAddress: string;
            liquidity: string;
            feeGrowthInside0LastX128: string;
            feeGrowthInside1LastX128: string;
            tokensOwed0: string;
            tokensOwed1: string;
            unclaimedFees0?: string;
            unclaimedFees1?: string;
            tickLowerFeeGrowthOutside0X128?: string;
            tickLowerFeeGrowthOutside1X128?: string;
            tickUpperFeeGrowthOutside0X128?: string;
            tickUpperFeeGrowthOutside1X128?: string;
        };

        return {
            ownerAddress: db.ownerAddress,
            liquidity: BigInt(db.liquidity),
            feeGrowthInside0LastX128: BigInt(db.feeGrowthInside0LastX128),
            feeGrowthInside1LastX128: BigInt(db.feeGrowthInside1LastX128),
            tokensOwed0: BigInt(db.tokensOwed0),
            tokensOwed1: BigInt(db.tokensOwed1),
            unclaimedFees0: BigInt(db.unclaimedFees0 ?? "0"),
            unclaimedFees1: BigInt(db.unclaimedFees1 ?? "0"),
            tickLowerFeeGrowthOutside0X128: BigInt(
                db.tickLowerFeeGrowthOutside0X128 ?? "0",
            ),
            tickLowerFeeGrowthOutside1X128: BigInt(
                db.tickLowerFeeGrowthOutside1X128 ?? "0",
            ),
            tickUpperFeeGrowthOutside0X128: BigInt(
                db.tickUpperFeeGrowthOutside0X128 ?? "0",
            ),
            tickUpperFeeGrowthOutside1X128: BigInt(
                db.tickUpperFeeGrowthOutside1X128 ?? "0",
            ),
        };
    }

    /**
     * Serialize state from application type to database JSON
     *
     * Converts bigint values to strings for database storage.
     *
     * @param state - Application state with bigint values
     * @returns Serialized state with string values (JSON-serializable)
     */
    serializeState(state: UniswapV3PositionState): unknown {
        return {
            ownerAddress: state.ownerAddress,
            liquidity: state.liquidity.toString(),
            feeGrowthInside0LastX128: state.feeGrowthInside0LastX128.toString(),
            feeGrowthInside1LastX128: state.feeGrowthInside1LastX128.toString(),
            tokensOwed0: state.tokensOwed0.toString(),
            tokensOwed1: state.tokensOwed1.toString(),
            unclaimedFees0: state.unclaimedFees0?.toString() ?? "0",
            unclaimedFees1: state.unclaimedFees1?.toString() ?? "0",
            tickLowerFeeGrowthOutside0X128:
                state.tickLowerFeeGrowthOutside0X128?.toString() ?? "0",
            tickLowerFeeGrowthOutside1X128:
                state.tickLowerFeeGrowthOutside1X128?.toString() ?? "0",
            tickUpperFeeGrowthOutside0X128:
                state.tickUpperFeeGrowthOutside0X128?.toString() ?? "0",
            tickUpperFeeGrowthOutside1X128:
                state.tickUpperFeeGrowthOutside1X128?.toString() ?? "0",
        };
    }

    /**
     * Create position hash from raw parameters
     *
     * Validates input parameters and creates a composite hash key.
     * Follows the same pattern as UniswapV3PoolService.createHash().
     *
     * @param params - Parameters containing chainId and nftId
     * @returns Position hash string in format "uniswapv3/{chainId}/{nftId}"
     * @throws Error if chainId is missing or not a number
     * @throws Error if nftId is missing or not a number
     */
    createHash(params: { chainId: number; nftId: number }): string {
        const { chainId, nftId } = params;

        // Validate chainId
        if (chainId === undefined || chainId === null) {
            throw new Error("chainId is required for position hash creation");
        }
        if (typeof chainId !== "number") {
            throw new Error(`chainId must be a number, got ${typeof chainId}`);
        }

        // Validate nftId
        if (nftId === undefined || nftId === null) {
            throw new Error("nftId is required for position hash creation");
        }
        if (typeof nftId !== "number") {
            throw new Error(`nftId must be a number, got ${typeof nftId}`);
        }

        return `${this.protocol}/${chainId}/${nftId}`;
    }

    /**
     * Create position hash from a position object
     *
     * Extracts chainId and nftId from the position's typed config and
     * creates a composite hash key. Follows the same pattern as
     * UniswapV3PoolService.createHashFromPool().
     *
     * @param position - UniswapV3Position object
     * @returns Position hash string in format "uniswapv3/{chainId}/{nftId}"
     * @throws Error if position protocol doesn't match this service's protocol
     */
    createHashFromPosition(position: UniswapV3Position): string {
        if (position.protocol !== this.protocol) {
            throw new Error(
                `Protocol mismatch: expected ${this.protocol}, got ${position.protocol}`,
            );
        }
        const { chainId, nftId } = position.typedConfig;
        return this.createHash({ chainId, nftId });
    }

    // ============================================================================
    // ABSTRACT METHOD IMPLEMENTATIONS - DISCOVERY
    // ============================================================================

    /**
     * Discover and create a Uniswap V3 position from on-chain NFT data
     *
     * Checks the database first for an existing position. If not found:
     * 1. Reads position data from NonfungiblePositionManager contract (pool, ticks, liquidity)
     * 2. Discovers/fetches the pool via UniswapV3PoolService
     * 3. Determines which token is base and which is quote by comparing quoteTokenAddress
     *    with the pool's token0 and token1 addresses (sets token0IsQuote in config)
     * 4. Reads current position state from NFT contract (owner, liquidity, fees)
     * 5. Calculates initial PnL and price range values
     * 6. Saves position to database
     * 7. Returns Position
     *
     * Discovery is idempotent - calling multiple times with the same userId/chainId/nftId
     * returns the existing position.
     *
     * Note: Position state can be refreshed later using the refresh() method to get
     * the latest on-chain values.
     *
     * @param userId - User ID who owns this position (database foreign key to User.id)
     * @param params - Discovery parameters { chainId, nftId, quoteTokenAddress? }
     * @returns The discovered or existing position
     * @throws Error if chainId is not supported
     * @throws Error if quoteTokenAddress format is invalid (when provided)
     * @throws Error if NFT doesn't exist or isn't a Uniswap V3 position
     * @throws Error if quoteTokenAddress doesn't match either pool token (when provided)
     * @throws Error if on-chain read fails
     */
    async discover(
        userId: string,
        params: UniswapV3PositionDiscoverInput,
    ): Promise<UniswapV3Position> {
        const { chainId, nftId, quoteTokenAddress } = params;
        log.methodEntry(this.logger, "discover", {
            userId,
            chainId,
            nftId,
            quoteTokenAddress: quoteTokenAddress ?? "auto-detect",
        });

        try {
            // 1. Check database first using positionHash (fast indexed lookup)
            const positionHash = this.createHash({ chainId, nftId });

            const existing = await this.findByPositionHash(
                userId,
                positionHash,
            );

            if (existing) {
                this.logger.info(
                    {
                        id: existing.id,
                        userId,
                        chainId,
                        nftId,
                        positionHash,
                    },
                    "Position already exists (found via positionHash), refreshing state from on-chain",
                );

                // Refresh position state to get current on-chain values
                const refreshed = await this.refresh(existing.id);

                log.methodExit(this.logger, "discover", {
                    id: refreshed.id,
                    fromDatabase: true,
                    refreshed: true,
                });
                return refreshed;
            }

            // 2. Validate quoteTokenAddress IF PROVIDED
            let normalizedQuoteAddress: string | undefined;
            if (quoteTokenAddress) {
                if (!isValidAddress(quoteTokenAddress)) {
                    const error = new Error(
                        `Invalid quote token address format: ${quoteTokenAddress}`,
                    );
                    log.methodError(this.logger, "discover", error, {
                        userId,
                        chainId,
                        nftId,
                        quoteTokenAddress,
                    });
                    throw error;
                }

                normalizedQuoteAddress = normalizeAddress(quoteTokenAddress);
                this.logger.debug(
                    {
                        original: quoteTokenAddress,
                        normalized: normalizedQuoteAddress,
                    },
                    "Quote token address provided by caller",
                );
            } else {
                this.logger.debug(
                    "No quote token provided, will auto-detect using QuoteTokenService",
                );
            }

            // 3. Verify chain is supported
            if (!this.evmConfig.isChainSupported(chainId)) {
                const error = new Error(
                    `Chain ${chainId} is not configured. Supported chains: ${this.evmConfig
                        .getSupportedChainIds()
                        .join(", ")}`,
                );
                log.methodError(this.logger, "discover", error, { chainId });
                throw error;
            }

            this.logger.debug(
                { chainId },
                "Chain is supported, proceeding with on-chain discovery",
            );

            // 4. For burned/closed positions, fetch latest event from Etherscan first
            // This gives us a block number when the position still existed
            this.logger.debug(
                { chainId, nftId },
                "Fetching position events from Etherscan to determine if position is burned",
            );

            let blockNumber: bigint | undefined;
            let positionOpenedAt: Date | undefined;
            try {
                const events = await this.etherscanClient.fetchPositionEvents(
                    chainId,
                    nftId.toString(),
                );

                if (events.length > 0) {
                    // Get the first event's block number (position creation)
                    // Events are sorted chronologically, so events[0] is the earliest
                    const firstEvent = events[0]!;
                    blockNumber = BigInt(firstEvent.blockNumber); // Block at or after creation

                    // Extract timestamp from first event for accurate position age
                    positionOpenedAt = firstEvent.blockTimestamp;

                    this.logger.debug(
                        {
                            firstEventBlock: firstEvent.blockNumber,
                            firstEventTime: positionOpenedAt.toISOString(),
                            queryBlock: blockNumber.toString(),
                            eventType: firstEvent.eventType,
                        },
                        "Found events - will query position state at block when position was created",
                    );
                }
            } catch (error) {
                this.logger.warn(
                    { error, chainId, nftId },
                    "Failed to fetch events from Etherscan, will attempt current block query",
                );
            }

            // 5. Read position data from NonfungiblePositionManager
            const positionManagerAddress = getPositionManagerAddress(chainId);
            const client = this.evmConfig.getPublicClient(chainId);

            this.logger.debug(
                {
                    positionManagerAddress,
                    nftId,
                    chainId,
                    blockNumber: blockNumber?.toString() ?? "latest",
                },
                "Reading position data from NonfungiblePositionManager",
            );

            const [positionData, ownerAddress] = await Promise.all([
                client.readContract({
                    address: positionManagerAddress,
                    abi: UNISWAP_V3_POSITION_MANAGER_ABI,
                    functionName: "positions",
                    args: [BigInt(nftId)],
                    blockNumber,
                }) as Promise<
                    readonly [
                        bigint,
                        Address,
                        Address,
                        Address,
                        number,
                        number,
                        number,
                        bigint,
                        bigint,
                        bigint,
                        bigint,
                        bigint,
                    ]
                >,
                client.readContract({
                    address: positionManagerAddress,
                    abi: UNISWAP_V3_POSITION_MANAGER_ABI,
                    functionName: "ownerOf",
                    args: [BigInt(nftId)],
                    blockNumber,
                }) as Promise<Address>,
            ]);

            // Parse position data
            const position: UniswapV3PositionData = {
                nonce: positionData[0],
                operator: positionData[1],
                token0: positionData[2],
                token1: positionData[3],
                fee: positionData[4],
                tickLower: positionData[5],
                tickUpper: positionData[6],
                liquidity: positionData[7],
                feeGrowthInside0LastX128: positionData[8],
                feeGrowthInside1LastX128: positionData[9],
                tokensOwed0: positionData[10],
                tokensOwed1: positionData[11],
            };

            this.logger.debug(
                {
                    token0: position.token0,
                    token1: position.token1,
                    fee: position.fee,
                    tickLower: position.tickLower,
                    tickUpper: position.tickUpper,
                    liquidity: position.liquidity.toString(),
                    owner: ownerAddress,
                },
                "Position data read from contract",
            );

            // 5. Discover pool by tokens and fee via UniswapV3PoolService
            // This queries the factory for the pool address and discovers/fetches the pool
            const pool = await this.poolService.discoverByTokensAndFee(
                chainId,
                position.token0,
                position.token1,
                position.fee,
            );

            this.logger.debug(
                {
                    poolId: pool.id,
                    poolAddress: pool.address,
                    token0: pool.token0.symbol,
                    token1: pool.token1.symbol,
                },
                "Pool discovered/fetched",
            );

            // 7. Determine quote token
            let isToken0Quote: boolean;

            if (normalizedQuoteAddress) {
                // EXPLICIT MODE: User provided quoteTokenAddress
                const token0Matches =
                    compareAddresses(
                        pool.token0.address,
                        normalizedQuoteAddress,
                    ) === 0;
                const token1Matches =
                    compareAddresses(
                        pool.token1.address,
                        normalizedQuoteAddress,
                    ) === 0;

                if (!token0Matches && !token1Matches) {
                    const error = new Error(
                        `Quote token address ${normalizedQuoteAddress} does not match either pool token. ` +
                            `Pool token0: ${pool.token0.address}, token1: ${pool.token1.address}`,
                    );
                    log.methodError(this.logger, "discover", error, {
                        userId,
                        chainId,
                        nftId,
                        quoteTokenAddress: normalizedQuoteAddress,
                        poolToken0: pool.token0.address,
                        poolToken1: pool.token1.address,
                    });
                    throw error;
                }

                isToken0Quote = token0Matches;

                this.logger.debug(
                    {
                        isToken0Quote,
                        quoteToken: isToken0Quote
                            ? pool.token0.symbol
                            : pool.token1.symbol,
                    },
                    "Quote token determined from caller input",
                );
            } else {
                // AUTO-DETECT MODE: Use QuoteTokenService
                this.logger.debug(
                    "Auto-detecting quote token using QuoteTokenService",
                );

                const quoteResult =
                    await this.quoteTokenService.determineQuoteToken({
                        userId,
                        chainId,
                        token0Address: pool.token0.address,
                        token1Address: pool.token1.address,
                    });

                isToken0Quote = quoteResult.isToken0Quote;

                this.logger.debug(
                    {
                        isToken0Quote,
                        quoteToken: isToken0Quote
                            ? pool.token0.symbol
                            : pool.token1.symbol,
                        matchedBy: quoteResult.matchedBy,
                    },
                    "Quote token auto-detected",
                );
            }

            const baseToken = isToken0Quote ? pool.token1 : pool.token0;
            const quoteToken = isToken0Quote ? pool.token0 : pool.token1;

            this.logger.debug(
                {
                    isToken0Quote,
                    baseToken: baseToken.symbol,
                    quoteToken: quoteToken.symbol,
                },
                "Token roles determined",
            );

            // 8. Create position config (without token0IsQuote, now at position level)
            const config: UniswapV3PositionConfigData = {
                chainId,
                nftId,
                poolAddress: pool.address,
                tickUpper: position.tickUpper,
                tickLower: position.tickLower,
            };

            // 9. Create position state from on-chain data
            const state: UniswapV3PositionState = {
                ownerAddress: normalizeAddress(ownerAddress),
                liquidity: position.liquidity,
                feeGrowthInside0LastX128: position.feeGrowthInside0LastX128,
                feeGrowthInside1LastX128: position.feeGrowthInside1LastX128,
                tokensOwed0: position.tokensOwed0,
                tokensOwed1: position.tokensOwed1,
                unclaimedFees0: 0n, // Will be calculated after position creation
                unclaimedFees1: 0n,
                tickLowerFeeGrowthOutside0X128: 0n, // Will be fetched on fee refresh
                tickLowerFeeGrowthOutside1X128: 0n,
                tickUpperFeeGrowthOutside0X128: 0n,
                tickUpperFeeGrowthOutside1X128: 0n,
            };

            this.logger.debug(
                {
                    ownerAddress: state.ownerAddress,
                    liquidity: state.liquidity.toString(),
                    tokensOwed0: state.tokensOwed0.toString(),
                    tokensOwed1: state.tokensOwed1.toString(),
                },
                "Position state initialized from on-chain data",
            );

            // 10. Create position via create() method
            const configDB = this.serializeConfig(config) as Record<
                string,
                unknown
            >;
            const stateDB = this.serializeState(state) as Record<
                string,
                unknown
            >;
            const createdPosition = await this.create(
                {
                    protocol: "uniswapv3",
                    positionType: "CL_TICKS",
                    userId,
                    poolId: pool.id,
                    isToken0Quote, // Boolean flag for token roles
                    config,
                    state,
                    positionOpenedAt, // Blockchain timestamp from first event (if available)
                },
                configDB,
                stateDB,
            );

            this.logger.info(
                {
                    id: createdPosition.id,
                    userId,
                    chainId,
                    nftId,
                    poolId: pool.id,
                    baseToken: baseToken.symbol,
                    quoteToken: quoteToken.symbol,
                },
                "Position discovered and created",
            );

            // 11. Discover ledger events from blockchain
            try {
                this.logger.info(
                    { positionId: createdPosition.id },
                    "Discovering ledger events from blockchain",
                );

                // Full sync from NFPM deployment block (new position)
                const syncResult = await syncLedgerEvents(
                    {
                        positionId: createdPosition.id,
                        chainId: createdPosition.chainId,
                        nftId: BigInt(createdPosition.nftId),
                        forceFullResync: true, // New position - full sync
                    },
                    {
                        prisma: this.prisma,
                        etherscanClient: this.etherscanClient,
                        evmBlockService: this.evmBlockService,
                        aprService: this.aprService,
                        logger: this.logger,
                        ledgerService: this.ledgerService,
                        poolPriceService: this.poolPriceService,
                    },
                );

                this.logger.info(
                    {
                        positionId: createdPosition.id,
                        eventsAdded: syncResult.eventsAdded,
                        fromBlock: syncResult.fromBlock.toString(),
                        finalizedBlock: syncResult.finalizedBlock.toString(),
                    },
                    "Ledger events discovered successfully",
                );

                // Update position state from the last ledger event
                // The sync creates ledger events but doesn't update position state
                // We need to apply the final state changes (liquidity, checkpoints) from the last event
                if (syncResult.eventsAdded > 0) {
                    // Get most recent event using ledger service helper
                    // This ensures correct event ordering (DESC by timestamp)
                    const mostRecentEvent =
                        await this.ledgerService.getMostRecentEvent(
                            createdPosition.id,
                        );

                    if (mostRecentEvent) {
                        const eventConfig = mostRecentEvent.config as {
                            liquidityAfter?: string | bigint;
                            feeGrowthInside0LastX128?: string | bigint;
                            feeGrowthInside1LastX128?: string | bigint;
                        };

                        // Read current position state
                        const currentPosition = await this.findById(
                            createdPosition.id,
                        );
                        if (!currentPosition) {
                            throw new Error(
                                `Position ${createdPosition.id} not found after sync`,
                            );
                        }

                        // Update liquidity from most recent event
                        const finalLiquidity =
                            typeof eventConfig.liquidityAfter === "string"
                                ? BigInt(eventConfig.liquidityAfter)
                                : eventConfig.liquidityAfter;

                        if (finalLiquidity !== undefined) {
                            // Build updated state (state is read-only, so create new object)
                            const currentState = currentPosition.typedState;
                            const updatedState: UniswapV3PositionState = {
                                ...currentState,
                                liquidity: finalLiquidity,
                            };

                            // Update position state in database
                            const stateDB = this.serializeState(updatedState);
                            await this.prisma.position.update({
                                where: { id: createdPosition.id },
                                data: { state: stateDB as object },
                            });
                        } else {
                            this.logger.warn(
                                {
                                    positionId: createdPosition.id,
                                    eventType: mostRecentEvent.eventType,
                                },
                                "Most recent event has no liquidityAfter - skipping update",
                            );
                        }
                    }
                }
            } catch (error) {
                this.logger.warn(
                    { error, positionId: createdPosition.id },
                    "Failed to discover ledger events, position will have zero PnL",
                );
                // Continue - position exists but PnL will be stale
            }

            // 12. Calculate and update common fields
            try {
                this.logger.debug(
                    { positionId: createdPosition.id },
                    "Calculating position common fields",
                );

                // Get ledger summary (now has real data from events discovered above)
                const ledgerSummary = await this.getLedgerSummary(
                    createdPosition.id,
                );

                // Calculate current position value
                const currentValue = this.calculateCurrentPositionValue(
                    createdPosition,
                    pool,
                );

                // Calculate unrealized PnL
                const unrealizedPnl = currentValue - ledgerSummary.costBasis;

                // Calculate unclaimed fees (total value in quote token)
                const unClaimedFees = this.calculateUnclaimedFees(
                    createdPosition,
                    pool,
                );

                // Calculate price range
                const { priceRangeLower, priceRangeUpper } =
                    this.calculatePriceRange(createdPosition, pool);

                // Update position with calculated fields
                await this.updatePositionCommonFields(
                    createdPosition.id,
                    {
                        currentValue,
                        currentCostBasis: ledgerSummary.costBasis,
                        realizedPnl: ledgerSummary.realizedPnl,
                        unrealizedPnl,
                        collectedFees: ledgerSummary.collectedFees,
                        unClaimedFees,
                        lastFeesCollectedAt:
                            ledgerSummary.lastFeesCollectedAt.getTime() === 0
                                ? createdPosition.positionOpenedAt
                                : ledgerSummary.lastFeesCollectedAt,
                        priceRangeLower,
                        priceRangeUpper,
                    },
                    createdPosition.positionOpenedAt,
                );

                this.logger.info(
                    {
                        positionId: createdPosition.id,
                        currentValue: currentValue.toString(),
                        costBasis: ledgerSummary.costBasis.toString(),
                        unrealizedPnl: unrealizedPnl.toString(),
                    },
                    "Position common fields calculated and updated",
                );
            } catch (error) {
                // Clean up orphaned position before re-throwing
                this.logger.error(
                    {
                        error,
                        positionId: createdPosition.id,
                    },
                    "Failed to calculate/update common fields, deleting orphaned position",
                );
                await this.delete(createdPosition.id);
                throw error;
            }

            log.methodExit(this.logger, "discover", {
                id: createdPosition.id,
                fromDatabase: false,
            });

            // Re-fetch position with updated fields
            const finalPosition = await this.findById(createdPosition.id);
            return finalPosition ?? createdPosition;
        } catch (error) {
            // Only log if not already logged
            if (
                !(
                    error instanceof Error &&
                    (error.message.includes("Invalid") ||
                        error.message.includes("Chain") ||
                        error.message.includes("Quote token"))
                )
            ) {
                log.methodError(this.logger, "discover", error as Error, {
                    userId,
                    chainId,
                    nftId,
                    quoteTokenAddress,
                });
            }
            throw error;
        }
    }

    // ============================================================================
    // ABSTRACT METHOD IMPLEMENTATION - REFRESH
    // ============================================================================

    /**
     * Refresh position state from ledger and on-chain data
     *
     * Updates position state by combining data from multiple sources:
     * - **Liquidity**: From ledger events (source of truth for liquidity changes)
     * - **Fees & Owner**: From on-chain NFT contract (only for positions with L > 0)
     * - **Position Status**: Detects and marks fully closed positions
     *
     * For closed positions (liquidity = 0):
     * - Skips on-chain call entirely (no fees to track for L=0)
     * - Uses last known fee growth values with tokensOwed set to 0
     * - Prevents "Invalid token ID" errors for burned NFTs
     * - Checks if position is fully closed (final COLLECT with all principal withdrawn)
     * - If fully closed: Sets isActive=false and positionClosedAt to timestamp of final COLLECT event
     *
     * For active positions (liquidity > 0):
     * - Fetches current fee data from NonfungiblePositionManager
     * - Updates feeGrowthInside0/1LastX128, tokensOwed0/1, and ownerAddress
     *
     * Close Detection:
     * - Position is marked as closed only when ALL conditions are met:
     *   1. Liquidity = 0 (all liquidity removed)
     *   2. Last ledger event is COLLECT (tokens withdrawn)
     *   3. All principal collected (uncollectedPrincipal0After = 0 && uncollectedPrincipal1After = 0)
     * - This prevents false positives where L=0 after DECREASE but awaiting final COLLECT
     *
     * Updates (state fields):
     * - liquidity (from ledger events)
     * - feeGrowthInside0/1LastX128 (from on-chain, only if L > 0)
     * - tokensOwed0/1 (from on-chain, only if L > 0)
     * - ownerAddress (from on-chain, only if L > 0)
     *
     * Updates (common fields via refreshMetrics):
     * - currentValue (from pool price + position amounts)
     * - currentCostBasis (from ledger events)
     * - realizedPnl (from ledger events)
     * - unrealizedPnl (currentValue - costBasis)
     * - collectedFees (from ledger events)
     * - unClaimedFees (from on-chain state, converted to quote)
     * - lastFeesCollectedAt (from most recent COLLECT event)
     * - priceRangeLower/Upper (from tick bounds)
     * - Pool state (sqrtPriceX96, currentTick, etc.)
     *
     * Note: Config fields (chainId, nftId, ticks, poolAddress) are immutable and not updated.
     * Note: totalApr, isActive, and positionClosedAt are NOT updated by this method.
     *
     * @param id - Position ID
     * @param dbTx - Optional Prisma transaction client for atomic operations
     * @returns Updated position with fresh state
     * @throws Error if position not found
     * @throws Error if position is not uniswapv3 protocol
     * @throws Error if chain is not supported
     * @throws Error if on-chain read fails (only for L > 0 positions)
     */
    async refresh(
        id: string,
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3Position> {
        log.methodEntry(this.logger, "refresh", { id });

        try {
            // Refresh all position state by calling individual refresh methods in order
            // Each method reads fresh on-chain data and persists it to the database

            // 0. Get position to determine pool ID
            const position = await this.findById(id);
            if (!position) {
                throw new Error(`Position not found: ${id}`);
            }

            // 1. Refresh pool state first (needed for fee calculations and metrics)
            await this.poolService.refresh(position.pool.id, dbTx);

            // 2. Refresh owner address (may have been transferred)
            await this.refreshOwnerAddress(id, dbTx);

            // 3. Refresh liquidity
            await this.refreshLiquidity(id, dbTx);

            // 4. Refresh fee state (tokensOwed, feeGrowthInside, unclaimed fees)
            await this.refreshFeeState(id, dbTx);

            // 5. Refresh metrics (common fields: value, PnL, fees, price range)
            await this.refreshMetrics(id, dbTx);

            // 5. Return the fully refreshed position
            const refreshedPosition = await this.findById(id);
            if (!refreshedPosition) {
                const error = new Error(
                    `Position not found after refresh: ${id}`,
                );
                log.methodError(this.logger, "refresh", error, { id });
                throw error;
            }

            log.methodExit(this.logger, "refresh", { id });
            return refreshedPosition;
        } catch (error) {
            // Only log if not already logged
            if (
                !(
                    error instanceof Error &&
                    (error.message.includes("not found") ||
                        error.message.includes("Chain"))
                )
            ) {
                log.methodError(this.logger, "refresh", error as Error, { id });
            }
            throw error;
        }
    }

    /**
     * Reset position by rediscovering all ledger events from blockchain
     *
     * Completely rebuilds the position's ledger history by:
     * 1. Deleting all existing ledger events and APR periods
     * 2. Rediscovering all events from Etherscan
     * 3. Recalculating APR periods from fresh events
     * 4. Refreshing position state from NFT contract
     * 5. Recalculating PnL fields based on fresh ledger data
     *
     * Process:
     * 1. Verify position exists
     * 2. Delete all ledger events (cascades to APR periods)
     * 3. Rediscover events from blockchain via ledgerService.discoverAllEvents()
     * 4. Call refresh() to update position state and PnL
     * 5. Return fully rebuilt position
     *
     * @param id - Position ID
     * @returns Position with completely rebuilt ledger and refreshed state
     * @throws Error if position not found
     * @throws Error if position is not uniswapv3 protocol
     * @throws Error if chain is not supported
     * @throws Error if Etherscan fetch fails
     */
    async reset(id: string): Promise<UniswapV3Position> {
        log.methodEntry(this.logger, "reset", { id });

        try {
            // 1. Verify position exists and get its config
            const existingPosition = await this.findById(id);

            if (!existingPosition) {
                const error = new Error(`Position not found: ${id}`);
                log.methodError(this.logger, "reset", error, { id });
                throw error;
            }

            this.logger.info(
                {
                    positionId: id,
                    chainId: existingPosition.config.chainId,
                    nftId: existingPosition.config.nftId,
                },
                "Starting position reset - rediscovering ledger events from blockchain",
            );

            // 2. Rediscover all ledger events from blockchain
            // This automatically:
            // - Deletes events >= fromBlock (via syncLedgerEvents)
            // - Fetches fresh events from Etherscan
            // - Calculates PnL sequentially
            // - Triggers APR period calculation
            this.logger.info(
                { positionId: id },
                "Deleting old events and rediscovering from blockchain",
            );

            const syncResult = await syncLedgerEvents(
                {
                    positionId: id,
                    chainId: existingPosition.chainId,
                    nftId: BigInt(existingPosition.nftId),
                    forceFullResync: true, // Full reset - resync from NFPM deployment
                },
                {
                    prisma: this.prisma,
                    etherscanClient: this.etherscanClient,
                    evmBlockService: this.evmBlockService,
                    aprService: this.aprService,
                    logger: this.logger,
                    ledgerService: this.ledgerService,
                    poolPriceService: this.poolPriceService,
                },
            );

            this.logger.info(
                {
                    positionId: id,
                    eventsAdded: syncResult.eventsAdded,
                    fromBlock: syncResult.fromBlock.toString(),
                    finalizedBlock: syncResult.finalizedBlock.toString(),
                },
                "Ledger events rediscovered and APR periods recalculated",
            );

            // 3. Refresh position state from on-chain data
            // This updates:
            // - Position state (liquidity, fees, owner)
            // - Current value
            // - Unrealized PnL (using fresh cost basis from ledger)
            // - Unclaimed fees
            this.logger.info(
                { positionId: id },
                "Refreshing position state from on-chain data",
            );

            const refreshedPosition = await this.refresh(id);

            this.logger.info(
                {
                    positionId: id,
                    currentValue: refreshedPosition.currentValue.toString(),
                    costBasis: refreshedPosition.currentCostBasis.toString(),
                    realizedPnl: refreshedPosition.realizedPnl.toString(),
                    unrealizedPnl: refreshedPosition.unrealizedPnl.toString(),
                },
                "Position reset complete - ledger rebuilt and state refreshed",
            );

            log.methodExit(this.logger, "reset", { id });
            return refreshedPosition;
        } catch (error) {
            // Only log if not already logged
            if (
                !(
                    error instanceof Error &&
                    (error.message.includes("not found") ||
                        error.message.includes("Chain"))
                )
            ) {
                log.methodError(this.logger, "reset", error as Error, { id });
            }
            throw error;
        }
    }

    // ============================================================================
    // GRANULAR STATE SETTERS
    // ============================================================================

    /**
     * Set position owner address
     *
     * Manually updates the owner address in position state without making RPC calls.
     * Use this when you have the owner address from another source (e.g., event logs).
     *
     * @param id - Position database ID
     * @param ownerAddress - New owner address
     * @returns Updated position
     */
    async updateOwnerAddress(
        id: string,
        ownerAddress: string,
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3Position> {
        log.methodEntry(this.logger, "updateOwnerAddress", {
            id,
            ownerAddress,
        });

        const db = tx ?? this.prisma;

        try {
            // 1. Get existing position
            const existing = await this.findById(id);
            if (!existing) {
                throw new Error(`Position not found: ${id}`);
            }

            // 2. Parse current state and update owner address
            const currentState = this.parseState(existing.state);
            const updatedState: UniswapV3PositionState = {
                ...currentState,
                ownerAddress: normalizeAddress(ownerAddress),
            };

            // 3. Serialize and persist
            const stateDB = this.serializeState(updatedState);

            log.dbOperation(this.logger, "update", "Position", {
                id,
                fields: ["state.ownerAddress"],
            });

            const result = await db.position.update({
                where: { id },
                data: { state: stateDB as object },
                include: {
                    pool: {
                        include: { token0: true, token1: true },
                    },
                },
            });

            const position = this.mapToPosition(
                result as PositionDbResult,
            ) as UniswapV3Position;

            this.logger.debug(
                { id, ownerAddress },
                "Position owner address updated",
            );
            log.methodExit(this.logger, "updateOwnerAddress", { id });
            return position;
        } catch (error) {
            if (
                !(error instanceof Error && error.message.includes("not found"))
            ) {
                log.methodError(
                    this.logger,
                    "updateOwnerAddress",
                    error as Error,
                    { id },
                );
            }
            throw error;
        }
    }

    /**
     * Set position liquidity
     *
     * Manually updates the liquidity in position state without making RPC calls.
     * Use this when you have the liquidity from another source (e.g., ledger events).
     *
     * @param id - Position database ID
     * @param liquidity - New liquidity value
     * @returns Updated position
     */
    async updateLiquidity(
        id: string,
        liquidity: bigint,
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3Position> {
        log.methodEntry(this.logger, "updateLiquidity", {
            id,
            liquidity: liquidity.toString(),
        });

        const db = tx ?? this.prisma;

        try {
            // 1. Get existing position
            const existing = await this.findById(id);
            if (!existing) {
                throw new Error(`Position not found: ${id}`);
            }

            // 2. Parse current state and update liquidity
            const currentState = this.parseState(existing.state);
            const updatedState: UniswapV3PositionState = {
                ...currentState,
                liquidity,
            };

            // 3. Serialize and persist
            const stateDB = this.serializeState(updatedState);

            log.dbOperation(this.logger, "update", "Position", {
                id,
                fields: ["state.liquidity"],
            });

            const result = await db.position.update({
                where: { id },
                data: { state: stateDB as object },
                include: {
                    pool: {
                        include: { token0: true, token1: true },
                    },
                },
            });

            const position = this.mapToPosition(
                result as PositionDbResult,
            ) as UniswapV3Position;

            this.logger.debug(
                { id, liquidity: liquidity.toString() },
                "Position liquidity updated",
            );
            log.methodExit(this.logger, "updateLiquidity", { id });
            return position;
        } catch (error) {
            if (
                !(error instanceof Error && error.message.includes("not found"))
            ) {
                log.methodError(
                    this.logger,
                    "updateLiquidity",
                    error as Error,
                    { id },
                );
            }
            throw error;
        }
    }

    /**
     * Set position fee state
     *
     * Manually updates fee-related fields in position state without making RPC calls.
     * Use this when you have fee data from another source.
     *
     * @param id - Position database ID
     * @param feeState - Fee state values to set
     * @returns Updated position
     */
    async updateFeeState(
        id: string,
        feeState: PositionFeeState,
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3Position> {
        log.methodEntry(this.logger, "updateFeeState", {
            id,
            tokensOwed0: feeState.tokensOwed0.toString(),
            tokensOwed1: feeState.tokensOwed1.toString(),
        });

        const db = tx ?? this.prisma;

        try {
            // 1. Get existing position
            const existing = await this.findById(id);
            if (!existing) {
                throw new Error(`Position not found: ${id}`);
            }

            // 2. Parse current state and update fee fields
            const currentState = this.parseState(existing.state);
            const updatedState: UniswapV3PositionState = {
                ...currentState,
                feeGrowthInside0LastX128: feeState.feeGrowthInside0LastX128,
                feeGrowthInside1LastX128: feeState.feeGrowthInside1LastX128,
                tokensOwed0: feeState.tokensOwed0,
                tokensOwed1: feeState.tokensOwed1,
                unclaimedFees0: feeState.unclaimedFees0,
                unclaimedFees1: feeState.unclaimedFees1,
                tickLowerFeeGrowthOutside0X128:
                    feeState.tickLowerFeeGrowthOutside0X128,
                tickLowerFeeGrowthOutside1X128:
                    feeState.tickLowerFeeGrowthOutside1X128,
                tickUpperFeeGrowthOutside0X128:
                    feeState.tickUpperFeeGrowthOutside0X128,
                tickUpperFeeGrowthOutside1X128:
                    feeState.tickUpperFeeGrowthOutside1X128,
            };

            // 3. Serialize and persist
            const stateDB = this.serializeState(updatedState);

            log.dbOperation(this.logger, "update", "Position", {
                id,
                fields: [
                    "state.feeGrowthInside0LastX128",
                    "state.feeGrowthInside1LastX128",
                    "state.tokensOwed0",
                    "state.tokensOwed1",
                    "state.unclaimedFees0",
                    "state.unclaimedFees1",
                    "state.tickLowerFeeGrowthOutside0X128",
                    "state.tickLowerFeeGrowthOutside1X128",
                    "state.tickUpperFeeGrowthOutside0X128",
                    "state.tickUpperFeeGrowthOutside1X128",
                ],
            });

            const result = await db.position.update({
                where: { id },
                data: { state: stateDB as object },
                include: {
                    pool: {
                        include: { token0: true, token1: true },
                    },
                },
            });

            const position = this.mapToPosition(
                result as PositionDbResult,
            ) as UniswapV3Position;

            this.logger.debug(
                {
                    id,
                    tokensOwed0: feeState.tokensOwed0.toString(),
                    tokensOwed1: feeState.tokensOwed1.toString(),
                },
                "Position fee state updated",
            );
            log.methodExit(this.logger, "updateFeeState", { id });
            return position;
        } catch (error) {
            if (
                !(error instanceof Error && error.message.includes("not found"))
            ) {
                log.methodError(this.logger, "updateFeeState", error as Error, {
                    id,
                });
            }
            throw error;
        }
    }

    // ============================================================================
    // GRANULAR REFRESH METHODS
    // ============================================================================

    /**
     * Refresh position owner address from on-chain data
     *
     * Fetches the current owner from the NFT contract's ownerOf() function
     * and persists it to the database.
     *
     * @param id - Position database ID
     * @returns The current owner address
     * @throws Error if position not found
     * @throws Error if chain is not supported
     * @throws Error if NFT doesn't exist (burned)
     */
    private async refreshOwnerAddress(
        id: string,
        tx?: PrismaTransactionClient,
    ): Promise<string> {
        log.methodEntry(this.logger, "refreshOwnerAddress", { id });

        try {
            // 1. Get existing position
            const existing = await this.findById(id);
            if (!existing) {
                throw new Error(`Position not found: ${id}`);
            }

            const { chainId, nftId } = existing.typedConfig;

            // 2. Verify chain is supported
            if (!this.evmConfig.isChainSupported(chainId)) {
                throw new Error(
                    `Chain ${chainId} is not configured. Supported chains: ${this.evmConfig
                        .getSupportedChainIds()
                        .join(", ")}`,
                );
            }

            // 3. Get position manager address and public client
            const positionManagerAddress = getPositionManagerAddress(chainId);
            const client = this.evmConfig.getPublicClient(chainId);

            this.logger.debug(
                { id, positionManagerAddress, nftId, chainId },
                "Reading owner address from NonfungiblePositionManager",
            );

            // 4. Read owner from contract
            const ownerAddress = (await client.readContract({
                address: positionManagerAddress,
                abi: UNISWAP_V3_POSITION_MANAGER_ABI,
                functionName: "ownerOf",
                args: [BigInt(nftId)],
            })) as Address;

            // 5. Persist using setter
            await this.updateOwnerAddress(id, ownerAddress, tx);

            this.logger.info(
                { id, nftId, chainId, ownerAddress },
                "Position owner address refreshed",
            );

            log.methodExit(this.logger, "refreshOwnerAddress", {
                id,
                ownerAddress,
            });
            return ownerAddress;
        } catch (error) {
            if (
                !(error instanceof Error && error.message.includes("not found"))
            ) {
                log.methodError(
                    this.logger,
                    "refreshOwnerAddress",
                    error as Error,
                    { id },
                );
            }
            throw error;
        }
    }

    /**
     * Refresh position liquidity from on-chain data
     *
     * Fetches the current liquidity from the positions() function
     * and persists it to the database.
     *
     * Note: For accurate liquidity tracking, prefer using ledger events
     * which are the source of truth for liquidity changes.
     *
     * @param id - Position database ID
     * @returns The current liquidity as bigint
     * @throws Error if position not found
     * @throws Error if chain is not supported
     * @throws Error if NFT doesn't exist (burned)
     */
    private async refreshLiquidity(
        id: string,
        tx?: PrismaTransactionClient,
    ): Promise<bigint> {
        log.methodEntry(this.logger, "refreshLiquidity", { id });

        try {
            // 1. Get existing position
            const existing = await this.findById(id);
            if (!existing) {
                throw new Error(`Position not found: ${id}`);
            }

            const { chainId, nftId } = existing.typedConfig;

            // 2. Verify chain is supported
            if (!this.evmConfig.isChainSupported(chainId)) {
                throw new Error(
                    `Chain ${chainId} is not configured. Supported chains: ${this.evmConfig
                        .getSupportedChainIds()
                        .join(", ")}`,
                );
            }

            // 3. Get position manager address and public client
            const positionManagerAddress = getPositionManagerAddress(chainId);
            const client = this.evmConfig.getPublicClient(chainId);

            this.logger.debug(
                { id, positionManagerAddress, nftId, chainId },
                "Reading liquidity from NonfungiblePositionManager",
            );

            // 4. Read positions data from contract
            const positionData = (await client.readContract({
                address: positionManagerAddress,
                abi: UNISWAP_V3_POSITION_MANAGER_ABI,
                functionName: "positions",
                args: [BigInt(nftId)],
            })) as readonly [
                bigint, // nonce
                Address, // operator
                Address, // token0
                Address, // token1
                number, // fee
                number, // tickLower
                number, // tickUpper
                bigint, // liquidity
                bigint, // feeGrowthInside0LastX128
                bigint, // feeGrowthInside1LastX128
                bigint, // tokensOwed0
                bigint, // tokensOwed1
            ];

            const liquidity = positionData[7];

            // 5. Persist using setter
            await this.updateLiquidity(id, liquidity, tx);

            this.logger.info(
                { id, nftId, chainId, liquidity: liquidity.toString() },
                "Position liquidity refreshed",
            );

            log.methodExit(this.logger, "refreshLiquidity", {
                id,
                liquidity: liquidity.toString(),
            });
            return liquidity;
        } catch (error) {
            if (
                !(error instanceof Error && error.message.includes("not found"))
            ) {
                log.methodError(
                    this.logger,
                    "refreshLiquidity",
                    error as Error,
                    { id },
                );
            }
            throw error;
        }
    }

    /**
     * Refresh position fee state from on-chain data
     *
     * Fetches fee-related fields from the positions() function and calculates
     * unclaimed fees using the pool's fee growth values.
     *
     * @param id - Position database ID
     * @returns The current fee state
     * @throws Error if position not found
     * @throws Error if chain is not supported
     * @throws Error if NFT doesn't exist (burned)
     */
    private async refreshFeeState(
        id: string,
        tx?: PrismaTransactionClient,
    ): Promise<PositionFeeState> {
        log.methodEntry(this.logger, "refreshFeeState", { id });

        try {
            // 1. Get existing position with pool
            const existing = await this.findById(id);
            if (!existing) {
                throw new Error(`Position not found: ${id}`);
            }

            const { chainId, nftId } = existing.typedConfig;

            // 2. Verify chain is supported
            if (!this.evmConfig.isChainSupported(chainId)) {
                throw new Error(
                    `Chain ${chainId} is not configured. Supported chains: ${this.evmConfig
                        .getSupportedChainIds()
                        .join(", ")}`,
                );
            }

            // 3. Get position manager address and public client
            const positionManagerAddress = getPositionManagerAddress(chainId);
            const client = this.evmConfig.getPublicClient(chainId);

            this.logger.debug(
                { id, positionManagerAddress, nftId, chainId },
                "Reading fee state from NonfungiblePositionManager",
            );

            // 4. Get pool address and tick bounds from position config
            const { poolAddress, tickLower, tickUpper } = existing.typedConfig;

            // 5. Load pool state from database (already refreshed by caller)
            const pool = await this.poolService.findById(existing.pool.id, tx);
            if (!pool) {
                throw new Error(`Pool not found: ${existing.pool.id}`);
            }
            const {
                currentTick,
                feeGrowthGlobal0: feeGrowthGlobal0X128,
                feeGrowthGlobal1: feeGrowthGlobal1X128,
            } = pool.typedState;

            // 6. Read position data and tick data in parallel
            const [positionData, tickLowerData, tickUpperData] =
                await Promise.all([
                    client.readContract({
                        address: positionManagerAddress,
                        abi: UNISWAP_V3_POSITION_MANAGER_ABI,
                        functionName: "positions",
                        args: [BigInt(nftId)],
                    }) as Promise<
                        readonly [
                            bigint, // nonce
                            Address, // operator
                            Address, // token0
                            Address, // token1
                            number, // fee
                            number, // tickLower
                            number, // tickUpper
                            bigint, // liquidity
                            bigint, // feeGrowthInside0LastX128
                            bigint, // feeGrowthInside1LastX128
                            bigint, // tokensOwed0
                            bigint, // tokensOwed1
                        ]
                    >,
                    client.readContract({
                        address: poolAddress as Address,
                        abi: uniswapV3PoolAbi,
                        functionName: "ticks",
                        args: [tickLower],
                    }) as Promise<
                        readonly [
                            bigint, // liquidityGross
                            bigint, // liquidityNet (int128)
                            bigint, // feeGrowthOutside0X128
                            bigint, // feeGrowthOutside1X128
                            bigint, // tickCumulativeOutside
                            bigint, // secondsPerLiquidityOutsideX128
                            number, // secondsOutside
                            boolean, // initialized
                        ]
                    >,
                    client.readContract({
                        address: poolAddress as Address,
                        abi: uniswapV3PoolAbi,
                        functionName: "ticks",
                        args: [tickUpper],
                    }) as Promise<
                        readonly [
                            bigint, // liquidityGross
                            bigint, // liquidityNet (int128)
                            bigint, // feeGrowthOutside0X128
                            bigint, // feeGrowthOutside1X128
                            bigint, // tickCumulativeOutside
                            bigint, // secondsPerLiquidityOutsideX128
                            number, // secondsOutside
                            boolean, // initialized
                        ]
                    >,
                ]);

            const liquidity = positionData[7];
            const feeGrowthInside0LastX128 = positionData[8];
            const feeGrowthInside1LastX128 = positionData[9];
            const tokensOwed0 = positionData[10];
            const tokensOwed1 = positionData[11];

            // Extract tick fee growth data
            const tickLowerFeeGrowthOutside0X128 = tickLowerData[2];
            const tickLowerFeeGrowthOutside1X128 = tickLowerData[3];
            const tickUpperFeeGrowthOutside0X128 = tickUpperData[2];
            const tickUpperFeeGrowthOutside1X128 = tickUpperData[3];

            this.logger.debug(
                {
                    id,
                    tickLower,
                    tickUpper,
                    tickLowerFeeGrowthOutside0X128:
                        tickLowerFeeGrowthOutside0X128.toString(),
                    tickLowerFeeGrowthOutside1X128:
                        tickLowerFeeGrowthOutside1X128.toString(),
                    tickUpperFeeGrowthOutside0X128:
                        tickUpperFeeGrowthOutside0X128.toString(),
                    tickUpperFeeGrowthOutside1X128:
                        tickUpperFeeGrowthOutside1X128.toString(),
                },
                "Tick fee growth data fetched",
            );

            // 7. Get uncollected principal from ledger to calculate accurate unclaimed fees
            // tokensOwed on-chain = uncollectedPrincipal (from decrease liquidity) + unclaimedFees
            // So: unclaimedFees = tokensOwed - uncollectedPrincipal
            const ledgerEventService = new UniswapV3LedgerEventService(
                { positionId: id },
                { prisma: this._prisma },
            );
            const aggregates =
                await ledgerEventService.recalculateAggregates(existing.isToken0Quote, tx);
            const { uncollectedPrincipal0, uncollectedPrincipal1 } = aggregates;

            // Calculate actual unclaimed fees using shared utility
            // This accounts for both checkpointed fees (tokensOwed - principal) and
            // incremental fees (uncheckpointed fee growth since last interaction)
            const { unclaimedFees0, unclaimedFees1 } =
                calculateUnclaimedFeeAmounts({
                    liquidity,
                    tickLower,
                    tickUpper,
                    feeGrowthInside0LastX128,
                    feeGrowthInside1LastX128,
                    tokensOwed0,
                    tokensOwed1,
                    tickLowerFeeGrowthOutside0X128,
                    tickLowerFeeGrowthOutside1X128,
                    tickUpperFeeGrowthOutside0X128,
                    tickUpperFeeGrowthOutside1X128,
                    currentTick,
                    feeGrowthGlobal0X128,
                    feeGrowthGlobal1X128,
                    uncollectedPrincipal0,
                    uncollectedPrincipal1,
                });

            this.logger.debug(
                {
                    id,
                    liquidity: liquidity.toString(),
                    currentTick,
                    tokensOwed0: tokensOwed0.toString(),
                    tokensOwed1: tokensOwed1.toString(),
                    uncollectedPrincipal0: uncollectedPrincipal0.toString(),
                    uncollectedPrincipal1: uncollectedPrincipal1.toString(),
                    unclaimedFees0: unclaimedFees0.toString(),
                    unclaimedFees1: unclaimedFees1.toString(),
                },
                "Calculated unclaimed fees with incremental fee growth",
            );

            // 8. Create fee state with tick data and accurate unclaimed fees
            const feeState: PositionFeeState = {
                feeGrowthInside0LastX128,
                feeGrowthInside1LastX128,
                tokensOwed0,
                tokensOwed1,
                unclaimedFees0,
                unclaimedFees1,
                tickLowerFeeGrowthOutside0X128,
                tickLowerFeeGrowthOutside1X128,
                tickUpperFeeGrowthOutside0X128,
                tickUpperFeeGrowthOutside1X128,
            };

            // 9. Persist using setter
            await this.updateFeeState(id, feeState, tx);

            this.logger.info(
                {
                    id,
                    nftId,
                    chainId,
                    tokensOwed0: tokensOwed0.toString(),
                    tokensOwed1: tokensOwed1.toString(),
                    unclaimedFees0: feeState.unclaimedFees0.toString(),
                    unclaimedFees1: feeState.unclaimedFees1.toString(),
                },
                "Position fee state refreshed",
            );

            log.methodExit(this.logger, "refreshFeeState", { id });
            return feeState;
        } catch (error) {
            if (
                !(error instanceof Error && error.message.includes("not found"))
            ) {
                log.methodError(
                    this.logger,
                    "refreshFeeState",
                    error as Error,
                    { id },
                );
            }
            throw error;
        }
    }

    /**
     * Refresh position metrics (common fields) from current state
     *
     * Calculates and persists all financial metrics:
     * - currentValue (from pool price + position liquidity)
     * - currentCostBasis (from ledger)
     * - realizedPnl (from ledger)
     * - unrealizedPnl (currentValue - costBasis)
     * - collectedFees (from ledger)
     * - unClaimedFees (from on-chain state)
     * - lastFeesCollectedAt (from ledger)
     * - priceRangeLower/Upper (from ticks)
     *
     * Also refreshes pool state to ensure accurate price data.
     *
     * Note: Does NOT update totalApr, isActive, or positionClosedAt.
     *
     * @param id - Position database ID
     * @param tx - Optional Prisma transaction client
     */
    private async refreshMetrics(
        id: string,
        tx?: PrismaTransactionClient,
    ): Promise<void> {
        log.methodEntry(this.logger, "refreshMetrics", { id });

        try {
            // 1. Get existing position
            const position = await this.findById(id);
            if (!position) {
                throw new Error(`Position not found: ${id}`);
            }

            // 2. Load pool state from database (already refreshed by caller)
            const pool = await this.poolService.findById(position.pool.id, tx);
            if (!pool) {
                throw new Error(`Pool not found: ${position.pool.id}`);
            }

            // 3. Get ledger data from latest events
            const ledgerService = new UniswapV3LedgerEventService(
                { positionId: id },
                { prisma: this._prisma },
            );
            const latestEvent = await ledgerService.getLatestEvent(tx);
            const lastCollectEvent = await ledgerService.getLastCollectEvent(tx);

            // Extract values from latest event (or use zeros if no events)
            const costBasis = latestEvent?.costBasisAfter ?? 0n;
            const realizedPnl = latestEvent?.pnlAfter ?? 0n;
            const collectedFees = latestEvent?.collectedFeesAfter ?? 0n;

            // 4. Calculate current position value
            const currentValue = this.calculateCurrentPositionValue(
                position,
                pool,
            );

            // 5. Calculate unrealized PnL
            const unrealizedPnl = currentValue - costBasis;

            // 6. Calculate unclaimed fees (total value in quote token)
            const unClaimedFees = this.calculateUnclaimedFees(position, pool);

            // 7. Calculate price range
            const { priceRangeLower, priceRangeUpper } = this.calculatePriceRange(
                position,
                pool,
            );

            // 8. Determine lastFeesCollectedAt (use positionOpenedAt if no collections)
            const lastFeesCollectedAt = lastCollectEvent?.timestamp ?? position.positionOpenedAt;

            // 9. Update database with calculated metrics (skip APR calculation)
            const db = tx ?? this.prisma;

            log.dbOperation(this.logger, "update", "Position", {
                id,
                fields: [
                    "currentValue",
                    "currentCostBasis",
                    "realizedPnl",
                    "unrealizedPnl",
                    "collectedFees",
                    "unClaimedFees",
                    "lastFeesCollectedAt",
                    "priceRangeLower",
                    "priceRangeUpper",
                ],
            });

            await db.position.update({
                where: { id },
                data: {
                    currentValue: currentValue.toString(),
                    currentCostBasis: costBasis.toString(),
                    realizedPnl: realizedPnl.toString(),
                    unrealizedPnl: unrealizedPnl.toString(),
                    realizedCashflow: "0",
                    unrealizedCashflow: "0",
                    collectedFees: collectedFees.toString(),
                    unClaimedFees: unClaimedFees.toString(),
                    lastFeesCollectedAt,
                    priceRangeLower: priceRangeLower.toString(),
                    priceRangeUpper: priceRangeUpper.toString(),
                },
            });

            this.logger.info(
                {
                    id,
                    currentValue: currentValue.toString(),
                    costBasis: costBasis.toString(),
                    unrealizedPnl: unrealizedPnl.toString(),
                    unClaimedFees: unClaimedFees.toString(),
                },
                "Position metrics refreshed",
            );

            log.methodExit(this.logger, "refreshMetrics", { id });
        } catch (error) {
            if (
                !(error instanceof Error && error.message.includes("not found"))
            ) {
                log.methodError(this.logger, "refreshMetrics", error as Error, {
                    id,
                });
            }
            throw error;
        }
    }

    // ============================================================================
    // CRUD OPERATIONS OVERRIDES
    // ============================================================================

    /**
     * Create a new Uniswap V3 position
     *
     * Overrides base implementation to add:
     * - Duplicate prevention: Checks if position already exists for this user/chain/nftId
     * - Returns existing position if duplicate found (idempotent)
     *
     * Note: This is a manual creation helper. For creating positions from on-chain data,
     * use discover() which handles pool discovery, token role determination, and state fetching.
     *
     * @param input - Position data to create
     * @returns The created position, or existing position if duplicate found
     */
    async create(
        input: CreateUniswapV3PositionInput,
        configDB: Record<string, unknown>,
        stateDB: Record<string, unknown>,
    ): Promise<UniswapV3Position> {
        log.methodEntry(this.logger, "create", {
            userId: input.userId,
            chainId: input.config.chainId,
            nftId: input.config.nftId,
        });

        try {
            // Check for existing position by positionHash (fast indexed lookup)
            const positionHash = this.createHash({
                chainId: input.config.chainId,
                nftId: input.config.nftId,
            });
            const existing = await this.findByPositionHash(
                input.userId,
                positionHash,
            );

            if (existing) {
                this.logger.info(
                    {
                        id: existing.id,
                        userId: input.userId,
                        chainId: input.config.chainId,
                        nftId: input.config.nftId,
                        positionHash,
                    },
                    "Position already exists, returning existing position",
                );
                log.methodExit(this.logger, "create", {
                    id: existing.id,
                    duplicate: true,
                });
                return existing as UniswapV3Position;
            }

            // No duplicate found, create new position
            // Default calculated values (will be computed properly in discover())
            const now = new Date();
            const zeroValue = "0";

            log.dbOperation(this.logger, "create", "Position", {
                protocol: input.protocol,
                positionType: input.positionType,
                userId: input.userId,
                positionHash,
            });

            const result = await this.prisma.position.create({
                data: {
                    protocol: input.protocol,
                    positionType: input.positionType,
                    userId: input.userId,
                    poolId: input.poolId,
                    isToken0Quote: input.isToken0Quote,
                    positionHash,
                    config: configDB as object,
                    state: stateDB as object,
                    // Default calculated values
                    currentValue: zeroValue,
                    currentCostBasis: zeroValue,
                    realizedPnl: zeroValue,
                    unrealizedPnl: zeroValue,
                    // Cash flow fields for non-AMM protocols (always 0 for UniswapV3)
                    realizedCashflow: zeroValue,
                    unrealizedCashflow: zeroValue,
                    collectedFees: zeroValue,
                    unClaimedFees: zeroValue,
                    lastFeesCollectedAt: now,
                    priceRangeLower: zeroValue,
                    priceRangeUpper: zeroValue,
                    positionOpenedAt: input.positionOpenedAt ?? now,
                    positionClosedAt: null,
                    isActive: true,
                },
                include: {
                    pool: {
                        include: {
                            token0: true,
                            token1: true,
                        },
                    },
                },
            });

            // Map database result to Position type
            const position = this.mapToPosition(result as PositionDbResult);

            this.logger.info(
                {
                    id: position.id,
                    protocol: position.protocol,
                    positionType: position.positionType,
                    userId: position.userId,
                },
                "Position created",
            );

            log.methodExit(this.logger, "create", {
                id: position.id,
                duplicate: false,
            });
            return position as UniswapV3Position;
        } catch (error) {
            log.methodError(this.logger, "create", error as Error, {
                userId: input.userId,
                chainId: input.config.chainId,
                nftId: input.config.nftId,
            });
            throw error;
        }
    }

    /**
     * Find position by ID
     *
     * Overrides base implementation to:
     * - Filter by protocol type (returns null if not uniswapv3)
     *
     * @param id - Position ID
     * @returns Position if found and is uniswapv3 protocol, null otherwise
     */
    async findById(id: string): Promise<UniswapV3Position | null> {
        log.methodEntry(this.logger, "findById", { id });

        try {
            log.dbOperation(this.logger, "findUnique", "Position", { id });

            const result = await this.prisma.position.findUnique({
                where: { id },
                include: {
                    pool: {
                        include: {
                            token0: true,
                            token1: true,
                        },
                    },
                },
            });

            if (!result) {
                log.methodExit(this.logger, "findById", { id, found: false });
                return null;
            }

            // Filter by protocol type
            if (result.protocol !== "uniswapv3") {
                this.logger.debug(
                    { id, protocol: result.protocol },
                    "Position found but is not uniswapv3 protocol",
                );
                log.methodExit(this.logger, "findById", {
                    id,
                    found: false,
                    reason: "wrong_protocol",
                });
                return null;
            }

            // Map to UniswapV3Position
            const position = this.mapToPosition(result as any);

            log.methodExit(this.logger, "findById", { id, found: true });
            return position as UniswapV3Position;
        } catch (error) {
            log.methodError(this.logger, "findById", error as Error, { id });
            throw error;
        }
    }

    /**
     * Delete position
     *
     * Verifies protocol type and performs deletion:
     * - Verify protocol type (error if position exists but is not uniswapv3)
     * - Silently succeed if position doesn't exist (idempotent)
     *
     * @param id - Position ID
     * @returns Promise that resolves when deletion is complete
     * @throws Error if position exists but is not uniswapv3 protocol
     */
    async delete(id: string): Promise<void> {
        log.methodEntry(this.logger, "delete", { id });

        try {
            // Check if position exists and verify protocol type
            log.dbOperation(this.logger, "findUnique", "Position", { id });

            const existing = await this.prisma.position.findUnique({
                where: { id },
            });

            if (!existing) {
                this.logger.debug(
                    { id },
                    "Position not found, delete operation is no-op",
                );
                log.methodExit(this.logger, "delete", { id, deleted: false });
                return;
            }

            // Verify protocol type
            if (existing.protocol !== "uniswapv3") {
                const error = new Error(
                    `Cannot delete position ${id}: expected protocol 'uniswapv3', got '${existing.protocol}'`,
                );
                log.methodError(this.logger, "delete", error, {
                    id,
                    protocol: existing.protocol,
                });
                throw error;
            }

            // Delete the position
            log.dbOperation(this.logger, "delete", "Position", { id });
            await this.prisma.position.delete({
                where: { id },
            });

            log.methodExit(this.logger, "delete", { id, deleted: true });
        } catch (error) {
            // Only log if not already logged
            if (
                !(
                    error instanceof Error &&
                    error.message.includes("Cannot delete")
                )
            ) {
                log.methodError(this.logger, "delete", error as Error, { id });
            }
            throw error;
        }
    }

    // ============================================================================
    // HELPER METHODS - FINANCIAL CALCULATIONS
    // ============================================================================

    /**
     * Calculate current position value
     *
     * Uses liquidity utility to calculate token amounts and convert to quote value.
     *
     * @param position - Position object with config and state
     * @param pool - Pool object with current state
     * @returns Current position value in quote token units
     */
    private calculateCurrentPositionValue(
        position: UniswapV3Position,
        pool: UniswapV3Pool,
    ): bigint {
        const tickLower = position.tickLower;
        const tickUpper = position.tickUpper;
        const liquidity = position.liquidity;
        const sqrtPriceX96 = pool.sqrtPriceX96;

        if (liquidity === 0n) {
            return 0n;
        }

        // Determine token roles
        const baseIsToken0 = !position.isToken0Quote;

        // Calculate position value using utility function
        // Converts all token amounts to quote token value using sqrtPriceX96
        const positionValue = calculatePositionValue(
            liquidity,
            sqrtPriceX96,
            tickLower,
            tickUpper,
            baseIsToken0,
        );

        return positionValue;
    }

    /**
     * Calculate price range bounds
     *
     * Converts tick bounds to prices in quote token.
     *
     * @param position - Position object with config
     * @param pool - Pool object with token data
     * @returns Price range lower and upper bounds in quote token
     */
    private calculatePriceRange(
        position: UniswapV3Position,
        pool: UniswapV3Pool,
    ): { priceRangeLower: bigint; priceRangeUpper: bigint } {
        const tickLower = position.tickLower;
        const tickUpper = position.tickUpper;

        // Determine token addresses and decimals based on token roles
        const baseToken = position.isToken0Quote ? pool.token1 : pool.token0;
        const quoteToken = position.isToken0Quote ? pool.token0 : pool.token1;
        const baseTokenAddress = baseToken.address;
        const quoteTokenAddress = quoteToken.address;
        const baseTokenDecimals = baseToken.decimals;

        // Convert ticks to prices (quote per base)
        const priceRangeLower = tickToPrice(
            tickLower,
            baseTokenAddress,
            quoteTokenAddress,
            baseTokenDecimals,
        );

        const priceRangeUpper = tickToPrice(
            tickUpper,
            baseTokenAddress,
            quoteTokenAddress,
            baseTokenDecimals,
        );

        return { priceRangeLower, priceRangeUpper };
    }

    /**
     * Calculate unclaimed fees value in quote token
     *
     * Extracts unclaimed fee amounts from position state and converts
     * to total quote token value using the current pool price.
     *
     * @param position - Position object with state containing unclaimed fees
     * @param pool - Pool object with current price data
     * @returns Total unclaimed fees value in quote token units
     */
    private calculateUnclaimedFees(
        position: UniswapV3Position,
        pool: UniswapV3Pool,
    ): bigint {
        const { unclaimedFees0, unclaimedFees1 } = position.typedState;
        const sqrtPriceX96 = pool.sqrtPriceX96;

        // Convert both fee amounts to quote token value
        return calculateTokenValueInQuote(
            unclaimedFees0,
            unclaimedFees1,
            sqrtPriceX96,
            position.isToken0Quote,
            pool.token0.decimals,
            pool.token1.decimals,
        );
    }

    /**
     * Update position common fields in database
     *
     * Updates all financial and metadata fields for a position.
     *
     * @param positionId - Position database ID
     * @param fields - Fields to update
     * @param positionOpenedAt - Timestamp when position was opened (for APR calculation)
     */
    private async updatePositionCommonFields(
        positionId: string,
        fields: {
            currentValue: bigint;
            currentCostBasis: bigint;
            realizedPnl: bigint;
            unrealizedPnl: bigint;
            collectedFees: bigint;
            unClaimedFees: bigint;
            lastFeesCollectedAt: Date;
            priceRangeLower: bigint;
            priceRangeUpper: bigint;
        },
        positionOpenedAt: Date,
    ): Promise<void> {
        log.dbOperation(this.logger, "update", "Position", {
            id: positionId,
            fields: [
                "currentValue",
                "currentCostBasis",
                "realizedPnl",
                "unrealizedPnl",
                "collectedFees",
                "unClaimedFees",
                "lastFeesCollectedAt",
                "totalApr",
                "priceRangeLower",
                "priceRangeUpper",
            ],
        });

        // Calculate APR summary (combines realized + unrealized)
        const aprSummary = await this._aprService.calculateAprSummary(
            positionId,
            fields.currentCostBasis,
            fields.unClaimedFees,
            positionOpenedAt,
        );

        // Determine totalApr value (null if below threshold)
        const totalApr = aprSummary.belowThreshold ? null : aprSummary.totalApr;

        await this.prisma.position.update({
            where: { id: positionId },
            data: {
                currentValue: fields.currentValue.toString(),
                currentCostBasis: fields.currentCostBasis.toString(),
                realizedPnl: fields.realizedPnl.toString(),
                unrealizedPnl: fields.unrealizedPnl.toString(),
                // Cash flow fields always 0 for UniswapV3 (fees tracked separately)
                realizedCashflow: "0",
                unrealizedCashflow: "0",
                collectedFees: fields.collectedFees.toString(),
                unClaimedFees: fields.unClaimedFees.toString(),
                lastFeesCollectedAt: fields.lastFeesCollectedAt,
                totalApr,
                priceRangeLower: fields.priceRangeLower.toString(),
                priceRangeUpper: fields.priceRangeUpper.toString(),
            },
        });

        this.logger.debug(
            {
                positionId,
                currentValue: fields.currentValue.toString(),
                currentCostBasis: fields.currentCostBasis.toString(),
                unrealizedPnl: fields.unrealizedPnl.toString(),
                totalApr: totalApr?.toFixed(2) ?? "null (below threshold)",
            },
            "Position common fields updated with APR",
        );
    }

    // ============================================================================
    // BASE CRUD METHODS
    // ============================================================================

    /**
     * Find position by user ID and position hash
     *
     * Fast indexed lookup using positionHash field.
     * Replaces slow JSONB queries for position lookups.
     *
     * @param userId - User ID (ensures user can only access their positions)
     * @param positionHash - Position hash (generated by createHash)
     * @returns Position if found, null otherwise
     */
    async findByPositionHash(
        userId: string,
        positionHash: string,
    ): Promise<UniswapV3Position | null> {
        log.methodEntry(this.logger, "findByPositionHash", {
            userId,
            positionHash,
        });

        try {
            log.dbOperation(this.logger, "findFirst", "Position", {
                userId,
                positionHash,
            });

            const result = await this.prisma.position.findFirst({
                where: {
                    userId,
                    positionHash,
                },
                include: {
                    pool: {
                        include: {
                            token0: true,
                            token1: true,
                        },
                    },
                },
            });

            if (!result) {
                log.methodExit(this.logger, "findByPositionHash", {
                    userId,
                    positionHash,
                    found: false,
                });
                return null;
            }

            // Map to Position type
            const position = this.mapToPosition(result as PositionDbResult);

            log.methodExit(this.logger, "findByPositionHash", {
                userId,
                positionHash,
                found: true,
            });
            return position as UniswapV3Position;
        } catch (error) {
            log.methodError(this.logger, "findByPositionHash", error as Error, {
                userId,
                positionHash,
            });
            throw error;
        }
    }

    /**
     * Update position
     *
     * Generic helper for rare manual updates.
     * - Config updates are rare (position parameters are immutable on-chain)
     * - State updates should typically use refresh() method
     * - Calculated fields (PnL, fees) should be recomputed after state changes
     *
     * @param id - Position ID
     * @param input - Update input with optional fields
     * @returns Updated position
     * @throws Error if position not found
     */
    async update(
        id: string,
        input: UpdateAnyPositionInput,
    ): Promise<UniswapV3Position> {
        log.methodEntry(this.logger, "update", { id, input });

        try {
            // Currently, UpdateAnyPositionInput has no mutable fields
            // All updates should use refresh() method for state updates
            const data: Record<string, unknown> = {};

            log.dbOperation(this.logger, "update", "Position", {
                id,
                fields: Object.keys(data),
            });

            const result = await this.prisma.position.update({
                where: { id },
                data,
                include: {
                    pool: {
                        include: {
                            token0: true,
                            token1: true,
                        },
                    },
                },
            });

            // Map to Position type
            const position = this.mapToPosition(result as PositionDbResult);

            log.methodExit(this.logger, "update", { id });
            return position as UniswapV3Position;
        } catch (error) {
            log.methodError(this.logger, "update", error as Error, { id });
            throw error;
        }
    }

    // ============================================================================
    // PROTECTED HELPERS
    // ============================================================================

    /**
     * Map database result to UniswapV3Position using factory
     *
     * Converts string values to bigint for numeric fields, creates pool instance,
     * and uses PositionFactory to create protocol-specific position class.
     *
     * @param dbResult - Raw database result from Prisma
     * @returns UniswapV3Position instance
     */
    protected mapToPosition(dbResult: PositionDbResult): PositionInterface {
        // Create token instances from included pool data
        const token0 = Erc20Token.fromDB(dbResult.pool.token0 as Erc20TokenRow);
        const token1 = Erc20Token.fromDB(dbResult.pool.token1 as Erc20TokenRow);

        // Create pool instance from included pool data
        const poolRow = dbResult.pool as UniswapV3PoolRow;
        const pool = PoolFactory.fromDB(
            poolRow,
            token0,
            token1,
        ) as UniswapV3Pool;

        // Convert string bigint fields to native bigint
        const rowWithBigInt: PositionRow = {
            id: dbResult.id,
            positionHash: dbResult.positionHash ?? "",
            userId: dbResult.userId,
            protocol: dbResult.protocol,
            positionType: dbResult.positionType,
            poolId: dbResult.poolId,
            isToken0Quote: dbResult.isToken0Quote,
            currentValue: BigInt(dbResult.currentValue),
            currentCostBasis: BigInt(dbResult.currentCostBasis),
            realizedPnl: BigInt(dbResult.realizedPnl),
            unrealizedPnl: BigInt(dbResult.unrealizedPnl),
            realizedCashflow: BigInt(dbResult.realizedCashflow),
            unrealizedCashflow: BigInt(dbResult.unrealizedCashflow),
            collectedFees: BigInt(dbResult.collectedFees),
            unClaimedFees: BigInt(dbResult.unClaimedFees),
            lastFeesCollectedAt: dbResult.lastFeesCollectedAt,
            totalApr: dbResult.totalApr,
            priceRangeLower: BigInt(dbResult.priceRangeLower),
            priceRangeUpper: BigInt(dbResult.priceRangeUpper),
            positionOpenedAt: dbResult.positionOpenedAt,
            positionClosedAt: dbResult.positionClosedAt,
            isActive: dbResult.isActive,
            config: dbResult.config,
            state: dbResult.state,
            createdAt: dbResult.createdAt,
            updatedAt: dbResult.updatedAt,
            pool: dbResult.pool,
        };

        // Use factory to create protocol-specific position class
        return PositionFactory.fromDB(rowWithBigInt, pool);
    }
}
