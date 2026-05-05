/**
 * UniswapV3 Staking Position Service
 *
 * Service layer for `UniswapV3StakingVault` positions (SPEC-0003b).
 *
 * Architecture mirrors `UniswapV3VaultPositionService` (closer-in-spirit
 * canonical: clone-based, factory-deployed) with these staking-specific
 * design points:
 *
 * - Vaults are owner-bound 1:1, so `vaultAddress` alone disambiguates.
 *   `positionHash` format is `uniswapv3-staking/{chainId}/{vaultAddress}`.
 * - `refresh()` always does a fresh chain pull — NO 15-second cache (per
 *   PR4 plan refinement #1: stale-row caching causes silent UI bugs after
 *   user txs like stake/topUp/unstake/claim/flashClose).
 * - `reset()` does NOT emit `position.liquidity.reverted` events (per PR4
 *   plan refinement #3: FK cascade is the documented cleanup path; the
 *   immediate re-import via `syncFromChain` re-emits all liquidity events
 *   for PR3's rule to rebuild from scratch).
 * - On-chain state reads are cached with a block-keyed 60s TTL via
 *   `CacheService` (`staking-onchain:v1:{chainId}:{vault}:{blockNumber}`).
 * - PR2's `UniswapV3StakingLedgerService.syncFromChain` does the heavy
 *   lifting — this service is a thin orchestration layer.
 * - `position.created` is NOT emitted here; the `/discover` API route
 *   in PR4b emits it after calling `service.discover()`. Mirrors the
 *   NFT/Vault convention.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import {
    UniswapV3StakingPosition,
    UniswapV3StakingPositionConfig,
    stakingPositionStateToJSON,
    normalizeAddress,
    SharedContractNameEnum,
    tickToPrice,
    createErc20TokenHash,
    createEvmOwnerWallet,
    calculatePositionValue,
    Erc20Token,
} from '@midcurve/shared';
import type {
    UniswapV3StakingPositionRow,
    UniswapV3StakingPositionConfigData,
    UniswapV3StakingPositionState,
    UniswapV3StakingPositionConfigJSON,
    UniswapV3StakingPositionMetrics,
    StakingState,
    TokenInterface,
} from '@midcurve/shared';
import type { Address } from 'viem';
import { parseAbiItem } from 'viem';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { getDomainEventPublisher } from '../../events/index.js';
import type {
    DomainEventPublisher,
    PositionLifecyclePayload,
} from '../../events/index.js';
import { EvmConfig } from '../../config/evm.js';
import { UNISWAP_V3_POSITION_MANAGER_ABI } from '../../config/uniswapv3.js';
import { UniswapV3PoolService } from '../pool/uniswapv3-pool-service.js';
import type { PrismaTransactionClient } from '../../clients/prisma/index.js';
import { EvmBlockService } from '../block/evm-block-service.js';
import { UniswapV3PoolPriceService } from '../pool-price/uniswapv3-pool-price-service.js';
import { UniswapV3StakingLedgerService } from '../position-ledger/uniswapv3-staking-ledger-service.js';
import { CacheService } from '../cache/index.js';
import { SharedContractService } from '../automation/shared-contract-service.js';
import { Erc20TokenService } from '../token/erc20-token-service.js';
import { calculateTokenValueInQuote } from '../../utils/uniswapv3/ledger-calculations.js';

// ============================================================================
// MINIMAL STAKING-VAULT READ ABI
// ============================================================================

const STAKING_VAULT_READ_ABI = [
    { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { type: 'function', name: 'pool', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { type: 'function', name: 'tokenId', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { type: 'function', name: 'token1', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { type: 'function', name: 'isToken0Quote', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
    { type: 'function', name: 'positionManager', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { type: 'function', name: 'tickLower', stateMutability: 'view', inputs: [], outputs: [{ type: 'int24' }] },
    { type: 'function', name: 'tickUpper', stateMutability: 'view', inputs: [], outputs: [{ type: 'int24' }] },
    { type: 'function', name: 'state', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
    { type: 'function', name: 'stakedBase', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { type: 'function', name: 'stakedQuote', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { type: 'function', name: 'yieldTarget', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { type: 'function', name: 'partialUnstakeBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16' }] },
    { type: 'function', name: 'unstakeBufferBase', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { type: 'function', name: 'unstakeBufferQuote', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { type: 'function', name: 'rewardBufferBase', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { type: 'function', name: 'rewardBufferQuote', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

const STAKING_STATE_BY_INDEX: Record<number, StakingState> = {
    0: 'Empty',
    1: 'Staked',
    2: 'FlashCloseInProgress',
    3: 'Settled',
};

function stakingStateFromIndex(idx: number): StakingState {
    const state = STAKING_STATE_BY_INDEX[idx];
    if (state === undefined) {
        throw new Error(`Unknown staking-vault state index: ${idx}`);
    }
    return state;
}

// ============================================================================
// CACHE TYPES (block-keyed RPC cache for refreshOnChainState)
// ============================================================================

interface OnChainStakingState {
    blockNumber: bigint;
    vaultState: StakingState;
    stakedBase: bigint;
    stakedQuote: bigint;
    yieldTarget: bigint;
    pendingBps: number;
    unstakeBufferBase: bigint;
    unstakeBufferQuote: bigint;
    rewardBufferBase: bigint;
    rewardBufferQuote: bigint;
    liquidity: bigint;
    sqrtPriceX96: bigint;
    currentTick: number;
    poolLiquidity: bigint;
    feeGrowthGlobal0: bigint;
    feeGrowthGlobal1: bigint;
    ownerAddress: string;
}

interface OnChainStakingStateCached {
    blockNumber: string;
    vaultState: StakingState;
    stakedBase: string;
    stakedQuote: string;
    yieldTarget: string;
    pendingBps: number;
    unstakeBufferBase: string;
    unstakeBufferQuote: string;
    rewardBufferBase: string;
    rewardBufferQuote: string;
    liquidity: string;
    sqrtPriceX96: string;
    currentTick: number;
    poolLiquidity: string;
    feeGrowthGlobal0: string;
    feeGrowthGlobal1: string;
    ownerAddress: string;
}

function serialize(state: OnChainStakingState): OnChainStakingStateCached {
    return {
        blockNumber: state.blockNumber.toString(),
        vaultState: state.vaultState,
        stakedBase: state.stakedBase.toString(),
        stakedQuote: state.stakedQuote.toString(),
        yieldTarget: state.yieldTarget.toString(),
        pendingBps: state.pendingBps,
        unstakeBufferBase: state.unstakeBufferBase.toString(),
        unstakeBufferQuote: state.unstakeBufferQuote.toString(),
        rewardBufferBase: state.rewardBufferBase.toString(),
        rewardBufferQuote: state.rewardBufferQuote.toString(),
        liquidity: state.liquidity.toString(),
        sqrtPriceX96: state.sqrtPriceX96.toString(),
        currentTick: state.currentTick,
        poolLiquidity: state.poolLiquidity.toString(),
        feeGrowthGlobal0: state.feeGrowthGlobal0.toString(),
        feeGrowthGlobal1: state.feeGrowthGlobal1.toString(),
        ownerAddress: state.ownerAddress,
    };
}

function deserialize(cached: OnChainStakingStateCached): OnChainStakingState {
    return {
        blockNumber: BigInt(cached.blockNumber),
        vaultState: cached.vaultState,
        stakedBase: BigInt(cached.stakedBase),
        stakedQuote: BigInt(cached.stakedQuote),
        yieldTarget: BigInt(cached.yieldTarget),
        pendingBps: cached.pendingBps,
        unstakeBufferBase: BigInt(cached.unstakeBufferBase),
        unstakeBufferQuote: BigInt(cached.unstakeBufferQuote),
        rewardBufferBase: BigInt(cached.rewardBufferBase),
        rewardBufferQuote: BigInt(cached.rewardBufferQuote),
        liquidity: BigInt(cached.liquidity),
        sqrtPriceX96: BigInt(cached.sqrtPriceX96),
        currentTick: cached.currentTick,
        poolLiquidity: BigInt(cached.poolLiquidity),
        feeGrowthGlobal0: BigInt(cached.feeGrowthGlobal0),
        feeGrowthGlobal1: BigInt(cached.feeGrowthGlobal1),
        ownerAddress: cached.ownerAddress,
    };
}

// ============================================================================
// DEPENDENCIES
// ============================================================================

export interface UniswapV3StakingPositionServiceDependencies {
    prisma?: PrismaClient;
    eventPublisher?: DomainEventPublisher;
    evmConfig?: EvmConfig;
    poolService?: UniswapV3PoolService;
    evmBlockService?: EvmBlockService;
    poolPriceService?: UniswapV3PoolPriceService;
    cacheService?: CacheService;
    sharedContractService?: SharedContractService;
    erc20TokenService?: Erc20TokenService;
}

// ============================================================================
// SERVICE
// ============================================================================

export class UniswapV3StakingPositionService {
    private readonly prisma: PrismaClient;
    private readonly logger: ServiceLogger;
    private readonly eventPublisher: DomainEventPublisher;
    private readonly _evmConfig: EvmConfig;
    private readonly _poolService: UniswapV3PoolService;
    private readonly _evmBlockService: EvmBlockService;
    private readonly _poolPriceService: UniswapV3PoolPriceService;
    private readonly _cacheService: CacheService;
    private readonly _sharedContractService: SharedContractService;
    private readonly _erc20TokenService: Erc20TokenService;

    constructor(deps: UniswapV3StakingPositionServiceDependencies = {}) {
        this.prisma = deps.prisma ?? prismaClient;
        this.logger = createServiceLogger('uniswapv3-staking-position');
        this.eventPublisher = deps.eventPublisher ?? getDomainEventPublisher();
        this._evmConfig = deps.evmConfig ?? EvmConfig.getInstance();
        this._poolService = deps.poolService ?? new UniswapV3PoolService();
        this._evmBlockService = deps.evmBlockService ?? new EvmBlockService({ evmConfig: this._evmConfig });
        this._poolPriceService = deps.poolPriceService ?? new UniswapV3PoolPriceService();
        this._cacheService = deps.cacheService ?? CacheService.getInstance();
        this._sharedContractService = deps.sharedContractService ?? new SharedContractService();
        this._erc20TokenService = deps.erc20TokenService ?? new Erc20TokenService();
    }

    // =========================================================================
    // QUERY METHODS
    // =========================================================================

    async findById(
        id: string,
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3StakingPosition | null> {
        const db = tx ?? this.prisma;
        const row = await db.position.findFirst({
            where: { id, protocol: 'uniswapv3-staking' },
        });
        if (!row) return null;
        return this.mapToPosition(row as unknown as UniswapV3StakingPositionRow);
    }

    async findByPositionHash(
        userId: string,
        positionHash: string,
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3StakingPosition | null> {
        const db = tx ?? this.prisma;
        const row = await db.position.findFirst({
            where: { userId, positionHash, protocol: 'uniswapv3-staking' },
        });
        if (!row) return null;
        return this.mapToPosition(row as unknown as UniswapV3StakingPositionRow);
    }

    async delete(id: string): Promise<void> {
        const position = await this.findById(id);
        if (!position) return;

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

        this.logger.info(
            { positionId: id, vaultAddress: position.vaultAddress },
            'Staking-vault position deleted',
        );
    }

    // =========================================================================
    // DISCOVER (single-position importer)
    // =========================================================================

    /**
     * Discover and import a single staking-vault position. Mirrors the Vault
     * `discover` semantics; `position.created` is emitted by the API route
     * caller (PR4b), not here.
     *
     * Throws `INVALID_VAULT_CONTRACT` if the address isn't a valid staking
     * vault on the given chain (the on-chain reads will fail).
     */
    async discover(
        userId: string,
        params: { chainId: number; vaultAddress: string; quoteTokenAddress?: string },
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3StakingPosition> {
        const { chainId } = params;
        const vaultAddress = normalizeAddress(params.vaultAddress);

        // Existing position check (idempotent re-import = refresh)
        const positionHash = UniswapV3StakingPosition.createHash(chainId, vaultAddress);
        const existing = await this.findByPositionHash(userId, positionHash, dbTx);
        if (existing) {
            return this.refresh(existing.id, 'latest', dbTx);
        }

        const client = this._evmConfig.getPublicClient(chainId);

        // Read all immutable vault config from chain in parallel.
        let token0Addr: string,
            token1Addr: string,
            tokenId: bigint,
            poolAddr: string,
            tickLower: number,
            tickUpper: number,
            isToken0Quote: boolean,
            ownerAddr: string,
            positionManagerAddr: string;
        try {
            [token0Addr, token1Addr, tokenId, poolAddr, tickLower, tickUpper, isToken0Quote, ownerAddr, positionManagerAddr] =
                await Promise.all([
                    client.readContract({ address: vaultAddress as Address, abi: STAKING_VAULT_READ_ABI, functionName: 'token0', args: [] }),
                    client.readContract({ address: vaultAddress as Address, abi: STAKING_VAULT_READ_ABI, functionName: 'token1', args: [] }),
                    client.readContract({ address: vaultAddress as Address, abi: STAKING_VAULT_READ_ABI, functionName: 'tokenId', args: [] }),
                    client.readContract({ address: vaultAddress as Address, abi: STAKING_VAULT_READ_ABI, functionName: 'pool', args: [] }),
                    client.readContract({ address: vaultAddress as Address, abi: STAKING_VAULT_READ_ABI, functionName: 'tickLower', args: [] }),
                    client.readContract({ address: vaultAddress as Address, abi: STAKING_VAULT_READ_ABI, functionName: 'tickUpper', args: [] }),
                    client.readContract({ address: vaultAddress as Address, abi: STAKING_VAULT_READ_ABI, functionName: 'isToken0Quote', args: [] }),
                    client.readContract({ address: vaultAddress as Address, abi: STAKING_VAULT_READ_ABI, functionName: 'owner', args: [] }),
                    client.readContract({ address: vaultAddress as Address, abi: STAKING_VAULT_READ_ABI, functionName: 'positionManager', args: [] }),
                ]) as [string, string, bigint, string, number, number, boolean, string, string];
        } catch {
            throw new Error(
                `INVALID_VAULT_CONTRACT: ${vaultAddress} is not a valid staking-vault contract on chain ${chainId}`,
            );
        }

        // Optional override: caller can force a different quote-token assignment.
        // Note: SPEC §9.4 says the per-staking-position `switch-quote-token` endpoint
        // is NOT supported (vault encodes `isToken0Quote` immutably on `stake()`),
        // but we still let the discover caller pass an override for parity with
        // the vault service's signature.
        let resolvedIsToken0Quote = isToken0Quote;
        if (params.quoteTokenAddress) {
            resolvedIsToken0Quote =
                normalizeAddress(params.quoteTokenAddress).toLowerCase() === normalizeAddress(token0Addr).toLowerCase();
        }

        // Discover tokens + pool concurrently
        const [token0, token1, pool] = await Promise.all([
            this._erc20TokenService.discover({ address: normalizeAddress(token0Addr), chainId }),
            this._erc20TokenService.discover({ address: normalizeAddress(token1Addr), chainId }),
            this._poolService.discover({ chainId, poolAddress: normalizeAddress(poolAddr) }),
        ]);

        // Read NFPM liquidity (and fee tier from positions tuple)
        const positionData = await client.readContract({
            address: positionManagerAddr as Address,
            abi: UNISWAP_V3_POSITION_MANAGER_ABI,
            functionName: 'positions',
            args: [tokenId],
        }) as readonly [bigint, string, string, string, number, number, number, bigint, bigint, bigint, bigint, bigint];
        const fee = positionData[4];

        // Look up factory address from SharedContract registry
        const factoryRow = await this._sharedContractService.findLatestByChainAndName(
            chainId,
            SharedContractNameEnum.UNISWAP_V3_STAKING_VAULT_FACTORY,
        );
        const factoryAddress = (factoryRow?.config as { address?: string } | undefined)?.address ?? '';

        // Compute price range bounds in quote-token units
        const baseTokenAddr = resolvedIsToken0Quote ? token1.address : token0.address;
        const quoteTokenAddr = resolvedIsToken0Quote ? token0.address : token1.address;
        const baseDecimals = resolvedIsToken0Quote ? token1.decimals : token0.decimals;
        const priceRangeLower = tickToPrice(tickLower, baseTokenAddr, quoteTokenAddr, baseDecimals);
        const priceRangeUpper = tickToPrice(tickUpper, baseTokenAddr, quoteTokenAddr, baseDecimals);

        // Pool state for initial state JSON
        const poolStateOnDiscover = await this._poolService.fetchPoolState(
            chainId,
            normalizeAddress(poolAddr),
        );

        const configData: UniswapV3StakingPositionConfigData = {
            chainId,
            vaultAddress,
            factoryAddress,
            ownerAddress: normalizeAddress(ownerAddr),
            underlyingTokenId: Number(tokenId),
            isToken0Quote: resolvedIsToken0Quote,
            poolAddress: normalizeAddress(poolAddr),
            token0Address: token0.address,
            token1Address: token1.address,
            feeBps: fee,
            tickSpacing: pool.typedConfig.tickSpacing,
            tickLower,
            tickUpper,
            priceRangeLower,
            priceRangeUpper,
        };

        // Initial state — `refresh()` will overwrite with fresh chain reads
        const stateData: UniswapV3StakingPositionState = {
            vaultState: 'Staked',
            stakedBase: 0n,
            stakedQuote: 0n,
            yieldTarget: 0n,
            pendingBps: 0,
            unstakeBufferBase: 0n,
            unstakeBufferQuote: 0n,
            rewardBufferBase: 0n,
            rewardBufferQuote: 0n,
            liquidity: positionData[7],
            isOwnedByUser: true,
            unclaimedYieldBase: 0n,
            unclaimedYieldQuote: 0n,
            sqrtPriceX96: poolStateOnDiscover.sqrtPriceX96,
            currentTick: poolStateOnDiscover.currentTick,
            poolLiquidity: poolStateOnDiscover.liquidity,
            feeGrowthGlobal0: poolStateOnDiscover.feeGrowthGlobal0,
            feeGrowthGlobal1: poolStateOnDiscover.feeGrowthGlobal1,
        };

        // Vault deploy timestamp = block of the first `Stake` event
        const stakeEvent = parseAbiItem(
            'event Stake(address indexed owner, uint256 base, uint256 quote, uint256 yieldTarget, uint256 tokenId)',
        );
        const stakeLogs = await client.getLogs({
            address: vaultAddress as Address,
            event: stakeEvent,
            args: { owner: normalizeAddress(ownerAddr) as Address },
            fromBlock: 0n,
            toBlock: 'latest',
        });
        const firstStakeBlock = stakeLogs[0]?.blockNumber;
        const positionOpenedAt = firstStakeBlock
            ? new Date(Number((await client.getBlock({ blockNumber: firstStakeBlock })).timestamp) * 1000)
            : new Date();

        const position = await this.createPosition(
            userId, positionHash, configData, stateData, token0, token1, positionOpenedAt, dbTx,
        );

        // Refresh: imports ledger via syncFromChain (PR2 emits domain events),
        // then refreshes on-chain state.
        return this.refresh(position.id, 'latest', dbTx);
    }

    // =========================================================================
    // DISCOVER WALLET POSITIONS (factory scan)
    // =========================================================================

    /**
     * Scan the factory's `VaultCreated(owner, vault)` events for vaults owned
     * by `walletAddress` across the supported chains. Per PR4 plan refinement
     * #2 the wallet-scan logic also lives in the top-level
     * `POST /positions/discover` route, which calls this method alongside the
     * NFT/Vault equivalents.
     *
     * Per refinement #5, `fromBlock: 0n` is used for the `getLogs` scan
     * (matches the vault service convention). The factory was just deployed
     * on Arbitrum so the scan range is small in practice; if RPC limits ever
     * become a concern, add a `deployBlock` field to `SharedContract.config`
     * and use it here.
     */
    async discoverWalletPositions(
        userId: string,
        walletAddress: string,
        chainIds?: number[],
    ): Promise<{ found: number; imported: number; skipped: number; errors: number }> {
        const supportedChains = chainIds ?? this._evmConfig.getSupportedChainIds();
        const ownerAddress = normalizeAddress(walletAddress);
        let found = 0;
        let imported = 0;
        let skipped = 0;
        let errors = 0;

        for (const chainId of supportedChains) {
            const factory = await this._sharedContractService.findLatestByChainAndName(
                chainId,
                SharedContractNameEnum.UNISWAP_V3_STAKING_VAULT_FACTORY,
            );
            // Refinement: gracefully skip chains with no factory registered.
            if (!factory) continue;

            const factoryAddress = (factory.config as { address: string }).address;
            const client = this._evmConfig.getPublicClient(chainId);

            // VaultCreated(address indexed owner, address indexed vault) — filter by owner
            const vaultCreatedEvent = parseAbiItem(
                'event VaultCreated(address indexed owner, address indexed vault)',
            );
            const logs = await client.getLogs({
                address: factoryAddress as Address,
                event: vaultCreatedEvent,
                args: { owner: ownerAddress as Address },
                fromBlock: 0n,
                toBlock: 'latest',
            });

            const vaultAddresses = new Set<string>();
            for (const l of logs) {
                const vault = l.args.vault as Address | undefined;
                if (vault) vaultAddresses.add(normalizeAddress(vault));
            }

            found += vaultAddresses.size;

            for (const vaultAddr of vaultAddresses) {
                const positionHash = UniswapV3StakingPosition.createHash(chainId, vaultAddr);
                const existing = await this.findByPositionHash(userId, positionHash);
                if (existing) {
                    skipped++;
                    continue;
                }

                try {
                    await this.discover(userId, { chainId, vaultAddress: vaultAddr });
                    imported++;
                } catch (e) {
                    this.logger.warn(
                        { chainId, vaultAddress: vaultAddr, error: e },
                        'Failed to discover staking-vault position',
                    );
                    errors++;
                }
            }
        }

        return { found, imported, skipped, errors };
    }

    // =========================================================================
    // REFRESH
    // =========================================================================

    /**
     * Pull latest on-chain state and re-sync the ledger.
     *
     * **No 15-second cache** (per PR4 plan refinement #1). UI calls `refresh`
     * after user txs (stake/topUp/unstake/claim/flashClose) and must see the
     * new state immediately; stale-row caching causes silent UI bugs. The
     * block-keyed 60s RPC cache inside `refreshOnChainState` stays — it's
     * keyed by block number so it can't serve stale data for the same block.
     */
    async refresh(
        id: string,
        blockNumber: number | 'latest' = 'latest',
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3StakingPosition> {
        await this.refreshAllPositionLogs(id, blockNumber, dbTx);
        return this.refreshOnChainState(id, blockNumber, dbTx);
    }

    // =========================================================================
    // RESET
    // =========================================================================

    /**
     * Wipe the ledger and reimport from chain. Used when ledger drift is
     * detected or when manually rebuilding a position's history.
     *
     * **Does NOT emit `position.liquidity.reverted` events** (per PR4 plan
     * refinement #3). Justification:
     * - `PositionLedgerEvent` deletion cascades through FK to
     *   `TokenLot` / `TokenLotDisposal` / `JournalEntry`.
     * - PR3's rule's `handleLiquidityReverted` is a logging no-op (FK cascade
     *   is the documented cleanup path).
     * - The immediate `syncFromChain` call below re-emits all
     *   `position.liquidity.{increased,decreased}` events, which PR3's rule
     *   consumes to rebuild lots and journal entries from scratch.
     * - The intermediate revert events would be pure noise.
     *
     * Reorg paths in `syncFromChain` (PR2) keep emitting revert events
     * because there's no immediate re-import there.
     */
    async reset(
        id: string,
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3StakingPosition> {
        const position = await this.findById(id, dbTx);
        if (!position) throw new Error(`Staking-vault position not found: ${id}`);

        const ledgerService = new UniswapV3StakingLedgerService(
            { positionId: id },
            { prisma: this.prisma },
        );

        // Wipe ledger; FK cascade handles dependent rows.
        await ledgerService.deleteAll(dbTx);

        // Reimport — emits `position.liquidity.{increased,decreased}` for PR3 to rebuild.
        await this.refreshAllPositionLogs(id, 'latest', dbTx);
        return this.refreshOnChainState(id, 'latest', dbTx);
    }

    // =========================================================================
    // FETCH METRICS (non-persisted)
    // =========================================================================

    async fetchMetrics(
        id: string,
        blockNumber: number | 'latest' = 'latest',
        tx?: PrismaTransactionClient,
    ): Promise<UniswapV3StakingPositionMetrics> {
        const position = await this.findById(id, tx);
        if (!position) throw new Error(`Staking-vault position not found: ${id}`);

        const onChain = await this.fetchOnChainState(position, blockNumber);
        const ledgerService = new UniswapV3StakingLedgerService(
            { positionId: id },
            { prisma: this.prisma },
        );
        const aggregates = await ledgerService.recalculateAggregates(
            position.isToken0Quote,
            tx,
        );

        const currentValue = calculatePositionValue(
            onChain.liquidity,
            onChain.sqrtPriceX96,
            position.typedConfig.tickLower,
            position.typedConfig.tickUpper,
            !position.isToken0Quote,
        );

        // PR4a limitation: unclaimed-yield split is not exposed by IStakingVault.
        // We approximate as 0 here; refresh-time computation can use the
        // currently-accrued NFPM tokensOwed minus principal floor in a follow-up
        // once the contract exposes a public `quoteCloseAt(uint16 bps)` view.
        const unclaimedYield = calculateTokenValueInQuote(
            0n, 0n,
            onChain.sqrtPriceX96,
            position.isToken0Quote,
            position.token0.decimals,
            position.token1.decimals,
        );

        const unrealizedPnl = currentValue - aggregates.costBasisAfter;

        // Last yield-claimed = timestamp of the most recent STAKING_DISPOSE event
        const db = tx ?? this.prisma;
        const lastDispose = await db.positionLedgerEvent.findFirst({
            where: { positionId: id, eventType: 'STAKING_DISPOSE' },
            orderBy: { timestamp: 'desc' },
            select: { timestamp: true },
        });
        const lastYieldClaimedAt = lastDispose?.timestamp ?? position.positionOpenedAt;

        return {
            currentValue,
            costBasis: aggregates.costBasisAfter,
            realizedPnl: aggregates.realizedPnlAfter,
            unrealizedPnl,
            collectedYield: aggregates.collectedYieldAfter,
            unclaimedYield,
            lastYieldClaimedAt,
            yieldTarget: onChain.yieldTarget,
            pendingBps: onChain.pendingBps,
            vaultState: onChain.vaultState,
            priceRangeLower: position.priceRangeLower,
            priceRangeUpper: position.priceRangeUpper,
            isOwnedByUser: position.typedState.isOwnedByUser ?? true,
        };
    }

    // =========================================================================
    // PRIVATE: REFRESH LEDGER EVENTS (thin wrapper around syncFromChain)
    // =========================================================================

    private async refreshAllPositionLogs(
        id: string,
        blockNumber: number | 'latest' = 'latest',
        dbTx?: PrismaTransactionClient,
    ): Promise<void> {
        const position = await this.findById(id, dbTx);
        if (!position) throw new Error(`Staking-vault position not found: ${id}`);

        const ledgerService = new UniswapV3StakingLedgerService(
            { positionId: id },
            { prisma: this.prisma },
        );

        // PR2's syncFromChain handles: block-range resolution, log fetching,
        // chain-context population, ledger import, AND domain event publishing.
        // The position service is a thin orchestration layer here.
        await ledgerService.syncFromChain(
            position,
            this._evmConfig,
            this._poolPriceService,
            {
                toBlock: blockNumber,
                factoryAddress: position.typedConfig.factoryAddress,
            },
            dbTx,
        );
    }

    // =========================================================================
    // PRIVATE: REFRESH ON-CHAIN STATE
    // =========================================================================

    private async refreshOnChainState(
        id: string,
        blockNumber: number | 'latest' = 'latest',
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3StakingPosition> {
        const position = await this.findById(id, dbTx);
        if (!position) throw new Error(`Staking-vault position not found: ${id}`);

        const onChain = await this.fetchOnChainState(position, blockNumber);

        // ownership detection — keeps current value if the user no longer owns
        // the wallet that owns the vault. The wallet-perimeter service can flip
        // this in a separate pass.
        const isOwnedByUser = position.typedState.isOwnedByUser ?? true;

        const newState: UniswapV3StakingPositionState = {
            vaultState: onChain.vaultState,
            stakedBase: onChain.stakedBase,
            stakedQuote: onChain.stakedQuote,
            yieldTarget: onChain.yieldTarget,
            pendingBps: onChain.pendingBps,
            unstakeBufferBase: onChain.unstakeBufferBase,
            unstakeBufferQuote: onChain.unstakeBufferQuote,
            rewardBufferBase: onChain.rewardBufferBase,
            rewardBufferQuote: onChain.rewardBufferQuote,
            liquidity: onChain.liquidity,
            isOwnedByUser,
            // PR4a limitation: see fetchMetrics comment.
            unclaimedYieldBase: 0n,
            unclaimedYieldQuote: 0n,
            sqrtPriceX96: onChain.sqrtPriceX96,
            currentTick: onChain.currentTick,
            poolLiquidity: onChain.poolLiquidity,
            feeGrowthGlobal0: onChain.feeGrowthGlobal0,
            feeGrowthGlobal1: onChain.feeGrowthGlobal1,
        };

        const currentValue = calculatePositionValue(
            onChain.liquidity,
            onChain.sqrtPriceX96,
            position.typedConfig.tickLower,
            position.typedConfig.tickUpper,
            !position.isToken0Quote,
        );

        const unclaimedYield = 0n; // see comment above

        const ledgerService = new UniswapV3StakingLedgerService(
            { positionId: id },
            { prisma: this.prisma },
        );
        const aggregates = await ledgerService.recalculateAggregates(
            position.isToken0Quote,
            dbTx,
        );

        const unrealizedPnl = currentValue - aggregates.costBasisAfter;

        // Backfill positionOpenedAt from first ledger event if it differs
        const db = dbTx ?? this.prisma;
        const firstEvent = await db.positionLedgerEvent.findFirst({
            where: { positionId: id },
            orderBy: { timestamp: 'asc' },
            select: { timestamp: true },
        });
        const correctedOpenedAt = firstEvent?.timestamp ?? position.positionOpenedAt;

        const isClosedTransition =
            onChain.vaultState === 'Settled' && position.typedState.vaultState !== 'Settled';

        await db.position.update({
            where: { id },
            data: {
                state: stakingPositionStateToJSON(newState) as object,
                currentValue: currentValue.toString(),
                costBasis: aggregates.costBasisAfter.toString(),
                realizedPnl: aggregates.realizedPnlAfter.toString(),
                unrealizedPnl: unrealizedPnl.toString(),
                collectedYield: aggregates.collectedYieldAfter.toString(),
                unclaimedYield: unclaimedYield.toString(),
                positionOpenedAt: correctedOpenedAt,
            },
        });

        if (isClosedTransition) {
            await this.eventPublisher.createAndPublish<PositionLifecyclePayload>({
                type: 'position.closed',
                entityType: 'position',
                entityId: position.id,
                userId: position.userId,
                payload: {
                    positionId: position.id,
                    positionHash: position.positionHash,
                },
                source: 'ledger-sync',
            }, dbTx);
        }

        return (await this.findById(id, dbTx))!;
    }

    // =========================================================================
    // PRIVATE: ON-CHAIN STATE FETCH (block-keyed 60s cache)
    // =========================================================================

    /**
     * Fetch on-chain staking-vault state with block-number-keyed caching.
     * Cache key: `staking-onchain:v1:{chainId}:{vault}:{blockNumber}`
     * TTL: 60 seconds (same-block data is immutable; TTL is just for eviction).
     *
     * Per PR4 plan refinement #1, `refresh()` does NOT short-circuit based on
     * `position.updatedAt` — it always passes through here, where the cache
     * is keyed by block. A fresh `refresh` always resolves a new block
     * number when the chain progresses, so the cache can't return stale data.
     */
    private async fetchOnChainState(
        position: UniswapV3StakingPosition,
        blockNumber: number | 'latest' = 'latest',
    ): Promise<OnChainStakingState> {
        const chainId = position.chainId;
        const vaultAddress = position.vaultAddress;
        const tokenId = BigInt(position.underlyingTokenId);

        const resolvedBlockNumber = blockNumber === 'latest'
            ? await this._evmBlockService.getCurrentBlockNumber(chainId)
            : BigInt(blockNumber);

        const cacheKey = `staking-onchain:v1:${chainId}:${vaultAddress}:${resolvedBlockNumber}`;
        const cached = await this._cacheService.get<OnChainStakingStateCached>(cacheKey);
        if (cached) {
            this.logger.debug(
                { chainId, vaultAddress, blockNumber: resolvedBlockNumber.toString(), cacheHit: true },
                'Staking-vault on-chain state cache hit',
            );
            return deserialize(cached);
        }

        const client = this._evmConfig.getPublicClient(chainId);

        // Read all dynamic vault state in parallel.
        const readVault = (fn: 'state' | 'stakedBase' | 'stakedQuote' | 'yieldTarget'
            | 'partialUnstakeBps' | 'unstakeBufferBase' | 'unstakeBufferQuote'
            | 'rewardBufferBase' | 'rewardBufferQuote' | 'positionManager' | 'owner') =>
            client.readContract({
                address: vaultAddress as Address,
                abi: STAKING_VAULT_READ_ABI,
                functionName: fn,
                args: [],
                blockNumber: resolvedBlockNumber,
            });

        const [
            stateIdx, stakedBase, stakedQuote, yieldTarget, partialBps,
            unstakeBase, unstakeQuote, rewardBase, rewardQuote,
            positionManagerAddr, ownerAddr, poolState,
        ] = await Promise.all([
            readVault('state'),
            readVault('stakedBase'),
            readVault('stakedQuote'),
            readVault('yieldTarget'),
            readVault('partialUnstakeBps'),
            readVault('unstakeBufferBase'),
            readVault('unstakeBufferQuote'),
            readVault('rewardBufferBase'),
            readVault('rewardBufferQuote'),
            readVault('positionManager'),
            readVault('owner'),
            this._poolService.fetchPoolState(chainId, position.typedConfig.poolAddress, Number(resolvedBlockNumber)),
        ]) as [
            number, bigint, bigint, bigint, number,
            bigint, bigint, bigint, bigint,
            string, string,
            Awaited<ReturnType<UniswapV3PoolService['fetchPoolState']>>,
        ];

        // Read NFPM liquidity at the same block
        const nfpmData = await client.readContract({
            address: positionManagerAddr as Address,
            abi: UNISWAP_V3_POSITION_MANAGER_ABI,
            functionName: 'positions',
            args: [tokenId],
            blockNumber: resolvedBlockNumber,
        }) as readonly unknown[];

        const state: OnChainStakingState = {
            blockNumber: resolvedBlockNumber,
            vaultState: stakingStateFromIndex(Number(stateIdx)),
            stakedBase, stakedQuote, yieldTarget,
            pendingBps: Number(partialBps),
            unstakeBufferBase: unstakeBase,
            unstakeBufferQuote: unstakeQuote,
            rewardBufferBase: rewardBase,
            rewardBufferQuote: rewardQuote,
            liquidity: nfpmData[7] as bigint,
            sqrtPriceX96: poolState.sqrtPriceX96,
            currentTick: poolState.currentTick,
            poolLiquidity: poolState.liquidity,
            feeGrowthGlobal0: poolState.feeGrowthGlobal0,
            feeGrowthGlobal1: poolState.feeGrowthGlobal1,
            ownerAddress: normalizeAddress(ownerAddr),
        };

        await this._cacheService.set(cacheKey, serialize(state), 60);

        this.logger.debug(
            { chainId, vaultAddress, blockNumber: resolvedBlockNumber.toString(), cacheHit: false },
            'Staking-vault on-chain state fetched and cached',
        );

        return state;
    }

    // =========================================================================
    // PRIVATE: CREATE POSITION (DB row)
    // =========================================================================

    private async createPosition(
        userId: string,
        positionHash: string,
        configData: UniswapV3StakingPositionConfigData,
        stateData: UniswapV3StakingPositionState,
        token0: TokenInterface,
        token1: TokenInterface,
        positionOpenedAt: Date,
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3StakingPosition> {
        const db = dbTx ?? this.prisma;
        const config = new UniswapV3StakingPositionConfig(configData);

        const row = await db.position.create({
            data: {
                userId,
                protocol: 'uniswapv3-staking',
                type: 'LP_CONCENTRATED',
                positionHash,
                ownerWallet: createEvmOwnerWallet(configData.ownerAddress),
                config: config.toJSON() as object,
                state: stakingPositionStateToJSON(stateData) as object,
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

        return UniswapV3StakingPosition.fromDB(
            row as unknown as UniswapV3StakingPositionRow,
            token0,
            token1,
        );
    }

    // =========================================================================
    // PRIVATE: MAP DB ROW → DOMAIN OBJECT
    // =========================================================================

    private async mapToPosition(
        row: UniswapV3StakingPositionRow,
    ): Promise<UniswapV3StakingPosition> {
        const configJSON = row.config as unknown as UniswapV3StakingPositionConfigJSON;

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
                `Tokens not found for staking-vault position ${row.id}: token0=${configJSON.token0Address}, token1=${configJSON.token1Address}`,
            );
        }

        const token0 = Erc20Token.fromDB(token0Row as any) as TokenInterface;
        const token1 = Erc20Token.fromDB(token1Row as any) as TokenInterface;

        return UniswapV3StakingPosition.fromDB(row, token0, token1);
    }
}
