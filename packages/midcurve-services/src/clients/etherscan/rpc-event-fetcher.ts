/**
 * RPC Event Fetcher for Local Chains
 *
 * Fetches Uniswap V3 position events directly via RPC calls instead of Etherscan.
 * Used as a fallback for local development chains (31337) where Etherscan is unavailable.
 *
 * Uses eth_getLogs RPC method with topic filters to query the NonfungiblePositionManager
 * for IncreaseLiquidity, DecreaseLiquidity, and Collect events.
 */

import type { PublicClient } from 'viem';
import { EvmConfig } from '../../config/evm.js';
import { createServiceLogger } from '../../logging/index.js';
import type { RawPositionEvent, UniswapV3EventType } from './types.js';
import { EVENT_SIGNATURES, NFT_POSITION_MANAGER_ADDRESSES } from './etherscan-client.js';

const logger = createServiceLogger('RpcEventFetcher');

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
 * Fetch position events via RPC for local chains
 *
 * @param chainId - Chain ID (should be 31337 for local)
 * @param nftId - NFT token ID
 * @param fromBlock - Starting block number
 * @param toBlock - Ending block number or 'latest'
 * @param evmConfig - Optional EvmConfig instance
 * @returns Array of parsed position events
 */
export async function fetchPositionEventsViaRpc(
  chainId: number,
  nftId: string | number,
  fromBlock: bigint | string | number,
  toBlock: bigint | string | number | 'latest',
  evmConfig?: EvmConfig
): Promise<RawPositionEvent[]> {
  const config = evmConfig ?? EvmConfig.getInstance();
  const client = config.getPublicClient(chainId);

  // Get NFPM address for this chain
  const nftManagerAddress = NFT_POSITION_MANAGER_ADDRESSES[chainId];
  if (!nftManagerAddress) {
    throw new Error(`No NFT Position Manager address configured for chain ${chainId}`);
  }

  // Convert NFT ID to padded hex topic
  const tokenIdHex = ('0x' + BigInt(nftId).toString(16).padStart(64, '0')) as `0x${string}`;

  // Convert block numbers
  const fromBlockBigInt = typeof fromBlock === 'string' ? BigInt(fromBlock) : BigInt(fromBlock);
  const toBlockParam = toBlock === 'latest' ? 'latest' : BigInt(toBlock);

  logger.debug(
    { chainId, nftId, tokenIdHex, fromBlock: fromBlockBigInt.toString(), toBlock: String(toBlockParam) },
    'Fetching position events via RPC'
  );

  const allEvents: RawPositionEvent[] = [];
  const eventTypes: UniswapV3EventType[] = ['INCREASE_LIQUIDITY', 'DECREASE_LIQUIDITY', 'COLLECT'];

  // Cache for block timestamps (block number -> timestamp)
  const blockTimestampCache = new Map<bigint, Date>();

  for (const eventType of eventTypes) {
    try {
      // Use raw filter with topics array for getLogs
      // viem's getLogs with topics requires strict: false to allow raw topic filtering
      const logs = await client.request({
        method: 'eth_getLogs',
        params: [{
          address: nftManagerAddress as `0x${string}`,
          topics: [EVENT_SIGNATURES[eventType] as `0x${string}`, tokenIdHex],
          fromBlock: `0x${fromBlockBigInt.toString(16)}`,
          toBlock: toBlockParam === 'latest' ? 'latest' : `0x${toBlockParam.toString(16)}`,
        }],
      }) as RpcLog[];

      logger.debug({ eventType, logCount: logs.length }, `Retrieved ${eventType} logs via RPC`);

      // Parse each log
      for (const log of logs) {
        const parsed = await parseRpcLog(log, eventType, chainId, client, blockTimestampCache);
        if (parsed) {
          allEvents.push(parsed);
        }
      }
    } catch (error) {
      logger.error({ eventType, error }, `Failed to fetch ${eventType} events via RPC`);
      throw error;
    }
  }

  // Deduplicate and sort by blockchain order
  const finalEvents = deduplicateAndSort(allEvents);

  logger.debug(
    { totalEvents: allEvents.length, finalEvents: finalEvents.length },
    'RPC event fetching complete'
  );

  return finalEvents;
}

/**
 * Parse a raw RPC Log into RawPositionEvent format
 */
