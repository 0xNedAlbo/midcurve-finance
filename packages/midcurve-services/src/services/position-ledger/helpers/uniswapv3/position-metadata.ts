/**
 * Position Metadata Fetching Utilities for UniswapV3 Position Ledger
 *
 * Provides functions for fetching position metadata from the database.
 */

import type { PrismaClient } from '@midcurve/database';
import type { Logger } from 'pino';
import type { UniswapV3Position } from '@midcurve/shared';
import { log } from '../../../../logging/index.js';

/**
 * Position metadata result containing position data and extracted config.
 */
export interface PositionMetadata {
  /** The position record from database */
  position: UniswapV3Position;
  /** NFT token ID extracted from position config */
  nftId: bigint;
  /** Chain ID extracted from position config */
  chainId: number;
  /** Pool ID from position */
  poolId: string;
}

/**
 * Fetches position metadata from database and validates protocol.
 *
 * This function:
 * 1. Queries the position by ID (with pool included)
 * 2. Validates the position exists
 * 3. Validates the protocol is UniswapV3
 * 4. Extracts nftId and chainId from config
 *
 * @param positionId - The position ID to fetch
 * @param prisma - Prisma client instance
 * @param logger - Structured logger
 * @returns Position metadata with extracted config
 * @throws Error if position not found or protocol is not UniswapV3
 *
 * @example
 * ```typescript
 * const metadata = await fetchPositionMetadata(
 *   'pos_123',
 *   prisma,
 *   logger
 * );
 * console.log(metadata.nftId); // 123n
 * console.log(metadata.chainId); // 1 (Ethereum)
 * ```
 */
export async function fetchPositionMetadata(
  positionId: string,
  prisma: PrismaClient,
  logger: Logger
): Promise<PositionMetadata> {
  log.dbOperation(logger, 'findUnique', 'Position', { id: positionId });

  const position = await prisma.position.findUnique({
    where: { id: positionId },
    include: { pool: true },
  });

  if (!position) {
    throw new Error(`Position not found: ${positionId}`);
  }

  if (position.protocol !== 'uniswapv3') {
    throw new Error(
      `Invalid position protocol '${position.protocol}'. Expected 'uniswapv3'.`
    );
  }

  // Parse position config
  const config = position.config as unknown as { nftId: number; chainId: number };

  return {
    position: position as unknown as UniswapV3Position,
    nftId: BigInt(config.nftId),
    chainId: config.chainId,
    poolId: position.poolId,
  };
}
