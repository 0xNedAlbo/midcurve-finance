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
    PositionClosedPayload,
    PositionDeletedPayload,
    PositionLiquidityRevertedPayload,
} from '../../events/index.js';
import { EvmConfig } from '../../config/evm.js';
import { UNISWAP_V3_POSITION_MANAGER_ABI } from '../../config/uniswapv3.js';
import { UniswapV3PoolService } from '../pool/uniswapv3-pool-service.js';
import type { PrismaTransactionClient } from '../../clients/prisma/index.js';
import { UniswapV3QuoteTokenService } from '../quote-token/uniswapv3-quote-token-service.js';
import { EvmBlockService } from '../block/evm-block-service.js';
import { UniswapV3PoolPriceService } from '../pool-price/uniswapv3-pool-price-service.js';
import { UniswapV3VaultLedgerService, type VaultRawLogInput } from '../position-ledger/uniswapv3-vault-ledger-service.js';
import { CacheService } from '../cache/index.js';
import { SharedContractService } from '../automation/shared-contract-service.js';
import { Erc20TokenService } from '../token/erc20-token-service.js';
import { tickToPrice, createErc20TokenHash } from '@midcurve/shared';

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
    positionManagerAddress: string;
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
    positionManagerAddress: string;
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
        positionManagerAddress: state.positionManagerAddress,
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
        positionManagerAddress: cached.positionManagerAddress,
    };
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

        await this.prisma.position.delete({ where: { id } });

        await this.eventPublisher.createAndPublish<PositionDeletedPayload>({
            type: 'position.deleted',
            entityType: 'position',
            entityId: position.id,
            userId: position.userId,
            payload: position.toJSON(),
            source: 'api',
        });

        this.logger.info({ positionId: id, vaultAddress: position.vaultAddress }, 'Vault position deleted');
    }

    // ============================================================================
    // DISCOVER
    // ============================================================================

    async discover(
        userId: string,
        params: {
            chainId: number;
            vaultAddress: string;
            userAddress: string;
            quoteTokenAddress?: string;
        },
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3VaultPosition> {
        const { chainId, userAddress } = params;
        const vaultAddress = normalizeAddress(params.vaultAddress);

        // Check for existing position
        const positionHash = `uniswapv3-vault/${chainId}/${vaultAddress}`;
        const existing = await this.findByPositionHash(userId, positionHash, dbTx);
        if (existing) {
            return this.refresh(existing.id, 'latest', dbTx);
        }

        const client = this._evmConfig.getPublicClient(chainId);

        // Read vault contract state in parallel
        let token0Addr: string, token1Addr: string, tokenId: bigint, poolAddr: string,
            tickLower: number, tickUpper: number, vaultDecimals: number, positionManagerAddr: string;
        try {
            [token0Addr, token1Addr, tokenId, poolAddr, tickLower, tickUpper, vaultDecimals, positionManagerAddr] =
                await Promise.all([
                    client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'token0' }),
                    client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'token1' }),
                    client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'tokenId' }),
                    client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'pool' }),
                    client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'tickLower' }),
                    client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'tickUpper' }),
                    client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'decimals' }),
                    client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'positionManager' }),
                ]) as [string, string, bigint, string, number, number, number, string];
        } catch {
            throw new Error(`INVALID_VAULT_CONTRACT: The address ${vaultAddress} is not a valid vault contract on chain ${chainId}`);
        }

        // Read user state
        const [sharesBalance, totalSupply, claimable] = await Promise.all([
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'balanceOf', args: [userAddress as Address] }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'totalSupply' }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'claimableFees', args: [userAddress as Address] }),
        ]) as [bigint, bigint, readonly [bigint, bigint]];

        // Read liquidity from NFPM
        const positionData = await client.readContract({
            address: positionManagerAddr as Address,
            abi: UNISWAP_V3_POSITION_MANAGER_ABI,
            functionName: 'positions',
            args: [tokenId],
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

        // Read pool state for the position state
        const [slot0Data, poolLiquidity] = await Promise.all([
            client.readContract({ address: poolAddr as Address, abi: [{ type: 'function', name: 'slot0', inputs: [], outputs: [{ name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' }, { name: '', type: 'uint16' }, { name: '', type: 'uint16' }, { name: '', type: 'uint16' }, { name: '', type: 'uint8' }, { name: '', type: 'bool' }], stateMutability: 'view' }], functionName: 'slot0' }),
            client.readContract({ address: poolAddr as Address, abi: [{ type: 'function', name: 'liquidity', inputs: [], outputs: [{ name: '', type: 'uint128' }], stateMutability: 'view' }], functionName: 'liquidity' }),
        ]) as [readonly [bigint, number, ...unknown[]], bigint];

        // Build config and state
        const configData: UniswapV3VaultPositionConfigData = {
            chainId,
            vaultAddress,
            underlyingTokenId: Number(tokenId),
            factoryAddress,
            userAddress: normalizeAddress(userAddress),
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
            unclaimedFees0: claimable[0],
            unclaimedFees1: claimable[1],
            isClosed: sharesBalance === 0n,
            sqrtPriceX96: slot0Data[0],
            currentTick: slot0Data[1],
            poolLiquidity: poolLiquidity as bigint,
            feeGrowthGlobal0: 0n,
            feeGrowthGlobal1: 0n,
        };

        // Create position in DB
        const position = await this.createPosition(
            userId, positionHash, configData, stateData, token0, token1, dbTx,
        );

        // Import ledger events
        const ledgerService = new UniswapV3VaultLedgerService(
            { positionId: position.id },
            { prisma: this.prisma },
        );
        const logs = await this.fetchAllVaultLogs(
            client, vaultAddress as Address, userAddress as Address, 0n,
        );
        await ledgerService.importLogsForPosition(
            position, chainId, userAddress, logs, this._poolPriceService, dbTx,
        );

        // Refresh to finalize metrics
        return this.refresh(position.id, 'latest', dbTx);
    }

    // ============================================================================
    // DISCOVER WALLET POSITIONS
    // ============================================================================

    async discoverWalletPositions(
        userId: string,
        walletAddress: string,
        chainIds?: number[],
    ): Promise<{ found: number; imported: number; skipped: number; errors: number }> {
        const supportedChains = chainIds ?? this._evmConfig.getSupportedChainIds();
        let found = 0;
        let imported = 0;
        let skipped = 0;
        let errors = 0;

        for (const chainId of supportedChains) {
            const factory = await this._sharedContractService.findLatestByChainAndName(
                chainId,
                'UniswapV3VaultFactory' as SharedContractName,
            );
            if (!factory) continue;

            const factoryAddress = (factory.config as { address: string }).address;
            const client = this._evmConfig.getPublicClient(chainId);

            // Get all vault addresses from factory events
            const vaultCreatedEvent = parseAbiItem(
                'event VaultCreated(address indexed vault, address indexed creator, uint256 indexed tokenId, bool allowlisted)',
            );
            const vaultCreatedLogs = await client.getLogs({
                address: factoryAddress as Address,
                event: vaultCreatedEvent,
                fromBlock: 0n,
                toBlock: 'latest' as any,
            });

            if (vaultCreatedLogs.length === 0) continue;

            const vaultAddresses = vaultCreatedLogs.map((l) => l.args.vault as Address);

            // Batch scan for user involvement: Minted(to=user) + Transfer(to=user)
            const mintedEvent = parseAbiItem(
                'event Minted(address indexed to, uint256 shares, uint128 deltaL, uint256 amount0, uint256 amount1)',
            );
            const transferEvent = parseAbiItem(
                'event Transfer(address indexed from, address indexed to, uint256 value)',
            );

            const [mintLogs, transferLogs] = await Promise.all([
                client.getLogs({
                    address: vaultAddresses,
                    event: mintedEvent,
                    args: { to: walletAddress as Address },
                    fromBlock: 0n,
                    toBlock: 'latest' as any,
                }),
                client.getLogs({
                    address: vaultAddresses,
                    event: transferEvent,
                    args: { to: walletAddress as Address },
                    fromBlock: 0n,
                    toBlock: 'latest' as any,
                }),
            ]);

            // Collect unique vault addresses where user received shares
            const matchedVaults = new Set<string>();
            for (const l of mintLogs) matchedVaults.add(normalizeAddress(l.address));
            for (const l of transferLogs) matchedVaults.add(normalizeAddress(l.address));

            found += matchedVaults.size;

            for (const vaultAddr of matchedVaults) {
                const positionHash = `uniswapv3-vault/${chainId}/${vaultAddr}`;
                const existing = await this.findByPositionHash(userId, positionHash);
                if (existing) {
                    skipped++;
                    continue;
                }

                try {
                    await this.discover(userId, {
                        chainId,
                        vaultAddress: vaultAddr,
                        userAddress: walletAddress,
                    });
                    imported++;
                } catch (e) {
                    this.logger.warn({ chainId, vaultAddr, error: e }, 'Failed to discover vault position');
                    errors++;
                }
            }
        }

        return { found, imported, skipped, errors };
    }

    // ============================================================================
    // REFRESH
    // ============================================================================

    async refresh(
        id: string,
        blockNumber: number | 'latest' = 'latest',
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3VaultPosition> {
        await this.refreshAllPositionLogs(id, blockNumber, dbTx);
        return this.refreshOnChainState(id, blockNumber, dbTx);
    }

    // ============================================================================
    // RESET
    // ============================================================================

    async reset(
        id: string,
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3VaultPosition> {
        const position = await this.findById(id, dbTx);
        if (!position) throw new Error(`Vault position not found: ${id}`);

        const ledgerService = new UniswapV3VaultLedgerService(
            { positionId: id },
            { prisma: this.prisma },
        );

        // Capture events for domain event emission
        const existingEvents = await ledgerService.findAll(dbTx);

        // Delete all events
        await ledgerService.deleteAll(dbTx);

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
                    chainId: position.chainId,
                    nftId: position.underlyingTokenId.toString(),
                    blockHash,
                    deletedCount,
                    revertedAt: new Date().toISOString(),
                },
                source: 'business-logic',
            }, dbTx);
        }

        // Reimport from scratch
        await this.refreshAllPositionLogs(id, 'latest', dbTx);
        return this.refreshOnChainState(id, 'latest', dbTx);
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
    // PRIVATE: REFRESH LEDGER EVENTS
    // ============================================================================

    private async refreshAllPositionLogs(
        id: string,
        _blockNumber: number | 'latest' = 'latest',
        dbTx?: PrismaTransactionClient,
    ): Promise<void> {
        const position = await this.findById(id, dbTx);
        if (!position) throw new Error(`Vault position not found: ${id}`);

        const chainId = position.chainId;
        const vaultAddress = position.vaultAddress;
        const client = this._evmConfig.getPublicClient(chainId);

        const ledgerService = new UniswapV3VaultLedgerService(
            { positionId: id },
            { prisma: this.prisma },
        );

        // Determine fromBlock
        const lastEvent = await ledgerService.findLast(dbTx);
        let fromBlock: bigint;
        if (lastEvent) {
            const finalizedBlock = await this._evmBlockService.getLastFinalizedBlockNumber(chainId);
            fromBlock = finalizedBlock && lastEvent.blockNumber < finalizedBlock
                ? lastEvent.blockNumber
                : lastEvent.blockNumber;
        } else {
            fromBlock = 0n; // Full sync — from block 0 (will be refined when we have vault deployment block)
        }

        const userAddress = position.typedConfig.userAddress;

        const logs = await this.fetchAllVaultLogs(
            client, vaultAddress as Address, userAddress as Address, fromBlock,
        );

        const importResult = await ledgerService.importLogsForPosition(
            position, chainId, userAddress, logs, this._poolPriceService, dbTx,
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
                    chainId,
                    nftId: position.underlyingTokenId.toString(),
                    blockHash,
                    deletedCount,
                    revertedAt: new Date().toISOString(),
                },
                source: 'business-logic',
            }, dbTx);
        }
    }

    // ============================================================================
    // PRIVATE: REFRESH ON-CHAIN STATE
    // ============================================================================

    private async refreshOnChainState(
        id: string,
        blockNumber: number | 'latest' = 'latest',
        dbTx?: PrismaTransactionClient,
    ): Promise<UniswapV3VaultPosition> {
        const position = await this.findById(id, dbTx);
        if (!position) throw new Error(`Vault position not found: ${id}`);

        const onChainState = await this.fetchVaultState(position, blockNumber);

        const isClosed = onChainState.sharesBalance === 0n;

        const newState: UniswapV3VaultPositionState = {
            sharesBalance: onChainState.sharesBalance,
            totalSupply: onChainState.totalSupply,
            liquidity: onChainState.liquidity,
            unclaimedFees0: onChainState.unclaimedFees0,
            unclaimedFees1: onChainState.unclaimedFees1,
            isClosed,
            sqrtPriceX96: onChainState.sqrtPriceX96,
            currentTick: onChainState.currentTick,
            poolLiquidity: 0n,
            feeGrowthGlobal0: 0n,
            feeGrowthGlobal1: 0n,
        };

        // Update position in DB
        const db = dbTx ?? this.prisma;
        await db.position.update({
            where: { id },
            data: {
                state: vaultPositionStateToJSON(newState) as object,
                isActive: true,
                ...(isClosed && !position.positionClosedAt
                    ? { positionClosedAt: new Date() }
                    : {}),
            },
        });

        // Emit closed event if newly closed
        if (isClosed && !position.typedState.isClosed) {
            const closedPosition = await this.findById(id, dbTx);
            if (closedPosition) {
                await this.eventPublisher.createAndPublish<PositionClosedPayload>({
                    type: 'position.closed',
                    entityType: 'position',
                    entityId: closedPosition.id,
                    userId: closedPosition.userId,
                    payload: closedPosition.toJSON(),
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
     * Cache key: `vault-onchain:{chainId}:{vaultAddress}:{userAddress}:{blockNumber}`
     * TTL: 60 seconds (same block data is immutable, TTL is just for eviction)
     */
    private async fetchVaultState(
        position: UniswapV3VaultPosition,
        blockNumber: number | 'latest' = 'latest',
    ): Promise<OnChainVaultState> {
        const chainId = position.chainId;
        const vaultAddress = position.vaultAddress;
        const userAddress = position.typedConfig.userAddress;

        // 1. Resolve block number
        const resolvedBlockNumber = blockNumber === 'latest'
            ? await this._evmBlockService.getCurrentBlockNumber(chainId)
            : BigInt(blockNumber);

        // 2. Check cache
        const cacheKey = `vault-onchain:${chainId}:${vaultAddress}:${userAddress}:${resolvedBlockNumber}`;
        const cached = await this._cacheService.get<OnChainVaultStateCached>(cacheKey);
        if (cached) {
            this.logger.debug({ chainId, vaultAddress, blockNumber: resolvedBlockNumber.toString(), cacheHit: true }, 'Vault on-chain state cache hit');
            return deserializeVaultState(cached);
        }

        // 3. Cache miss — fetch from chain
        const client = this._evmConfig.getPublicClient(chainId);

        const [sharesBalance, totalSupply, claimable, slot0Data, positionManagerAddr] = await Promise.all([
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'balanceOf', args: [userAddress as Address], blockNumber: resolvedBlockNumber }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'totalSupply', blockNumber: resolvedBlockNumber }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'claimableFees', args: [userAddress as Address], blockNumber: resolvedBlockNumber }),
            client.readContract({ address: position.typedConfig.poolAddress as Address, abi: [{ type: 'function', name: 'slot0', inputs: [], outputs: [{ name: '', type: 'uint160' }, { name: '', type: 'int24' }, { name: '', type: 'uint16' }, { name: '', type: 'uint16' }, { name: '', type: 'uint16' }, { name: '', type: 'uint8' }, { name: '', type: 'bool' }], stateMutability: 'view' }], functionName: 'slot0', blockNumber: resolvedBlockNumber }),
            client.readContract({ address: vaultAddress as Address, abi: UniswapV3VaultAbi, functionName: 'positionManager' }),
        ]) as [bigint, bigint, readonly [bigint, bigint], readonly [bigint, number, ...unknown[]], string];

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
            unclaimedFees0: claimable[0],
            unclaimedFees1: claimable[1],
            sqrtPriceX96: slot0Data[0],
            currentTick: slot0Data[1],
            positionManagerAddress: positionManagerAddr as string,
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
        userAddress: Address,
        fromBlock: bigint,
        toBlock: bigint | 'latest' = 'latest',
    ): Promise<VaultRawLogInput[]> {
        const mintedEvent = parseAbiItem(
            'event Minted(address indexed to, uint256 shares, uint128 deltaL, uint256 amount0, uint256 amount1)',
        );
        const burnedEvent = parseAbiItem(
            'event Burned(address indexed from, uint256 shares, uint128 deltaL, uint256 amount0, uint256 amount1)',
        );
        const feesCollectedEvent = parseAbiItem(
            'event FeesCollected(address indexed user, uint256 fee0, uint256 fee1)',
        );
        const transferEvent = parseAbiItem(
            'event Transfer(address indexed from, address indexed to, uint256 value)',
        );

        const commonParams = { address: vaultAddress, fromBlock, toBlock };

        const [mintLogs, burnLogs, feeLogs, transferInLogs, transferOutLogs] = await Promise.all([
            client.getLogs({ ...commonParams, event: mintedEvent, args: { to: userAddress } }),
            client.getLogs({ ...commonParams, event: burnedEvent, args: { from: userAddress } }),
            client.getLogs({ ...commonParams, event: feesCollectedEvent, args: { user: userAddress } }),
            client.getLogs({ ...commonParams, event: transferEvent, args: { to: userAddress } }),
            client.getLogs({ ...commonParams, event: transferEvent, args: { from: userAddress } }),
        ]);

        const allLogs = [...mintLogs, ...burnLogs, ...feeLogs, ...transferInLogs, ...transferOutLogs];
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
                positionOpenedAt: new Date(),
                isActive: true,
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
