/**
 * Prisma Client Singleton
 *
 * Following the official Prisma + Turborepo pattern:
 * https://www.prisma.io/docs/guides/turborepo
 *
 * This file creates a singleton Prisma client instance that is shared
 * across all packages in the monorepo. In development, it's stored in
 * globalThis to prevent hot-reload from creating multiple instances.
 */

import { PrismaClient } from './generated/prisma';

const prismaClientSingleton = () => {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
};

declare const globalThis: {
  prismaGlobal: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

export const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma;
