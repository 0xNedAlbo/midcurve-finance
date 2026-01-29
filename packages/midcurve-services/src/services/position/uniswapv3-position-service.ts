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
    getNfpmDeploymentBlock,
    UNISWAP_V3_POSITION_MANAGER_ABI,
} from "../../config/uniswapv3.js";
import { normalizeAddress } from "@midcurve/shared";
import { UniswapV3PoolService } from "../pool/uniswapv3-pool-service.js";
import type { PrismaTransactionClient } from "../../clients/prisma/index.js";
import { EtherscanClient } from "../../clients/etherscan/index.js";
import { UniswapV3QuoteTokenService } from "../quote-token/uniswapv3-quote-token-service.js";
import { EvmBlockService } from "../block/evm-block-service.js";
import { UniswapV3PoolPriceService } from "../pool-price/uniswapv3-pool-price-service.js";
import {
    UniswapV3LedgerEventService,
    UNISWAP_V3_POSITION_EVENT_SIGNATURES,
    type RawLogInput,
} from "../position-ledger/uniswapv3-ledger-event-service.js";
import type { Address, PublicClient } from "viem";
import { calculatePositionValue } from "@midcurve/shared";
import { tickToPrice } from "@midcurve/shared";
import { calculateUnclaimedFeeAmounts } from "@midcurve/shared";
import { calculateTokenValueInQuote } from "../../utils/uniswapv3/ledger-calculations.js";
import { CacheService } from "../cache/cache-service.js";

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

// ============================================================================
// ON-CHAIN POSITION STATE (for caching)
// ============================================================================

/** Zero address constant */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * On-chain position state from NFPM contract
 * Combines data from positions() and ownerOf() calls
 */
export interface OnChainPositionState {
    /** Block number when this state was fetched */
    blockNumber: bigint;
    /** Whether the NFT has been burned */
    isBurned: boolean;
    /** Owner address from ownerOf() - zero address if burned */
    ownerAddress: string;
    /** Operator address from positions() - zero address if burned */
    operator: string;
    /** Current liquidity - 0n if burned */
    liquidity: bigint;
    /** Fee growth inside for token0 - 0n if burned */
    feeGrowthInside0LastX128: bigint;
    /** Fee growth inside for token1 - 0n if burned */
    feeGrowthInside1LastX128: bigint;
    /** Uncollected fees/principal for token0 - 0n if burned */
    tokensOwed0: bigint;
    /** Uncollected fees/principal for token1 - 0n if burned */
    tokensOwed1: bigint;
}

/** Serialized version for cache (bigints as strings) */
interface OnChainPositionStateCached {
    blockNumber: string;
    isBurned: boolean;
    ownerAddress: string;
    operator: string;
    liquidity: string;
    feeGrowthInside0LastX128: string;
    feeGrowthInside1LastX128: string;
    tokensOwed0: string;
    tokensOwed1: string;
}

function serializeOnChainState(
    state: OnChainPositionState,
): OnChainPositionStateCached {
    return {
        blockNumber: state.blockNumber.toString(),
        isBurned: state.isBurned,
        ownerAddress: state.ownerAddress,
        operator: state.operator,
        liquidity: state.liquidity.toString(),
        feeGrowthInside0LastX128: state.feeGrowthInside0LastX128.toString(),
        feeGrowthInside1LastX128: state.feeGrowthInside1LastX128.toString(),
        tokensOwed0: state.tokensOwed0.toString(),
        tokensOwed1: state.tokensOwed1.toString(),
    };
}

