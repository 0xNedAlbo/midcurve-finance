/**
 * Database Package Entry Point
 *
 * Re-exports the Prisma client singleton and all generated types.
 * All packages in the monorepo should import from this package instead
 * of @prisma/client to ensure a single client instance.
 */

export { prisma } from './client.js';
export * from './generated/prisma/index.js';
