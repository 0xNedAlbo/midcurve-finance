/**
 * UniswapV3 Vault Position Service
 *
 * Service layer for managing vault share positions.
 * Follows the same architecture as UniswapV3PositionService:
 * - discover() creates position from on-chain vault data
 * - refresh() orchestrates ledger sync + state refresh
 * - reset() rebuilds ledger from scratch
 * - 15-second refresh cache
 * - Finalized block boundaries for reorg safety
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import {
    UniswapV3VaultPosition,
    UniswapV3VaultPositionConfig,
    vaultPositionStateToJSON,
    normalizeAddress,
    UniswapV3VaultAbi,
} from '@midcurve/shared';
import type {
    UniswapV3VaultPositionRow,
    UniswapV3VaultPositionConfigData,
    UniswapV3VaultPositionState,
    UniswapV3VaultPositionConfigJSON,
    TokenInterface,
    SharedContractName,
} from '@midcurve/shared';
import type { Address, PublicClient } from 'viem';
import { parseAbiItem } from 'viem';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { getDomainEventPublisher } from '../../events/index.js';
import type {
    DomainEventPublisher,
    PositionLifecyclePayload,
    PositionLedgerEventPayload,
    PositionLiquidityRevertedPayload,
} from '../../events/index.js';
import { EvmConfig } from '../../config/evm.js';
import { UNISWAP_V3_POSITION_MANAGER_ABI } from '../../config/uniswapv3.js';
import { UniswapV3PoolService } from '../pool/uniswapv3-pool-service.js';
import type { PrismaTransactionClient } from '../../clients/prisma/index.js';
import { UniswapV3QuoteTokenService } from '../quote-token/uniswapv3-quote-token-service.js';
import { EvmBlockService } from '../block/evm-block-service.js';
import { UniswapV3PoolPriceService } from '../pool-price/uniswapv3-pool-price-service.js';
import {
    UniswapV3VaultLedgerService,
    type VaultRawLogInput,
    type VaultPoolPriceMap,
} from '../position-ledger/uniswapv3-vault-ledger-service.js';
import { prefetchPoolPrices } from '../pool-price/pool-price-prefetch.js';
import { CacheService } from '../cache/index.js';
import { SharedContractService } from '../automation/shared-contract-service.js';
import { Erc20TokenService } from '../token/erc20-token-service.js';
import {
    UniswapV3CloseOrderService,
    type CloseOrderChainRead,
} from '../close-order/uniswapv3-close-order-service.js';
import { tickToPrice, createErc20TokenHash, createEvmOwnerWallet, calculatePositionValue } from '@midcurve/shared';
import { calculateTokenValueInQuote } from '../../utils/uniswapv3/ledger-calculations.js';
import { UniswapV3AprService } from '../position-apr/uniswapv3-apr-service.js';

// ============================================================================
// CACHE TYPES
// ============================================================================

/**
 * On-chain vault state fetched from RPC.
 * Cached by block number for consistency and deduplication.
 */
interface OnChainVaultState {
    blockNumber: bigint;
    sharesBalance: bigint;
    totalSupply: bigint;
    liquidity: bigint;
    unclaimedFees0: bigint;
    unclaimedFees1: bigint;
    sqrtPriceX96: bigint;
    currentTick: number;
    poolLiquidity: bigint;
    feeGrowthGlobal0: bigint;
    feeGrowthGlobal1: bigint;
    positionManagerAddress: string;
    operatorAddress: string;
}

/** Serialized version for CacheService (bigints as strings) */
interface OnChainVaultStateCached {
    blockNumber: string;
    sharesBalance: string;
    totalSupply: string;
    liquidity: string;
    unclaimedFees0: string;
    unclaimedFees1: string;
    sqrtPriceX96: string;
    currentTick: number;
    poolLiquidity: string;
    feeGrowthGlobal0: string;
    feeGrowthGlobal1: string;
    positionManagerAddress: string;
    operatorAddress: string;
}

function serializeVaultState(state: OnChainVaultState): OnChainVaultStateCached {
    return {
        blockNumber: state.blockNumber.toString(),
        sharesBalance: state.sharesBalance.toString(),
        totalSupply: state.totalSupply.toString(),
        liquidity: state.liquidity.toString(),
        unclaimedFees0: state.unclaimedFees0.toString(),
        unclaimedFees1: state.unclaimedFees1.toString(),
        sqrtPriceX96: state.sqrtPriceX96.toString(),
        currentTick: state.currentTick,
        poolLiquidity: state.poolLiquidity.toString(),
        feeGrowthGlobal0: state.feeGrowthGlobal0.toString(),
        feeGrowthGlobal1: state.feeGrowthGlobal1.toString(),
        positionManagerAddress: state.positionManagerAddress,
        operatorAddress: state.operatorAddress,
    };
}

function deserializeVaultState(cached: OnChainVaultStateCached): OnChainVaultState {
    return {
        blockNumber: BigInt(cached.blockNumber),
        sharesBalance: BigInt(cached.sharesBalance),
        totalSupply: BigInt(cached.totalSupply),
        liquidity: BigInt(cached.liquidity),
        unclaimedFees0: BigInt(cached.unclaimedFees0),
        unclaimedFees1: BigInt(cached.unclaimedFees1),
        sqrtPriceX96: BigInt(cached.sqrtPriceX96),
        currentTick: cached.currentTick,
        // Default to 0 for backward-compat with cache entries written before
        // pool-level fields were added.
        poolLiquidity: BigInt(cached.poolLiquidity ?? '0'),
        feeGrowthGlobal0: BigInt(cached.feeGrowthGlobal0 ?? '0'),
        feeGrowthGlobal1: BigInt(cached.feeGrowthGlobal1 ?? '0'),
        positionManagerAddress: cached.positionManagerAddress,
        operatorAddress: cached.operatorAddress,
    };
}

// ============================================================================
// REFRESH PLAN
// ============================================================================

/**
 * Everything a refresh needs from the network, resolved before any transaction
 * is opened.
 *
 * Produced by `planRefresh`, consumed by `applyRefresh`. The split keeps RPC
 * round-trips — which can run to seconds on a full history scan — out of the
 * write transaction.
 */
