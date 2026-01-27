/**
 * Historical Event Fetcher
 *
 * Fetches historical position liquidity events using eth_getLogs RPC calls.
 * Implements mandatory batching to respect RPC provider limits (10,000 blocks per request).
 */

import type { Address, Log, PublicClient } from 'viem';
import { EvmConfig, UNISWAP_V3_POSITION_MANAGER_ADDRESSES, type SupportedChainId } from '@midcurve/services';
import { onchainDataLogger } from '../lib/logger';
import type { PositionEventType } from '../mq/position-messages';

const log = onchainDataLogger.child({ component: 'HistoricalEventFetcher' });

/**
 * Default batch size for getLogs requests (eth_getLogs provider limit)
 */
const DEFAULT_BATCH_SIZE_BLOCKS = 10000;

/**
 * Event signatures for NFPM position events
 */
const EVENT_SIGNATURES = {
  INCREASE_LIQUIDITY: '0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f',
  DECREASE_LIQUIDITY: '0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4',
  COLLECT: '0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01',
} as const;

/**
 * Options for fetching historical events
 */
export interface FetchHistoricalEventsOptions {
  chainId: number;
  nftIds: string[];
  fromBlock: bigint;
  toBlock: bigint;
  batchSize?: number;
}

/**
 * Parsed historical event
 */
export interface HistoricalEvent {
  nftId: string;
  eventType: PositionEventType;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
  rawLog: Log;
}

/**
 * Raw log format from eth_getLogs RPC call
 */
interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  transactionIndex: string;
  logIndex: string;
  removed: boolean;
}

/**
 * Map event signature to event type
 */
const EVENT_SIGNATURE_TO_TYPE: Record<string, PositionEventType> = {
  [EVENT_SIGNATURES.INCREASE_LIQUIDITY]: 'INCREASE_LIQUIDITY',
  [EVENT_SIGNATURES.DECREASE_LIQUIDITY]: 'DECREASE_LIQUIDITY',
  [EVENT_SIGNATURES.COLLECT]: 'COLLECT',
};

/**
 * All event signatures as an array for OR matching in topics[0]
 */
const ALL_EVENT_SIGNATURES: `0x${string}`[] = [
  EVENT_SIGNATURES.INCREASE_LIQUIDITY as `0x${string}`,
  EVENT_SIGNATURES.DECREASE_LIQUIDITY as `0x${string}`,
  EVENT_SIGNATURES.COLLECT as `0x${string}`,
];

/**
 * Fetch historical events for a single batch (block range), all event types in one RPC call.
 * Uses OR matching on both topics[0] (event signatures) and topics[1] (tokenIds).
 */
async function fetchBatch(
  client: PublicClient,
  nfpmAddress: Address,
  nftIds: string[],
  fromBlock: bigint,
  toBlock: bigint
): Promise<HistoricalEvent[]> {
  // Convert nftIds to padded hex topics for OR matching on topics[1]
  const tokenIdTopics: `0x${string}`[] = nftIds.map((id) => {
    const hex = BigInt(id).toString(16);
    return `0x${hex.padStart(64, '0')}` as `0x${string}`;
  });

  try {
    // Use raw eth_getLogs RPC call with arrays for OR matching on both:
    // - topics[0]: event signatures (INCREASE_LIQUIDITY OR DECREASE_LIQUIDITY OR COLLECT)
    // - topics[1]: tokenIds (any of the nftIds we're tracking)
    const rpcLogs = await client.request({
      method: 'eth_getLogs',
      params: [{
        address: nfpmAddress,
        topics: [ALL_EVENT_SIGNATURES, tokenIdTopics] as const,
        fromBlock: `0x${fromBlock.toString(16)}` as `0x${string}`,
        toBlock: `0x${toBlock.toString(16)}` as `0x${string}`,
      }],
    }) as RpcLog[];

    const events: HistoricalEvent[] = [];

    for (const rpcLog of rpcLogs) {
      // Determine event type from topics[0]
      const eventSignature = rpcLog.topics[0];
      if (!eventSignature) continue;

      const eventType = EVENT_SIGNATURE_TO_TYPE[eventSignature];
      if (!eventType) {
        log.warn({ eventSignature }, 'Unknown event signature in log');
        continue;
      }

      // Extract tokenId from topics[1]
      const tokenIdHex = rpcLog.topics[1];
      if (!tokenIdHex) continue;

      const nftId = BigInt(tokenIdHex).toString();

      // Convert RPC log to viem-like Log format for consistency
      const rawLog: Log = {
        address: rpcLog.address as Address,
        topics: rpcLog.topics as [`0x${string}`, ...`0x${string}`[]],
        data: rpcLog.data as `0x${string}`,
        blockNumber: BigInt(rpcLog.blockNumber),
        blockHash: rpcLog.blockHash as `0x${string}`,
        transactionHash: rpcLog.transactionHash as `0x${string}`,
        transactionIndex: parseInt(rpcLog.transactionIndex, 16),
        logIndex: parseInt(rpcLog.logIndex, 16),
        removed: rpcLog.removed,
      };

      events.push({
        nftId,
        eventType,
        blockNumber: rawLog.blockNumber ?? 0n,
        transactionHash: rawLog.transactionHash ?? '0x',
        logIndex: rawLog.logIndex ?? 0,
        rawLog,
      });
    }

    return events;
  } catch (error) {
    log.warn({
      fromBlock: fromBlock.toString(),
      toBlock: toBlock.toString(),
      error: error instanceof Error ? error.message : String(error),
    }, 'Failed to fetch logs for batch');
    return [];
  }
}

