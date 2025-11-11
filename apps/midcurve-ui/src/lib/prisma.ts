import { PrismaClient } from '@prisma/client';

// PrismaClient is attached to the `global` object in development to prevent
// exhausting your database connection limit.
//
// Learn more:
// https://pris.ly/d/help/next-js-best-practices

const globalForPrisma = global as unknown as { prisma: PrismaClient | undefined };

// Lazy initialization - only create client when first accessed
// This prevents initialization during Next.js build-time analysis
let _prisma: PrismaClient | undefined = globalForPrisma.prisma;

function getPrismaClient(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });

    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.prisma = _prisma;
    }
  }

  return _prisma;
}

// Export a Proxy that lazy-loads the Prisma client on first property access
export const prisma = new Proxy({} as PrismaClient, {
  get: (_target, prop) => {
    const client = getPrismaClient();
    const value = client[prop as keyof PrismaClient];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