async function parseRpcLog(
  log: RpcLog,
  eventType: UniswapV3EventType,
  chainId: number,
  client: PublicClient,
  blockTimestampCache: Map<bigint, Date>
): Promise<RawPositionEvent | null> {
  // Parse block number from hex
  const blockNumber = BigInt(log.blockNumber);

  // Get block timestamp (with caching)
  let blockTimestamp = blockTimestampCache.get(blockNumber);
  if (!blockTimestamp) {
    try {
      const block = await client.getBlock({ blockNumber });
      blockTimestamp = new Date(Number(block.timestamp) * 1000);
      blockTimestampCache.set(blockNumber, blockTimestamp);
    } catch (error) {
      logger.warn({ blockNumber: blockNumber.toString(), error }, 'Failed to fetch block timestamp, using current time');
      blockTimestamp = new Date();
    }
  }

  // Extract tokenId from topic[1]
  const tokenIdTopic = log.topics[1];
  if (!tokenIdTopic) {
    throw new Error('Missing tokenId in event topics');
  }
  const tokenId = BigInt(tokenIdTopic).toString();

  const baseEvent = {
    eventType,
    tokenId,
    transactionHash: log.transactionHash,
    blockNumber,
    transactionIndex: parseInt(log.transactionIndex, 16),
    logIndex: parseInt(log.logIndex, 16),
    blockTimestamp,
    chainId,
  };

  // Parse event-specific data from log.data
  const data = log.data as `0x${string}`;

  switch (eventType) {
    case 'INCREASE_LIQUIDITY': {
      const { liquidity, amount0, amount1 } = decodeIncreaseLiquidityData(data);
      return {
        ...baseEvent,
        liquidity: liquidity.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString(),
      };
    }

    case 'DECREASE_LIQUIDITY': {
      const { liquidity, amount0, amount1 } = decodeDecreaseLiquidityData(data);
      return {
        ...baseEvent,
        liquidity: liquidity.toString(),
        amount0: amount0.toString(),
        amount1: amount1.toString(),
      };
    }

    case 'COLLECT': {
      const { recipient, amount0, amount1 } = decodeCollectData(data);
      return {
        ...baseEvent,
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        recipient,
      };
    }

    default:
      return null;
  }
}

/**
 * Decode IncreaseLiquidity event data
 * Event: IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
 */
function decodeIncreaseLiquidityData(data: `0x${string}`): {
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
} {
  const hex = data.slice(2);
  const chunks = hex.match(/.{64}/g) || [];

  if (chunks.length < 3) {
    throw new Error(`Invalid IncreaseLiquidity data: expected 3 chunks, got ${chunks.length}`);
  }

  return {
    liquidity: BigInt('0x' + chunks[0]!),
    amount0: BigInt('0x' + chunks[1]!),
    amount1: BigInt('0x' + chunks[2]!),
  };
}

/**
 * Decode DecreaseLiquidity event data
 * Same structure as IncreaseLiquidity
 */
function decodeDecreaseLiquidityData(data: `0x${string}`): {
  liquidity: bigint;
  amount0: bigint;
  amount1: bigint;
} {
  return decodeIncreaseLiquidityData(data);
}

/**
 * Decode Collect event data
 * Event: Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)
 */
function decodeCollectData(data: `0x${string}`): {
  recipient: string;
  amount0: bigint;
  amount1: bigint;
} {
  const hex = data.slice(2);
  const chunks = hex.match(/.{64}/g) || [];

  if (chunks.length < 3) {
    throw new Error(`Invalid Collect data: expected 3 chunks, got ${chunks.length}`);
  }

  // Extract recipient address (last 20 bytes of first chunk)
  const recipientHex = chunks[0]!.slice(24);
  const recipient = '0x' + recipientHex;

  return {
    recipient,
    amount0: BigInt('0x' + chunks[1]!),
    amount1: BigInt('0x' + chunks[2]!),
  };
}

/**
 * Remove duplicates and sort events by blockchain order
 */
function deduplicateAndSort(events: RawPositionEvent[]): RawPositionEvent[] {
  const uniqueEvents = new Map<string, RawPositionEvent>();

  for (const event of events) {
    const key = `${event.transactionHash}-${event.logIndex}`;
    if (!uniqueEvents.has(key)) {
      uniqueEvents.set(key, event);
    }
  }

  return Array.from(uniqueEvents.values()).sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return Number(a.blockNumber - b.blockNumber);
    }
    if (a.transactionIndex !== b.transactionIndex) {
      return a.transactionIndex - b.transactionIndex;
    }
    return a.logIndex - b.logIndex;
  });
}
