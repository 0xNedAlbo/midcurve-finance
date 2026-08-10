/**
 * Pool Price Prefetch
 *
 * Importing ledger events is pure database work, but every event needs the pool
 * price at its block to value the position. Discovering a price is network I/O
 * (an RPC read on a cache miss), so doing it inside the per-log loop puts RPC
 * round-trips inside whatever transaction the import runs in — which is how
 * position refresh used to exceed Prisma's interactive-transaction timeout and
 * fail with "Transaction not found".
 *
 * The fix is to resolve every price up front, before the write transaction
 * opens, and let the import read from a map. Both the NFT and vault ledger
 * services use this.
 */

import type { UniswapV3PoolPriceService } from './uniswapv3-pool-price-service.js';

/** Pool price at the block of a single ledger event. */
export interface EventPoolPrice {
    sqrtPriceX96: bigint;
    timestamp: Date;
}

/** Map from {@link poolPriceKey} to the price at that block. */
export type PoolPriceMap = ReadonlyMap<string, EventPoolPrice>;

/**
 * The subset of a raw log this module needs. Both `RawLogInput` (NFT) and
 * `VaultRawLogInput` (vault) satisfy it.
 */
export interface PricedLog {
    blockNumber: string | bigint;
    blockHash: string;
    removed?: boolean;
}

/**
 * Key a pool price by the block it belongs to.
 *
 * Includes the block hash, not just the number: after a reorg the same height
 * can carry a different price, and ledger events are keyed by block hash too.
 */
export function poolPriceKey(
    blockNumber: bigint | string | number,
    blockHash: string,
): string {
    return `${BigInt(blockNumber).toString()}/${blockHash.toLowerCase()}`;
}

/**
 * Resolve the pool price for every block covered by `logs`, in parallel.
 *
 * Call this before opening the write transaction and hand the result to the
 * ledger service's `importLogsForPosition`. Distinct (blockNumber, blockHash)
 * pairs are deduplicated, so several logs in one block cost one lookup.
 *
 * @param chainId - EVM chain the pool lives on
 * @param poolAddress - Pool to read the price from
 * @param logs - Logs about to be imported
 * @param poolPriceService - Service performing the discovery
 */
export async function prefetchPoolPrices(
    chainId: number,
    poolAddress: string,
    logs: readonly PricedLog[],
    poolPriceService: UniswapV3PoolPriceService,
): Promise<PoolPriceMap> {
    const wanted = new Map<string, { blockNumber: number; blockHash: string }>();
    for (const log of logs) {
        // Removed logs delete rows by block hash; they never need a price.
        if (log.removed) continue;
        const key = poolPriceKey(log.blockNumber, log.blockHash);
        if (wanted.has(key)) continue;
        wanted.set(key, {
            blockNumber: Number(BigInt(log.blockNumber)),
            blockHash: log.blockHash,
        });
    }

    const entries = await Promise.all(
        Array.from(wanted.entries()).map(async ([key, { blockNumber, blockHash }]) => {
            const price = await poolPriceService.discover(
                { chainId, poolAddress },
                { blockNumber, blockHash },
            );
            return [key, { sqrtPriceX96: price.sqrtPriceX96, timestamp: price.timestamp }] as const;
        }),
    );

    return new Map(entries);
}

/**
 * Read a prefetched price, or throw if the prefetch missed it.
 *
 * A miss means the prefetch ran over a different log set than the import —
 * a programming error, not a recoverable condition.
 */
export function requirePoolPrice(
    poolPrices: PoolPriceMap,
    blockNumber: bigint | string | number,
    blockHash: string,
    context: string,
): EventPoolPrice {
    const key = poolPriceKey(blockNumber, blockHash);
    const price = poolPrices.get(key);
    if (!price) {
        throw new Error(
            `Pool price not prefetched for ${key} (${context}). `
            + 'prefetchPoolPrices must run over the same log set that is imported.',
        );
    }
    return price;
}
