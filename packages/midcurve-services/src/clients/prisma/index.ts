/**
 * Prisma Client Types
 *
 * Shared Prisma-related type definitions for transactional operations.
 */

import { PrismaClient } from '@midcurve/database';

/**
 * Prisma transaction client type for use in transactional operations.
 * This is the client type available within a $transaction callback.
 */
export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
