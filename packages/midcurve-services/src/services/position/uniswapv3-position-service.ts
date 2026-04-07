/**
 * UniswapV3PositionService
 *
 * Specialized service for Uniswap V3 position management.
 * Handles serialization/deserialization of Uniswap V3 position config and state.
 */

import { prisma as prismaClient, PrismaClient } from "@midcurve/database";
import type {
    UniswapV3PositionConfigData,
    UniswapV3PositionState,
    UniswapV3PositionMetrics,
    UniswapV3PositionPnLSummary,
    AprSummary,
    PositionProtocol,
    PositionInterface,
    PositionRow,
    Erc20TokenRow,
} from "@midcurve/shared";
import {
    UniswapV3Position,
    PositionFactory,
    Erc20Token,
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
import type {
    DomainEventPublisher,
    PositionClosedPayload,
    PositionBurnedPayload,
    PositionDeletedPayload,
    PositionLiquidityIncreasedPayload,
    PositionLiquidityDecreasedPayload,
    PositionFeesCollectedPayload,
    PositionLiquidityRevertedPayload,
} from "../../events/index.js";
import { EvmConfig } from "../../config/evm.js";
import {
    getPositionManagerAddress,
    getFactoryAddress,
    getNfpmDeploymentBlock,
    UNISWAP_V3_POSITION_MANAGER_ABI,
    UNISWAP_V3_FACTORY_ABI,
} from "../../config/uniswapv3.js";
import { normalizeAddress, createErc20TokenHash, createEvmOwnerWallet } from "@midcurve/shared";
import { UniswapV3PoolService } from "../pool/uniswapv3-pool-service.js";
import type { PrismaTransactionClient } from "../../clients/prisma/index.js";
import { UniswapV3QuoteTokenService } from "../quote-token/uniswapv3-quote-token-service.js";
import { EvmBlockService } from "../block/evm-block-service.js";
import { UniswapV3PoolPriceService } from "../pool-price/uniswapv3-pool-price-service.js";
import {
    UniswapV3LedgerService,
    type RawLogInput,
    type ImportLogsResult,
} from "../position-ledger/uniswapv3-ledger-service.js";
import { UniswapV3AprService } from "../position-apr/uniswapv3-apr-service.js";
import { type Address, type PublicClient, parseAbiItem } from "viem";
import { calculatePositionValue } from "@midcurve/shared";
import { tickToPrice } from "@midcurve/shared";
import { calculateUnclaimedFeeAmounts } from "@midcurve/shared";
import { calculateTokenValueInQuote } from "../../utils/uniswapv3/ledger-calculations.js";
import {
    findNftMintBlock,
    enumerateWalletPositions,
} from "../../utils/uniswapv3/nfpm-enumerator.js";
import { SupportedChainId } from "../../config/evm.js";
import { CacheService } from "../cache/cache-service.js";
import { UniswapV3CloseOrderService } from "../close-order/uniswapv3-close-order-service.js";
import { UserWalletService } from "../wallet-perimeter/user-wallet-service.js";

/**
 * Yield state for a position
 *
 * Contains all yield-related fields that can be refreshed independently.
 */
export interface PositionYieldState {
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
 * Result of discovering all positions for a wallet across all supported chains.
 */
export interface WalletDiscoveryResult {
    /** Successfully discovered positions (for event publishing by caller) */
    positions: UniswapV3Position[];
    /** Total active positions found across all chains */
    found: number;
    /** Positions newly imported */
    imported: number;
    /** Positions already in DB (skipped) */
    skipped: number;
    /** Positions that failed to import */
    errors: number;
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
    type: string;
    protocol: string;
    userId: string;
    currentValue: string; // Prisma returns bigint as string
    costBasis: string;
    realizedPnl: string;
    unrealizedPnl: string;
    realizedCashflow: string;
    unrealizedCashflow: string;
    collectedYield: string;
    unclaimedYield: string;
    lastYieldClaimedAt: Date;
    baseApr: number | null;
    rewardApr: number | null;
    totalApr: number | null;
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

    /**
     * Close order service for discovering on-chain close orders during position import
     * If not provided, a new UniswapV3CloseOrderService instance will be created
     */
    closeOrderService?: UniswapV3CloseOrderService;

    /**
     * User wallet service for building the user's wallet address set
     * Used by ledger service for ownership tracking during event processing
     * If not provided, a new UserWalletService instance will be created
     */
    userWalletService?: UserWalletService;
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
    private readonly _quoteTokenService: UniswapV3QuoteTokenService;
    private readonly _evmBlockService: EvmBlockService;
    private readonly _poolPriceService: UniswapV3PoolPriceService;
    private readonly _cacheService: CacheService;
    private readonly _closeOrderService: UniswapV3CloseOrderService;
    private readonly _userWalletService: UserWalletService;

    /**
     * Creates a new UniswapV3PositionService instance
     *
     * @param dependencies - Optional dependencies object
     * @param dependencies.prisma - Prisma client instance (creates default if not provided)
     * @param dependencies.eventPublisher - Domain event publisher (uses singleton if not provided)
     * @param dependencies.evmConfig - EVM configuration instance (uses singleton if not provided)
     * @param dependencies.poolService - UniswapV3 pool service (creates default if not provided)
     * @param dependencies.quoteTokenService - UniswapV3 quote token service (creates default if not provided)
     */
    constructor(dependencies: UniswapV3PositionServiceDependencies = {}) {
        // Initialize base class properties
        this._prisma = dependencies.prisma ?? prismaClient;
        this.logger = createServiceLogger(this.constructor.name);
        this.eventPublisher =
            dependencies.eventPublisher ?? getDomainEventPublisher();

        // Initialize UniswapV3-specific dependencies
        this._evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
        this._poolService =
            dependencies.poolService ??
            new UniswapV3PoolService();
        this._quoteTokenService =
            dependencies.quoteTokenService ??
            new UniswapV3QuoteTokenService();
        this._evmBlockService =
            dependencies.evmBlockService ??
            new EvmBlockService({ evmConfig: this._evmConfig });
        this._poolPriceService =
            dependencies.poolPriceService ??
            new UniswapV3PoolPriceService();
        this._cacheService =
            dependencies.cacheService ?? CacheService.getInstance();
        this._closeOrderService =
            dependencies.closeOrderService ?? new UniswapV3CloseOrderService();
        this._userWalletService =
            dependencies.userWalletService ?? new UserWalletService({ prisma: this._prisma });
    }

    /**
     * Get the Prisma client instance
     */
    protected get prisma(): PrismaClient {
        return this._prisma;
    }

    /**
     * Build the set of normalized EVM wallet addresses for a user.
     * Used by ledger service for ownership tracking during event processing.
     */
    private async buildUserWalletAddresses(userId: string): Promise<Set<string>> {
        const wallets = await this._userWalletService.findByUserId(userId);
        return new Set(
            wallets
                .filter(w => w.walletType === "evm")
                .map(w => (w.config as { address: string }).address.toLowerCase()),
        );
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
            token0Address: string;
            token1Address: string;
            feeBps: number | string;
            tickSpacing: number | string;
            tickUpper: number | string;
            tickLower: number | string;
            isToken0Quote?: boolean;
            priceRangeLower?: string;
            priceRangeUpper?: string;
        };

        // Defensive type conversion for JSON deserialization
        // PostgreSQL JSON columns may return numbers as strings
        const chainId =
            typeof db.chainId === "number" ? db.chainId : Number(db.chainId);
        const nftId =
            typeof db.nftId === "number" ? db.nftId : Number(db.nftId);
        const feeBps =
            typeof db.feeBps === "number" ? db.feeBps : Number(db.feeBps);
        const tickSpacing =
            typeof db.tickSpacing === "number" ? db.tickSpacing : Number(db.tickSpacing);
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
            token0Address: db.token0Address,
            token1Address: db.token1Address,
            feeBps,
            tickSpacing,
            tickUpper,
            tickLower,
            isToken0Quote: db.isToken0Quote ?? false,
            priceRangeLower: db.priceRangeLower ? BigInt(db.priceRangeLower) : 0n,
            priceRangeUpper: db.priceRangeUpper ? BigInt(db.priceRangeUpper) : 0n,
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
            token0Address: config.token0Address,
            token1Address: config.token1Address,
            feeBps: config.feeBps,
            tickSpacing: config.tickSpacing,
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
            // Pool-level state (merged from pool)
            sqrtPriceX96?: string;
            currentTick?: number | string;
            poolLiquidity?: string;
            feeGrowthGlobal0?: string;
            feeGrowthGlobal1?: string;
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
            // Pool-level state (defaults to 0 for backward compat with pre-migration data)
            sqrtPriceX96: BigInt(db.sqrtPriceX96 ?? "0"),
            currentTick: typeof db.currentTick === "number" ? db.currentTick : Number(db.currentTick ?? 0),
            poolLiquidity: BigInt(db.poolLiquidity ?? "0"),
            feeGrowthGlobal0: BigInt(db.feeGrowthGlobal0 ?? "0"),
            feeGrowthGlobal1: BigInt(db.feeGrowthGlobal1 ?? "0"),
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
            // Pool-level state
            sqrtPriceX96: state.sqrtPriceX96.toString(),
            currentTick: state.currentTick,
            poolLiquidity: state.poolLiquidity.toString(),
            feeGrowthGlobal0: state.feeGrowthGlobal0.toString(),
            feeGrowthGlobal1: state.feeGrowthGlobal1.toString(),
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
     * Imports a position by:
     * 1. Fetching all historical log events for the NFT
     * 2. Fetching position config at first event's block
     * 3. Discovering/creating the pool
     * 4. Creating the position record
     * 5. Importing ledger events
     * 6. Refreshing position metrics
     *
     * If the position already exists for this user, returns the existing position
     * after refreshing it.
     *
     * @param userId - User ID who owns this position
     * @param params - Discovery parameters { chainId, nftId, quoteTokenAddress }
     * @param dbTx - Optional Prisma transaction client for atomic operations
     * @returns The discovered or existing position
     * @throws Error if no events found for the NFT (position doesn't exist)
     * @throws Error if chain is not supported
     */
    async discover(
        userId: string,
        params: UniswapV3PositionDiscoverInput,
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3Position> {
        const { chainId, nftId, quoteTokenAddress } = params;
        log.methodEntry(this.logger, "discover", { userId, chainId, nftId });

        try {
            // a) Check params validity
            if (!this._evmConfig.isChainSupported(chainId)) {
                throw new Error(
                    `Chain ${chainId} is not supported. Supported chains: ${this._evmConfig
                        .getSupportedChainIds()
                        .join(", ")}`,
                );
            }

            // Check if position already exists for this user
            const positionHash = this.createHash({ chainId, nftId });
            const existing = await this.findByPositionHash(
                userId,
                positionHash,
                dbTx,
            );
            if (existing) {
                this.logger.info(
                    { id: existing.id, userId, chainId, nftId, positionHash },
                    "Position already exists, refreshing",
                );
                const refreshed = await this.refresh(existing.id, "latest", dbTx);
                log.methodExit(this.logger, "discover", {
                    id: refreshed.id,
                    existing: true,
                });
                return refreshed;
            }

            // b) Find mint block, then load all log events from there
            const client = this._evmConfig.getPublicClient(chainId);
            const nfpmAddress = getPositionManagerAddress(chainId);
            const deploymentBlock = getNfpmDeploymentBlock(chainId);

            // Find the exact block where this NFT was minted (1 RPC call
            // using fully-indexed Transfer event topics).
            const mintBlock = await findNftMintBlock(
                client,
                nfpmAddress,
                BigInt(nftId),
                deploymentBlock,
            );

            if (!mintBlock) {
                throw new Error(
                    `Mint block not found for NFT ${nftId} on chain ${chainId}. ` +
                    `NFPM address: ${nfpmAddress}, searched from block ${deploymentBlock}`,
                );
            }

            const fromBlock = mintBlock;
            this.logger.info(
                { chainId, nftId, mintBlock: mintBlock.toString() },
                "Found mint block, scanning logs from there",
            );

            const logs = await this.fetchAllPositionLogs(
                client,
                nfpmAddress,
                BigInt(nftId),
                fromBlock,
            );

            if (logs.length === 0) {
                throw new Error(
                    `Position not found: no events for NFT ${nftId} on chain ${chainId}`,
                );
            }

            this.logger.info(
                { chainId, nftId, logCount: logs.length },
                "Fetched position logs",
            );

            // c) Use blockNumber of first ledger event to fetch position config
            const firstLog = logs[0]!; // Safe: we checked logs.length > 0 above
            const firstLogBlockNumber =
                typeof firstLog.blockNumber === "bigint"
                    ? firstLog.blockNumber
                    : BigInt(parseInt(firstLog.blockNumber, 16));
            const positionConfig = await this.fetchPositionConfig(
                chainId,
                BigInt(nftId),
                firstLogBlockNumber,
            );

            // d) fetchPositionState at first log block
            const onChainState = await this.fetchPositionState(
                chainId,
                nftId,
                Number(firstLogBlockNumber),
            );

            // e) Discover pool via pool service
            const pool = await this.poolService.discover({
                chainId,
                poolAddress: positionConfig.poolAddress,
            });

            // Determine quote token (isToken0Quote)
            const token0 = pool.token0 as Erc20Token;
            const token1 = pool.token1 as Erc20Token;
            let isToken0Quote: boolean;
            if (quoteTokenAddress) {
                const normalizedQuote = normalizeAddress(quoteTokenAddress);
                if (normalizedQuote === token0.address) {
                    isToken0Quote = true;
                } else if (normalizedQuote === token1.address) {
                    isToken0Quote = false;
                } else {
                    throw new Error(
                        `Quote token ${quoteTokenAddress} is not in pool. Pool tokens: ${token0.address}, ${token1.address}`,
                    );
                }
            } else {
                // Use QuoteTokenService: chain defaults → token0 fallback
                const quoteResult =
                    await this._quoteTokenService.determineQuoteToken({
                        userId,
                        chainId,
                        token0Address: token0.address,
                        token1Address: token1.address,
                    });
                isToken0Quote = quoteResult.isToken0Quote;
            }

            // f) Create position with default values
            const config: UniswapV3PositionConfigData = {
                chainId,
                nftId,
                poolAddress: positionConfig.poolAddress,
                token0Address: pool.typedConfig.token0,
                token1Address: pool.typedConfig.token1,
                feeBps: pool.feeBps,
                tickSpacing: pool.tickSpacing,
                tickLower: positionConfig.tickLower,
                tickUpper: positionConfig.tickUpper,
                isToken0Quote,
                priceRangeLower: 0n, // Will be computed during refresh
                priceRangeUpper: 0n, // Will be computed during refresh
            };

            const state: UniswapV3PositionState = {
                ownerAddress: onChainState.ownerAddress,
                operator: onChainState.operator,
                liquidity: onChainState.liquidity,
                feeGrowthInside0LastX128: onChainState.feeGrowthInside0LastX128,
                feeGrowthInside1LastX128: onChainState.feeGrowthInside1LastX128,
                tokensOwed0: onChainState.tokensOwed0,
                tokensOwed1: onChainState.tokensOwed1,
                unclaimedFees0: 0n,
                unclaimedFees1: 0n,
                tickLowerFeeGrowthOutside0X128: 0n,
                tickLowerFeeGrowthOutside1X128: 0n,
                tickUpperFeeGrowthOutside0X128: 0n,
                tickUpperFeeGrowthOutside1X128: 0n,
                isBurned: false,
                isClosed: false,
                sqrtPriceX96: pool.sqrtPriceX96,
                currentTick: pool.currentTick,
                poolLiquidity: pool.liquidity,
                feeGrowthGlobal0: pool.feeGrowthGlobal0,
                feeGrowthGlobal1: pool.feeGrowthGlobal1,
            };

            // Get timestamp from first log for positionOpenedAt
            const firstBlock = await client.getBlock({
                blockNumber: firstLogBlockNumber,
            });
            const positionOpenedAt = new Date(
                Number(firstBlock.timestamp) * 1000,
            );

            const position = await this.create(
                {
                    protocol: "uniswapv3",
                    userId,
                    poolId: pool.id,
                    isToken0Quote,
                    positionOpenedAt,
                    config,
                    state,
                },
                this.serializeConfig(config) as Record<string, unknown>,
                this.serializeState(state) as Record<string, unknown>,
                dbTx,
            );

            this.logger.info(
                { id: position.id, userId, chainId, nftId, poolId: pool.id },
                "Position created, importing ledger events",
            );

            // g) Import logs via ledger service
            const ledgerService = new UniswapV3LedgerService(
                { positionId: position.id },
                { prisma: this.prisma },
            );
            const userWalletAddresses = await this.buildUserWalletAddresses(userId);
            await ledgerService.importLogsForPosition(
                position,
                chainId,
                logs,
                this._poolPriceService,
                userWalletAddresses,
                dbTx,
            );

            // g2) Discover close orders (best-effort)
            try {
                const closeOrderResult = await this._closeOrderService.discover(position.id, dbTx);
                if (closeOrderResult.discovered > 0) {
                    this.logger.info(
                        { positionId: position.id, discovered: closeOrderResult.discovered },
                        "Close orders discovered during position import",
                    );
                }
            } catch (closeOrderError) {
                this.logger.warn(
                    { positionId: position.id, error: (closeOrderError as Error).message },
                    "Close order discovery failed (non-fatal)",
                );
            }

            // h) Call refresh()
            const refreshedPosition = await this.refresh(position.id, "latest", dbTx);

            this.logger.info(
                {
                    id: refreshedPosition.id,
                    userId,
                    chainId,
                    nftId,
                    logCount: logs.length,
                },
                "Position discovered and refreshed",
            );

            log.methodExit(this.logger, "discover", {
                id: refreshedPosition.id,
            });
            return refreshedPosition;
        } catch (error) {
            log.methodError(this.logger, "discover", error as Error, {
                userId,
                chainId,
                nftId,
            });
            throw error;
        }
    }

    // ============================================================================
    // WALLET-LEVEL DISCOVERY
    // ============================================================================

    /**
     * Discover and import all active UniswapV3 positions for a wallet across
     * all supported chains.
     *
     * Chains are scanned in parallel (Promise.allSettled). Already-imported
     * positions are skipped. Does NOT publish domain events — the caller is
     * responsible for publishing position.created events with appropriate
     * causal context.
     *
     * @param userId - User who owns the wallet
     * @param walletAddress - EVM wallet address to scan
     * @param chainIds - Optional list of chain IDs to scan. If omitted, scans all supported chains.
     * @returns Discovery results including imported position objects
     */
    async discoverWalletPositions(
        userId: string,
        walletAddress: Address,
        chainIds?: number[],
    ): Promise<WalletDiscoveryResult> {
        log.methodEntry(this.logger, "discoverWalletPositions", {
            userId,
            walletAddress,
        });

        const effectiveChainIds =
            chainIds && chainIds.length > 0
                ? chainIds.filter(
                      (id) =>
                          id !== SupportedChainId.LOCAL &&
                          this._evmConfig.isChainSupported(id),
                  )
                : this._evmConfig
                      .getSupportedChainIds()
                      .filter((id) => id !== SupportedChainId.LOCAL);

        this.logger.info(
            { userId, walletAddress, chainCount: effectiveChainIds.length },
            "Starting position discovery across all chains",
        );

        const results = await Promise.allSettled(
            effectiveChainIds.map((chainId) =>
                this.discoverPositionsOnChain(userId, walletAddress, chainId),
            ),
        );

        // Aggregate results
        const allPositions: UniswapV3Position[] = [];
        let totalFound = 0;
        let totalImported = 0;
        let totalSkipped = 0;
        let totalErrors = 0;

        for (let i = 0; i < results.length; i++) {
            const result = results[i]!;
            const chainId = effectiveChainIds[i]!;

            if (result.status === "fulfilled") {
                allPositions.push(...result.value.positions);
                totalFound += result.value.found;
                totalImported += result.value.imported;
                totalSkipped += result.value.skipped;
                totalErrors += result.value.errors;
            } else {
                totalErrors++;
                this.logger.error(
                    {
                        userId,
                        chainId,
                        error:
                            result.reason instanceof Error
                                ? result.reason.message
                                : String(result.reason),
                    },
                    "Chain-level position discovery failed",
                );
            }
        }

        this.logger.info(
            {
                userId,
                walletAddress,
                chainsScanned: effectiveChainIds.length,
                positionsFound: totalFound,
                positionsImported: totalImported,
                positionsSkipped: totalSkipped,
                errors: totalErrors,
            },
            "Wallet position discovery completed",
        );

        log.methodExit(this.logger, "discoverWalletPositions", {
            userId,
            found: totalFound,
            imported: totalImported,
        });

        return {
            positions: allPositions,
            found: totalFound,
            imported: totalImported,
            skipped: totalSkipped,
            errors: totalErrors,
        };
    }

    /**
     * Discover all positions on a single chain for a wallet.
     *
     * @param userId - User who owns the wallet
     * @param walletAddress - EVM wallet address to scan
     * @param chainId - Chain to scan
     * @returns Per-chain discovery results
     */
    private async discoverPositionsOnChain(
        userId: string,
        walletAddress: Address,
        chainId: number,
    ): Promise<{
        positions: UniswapV3Position[];
        found: number;
        imported: number;
        skipped: number;
        errors: number;
    }> {
        let client;
        try {
            client = this._evmConfig.getPublicClient(chainId);
        } catch {
            this.logger.debug({ chainId }, "Skipping chain: no RPC configured");
            return { positions: [], found: 0, imported: 0, skipped: 0, errors: 0 };
        }

        const activePositions = await enumerateWalletPositions(
            client,
            walletAddress,
            chainId,
        );

        if (activePositions.length === 0) {
            this.logger.debug(
                { userId, chainId },
                "No active positions found on chain",
            );
            return { positions: [], found: 0, imported: 0, skipped: 0, errors: 0 };
        }

        this.logger.info(
            { userId, chainId, count: activePositions.length },
            "Active positions found, importing",
        );

        const discoveredPositions: UniswapV3Position[] = [];
        let imported = 0;
        let skipped = 0;
        let errors = 0;

        for (const pos of activePositions) {
            try {
                const positionHash = this.createHash({ chainId, nftId: pos.nftId });
                const existing = await this.findByPositionHash(
                    userId,
                    positionHash,
                );

                if (existing) {
                    this.logger.debug(
                        { userId, chainId, nftId: pos.nftId, positionHash },
                        "Position already exists, skipping",
                    );
                    skipped++;
                    continue;
                }

                this.logger.info(
                    { userId, chainId, nftId: pos.nftId, positionHash },
                    "Position not in DB, calling discover()",
                );

                const position = await this.discover(userId, {
                    chainId,
                    nftId: pos.nftId,
                });

                this.logger.info(
                    { userId, chainId, nftId: pos.nftId, positionId: position.id },
                    "discover() returned successfully",
                );

                discoveredPositions.push(position);
                imported++;
            } catch (error) {
                errors++;
                this.logger.error(
                    {
                        userId,
                        chainId,
                        nftId: pos.nftId,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    },
                    "Failed to discover position",
                );
            }
        }

        return {
            positions: discoveredPositions,
            found: activePositions.length,
            imported,
            skipped,
            errors,
        };
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
     * - If fully closed: Sets isClosed=true and positionClosedAt to timestamp of final COLLECT event
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
     * - costBasis (from ledger events)
     * - realizedPnl (from ledger events)
     * - unrealizedPnl (currentValue - costBasis)
     * - collectedYield (from ledger events)
     * - unclaimedYield (from on-chain state, converted to quote)
     * - lastYieldClaimedAt (from most recent COLLECT event)
     * - priceRangeLower/Upper (from tick bounds)
     * - Pool state (sqrtPriceX96, currentTick, etc.)
     *
     * Note: Config fields (chainId, nftId, ticks, poolAddress) are immutable and not updated.
     * Note: totalApr is NOT updated by this method (use refreshPositionApr).
     * Note: isActive is only set to false when a burned NFT is detected.
     * Note: isClosed and positionClosedAt are updated when close/reopen conditions are detected.
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
        await this.refreshAllPositionLogs(id, blockNumber, dbTx);
        return this.refreshOnChainState(id, blockNumber, dbTx);
    }

    /**
     * Refresh position state from on-chain data.
     *
     * Updates owner, liquidity, fee state, and metrics from the NFPM contract.
     * Detects burned and closed positions. Does NOT sync ledger events — use
     * refresh() for the full on-demand sync that includes log fetching.
     *
     * @param id - Position ID
     * @param blockNumber - Block to read state from
     * @param dbTx - Optional Prisma transaction client
     */
    private async refreshOnChainState(
        id: string,
        blockNumber: number | "latest" = "latest",
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3Position> {
        try {
            // 0. Get position to determine pool ID
            const position = await this.findById(id, dbTx);
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
            // Only skip for routine "latest" refreshes. For block-specific refreshes
            // (triggered by new events via business rules), always proceed to ensure
            // the Position table reflects the latest ledger aggregates.
            if (
                blockNumber === "latest" &&
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
            const currentOwner = await this.refreshOwnerAddress(id, resolvedBlockNumber, dbTx);

            // 3.1 Check if position is still owned by user (wallet perimeter check)
            const userWalletAddresses = await this.buildUserWalletAddresses(position.userId);
            if (!userWalletAddresses.has(currentOwner.toLowerCase())) {
                // Position has left the user's perimeter — mark inactive
                this.logger.info(
                    { id, currentOwner, userId: position.userId },
                    "Position transferred outside user perimeter, marking inactive",
                );
                const db = dbTx ?? this.prisma;
                await db.position.update({
                    where: { id },
                    data: {
                        isActive: false,
                        positionClosedAt: new Date(),
                    },
                });
                // Still continue refresh to update metrics for display
            }

            // 4. Refresh liquidity
            await this.refreshLiquidity(id, resolvedBlockNumber, dbTx);

            // 5. Refresh fee state (tokensOwed, feeGrowthInside, unclaimed fees)
            await this.refreshFeeState(id, resolvedBlockNumber, dbTx);

            // 5.5 Refresh pool state in position (sqrtPriceX96, currentTick, poolLiquidity, feeGrowth)
            await this.refreshPoolState(id, resolvedBlockNumber, dbTx);

            // 6. Refresh metrics (common fields: value, PnL, fees, price range)
            await this.refreshMetrics(id, resolvedBlockNumber, dbTx);

            // 6.5 Reconcile close orders from on-chain (best-effort)
            try {
                await this._closeOrderService.refresh(
                    id,
                    resolvedBlockNumber,
                    dbTx,
                );
            } catch (closeOrderError) {
                this.logger.warn(
                    {
                        positionId: id,
                        error: (closeOrderError as Error).message,
                    },
                    "Close order reconciliation failed (non-fatal)",
                );
            }

            // 7. Check if position should be marked as closed
            const refreshedPosition = await this.findById(id, dbTx);
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
                const ledgerService = new UniswapV3LedgerService(
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
                const closedPosition = await this.findById(id, dbTx);
                if (!closedPosition) {
                    throw new Error(
                        `Position not found after close update: ${id}`,
                    );
                }

                // Publish position.closed domain event (transactional via outbox)
                await this.eventPublisher.createAndPublish<PositionClosedPayload>(
                    {
                        type: "position.closed",
                        entityType: "position",
                        entityId: closedPosition.id,
                        userId: closedPosition.userId,
                        payload: closedPosition.toJSON(),
                        source: "ledger-sync",
                    },
                    dbTx,
                );

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

            // 2. Create ledger event service for this position
            const ledgerEventService = new UniswapV3LedgerService(
                { positionId: id },
                { prisma: this._prisma },
            );

            // 3. Capture existing events before deletion so we can emit revert domain events
            const existingEvents = await ledgerEventService.findAll(dbTx);

            // 4. Delete all existing ledger events
            const deletedCount = await ledgerEventService.deleteAll(dbTx);
            this.logger.info(
                { positionId: id, deletedCount },
                "Deleted all existing ledger events",
            );

            // 5. Emit position.liquidity.reverted for each block that had events,
            //    so downstream consumers (e.g. accounting) can clean up derived state
            if (existingEvents.length > 0) {
                const publisher = getDomainEventPublisher();
                const blockHashGroups = new Map<string, number>();
                for (const event of existingEvents) {
                    const bh = event.typedConfig.blockHash;
                    blockHashGroups.set(bh, (blockHashGroups.get(bh) ?? 0) + 1);
                }
                for (const [blockHash, count] of blockHashGroups) {
                    await publisher.createAndPublish<PositionLiquidityRevertedPayload>(
                        {
                            type: "position.liquidity.reverted",
                            entityId: existingPosition.id,
                            entityType: "position",
                            userId: existingPosition.userId,
                            payload: {
                                positionId: existingPosition.id,
                                positionHash: existingPosition.positionHash,
                                chainId,
                                nftId: nftId.toString(),
                                blockHash,
                                deletedCount: count,
                                revertedAt: new Date().toISOString(),
                            },
                            source: "business-logic",
                        },
                        dbTx,
                    );
                }
            }

            // 6. Reimport all events from on-chain and emit insert domain events.
            //    refreshAllPositionLogs() uses mintBlock as fromBlock since there are
            //    no ledger events after the deletion above.
            await this.refreshAllPositionLogs(id, "latest", dbTx);

            // 7. Refresh position state from on-chain data
            this.logger.info(
                { positionId: id },
                "Refreshing position state from on-chain data",
            );

            const refreshedPosition = await this.refreshOnChainState(id, "latest", dbTx);

            this.logger.info(
                {
                    positionId: id,
                    currentValue: refreshedPosition.currentValue.toString(),
                    costBasis: refreshedPosition.costBasis.toString(),
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
     * Sync ledger events from on-chain data without wiping existing events.
     *
     * Fetches all IncreaseLiquidity, DecreaseLiquidity, and Collect events
     * from the position's mint block up to `blockNumber`. Already-imported
     * events are skipped (idempotent). Catch-up reorgs are detected and
     * handled: orphaned events are deleted before new canonical events are
     * inserted. Domain events are emitted in order — all reverts first,
     * then inserts.
     *
     * @param id - Position ID (database CUID)
     * @param blockNumber - Upper bound block ("latest" or specific block number)
     * @param dbTx - Optional Prisma transaction client
     * @returns The import result with per-log outcomes and final aggregates
     * @throws Error if position not found
     * @throws Error if mint block cannot be found on-chain
     */
    async refreshAllPositionLogs(
        id: string,
        blockNumber: number | "latest" = "latest",
        dbTx?: PrismaTransactionClient,
    ): Promise<ImportLogsResult> {
        log.methodEntry(this.logger, "refreshAllPositionLogs", { id, blockNumber });

        const position = await this.findById(id);
        if (!position) {
            throw new Error(`Position not found: ${id}`);
        }

        const chainId = position.chainId;
        const nftId = BigInt(position.nftId);
        const nfpmAddress = getPositionManagerAddress(chainId);
        const deploymentBlock = getNfpmDeploymentBlock(chainId);
        const client = this.evmConfig.getPublicClient(chainId);
        const toBlock: bigint | "latest" =
            blockNumber === "latest" ? "latest" : BigInt(blockNumber);

        const ledgerService = new UniswapV3LedgerService(
            { positionId: id },
            { prisma: this._prisma },
        );

        const lastEvent = await ledgerService.findLast(dbTx);

        let fromBlock: bigint;
        if (!lastEvent) {
            const mintBlock = await findNftMintBlock(
                client,
                nfpmAddress,
                nftId,
                deploymentBlock,
            );
            if (!mintBlock) {
                throw new Error(
                    `Mint block not found for NFT ${nftId} on chain ${chainId}`,
                );
            }
            fromBlock = mintBlock;
        } else {
            const finalityConfig = this.evmConfig.getFinalityConfig(chainId);
            let finalizedBlockNumber: bigint;
            if (finalityConfig.type === "blockTag") {
                const finalizedBlock = await client.getBlock({
                    blockTag: "finalized",
                });
                finalizedBlockNumber = finalizedBlock.number;
            } else {
                const currentBlock = await client.getBlockNumber();
                finalizedBlockNumber =
                    currentBlock - BigInt(finalityConfig.minBlockHeight);
            }
            fromBlock =
                finalizedBlockNumber < lastEvent.typedConfig.blockNumber
                    ? finalizedBlockNumber
                    : lastEvent.typedConfig.blockNumber;
        }

        const logs = await this.fetchAllPositionLogs(
            client,
            nfpmAddress,
            nftId,
            fromBlock,
            toBlock,
        );

        const userWalletAddresses = await this.buildUserWalletAddresses(position.userId);
        const importResult = await ledgerService.importLogsForPosition(
            position,
            chainId,
            logs,
            this.poolPriceService,
            userWalletAddresses,
            dbTx,
        );

        const publisher = getDomainEventPublisher();

        // Emit revert events first (grouped by blockHash)
        const blockHashGroups = new Map<string, number>();
        for (const event of importResult.deletedEvents) {
            const bh = event.typedConfig.blockHash;
            blockHashGroups.set(bh, (blockHashGroups.get(bh) ?? 0) + 1);
        }
        for (const [blockHash, deletedCount] of blockHashGroups) {
            await publisher.createAndPublish<PositionLiquidityRevertedPayload>(
                {
                    type: "position.liquidity.reverted",
                    entityId: position.id,
                    entityType: "position",
                    userId: position.userId,
                    payload: {
                        positionId: position.id,
                        positionHash: position.positionHash,
                        chainId,
                        nftId: nftId.toString(),
                        blockHash,
                        deletedCount,
                        revertedAt: new Date().toISOString(),
                    },
                    source: "business-logic",
                },
                dbTx,
            );
        }

        // Emit insert events after all reverts
        for (const result of importResult.results) {
            if (result.action !== "inserted") continue;
            const { validEventType, amount0, amount1, liquidityDelta, blockTimestamp } =
                result.eventDetail;

            if (validEventType === "COLLECT") {
                const feeDelta =
                    importResult.aggregates.collectedYieldAfter -
                    importResult.preImportAggregates.collectedYieldAfter;
                await publisher.createAndPublish<PositionFeesCollectedPayload>(
                    {
                        type: "position.fees.collected",
                        entityId: position.id,
                        entityType: "position",
                        userId: position.userId,
                        payload: {
                            positionId: position.id,
                            positionHash: position.positionHash,
                            poolId: position.pool.id,
                            chainId,
                            nftId: nftId.toString(),
                            fees0: amount0.toString(),
                            fees1: amount1.toString(),
                            feesValueInQuote: feeDelta.toString(),
                            eventTimestamp: blockTimestamp.toISOString(),
                        },
                        source: "business-logic",
                    },
                    dbTx,
                );
            } else {
                const type =
                    validEventType === "INCREASE_LIQUIDITY"
                        ? ("position.liquidity.increased" as const)
                        : ("position.liquidity.decreased" as const);
                await publisher.createAndPublish<
                    PositionLiquidityIncreasedPayload | PositionLiquidityDecreasedPayload
                >(
                    {
                        type,
                        entityId: position.id,
                        entityType: "position",
                        userId: position.userId,
                        payload: {
                            positionId: position.id,
                            positionHash: position.positionHash,
                            poolId: position.pool.id,
                            chainId,
                            nftId: nftId.toString(),
                            liquidityDelta: liquidityDelta.toString(),
                            liquidityAfter:
                                importResult.aggregates.liquidityAfter.toString(),
                            token0Amount: amount0.toString(),
                            token1Amount: amount1.toString(),
                            eventTimestamp: blockTimestamp.toISOString(),
                        },
                        source: "business-logic",
                    },
                    dbTx,
                );
            }
        }

        log.methodExit(this.logger, "refreshAllPositionLogs", { id });
        return importResult;
    }

    /**
     * Switch quote/base token assignment for a position.
     *
     * Flips `isToken0Quote` in the database, then calls `reset()` to
     * completely rebuild the ledger history with the new orientation.
     * All financial metrics (PnL, fees, cost basis, APR) are recalculated
     * in terms of the new quote token.
     *
     * @param id - Position ID (database CUID)
     * @returns The fully recalculated position with new quote token orientation
     */
    async switchQuoteToken(id: string): Promise<UniswapV3Position> {
        log.methodEntry(this.logger, "switchQuoteToken", { id });

        try {
            // 1. Verify position exists
            const existingPosition = await this.findById(id);
            if (!existingPosition) {
                const error = new Error(`Position not found: ${id}`);
                log.methodError(this.logger, "switchQuoteToken", error, {
                    id,
                });
                throw error;
            }

            // 2. Flip isToken0Quote in the config JSON
            const existingConfig = existingPosition.typedConfig;
            const newIsToken0Quote = !existingConfig.isToken0Quote;

            this.logger.info(
                {
                    positionId: id,
                    previousIsToken0Quote: existingConfig.isToken0Quote,
                    newIsToken0Quote,
                },
                "Flipping isToken0Quote before reset",
            );

            const dbConfig = (await this._prisma.position.findUniqueOrThrow({ where: { id } })).config as Record<string, unknown>;
            await this._prisma.position.update({
                where: { id },
                data: { config: { ...dbConfig, isToken0Quote: newIsToken0Quote } },
            });

            // 3. Call reset() to rebuild the entire ledger with new orientation
            // reset() reads the updated isToken0Quote from DB and recalculates everything
            const result = await this.reset(id);

            this.logger.info(
                {
                    positionId: id,
                    isToken0Quote: result.isToken0Quote,
                    currentValue: result.currentValue.toString(),
                    realizedPnl: result.realizedPnl.toString(),
                    unrealizedPnl: result.unrealizedPnl.toString(),
                },
                "Quote token switch complete",
            );

            log.methodExit(this.logger, "switchQuoteToken", { id });
            return result;
        } catch (error) {
            if (
                !(
                    error instanceof Error &&
                    error.message.includes("not found")
                )
            ) {
                log.methodError(
                    this.logger,
                    "switchQuoteToken",
                    error as Error,
                    { id },
                );
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
     * Fetch position configuration from on-chain data with caching
     *
     * Calls NFPM positions() to get token addresses, fee, and tick bounds.
     * Then calls Factory getPool() to derive the pool address.
     *
     * Position config is immutable for a given NFT, so we cache aggressively.
     * Cache key includes block number for consistency with other fetch methods.
     *
     * @param chainId - Chain ID
     * @param nftId - NFT token ID
     * @param blockNumber - Block number to fetch config at
     * @returns Position config with poolAddress, tickLower, tickUpper, token0, token1, fee
     * @throws Error if position doesn't exist at this block
     * @throws Error if chain is not supported
     */
    private async fetchPositionConfig(
        chainId: number,
        nftId: bigint,
        blockNumber: bigint,
    ): Promise<{
        poolAddress: string;
        tickLower: number;
        tickUpper: number;
        token0: string;
        token1: string;
        fee: number;
    }> {
        // 1. Build cache key (position config is immutable, but key by block for consistency)
        const cacheKey = `uniswapv3-position-config:${chainId}:${nftId}:${blockNumber}`;

        // 2. Check cache
        interface PositionConfigCached {
            poolAddress: string;
            tickLower: number;
            tickUpper: number;
            token0: string;
            token1: string;
            fee: number;
        }
        const cached =
            await this._cacheService.get<PositionConfigCached>(cacheKey);
        if (cached) {
            this.logger.debug(
                {
                    chainId,
                    nftId: nftId.toString(),
                    blockNumber: blockNumber.toString(),
                    cacheHit: true,
                },
                "Position config cache hit",
            );
            return cached;
        }

        // 3. Get public client for chain
        const client = this._evmConfig.getPublicClient(chainId);

        // 4. Get contract addresses
        const positionManagerAddress = getPositionManagerAddress(chainId);
        const factoryAddress = getFactoryAddress(chainId);

        // 5. Call positions(nftId) to get token addresses, fee, and tick bounds
        const positionData = await client.readContract({
            address: positionManagerAddress,
            abi: UNISWAP_V3_POSITION_MANAGER_ABI,
            functionName: "positions",
            args: [nftId],
            blockNumber,
        });

        // positionData is a tuple: [nonce, operator, token0, token1, fee, tickLower, tickUpper, liquidity, ...]
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

        const token0 = normalizeAddress(data[2]);
        const token1 = normalizeAddress(data[3]);
        const fee = data[4];
        const tickLower = data[5];
        const tickUpper = data[6];

        // 6. Call factory.getPool(token0, token1, fee) to get pool address
        const poolAddress = await client.readContract({
            address: factoryAddress,
            abi: UNISWAP_V3_FACTORY_ABI,
            functionName: "getPool",
            args: [token0 as Address, token1 as Address, fee],
            blockNumber,
        });

        const result = {
            poolAddress: normalizeAddress(poolAddress as Address),
            tickLower,
            tickUpper,
            token0,
            token1,
            fee,
        };

        // 7. Cache with long TTL (position config is immutable)
        await this._cacheService.set(cacheKey, result, 86400); // 24 hour TTL

        this.logger.debug(
            {
                chainId,
                nftId: nftId.toString(),
                blockNumber: blockNumber.toString(),
                ...result,
                cacheHit: false,
            },
            "Fetched position config from on-chain and cached",
        );

        return result;
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
     * Fetch current position metrics without persisting to database.
     *
     * Calculates metrics at a specific block number using on-chain data:
     * - currentValue: Position value in quote token (from on-chain liquidity + pool price)
     * - costBasis: Cost basis from ledger events up to block
     * - realizedPnl: Realized PnL from ledger events up to block
     * - unrealizedPnl: currentValue - costBasis
     * - collectedYield: Total collected fees from ledger events up to block
     * - unclaimedYield: Unclaimed fee value from on-chain fee state
     * - lastYieldClaimedAt: Timestamp of last fee collection up to block
     * - priceRangeLower/Upper: Position bounds in quote token price
     *
     * @param id - Position ID
     * @param blockNumber - Block number to fetch state at, or 'latest' for current block
     * @param tx - Optional Prisma transaction client
     * @returns Position metrics (not persisted)
     * @throws Error if position not found
     */
    async fetchMetrics(
        id: string,
        blockNumber: number | "latest" = "latest",
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3PositionMetrics> {
        log.methodEntry(this.logger, "fetchMetrics", { id, blockNumber });

        try {
            // 1. Get existing position (DB read for config/metadata only)
            const position = await this.findById(id, tx);
            if (!position) {
                throw new Error(`Position not found: ${id}`);
            }

            const { chainId, poolAddress, nftId } = position.typedConfig;

            // 2. Fetch on-chain pool state at specified block
            const poolState = await this.poolService.fetchPoolState(
                chainId,
                poolAddress,
                blockNumber,
            );

            // 3. Fetch on-chain position liquidity at specified block
            const liquidity = await this.fetchLiquidity(
                chainId,
                nftId,
                blockNumber,
            );

            // 4. Fetch fee state (unclaimed fees) at specified block
            const feeState = await this.fetchFeeState(id, blockNumber, tx);

            // 5. Get ledger data up to specified block
            const ledgerService = new UniswapV3LedgerService(
                { positionId: id },
                { prisma: this._prisma },
            );
            const latestEvent = await ledgerService.fetchLatestEvent(
                blockNumber,
                tx,
            );
            const lastCollectEvent = await ledgerService.fetchLastCollectEvent(
                blockNumber,
                tx,
            );

            // 6. Extract values from ledger events (or defaults)
            const costBasis = latestEvent?.costBasisAfter ?? 0n;
            const realizedPnl = latestEvent?.pnlAfter ?? 0n;
            const collectedYield = latestEvent?.collectedYieldAfter ?? 0n;
            const lastYieldClaimedAt =
                lastCollectEvent?.timestamp ?? position.positionOpenedAt;

            // 7. Calculate current position value using fetched on-chain data
            const currentValue = calculatePositionValue(
                liquidity,
                poolState.sqrtPriceX96,
                position.tickLower,
                position.tickUpper,
                !position.isToken0Quote, // baseIsToken0
            );

            // 8. Calculate unrealized PnL
            const unrealizedPnl = currentValue - costBasis;

            // 9. Calculate unclaimed fees in quote token from fee state
            const unclaimedYield = calculateTokenValueInQuote(
                feeState.unclaimedFees0,
                feeState.unclaimedFees1,
                poolState.sqrtPriceX96,
                position.isToken0Quote,
                position.pool.token0.decimals,
                position.pool.token1.decimals,
            );

            // 10. Calculate price range (uses static token decimals from position.pool)
            const { priceRangeLower, priceRangeUpper } =
                this.calculatePriceRange(position, position.pool as UniswapV3Pool);

            const metrics: UniswapV3PositionMetrics = {
                currentValue,
                costBasis,
                realizedPnl,
                unrealizedPnl,
                collectedYield,
                unclaimedYield,
                lastYieldClaimedAt,
                priceRangeLower,
                priceRangeUpper,
            };

            this.logger.info(
                {
                    id,
                    blockNumber,
                    currentValue: currentValue.toString(),
                    costBasis: costBasis.toString(),
                    unrealizedPnl: unrealizedPnl.toString(),
                    unclaimedYield: unclaimedYield.toString(),
                },
                "Position metrics fetched",
            );

            log.methodExit(this.logger, "fetchMetrics", { id });
            return metrics;
        } catch (error) {
            if (
                !(error instanceof Error && error.message.includes("not found"))
            ) {
                log.methodError(this.logger, "fetchMetrics", error as Error, {
                    id,
                });
            }
            throw error;
        }
    }

    /**
     * Fetch PnL summary breakdown without persisting to database.
     *
     * Returns:
     * - Realized PnL: collectedYield + realizedPnl (from withdrawn assets)
     * - Unrealized PnL: unclaimedYield + currentValue - costBasis
     * - Total PnL: realized + unrealized
     *
     * @param id - Position ID
     * @param blockNumber - Block number to fetch state at, or 'latest' for current block
     * @param tx - Optional Prisma transaction client
     * @returns PnL summary breakdown (not persisted)
     * @throws Error if position not found
     */
    async fetchPnLSummary(
        id: string,
        blockNumber: number | "latest" = "latest",
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3PositionPnLSummary> {
        log.methodEntry(this.logger, "fetchPnLSummary", { id, blockNumber });

        try {
            // 1. Fetch all metrics (reuse existing method)
            const metrics = await this.fetchMetrics(id, blockNumber, tx);

            // 2. Calculate subtotals
            const realizedSubtotal = metrics.collectedYield + metrics.realizedPnl;
            const unrealizedSubtotal =
                metrics.unclaimedYield +
                metrics.currentValue -
                metrics.costBasis;
            const totalPnl = realizedSubtotal + unrealizedSubtotal;

            const summary: UniswapV3PositionPnLSummary = {
                // Realized
                collectedYield: metrics.collectedYield,
                realizedPnl: metrics.realizedPnl,
                realizedSubtotal,
                // Unrealized
                unclaimedYield: metrics.unclaimedYield,
                currentValue: metrics.currentValue,
                costBasis: metrics.costBasis,
                unrealizedSubtotal,
                // Total
                totalPnl,
            };

            this.logger.info(
                {
                    id,
                    blockNumber,
                    totalPnl: totalPnl.toString(),
                    realizedSubtotal: realizedSubtotal.toString(),
                    unrealizedSubtotal: unrealizedSubtotal.toString(),
                },
                "Position PnL summary fetched",
            );

            log.methodExit(this.logger, "fetchPnLSummary", { id });
            return summary;
        } catch (error) {
            log.methodError(this.logger, "fetchPnLSummary", error as Error, {
                id,
            });
            throw error;
        }
    }

    /**
     * Fetch APR summary breakdown without persisting to database.
     *
     * Returns:
     * - Realized APR: from completed APR periods (fee collections)
     * - Unrealized APR: from current unclaimed fees since last collection
     * - Total APR: time-weighted combination
     *
     * @param id - Position ID
     * @param blockNumber - Block number to fetch state at, or 'latest' for current block
     * @param tx - Optional Prisma transaction client
     * @returns APR summary breakdown (not persisted)
     * @throws Error if position not found
     */
    async fetchAprSummary(
        id: string,
        blockNumber: number | "latest" = "latest",
        tx?: PrismaTransactionClient,
    ): Promise<AprSummary> {
        log.methodEntry(this.logger, "fetchAprSummary", { id, blockNumber });

        try {
            // 1. Get position for opened date
            const position = await this.findById(id, tx);
            if (!position) {
                throw new Error(`Position not found: ${id}`);
            }

            // 2. Fetch metrics for current cost basis and unclaimed fees
            const metrics = await this.fetchMetrics(id, blockNumber, tx);

            // 3. Delegate to AprService for calculation
            const aprService = new UniswapV3AprService(
                { positionId: id },
                { prisma: this._prisma },
            );
            const summary = await aprService.calculateSummary(
                {
                    positionOpenedAt: position.positionOpenedAt,
                    costBasis: metrics.costBasis,
                    unclaimedYield: metrics.unclaimedYield,
                },
                blockNumber,
                tx,
            );

            this.logger.info(
                {
                    id,
                    blockNumber,
                    totalApr: summary.totalApr.toFixed(2),
                    realizedApr: summary.realizedApr.toFixed(2),
                    unrealizedApr: summary.unrealizedApr.toFixed(2),
                    totalActiveDays: summary.totalActiveDays.toFixed(1),
                },
                "Position APR summary fetched",
            );

            log.methodExit(this.logger, "fetchAprSummary", { id });
            return summary;
        } catch (error) {
            log.methodError(this.logger, "fetchAprSummary", error as Error, {
                id,
            });
            throw error;
        }
    }

    /**
     * Fetch all position logs (IncreaseLiquidity, DecreaseLiquidity, Collect)
     *
     * Uses 3 parallel getLogs calls (one per event type) across the full block range.
     * All three events have `uint256 indexed tokenId` as topic[1], so the RPC node
     * resolves each query via its topic index in a single call — no batch scanning.
     *
     * @param client - Viem public client for RPC calls
     * @param nfpmAddress - NonfungiblePositionManager contract address
     * @param nftId - NFT token ID
     * @param fromBlock - Starting block number (usually mint block)
     * @returns Array of raw log inputs compatible with importLogsForPosition
     */
    private async fetchAllPositionLogs(
        client: PublicClient,
        nfpmAddress: Address,
        nftId: bigint,
        fromBlock: bigint,
        toBlock: bigint | "latest" = "latest",
    ): Promise<RawLogInput[]> {
        // All three NFPM events have `uint256 indexed tokenId` as topic[1].
        // The RPC node resolves each query via its topic index in a single call
        // across the full block range — no batch scanning required.
        const increaseLiquidityEvent = parseAbiItem(
            "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
        );
        const decreaseLiquidityEvent = parseAbiItem(
            "event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
        );
        const collectEvent = parseAbiItem(
            "event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)",
        );
        const transferEvent = parseAbiItem(
            "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
        );

        const commonParams = {
            address: nfpmAddress,
            args: { tokenId: nftId },
            fromBlock,
            toBlock,
        };

        // 4 parallel calls — Transfer events include mint (from=0x0) and burn (to=0x0)
        const [increaseLogs, decreaseLogs, collectLogs, transferLogs] = await Promise.all([
            client.getLogs({ ...commonParams, event: increaseLiquidityEvent }),
            client.getLogs({ ...commonParams, event: decreaseLiquidityEvent }),
            client.getLogs({ ...commonParams, event: collectEvent }),
            client.getLogs({ ...commonParams, event: transferEvent }),
        ]);

        // Merge and sort by block number (then log index for same-block ordering)
        const allLogs = [...increaseLogs, ...decreaseLogs, ...collectLogs, ...transferLogs];
        allLogs.sort((a, b) => {
            const blockDiff = Number(a.blockNumber! - b.blockNumber!);
            if (blockDiff !== 0) return blockDiff;
            return a.logIndex! - b.logIndex!;
        });

        // Convert viem log format to RawLogInput
        return allLogs.map((log) => ({
            address: log.address,
            topics: log.topics as unknown as string[],
            data: log.data,
            blockNumber: log.blockNumber!,
            blockHash: log.blockHash!,
            transactionHash: log.transactionHash!,
            transactionIndex: log.transactionIndex!,
            logIndex: log.logIndex!,
        }));
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
    ): Promise<PositionYieldState> {
        log.methodEntry(this.logger, "fetchFeeState", { id, blockNumber });

        try {
            // 1. Get existing position with pool
            const existing = await this.findById(id, tx);
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
            const ledgerEventService = new UniswapV3LedgerService(
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
            const feeState: PositionYieldState = {
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
            const existing = await this.findById(id, db);
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
                data: {
                    state: stateDB as object,
                    ownerWallet: createEvmOwnerWallet(ownerAddress),
                },
            });

            const position = await this.mapToPosition(
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
            const existing = await this.findById(id, db);
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
            });

            const position = await this.mapToPosition(
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
        feeState: PositionYieldState,
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
            const existing = await this.findById(id, db);
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
            });

            const position = await this.mapToPosition(
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
        const ledgerService = new UniswapV3LedgerService(
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
        await this.refreshMetrics(id, "latest", tx);

        // Return the updated position
        const burnedPosition = await this.findById(id, tx);
        if (!burnedPosition) {
            throw new Error(
                `Position not found after burned transition: ${id}`,
            );
        }

        // Publish position.burned domain event (transactional via outbox)
        await this.eventPublisher.createAndPublish<PositionBurnedPayload>(
            {
                type: "position.burned",
                entityType: "position",
                entityId: burnedPosition.id,
                userId: burnedPosition.userId,
                payload: burnedPosition.toJSON(),
                source: "ledger-sync",
            },
            tx,
        );

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
        const existing = await this.findById(id, db);
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
     * - When isBurned becomes true: isActive=false, positionClosedAt is set
     * - When isClosed becomes true: positionClosedAt is set (isActive unchanged)
     * - positionClosedAt is only set on transition to burned (not if already burned)
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
            const existing = await this.findById(id, db);
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
            const becomingInactive = isBurned && wasActive;

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
            });

            const position = await this.mapToPosition(
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
            const existing = await this.findById(id, tx);
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
            const existing = await this.findById(id, tx);
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
    /**
     * Refresh pool-level state fields in position state.
     *
     * Fetches current pool state (sqrtPriceX96, currentTick, liquidity, feeGrowth)
     * from on-chain and persists into position.state JSON.
     */
    private async refreshPoolState(
        id: string,
        blockNumber: number | "latest" = "latest",
        tx?: PrismaTransactionClient,
    ): Promise<void> {
        const db = tx ?? this.prisma;

        const existing = await this.findById(id, db);
        if (!existing) {
            throw new Error(`Position not found: ${id}`);
        }

        const { chainId, poolAddress } = existing.typedConfig;
        const poolState = await this.poolService.fetchPoolState(chainId, poolAddress, blockNumber);

        const currentState = this.parseState(existing.state);
        const updatedState: UniswapV3PositionState = {
            ...currentState,
            sqrtPriceX96: poolState.sqrtPriceX96,
            currentTick: poolState.currentTick,
            poolLiquidity: poolState.liquidity,
            feeGrowthGlobal0: poolState.feeGrowthGlobal0,
            feeGrowthGlobal1: poolState.feeGrowthGlobal1,
        };

        await db.position.update({
            where: { id },
            data: { state: this.serializeState(updatedState) as object },
        });
    }

    private async refreshFeeState(
        id: string,
        blockNumber: number | "latest" = "latest",
        tx?: PrismaTransactionClient,
    ): Promise<PositionYieldState> {
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
     * - costBasis (from ledger)
     * - realizedPnl (from ledger)
     * - unrealizedPnl (currentValue - costBasis)
     * - collectedYield (from ledger)
     * - unclaimedYield (from on-chain state)
     * - lastYieldClaimedAt (from ledger)
     * - priceRangeLower/Upper (from ticks)
     *
     * Also refreshes pool state to ensure accurate price data.
     * Calculates and persists totalApr via UniswapV3AprService.calculateSummary().
     *
     * Note: Does NOT update isActive, isClosed, or positionClosedAt.
     *
     * @param id - Position database ID
     * @param blockNumber - Block number to fetch state at, or 'latest' for current block
     * @param tx - Optional Prisma transaction client
     */
    private async refreshMetrics(
        id: string,
        blockNumber: number | "latest" = "latest",
        tx?: PrismaTransactionClient,
    ): Promise<void> {
        log.methodEntry(this.logger, "refreshMetrics", { id, blockNumber });

        try {
            // 1. Fetch metrics at specified block (does not persist)
            const metrics = await this.fetchMetrics(id, blockNumber, tx);

            // 2. Calculate totalApr (reuses metrics already fetched, only needs APR periods from DB)
            const position = await this.findById(id, tx);
            if (!position) {
                throw new Error(`Position not found: ${id}`);
            }

            const aprService = new UniswapV3AprService(
                { positionId: id },
                { prisma: this._prisma },
            );
            const aprSummary = await aprService.calculateSummary(
                {
                    positionOpenedAt: position.positionOpenedAt,
                    costBasis: metrics.costBasis,
                    unclaimedYield: metrics.unclaimedYield,
                },
                blockNumber,
                tx,
            );
            const persistedApr = aprSummary.belowThreshold ? null : aprSummary.totalApr;

            // 3. Persist metrics to database
            const db = tx ?? this.prisma;

            log.dbOperation(this.logger, "update", "Position", {
                id,
                fields: [
                    "currentValue",
                    "costBasis",
                    "realizedPnl",
                    "unrealizedPnl",
                    "collectedYield",
                    "unclaimedYield",
                    "lastYieldClaimedAt",
                    "config.priceRangeLower",
                    "config.priceRangeUpper",
                    "totalApr",
                ],
            });

            // Read existing config to merge price range updates
            const existingPosition = await db.position.findUniqueOrThrow({ where: { id } });
            const existingConfig = existingPosition.config as Record<string, unknown>;

            await db.position.update({
                where: { id },
                data: {
                    currentValue: metrics.currentValue.toString(),
                    costBasis: metrics.costBasis.toString(),
                    realizedPnl: metrics.realizedPnl.toString(),
                    unrealizedPnl: metrics.unrealizedPnl.toString(),
                    realizedCashflow: "0",
                    unrealizedCashflow: "0",
                    collectedYield: metrics.collectedYield.toString(),
                    unclaimedYield: metrics.unclaimedYield.toString(),
                    lastYieldClaimedAt: metrics.lastYieldClaimedAt,
                    config: {
                        ...existingConfig,
                        priceRangeLower: metrics.priceRangeLower.toString(),
                        priceRangeUpper: metrics.priceRangeUpper.toString(),
                    },
                    totalApr: persistedApr,
                    baseApr: persistedApr,
                    rewardApr: 0,
                },
            });

            this.logger.info(
                {
                    id,
                    currentValue: metrics.currentValue.toString(),
                    costBasis: metrics.costBasis.toString(),
                    unrealizedPnl: metrics.unrealizedPnl.toString(),
                    unclaimedYield: metrics.unclaimedYield.toString(),
                    totalApr: persistedApr?.toFixed(2) ?? null,
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
     * @param configDB - Serialized config for database storage
     * @param stateDB - Serialized state for database storage
     * @param dbTx - Optional Prisma transaction client
     * @returns The created position, or existing position if duplicate found
     */
    async create(
        input: CreateUniswapV3PositionInput,
        configDB: Record<string, unknown>,
        stateDB: Record<string, unknown>,
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3Position> {
        log.methodEntry(this.logger, "create", {
            userId: input.userId,
            chainId: input.config.chainId,
            nftId: input.config.nftId,
        });

        const db = dbTx ?? this.prisma;

        try {
            // Check for existing position by positionHash (fast indexed lookup)
            const positionHash = this.createHash({
                chainId: input.config.chainId,
                nftId: input.config.nftId,
            });
            const existing = await this.findByPositionHash(
                input.userId,
                positionHash,
                dbTx,
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
                userId: input.userId,
                positionHash,
            });

            // Merge isToken0Quote and initial price range into config JSON
            const configWithQuoteToken = {
                ...(configDB as object as Record<string, unknown>),
                isToken0Quote: input.isToken0Quote,
                priceRangeLower: zeroValue,
                priceRangeUpper: zeroValue,
            };

            const ownerAddr = (stateDB as Record<string, unknown>).ownerAddress as string;

            const result = await db.position.create({
                data: {
                    type: "LP_CONCENTRATED",
                    protocol: input.protocol,
                    userId: input.userId,
                    positionHash,
                    ownerWallet: ownerAddr ? createEvmOwnerWallet(ownerAddr) : undefined,
                    config: configWithQuoteToken as object,
                    state: stateDB as object,
                    // Default calculated values
                    currentValue: zeroValue,
                    costBasis: zeroValue,
                    realizedPnl: zeroValue,
                    unrealizedPnl: zeroValue,
                    // Cash flow fields for non-AMM protocols (always 0 for UniswapV3)
                    realizedCashflow: zeroValue,
                    unrealizedCashflow: zeroValue,
                    collectedYield: zeroValue,
                    unclaimedYield: zeroValue,
                    lastYieldClaimedAt: now,
                    positionOpenedAt: input.positionOpenedAt ?? now,
                    positionClosedAt: null,
                    isActive: true,
                },
            });

            // Map database result to Position type
            const position = await this.mapToPosition(result as PositionDbResult);

            this.logger.info(
                {
                    id: position.id,
                    protocol: position.protocol,
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
     * @param tx - Optional Prisma transaction client (required when reading
     *             within an interactive transaction to see uncommitted writes)
     * @returns Position if found and is uniswapv3 protocol, null otherwise
     */
    async findById(id: string, tx?: PrismaTransactionClient): Promise<UniswapV3Position | null> {
        log.methodEntry(this.logger, "findById", { id });

        const db = tx ?? this.prisma;

        try {
            log.dbOperation(this.logger, "findUnique", "Position", { id });

            const result = await db.position.findUnique({
                where: { id },
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
            const position = await this.mapToPosition(result as any);

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

        // Fetch full position (with pool+tokens) before deletion for event payload
        const existing = await this.findById(id);

        if (!existing) {
            this.logger.debug(
                { id },
                "Position not found, delete operation is no-op",
            );
            log.methodExit(this.logger, "delete", { id, deleted: false });
            return;
        }

        // Delete the position (cascades ledger events, APR periods, close orders, etc.)
        log.dbOperation(this.logger, "delete", "Position", { id });
        await this.prisma.position.delete({
            where: { id },
        });

        // Publish position.deleted domain event for accounting cleanup
        await this.eventPublisher.createAndPublish<PositionDeletedPayload>(
            {
                type: "position.deleted",
                entityType: "position",
                entityId: existing.id,
                userId: existing.userId,
                payload: existing.toJSON(),
                source: "api",
            },
        );

        log.methodExit(this.logger, "delete", { id, deleted: true });
    }

    // ============================================================================
    // HELPER METHODS - FINANCIAL CALCULATIONS
    // ============================================================================

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
        const baseTokenAddress = (baseToken as Erc20Token).address;
        const quoteTokenAddress = (quoteToken as Erc20Token).address;
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
     * @param dbTx - Optional Prisma transaction client
     * @returns Position if found, null otherwise
     */
    async findByPositionHash(
        userId: string,
        positionHash: string,
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3Position | null> {
        log.methodEntry(this.logger, "findByPositionHash", {
            userId,
            positionHash,
        });

        const db = dbTx ?? this.prisma;

        try {
            log.dbOperation(this.logger, "findFirst", "Position", {
                userId,
                positionHash,
            });

            const result = await db.position.findFirst({
                where: {
                    userId,
                    positionHash,
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
            const position = await this.mapToPosition(result as PositionDbResult);

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
            });

            // Map to Position type
            const position = await this.mapToPosition(result as PositionDbResult);

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
     * Resolves token0/token1 from the position config JSON (token0Address, token1Address, chainId),
     * converts string values to bigint for numeric fields,
     * and uses PositionFactory to create protocol-specific position class.
     *
     * @param dbResult - Raw database result from Prisma
     * @returns UniswapV3Position instance
     */
    protected async mapToPosition(dbResult: PositionDbResult): Promise<PositionInterface> {
        // Resolve tokens from position config (token0Address, token1Address, chainId)
        const config = dbResult.config as Record<string, unknown>;
        const token0Address = config.token0Address as string;
        const token1Address = config.token1Address as string;
        const chainId = config.chainId as number;

        const [token0Row, token1Row] = await Promise.all([
            this.prisma.token.findUnique({
                where: { tokenHash: createErc20TokenHash(chainId, token0Address) },
            }),
            this.prisma.token.findUnique({
                where: { tokenHash: createErc20TokenHash(chainId, token1Address) },
            }),
        ]);

        if (!token0Row) {
            throw new Error(`Token not found for address ${token0Address} on chain ${chainId}`);
        }
        if (!token1Row) {
            throw new Error(`Token not found for address ${token1Address} on chain ${chainId}`);
        }

        const token0 = Erc20Token.fromDB(token0Row as Erc20TokenRow);
        const token1 = Erc20Token.fromDB(token1Row as Erc20TokenRow);

        // Convert string bigint fields to native bigint
        const rowWithBigInt: PositionRow = {
            id: dbResult.id,
            positionHash: dbResult.positionHash ?? "",
            userId: dbResult.userId,
            type: dbResult.type,
            protocol: dbResult.protocol,
            currentValue: BigInt(dbResult.currentValue),
            costBasis: BigInt(dbResult.costBasis),
            realizedPnl: BigInt(dbResult.realizedPnl),
            unrealizedPnl: BigInt(dbResult.unrealizedPnl),
            realizedCashflow: BigInt(dbResult.realizedCashflow),
            unrealizedCashflow: BigInt(dbResult.unrealizedCashflow),
            collectedYield: BigInt(dbResult.collectedYield),
            unclaimedYield: BigInt(dbResult.unclaimedYield),
            lastYieldClaimedAt: dbResult.lastYieldClaimedAt,
            baseApr: dbResult.baseApr,
            rewardApr: dbResult.rewardApr,
            totalApr: dbResult.totalApr,
            positionOpenedAt: dbResult.positionOpenedAt,
            positionClosedAt: dbResult.positionClosedAt,
            isActive: dbResult.isActive,
            config: dbResult.config,
            state: dbResult.state,
            createdAt: dbResult.createdAt,
            updatedAt: dbResult.updatedAt,
        };

        // Use factory to create protocol-specific position class with direct token references
        return PositionFactory.fromDB(rowWithBigInt, token0, token1);
    }
}
