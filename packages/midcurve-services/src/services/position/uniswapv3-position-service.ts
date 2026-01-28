/**
 * UniswapV3PositionService
 *
 * Specialized service for Uniswap V3 position management.
 * Handles serialization/deserialization of Uniswap V3 position config and state.
 */

import { PrismaClient } from '@midcurve/database';
import type {
    UniswapV3PositionConfigData,
    UniswapV3PositionState,
    PositionProtocol,
    PositionInterface,
    PositionRow,
    Erc20TokenRow,
    UniswapV3PoolRow,
} from "@midcurve/shared";
import { UniswapV3Position, PositionFactory, Erc20Token, PoolFactory } from "@midcurve/shared";
import type { UnclaimedFeesResult } from "./helpers/uniswapv3/position-calculations.js";
import { calculateUnclaimedFees } from "./helpers/uniswapv3/position-calculations.js";
import type { UniswapV3Pool } from "@midcurve/shared";
import type {
    UniswapV3PositionDiscoverInput,
    CreateUniswapV3PositionInput,
    UpdateAnyPositionInput,
} from "../types/position/position-input.js";
import { createServiceLogger, log } from "../../logging/index.js";
import type { ServiceLogger } from "../../logging/index.js";
import { getDomainEventPublisher, createDomainEvent } from '../../events/index.js';
import type { DomainEventPublisher } from '../../events/index.js';
import { EvmConfig } from "../../config/evm.js";
import {
    getPositionManagerAddress,
    getFactoryAddress,
    UNISWAP_V3_POSITION_MANAGER_ABI,
    UNISWAP_V3_FACTORY_ABI,
    type UniswapV3PositionData,
} from "../../config/uniswapv3.js";
import {
    isValidAddress,
    normalizeAddress,
    compareAddresses,
} from "@midcurve/shared";
import { UniswapV3PoolService } from "../pool/uniswapv3-pool-service.js";
import { EtherscanClient } from "../../clients/etherscan/index.js";
import { UniswapV3PositionLedgerService } from "../position-ledger/uniswapv3-position-ledger-service.js";
import { UniswapV3QuoteTokenService } from "../quote-token/uniswapv3-quote-token-service.js";
import { EvmBlockService } from "../block/evm-block-service.js";
import { PositionAprService } from "../position-apr/position-apr-service.js";
import { UniswapV3PoolPriceService } from "../pool-price/uniswapv3-pool-price-service.js";
import type { Address } from "viem";
import {
    computeFeeGrowthInside,
} from "@midcurve/shared";
import { calculatePositionValue } from "@midcurve/shared";
import { tickToPrice } from "@midcurve/shared";
import { uniswapV3PoolAbi } from "../../utils/uniswapv3/pool-abi.js";
import {
    calculatePoolPriceInQuoteToken,
    calculateTokenValueInQuote,
} from "../../utils/uniswapv3/ledger-calculations.js";
import { syncLedgerEvents } from "../position-ledger/helpers/uniswapv3/ledger-sync.js";
import { UniswapV3PositionSyncState } from "../position-ledger/position-sync-state.js";

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
    ledgerService?: import("../position-ledger/uniswapv3-position-ledger-service.js").UniswapV3PositionLedgerService;

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
    protected readonly protocol: PositionProtocol = 'uniswapv3';
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
        this.eventPublisher = dependencies.eventPublisher ?? getDomainEventPublisher();

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
        const chainId = typeof db.chainId === 'number' ? db.chainId : Number(db.chainId);
        const nftId = typeof db.nftId === 'number' ? db.nftId : Number(db.nftId);
        const tickUpper = typeof db.tickUpper === 'number' ? db.tickUpper : Number(db.tickUpper);
        const tickLower = typeof db.tickLower === 'number' ? db.tickLower : Number(db.tickLower);

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
        };

        return {
            ownerAddress: db.ownerAddress,
            liquidity: BigInt(db.liquidity),
            feeGrowthInside0LastX128: BigInt(db.feeGrowthInside0LastX128),
            feeGrowthInside1LastX128: BigInt(db.feeGrowthInside1LastX128),
            tokensOwed0: BigInt(db.tokensOwed0),
            tokensOwed1: BigInt(db.tokensOwed1),
            unclaimedFees0: BigInt(db.unclaimedFees0 ?? '0'),
            unclaimedFees1: BigInt(db.unclaimedFees1 ?? '0'),
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
            unclaimedFees0: state.unclaimedFees0?.toString() ?? '0',
            unclaimedFees1: state.unclaimedFees1?.toString() ?? '0',
        };
    }

    /**
     * Create position hash for UniswapV3 positions
     *
     * Generates a human-readable composite key for fast database lookups.
     * Format: "uniswapv3/{chainId}/{nftId}"
     *
     * Examples:
     * - Ethereum position 123456: "uniswapv3/1/123456"
     * - Arbitrum position 4865121: "uniswapv3/42161/4865121"
     * - BSC position 789: "uniswapv3/56/789"
     *
     * This hash is unique across all UniswapV3 positions and enables
     * fast indexed lookups instead of slow JSONB queries.
     *
     * @param config - UniswapV3 position configuration
     * @returns Position hash string in format "uniswapv3/{chainId}/{nftId}"
     */
    createPositionHash(config: Record<string, unknown>): string {
        const typedConfig = config as unknown as UniswapV3PositionConfigData;
        return `uniswapv3/${typedConfig.chainId}/${typedConfig.nftId}`;
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
        params: UniswapV3PositionDiscoverInput
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
            // Generate hash with minimal config (chainId + nftId) - other fields not needed for lookup
            const positionHash = this.createPositionHash({
                chainId,
                nftId,
                poolAddress: "0x0000000000000000000000000000000000000000", // Placeholder - not used in hash
                tickLower: 0, // Placeholder - not used in hash
                tickUpper: 0, // Placeholder - not used in hash
            });

            const existing = await this.findByPositionHash(
                userId,
                positionHash
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
                    "Position already exists (found via positionHash), refreshing state from on-chain"
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
                        `Invalid quote token address format: ${quoteTokenAddress}`
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
                    "Quote token address provided by caller"
                );
            } else {
                this.logger.debug(
                    "No quote token provided, will auto-detect using QuoteTokenService"
                );
            }

            // 3. Verify chain is supported
            if (!this.evmConfig.isChainSupported(chainId)) {
                const error = new Error(
                    `Chain ${chainId} is not configured. Supported chains: ${this.evmConfig
                        .getSupportedChainIds()
                        .join(", ")}`
                );
                log.methodError(this.logger, "discover", error, { chainId });
                throw error;
            }

            this.logger.debug(
                { chainId },
                "Chain is supported, proceeding with on-chain discovery"
            );

            // 4. For burned/closed positions, fetch latest event from Etherscan first
            // This gives us a block number when the position still existed
            this.logger.debug(
                { chainId, nftId },
                "Fetching position events from Etherscan to determine if position is burned"
            );

            let blockNumber: bigint | undefined;
            let positionOpenedAt: Date | undefined;
            try {
                const events = await this.etherscanClient.fetchPositionEvents(
                    chainId,
                    nftId.toString()
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
                        "Found events - will query position state at block when position was created"
                    );
                }
            } catch (error) {
                this.logger.warn(
                    { error, chainId, nftId },
                    "Failed to fetch events from Etherscan, will attempt current block query"
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
                "Reading position data from NonfungiblePositionManager"
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
                        bigint
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
                "Position data read from contract"
            );

            // 5. Compute pool address (UniswapV3 uses deterministic addressing)
            // For now, we'll discover the pool from token addresses and fee
            // Note: In production, you'd compute the pool address deterministically
            // using the factory address and CREATE2
            const poolAddress = await this.computePoolAddress(
                chainId,
                position.token0,
                position.token1,
                position.fee
            );

            this.logger.debug(
                {
                    poolAddress,
                    token0: position.token0,
                    token1: position.token1,
                    fee: position.fee,
                },
                "Pool address computed/discovered"
            );

            // 6. Discover pool via UniswapV3PoolService
            const pool = await this.poolService.discover({
                poolAddress,
                chainId,
            });

            this.logger.debug(
                {
                    poolId: pool.id,
                    token0: pool.token0.symbol,
                    token1: pool.token1.symbol,
                },
                "Pool discovered/fetched"
            );

            // 7. Determine quote token
            let isToken0Quote: boolean;

            if (normalizedQuoteAddress) {
                // EXPLICIT MODE: User provided quoteTokenAddress
                const token0Matches =
                    compareAddresses(
                        pool.token0.address,
                        normalizedQuoteAddress
                    ) === 0;
                const token1Matches =
                    compareAddresses(
                        pool.token1.address,
                        normalizedQuoteAddress
                    ) === 0;

                if (!token0Matches && !token1Matches) {
                    const error = new Error(
                        `Quote token address ${normalizedQuoteAddress} does not match either pool token. ` +
                            `Pool token0: ${pool.token0.address}, token1: ${pool.token1.address}`
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
                    "Quote token determined from caller input"
                );
            } else {
                // AUTO-DETECT MODE: Use QuoteTokenService
                this.logger.debug(
                    "Auto-detecting quote token using QuoteTokenService"
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
                    "Quote token auto-detected"
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
                "Token roles determined"
            );

            // 8. Create position config (without token0IsQuote, now at position level)
            const config: UniswapV3PositionConfigData = {
                chainId,
                nftId,
                poolAddress,
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
            };

            this.logger.debug(
                {
                    ownerAddress: state.ownerAddress,
                    liquidity: state.liquidity.toString(),
                    tokensOwed0: state.tokensOwed0.toString(),
                    tokensOwed1: state.tokensOwed1.toString(),
                },
                "Position state initialized from on-chain data"
            );

            // 10. Create position via create() method
            const configDB = this.serializeConfig(config) as Record<string, unknown>;
            const stateDB = this.serializeState(state) as Record<string, unknown>;
            const createdPosition = await this.create({
                protocol: "uniswapv3",
                positionType: "CL_TICKS",
                userId,
                poolId: pool.id,
                isToken0Quote, // Boolean flag for token roles
                config,
                state,
                positionOpenedAt, // Blockchain timestamp from first event (if available)
            }, configDB, stateDB);

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
                "Position discovered and created"
            );

            // 11. Discover ledger events from blockchain
            try {
                this.logger.info(
                    { positionId: createdPosition.id },
                    "Discovering ledger events from blockchain"
                );

                // Full sync from NFPM deployment block (new position)
                const syncResult = await syncLedgerEvents(
                    {
                        positionId: createdPosition.id,
                        chainId: createdPosition.chainId,
                        nftId: BigInt(createdPosition.nftId),
                        forceFullResync: true,  // New position - full sync
                    },
                    {
                        prisma: this.prisma,
                        etherscanClient: this.etherscanClient,
                        evmBlockService: this.evmBlockService,
                        aprService: this.aprService,
                        logger: this.logger,
                        ledgerService: this.ledgerService,
                        poolPriceService: this.poolPriceService,
                    }
                );

                this.logger.info(
                    {
                        positionId: createdPosition.id,
                        eventsAdded: syncResult.eventsAdded,
                        fromBlock: syncResult.fromBlock.toString(),
                        finalizedBlock: syncResult.finalizedBlock.toString(),
                    },
                    "Ledger events discovered successfully"
                );

                // Update position state from the last ledger event
                // The sync creates ledger events but doesn't update position state
                // We need to apply the final state changes (liquidity, checkpoints) from the last event
                if (syncResult.eventsAdded > 0) {
                    // Get most recent event using ledger service helper
                    // This ensures correct event ordering (DESC by timestamp)
                    const mostRecentEvent = await this.ledgerService.getMostRecentEvent(createdPosition.id);

                    if (mostRecentEvent) {
                        const eventConfig = mostRecentEvent.config as { liquidityAfter?: string | bigint; feeGrowthInside0LastX128?: string | bigint; feeGrowthInside1LastX128?: string | bigint; };

                        // Read current position state
                        const currentPosition = await this.findById(createdPosition.id);
                        if (!currentPosition) {
                            throw new Error(`Position ${createdPosition.id} not found after sync`);
                        }

                        // Update liquidity from most recent event
                        const finalLiquidity = typeof eventConfig.liquidityAfter === "string" ? BigInt(eventConfig.liquidityAfter) : eventConfig.liquidityAfter;

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
                            this.logger.warn({ positionId: createdPosition.id, eventType: mostRecentEvent.eventType }, "Most recent event has no liquidityAfter - skipping update");
                        }
                    }
                }
            } catch (error) {
                this.logger.warn(
                    { error, positionId: createdPosition.id },
                    "Failed to discover ledger events, position will have zero PnL"
                );
                // Continue - position exists but PnL will be stale
            }

            // 12. Calculate and update common fields
            try {
                this.logger.debug(
                    { positionId: createdPosition.id },
                    "Calculating position common fields"
                );

                // Get ledger summary (now has real data from events discovered above)
                const ledgerSummary = await this.getLedgerSummary(
                    createdPosition.id
                );

                // Calculate current position value
                const currentValue = this.calculateCurrentPositionValue(
                    createdPosition,
                    pool
                );

                // Calculate unrealized PnL
                const unrealizedPnl = currentValue - ledgerSummary.costBasis;

                // Calculate unclaimed fees
                const fees = await this.calculateUnclaimedFees(
                    createdPosition,
                    pool
                );

                // Update position state with individual fee amounts (state is read-only, create new object)
                const currentState = createdPosition.typedState;
                const updatedState: UniswapV3PositionState = {
                    ...currentState,
                    unclaimedFees0: fees.unclaimedFees0,
                    unclaimedFees1: fees.unclaimedFees1,
                };

                // Serialize and save updated state
                const stateDB = this.serializeState(updatedState);
                await this.prisma.position.update({
                    where: { id: createdPosition.id },
                    data: { state: stateDB as object },
                });

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
                        unClaimedFees: fees.unclaimedFeesValue,
                        lastFeesCollectedAt:
                            ledgerSummary.lastFeesCollectedAt.getTime() === 0
                                ? createdPosition.positionOpenedAt
                                : ledgerSummary.lastFeesCollectedAt,
                        priceRangeLower,
                        priceRangeUpper,
                    },
                    createdPosition.positionOpenedAt
                );

                this.logger.info(
                    {
                        positionId: createdPosition.id,
                        currentValue: currentValue.toString(),
                        costBasis: ledgerSummary.costBasis.toString(),
                        unrealizedPnl: unrealizedPnl.toString(),
                    },
                    "Position common fields calculated and updated"
                );
            } catch (error) {
                // Clean up orphaned position before re-throwing
                this.logger.error(
                    {
                        error,
                        positionId: createdPosition.id,
                    },
                    "Failed to calculate/update common fields, deleting orphaned position"
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

    /**
     * Query the pool address for a given token pair and fee from the factory contract
     *
     * Uses the UniswapV3 Factory's getPool() function to retrieve the pool address.
     * The factory returns the zero address if no pool exists for the given parameters.
     *
     * @param chainId - Chain ID
     * @param token0 - Address of token0
     * @param token1 - Address of token1
     * @param fee - Fee tier in basis points
     * @returns Pool address
     * @throws Error if pool doesn't exist (factory returns zero address)
     * @private
     */
    private async computePoolAddress(
        chainId: number,
        token0: Address,
        token1: Address,
        fee: number
    ): Promise<string> {
        const factoryAddress = getFactoryAddress(chainId);
        const client = this.evmConfig.getPublicClient(chainId);

        this.logger.debug(
            { factoryAddress, token0, token1, fee, chainId },
            "Querying factory for pool address"
        );

        const poolAddress = (await client.readContract({
            address: factoryAddress,
            abi: UNISWAP_V3_FACTORY_ABI,
            functionName: "getPool",
            args: [token0, token1, fee],
        })) as Address;

        // Check if pool exists (factory returns zero address if pool doesn't exist)
        const zeroAddress = "0x0000000000000000000000000000000000000000";
        if (
            poolAddress.toLowerCase() === zeroAddress.toLowerCase() ||
            poolAddress === zeroAddress
        ) {
            throw new Error(
                `Pool does not exist for token0=${token0}, token1=${token1}, fee=${fee} on chain ${chainId}`
            );
        }

        this.logger.debug(
            { poolAddress, token0, token1, fee },
            "Pool address retrieved from factory"
        );

        return normalizeAddress(poolAddress);
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
     * Updates:
     * - liquidity (from ledger events)
     * - feeGrowthInside0/1LastX128 (from on-chain, only if L > 0)
     * - tokensOwed0/1 (from on-chain, only if L > 0)
     * - ownerAddress (from on-chain, only if L > 0)
     * - isActive (set to false if position is fully closed)
     * - positionClosedAt (set to timestamp of final COLLECT event if position is fully closed)
     *
     * Note: Config fields (chainId, nftId, ticks, poolAddress) are immutable and not updated.
     * Note: PnL fields and fees are NOT recalculated in this implementation.
     *
     * @param id - Position ID
     * @returns Updated position with fresh state
     * @throws Error if position not found
     * @throws Error if position is not uniswapv3 protocol
     * @throws Error if chain is not supported
     * @throws Error if on-chain read fails (only for L > 0 positions)
     */
    async refresh(id: string): Promise<UniswapV3Position> {
        log.methodEntry(this.logger, "refresh", { id });

        try {
            // 1. Get existing position to verify it exists and get config
            const existingPosition = await this.findById(id);

            if (!existingPosition) {
                const error = new Error(`Position not found: ${id}`);
                log.methodError(this.logger, "refresh", error, { id });
                throw error;
            }

            // 2. Check if recently updated (< 15 seconds ago)
            // BUT: Skip cache if position was just created (< 5 seconds old)
            // to ensure missing events are processed immediately
            const now = new Date();
            const ageSeconds = (now.getTime() - existingPosition.updatedAt.getTime()) / 1000;
            const positionAgeSeconds = (now.getTime() - existingPosition.createdAt.getTime()) / 1000;
            const isNewlyCreated = positionAgeSeconds < 5;

            if (!isNewlyCreated && ageSeconds < 15) {
                // Use cache only if not newly created
                this.logger.info(
                    { id, ageSeconds: ageSeconds.toFixed(2) },
                    "Position updated recently, returning cached data"
                );
                log.methodExit(this.logger, "refresh", { id, cached: true });
                return existingPosition;
            }

            if (isNewlyCreated) {
                this.logger.debug(
                    { id, positionAgeSeconds: positionAgeSeconds.toFixed(2) },
                    "Position newly created, bypassing cache to process missing events"
                );
            }

            this.logger.debug(
                {
                    id,
                    chainId: existingPosition.chainId,
                    nftId: existingPosition.nftId,
                },
                "Position found, proceeding with state refresh"
            );

            const chainId = existingPosition.chainId;
            const nftId = existingPosition.nftId;

            // 2. Verify chain is supported
            if (!this.evmConfig.isChainSupported(chainId)) {
                const error = new Error(
                    `Chain ${chainId} is not configured. Supported chains: ${this.evmConfig
                        .getSupportedChainIds()
                        .join(", ")}`
                );
                log.methodError(this.logger, "refresh", error, { id, chainId });
                throw error;
            }

            this.logger.debug(
                { id, chainId },
                "Chain is supported, proceeding with on-chain state read"
            );

            // 3. Read fresh state from NonfungiblePositionManager contract
            const positionManagerAddress = getPositionManagerAddress(chainId);
            const client = this.evmConfig.getPublicClient(chainId);

            this.logger.debug(
                { id, positionManagerAddress, nftId, chainId },
                "Reading fresh position state from NonfungiblePositionManager"
            );

            // 4. Fetch position state from on-chain
            let updatedState: UniswapV3PositionState;

            const [positionData, ownerAddress] = await Promise.all([
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
                            bigint, // liquidity (IGNORED - use ledger value)
                            bigint, // feeGrowthInside0LastX128
                            bigint, // feeGrowthInside1LastX128
                            bigint, // tokensOwed0
                            bigint // tokensOwed1
                        ]
                    >,
                    client.readContract({
                        address: positionManagerAddress,
                        abi: UNISWAP_V3_POSITION_MANAGER_ABI,
                        functionName: "ownerOf",
                        args: [BigInt(nftId)],
                    }) as Promise<Address>,
                ]);

                // ========================================================================
                // VALIDATION: Check for non-existent or burned NFT
                // ========================================================================
                // When NFT doesn't exist, the positions() function returns all zeros.
                // positionData[2] is token0, positionData[3] is token1
                const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

                if (positionData[2] === ZERO_ADDRESS || positionData[3] === ZERO_ADDRESS) {
                    const error = new Error(
                        `Position NFT ${nftId} on chain ${chainId} does not exist or has been burned (token addresses are zero)`
                    );
                    log.methodError(this.logger, "refresh", error, { id, nftId, chainId });
                    throw error;
                }

                // Additional check: if position previously had liquidity but now all fields are zero,
                // it's likely the chain was reset (e.g., local dev chain restarted)
                const allFieldsZero = positionData[7] === 0n && // liquidity
                                      positionData[8] === 0n && // feeGrowthInside0LastX128
                                      positionData[9] === 0n && // feeGrowthInside1LastX128
                                      positionData[10] === 0n && // tokensOwed0
                                      positionData[11] === 0n;   // tokensOwed1

                // Defensive BigInt conversion in case state was deserialized from JSON
                const existingLiquidity = typeof existingPosition.liquidity === 'bigint'
                    ? existingPosition.liquidity
                    : BigInt(existingPosition.liquidity);
                if (allFieldsZero && existingLiquidity > 0n) {
                    const error = new Error(
                        `Position NFT ${nftId} on chain ${chainId} appears to have been deleted (all state fields are zero but position previously had liquidity)`
                    );
                    log.methodError(this.logger, "refresh", error, { id, nftId, chainId });
                    throw error;
                }

                this.logger.debug(
                    {
                        id,
                        liquidity: positionData[7].toString(),
                        feeGrowthInside0LastX128: positionData[8].toString(),
                        feeGrowthInside1LastX128: positionData[9].toString(),
                        tokensOwed0: positionData[10].toString(),
                        tokensOwed1: positionData[11].toString(),
                        owner: ownerAddress,
                    },
                    "Position state read from on-chain"
                );

                // Create updated state from on-chain data
                updatedState = {
                    ownerAddress: normalizeAddress(ownerAddress),
                    liquidity: positionData[7], // From on-chain
                    feeGrowthInside0LastX128: positionData[8],
                    feeGrowthInside1LastX128: positionData[9],
                    tokensOwed0: positionData[10],
                    tokensOwed1: positionData[11],
                    unclaimedFees0: 0n, // Will be calculated later
                    unclaimedFees1: 0n,
                };

                this.logger.debug(
                    {
                        id,
                        ownerAddress: updatedState.ownerAddress,
                        liquidity: updatedState.liquidity.toString(),
                        stateSource: "on-chain",
                    },
                    "State updated from on-chain data"
                );

                // ========================================================================
                // LAYER 2 - STEP 0: MISSING EVENTS CHECK
                // ========================================================================
                // Before any state comparisons, check if UI has transmitted missing
                // events (from transactions not yet indexed by Etherscan).
                // If missing events exist, skip all other checks and force sync immediately.
                // ========================================================================

                this.logger.debug(
                    { id },
                    "Checking for missing events in sync state"
                );

                // Get last finalized block
                const finalizedBlock = await this.evmBlockService.getLastFinalizedBlockNumber(chainId);

                if (finalizedBlock === null || finalizedBlock === undefined) {
                    const error = new Error(
                        `Failed to retrieve finalized block number for chain ${chainId}. ` +
                        'Chain may not be supported or RPC endpoint may be unavailable.'
                    );
                    this.logger.error(
                        { id, chainId, error: error.message },
                        'Finalized block is null or undefined during missing events check'
                    );
                    throw error;
                }

                // Load sync state and prune finalized missing events
                const syncState = await UniswapV3PositionSyncState.load(this.prisma, id);
                syncState.pruneEvents(finalizedBlock);
                const missingEvents = syncState.getMissingEventsSorted();

                // Save sync state after pruning
                await syncState.save(this.prisma, 'position-refresh');

                if (missingEvents.length > 0) {
                    this.logger.info(
                        {
                            id,
                            missingEventCount: missingEvents.length,
                            oldestBlock: missingEvents[0]?.blockNumber,
                            newestBlock: missingEvents[missingEvents.length - 1]?.blockNumber,
                        },
                        "Missing events detected - forcing ledger sync (skipping state checks)"
                    );

                    // Force incremental sync to process missing events
                    const syncResult = await syncLedgerEvents(
                        {
                            positionId: id,
                            chainId,
                            nftId: BigInt(nftId),
                            forceFullResync: false,  // Incremental sync
                        },
                        {
                            prisma: this.prisma,
                            etherscanClient: this.etherscanClient,
                            evmBlockService: this.evmBlockService,
                            aprService: this.aprService,
                            logger: this.logger,
                            ledgerService: this.ledgerService,
                            poolPriceService: this.poolPriceService,
                        }
                    );

                    this.logger.info(
                        {
                            id,
                            eventsAdded: syncResult.eventsAdded,
                            fromBlock: syncResult.fromBlock.toString(),
                            finalizedBlock: syncResult.finalizedBlock.toString(),
                        },
                        "Ledger events synced successfully after missing events detection"
                    );

                    // CRITICAL: Re-read on-chain state after processing missing events
                    // The COLLECT event may have changed feeGrowthInside values, so we need
                    // fresh on-chain data to calculate unclaimed fees correctly
                    this.logger.debug(
                        { id, chainId, nftId },
                        "Re-reading on-chain position state after missing events processing"
                    );

                    const [positionDataAfterSync, ownerAddressAfterSync] = await Promise.all([
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
                                bigint // tokensOwed1
                            ]
                        >,
                        client.readContract({
                            address: positionManagerAddress,
                            abi: UNISWAP_V3_POSITION_MANAGER_ABI,
                            functionName: "ownerOf",
                            args: [BigInt(nftId)],
                        }) as Promise<Address>,
                    ]);

                    // Update updatedState with fresh on-chain values
                    updatedState = {
                        ownerAddress: normalizeAddress(ownerAddressAfterSync),
                        liquidity: positionDataAfterSync[7],
                        feeGrowthInside0LastX128: positionDataAfterSync[8],
                        feeGrowthInside1LastX128: positionDataAfterSync[9],
                        tokensOwed0: positionDataAfterSync[10],
                        tokensOwed1: positionDataAfterSync[11],
                        unclaimedFees0: 0n, // Will be calculated later
                        unclaimedFees1: 0n,
                    };

                    this.logger.debug(
                        {
                            id,
                            feeGrowthInside0LastX128: updatedState.feeGrowthInside0LastX128.toString(),
                            feeGrowthInside1LastX128: updatedState.feeGrowthInside1LastX128.toString(),
                            tokensOwed0: updatedState.tokensOwed0.toString(),
                            tokensOwed1: updatedState.tokensOwed1.toString(),
                        },
                        "On-chain state refreshed after missing events processing"
                    );

                    // Re-fetch position after sync to get updated state
                    // syncLedgerEvents() processes missing events and updates position state
                    // We need fresh data before calculating values
                    const syncedPosition = await this.findById(id);
                    if (!syncedPosition) {
                        throw new Error(
                            `Position ${id} not found after syncing missing events`
                        );
                    }

                    // Refresh pool state to ensure accurate current price for calculations
                    this.logger.debug(
                        { poolId: syncedPosition.pool.id },
                        "Refreshing pool state to get current sqrtPriceX96 and tick"
                    );

                    const pool = await this.poolService.refresh(syncedPosition.pool.id);

                    this.logger.debug(
                        {
                            id,
                            poolId: pool.id,
                            sqrtPriceX96: pool.sqrtPriceX96.toString(),
                            currentTick: pool.state.currentTick
                        },
                        "Position re-fetched after missing events sync, pool state refreshed - proceeding to value calculation"
                    );

                    // ========================================================================
                    // SYNC POSITION STATE WITH LEDGER
                    // ========================================================================
                    // After syncLedgerEvents() completes, ledger tracks correct liquidity
                    // in event configs, but position.state.liquidity may be stale.
                    // We need to:
                    // 1. Get last ledger event's liquidityAfter
                    // 2. Update position.state.liquidity to match ledger
                    // 3. Check if position is fully closed
                    // ========================================================================

                    this.logger.debug(
                        { id },
                        "Syncing position.state with ledger after event processing"
                    );

                    // Get last ledger event to extract calculated liquidity
                    const lastEvents = await this.ledgerService.findAllItems(id);
                    const lastLedgerEvent = lastEvents[0]; // Sorted DESC by timestamp

                    if (lastLedgerEvent) {
                        // Use typedConfig to get actual bigint values (not JSON-serialized strings)
                        const ledgerLiquidity = lastLedgerEvent.typedConfig.liquidityAfter;
                        const currentStateLiquidity = syncedPosition.liquidity;

                        // Check if we need to update position.state.liquidity
                        if (ledgerLiquidity !== currentStateLiquidity) {
                            this.logger.info(
                                {
                                    id,
                                    oldLiquidity: currentStateLiquidity.toString(),
                                    newLiquidity: ledgerLiquidity.toString(),
                                },
                                "Updating position.state.liquidity to match ledger"
                            );

                            // Update position state with new liquidity
                            const currentTypedState = syncedPosition.typedState;
                            const updatedState: UniswapV3PositionState = {
                                ...currentTypedState,
                                liquidity: ledgerLiquidity,
                            };

                            // Serialize state for database (converts bigints to strings)
                            const stateDB = this.serializeState(updatedState);

                            // Update position state in database
                            await this.prisma.position.update({
                                where: { id },
                                data: {
                                    state: stateDB as object,
                                },
                            });
                            // Note: in-memory state not updated - position will be re-read if needed
                        }

                        // ========================================================================
                        // COLLECT EVENT CHECKPOINT REFRESH
                        // ========================================================================
                        // If a COLLECT event was synced, the on-chain feeGrowthInside*LastX128
                        // values have been updated by the Uniswap contract. We need to refresh
                        // these checkpoint values from on-chain to prevent double-counting fees
                        // in the unclaimed fees calculation.
                        // ========================================================================

                        const hasRecentCollect = lastLedgerEvent && lastLedgerEvent.eventType === 'COLLECT';

                        if (hasRecentCollect) {
                            this.logger.info(
                                {
                                    id,
                                    collectTimestamp: lastLedgerEvent!.timestamp.toISOString(),
                                },
                                "COLLECT event detected - refreshing fee growth checkpoints from on-chain"
                            );

                            // Re-read position state from blockchain to get updated checkpoints
                            const positionManagerAddress = getPositionManagerAddress(chainId);
                            const client = this.evmConfig.getPublicClient(chainId);

                            const [freshPositionData] = await Promise.all([
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
                                        bigint // tokensOwed1
                                    ]
                                >,
                            ]);

                            const syncedTypedState = syncedPosition.typedState;
                            this.logger.debug(
                                {
                                    id,
                                    oldCheckpoint0: syncedTypedState.feeGrowthInside0LastX128.toString(),
                                    newCheckpoint0: freshPositionData[8].toString(),
                                    oldCheckpoint1: syncedTypedState.feeGrowthInside1LastX128.toString(),
                                    newCheckpoint1: freshPositionData[9].toString(),
                                    oldTokensOwed0: syncedTypedState.tokensOwed0.toString(),
                                    newTokensOwed0: freshPositionData[10].toString(),
                                    oldTokensOwed1: syncedTypedState.tokensOwed1.toString(),
                                    newTokensOwed1: freshPositionData[11].toString(),
                                },
                                "Fee growth checkpoints comparison (old vs new)"
                            );

                            // Update position state with fresh checkpoint values
                            const refreshedState: UniswapV3PositionState = {
                                ...syncedTypedState,
                                feeGrowthInside0LastX128: freshPositionData[8],
                                feeGrowthInside1LastX128: freshPositionData[9],
                                tokensOwed0: freshPositionData[10],
                                tokensOwed1: freshPositionData[11],
                            };

                            // Serialize state for database
                            const refreshedStateDB = this.serializeState(refreshedState);

                            // Update position state in database
                            await this.prisma.position.update({
                                where: { id },
                                data: {
                                    state: refreshedStateDB as object,
                                },
                            });

                            // Update in-memory object
                            syncedPosition.state.feeGrowthInside0LastX128 = freshPositionData[8];
                            syncedPosition.state.feeGrowthInside1LastX128 = freshPositionData[9];
                            syncedPosition.state.tokensOwed0 = freshPositionData[10];
                            syncedPosition.state.tokensOwed1 = freshPositionData[11];

                            this.logger.info(
                                { id },
                                "Fee growth checkpoints refreshed successfully after COLLECT"
                            );
                        }

                        // ========================================================================
                        // POSITION CLOSURE DETECTION
                        // ========================================================================
                        // A position is fully closed when:
                        // 1. Liquidity is zero (all liquidity withdrawn)
                        // 2. Last event is COLLECT (all principal collected)
                        // 3. Position is currently marked as active
                        // ========================================================================

                        const isLiquidityZero = ledgerLiquidity === 0n;
                        const isLastEventCollect = lastLedgerEvent.eventType === 'COLLECT';
                        const isCurrentlyActive = syncedPosition.isActive;

                        if (isLiquidityZero && isLastEventCollect && isCurrentlyActive) {
                            const closedAt = lastLedgerEvent.timestamp;

                            this.logger.info(
                                {
                                    id,
                                    closedAt: closedAt.toISOString(),
                                    lastEventType: lastLedgerEvent.eventType,
                                },
                                "Position fully closed - setting isActive=false and positionClosedAt"
                            );

                            // Mark position as closed
                            await this.prisma.position.update({
                                where: { id },
                                data: {
                                    isActive: false,
                                    positionClosedAt: closedAt,
                                },
                            });
                            // Note: in-memory state not updated - position will be re-read if needed
                        }
                    }

                    // Skip state update (sync already handled it) - jump to value calculation
                    // Get ledger summary for PnL calculations
                    const ledgerSummary = await this.getLedgerSummary(id);

                    // Calculate current position value
                    const currentValue = this.calculateCurrentPositionValue(
                        syncedPosition,
                        pool
                    );

                    // Calculate unrealized PnL
                    const unrealizedPnl = currentValue - ledgerSummary.costBasis;

                    // Calculate unclaimed fees
                    const fees = await this.calculateUnclaimedFees(
                        syncedPosition,
                        pool
                    );

                    // Update position state with individual fee amounts (state is read-only)
                    const syncedTypedStateForFees = syncedPosition.typedState;
                    const feeUpdatedState: UniswapV3PositionState = {
                        ...syncedTypedStateForFees,
                        unclaimedFees0: fees.unclaimedFees0,
                        unclaimedFees1: fees.unclaimedFees1,
                    };

                    // Serialize and save updated state
                    const feeStateDB = this.serializeState(feeUpdatedState);
                    await this.prisma.position.update({
                        where: { id },
                        data: { state: feeStateDB as object },
                    });

                    // Calculate price range
                    const { priceRangeLower, priceRangeUpper } =
                        this.calculatePriceRange(syncedPosition, pool);

                    // Update position with calculated fields
                    await this.updatePositionCommonFields(
                        id,
                        {
                            currentValue,
                            currentCostBasis: ledgerSummary.costBasis,
                            realizedPnl: ledgerSummary.realizedPnl,
                            unrealizedPnl,
                            collectedFees: ledgerSummary.collectedFees,
                            unClaimedFees: fees.unclaimedFeesValue,
                            lastFeesCollectedAt:
                                ledgerSummary.lastFeesCollectedAt.getTime() === 0
                                    ? syncedPosition.positionOpenedAt
                                    : ledgerSummary.lastFeesCollectedAt,
                            priceRangeLower,
                            priceRangeUpper,
                        },
                        syncedPosition.positionOpenedAt
                    );

                    this.logger.info(
                        {
                            id,
                            currentValue: currentValue.toString(),
                            costBasis: ledgerSummary.costBasis.toString(),
                            unrealizedPnl: unrealizedPnl.toString(),
                            unClaimedFees: fees.unclaimedFeesValue.toString(),
                        },
                        "Position values calculated and updated after missing events sync"
                    );

                    // Re-fetch final position with all updates
                    const finalPosition = await this.findById(id);
                    return finalPosition ?? syncedPosition;
                } else {
                    this.logger.debug(
                        { id },
                        "No missing events found - proceeding with normal state checks"
                    );

                    // ========================================================================
                    // LAYER 2 - STEP 2A: LIQUIDITY CONSISTENCY CHECK
                    // ========================================================================
                    // Compare ledger's calculated liquidity with on-chain liquidity.
                    // If mismatch detected, it indicates missing events (likely due to
                    // Etherscan indexing lag). Force sync immediately without comparing
                    // other state fields.
                    // ========================================================================

                    this.logger.debug(
                        { id },
                        "Checking ledger liquidity consistency with on-chain state"
                    );

                    // Get last ledger event to extract calculated liquidity
                    const lastEvents = await this.ledgerService.findAllItems(id);
                    const lastLedgerEvent = lastEvents[0]; // Sorted DESC by timestamp
                    // Use typedConfig to get actual bigint values (not JSON-serialized strings)
                    const ledgerLiquidity = lastLedgerEvent?.typedConfig?.liquidityAfter ?? 0n;
                    const onChainLiquidity = updatedState.liquidity;

                    const liquidityMismatch = ledgerLiquidity !== onChainLiquidity;

                    if (liquidityMismatch) {
                        this.logger.warn(
                            {
                                id,
                                ledgerLiquidity: ledgerLiquidity.toString(),
                                onChainLiquidity: onChainLiquidity.toString(),
                                delta: (onChainLiquidity - ledgerLiquidity).toString(),
                            },
                            "Liquidity mismatch detected - missing events in ledger, forcing sync"
                        );

                        // Force incremental sync to catch missing events
                        const syncResult = await syncLedgerEvents(
                            {
                                positionId: id,
                                chainId,
                                nftId: BigInt(nftId),
                                forceFullResync: false,  // Incremental sync
                            },
                            {
                                prisma: this.prisma,
                                etherscanClient: this.etherscanClient,
                                evmBlockService: this.evmBlockService,
                                aprService: this.aprService,
                                logger: this.logger,
                                ledgerService: this.ledgerService,
                                poolPriceService: this.poolPriceService,
                            }
                        );

                        this.logger.info(
                            {
                                id,
                                eventsAdded: syncResult.eventsAdded,
                                fromBlock: syncResult.fromBlock.toString(),
                                finalizedBlock: syncResult.finalizedBlock.toString(),
                            },
                            "Ledger events synced successfully after liquidity mismatch"
                        );

                        // Skip full state comparison - sync already happened
                    } else {
                        this.logger.debug(
                            {
                                id,
                                liquidity: ledgerLiquidity.toString(),
                            },
                            "Ledger liquidity consistent with on-chain - proceeding to full state check"
                        );

                        // ========================================================================
                        // LAYER 2 - STEP 2B: FULL STATE COMPARISON
                        // ========================================================================
                        // Only runs if liquidity matches (no missing events).
                        // Checks all state fields to detect other types of changes.
                        // ========================================================================

                        // Check if on-chain state has changed (indicates new events)
                        // Use typedState to get actual bigint values (not JSON-serialized strings)
                        const existingState = existingPosition.typedState;
                        const stateChanged = (
                            updatedState.liquidity !== existingState.liquidity ||
                            updatedState.tokensOwed0 !== existingState.tokensOwed0 ||
                            updatedState.tokensOwed1 !== existingState.tokensOwed1 ||
                            updatedState.feeGrowthInside0LastX128 !== existingState.feeGrowthInside0LastX128 ||
                            updatedState.feeGrowthInside1LastX128 !== existingState.feeGrowthInside1LastX128
                        );

                        if (stateChanged) {
                            this.logger.info(
                                { id, chainId, nftId },
                                "Position state changed on-chain, triggering ledger event sync"
                            );

                            // Incremental sync from last event block
                            const syncResult = await syncLedgerEvents(
                                {
                                    positionId: id,
                                    chainId,
                                    nftId: BigInt(nftId),
                                    forceFullResync: false,  // Incremental sync
                                },
                                {
                                    prisma: this.prisma,
                                    etherscanClient: this.etherscanClient,
                                    evmBlockService: this.evmBlockService,
                                    aprService: this.aprService,
                                    logger: this.logger,
                                    ledgerService: this.ledgerService,
                                    poolPriceService: this.poolPriceService,
                                }
                            );

                            this.logger.info(
                                {
                                    id,
                                    eventsAdded: syncResult.eventsAdded,
                                    fromBlock: syncResult.fromBlock.toString(),
                                    finalizedBlock: syncResult.finalizedBlock.toString(),
                                },
                                "Ledger events synced successfully after state change detection"
                            );
                        } else {
                            this.logger.debug(
                                { id },
                                "No state changes detected, skipping ledger event sync"
                            );
                        }
                    } // End of liquidity consistency check else block
                } // End of missing events check else block

            // ========================================================================
            // SYNC POSITION STATE WITH LEDGER (PATH 2)
            // ========================================================================
            // After any syncLedgerEvents() calls above, we need to sync position.state
            // with the ledger's calculated liquidity and check for position closure.
            // This ensures the state saved to the database reflects the ledger.
            // ========================================================================

            this.logger.debug(
                { id },
                "Syncing position.state with ledger before saving (Path 2)"
            );

            // Get last ledger event to extract calculated liquidity
            const lastEventsBeforeSave = await this.ledgerService.findAllItems(id);
            const lastLedgerEventBeforeSave = lastEventsBeforeSave[0]; // Sorted DESC by timestamp

            // Track closure info separately
            let positionClosureInfo: { shouldClose: boolean; closedAt: Date } | null = null;

            if (lastLedgerEventBeforeSave) {
                // Use typedConfig to get actual bigint values (not JSON-serialized strings)
                const ledgerLiquidityBeforeSave = lastLedgerEventBeforeSave.typedConfig.liquidityAfter;

                // Update updatedState with ledger's liquidity (so it gets saved correctly)
                if (ledgerLiquidityBeforeSave !== updatedState.liquidity) {
                    this.logger.info(
                        {
                            id,
                            oldLiquidity: updatedState.liquidity.toString(),
                            newLiquidity: ledgerLiquidityBeforeSave.toString(),
                        },
                        "Updating updatedState.liquidity to match ledger before save"
                    );

                    updatedState.liquidity = ledgerLiquidityBeforeSave;
                }

                // Check for position closure
                const isLiquidityZero = ledgerLiquidityBeforeSave === 0n;
                const isLastEventCollect = lastLedgerEventBeforeSave.eventType === 'COLLECT';
                const isCurrentlyActive = existingPosition.isActive;

                if (isLiquidityZero && isLastEventCollect && isCurrentlyActive) {
                    const closedAt = lastLedgerEventBeforeSave.timestamp;

                    this.logger.info(
                        {
                            id,
                            closedAt: closedAt.toISOString(),
                            lastEventType: lastLedgerEventBeforeSave.eventType,
                        },
                        "Position fully closed - will mark as closed after state update"
                    );

                    // Store closure info to apply after state update
                    positionClosureInfo = { shouldClose: true, closedAt };
                }
            }

            // 5. Update database with new state
            const stateDB = this.serializeState(updatedState);

            log.dbOperation(this.logger, "update", "Position", {
                id,
                fields: ["state"],
            });

            const result = await this.prisma.position.update({
                where: { id },
                data: {
                    state: stateDB as object,
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

            // 6. Map database result to Position type
            const refreshedPosition = this.mapToPosition(
                result as any
            ) as UniswapV3Position;

            this.logger.info(
                {
                    id,
                    chainId,
                    nftId,
                    liquidity: updatedState.liquidity.toString(),
                },
                "Position state refreshed successfully"
            );

            // 6a. Apply position closure if detected
            if (positionClosureInfo?.shouldClose) {
                this.logger.info(
                    {
                        id,
                        closedAt: positionClosureInfo.closedAt.toISOString(),
                    },
                    "Marking position as closed"
                );

                await this.prisma.position.update({
                    where: { id },
                    data: {
                        isActive: false,
                        positionClosedAt: positionClosureInfo.closedAt,
                    },
                });
                // Note: in-memory state not updated - position will be re-read if needed
            }

            // 7. Recalculate and update common fields
            this.logger.debug(
                { positionId: id },
                "Recalculating position common fields"
            );

            // Refresh pool state to ensure accurate current price for calculations
            this.logger.debug(
                { poolId: refreshedPosition.pool.id },
                "Refreshing pool state to get current sqrtPriceX96 and tick"
            );

            const pool = await this.poolService.refresh(refreshedPosition.pool.id);

            this.logger.debug(
                {
                    poolId: pool.id,
                    sqrtPriceX96: pool.sqrtPriceX96.toString(),
                    currentTick: pool.state.currentTick
                },
                "Pool state refreshed with current on-chain price"
            );

            // Get ledger summary (cost basis, realized PnL, fees)
            const ledgerSummary = await this.getLedgerSummary(id);

            // Calculate current position value with refreshed state
            const currentValue = this.calculateCurrentPositionValue(
                refreshedPosition,
                pool
            );

            // Calculate unrealized PnL
            const unrealizedPnl = currentValue - ledgerSummary.costBasis;

            // Calculate unclaimed fees with refreshed state
            const fees = await this.calculateUnclaimedFees(
                refreshedPosition,
                pool
            );

            // Update position state with individual fee amounts (state is read-only)
            const refreshedTypedState = refreshedPosition.typedState;
            const feeUpdatedState: UniswapV3PositionState = {
                ...refreshedTypedState,
                unclaimedFees0: fees.unclaimedFees0,
                unclaimedFees1: fees.unclaimedFees1,
            };

            // Serialize and save updated state
            const feeUpdatedStateDB = this.serializeState(feeUpdatedState);
            await this.prisma.position.update({
                where: { id },
                data: { state: feeUpdatedStateDB as object },
            });

            // Price range is immutable, but recalculate for completeness
            const { priceRangeLower, priceRangeUpper } =
                this.calculatePriceRange(refreshedPosition, pool);

            // Update position with recalculated fields
            await this.updatePositionCommonFields(
                id,
                {
                    currentValue,
                    currentCostBasis: ledgerSummary.costBasis,
                    realizedPnl: ledgerSummary.realizedPnl,
                    unrealizedPnl,
                    collectedFees: ledgerSummary.collectedFees,
                    unClaimedFees: fees.unclaimedFeesValue,
                    lastFeesCollectedAt:
                        ledgerSummary.lastFeesCollectedAt.getTime() === 0
                            ? refreshedPosition.positionOpenedAt
                            : ledgerSummary.lastFeesCollectedAt,
                    priceRangeLower,
                    priceRangeUpper,
                },
                refreshedPosition.positionOpenedAt
            );

            this.logger.info(
                {
                    positionId: id,
                    currentValue: currentValue.toString(),
                    unrealizedPnl: unrealizedPnl.toString(),
                    unClaimedFees: fees.unclaimedFeesValue.toString(),
                },
                "Position common fields recalculated and updated"
            );

            log.methodExit(this.logger, "refresh", { id });

            // Re-fetch position with updated fields
            const finalPosition = await this.findById(id);
            return finalPosition ?? refreshedPosition;
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
                "Starting position reset - rediscovering ledger events from blockchain"
            );

            // 2. Rediscover all ledger events from blockchain
            // This automatically:
            // - Deletes events >= fromBlock (via syncLedgerEvents)
            // - Fetches fresh events from Etherscan
            // - Calculates PnL sequentially
            // - Triggers APR period calculation
            this.logger.info(
                { positionId: id },
                "Deleting old events and rediscovering from blockchain"
            );

            const syncResult = await syncLedgerEvents(
                {
                    positionId: id,
                    chainId: existingPosition.chainId,
                    nftId: BigInt(existingPosition.nftId),
                    forceFullResync: true,  // Full reset - resync from NFPM deployment
                },
                {
                    prisma: this.prisma,
                    etherscanClient: this.etherscanClient,
                    evmBlockService: this.evmBlockService,
                    aprService: this.aprService,
                    logger: this.logger,
                    ledgerService: this.ledgerService,
                    poolPriceService: this.poolPriceService,
                }
            );

            this.logger.info(
                {
                    positionId: id,
                    eventsAdded: syncResult.eventsAdded,
                    fromBlock: syncResult.fromBlock.toString(),
                    finalizedBlock: syncResult.finalizedBlock.toString(),
                },
                "Ledger events rediscovered and APR periods recalculated"
            );

            // 3. Refresh position state from on-chain data
            // This updates:
            // - Position state (liquidity, fees, owner)
            // - Current value
            // - Unrealized PnL (using fresh cost basis from ledger)
            // - Unclaimed fees
            this.logger.info(
                { positionId: id },
                "Refreshing position state from on-chain data"
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
                "Position reset complete - ledger rebuilt and state refreshed"
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
    // USER-PROVIDED DATA CREATION
    // ============================================================================

    /**
     * Create a Uniswap V3 position from user-provided data
     *
     * This method allows users to manually create a position after sending an
     * INCREASE_LIQUIDITY transaction on-chain. The user provides event data from
     * the transaction receipt, and the service creates the position with full
     * financial tracking via ledger events.
     *
     * Process:
     * 1. Check for existing position (idempotent)
     * 2. Discover/fetch pool
     * 3. Determine quote token (explicit or auto-detect)
     * 4. Create position with user-provided config and derived state
     * 5. Fetch historic pool price at event blockNumber
     * 6. Create INCREASE_POSITION ledger event with financial calculations
     * 7. Calculate and update position common fields
     * 8. Return fully populated position
     *
     * Minimizes on-chain calls:
     * - Pool discovery (if not cached)
     * - Historic pool price at blockNumber
     *
     * @param userId - User ID who owns this position
     * @param chainId - EVM chain ID where position exists
     * @param nftId - NFT token ID
     * @param input - User-provided position data and INCREASE_LIQUIDITY event
     * @returns The created position with full financial tracking
     * @throws Error if pool not found, chain not supported, or addresses invalid
     */
    async createPositionFromUserData(
        userId: string,
        chainId: number,
        nftId: number,
        input: {
            poolAddress: string;
            tickUpper: number;
            tickLower: number;
            ownerAddress: string;
            quoteTokenAddress?: string;
            increaseEvent: {
                timestamp: Date;
                blockNumber: bigint;
                transactionIndex: number;
                logIndex: number;
                transactionHash: string;
                liquidity: bigint;
                amount0: bigint;
                amount1: bigint;
            };
        }
    ): Promise<UniswapV3Position> {
        log.methodEntry(this.logger, "createPositionFromUserData", {
            userId,
            chainId,
            nftId,
        });

        try {
            // 1. Check if position already exists (idempotent)
            const positionHash = this.createPositionHash({
                chainId,
                nftId,
                poolAddress: input.poolAddress,
                tickLower: input.tickLower,
                tickUpper: input.tickUpper,
            });

            const existing = await this.findByPositionHash(
                userId,
                positionHash
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
                    "Position already exists, returning existing position"
                );
                log.methodExit(this.logger, "createPositionFromUserData", {
                    id: existing.id,
                    duplicate: true,
                });
                return existing as UniswapV3Position;
            }

            // 2. Verify chain is supported
            if (!this.evmConfig.isChainSupported(chainId)) {
                const error = new Error(
                    `Chain ${chainId} is not configured. Supported chains: ${this.evmConfig
                        .getSupportedChainIds()
                        .join(", ")}`
                );
                log.methodError(
                    this.logger,
                    "createPositionFromUserData",
                    error,
                    {
                        chainId,
                    }
                );
                throw error;
            }

            // 3. Validate and normalize addresses
            if (!isValidAddress(input.poolAddress)) {
                const error = new Error(
                    `Invalid pool address format: ${input.poolAddress}`
                );
                log.methodError(
                    this.logger,
                    "createPositionFromUserData",
                    error,
                    {
                        poolAddress: input.poolAddress,
                    }
                );
                throw error;
            }

            if (!isValidAddress(input.ownerAddress)) {
                const error = new Error(
                    `Invalid owner address format: ${input.ownerAddress}`
                );
                log.methodError(
                    this.logger,
                    "createPositionFromUserData",
                    error,
                    {
                        ownerAddress: input.ownerAddress,
                    }
                );
                throw error;
            }

            const poolAddress = normalizeAddress(input.poolAddress);
            const ownerAddress = normalizeAddress(input.ownerAddress);

            let normalizedQuoteAddress: string | undefined;
            if (input.quoteTokenAddress) {
                if (!isValidAddress(input.quoteTokenAddress)) {
                    const error = new Error(
                        `Invalid quote token address format: ${input.quoteTokenAddress}`
                    );
                    log.methodError(
                        this.logger,
                        "createPositionFromUserData",
                        error,
                        {
                            quoteTokenAddress: input.quoteTokenAddress,
                        }
                    );
                    throw error;
                }
                normalizedQuoteAddress = normalizeAddress(
                    input.quoteTokenAddress
                );
            }

            this.logger.debug(
                {
                    poolAddress,
                    ownerAddress,
                    quoteTokenAddress: normalizedQuoteAddress ?? "auto-detect",
                },
                "Addresses validated and normalized"
            );

            // 4. Discover pool
            const pool = await this.poolService.discover({
                poolAddress,
                chainId,
            });

            this.logger.debug(
                {
                    poolId: pool.id,
                    token0: pool.token0.symbol,
                    token1: pool.token1.symbol,
                },
                "Pool discovered/fetched"
            );

            // 5. Determine quote token
            let isToken0Quote: boolean;

            if (normalizedQuoteAddress) {
                // EXPLICIT MODE: User provided quoteTokenAddress
                const token0Matches =
                    compareAddresses(
                        pool.token0.address,
                        normalizedQuoteAddress
                    ) === 0;
                const token1Matches =
                    compareAddresses(
                        pool.token1.address,
                        normalizedQuoteAddress
                    ) === 0;

                if (!token0Matches && !token1Matches) {
                    const error = new Error(
                        `Quote token address ${normalizedQuoteAddress} does not match either pool token. ` +
                            `Pool token0: ${pool.token0.address}, token1: ${pool.token1.address}`
                    );
                    log.methodError(
                        this.logger,
                        "createPositionFromUserData",
                        error,
                        {
                            quoteTokenAddress: normalizedQuoteAddress,
                            poolToken0: pool.token0.address,
                            poolToken1: pool.token1.address,
                        }
                    );
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
                    "Quote token determined from caller input"
                );
            } else {
                // AUTO-DETECT MODE: Use QuoteTokenService
                this.logger.debug(
                    "Auto-detecting quote token using QuoteTokenService"
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
                    "Quote token auto-detected"
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
                "Token roles determined"
            );

            // 6. Create position config
            const config: UniswapV3PositionConfigData = {
                chainId,
                nftId,
                poolAddress,
                tickUpper: input.tickUpper,
                tickLower: input.tickLower,
            };

            // 7. Fetch fee growth inside at position creation block
            // This establishes the checkpoint - user only earns fees AFTER opening position
            this.logger.debug(
                {
                    poolAddress,
                    blockNumber: input.increaseEvent.blockNumber.toString(),
                    tickLower: input.tickLower,
                    tickUpper: input.tickUpper,
                },
                "Fetching fee growth inside at position creation block"
            );

            const client = this.evmConfig.getPublicClient(chainId);
            const blockNumber = input.increaseEvent.blockNumber;

            const [
                feeGrowthGlobal0X128,
                feeGrowthGlobal1X128,
                tickDataLower,
                tickDataUpper,
                poolSlot0,
            ] = await Promise.all([
                client.readContract({
                    address: poolAddress as Address,
                    abi: uniswapV3PoolAbi,
                    functionName: "feeGrowthGlobal0X128",
                    blockNumber,
                }) as Promise<bigint>,
                client.readContract({
                    address: poolAddress as Address,
                    abi: uniswapV3PoolAbi,
                    functionName: "feeGrowthGlobal1X128",
                    blockNumber,
                }) as Promise<bigint>,
                client.readContract({
                    address: poolAddress as Address,
                    abi: uniswapV3PoolAbi,
                    functionName: "ticks",
                    args: [input.tickLower],
                    blockNumber,
                }) as Promise<
                    readonly [
                        bigint,
                        bigint,
                        bigint,
                        bigint,
                        bigint,
                        bigint,
                        number,
                        boolean
                    ]
                >,
                client.readContract({
                    address: poolAddress as Address,
                    abi: uniswapV3PoolAbi,
                    functionName: "ticks",
                    args: [input.tickUpper],
                    blockNumber,
                }) as Promise<
                    readonly [
                        bigint,
                        bigint,
                        bigint,
                        bigint,
                        bigint,
                        bigint,
                        number,
                        boolean
                    ]
                >,
                client.readContract({
                    address: poolAddress as Address,
                    abi: uniswapV3PoolAbi,
                    functionName: "slot0",
                    blockNumber,
                }) as Promise<
                    readonly [
                        bigint,
                        number,
                        number,
                        number,
                        number,
                        number,
                        boolean
                    ]
                >,
            ]);

            const currentTick = poolSlot0[1];
            const feeGrowthOutsideLower0X128 = tickDataLower[2];
            const feeGrowthOutsideLower1X128 = tickDataLower[3];
            const feeGrowthOutsideUpper0X128 = tickDataUpper[2];
            const feeGrowthOutsideUpper1X128 = tickDataUpper[3];

            // Calculate fee growth inside at position creation
            const feeGrowthInside = computeFeeGrowthInside(
                currentTick,
                input.tickLower,
                input.tickUpper,
                feeGrowthGlobal0X128,
                feeGrowthGlobal1X128,
                feeGrowthOutsideLower0X128,
                feeGrowthOutsideLower1X128,
                feeGrowthOutsideUpper0X128,
                feeGrowthOutsideUpper1X128
            );

            this.logger.debug(
                {
                    feeGrowthInside0: feeGrowthInside.inside0.toString(),
                    feeGrowthInside1: feeGrowthInside.inside1.toString(),
                    currentTick,
                },
                "Fee growth inside calculated at position creation block"
            );

            // 8. Create position state from user input with correct fee checkpoints
            const state: UniswapV3PositionState = {
                ownerAddress,
                liquidity: input.increaseEvent.liquidity,
                feeGrowthInside0LastX128: feeGrowthInside.inside0, // Checkpoint at creation
                feeGrowthInside1LastX128: feeGrowthInside.inside1, // Checkpoint at creation
                tokensOwed0: 0n, // New position
                tokensOwed1: 0n, // New position
                unclaimedFees0: 0n, // Will be calculated after position creation
                unclaimedFees1: 0n,
            };

            this.logger.debug(
                {
                    ownerAddress: state.ownerAddress,
                    liquidity: state.liquidity.toString(),
                    feeGrowthInside0LastX128:
                        state.feeGrowthInside0LastX128.toString(),
                    feeGrowthInside1LastX128:
                        state.feeGrowthInside1LastX128.toString(),
                },
                "Position state initialized with fee growth checkpoints"
            );

            // 9. Create position via create() method
            const configDB = this.serializeConfig(config) as Record<string, unknown>;
            const stateDB = this.serializeState(state) as Record<string, unknown>;
            const createdPosition = await this.create({
                protocol: "uniswapv3",
                positionType: "CL_TICKS",
                userId,
                poolId: pool.id,
                isToken0Quote,
                config,
                state,
            }, configDB, stateDB);

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
                "Position created in database"
            );

            // 10. Fetch historic pool price at event blockNumber
            this.logger.debug(
                {
                    positionId: createdPosition.id,
                    blockNumber: input.increaseEvent.blockNumber.toString(),
                },
                "Fetching historic pool price at event blockNumber"
            );

            const poolPriceService = new (
                await import("../pool-price/uniswapv3-pool-price-service.js")
            ).UniswapV3PoolPriceService({
                prisma: this.prisma,
            });

            const poolPrice = await poolPriceService.discover(pool.id, {
                blockNumber: Number(input.increaseEvent.blockNumber),
            });

            this.logger.debug(
                {
                    positionId: createdPosition.id,
                    sqrtPriceX96: poolPrice.sqrtPriceX96.toString(),
                },
                "Historic pool price fetched"
            );

            // 11. Calculate pool price (quote per base) from historic sqrtPriceX96
            const sqrtPriceX96 = poolPrice.sqrtPriceX96;

            // Use the correct utility function that handles precision properly
            const poolPriceValue = calculatePoolPriceInQuoteToken(
                sqrtPriceX96,
                isToken0Quote,
                pool.token0.decimals,
                pool.token1.decimals
            );

            this.logger.debug(
                {
                    positionId: createdPosition.id,
                    poolPrice: poolPriceValue.toString(),
                    quoteToken: quoteToken.symbol,
                    baseToken: baseToken.symbol,
                },
                "Pool price calculated from historic sqrtPriceX96"
            );

            // 12. Calculate token value in quote units
            const token0Amount = input.increaseEvent.amount0;
            const token1Amount = input.increaseEvent.amount1;

            // Use the utility function that correctly handles the conversion
            const tokenValue = calculateTokenValueInQuote(
                token0Amount,
                token1Amount,
                sqrtPriceX96,
                isToken0Quote,
                pool.token0.decimals,
                pool.token1.decimals
            );

            this.logger.debug(
                {
                    positionId: createdPosition.id,
                    tokenValue: tokenValue.toString(),
                },
                "Token value calculated in quote units"
            );

            // 13. Create initial sync state with user-provided event as missing event
            // This handles indexer lag - the event will be processed by refresh()
            this.logger.debug(
                { positionId: createdPosition.id },
                "Creating initial sync state with user-provided INCREASE event"
            );

            const { UniswapV3PositionSyncState } = await import(
                "../position-ledger/position-sync-state.js"
            );

            const syncState = await UniswapV3PositionSyncState.load(
                this.prisma,
                createdPosition.id
            );

            syncState.addMissingEvent({
                eventType: "INCREASE_LIQUIDITY",
                timestamp: input.increaseEvent.timestamp.toISOString(),
                blockNumber: input.increaseEvent.blockNumber.toString(),
                transactionIndex: input.increaseEvent.transactionIndex,
                logIndex: input.increaseEvent.logIndex,
                transactionHash: input.increaseEvent.transactionHash,
                liquidity: input.increaseEvent.liquidity.toString(),
                amount0: input.increaseEvent.amount0.toString(),
                amount1: input.increaseEvent.amount1.toString(),
            });

            await syncState.save(this.prisma, "position-create");

            this.logger.info(
                {
                    positionId: createdPosition.id,
                    eventType: "INCREASE_LIQUIDITY",
                    transactionHash: input.increaseEvent.transactionHash,
                },
                "Initial INCREASE_LIQUIDITY event stored as missing event"
            );

            // 14. Call refresh() to process missing event and sync from blockchain
            // refresh() will:
            // - Process the missing INCREASE_LIQUIDITY event → create INCREASE_POSITION ledger event
            // - Sync any additional events from blockchain (COLLECT, DECREASE)
            // - Calculate position value, cost basis, PnL, fees
            // - Update all position fields
            this.logger.debug(
                { positionId: createdPosition.id },
                "Calling refresh() to process missing event and sync blockchain events"
            );

            const refreshedPosition = await this.refresh(createdPosition.id);

            this.logger.info(
                {
                    positionId: refreshedPosition.id,
                    currentValue: refreshedPosition.currentValue.toString(),
                    costBasis: refreshedPosition.currentCostBasis.toString(),
                    unrealizedPnl: refreshedPosition.unrealizedPnl.toString(),
                },
                "Position created and refreshed successfully"
            );

            log.methodExit(this.logger, "createPositionFromUserData", {
                id: refreshedPosition.id,
                duplicate: false,
            });

            return refreshedPosition;
        } catch (error) {
            // Only log if not already logged
            if (
                !(
                    error instanceof Error &&
                    (error.message.includes("Invalid") ||
                        error.message.includes("Chain") ||
                        error.message.includes("Quote token") ||
                        error.message.includes("already exists"))
                )
            ) {
                log.methodError(
                    this.logger,
                    "createPositionFromUserData",
                    error as Error,
                    {
                        userId,
                        chainId,
                        nftId,
                    }
                );
            }
            throw error;
        }
    }

    /**
     * Update an existing position by adding new events from user-provided data
     *
     * This method:
     * 1. Validates ownership (returns null if position doesn't exist or not owned by user)
     * 2. Adds events to the position ledger (events must come AFTER existing events)
     * 3. Refreshes position state with new financial calculations
     * 4. Returns fully populated position with updated PnL, fees, etc.
     *
     * Security: Returns null for both "not found" and "not owned" cases to prevent
     * information leakage about other users' positions.
     *
     * @param userId - ID of the user who owns the position
     * @param chainId - Chain ID where the position exists
     * @param nftId - NFT token ID of the position
     * @param events - Array of events to add (INCREASE_LIQUIDITY, DECREASE_LIQUIDITY, COLLECT)
     * @returns The updated position, or null if position not found or not owned by user
     *
     * @throws Error if events are invalid (ordering, validation, etc.)
     *
     * @example
     * ```typescript
     * const position = await service.updatePositionWithEvents(
     *   'user-123',
     *   1,
     *   42,
     *   [{
     *     eventType: 'COLLECT',
     *     timestamp: new Date('2025-01-15T10:30:00Z'),
     *     blockNumber: 12345678n,
     *     transactionIndex: 5,
     *     logIndex: 2,
     *     transactionHash: '0x...',
     *     tokenId: 42n,
     *     amount0: 1000000n,
     *     amount1: 500000000000000000n,
     *     recipient: '0x...',
     *   }]
     * );
     *
     * if (!position) {
     *   // Position not found or not owned by user
     *   return res.status(404).json({ error: 'Position not found' });
     * }
     * ```
     */
    async updatePositionWithEvents(
        userId: string,
        chainId: number,
        nftId: number,
        events: Array<{
            eventType: "INCREASE_LIQUIDITY" | "DECREASE_LIQUIDITY" | "COLLECT";
            timestamp: Date;
            blockNumber: bigint;
            transactionIndex: number;
            logIndex: number;
            transactionHash: string;
            tokenId: bigint;
            liquidity?: bigint;
            amount0: bigint;
            amount1: bigint;
            recipient?: string;
        }>
    ): Promise<UniswapV3Position | null> {
        log.methodEntry(this.logger, "updatePositionWithEvents", {
            userId,
            chainId,
            nftId,
            eventCount: events.length,
        });

        try {
            // 1. Find position by chainId and nftId
            const positionHash = this.createPositionHash({
                chainId,
                nftId,
                poolAddress: "0x0000000000000000000000000000000000000000", // Not used in hash
                tickLower: 0, // Not used in hash
                tickUpper: 0, // Not used in hash
            });

            log.dbOperation(this.logger, "findUnique", "Position", {
                userId,
                chainId,
                nftId,
                positionHash,
            });

            const existingPosition = await this.prisma.position.findUnique({
                where: {
                    userId_positionHash: { userId, positionHash },
                },
                include: { pool: true },
            });

            // Return null if not found (ownership now enforced by composite unique key)
            if (!existingPosition) {
                this.logger.info(
                    { userId, chainId, nftId },
                    "Position not found for user"
                );
                log.methodExit(this.logger, "updatePositionWithEvents", {
                    result: "not_found",
                });
                return null;
            }

            this.logger.debug(
                { positionId: existingPosition.id, userId, chainId, nftId },
                "Position found for user"
            );

            // 2. Add events to ledger
            this.logger.info(
                { positionId: existingPosition.id, eventCount: events.length },
                "Adding events to position ledger"
            );

            await this.ledgerService.addEventsFromUserData(
                existingPosition.id,
                events
            );

            this.logger.info(
                { positionId: existingPosition.id, eventCount: events.length },
                "Events added successfully"
            );

            // 3. Refresh position state
            this.logger.info(
                { positionId: existingPosition.id },
                "Refreshing position state"
            );

            const updatedPosition = await this.refresh(existingPosition.id);

            this.logger.info(
                {
                    positionId: existingPosition.id,
                    liquidity: updatedPosition.liquidity.toString(),
                    realizedPnl: updatedPosition.realizedPnl.toString(),
                    unrealizedPnl: updatedPosition.unrealizedPnl.toString(),
                },
                "Position refreshed with new state"
            );

            log.methodExit(this.logger, "updatePositionWithEvents", {
                positionId: existingPosition.id,
                eventsAdded: events.length,
            });

            return updatedPosition;
        } catch (error) {
            log.methodError(
                this.logger,
                "updatePositionWithEvents",
                error as Error,
                {
                    userId,
                    chainId,
                    nftId,
                    eventCount: events.length,
                }
            );
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
        stateDB: Record<string, unknown>
    ): Promise<UniswapV3Position> {
        log.methodEntry(this.logger, "create", {
            userId: input.userId,
            chainId: input.config.chainId,
            nftId: input.config.nftId,
        });

        try {
            // Check for existing position by positionHash (fast indexed lookup)
            const positionHash = this.createPositionHash(input.config as unknown as Record<string, unknown>);
            const existing = await this.findByPositionHash(
                input.userId,
                positionHash
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
                    "Position already exists, returning existing position"
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
            const zeroValue = '0';

            log.dbOperation(this.logger, 'create', 'Position', {
                protocol: input.protocol,
                positionType: input.positionType,
                userId: input.userId,
                positionHash,
            });

            // Wrap position creation + event publishing in a transaction for atomicity
            const result = await this.prisma.$transaction(async (tx) => {
                // 1. Create the position
                const positionRow = await tx.position.create({
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

                // 2. Map to position entity and publish position.created event
                const createdPosition = this.mapToPosition(positionRow as PositionDbResult);

                const event = createDomainEvent({
                    type: 'position.created',
                    entityType: 'position',
                    entityId: createdPosition.id,
                    userId: input.userId,
                    payload: createdPosition.toJSON(),
                    source: 'api',
                });

                await this.eventPublisher.publish(event, tx);

                this.logger.debug(
                    { eventId: event.id, positionId: createdPosition.id },
                    'Position created event published to outbox'
                );

                return positionRow;
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
                'Position created'
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
                    "Position found but is not uniswapv3 protocol"
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
                    "Position not found, delete operation is no-op"
                );
                log.methodExit(this.logger, "delete", { id, deleted: false });
                return;
            }

            // Verify protocol type
            if (existing.protocol !== "uniswapv3") {
                const error = new Error(
                    `Cannot delete position ${id}: expected protocol 'uniswapv3', got '${existing.protocol}'`
                );
                log.methodError(this.logger, "delete", error, {
                    id,
                    protocol: existing.protocol,
                });
                throw error;
            }

            // Delete the position
            log.dbOperation(this.logger, 'delete', 'Position', { id });
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
     * Get ledger summary for a position
     *
     * Fetches the latest ledger event and extracts financial summary data.
     *
     * @param positionId - Position database ID
     * @returns Summary object with cost basis, PnL, and fee data
     */
    private async getLedgerSummary(positionId: string): Promise<{
        costBasis: bigint;
        realizedPnl: bigint;
        collectedFees: bigint;
        lastFeesCollectedAt: Date;
    }> {
        try {
            // Fetch all ledger events (sorted descending by timestamp)
            const events = await this.ledgerService.findAllItems(positionId);

            if (events.length === 0) {
                // No events yet - position just created
                return {
                    costBasis: 0n,
                    realizedPnl: 0n,
                    collectedFees: 0n,
                    lastFeesCollectedAt: new Date(0), // Epoch time signals no collections yet
                };
            }

            // Get most recent event using ledger service helper
            const latestEvent = await this.ledgerService.getMostRecentEvent(positionId);
            if (!latestEvent) {
                throw new Error(`Expected to find events but got null`);
            }

            // Sum all COLLECT event rewards for collected fees
            let collectedFees = 0n;
            let lastFeesCollectedAt: Date | null = null;

            for (const event of events) {
                if (event.eventType === "COLLECT") {
                    // Sum up all reward values (already in quote token)
                    for (const reward of event.rewards) {
                        collectedFees += reward.tokenValue;
                    }
                    // Track most recent collection timestamp
                    // (even for empty collects, as they update fee growth checkpoints)
                    if (
                        !lastFeesCollectedAt ||
                        event.timestamp > lastFeesCollectedAt
                    ) {
                        lastFeesCollectedAt = event.timestamp;
                    }
                }
            }

            return {
                costBasis: latestEvent.costBasisAfter,
                realizedPnl: latestEvent.pnlAfter,
                collectedFees,
                lastFeesCollectedAt: lastFeesCollectedAt ?? new Date(0), // Epoch time signals no collections yet
            };
        } catch (error) {
            this.logger.warn(
                { error, positionId },
                "Failed to get ledger summary, using defaults"
            );
            return {
                costBasis: 0n,
                realizedPnl: 0n,
                collectedFees: 0n,
                lastFeesCollectedAt: new Date(0), // Epoch time signals no collections yet
            };
        }
    }

    /**
     * Calculate unclaimed fees for a position
     *
     * Delegates to the helper function in position-calculations.ts which implements
     * the complete 3-part fee calculation:
     * 1. Incremental fees (from feeGrowthInside)
     * 2. Checkpointed fees (from tokensOwed*)
     * 3. Principal separation (subtract uncollectedPrincipal from tokensOwed)
     *
     * @param position - Position object with config and state
     * @param pool - Pool object with current state
     * @returns Unclaimed fees result with quote value and individual token amounts
     */
    private async calculateUnclaimedFees(
        position: UniswapV3Position,
        pool: UniswapV3Pool
    ): Promise<UnclaimedFeesResult> {
        return calculateUnclaimedFees(
            position,
            pool,
            this.evmConfig,
            this.ledgerService,
            this.logger
        );
    }

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
        pool: UniswapV3Pool
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
            baseIsToken0
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
        pool: UniswapV3Pool
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
            baseTokenDecimals
        );

        const priceRangeUpper = tickToPrice(
            tickUpper,
            baseTokenAddress,
            quoteTokenAddress,
            baseTokenDecimals
        );

        return { priceRangeLower, priceRangeUpper };
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
        positionOpenedAt: Date
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
            positionOpenedAt
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
                totalApr: totalApr?.toFixed(2) ?? 'null (below threshold)',
            },
            "Position common fields updated with APR"
        );
    }

    // ============================================================================
    // HELPER METHODS - POSITION LOOKUP
    // ============================================================================

    /**
     * Get current liquidity from the most recent ledger event
     *
     * The ledger is the source of truth for liquidity as it tracks all INCREASE/DECREASE events.
     * This method queries the last ledger event's `liquidityAfter` field to determine the
     * current liquidity state without making on-chain calls.
     *
     * @param positionId - Position ID
     * @returns Current liquidity (0n if no events exist or position is closed)
     */
    public async getCurrentLiquidityFromLedger(
        positionId: string
    ): Promise<bigint> {
        const lastEvent = await this.prisma.positionLedgerEvent.findFirst({
            where: { positionId },
            orderBy: { timestamp: "desc" },
            select: { config: true },
        });

        if (!lastEvent) {
            // No events yet, position has no liquidity
            this.logger.debug(
                { positionId },
                "No ledger events found, returning liquidity = 0"
            );
            return 0n;
        }

        // Parse the config to get liquidityAfter
        const config = lastEvent.config as { liquidityAfter?: string };
        const liquidityAfter = config.liquidityAfter
            ? BigInt(config.liquidityAfter)
            : 0n;

        this.logger.debug(
            { positionId, liquidityAfter: liquidityAfter.toString() },
            "Retrieved liquidity from last ledger event"
        );

        return liquidityAfter;
    }

    /**
     * Get position close timestamp if position is fully closed
     *
     * A position is considered fully closed when:
     * 1. Liquidity = 0 (all liquidity removed)
     * 2. Last event is COLLECT (tokens withdrawn)
     * 3. All principal collected (uncollectedPrincipal0After = 0 && uncollectedPrincipal1After = 0)
     *
     * This prevents false positives where a position has L=0 after DECREASE_LIQUIDITY
     * but is still waiting for the final COLLECT event.
     *
     * @param positionId - Position ID
     * @returns Timestamp of the closing COLLECT event, or null if position is not fully closed
     */
    public async getPositionCloseTimestamp(
        positionId: string
    ): Promise<Date | null> {
        const lastEvent = await this.prisma.positionLedgerEvent.findFirst({
            where: { positionId },
            orderBy: { timestamp: "desc" },
            select: { eventType: true, timestamp: true, config: true },
        });

        if (!lastEvent) {
            this.logger.debug(
                { positionId },
                "No ledger events found, position not closed"
            );
            return null;
        }

        // Position is only closed if last event is COLLECT
        if (lastEvent.eventType !== "COLLECT") {
            this.logger.debug(
                { positionId, lastEventType: lastEvent.eventType },
                "Last event is not COLLECT, position not closed"
            );
            return null;
        }

        // Check if all principal has been collected
        const config = lastEvent.config as {
            uncollectedPrincipal0After?: string;
            uncollectedPrincipal1After?: string;
        };

        const uncollectedPrincipal0After = config.uncollectedPrincipal0After
            ? BigInt(config.uncollectedPrincipal0After)
            : 0n;
        const uncollectedPrincipal1After = config.uncollectedPrincipal1After
            ? BigInt(config.uncollectedPrincipal1After)
            : 0n;

        // Position is only fully closed if all principal has been collected
        if (
            uncollectedPrincipal0After === 0n &&
            uncollectedPrincipal1After === 0n
        ) {
            this.logger.debug(
                { positionId, closedAt: lastEvent.timestamp },
                "Position is fully closed (final COLLECT with all principal withdrawn)"
            );
            return lastEvent.timestamp;
        }

        this.logger.debug(
            {
                positionId,
                uncollectedPrincipal0After:
                    uncollectedPrincipal0After.toString(),
                uncollectedPrincipal1After:
                    uncollectedPrincipal1After.toString(),
            },
            "Position has uncollected principal, not fully closed"
        );
        return null;
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
     * @param positionHash - Position hash (generated by createPositionHash)
     * @returns Position if found, null otherwise
     */
    async findByPositionHash(userId: string, positionHash: string): Promise<UniswapV3Position | null> {
        log.methodEntry(this.logger, 'findByPositionHash', { userId, positionHash });

        try {
            log.dbOperation(this.logger, 'findFirst', 'Position', { userId, positionHash });

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
                log.methodExit(this.logger, 'findByPositionHash', { userId, positionHash, found: false });
                return null;
            }

            // Map to Position type
            const position = this.mapToPosition(result as PositionDbResult);

            log.methodExit(this.logger, 'findByPositionHash', { userId, positionHash, found: true });
            return position as UniswapV3Position;
        } catch (error) {
            log.methodError(this.logger, 'findByPositionHash', error as Error, { userId, positionHash });
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
    async update(id: string, input: UpdateAnyPositionInput): Promise<UniswapV3Position> {
        log.methodEntry(this.logger, 'update', { id, input });

        try {
            // Currently, UpdateAnyPositionInput has no mutable fields
            // All updates should use refresh() method for state updates
            const data: Record<string, unknown> = {};

            log.dbOperation(this.logger, 'update', 'Position', {
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

            log.methodExit(this.logger, 'update', { id });
            return position as UniswapV3Position;
        } catch (error) {
            log.methodError(this.logger, 'update', error as Error, { id });
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
        const pool = PoolFactory.fromDB(poolRow, token0, token1) as UniswapV3Pool;

        // Convert string bigint fields to native bigint
        const rowWithBigInt: PositionRow = {
            id: dbResult.id,
            positionHash: dbResult.positionHash ?? '',
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
