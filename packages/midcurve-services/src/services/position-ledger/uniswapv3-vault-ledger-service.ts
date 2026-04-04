/**
 * UniswapV3 Vault Ledger Service
 *
 * Handles event discovery and PnL processing for vault share positions.
 *
 * Implementation deferred to backend integration task — this is the type-safe stub
 * with documented method signatures.
 *
 * Event sources (on-chain):
 * - Minted(to, shares, deltaL, amount0, amount1) → VAULT_MINT
 * - Burned(from, shares, deltaL, amount0, amount1) → VAULT_BURN
 * - FeesCollected(user, fee0, fee1) → VAULT_COLLECT_YIELD
 * - Transfer(from, to, amount) (ERC-20) → VAULT_TRANSFER_IN / VAULT_TRANSFER_OUT
 */

import type { PrismaClient } from '@prisma/client';

// ============================================================================
// DEPENDENCIES
// ============================================================================

export interface UniswapV3VaultLedgerServiceDependencies {
  prisma?: PrismaClient;
}

// ============================================================================
// SERVICE
// ============================================================================

export class UniswapV3VaultLedgerService {
  // @ts-expect-error — will be used when methods are implemented
  private readonly prisma: PrismaClient;

  constructor(deps: UniswapV3VaultLedgerServiceDependencies = {}) {
    this.prisma = deps.prisma ?? (undefined as unknown as PrismaClient);
  }

  /**
   * Sync ledger events for a vault share position.
   *
   * Flow:
   * 1. Get last finalized block
   * 2. Determine fromBlock (last event block or vault deployment block)
   * 3. Fetch vault events from block explorer (Minted, Burned, FeesCollected, Transfer)
   * 4. Filter to events involving this user's address
   * 5. Process events sequentially (cost basis, PnL, yield)
   * 6. Save to database
   * 7. Refresh APR periods
   *
   * @param positionId - Position database ID
   * @param params.chainId - Chain ID
   * @param params.vaultAddress - Vault contract address
   * @param params.userAddress - User's wallet address (to filter Transfer events)
   * @param params.forceFullResync - If true, resync from vault deployment block
   */
  // async syncLedgerEvents(positionId: string, params: {
  //   chainId: number;
  //   vaultAddress: string;
  //   userAddress: string;
  //   forceFullResync?: boolean;
  // }): Promise<{ eventsAdded: number }> { ... }
}
