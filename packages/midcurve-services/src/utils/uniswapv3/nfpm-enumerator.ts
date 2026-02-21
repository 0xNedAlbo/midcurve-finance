/**
 * NFPM Position Enumerator
 *
 * Enumerates all UniswapV3 positions owned by a wallet address on a given chain
 * using the NonfungiblePositionManager's ERC-721 enumeration interface.
 *
 * Uses viem multicall for efficient batching:
 * - 1 RPC call: balanceOf(wallet) → count
 * - 1 RPC call: multicall(tokenOfOwnerByIndex(wallet, 0..count-1)) → nftIds
 * - 1 RPC call: multicall(positions(nftId) for each nftId) → position data
 *
 * Filters to active positions only (liquidity > 0).
 */

import { type Address, type PublicClient, parseAbiItem } from 'viem';
import {
  UNISWAP_V3_POSITION_MANAGER_ABI,
  getPositionManagerAddress,
} from '../../config/uniswapv3.js';

// =============================================================================
// Types
// =============================================================================

/**
 * A position enumerated from the NFPM contract
 */
export interface EnumeratedPosition {
  /** NFT token ID */
  nftId: number;
  /** Current liquidity in position */
  liquidity: bigint;
  /** Uncollected fees/principal for token0 */
  tokensOwed0: bigint;
  /** Uncollected fees/principal for token1 */
  tokensOwed1: bigint;
}

// =============================================================================
// Constants
// =============================================================================

/** Maximum calls per multicall batch to stay within gas estimation limits */
const MULTICALL_BATCH_SIZE = 50;

/** ERC-721 Transfer event ABI for getLogs filtering */
const ERC721_TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
);

/** Zero address (mint = Transfer from address(0)) */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Enumerate all active UniswapV3 positions for a wallet on a single chain.
 *
 * Active = liquidity > 0 OR tokensOwed0 > 0 OR tokensOwed1 > 0
 *
 * @param client - viem PublicClient for the target chain
 * @param walletAddress - The wallet address to enumerate positions for
 * @param chainId - Chain ID (used to look up NFPM address)
 * @returns Array of active positions with nftId, liquidity, tokensOwed0, tokensOwed1
 */
export async function enumerateWalletPositions(
  client: PublicClient,
  walletAddress: Address,
  chainId: number,
): Promise<EnumeratedPosition[]> {
  const nfpmAddress = getPositionManagerAddress(chainId);

  // Step 1: Get total number of positions owned
  const balance = await client.readContract({
    address: nfpmAddress,
    abi: UNISWAP_V3_POSITION_MANAGER_ABI,
    functionName: 'balanceOf',
    args: [walletAddress],
  });

  const count = Number(balance);
  if (count === 0) {
    return [];
  }

  // Step 2: Get all NFT IDs via tokenOfOwnerByIndex (batched multicall)
  const nftIds = await fetchAllNftIds(client, nfpmAddress, walletAddress, count);

  // Step 3: Get position data for all NFTs (batched multicall)
  const positions = await fetchAllPositionData(client, nfpmAddress, nftIds);

  // Step 4: Filter to active positions
  return positions.filter((p) => p.liquidity > 0n);
}

/**
 * Fetch all NFT IDs owned by a wallet using batched multicall.
 */
async function fetchAllNftIds(
  client: PublicClient,
  nfpmAddress: Address,
  walletAddress: Address,
  count: number,
): Promise<number[]> {
  const nftIds: number[] = [];

  // Process in batches
  for (let offset = 0; offset < count; offset += MULTICALL_BATCH_SIZE) {
    const batchSize = Math.min(MULTICALL_BATCH_SIZE, count - offset);

    const contracts = Array.from({ length: batchSize }, (_, i) => ({
      address: nfpmAddress,
      abi: UNISWAP_V3_POSITION_MANAGER_ABI,
      functionName: 'tokenOfOwnerByIndex' as const,
      args: [walletAddress, BigInt(offset + i)] as const,
    }));

    const results = await client.multicall({ contracts });

    for (const result of results) {
      if (result.status === 'success') {
        nftIds.push(Number(result.result));
      }
    }
  }

  return nftIds;
}

/**
 * Fetch position data for all NFT IDs using batched multicall.
 */
async function fetchAllPositionData(
  client: PublicClient,
  nfpmAddress: Address,
  nftIds: number[],
): Promise<EnumeratedPosition[]> {
  const positions: EnumeratedPosition[] = [];

  // Process in batches
  for (let offset = 0; offset < nftIds.length; offset += MULTICALL_BATCH_SIZE) {
    const batch = nftIds.slice(offset, offset + MULTICALL_BATCH_SIZE);

    const contracts = batch.map((nftId) => ({
      address: nfpmAddress,
      abi: UNISWAP_V3_POSITION_MANAGER_ABI,
      functionName: 'positions' as const,
      args: [BigInt(nftId)] as const,
    }));

    const results = await client.multicall({ contracts });

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === 'success') {
        // positions() returns a tuple:
        // [nonce, operator, token0, token1, fee, tickLower, tickUpper,
        //  liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128,
        //  tokensOwed0, tokensOwed1]
        const data = result.result as readonly [
          bigint, string, string, string, number, number, number,
          bigint, bigint, bigint, bigint, bigint,
        ];

        positions.push({
          nftId: batch[i]!,
          liquidity: data[7],
          tokensOwed0: data[10],
          tokensOwed1: data[11],
        });
      }
    }
  }

  return positions;
}

// =============================================================================
// Mint Block Lookup
// =============================================================================

/**
 * Find the block number where an NFT was minted by searching for the
 * ERC-721 Transfer event from address(0).
 *
 * All three Transfer params (from, to, tokenId) are indexed, so the RPC
 * node can resolve this with its topic index in a single call across the
 * full block range — no batch scanning required.
 *
 * @param client - viem PublicClient for the target chain
 * @param nfpmAddress - NonfungiblePositionManager contract address
 * @param nftId - The NFT token ID to look up
 * @param deploymentBlock - NFPM deployment block (lower bound for search)
 * @returns The block number of the mint, or null if not found
 */
export async function findNftMintBlock(
  client: PublicClient,
  nfpmAddress: Address,
  nftId: bigint,
  deploymentBlock: bigint,
): Promise<bigint | null> {
  const logs = await client.getLogs({
    address: nfpmAddress,
    event: ERC721_TRANSFER_EVENT,
    args: {
      from: ZERO_ADDRESS,
      tokenId: nftId,
    },
    fromBlock: deploymentBlock,
    toBlock: 'latest',
  });

  if (logs.length > 0) {
    return logs[0]!.blockNumber;
  }

  return null;
}
