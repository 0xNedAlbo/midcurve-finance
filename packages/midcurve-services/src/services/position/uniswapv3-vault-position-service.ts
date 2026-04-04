/**
 * UniswapV3 Vault Position Service
 *
 * Service layer for managing vault share positions.
 * Handles discovery, creation, and refresh of vault share positions.
 *
 * Implementation deferred to backend integration task — this is the type-safe stub
 * with documented method signatures.
 */

import type { PrismaClient } from '@prisma/client';
import type { PrismaTransactionClient } from '../../clients/prisma/index.js';

// ============================================================================
// DEPENDENCIES
// ============================================================================

export interface UniswapV3VaultPositionServiceDependencies {
  prisma?: PrismaClient;
}

// ============================================================================
// SERVICE
// ============================================================================

export class UniswapV3VaultPositionService {
  // @ts-expect-error — will be used when methods are implemented
  private readonly prisma: PrismaClient;

  constructor(deps: UniswapV3VaultPositionServiceDependencies = {}) {
    this.prisma = deps.prisma ?? (undefined as unknown as PrismaClient);
  }

  /**
   * Discover a vault share position from on-chain data.
   *
   * Flow:
   * 1. Read vault contract: token0, token1, tokenId, factory, pool, ticks, decimals
   * 2. Read user's share balance from vault.balanceOf(userAddress)
   * 3. Create position in DB with config/state
   * 4. Sync ledger events from vault deployment block
   * 5. Return fully initialized position
   *
   * @param userId - User who owns the shares
   * @param params.chainId - Chain where the vault is deployed
   * @param params.vaultAddress - AllowlistedUniswapV3Vault clone address
   * @param params.userAddress - User's wallet address (to check balanceOf)
   * @param params.quoteTokenAddress - Which token is the quote token
   */
  // async discover(userId: string, params: {
  //   chainId: number;
  //   vaultAddress: string;
  //   userAddress: string;
  //   quoteTokenAddress?: string;
  // }, dbTx?: PrismaTransactionClient): Promise<UniswapV3VaultPosition> { ... }

  /**
   * Refresh a vault share position's on-chain state.
   *
   * Flow:
   * 1. Read vault state: balanceOf, totalSupply, liquidity, feePerShare, feeDebt, claimableFees
   * 2. Refresh pool state (reuse pool service)
   * 3. Sync ledger events incrementally
   * 4. Recalculate metrics (currentValue, unrealizedPnl, APR)
   * 5. Detect closed position (sharesBalance == 0)
   *
   * @param positionId - Position database ID
   * @param blockNumber - Block number to read state at ('latest' or specific block)
   */
  // async refresh(
  //   positionId: string,
  //   blockNumber: number | 'latest' = 'latest',
  //   dbTx?: PrismaTransactionClient,
  // ): Promise<UniswapV3VaultPosition> { ... }
}
