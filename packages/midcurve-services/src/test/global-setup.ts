/**
 * Global setup for integration tests
 * Runs once before all test files
 *
 * Responsibilities:
 * - Ensure test database is available
 * - Run Prisma migrations
 * - Prepare database schema
 * - Warm up CoinGecko cache (reduces API calls across all tests)
 */

import { execSync } from 'child_process';
import { PrismaClient } from '@midcurve/database';
import { CoinGeckoClient } from '../clients/coingecko/index.js';

/**
 * Warm up the CoinGecko cache with token list and market data
 * This significantly reduces API calls during test execution
 *
 * Strategy:
 * 1. Fetch token list (includes platform data) - 1 API call
 * 2. Fetch market data in batch (logo URLs, market caps) - 1 API call
 * 3. Manually populate individual coin detail caches by combining the data
 *
 * Total: Exactly 2 API calls (well below 30 req/minute limit)
 */
async function warmUpCoinGeckoCache(): Promise<void> {
  console.log('🔥 Warming up CoinGecko cache...');

  try {
    const client = CoinGeckoClient.getInstance();

    // Known stable tokens used across integration tests
    const TEST_COIN_IDS = ['usd-coin', 'weth', 'dai'];

    // Step 1: Fetch complete token list with platform data (1 API call)
    console.log('  📋 Step 1: Fetching token list with platform data...');
    const tokens = await client.getAllTokens();
    console.log(`  ✅ Cached ${tokens.length} tokens with platform addresses`);

    // Step 2: Fetch market data for test tokens in batch (1 API call)
    console.log(`  💰 Step 2: Fetching market data for ${TEST_COIN_IDS.length} coins: ${TEST_COIN_IDS.join(', ')}...`);
    const marketData = await client.getCoinsMarketData(TEST_COIN_IDS);
    console.log(`  ✅ Cached market data for ${marketData.length} coins`);

    // Step 3: Manually populate individual coin detail caches
    console.log('  🔧 Step 3: Populating individual coin detail caches...');

    for (const market of marketData) {
      // Find the corresponding token from the token list (has platform data)
      const token = tokens.find((t) => t.id === market.id);
      if (!token) {
        console.warn(`  ⚠️  Token ${market.id} not found in token list`);
        continue;
      }

      // Construct a CoinGeckoDetailedCoin object by combining both sources
      const detailedCoin = {
        id: market.id,
        symbol: market.symbol,
        name: market.name,
        image: {
          thumb: market.image,
          small: market.image,
          large: market.image,
        },
        market_data: {
          market_cap: {
            usd: market.market_cap,
          },
        },
        platforms: token.platforms, // Platform data from token list
      };

      // Manually cache this coin detail (using the same cache key pattern as getCoinDetails)
      const cacheKey = `coingecko:coin:${market.id}`;
      const cacheService = (client as any).cacheService; // Access private field for cache warming
      const cacheTimeout = (client as any).cacheTimeout;
      await cacheService.set(cacheKey, detailedCoin, cacheTimeout);
    }

    console.log(`  ✅ Populated ${marketData.length} individual coin detail caches`);
    console.log('🎉 Cache warming complete! Total: 2 API calls (getAllTokens + getCoinsMarketData)\n');
  } catch (error) {
    console.warn('⚠️  Cache warming failed (tests will make real API calls):', error);
    // Don't throw - let tests proceed with real API calls if warming fails
  }
}

export default async function globalSetup() {
  console.log('\n🔧 Setting up integration test environment...\n');

  // DATABASE_URL should be loaded from .env.test via --env-file flag
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. Make sure .env.test exists with DATABASE_URL defined.\n' +
      'Run: cp .env.example .env.test'
    );
  }

  console.log(`📊 Using database: ${databaseUrl.split('@')[1]?.split('?')[0] || 'unknown'}`);

  // Set DATABASE_URL for Prisma CLI commands
  process.env.DATABASE_URL = databaseUrl;

  try {
    // Test database connection
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });

    await prisma.$connect();
    console.log('✅ Database connection successful');
    await prisma.$disconnect();

    // Push schema to test database (creates/updates tables without migrations)
    console.log('📦 Pushing database schema...');
    execSync('npx prisma db push --skip-generate --accept-data-loss', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    console.log('✅ Database schema ready\n');

    // Warm up CoinGecko cache (reduces API calls across all integration tests)
    await warmUpCoinGeckoCache();

  } catch (error) {
    console.error('❌ Failed to setup test database:', error);
    throw error;
  }
}