/**
 * Fetch historical events with batching to respect RPC limits.
 *
 * @param options - Fetch options including chainId, nftIds, and block range
 * @returns Array of historical events sorted by blockchain order
 */
export async function fetchHistoricalEvents(
  options: FetchHistoricalEventsOptions
): Promise<HistoricalEvent[]> {
  const { chainId, nftIds, fromBlock, toBlock, batchSize = DEFAULT_BATCH_SIZE_BLOCKS } = options;

  if (nftIds.length === 0) {
    log.debug({ chainId }, 'No nftIds to fetch events for');
    return [];
  }

  if (fromBlock >= toBlock) {
    log.debug({ chainId, fromBlock: fromBlock.toString(), toBlock: toBlock.toString() }, 'No block range to scan');
    return [];
  }

  const evmConfig = EvmConfig.getInstance();
  const client = evmConfig.getPublicClient(chainId);
  const nfpmAddress = UNISWAP_V3_POSITION_MANAGER_ADDRESSES[chainId as SupportedChainId];

  if (!nfpmAddress) {
    log.error({ chainId }, 'NFPM address not found for chain');
    return [];
  }

  const allEvents: HistoricalEvent[] = [];
  const totalBlocks = toBlock - fromBlock;
  let processedBlocks = 0n;

  log.info({
    chainId,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    totalBlocks: totalBlocks.toString(),
    nftIdCount: nftIds.length,
    batchSize,
  }, 'Starting historical event fetch');

  // Process in batches
  for (let batchStart = fromBlock; batchStart < toBlock; batchStart += BigInt(batchSize)) {
    const batchEnd = batchStart + BigInt(batchSize) - 1n > toBlock
      ? toBlock
      : batchStart + BigInt(batchSize) - 1n;

    try {
      const batchEvents = await fetchBatch(client, nfpmAddress, nftIds, batchStart, batchEnd);
      allEvents.push(...batchEvents);

      processedBlocks = batchEnd - fromBlock + 1n;
      const progress = Number((processedBlocks * 100n) / totalBlocks);

      log.debug({
        chainId,
        batchStart: batchStart.toString(),
        batchEnd: batchEnd.toString(),
        batchEventCount: batchEvents.length,
        totalEventCount: allEvents.length,
        progress: `${progress}%`,
      }, 'Processed batch');
    } catch (error) {
      log.error({
        chainId,
        batchStart: batchStart.toString(),
        batchEnd: batchEnd.toString(),
        error: error instanceof Error ? error.message : String(error),
      }, 'Failed to fetch batch, continuing with next batch');
      // Continue with next batch instead of failing entirely
    }
  }

  // Sort by blockchain order: blockNumber -> transactionIndex -> logIndex
  allEvents.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber < b.blockNumber ? -1 : 1;
    }
    // For events in the same block, use logIndex
    return a.logIndex - b.logIndex;
  });

  // Deduplicate by transactionHash:logIndex
  const seen = new Set<string>();
  const deduped = allEvents.filter((event) => {
    const key = `${event.transactionHash}:${event.logIndex}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  log.info({
    chainId,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    totalEvents: deduped.length,
    duplicatesRemoved: allEvents.length - deduped.length,
  }, 'Historical event fetch complete');

  return deduped;
}