interface VaultRefreshPlan {
    /** Position as of phase 1. Re-read inside the transaction before writing. */
    position: UniswapV3VaultPosition;
    /** Block the on-chain state was read at, or 'latest' */
    blockNumber: number | 'latest';
    /** Vault and closer logs from `fromBlock` to head */
    logs: VaultRawLogInput[];
    /** Pool price at every block covered by `logs` */
    poolPrices: VaultPoolPriceMap;
    /** Closer contract for this chain, when one is deployed */
    closerAddress?: Address;
    /** Vault state at `blockNumber` */
    onChainState: OnChainVaultState;
    /** Close-order slots, or null when skipped or unreadable */
    closeOrders: CloseOrderChainRead | null;
}

// ============================================================================
// DEPENDENCIES
// ============================================================================

export interface UniswapV3VaultPositionServiceDependencies {
    prisma?: PrismaClient;
    eventPublisher?: DomainEventPublisher;
    evmConfig?: EvmConfig;
    poolService?: UniswapV3PoolService;
    quoteTokenService?: UniswapV3QuoteTokenService;
    evmBlockService?: EvmBlockService;
    poolPriceService?: UniswapV3PoolPriceService;
    cacheService?: CacheService;
    sharedContractService?: SharedContractService;
    erc20TokenService?: Erc20TokenService;
    closeOrderService?: UniswapV3CloseOrderService;
}

// ============================================================================
// SERVICE
// ============================================================================

export class UniswapV3VaultPositionService {
    private readonly prisma: PrismaClient;
    private readonly logger: ServiceLogger;
    private readonly eventPublisher: DomainEventPublisher;
    private readonly _evmConfig: EvmConfig;
    private readonly _poolService: UniswapV3PoolService;
    private readonly _quoteTokenService: UniswapV3QuoteTokenService;
    private readonly _evmBlockService: EvmBlockService;
    private readonly _poolPriceService: UniswapV3PoolPriceService;
    private readonly _cacheService: CacheService;
    private readonly _sharedContractService: SharedContractService;
    private readonly _erc20TokenService: Erc20TokenService;
    private readonly _closeOrderService: UniswapV3CloseOrderService;

    constructor(deps: UniswapV3VaultPositionServiceDependencies = {}) {
        this.prisma = deps.prisma ?? prismaClient;
        this.logger = createServiceLogger('uniswapv3-vault-position');
        this.eventPublisher = deps.eventPublisher ?? getDomainEventPublisher();
        this._evmConfig = deps.evmConfig ?? EvmConfig.getInstance();
        this._poolService = deps.poolService ?? new UniswapV3PoolService();
        this._quoteTokenService = deps.quoteTokenService ?? new UniswapV3QuoteTokenService();
        this._evmBlockService = deps.evmBlockService ?? new EvmBlockService({ evmConfig: this._evmConfig });
        this._poolPriceService = deps.poolPriceService ?? new UniswapV3PoolPriceService();
        this._cacheService = deps.cacheService ?? CacheService.getInstance();
        this._sharedContractService = deps.sharedContractService ?? new SharedContractService();
        this._erc20TokenService = deps.erc20TokenService ?? new Erc20TokenService();
        this._closeOrderService = deps.closeOrderService ?? new UniswapV3CloseOrderService();
    }

    // ============================================================================
    // QUERY METHODS
    // ============================================================================

