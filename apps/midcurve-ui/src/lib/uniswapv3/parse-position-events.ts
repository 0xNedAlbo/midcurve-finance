/**
 * Parse Uniswap V3 Position Events from Transaction Receipts
 *
 * Extracts position events (INCREASE_LIQUIDITY, DECREASE_LIQUIDITY, COLLECT) from
 * transaction receipts after user executes on-chain transactions.
 *
 * These parsed events are sent to the backend via the PATCH /api/v1/positions/uniswapv3/:chainId/:nftId
 * endpoint to update the position state immediately (handles indexer lag).
 */

import { type TransactionReceipt, decodeEventLog } from 'viem';
import { NONFUNGIBLE_POSITION_MANAGER_ABI } from '@/config/contracts/nonfungible-position-manager';
import type { UpdateUniswapV3PositionEvent } from '@midcurve/api-shared';

/**
 * Parse Uniswap V3 position events from a transaction receipt
 *
 * Extracts IncreaseLiquidity, DecreaseLiquidity, and Collect events from
 * the NonfungiblePositionManager contract logs.
 *
 * @param receipt - Transaction receipt from wagmi/viem
 * @returns Array of parsed events ready to send to the API
 *
 * @example
 * ```ts
 * // After user confirms transaction
 * const receipt = await waitForTransaction({ hash: txHash });
 * const events = parsePositionEvents(receipt);
 *
 * // Send to API
 * await updatePosition({ chainId: 1, nftId: '12345', events });
 * ```
 */
export function parsePositionEvents(
  receipt: TransactionReceipt
): UpdateUniswapV3PositionEvent[] {
  const events: UpdateUniswapV3PositionEvent[] = [];

  // Process each log in the transaction receipt
  for (const log of receipt.logs) {
    try {
      // Attempt to decode log using NonfungiblePositionManager ABI
      const decoded = decodeEventLog({
        abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
        data: log.data,
        topics: log.topics,
      });

      // Extract common event data
      // Note: Transaction receipts don't include timestamps
      // We use current time as approximation since missing events are processed immediately
      // The sync service will use the correct block timestamp when Etherscan indexes it
      const baseEvent = {
        timestamp: new Date().toISOString(),
        blockNumber: receipt.blockNumber.toString(),
        transactionIndex: receipt.transactionIndex,
        logIndex: log.logIndex,
        transactionHash: receipt.transactionHash,
      };

      // Parse event based on type
      switch (decoded.eventName) {
        case 'IncreaseLiquidity': {
          const args = decoded.args as {
            tokenId: bigint;
            liquidity: bigint;
            amount0: bigint;
            amount1: bigint;
          };

          events.push({
            eventType: 'INCREASE_LIQUIDITY',
            ...baseEvent,
            liquidity: args.liquidity.toString(),
            amount0: args.amount0.toString(),
            amount1: args.amount1.toString(),
          });
          break;
        }

        case 'DecreaseLiquidity': {
          const args = decoded.args as {
            tokenId: bigint;
            liquidity: bigint;
            amount0: bigint;
            amount1: bigint;
          };

          events.push({
            eventType: 'DECREASE_LIQUIDITY',
            ...baseEvent,
            liquidity: args.liquidity.toString(),
            amount0: args.amount0.toString(),
            amount1: args.amount1.toString(),
          });
          break;
        }

        case 'Collect': {
          const args = decoded.args as {
            tokenId: bigint;
            recipient: `0x${string}`;
            amount0: bigint;
            amount1: bigint;
          };

          events.push({
            eventType: 'COLLECT',
            ...baseEvent,
            amount0: args.amount0.toString(),
            amount1: args.amount1.toString(),
            recipient: args.recipient,
          });
          break;
        }

        // Ignore other events (Transfer, Approval, etc.)
        default:
          continue;
      }
    } catch (_error) {
      // Log decode failed - likely not a NonfungiblePositionManager event
      // Skip this log and continue
      continue;
    }
  }

  return events;
}

/**
 * Extract token ID from IncreaseLiquidity or DecreaseLiquidity event
 *
 * Useful when creating a new position (minting NFT) to get the newly assigned token ID.
 *
 * @param receipt - Transaction receipt
 * @returns Token ID as string, or null if not found
 *
 * @example
 * ```ts
 * const receipt = await waitForTransaction({ hash: mintTxHash });
 * const tokenId = extractTokenId(receipt);
 * ```
 */
export function extractTokenId(receipt: TransactionReceipt): string | null {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: NONFUNGIBLE_POSITION_MANAGER_ABI,
        data: log.data,
        topics: log.topics,
      });

      if (
        decoded.eventName === 'IncreaseLiquidity' ||
        decoded.eventName === 'DecreaseLiquidity'
      ) {
        const args = decoded.args as { tokenId: bigint };
        return args.tokenId.toString();
      }
    } catch (_error) {
      // Skip logs that can't be decoded
      continue;
    }
  }

  return null;
}
