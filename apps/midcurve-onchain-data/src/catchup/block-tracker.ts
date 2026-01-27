/**
 * Block Tracker
 *
 * Cache operations for tracking the last processed block per chain.
 * Uses PostgreSQL-based distributed cache from @midcurve/services.
 */

import { CacheService } from '@midcurve/services';
import { onchainDataLogger } from '../lib/logger';

const log = onchainDataLogger.child({ component: 'BlockTracker' });

/**
 * Cache key prefix for block tracking
 * Uses onchain-data: prefix to distinguish from other services
 */
const CACHE_KEY_PREFIX = 'onchain-data:position-liquidity:last-block';

/**
 * Cache TTL: 1 year (effectively permanent)
 */
const BLOCK_TRACKING_TTL_SECONDS = 31536000; // 365 days

/**
 * Cached block record structure
 */
interface BlockRecord {
  blockNumber: string; // Stored as string for JSON serialization
  updatedAt: string; // ISO timestamp
}

/**
 * Build cache key for a chain
 */
function buildCacheKey(chainId: number): string {
  return `${CACHE_KEY_PREFIX}:${chainId}`;
}

/**
 * Get the last processed block number for a chain.
 *
 * @param chainId - Chain ID to query
 * @returns Last processed block number, or null if not found
 */
export async function getLastProcessedBlock(chainId: number): Promise<bigint | null> {
  const cache = CacheService.getInstance();
  const key = buildCacheKey(chainId);

  try {
    const record = await cache.get<BlockRecord>(key);

    if (!record) {
      log.debug({ chainId, key }, 'No cached block record found');
      return null;
    }

    const blockNumber = BigInt(record.blockNumber);
    log.debug({ chainId, blockNumber: blockNumber.toString(), updatedAt: record.updatedAt }, 'Retrieved cached block');
    return blockNumber;
  } catch (error) {
    log.warn(
      { chainId, error: error instanceof Error ? error.message : String(error) },
      'Failed to get cached block, returning null'
    );
    return null;
  }
}

/**
 * Set the last processed block number for a chain.
 *
 * @param chainId - Chain ID to update
 * @param blockNumber - Block number to store
 */
export async function setLastProcessedBlock(chainId: number, blockNumber: bigint): Promise<void> {
  const cache = CacheService.getInstance();
  const key = buildCacheKey(chainId);

  const record: BlockRecord = {
    blockNumber: blockNumber.toString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    const success = await cache.set(key, record, BLOCK_TRACKING_TTL_SECONDS);

    if (success) {
      log.debug({ chainId, blockNumber: blockNumber.toString() }, 'Updated cached block');
    } else {
      log.warn({ chainId, blockNumber: blockNumber.toString() }, 'Failed to update cached block');
    }
  } catch (error) {
    log.warn(
      { chainId, blockNumber: blockNumber.toString(), error: error instanceof Error ? error.message : String(error) },
      'Error updating cached block'
    );
  }
}

/**
 * Update block tracking if the new block is higher than the cached block.
 * This is used for event-driven updates from WebSocket events.
 *
 * @param chainId - Chain ID to update
 * @param blockNumber - Block number from the event
 */
export async function updateBlockIfHigher(chainId: number, blockNumber: bigint): Promise<void> {
  const cached = await getLastProcessedBlock(chainId);

  if (cached === null || blockNumber > cached) {
    await setLastProcessedBlock(chainId, blockNumber);
  }
}
