/**
 * Fee Recipient Resolution
 *
 * Determines the fee recipient address for order executions.
 *
 * Priority:
 * 1. MidcurveTreasury contract on the order's chain (from shared_contracts table)
 * 2. First admin user's wallet address (fallback)
 * 3. Zero address (fees disabled)
 */

import { SharedContractNameEnum, normalizeAddress } from '@midcurve/shared';
import { prisma } from '@midcurve/database';
import { automationLogger } from './logger';
import { getSharedContractService } from './services';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const log = automationLogger.child({ component: 'FeeRecipient' });

/**
 * Resolve the fee recipient address for a given chain.
 *
 * @param chainId - The EVM chain ID of the order being executed
 * @returns EIP-55 checksummed fee recipient address, or zero address if none found
 */
export async function resolveFeeRecipient(chainId: number): Promise<string> {
  // 1. Look up MidcurveTreasury contract for this chain
  const sharedContractService = getSharedContractService();
  const treasury = await sharedContractService.findLatestByChainAndName(
    chainId,
    SharedContractNameEnum.MIDCURVE_TREASURY
  );

  if (treasury) {
    const address = normalizeAddress(treasury.config.address);
    log.info({ chainId, treasuryAddress: address }, 'Using MidcurveTreasury as fee recipient');
    return address;
  }

  // 2. Fall back to first admin user's address
  const adminUser = await prisma.user.findFirst({
    where: { isAdmin: true },
    orderBy: { createdAt: 'asc' },
    select: { address: true },
  });

  if (adminUser) {
    const address = normalizeAddress(adminUser.address);
    log.info({ chainId, adminAddress: address }, 'No treasury contract found, using admin address as fee recipient');
    return address;
  }

  // 3. No treasury, no admin — disable fees
  log.warn({ chainId }, 'No treasury contract or admin user found, fees disabled');
  return ZERO_ADDRESS;
}
