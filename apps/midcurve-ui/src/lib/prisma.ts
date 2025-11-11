/**
 * Prisma Client Re-export
 *
 * Re-exports the Prisma client singleton from the @midcurve/database package.
 * All database access in the UI application goes through this single client instance.
 *
 * Following the official Prisma + Turborepo pattern:
 * https://www.prisma.io/docs/guides/turborepo
 */

export { prisma } from '@midcurve/database';
