/**
 * Fee Recipient Resolution
 *
 * Determines the fee recipient address for order executions.
 * Returns the MidcurveTreasury contract address if deployed on the order's chain,
 * otherwise returns zero address (fees disabled).
 */

import { SharedContractNameEnum, normalizeAddress } from '@midcurve/shared';
import { automationLogger } from './logger';
import { getSharedContractService } from './services';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const log = automationLogger.child({ component: 'FeeRecipient' });

/**
 * Resolve the fee recipient address for a given chain.
 *
 * @param chainId - The EVM chain ID of the order being executed
 * @returns MidcurveTreasury address if deployed, otherwise zero address (fees disabled)
 */
export async function resolveFeeRecipient(chainId: number): Promise<string> {
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

  log.debug({ chainId }, 'No treasury contract found, fees disabled');
  return ZERO_ADDRESS;
}
