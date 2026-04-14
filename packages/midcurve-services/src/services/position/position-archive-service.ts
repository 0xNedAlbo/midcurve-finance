/**
 * Position Archive Service
 *
 * Protocol-agnostic service for archiving/unarchiving positions.
 * Archiving is a user-controlled action that hides positions from the active list.
 * Archived positions are still tracked in accounting.
 */

import { prisma as prismaClient, PrismaClient } from '@midcurve/database';
import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

export interface PositionArchiveServiceDependencies {
  prisma?: PrismaClient;
}

export class PositionArchiveService {
  private readonly _prisma: PrismaClient;
  private readonly logger: ServiceLogger;

  constructor(dependencies: PositionArchiveServiceDependencies = {}) {
    this._prisma = dependencies.prisma ?? prismaClient;
    this.logger = createServiceLogger('PositionArchiveService');
  }

  /**
   * Archive or unarchive a position.
   *
   * @param positionId - Position database ID
   * @param userId - User ID (for ownership verification)
   * @param archive - true to archive, false to unarchive
   */
  async setArchived(positionId: string, userId: string, archive: boolean): Promise<void> {
    this.logger.info({ positionId, userId, archive }, 'Setting position archive state');

    await this._prisma.position.update({
      where: { id: positionId, userId },
      data: {
        isArchived: archive,
        archivedAt: archive ? new Date() : null,
      },
    });

    this.logger.info({ positionId, archive }, 'Position archive state updated');
  }
}