function deserializeOnChainState(
    cached: OnChainPositionStateCached,
): OnChainPositionState {
    return {
        blockNumber: BigInt(cached.blockNumber),
        isBurned: cached.isBurned,
        ownerAddress: cached.ownerAddress,
        operator: cached.operator,
        liquidity: BigInt(cached.liquidity),
        feeGrowthInside0LastX128: BigInt(cached.feeGrowthInside0LastX128),
        feeGrowthInside1LastX128: BigInt(cached.feeGrowthInside1LastX128),
        tokensOwed0: BigInt(cached.tokensOwed0),
        tokensOwed1: BigInt(cached.tokensOwed1),
    };
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
     * Pool price service for historic price discovery at ledger event blocks
     * If not provided, a new UniswapV3PoolPriceService instance will be created
     */
    poolPriceService?: UniswapV3PoolPriceService;

    /**
     * Cache service for distributed caching
     * If not provided, the singleton CacheService instance will be used
     */
    cacheService?: CacheService;
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
    private readonly _quoteTokenService: UniswapV3QuoteTokenService;
    private readonly _evmBlockService: EvmBlockService;
    private readonly _poolPriceService: UniswapV3PoolPriceService;
    private readonly _cacheService: CacheService;

    /**
     * Creates a new UniswapV3PositionService instance
     *
     * @param dependencies - Optional dependencies object
     * @param dependencies.prisma - Prisma client instance (creates default if not provided)
     * @param dependencies.eventPublisher - Domain event publisher (uses singleton if not provided)
     * @param dependencies.evmConfig - EVM configuration instance (uses singleton if not provided)
     * @param dependencies.poolService - UniswapV3 pool service (creates default if not provided)
     * @param dependencies.etherscanClient - Etherscan client instance (uses singleton if not provided)
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
        this._quoteTokenService =
            dependencies.quoteTokenService ??
            new UniswapV3QuoteTokenService({ prisma: this._prisma });
        this._evmBlockService =
            dependencies.evmBlockService ??
            new EvmBlockService({ evmConfig: this._evmConfig });
        this._poolPriceService =
            dependencies.poolPriceService ??
            new UniswapV3PoolPriceService({ prisma: this._prisma });
        this._cacheService =
            dependencies.cacheService ?? CacheService.getInstance();
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
            operator?: string;
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
            isBurned?: boolean;
            isClosed?: boolean;
        };

        return {
            ownerAddress: db.ownerAddress,
            operator: db.operator ?? "",
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
            isBurned: db.isBurned ?? false,
            isClosed: db.isClosed ?? false,
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
            operator: state.operator,
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
            isBurned: state.isBurned,
            isClosed: state.isClosed,
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
     * TODO: Reimplement this method - it was removed during deprecated ledger service cleanup.
     * Previous implementation relied on position-ledger-deprecated which has been deleted.
     *
     * @param userId - User ID who owns this position
     * @param params - Discovery parameters { chainId, nftId, quoteTokenAddress? }
     * @returns The discovered or existing position
     */
    async discover(
        userId: string,
        params: UniswapV3PositionDiscoverInput,
    ): Promise<UniswapV3Position> {
        // TODO: Reimplement discover() method
        // Previously used:
        // - syncLedgerEvents from position-ledger-deprecated/helpers/uniswapv3/ledger-sync.js
        // - this.ledgerService (UniswapV3PositionLedgerService) for getMostRecentEvent()
        // - getLedgerSummary helper that also used the deprecated ledger service
        throw new Error(
            `discover() is not yet implemented. userId=${userId}, chainId=${params.chainId}, nftId=${params.nftId}`,
        );
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
        blockNumber: number | "latest" = "latest",
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3Position> {
        log.methodEntry(this.logger, "refresh", { id, blockNumber });

        try {
            // Refresh all position state by calling individual refresh methods in order
            // Each method reads fresh on-chain data and persists it to the database

            // 0. Get position to determine pool ID
            const position = await this.findById(id);
            if (!position) {
                throw new Error(`Position not found: ${id}`);
            }

            // 1. Early exit for burned positions - no refresh needed
            const currentState = position.typedState;
            if (currentState.isBurned) {
                this.logger.info(
                    { id, isBurned: currentState.isBurned },
                    "Skipping refresh for burned position",
                );
                log.methodExit(this.logger, "refresh", { id, skipped: true });
                return position;
            }

            // 2. Fetch on-chain position state (with caching) to get resolved block number
            // This ensures all refresh* methods read from the same block for consistency
            const { chainId, nftId } = position.typedConfig;
            const onChainState = await this.fetchPositionState(
                chainId,
                nftId,
                blockNumber,
            );

            // 2.1 Handle burned NFT detected by fetchPositionState
            if (onChainState.isBurned) {
                const burnedPosition = await this.transitionToBurnedState(
                    id,
                    position,
                    dbTx,
                );
                log.methodExit(this.logger, "refresh", { id, burned: true });
                return burnedPosition;
            }

            // 2.2 Early exit for truly closed positions (no liquidity, no owed tokens)
            if (
                currentState.isClosed &&
                onChainState.liquidity === 0n &&
                onChainState.tokensOwed0 === 0n &&
                onChainState.tokensOwed1 === 0n
            ) {
                this.logger.info(
                    { id },
                    "Position is closed and has no on-chain activity - skipping refresh",
                );
                log.methodExit(this.logger, "refresh", { id, skipped: true });
                return position;
            }

            // 2.3 Handle reopened position (was closed but now has liquidity or owed tokens)
            if (currentState.isClosed) {
                await this.transitionFromClosedState(id, dbTx);
            }

            // 2.4 Extract resolved block number for consistent state reads
            const resolvedBlockNumber = Number(onChainState.blockNumber);

            // 3. Refresh owner address (may have been transferred)
            await this.refreshOwnerAddress(id, resolvedBlockNumber, dbTx);

            // 4. Refresh liquidity
            await this.refreshLiquidity(id, resolvedBlockNumber, dbTx);

            // 5. Refresh fee state (tokensOwed, feeGrowthInside, unclaimed fees)
            await this.refreshFeeState(id, resolvedBlockNumber, dbTx);

            // 6. Refresh metrics (common fields: value, PnL, fees, price range)
            await this.refreshMetrics(id, dbTx);

            // 7. Check if position should be marked as closed
            const refreshedPosition = await this.findById(id);
            if (!refreshedPosition) {
                const error = new Error(
                    `Position not found after refresh: ${id}`,
                );
                log.methodError(this.logger, "refresh", error, { id });
                throw error;
            }

            // 7.1 Detect closed position (no liquidity, no owed tokens)
            const refreshedState = refreshedPosition.typedState;
            if (
                !refreshedState.isClosed &&
                refreshedState.liquidity === 0n &&
                refreshedState.tokensOwed0 === 0n &&
                refreshedState.tokensOwed1 === 0n
            ) {
                // Get last COLLECT event timestamp for positionClosedAt
                const ledgerService = new UniswapV3LedgerEventService(
                    { positionId: id },
                    { prisma: this._prisma },
                );
                const lastCollect = await ledgerService.fetchLastCollectEvent(
                    "latest",
                    dbTx,
                );
                const closedAt =
                    lastCollect?.timestamp ??
                    refreshedPosition.positionOpenedAt;

                this.logger.info(
                    {
                        id,
                        closedAt: closedAt.toISOString(),
                    },
                    "Position fully closed - marking as closed",
                );

                await this.updateClosedState(id, false, true, closedAt, dbTx);

                // Re-fetch to get updated state
                const closedPosition = await this.findById(id);
                if (!closedPosition) {
                    throw new Error(
                        `Position not found after close update: ${id}`,
                    );
                }
                log.methodExit(this.logger, "refresh", { id, closed: true });
                return closedPosition;
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
     * 1. Deleting all existing ledger events
     * 2. Fetching all events via eth_getLogs RPC
     * 3. Batch importing events with aggregate recalculation
     * 4. Refreshing position state from NFT contract
     *
     * @param id - Position ID
     * @param dbTx - Optional Prisma transaction client for atomic operations
     * @returns Position with completely rebuilt ledger and refreshed state
     * @throws Error if position not found
     * @throws Error if chain is not supported
     * @throws Error if RPC fetch fails
     */
    async reset(
        id: string,
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3Position> {
        log.methodEntry(this.logger, "reset", { id });

        try {
            // 1. Verify position exists and get its config
            const existingPosition = await this.findById(id);

            if (!existingPosition) {
                const error = new Error(`Position not found: ${id}`);
                log.methodError(this.logger, "reset", error, { id });
                throw error;
            }

            const chainId = existingPosition.chainId;
            const nftId = BigInt(existingPosition.nftId);

            this.logger.info(
                { positionId: id, chainId, nftId: nftId.toString() },
                "Starting position reset - rebuilding ledger from RPC",
            );

            // 2. Get NFPM address and deployment block for this chain
            const nfpmAddress = getPositionManagerAddress(chainId);
            const deploymentBlock = getNfpmDeploymentBlock(chainId);

            // 3. Get viem public client for RPC calls
            const client = this.evmConfig.getPublicClient(chainId);

            // 4. Create ledger event service for this position
            const ledgerEventService = new UniswapV3LedgerEventService(
                { positionId: id },
                { prisma: this._prisma },
            );

            // 5. Delete all existing ledger events
            const deletedCount = await ledgerEventService.deleteAll(dbTx);
            this.logger.info(
                { positionId: id, deletedCount },
                "Deleted all existing ledger events",
            );

            // 6. Fetch all events from NFPM deployment block to latest via eth_getLogs
            const logs = await this.fetchAllPositionLogs(
                client,
                nfpmAddress,
                nftId,
                deploymentBlock,
            );

            this.logger.info(
                { positionId: id, logCount: logs.length },
                "Fetched position logs via RPC",
            );

            // 7. Import logs (handles out-of-order, calculates aggregates)
            if (logs.length > 0) {
                const importResult =
                    await ledgerEventService.importLogsForPosition(
                        existingPosition,
                        chainId,
                        logs,
                        this.poolPriceService,
                        dbTx,
                    );

                const insertedCount = importResult.results.filter(
                    (r) => r.action === "inserted",
                ).length;
                const skippedCount = importResult.results.filter(
                    (r) => r.action === "skipped",
                ).length;

                this.logger.info(
                    {
                        positionId: id,
                        inserted: insertedCount,
                        skipped: skippedCount,
                        aggregates: {
                            liquidityAfter:
                                importResult.aggregates.liquidityAfter.toString(),
                            costBasisAfter:
                                importResult.aggregates.costBasisAfter.toString(),
                            realizedPnlAfter:
                                importResult.aggregates.realizedPnlAfter.toString(),
                        },
                    },
                    "Imported ledger events from logs",
                );
                // APR periods are persisted internally by the ledger service
            }

            // 8. Refresh position state from on-chain data
            this.logger.info(
                { positionId: id },
                "Refreshing position state from on-chain data",
            );

            const refreshedPosition = await this.refresh(id, "latest", dbTx);

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

    /**
     * Fetch on-chain position state with block-based caching
     *
     * Fetches position data from NFPM contract (positions() + ownerOf())
     * with caching to reduce RPC calls. Cache key includes block number
     * to ensure freshness while avoiding duplicate reads within the same block.
     *
     * Flow:
     * 1. Resolve block number (fetch if 'latest')
     * 2. Build cache key with block number
     * 3. Check cache for state at this block
     * 4. If cache miss, fetch positions() and ownerOf() in parallel
     * 5. Build result object
     * 6. Cache result with 60s TTL
     *
     * @param chainId - Chain ID
     * @param nftId - NFT token ID
     * @param blockNumber - Block number to fetch state at, or 'latest' for current block
     * @returns On-chain position state
     * @throws Error if chain not supported or RPC fails
     */
    private async fetchPositionState(
        chainId: number,
        nftId: string | number,
        blockNumber: number | "latest" = "latest",
    ): Promise<OnChainPositionState> {
        // 1. Resolve block number (fetch if 'latest')
        const resolvedBlockNumber =
            blockNumber === "latest"
                ? await this._evmBlockService.getCurrentBlockNumber(chainId)
                : BigInt(blockNumber);

        // 2. Build cache key (includes block number for freshness)
        const cacheKey = `position-onchain:${chainId}:${nftId}:${resolvedBlockNumber}`;

        // 3. Check cache
        const cached =
            await this._cacheService.get<OnChainPositionStateCached>(cacheKey);
        if (cached) {
            this.logger.debug(
                {
                    chainId,
                    nftId,
                    blockNumber: resolvedBlockNumber.toString(),
                    cacheHit: true,
                },
                "On-chain position state cache hit",
            );
            return deserializeOnChainState(cached);
        }

        // 4. Get public client for contract reads
        const client = this._evmConfig.getPublicClient(chainId);
        const positionManagerAddress = getPositionManagerAddress(chainId);

        // 5. Cache miss - fetch from chain in parallel
        try {
            const [positionData, ownerAddress] = await Promise.all([
                client.readContract({
                    address: positionManagerAddress,
                    abi: UNISWAP_V3_POSITION_MANAGER_ABI,
                    functionName: "positions",
                    args: [BigInt(nftId)],
                    blockNumber: resolvedBlockNumber,
                }),
                client.readContract({
                    address: positionManagerAddress,
                    abi: UNISWAP_V3_POSITION_MANAGER_ABI,
                    functionName: "ownerOf",
                    args: [BigInt(nftId)],
                    blockNumber: resolvedBlockNumber,
                }),
            ]);

            // 6. Build result (positionData is a tuple)
            const data = positionData as readonly [
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

            const state: OnChainPositionState = {
                blockNumber: resolvedBlockNumber,
                isBurned: false,
                ownerAddress: normalizeAddress(ownerAddress as Address),
                operator: normalizeAddress(data[1]),
                liquidity: data[7],
                feeGrowthInside0LastX128: data[8],
                feeGrowthInside1LastX128: data[9],
                tokensOwed0: data[10],
                tokensOwed1: data[11],
            };

            // 7. Cache with 60s TTL
            await this._cacheService.set(
                cacheKey,
                serializeOnChainState(state),
                60,
            );

            this.logger.debug(
                {
                    chainId,
                    nftId,
                    blockNumber: resolvedBlockNumber.toString(),
                    cacheHit: false,
                },
                "On-chain position state fetched and cached",
            );

            return state;
        } catch (error) {
            // Handle burned NFT - cache the burned state with defaults
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            if (
                errorMessage.includes("Invalid token ID") ||
                errorMessage.includes("ERC721: invalid token ID") ||
                errorMessage.includes("owner query for nonexistent token") ||
                errorMessage.includes("ERC721NonexistentToken")
            ) {
                this.logger.debug(
                    {
                        chainId,
                        nftId,
                        blockNumber: resolvedBlockNumber.toString(),
                    },
                    "NFT does not exist (burned) - caching burned state",
                );

                // Create burned state with zero defaults
                const burnedState: OnChainPositionState = {
                    blockNumber: resolvedBlockNumber,
                    isBurned: true,
                    ownerAddress: ZERO_ADDRESS,
                    operator: ZERO_ADDRESS,
                    liquidity: 0n,
                    feeGrowthInside0LastX128: 0n,
                    feeGrowthInside1LastX128: 0n,
                    tokensOwed0: 0n,
                    tokensOwed1: 0n,
                };

                // Cache burned state with same TTL
                await this._cacheService.set(
                    cacheKey,
                    serializeOnChainState(burnedState),
                    60,
                );

                return burnedState;
            }
            throw error;
        }
    }

    /**
     * Fetch owner address for a position from on-chain data
     *
     * Uses the cached `fetchPositionState()` internally to reduce RPC calls.
     * Returns the owner address or zero address if the NFT has been burned.
     *
     * @param chainId - Chain ID
     * @param nftId - NFT token ID
     * @param blockNumber - Block number to fetch state at, or 'latest' for current block
     * @returns Owner address (checksummed) or zero address if burned
     * @throws Error if chain is not supported or RPC fails
     */
    async fetchOwnerAddress(
        chainId: number,
        nftId: string | number,
        blockNumber: number | "latest" = "latest",
    ): Promise<string> {
        const onChainState = await this.fetchPositionState(
            chainId,
            nftId,
            blockNumber,
        );
        return onChainState.ownerAddress;
    }

    /**
     * Fetch liquidity for a position from on-chain data
     *
     * Uses the cached `fetchPositionState()` internally to reduce RPC calls.
     * Returns the current liquidity or 0n if the NFT has been burned.
     *
     * @param chainId - Chain ID
     * @param nftId - NFT token ID
     * @param blockNumber - Block number to fetch state at, or 'latest' for current block
     * @returns Current liquidity as bigint (0n if burned)
     * @throws Error if chain is not supported or RPC fails
     */
    async fetchLiquidity(
        chainId: number,
        nftId: string | number,
        blockNumber: number | "latest" = "latest",
    ): Promise<bigint> {
        const onChainState = await this.fetchPositionState(
            chainId,
            nftId,
            blockNumber,
        );
        return onChainState.liquidity;
    }

    /**
     * Fetch all position logs via eth_getLogs RPC
     *
     * Queries NFPM contract for IncreaseLiquidity, DecreaseLiquidity, and Collect events
     * from deployment block to latest. Batches requests in 5000 block chunks to avoid
     * RPC provider limits.
     *
     * @param client - Viem public client for RPC calls
     * @param nfpmAddress - NonfungiblePositionManager contract address
     * @param nftId - NFT token ID
     * @param fromBlock - Starting block number (usually NFPM deployment block)
     * @returns Array of raw log inputs compatible with importLogsForPosition
     */
    private async fetchAllPositionLogs(
        client: PublicClient,
        nfpmAddress: Address,
        nftId: bigint,
        fromBlock: bigint,
    ): Promise<RawLogInput[]> {
        const BATCH_SIZE = 5000n;

        // Convert NFT ID to padded hex topic (32 bytes)
        const nftIdTopic = ("0x" +
            nftId.toString(16).padStart(64, "0")) as `0x${string}`;

        // Get all event signatures
        const eventSignatures = Object.values(
            UNISWAP_V3_POSITION_EVENT_SIGNATURES,
        ) as `0x${string}`[];

        // Get latest block number
        const latestBlock = await client.getBlockNumber();

        // Fetch logs in batches of 5000 blocks
        const allLogs: RawLogInput[] = [];
        let currentFrom = fromBlock;

        while (currentFrom <= latestBlock) {
            const currentTo =
                currentFrom + BATCH_SIZE - 1n < latestBlock
                    ? currentFrom + BATCH_SIZE - 1n
                    : latestBlock;

            const batchLogs = (await client.request({
                method: "eth_getLogs",
                params: [
                    {
                        address: nfpmAddress,
                        topics: [
                            eventSignatures, // Array = OR condition for topic[0]
                            nftIdTopic, // topic[1] = tokenId
                        ],
                        fromBlock: `0x${currentFrom.toString(16)}`,
                        toBlock: `0x${currentTo.toString(16)}`,
                    },
                ],
            })) as RawLogInput[];

            allLogs.push(...batchLogs);
            currentFrom = currentTo + 1n;
        }

        return allLogs;
    }

    /**
     * Fetch position fee state from on-chain data
     *
     * Fetches fee-related fields from the positions() function and calculates
     * unclaimed fees using the pool's fee growth values. Does not persist to database.
     *
     * @param id - Position database ID
     * @param blockNumber - Block number to fetch state at, or 'latest' for current block
     * @param tx - Optional Prisma transaction client
     * @returns The calculated fee state (not persisted)
     * @throws Error if position not found
     * @throws Error if chain is not supported
     * @throws Error if NFT doesn't exist (burned)
     */
    private async fetchFeeState(
        id: string,
        blockNumber: number | "latest" = "latest",
        tx?: PrismaTransactionClient,
    ): Promise<PositionFeeState> {
        log.methodEntry(this.logger, "fetchFeeState", { id, blockNumber });

        try {
            // 1. Get existing position with pool
            const existing = await this.findById(id);
            if (!existing) {
                throw new Error(`Position not found: ${id}`);
            }

            const { chainId, nftId, poolAddress, tickLower, tickUpper } =
                existing.typedConfig;

            // 2. Fetch position state (uses cache if available) - this also resolves block number
            const onChainState = await this.fetchPositionState(
                chainId,
                nftId,
                blockNumber,
            );

            // Use the resolved block number for all subsequent fetches
            const resolvedBlockNumber = onChainState.blockNumber;

            // 3. Fetch pool state at the same block number
            const poolState = await this.poolService.fetchPoolState(
                chainId,
                poolAddress,
                Number(resolvedBlockNumber),
            );
            const {
                currentTick,
                feeGrowthGlobal0: feeGrowthGlobal0X128,
                feeGrowthGlobal1: feeGrowthGlobal1X128,
            } = poolState;

            // 4. Fetch tick data (cached by pool service)
            const [tickLowerData, tickUpperData] = await Promise.all([
                this.poolService.fetchTickData(
                    chainId,
                    poolAddress,
                    tickLower,
                    Number(resolvedBlockNumber),
                ),
                this.poolService.fetchTickData(
                    chainId,
                    poolAddress,
                    tickUpper,
                    Number(resolvedBlockNumber),
                ),
            ]);

            // Extract position data from cached state
            const liquidity = onChainState.liquidity;
            const feeGrowthInside0LastX128 =
                onChainState.feeGrowthInside0LastX128;
            const feeGrowthInside1LastX128 =
                onChainState.feeGrowthInside1LastX128;
            const tokensOwed0 = onChainState.tokensOwed0;
            const tokensOwed1 = onChainState.tokensOwed1;

            // Extract tick fee growth data
            const tickLowerFeeGrowthOutside0X128 =
                tickLowerData.feeGrowthOutside0X128;
            const tickLowerFeeGrowthOutside1X128 =
                tickLowerData.feeGrowthOutside1X128;
            const tickUpperFeeGrowthOutside0X128 =
                tickUpperData.feeGrowthOutside0X128;
            const tickUpperFeeGrowthOutside1X128 =
                tickUpperData.feeGrowthOutside1X128;

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

            // 5. Get uncollected principal from ledger to calculate accurate unclaimed fees
            // tokensOwed on-chain = uncollectedPrincipal (from decrease liquidity) + unclaimedFees
            // So: unclaimedFees = tokensOwed - uncollectedPrincipal
            const ledgerEventService = new UniswapV3LedgerEventService(
                { positionId: id },
                { prisma: this._prisma },
            );
            const { uncollectedPrincipal0, uncollectedPrincipal1 } =
                await ledgerEventService.fetchUncollectedPrincipals(
                    Number(resolvedBlockNumber),
                    tx,
                );

            // 6. Calculate actual unclaimed fees using shared utility
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

            // 7. Create and return fee state (no persistence)
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

            log.methodExit(this.logger, "fetchFeeState", { id });
            return feeState;
        } catch (error) {
            if (
                !(error instanceof Error && error.message.includes("not found"))
            ) {
                log.methodError(this.logger, "fetchFeeState", error as Error, {
                    id,
                });
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

    /**
     * Transition a position to burned state.
     *
     * Called when fetchPositionState detects the NFT has been burned.
     * Updates all relevant state fields and refreshes metrics.
     *
     * @param id - Position database ID
     * @param position - The position being transitioned
     * @param tx - Optional Prisma transaction client
     * @returns The updated position
     */
    private async transitionToBurnedState(
        id: string,
        position: UniswapV3Position,
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3Position> {
        const { chainId, nftId } = position.typedConfig;

        this.logger.info(
            { id, nftId: String(nftId), chainId },
            "NFT burned (detected by fetchPositionState) - updating state and refreshing metrics",
        );

        // Get last COLLECT event timestamp for positionClosedAt
        const ledgerService = new UniswapV3LedgerEventService(
            { positionId: id },
            { prisma: this._prisma },
        );
        const lastCollect = await ledgerService.fetchLastCollectEvent(
            "latest",
            tx,
        );
        const closedAt = lastCollect?.timestamp ?? position.positionOpenedAt;

        // Update closed state
        await this.updateClosedState(id, true, true, closedAt, tx);

        // Zero out on-chain state fields
        await this.updateLiquidity(id, 0n, tx);
        await this.updateFeeState(
            id,
            {
                feeGrowthInside0LastX128: 0n,
                feeGrowthInside1LastX128: 0n,
                tokensOwed0: 0n,
                tokensOwed1: 0n,
                unclaimedFees0: 0n,
                unclaimedFees1: 0n,
                tickLowerFeeGrowthOutside0X128: 0n,
                tickLowerFeeGrowthOutside1X128: 0n,
                tickUpperFeeGrowthOutside0X128: 0n,
                tickUpperFeeGrowthOutside1X128: 0n,
            },
            tx,
        );

        // Refresh metrics to recalculate position value
        await this.refreshMetrics(id, tx);

        // Return the updated position
        const burnedPosition = await this.findById(id);
        if (!burnedPosition) {
            throw new Error(
                `Position not found after burned transition: ${id}`,
            );
        }

        return burnedPosition;
    }

    /**
     * Transition a position from closed state back to active.
     *
     * Called when a position was marked as closed but on-chain state shows
     * it has been reopened (has liquidity or owed tokens again).
     *
     * @param id - Position database ID
     * @param tx - Optional Prisma transaction client
     */
    private async transitionFromClosedState(
        id: string,
        tx?: PrismaTransactionClient,
    ): Promise<void> {
        this.logger.info(
            { id },
            "Position reopened - transitioning from closed state",
        );

        const db = tx ?? this.prisma;

        // Get existing position
        const existing = await this.findById(id);
        if (!existing) {
            throw new Error(`Position not found: ${id}`);
        }

        // Update state to mark as not closed
        const currentState = this.parseState(existing.state);
        const updatedState: UniswapV3PositionState = {
            ...currentState,
            isClosed: false,
        };

        // Update position
        await db.position.update({
            where: { id },
            data: {
                state: this.serializeState(updatedState) as object,
                isActive: true,
                positionClosedAt: null,
            },
        });
    }

    /**
     * Update position closed/burned state
     *
     * Updates the isBurned and isClosed flags in the position state,
     * and synchronizes the position-level isActive and positionClosedAt fields.
     *
     * State transitions:
     * - When isBurned or isClosed becomes true: isActive=false, positionClosedAt is set
     * - positionClosedAt is only set on transition (not if already closed)
     *
     * @param id - Position database ID
     * @param isBurned - Whether the NFT has been burned
     * @param isClosed - Whether the position is fully closed (L=0, tokensOwed=0)
     * @param closedAt - Timestamp for positionClosedAt (typically last COLLECT event)
     * @param tx - Optional Prisma transaction client
     * @returns Updated position
     */
    private async updateClosedState(
        id: string,
        isBurned: boolean,
        isClosed: boolean,
        closedAt: Date | null,
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3Position> {
        log.methodEntry(this.logger, "updateClosedState", {
            id,
            isBurned,
            isClosed,
            closedAt: closedAt?.toISOString() ?? null,
        });

        const db = tx ?? this.prisma;

        try {
            // 1. Get existing position
            const existing = await this.findById(id);
            if (!existing) {
                throw new Error(`Position not found: ${id}`);
            }

            // 2. Parse current state and update closed flags
            const currentState = this.parseState(existing.state);
            const updatedState: UniswapV3PositionState = {
                ...currentState,
                isBurned,
                isClosed,
            };

            // 3. Determine if this is a state transition to closed/burned
            const wasActive = existing.isActive;
            const becomingInactive = (isBurned || isClosed) && wasActive;

            // 4. Serialize state
            const stateDB = this.serializeState(updatedState);

            // 5. Build update data
            const updateData: {
                state: object;
                isActive?: boolean;
                positionClosedAt?: Date;
            } = {
                state: stateDB as object,
            };

            // Only update position-level fields if transitioning to inactive
            if (becomingInactive) {
                updateData.isActive = false;
                if (closedAt) {
                    updateData.positionClosedAt = closedAt;
                }
            }

            log.dbOperation(this.logger, "update", "Position", {
                id,
                fields: [
                    "state.isBurned",
                    "state.isClosed",
                    ...(becomingInactive
                        ? ["isActive", "positionClosedAt"]
                        : []),
                ],
            });

            // 6. Persist
            const result = await db.position.update({
                where: { id },
                data: updateData,
                include: {
                    pool: {
                        include: { token0: true, token1: true },
                    },
                },
            });

            const position = this.mapToPosition(
                result as PositionDbResult,
            ) as UniswapV3Position;

            this.logger.info(
                {
                    id,
                    isBurned,
                    isClosed,
                    isActive: position.isActive,
                    positionClosedAt:
                        position.positionClosedAt?.toISOString() ?? null,
                },
                "Position closed state updated",
            );
            log.methodExit(this.logger, "updateClosedState", { id });
            return position;
        } catch (error) {
            if (
                !(error instanceof Error && error.message.includes("not found"))
            ) {
                log.methodError(
                    this.logger,
                    "updateClosedState",
                    error as Error,
                    {
                        id,
                    },
                );
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
     * @param blockNumber - Block number to fetch state at, or 'latest' for current block
     * @param tx - Optional Prisma transaction client
     * @returns The current owner address
     * @throws Error if position not found
     * @throws Error if chain is not supported
     * @throws Error if NFT doesn't exist (burned)
     */
    private async refreshOwnerAddress(
        id: string,
        blockNumber: number | "latest" = "latest",
        tx?: PrismaTransactionClient,
    ): Promise<string> {
        log.methodEntry(this.logger, "refreshOwnerAddress", {
            id,
            blockNumber,
        });

        try {
            // 1. Get existing position
            const existing = await this.findById(id);
            if (!existing) {
                throw new Error(`Position not found: ${id}`);
            }

            const { chainId, nftId } = existing.typedConfig;

            // 2. Fetch owner address from on-chain (uses cache if available)
            const ownerAddress = await this.fetchOwnerAddress(
                chainId,
                nftId,
                blockNumber,
            );

            // 3. Persist using setter
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
     * @param blockNumber - Block number to fetch state at, or 'latest' for current block
     * @param tx - Optional Prisma transaction client
     * @returns The current liquidity as bigint
     * @throws Error if position not found
     * @throws Error if chain is not supported
     * @throws Error if NFT doesn't exist (burned)
     */
    private async refreshLiquidity(
        id: string,
        blockNumber: number | "latest" = "latest",
        tx?: PrismaTransactionClient,
    ): Promise<bigint> {
        log.methodEntry(this.logger, "refreshLiquidity", { id, blockNumber });

        try {
            // 1. Get existing position
            const existing = await this.findById(id);
            if (!existing) {
                throw new Error(`Position not found: ${id}`);
            }

            const { chainId, nftId } = existing.typedConfig;

            // 2. Fetch liquidity from on-chain (uses cache if available)
            const liquidity = await this.fetchLiquidity(
                chainId,
                nftId,
                blockNumber,
            );

            // 3. Persist using setter
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
     * Fetches fee state and persists to database.
     *
     * @param id - Position database ID
     * @param blockNumber - Block number to fetch state at, or 'latest' for current block
     * @param tx - Optional Prisma transaction client
     * @returns The current fee state
     * @throws Error if position not found
     * @throws Error if chain is not supported
     * @throws Error if NFT doesn't exist (burned)
     */
    private async refreshFeeState(
        id: string,
        blockNumber: number | "latest" = "latest",
        tx?: PrismaTransactionClient,
    ): Promise<PositionFeeState> {
        log.methodEntry(this.logger, "refreshFeeState", { id, blockNumber });

        try {
            // 1. Fetch fee state from on-chain
            const feeState = await this.fetchFeeState(id, blockNumber, tx);

            // 2. Persist to database
            await this.updateFeeState(id, feeState, tx);

            this.logger.info(
                {
                    id,
                    tokensOwed0: feeState.tokensOwed0.toString(),
                    tokensOwed1: feeState.tokensOwed1.toString(),
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
            const latestEvent = await ledgerService.fetchLatestEvent(
                "latest",
                tx,
            );
            const lastCollectEvent = await ledgerService.fetchLastCollectEvent(
                "latest",
                tx,
            );

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
            const { priceRangeLower, priceRangeUpper } =
                this.calculatePriceRange(position, pool);

            // 8. Determine lastFeesCollectedAt (use positionOpenedAt if no collections)
            const lastFeesCollectedAt =
                lastCollectEvent?.timestamp ?? position.positionOpenedAt;

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
