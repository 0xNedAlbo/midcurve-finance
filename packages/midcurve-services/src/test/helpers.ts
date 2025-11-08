/**
 * Test helper functions for integration tests
 */

import { PrismaClient } from '@prisma/client';

// Singleton Prisma client for integration tests
let prismaInstance: PrismaClient | null = null;

/**
 * Get or create Prisma client for integration tests
 * Uses DATABASE_URL from environment (loaded from .env.test via --env-file)
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL is not set. Make sure .env.test exists and is loaded.\n' +
        'Integration tests should be run with: npm run test:integration'
      );
    }

    prismaInstance = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
      log: process.env.LOG_LEVEL === 'debug' ? ['query', 'error', 'warn'] : ['error'],
    });
  }
  return prismaInstance;
}

/**
 * Clear all data from the database
 * Maintains schema, only removes data
 * Order matters due to foreign key constraints
 */
export async function clearDatabase(): Promise<void> {
  const prisma = getPrismaClient();

  try {
    // Delete in order respecting foreign key constraints
    await prisma.position.deleteMany({});
    await prisma.poolPrice.deleteMany({}); // Delete pool prices before pools
    await prisma.pool.deleteMany({});
    await prisma.token.deleteMany({});
    await prisma.user.deleteMany({});
  } catch (error) {
    console.error('Failed to clear database:', error);
    throw error;
  }
}

/**
 * Disconnect Prisma client
 * Call this at the end of test suites
 */
export async function disconnectPrisma(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
}

/**
 * Seed database with test data
 * Useful for setting up common test scenarios
 */
export async function seedTestData() {
  const prisma = getPrismaClient();

  // Example: Create a test user
  const testUser = await prisma.user.create({
    data: {
      name: 'Test User',
    },
  });

  // Example: Create USDC token
  const usdc = await prisma.token.create({
    data: {
      tokenType: 'erc20',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      config: {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        chainId: 1,
      },
    },
  });

  return { testUser, usdc };
}

/**
 * Count total records across all tables
 * Useful for verification in tests
 */
export async function countAllRecords() {
  const prisma = getPrismaClient();

  const counts = {
    users: await prisma.user.count(),
    tokens: await prisma.token.count(),
    pools: await prisma.pool.count(),
    positions: await prisma.position.count(),
  };

  return counts;
}
