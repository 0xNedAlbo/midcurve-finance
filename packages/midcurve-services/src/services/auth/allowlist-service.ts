/**
 * UserAllowListService
 *
 * Checks whether a wallet address is on the registration allowlist.
 * Gates all sign-in attempts — both new and returning users.
 */

import type { PrismaClient } from '@midcurve/database';
import { validateAndNormalizeAddress } from '../../utils/auth/index.js';
import { prisma } from '@midcurve/database';

export interface UserAllowListServiceDependencies {
  prisma?: PrismaClient;
}

export class UserAllowListService {
  private readonly prisma: PrismaClient;

  constructor(dependencies: UserAllowListServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? prisma;
  }

  /**
   * Check if a wallet address is on the allowlist.
   */
  async isAllowed(address: string): Promise<boolean> {
    const normalizedAddress = validateAndNormalizeAddress(address);

    const entry = await this.prisma.userAllowListEntry.findUnique({
      where: { address: normalizedAddress },
    });

    return entry !== null;
  }
}