    async findById(
        id: string,
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3VaultPosition | null> {
        const db = tx ?? this.prisma;
        const row = await db.position.findFirst({
            where: { id, protocol: 'uniswapv3-vault' },
        });
        if (!row) return null;
        return this.mapToPosition(row as unknown as UniswapV3VaultPositionRow);
    }

    async findByPositionHash(
        userId: string,
        positionHash: string,
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3VaultPosition | null> {
        const db = tx ?? this.prisma;
        const row = await db.position.findFirst({
            where: { userId, positionHash, protocol: 'uniswapv3-vault' },
        });
        if (!row) return null;
        return this.mapToPosition(row as unknown as UniswapV3VaultPositionRow);
    }

    async delete(id: string): Promise<void> {
        const position = await this.findById(id);
        if (!position) return;

        // Serialize before deletion (position data needed for event payload)
        const positionJSON = position.toJSON();

        await this.prisma.$transaction(async (tx) => {
            await tx.position.delete({ where: { id } });

            await this.eventPublisher.createAndPublish<PositionLifecyclePayload>({
                type: 'position.deleted',
                entityType: 'position',
                entityId: position.id,
                userId: position.userId,
                payload: {
                    positionId: position.id,
                    positionHash: positionJSON.positionHash,
                },
                source: 'api',
            }, tx);
        });

        this.logger.info({ positionId: id, vaultAddress: position.vaultAddress }, 'Vault position deleted');
    }

    // ============================================================================
    // DISCOVER
    // ============================================================================

    /**
     * Block-height wait used to mitigate the RPC load-balancing race during
     * vault discovery: the createVault tx receipt may be visible on one backend
     * node behind the RPC endpoint while another node in the same pool — the
     * one our reads will hit — has not yet caught up. We poll the RPC's head
     * until it reports having reached `targetBlock`, then proceed.
     *
     * Same-RPC pool consistency is not guaranteed after this returns (different
     * requests can still land on different backends), but in practice once one
     * sampled node has crossed the target block the rest of the pool catches
     * up within a few hundred milliseconds. The caller pairs this with a single
     * retry to cover residual jitter.
     */
    private async waitForBlock(
        client: PublicClient,
        targetBlock: bigint,
        chainId: number,
        vaultAddress: string,
    ): Promise<void> {
        const POLL_INTERVAL_MS = 250;
        const TIMEOUT_MS = 5_000;
        const startedAt = Date.now();
        let lastSeen: bigint | null = null;
        while (true) {
            try {
                lastSeen = await client.getBlockNumber();
                if (lastSeen >= targetBlock) return;
            } catch (err) {
                this.logger.warn(
                    { chainId, vaultAddress, err: err instanceof Error ? err.message : String(err) },
                    'getBlockNumber failed while waiting for block; will retry',
                );
            }
            if (Date.now() - startedAt >= TIMEOUT_MS) {
                throw new Error(
                    `RPC_LAG: Timed out after ${TIMEOUT_MS}ms waiting for block ${targetBlock.toString()} on chain ${chainId} (last seen: ${lastSeen?.toString() ?? 'n/a'})`,
                );
            }
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        }
    }

    async discover(
        userId: string,
        params: {
            chainId: number;
            vaultAddress: string;
            ownerAddress: string;
            quoteTokenAddress?: string;
            /**
             * Block number at which the vault was created (from the createVault tx
             * receipt). When provided, the on-chain reads below are pinned to this
             * block and the RPC is polled until it reports a head >= atBlock — this
             * eliminates the load-balanced RPC race where the receipt is visible on
             * one backend node but the just-deployed bytecode isn't yet visible on
             * the node serving our reads.
             */
            atBlock?: bigint;
        },
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3VaultPosition> {
        const { chainId, ownerAddress, atBlock } = params;
        const vaultAddress = normalizeAddress(params.vaultAddress);

        // Check for existing position
        const positionHash = UniswapV3VaultPosition.createHash(chainId, vaultAddress, ownerAddress);
        const existing = await this.findByPositionHash(userId, positionHash, dbTx);
        if (existing) {
            return this.refresh(existing.id, 'latest', dbTx);
        }

        const client = this._evmConfig.getPublicClient(chainId);

        // If the caller pinned a block, wait until the RPC reports having reached
        // it before issuing the reads. Different load-balanced backends behind a
        // single RPC endpoint can be at different heights; this turns the
        // "node-behind" race into a deterministic wait.
        if (atBlock !== undefined) {
            await this.waitForBlock(client, atBlock, chainId, vaultAddress);
        }

        const blockOpt = atBlock !== undefined ? { blockNumber: atBlock } : {};

        // Read vault contract state in parallel. One retry on failure as a cheap
        // safety net for the case where the head sample (above) hit a node ahead
        // of the one serving a particular read in the batch.
        let token0Addr: string, token1Addr: string, tokenId: bigint, poolAddr: string,
            tickLower: number, tickUpper: number, vaultDecimals: number, positionManagerAddr: string;
        const readVaultMetadata = () => Promise.all([
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'token0', ...blockOpt }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'token1', ...blockOpt }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'tokenId', ...blockOpt }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'pool', ...blockOpt }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'tickLower', ...blockOpt }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'tickUpper', ...blockOpt }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'decimals', ...blockOpt }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'positionManager', ...blockOpt }),
        ]) as Promise<[string, string, bigint, string, number, number, number, string]>;
        try {
            [token0Addr, token1Addr, tokenId, poolAddr, tickLower, tickUpper, vaultDecimals, positionManagerAddr] =
                await readVaultMetadata();
        } catch (firstError) {
            this.logger.warn(
                { chainId, vaultAddress, atBlock: atBlock?.toString(), err: firstError instanceof Error ? firstError.message : String(firstError) },
                'Vault metadata read failed, retrying once',
            );
            await new Promise(resolve => setTimeout(resolve, 250));
            try {
                [token0Addr, token1Addr, tokenId, poolAddr, tickLower, tickUpper, vaultDecimals, positionManagerAddr] =
                    await readVaultMetadata();
            } catch (retryError) {
                const cause = retryError instanceof Error ? retryError.message : String(retryError);
                throw new Error(`INVALID_VAULT_CONTRACT: Could not read vault metadata at ${vaultAddress} on chain ${chainId}: ${cause}`);
            }
        }

        // Read user state + operator (pinned to atBlock if provided)
        const [sharesBalance, totalSupply, claimable, operatorAddr] = await Promise.all([
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'balanceOf', args: [ownerAddress as Address], ...blockOpt }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'totalSupply', ...blockOpt }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'claimableYield', args: [ownerAddress as Address], ...blockOpt }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'operator', ...blockOpt }),
        ]) as [bigint, bigint, readonly bigint[], string];

        // Read liquidity from NFPM (pinned to atBlock if provided)
        const positionData = await client.readContract({
            address: positionManagerAddr as Address,
            abi: UNISWAP_V3_POSITION_MANAGER_ABI,
            functionName: 'positions',
            args: [tokenId],
            ...blockOpt,
        }) as readonly [bigint, string, string, string, number, number, number, bigint, bigint, bigint, bigint, bigint];
        const liquidity = positionData[7];
        const fee = positionData[4] as number;

        // Discover tokens
        const [token0, token1] = await Promise.all([
            this._erc20TokenService.discover({ address: normalizeAddress(token0Addr as string), chainId }),
            this._erc20TokenService.discover({ address: normalizeAddress(token1Addr as string), chainId }),
        ]);

        // Discover pool
        const pool = await this._poolService.discover({
            chainId,
            poolAddress: normalizeAddress(poolAddr as string),
        });

        // Determine quote token
        let isToken0Quote: boolean;
        if (params.quoteTokenAddress) {
            isToken0Quote = normalizeAddress(params.quoteTokenAddress).toLowerCase() === token0.address.toLowerCase();
        } else {
            const result = await this._quoteTokenService.determineQuoteToken({
                userId,
                chainId,
                token0Address: token0.address,
                token1Address: token1.address,
            });
            isToken0Quote = result.isToken0Quote;
        }

        // Get factory address from SharedContract
        const factory = await this._sharedContractService.findLatestByChainAndName(
            chainId,
            'UniswapV3VaultFactory' as SharedContractName,
        );
        const factoryAddress = factory?.config?.address as string ?? '';

        // Calculate price range (quote per base, using tickToPrice from shared)
        const baseTokenAddr = isToken0Quote ? token1.address : token0.address;
        const quoteTokenAddr = isToken0Quote ? token0.address : token1.address;
        const baseDecimals = isToken0Quote ? token1.decimals : token0.decimals;
        const priceRangeLower = tickToPrice(tickLower as number, baseTokenAddr, quoteTokenAddr, baseDecimals);
        const priceRangeUpper = tickToPrice(tickUpper as number, baseTokenAddr, quoteTokenAddr, baseDecimals);

        // Read pool state (slot0, liquidity, feeGrowthGlobal0/1) — single
        // cached call via the pool service, replacing four separate manual
        // contract reads that previously omitted feeGrowthGlobal0/1.
        const poolStateOnDiscover = await this._poolService.fetchPoolState(
            chainId,
            normalizeAddress(poolAddr as string),
        );

        // Build config and state
        const configData: UniswapV3VaultPositionConfigData = {
            chainId,
            vaultAddress,
            underlyingTokenId: Number(tokenId),
            factoryAddress,
            ownerAddress: normalizeAddress(ownerAddress),
            poolAddress: normalizeAddress(poolAddr as string),
            token0Address: token0.address,
            token1Address: token1.address,
            feeBps: fee,
            tickSpacing: pool.typedConfig.tickSpacing,
            tickLower: tickLower as number,
            tickUpper: tickUpper as number,
            vaultDecimals: vaultDecimals as number,
            isToken0Quote,
            priceRangeLower,
            priceRangeUpper,
        };

        const stateData: UniswapV3VaultPositionState = {
            sharesBalance: sharesBalance as bigint,
            totalSupply: totalSupply as bigint,
            liquidity,
            unclaimedFees0: claimable[0] ?? 0n,
            unclaimedFees1: claimable[1] ?? 0n,
            operatorAddress: normalizeAddress(operatorAddr as string),
            isClosed: sharesBalance === 0n,
            isOwnedByUser: true, // Will be recalculated when vault perimeter is implemented
            sqrtPriceX96: poolStateOnDiscover.sqrtPriceX96,
            currentTick: poolStateOnDiscover.currentTick,
            poolLiquidity: poolStateOnDiscover.liquidity,
            feeGrowthGlobal0: poolStateOnDiscover.feeGrowthGlobal0,
            feeGrowthGlobal1: poolStateOnDiscover.feeGrowthGlobal1,
        };

        // Get vault creation timestamp from first mint Transfer log
        const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
        const mintLogs = await client.getLogs({
            address: vaultAddress as Address,
            event: transferEvent,
            args: { from: '0x0000000000000000000000000000000000000000' as Address, to: ownerAddress as Address },
            fromBlock: 'earliest',
            toBlock: 'latest',
        });
        const firstMintBlock = mintLogs[0]?.blockNumber;
        const positionOpenedAt = firstMintBlock
            ? new Date(Number((await client.getBlock({ blockNumber: firstMintBlock })).timestamp) * 1000)
            : new Date();

        // Create position in DB
        const position = await this.createPosition(
            userId, positionHash, configData, stateData, token0, token1, positionOpenedAt, dbTx,
        );

        // Refresh imports ledger events, emits domain events, and finalizes metrics
        return this.refresh(position.id, 'latest', dbTx);
    }

    // ============================================================================
    // REFRESH
    // ============================================================================

    /**
     * Sync a vault position with the chain: import new ledger events, update
     * on-chain state and metrics, reconcile close orders.
     *
     * Runs in two phases, and the split is load-bearing:
     *
     *  1. {@link planRefresh} does every network read — event logs, the pool
     *     price at each event block, vault state, close orders — with no
     *     transaction open.
     *  2. {@link applyRefresh} does every database write inside one short
     *     transaction.
     *
     * Holding a transaction across phase 1 is what used to blow Prisma's
     * interactive-transaction timeout and surface as "Transaction not found"
     * from whichever query happened to run first after the RPC calls.
     *
     * @param id - Vault position ID
     * @param blockNumber - Block to read on-chain state at, or 'latest'
     * @param dbTx - Transaction to write in. When omitted, one is opened for
     *   phase 2 only. Passing one puts the caller back in charge of the
     *   timeout, so only do that if the caller's transaction is already short.
     */
    async refresh(
        id: string,
        blockNumber: number | 'latest' = 'latest',
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3VaultPosition> {
        const plan = await this.planRefresh(id, blockNumber, { includeCloseOrders: true }, dbTx);
        return this.applyRefresh(plan, dbTx);
    }

    // ============================================================================
    // RESET
    // ============================================================================

    /**
     * Drop the ledger and rebuild it from the vault's full on-chain history.
     *
     * Same two-phase shape as {@link refresh}: the plan is built with an
     * explicit `fromBlock` of 0 rather than from the last stored event, because
     * the events it would be derived from are deleted in phase 2. That keeps the
     * log fetch outside the transaction that does the deleting.
     */
    async reset(
        id: string,
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3VaultPosition> {
        const plan = await this.planRefresh(id, 'latest', {
            fromBlock: 0n,
            includeCloseOrders: false,
        }, dbTx);
        return this.applyRefresh(plan, dbTx, { clearLedgerFirst: true });
    }

    /**
     * Delete every ledger event and emit a revert event per affected block.
     * Phase-2 work — callers must already hold `tx`.
     */
    private async clearLedger(
        position: UniswapV3VaultPosition,
        tx: PrismaTransactionClient,
    ): Promise<void> {
        const ledgerService = new UniswapV3VaultLedgerService(
            { positionId: position.id },
            { prisma: this.prisma },
        );

        // Capture events for domain event emission
        const existingEvents = await ledgerService.findAll(tx);

        // Delete all events
        await ledgerService.deleteAll(tx);

        // Emit revert events grouped by blockHash
        const publisher = getDomainEventPublisher();
        const blockHashGroups = new Map<string, number>();
        for (const event of existingEvents) {
            const bh = event.typedConfig.blockHash;
            blockHashGroups.set(bh, (blockHashGroups.get(bh) ?? 0) + 1);
        }
        for (const [blockHash, deletedCount] of blockHashGroups) {
            await publisher.createAndPublish<PositionLiquidityRevertedPayload>({
                type: 'position.liquidity.reverted',
                entityId: position.id,
                entityType: 'position',
                userId: position.userId,
                payload: {
                    positionId: position.id,
                    positionHash: position.positionHash,
                    blockHash,
                    deletedCount,
                    revertedAt: new Date().toISOString(),
                },
                source: 'business-logic',
            }, tx);
        }
    }

    // ============================================================================
    // SWITCH QUOTE TOKEN
    // ============================================================================

    async switchQuoteToken(id: string): Promise<UniswapV3VaultPosition> {
        const position = await this.findById(id);
        if (!position) throw new Error(`Vault position not found: ${id}`);

        // Flip isToken0Quote and recalculate price range
        const config = position.typedConfig;
        const newIsToken0Quote = !config.isToken0Quote;
        const baseAddr = newIsToken0Quote ? config.token1Address : config.token0Address;
        const quoteAddr = newIsToken0Quote ? config.token0Address : config.token1Address;
        const baseDec = newIsToken0Quote ? position.token1.decimals : position.token0.decimals;
        const priceRangeLower = tickToPrice(config.tickLower, baseAddr, quoteAddr, baseDec);
        const priceRangeUpper = tickToPrice(config.tickUpper, baseAddr, quoteAddr, baseDec);

        // Update config in DB
        const currentConfigJSON = position.config as Record<string, unknown>;
        await this.prisma.position.update({
            where: { id },
            data: {
                config: {
                    ...currentConfigJSON,
                    isToken0Quote: newIsToken0Quote,
                    priceRangeLower: priceRangeLower.toString(),
                    priceRangeUpper: priceRangeUpper.toString(),
                },
            },
        });

        return this.reset(id);
    }

    // ============================================================================
    // PRIVATE: REFRESH PHASE 1 — NETWORK
    // ============================================================================

    /**
     * Read everything the refresh needs from the chain. No transaction is open
     * while this runs and nothing here writes position or ledger rows.
     *
     * The only database access is the handful of short reads needed to know
     * *what* to fetch (the position itself, the last stored event, the closer
     * contract address). Those are deliberately unscoped: a concurrent writer
     * moving the last event only changes where the log scan starts, and the
     * import deduplicates by input hash regardless.
     */
    private async planRefresh(
        id: string,
        blockNumber: number | 'latest',
        options: { fromBlock?: bigint; includeCloseOrders: boolean },
        dbTx?: PrismaTransactionClient,
    ): Promise<VaultRefreshPlan> {
        // `dbTx` is only for the locating reads. It is set when the caller
        // already holds a transaction — discover() creating a position and
        // refreshing it in one — where these rows are not committed yet.
        const position = await this.findById(id, dbTx);
        if (!position) throw new Error(`Vault position not found: ${id}`);

        const chainId = position.chainId;
        const vaultAddress = position.vaultAddress;
        const ownerAddress = position.typedConfig.ownerAddress;
        const client = this._evmConfig.getPublicClient(chainId);

        // Where to start the log scan. reset() pins this to 0; an incremental
        // refresh resumes from the last stored event.
        let fromBlock = options.fromBlock;
        if (fromBlock === undefined) {
            const ledgerService = new UniswapV3VaultLedgerService(
                { positionId: id },
                { prisma: this.prisma },
            );
            const lastEvent = await ledgerService.findLast(dbTx);
            // No events yet → full sync from block 0. Refine once we track the
            // vault deployment block.
            fromBlock = lastEvent ? lastEvent.blockNumber : 0n;
        }

        // Look up the closer contract for this chain, once. This used to be
        // resolved here *and* again inside fetchChainSnapshot, and the two
        // reacted to "not registered" differently: this one fell through
        // silently and skipped the closer's event logs, the other threw. One
        // lookup, one reaction, one log line (#86).
        const closer = await this._closeOrderService.resolveCloserContract(
            chainId,
            position.protocol,
        );
        const closerAddress = closer?.address as Address | undefined;

        if (!closer) {
            // Said out loud rather than left as a branch that quietly does less
            // work. Note the scope: without the closer address the OrderExecuted
            // / FeeApplied / SwapExecuted logs below are not fetched either, so
            // an executed close-out is missing from the *ledger*, not just from
            // the close-order list.
            this.logger.warn(
                {
                    positionId: id,
                    chainId,
                    contractName: UniswapV3CloseOrderService.closerContractName(
                        position.protocol,
                    ),
                },
                'No closer contract registered for this chain — skipping closer event logs and close-order reconciliation',
            );
        }

        const logs = await this.fetchAllVaultLogs(
            client, vaultAddress as Address, ownerAddress as Address, fromBlock, 'latest', closerAddress,
        );

        // Resolve the remaining chain reads together: the price at every event
        // block, current vault state, and the close-order slots.
        // A close-order read failure propagates. It used to be caught and
        // downgraded to a warn, which made an RPC outage indistinguishable from
        // a position that genuinely has no close orders (#86). The
        // already-resolved `closer` is handed over so this does not look the
        // contract up a second time.
        const [poolPrices, onChainState, closeOrders] = await Promise.all([
            prefetchPoolPrices(
                chainId, position.typedConfig.poolAddress, logs, this._poolPriceService,
            ),
            this.fetchVaultState(position, blockNumber),
            options.includeCloseOrders
                ? this._closeOrderService.fetchChainSnapshot(id, blockNumber, dbTx, closer)
                : Promise.resolve(null),
        ]);

        return {
            position,
            blockNumber,
            logs,
            poolPrices,
            closerAddress,
            onChainState,
            closeOrders,
        };
    }

    // ============================================================================
    // PRIVATE: REFRESH PHASE 2 — DATABASE
    // ============================================================================

    /**
     * Write everything the plan resolved, in one transaction.
     *
     * Every value this needs is already in `plan`, so the transaction contains
     * no network I/O and stays short enough for Prisma's default timeout.
     */
    private async applyRefresh(
        plan: VaultRefreshPlan,
        dbTx?: PrismaTransactionClient,
        options: { clearLedgerFirst?: boolean } = {},
    ): Promise<UniswapV3VaultPosition> {
        const run = async (tx: PrismaTransactionClient): Promise<UniswapV3VaultPosition> => {
            if (options.clearLedgerFirst) {
                await this.clearLedger(plan.position, tx);
            }

            await this.importVaultLogs(plan, tx);
            const result = await this.writeOnChainState(plan, tx);

            // No catch — mirrors the read side in planRefresh. This is pure
            // database work, so a failure here has already aborted `tx`; a
            // catch would not have rescued the refresh, only relabelled a dead
            // transaction and moved the symptom to the next statement.
            if (plan.closeOrders?.status === 'ok') {
                await this._closeOrderService.reconcileChainSnapshot(
                    plan.closeOrders.snapshot,
                    tx,
                );
            }

            return result;
        };

        if (dbTx) return run(dbTx);

        return this.prisma.$transaction(run, {
            // Pure database work. The bound is generous only because
            // recalculateAggregates rewrites every ledger row of the position.
            maxWait: 5_000,
            timeout: 30_000,
        });
    }

    /**
     * Import the fetched logs and emit the resulting domain events.
     * Phase-2 work — callers must already hold `tx`.
     */
    private async importVaultLogs(
        plan: VaultRefreshPlan,
        dbTx: PrismaTransactionClient,
    ): Promise<void> {
        const { position, logs, poolPrices, closerAddress } = plan;
        const chainId = position.chainId;
        const ownerAddress = position.typedConfig.ownerAddress;

        const ledgerService = new UniswapV3VaultLedgerService(
            { positionId: position.id },
            { prisma: this.prisma },
        );

        const importResult = await ledgerService.importLogsForPosition(
            position, chainId, ownerAddress, logs, poolPrices, closerAddress, dbTx,
        );

        // Emit domain events for deletions (reorgs)
        const publisher = getDomainEventPublisher();
        const blockHashGroups = new Map<string, number>();
        for (const event of importResult.allDeletedEvents) {
            const bh = event.typedConfig.blockHash;
            blockHashGroups.set(bh, (blockHashGroups.get(bh) ?? 0) + 1);
        }
        for (const [blockHash, deletedCount] of blockHashGroups) {
            await publisher.createAndPublish<PositionLiquidityRevertedPayload>({
                type: 'position.liquidity.reverted',
                entityId: position.id,
                entityType: 'position',
                userId: position.userId,
                payload: {
                    positionId: position.id,
                    positionHash: position.positionHash,
                    blockHash,
                    deletedCount,
                    revertedAt: new Date().toISOString(),
                },
                source: 'business-logic',
            }, dbTx);
        }

        // Emit insert events for newly imported ledger entries.
        // Vault events are all financial — no lifecycle-only events to skip.
        // The vault ledger fetches only events for the configured ownerAddress,
        // so all imported events are relevant (no isIgnored check needed).
        for (const result of importResult.perLogResults) {
            if (result.action !== 'inserted') continue;
            const { eventType, blockTimestamp } = result.eventDetail;

            if (eventType === 'VAULT_COLLECT_YIELD') {
                await publisher.createAndPublish<PositionLedgerEventPayload>({
                    type: 'position.fees.collected',
                    entityId: position.id,
                    entityType: 'position',
                    userId: position.userId,
                    payload: {
                        positionId: position.id,
                        positionHash: position.positionHash,
                        ledgerInputHash: result.inputHash,
                        eventTimestamp: blockTimestamp.toISOString(),
                    },
                    source: 'business-logic',
                }, dbTx);
            } else if (eventType === 'VAULT_TRANSFER_IN' || eventType === 'VAULT_TRANSFER_OUT' || eventType === 'VAULT_CLOSE_ORDER_EXECUTED') {
                const type = eventType === 'VAULT_TRANSFER_IN'
                    ? ('position.transferred.in' as const)
                    : ('position.transferred.out' as const); // VAULT_TRANSFER_OUT and VAULT_CLOSE_ORDER_EXECUTED
                await publisher.createAndPublish<PositionLedgerEventPayload>({
                    type,
                    entityId: position.id,
                    entityType: 'position',
                    userId: position.userId,
                    payload: {
                        positionId: position.id,
                        positionHash: position.positionHash,
                        ledgerInputHash: result.inputHash,
                        eventTimestamp: blockTimestamp.toISOString(),
                    },
                    source: 'business-logic',
                }, dbTx);
            } else {
                // VAULT_MINT → position.liquidity.increased
                // VAULT_BURN → position.liquidity.decreased
                const type = (eventType === 'VAULT_MINT')
                    ? ('position.liquidity.increased' as const)
                    : ('position.liquidity.decreased' as const);
                await publisher.createAndPublish<PositionLedgerEventPayload>({
                    type,
                    entityId: position.id,
                    entityType: 'position',
                    userId: position.userId,
                    payload: {
                        positionId: position.id,
                        positionHash: position.positionHash,
                        ledgerInputHash: result.inputHash,
                        eventTimestamp: blockTimestamp.toISOString(),
                    },
                    source: 'business-logic',
                }, dbTx);
            }
        }
    }

    // ============================================================================
    // PRIVATE: WRITE ON-CHAIN STATE
    // ============================================================================

    /**
     * Persist the fetched vault state plus the metrics derived from it and the
     * freshly imported ledger. Phase-2 work — callers must already hold `dbTx`.
     */
    private async writeOnChainState(
        plan: VaultRefreshPlan,
        dbTx: PrismaTransactionClient,
    ): Promise<UniswapV3VaultPosition> {
        const { blockNumber, onChainState } = plan;
        const id = plan.position.id;

        // Re-read inside the transaction: importVaultLogs may have moved the
        // ledger, and plan.position predates the transaction.
        const position = await this.findById(id, dbTx);
        if (!position) throw new Error(`Vault position not found: ${id}`);

        const isClosed = onChainState.sharesBalance === 0n;

        const newState: UniswapV3VaultPositionState = {
            sharesBalance: onChainState.sharesBalance,
            totalSupply: onChainState.totalSupply,
            liquidity: onChainState.liquidity,
            unclaimedFees0: onChainState.unclaimedFees0,
            unclaimedFees1: onChainState.unclaimedFees1,
            operatorAddress: onChainState.operatorAddress,
            isClosed,
            isOwnedByUser: position.typedState.isOwnedByUser ?? true,
            sqrtPriceX96: onChainState.sqrtPriceX96,
            currentTick: onChainState.currentTick,
            poolLiquidity: onChainState.poolLiquidity,
            feeGrowthGlobal0: onChainState.feeGrowthGlobal0,
            feeGrowthGlobal1: onChainState.feeGrowthGlobal1,
        };

        // Calculate metrics from on-chain state
        // User's proportional liquidity = totalLiquidity * shares / totalSupply
        const userLiquidity = onChainState.totalSupply > 0n
            ? onChainState.liquidity * onChainState.sharesBalance / onChainState.totalSupply
            : 0n;

        const currentValue = calculatePositionValue(
            userLiquidity,
            onChainState.sqrtPriceX96,
            position.typedConfig.tickLower,
            position.typedConfig.tickUpper,
            !position.isToken0Quote, // baseIsToken0
        );

        const unclaimedYield = calculateTokenValueInQuote(
            onChainState.unclaimedFees0,
            onChainState.unclaimedFees1,
            onChainState.sqrtPriceX96,
            position.isToken0Quote,
            position.token0.decimals,
            position.token1.decimals,
        );

        // Get ledger-derived metrics (cost basis, realized PnL, collected yield)
        const ledgerService = new UniswapV3VaultLedgerService(
            { positionId: id },
            { prisma: this.prisma },
        );
        const aggregates = await ledgerService.recalculateAggregates(
            position.isToken0Quote,
            dbTx,
        );

        const unrealizedPnl = currentValue - aggregates.costBasisAfter;

        // Backfill positionOpenedAt from first ledger event if it differs
        const firstEvent = await dbTx.positionLedgerEvent.findFirst({
            where: { positionId: id },
            orderBy: { timestamp: 'asc' },
            select: { timestamp: true },
        });
        const correctedOpenedAt = firstEvent?.timestamp ?? position.positionOpenedAt;

        // Calculate APR from ledger events
        const aprService = new UniswapV3AprService(
            { positionId: id },
            { prisma: this.prisma },
        );
        const aprSummary = await aprService.calculateSummary(
            {
                positionOpenedAt: correctedOpenedAt,
                costBasis: aggregates.costBasisAfter,
                unclaimedYield,
            },
            blockNumber,
            dbTx,
        );
        const persistedApr = aprSummary.belowThreshold ? null : aprSummary.totalApr;

        // Update position in DB
        await dbTx.position.update({
            where: { id },
            data: {
                state: vaultPositionStateToJSON(newState) as object,
                currentValue: currentValue.toString(),
                costBasis: aggregates.costBasisAfter.toString(),
                realizedPnl: aggregates.realizedPnlAfter.toString(),
                unrealizedPnl: unrealizedPnl.toString(),
                collectedYield: aggregates.collectedYieldAfter.toString(),
                unclaimedYield: unclaimedYield.toString(),
                totalApr: persistedApr,
                baseApr: persistedApr,
                rewardApr: 0,
                positionOpenedAt: correctedOpenedAt,
            },
        });

        // Emit closed event if newly closed
        if (isClosed && !position.typedState.isClosed) {
            const closedPosition = await this.findById(id, dbTx);
            if (closedPosition) {
                await this.eventPublisher.createAndPublish<PositionLifecyclePayload>({
                    type: 'position.closed',
                    entityType: 'position',
                    entityId: closedPosition.id,
                    userId: closedPosition.userId,
                    payload: {
                        positionId: closedPosition.id,
                        positionHash: closedPosition.positionHash,
                    },
                    source: 'ledger-sync',
                }, dbTx);
            }
        }

        return (await this.findById(id, dbTx))!;
    }

    // ============================================================================
    // PRIVATE: FETCH VAULT STATE (CACHED BY BLOCK NUMBER)
    // ============================================================================

    /**
     * Fetch on-chain vault state with block-number-keyed caching.
     *
     * Cache key: `vault-onchain:{chainId}:{vaultAddress}:{ownerAddress}:{blockNumber}`
     * TTL: 60 seconds (same block data is immutable, TTL is just for eviction)
     */
    private async fetchVaultState(
        position: UniswapV3VaultPosition,
        blockNumber: number | 'latest' = 'latest',
    ): Promise<OnChainVaultState> {
        const chainId = position.chainId;
        const vaultAddress = position.vaultAddress;
        const ownerAddress = position.typedConfig.ownerAddress;

        // 1. Resolve block number
        const resolvedBlockNumber = blockNumber === 'latest'
            ? await this._evmBlockService.getCurrentBlockNumber(chainId)
            : BigInt(blockNumber);

        // 2. Check cache. v2 cache key — bumped when pool-level state
        // (poolLiquidity, feeGrowthGlobal0/1) was added to the cached payload.
        const cacheKey = `vault-onchain:v2:${chainId}:${vaultAddress}:${ownerAddress}:${resolvedBlockNumber}`;
        const cached = await this._cacheService.get<OnChainVaultStateCached>(cacheKey);
        if (cached) {
            this.logger.debug({ chainId, vaultAddress, blockNumber: resolvedBlockNumber.toString(), cacheHit: true }, 'Vault on-chain state cache hit');
            return deserializeVaultState(cached);
        }

        // 3. Cache miss — fetch from chain
        const client = this._evmConfig.getPublicClient(chainId);

        // Pool state (slot0 + liquidity + feeGrowthGlobal0/1) is fetched via
        // the pool service so we share its cache and read all four fields in
        // one place rather than rolling our own slot0 multicall.
        const [sharesBalance, totalSupply, claimable, poolState, positionManagerAddr, operatorAddr] = await Promise.all([
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'balanceOf', args: [ownerAddress as Address], blockNumber: resolvedBlockNumber }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'totalSupply', blockNumber: resolvedBlockNumber }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'claimableYield', args: [ownerAddress as Address], blockNumber: resolvedBlockNumber }),
            this._poolService.fetchPoolState(chainId, position.typedConfig.poolAddress, Number(resolvedBlockNumber)),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'positionManager' }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'operator' }),
        ]) as [bigint, bigint, readonly bigint[], Awaited<ReturnType<UniswapV3PoolService['fetchPoolState']>>, string, string];

        // Read NFPM liquidity
        const nfpmData = await client.readContract({
            address: positionManagerAddr as Address,
            abi: UNISWAP_V3_POSITION_MANAGER_ABI,
            functionName: 'positions',
            args: [BigInt(position.underlyingTokenId)],
            blockNumber: resolvedBlockNumber,
        }) as readonly unknown[];

        const state: OnChainVaultState = {
            blockNumber: resolvedBlockNumber,
            sharesBalance: sharesBalance as bigint,
            totalSupply: totalSupply as bigint,
            liquidity: nfpmData[7] as bigint,
            unclaimedFees0: claimable[0] ?? 0n,
            unclaimedFees1: claimable[1] ?? 0n,
            sqrtPriceX96: poolState.sqrtPriceX96,
            currentTick: poolState.currentTick,
            poolLiquidity: poolState.liquidity,
            feeGrowthGlobal0: poolState.feeGrowthGlobal0,
            feeGrowthGlobal1: poolState.feeGrowthGlobal1,
            positionManagerAddress: positionManagerAddr as string,
            operatorAddress: normalizeAddress(operatorAddr as string),
        };

        // 4. Cache with 60s TTL
        await this._cacheService.set(cacheKey, serializeVaultState(state), 60);

        this.logger.debug({ chainId, vaultAddress, blockNumber: resolvedBlockNumber.toString(), cacheHit: false }, 'Vault on-chain state fetched and cached');

        return state;
    }

    // ============================================================================
    // PRIVATE: FETCH VAULT LOGS VIA RPC
    // ============================================================================

    private async fetchAllVaultLogs(
        client: PublicClient,
        vaultAddress: Address,
        ownerAddress: Address,
        fromBlock: bigint,
        toBlock: bigint | 'latest' = 'latest',
        closerAddress?: Address,
    ): Promise<VaultRawLogInput[]> {
        const yieldCollectedEvent = parseAbiItem(
            'event YieldCollected(address indexed user, address indexed recipient, uint256[] tokenAmounts)',
        );
        const transferEvent = parseAbiItem(
            'event Transfer(address indexed from, address indexed to, uint256 value)',
        );
        const mintedEvent = parseAbiItem(
            'event Minted(address indexed minter, address indexed recipient, uint256 shares, uint256[] tokenAmounts)',
        );
        const burnedEvent = parseAbiItem(
            'event Burned(address indexed burner, address indexed recipient, uint256 shares, uint256[] tokenAmounts)',
        );

        const commonParams = { address: vaultAddress, fromBlock, toBlock };

        const logPromises: Promise<unknown[]>[] = [
            client.getLogs({ ...commonParams, event: yieldCollectedEvent, args: { user: ownerAddress } }),
            client.getLogs({ ...commonParams, event: transferEvent, args: { to: ownerAddress } }),
            client.getLogs({ ...commonParams, event: transferEvent, args: { from: ownerAddress } }),
            client.getLogs({ ...commonParams, event: mintedEvent, args: { recipient: ownerAddress } }),
            client.getLogs({ ...commonParams, event: burnedEvent, args: { burner: ownerAddress } }),
        ];

        // Also fetch closer contract events if a closer address is known
        if (closerAddress) {
            const orderExecutedEvent = parseAbiItem(
                'event OrderExecuted(address indexed vault, uint8 indexed triggerMode, address indexed owner, address payout, int24 executionTick, uint256 sharesClosed, uint256 amount0Out, uint256 amount1Out)',
            );
            const feeAppliedEvent = parseAbiItem(
                'event FeeApplied(address indexed vault, uint8 indexed triggerMode, address indexed feeRecipient, uint16 feeBps, uint256 feeAmount0, uint256 feeAmount1)',
            );
            const swapExecutedEvent = parseAbiItem(
                'event SwapExecuted(address indexed vault, uint8 indexed triggerMode, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)',
            );
            const closerParams = { address: closerAddress, fromBlock, toBlock };
            logPromises.push(
                client.getLogs({ ...closerParams, event: orderExecutedEvent, args: { vault: vaultAddress, owner: ownerAddress } }),
                client.getLogs({ ...closerParams, event: feeAppliedEvent, args: { vault: vaultAddress } }),
                client.getLogs({ ...closerParams, event: swapExecutedEvent, args: { vault: vaultAddress } }),
            );
        }

        const results = await Promise.all(logPromises);
        const allLogs = results.flat() as Array<{ address: string; topics: readonly string[]; data: string; blockNumber: bigint; blockHash: string; transactionHash: string; transactionIndex: number; logIndex: number }>;
        allLogs.sort((a, b) => {
            const blockDiff = Number(a.blockNumber! - b.blockNumber!);
            if (blockDiff !== 0) return blockDiff;
            return a.logIndex! - b.logIndex!;
        });

        return allLogs.map((l) => ({
            address: l.address,
            topics: l.topics as unknown as string[],
            data: l.data,
            blockNumber: l.blockNumber!,
            blockHash: l.blockHash!,
            transactionHash: l.transactionHash!,
            transactionIndex: l.transactionIndex!,
            logIndex: l.logIndex!,
        }));
    }

    // ============================================================================
    // PRIVATE: CREATE POSITION
    // ============================================================================

    private async createPosition(
        userId: string,
        positionHash: string,
        configData: UniswapV3VaultPositionConfigData,
        stateData: UniswapV3VaultPositionState,
        token0: TokenInterface,
        token1: TokenInterface,
        positionOpenedAt: Date,
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3VaultPosition> {
        const db = dbTx ?? this.prisma;
        const config = new UniswapV3VaultPositionConfig(configData);

        const row = await db.position.create({
            data: {
                userId,
                protocol: 'uniswapv3-vault',
                type: 'VAULT_SHARES',
                positionHash,
                ownerWallet: createEvmOwnerWallet(configData.ownerAddress),
                config: config.toJSON() as object,
                state: vaultPositionStateToJSON(stateData) as object,
                currentValue: '0',
                costBasis: '0',
                realizedPnl: '0',
                unrealizedPnl: '0',
                realizedCashflow: '0',
                unrealizedCashflow: '0',
                collectedYield: '0',
                unclaimedYield: '0',
                positionOpenedAt,
                isArchived: false,
            },
        });

        return UniswapV3VaultPosition.fromDB(
            row as unknown as UniswapV3VaultPositionRow,
            token0,
            token1,
        );
    }

    // ============================================================================
    // PRIVATE: MAP DB ROW TO DOMAIN OBJECT
    // ============================================================================

    private async mapToPosition(
        row: UniswapV3VaultPositionRow,
    ): Promise<UniswapV3VaultPosition> {
        const configJSON = row.config as unknown as UniswapV3VaultPositionConfigJSON;

        const [token0Row, token1Row] = await Promise.all([
            this.prisma.token.findUnique({
                where: { tokenHash: createErc20TokenHash(configJSON.chainId, configJSON.token0Address!) },
            }),
            this.prisma.token.findUnique({
                where: { tokenHash: createErc20TokenHash(configJSON.chainId, configJSON.token1Address!) },
            }),
        ]);

        if (!token0Row || !token1Row) {
            throw new Error(
                `Tokens not found for vault position ${row.id}: token0=${configJSON.token0Address}, token1=${configJSON.token1Address}`,
            );
        }

        const { Erc20Token } = await import('@midcurve/shared');
        const token0 = Erc20Token.fromDB(token0Row as any) as TokenInterface;
        const token1 = Erc20Token.fromDB(token1Row as any) as TokenInterface;

        return UniswapV3VaultPosition.fromDB(row, token0, token1);
    }
}
