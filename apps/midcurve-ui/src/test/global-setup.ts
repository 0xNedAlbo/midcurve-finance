/**
 * Global setup for E2E tests
 * Runs once before all test files
 *
 * Responsibilities:
 * - Ensure test database is available
 * - Run Prisma schema push (sync schema)
 * - Seed test database with user and API key
 */

import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { CoinGeckoClient } from '@midcurve/services';

/**
 * Warm up the CoinGecko cache with token list and market data
 * This significantly reduces API calls during E2E test execution
 *
 * Strategy:
 * 1. Check if cache is already warm (all coin details exist)
 * 2. If warm, skip API calls (0 requests)
 * 3. If not warm:
 *    a. Fetch token list (includes platform data) - 1 API call
 *    b. Fetch market data in batch (logo URLs, market caps) - 1 API call
 *    c. Manually populate individual coin detail caches with 24h TTL
 *
 * Cache retention: 24 hours (vs default 1 hour)
 * Total API calls: 0 (if warm) or 2 (if cold)
 */
async function warmUpCoinGeckoCache(): Promise<void> {
  console.log('🔥 Warming up CoinGecko cache...');

  try {
    const client = CoinGeckoClient.getInstance();

    // Known stable tokens used across E2E tests
    // Only these 3 tokens are needed for API testing
    const TEST_COIN_IDS = ['usd-coin', 'weth', 'wrapped-bitcoin'];
    const TTL_24_HOURS = 86400; // 24 hours in seconds

    // Check if cache is already warm by checking individual coin detail caches
    console.log('  🔍 Checking if cache is already warm...');
    // @ts-expect-error - Accessing private field for cache warming
    const cacheService = client.cacheService; // Access private field
    const cachedCoins = await Promise.all(
      TEST_COIN_IDS.map((coinId) => cacheService.get(`coingecko:coin:${coinId}`))
    );

    // If all coins are cached, we're done
    if (cachedCoins.every((coin) => coin !== null)) {
      console.log('  ✅ Cache already warm (all coins cached), skipping API calls');
      console.log('🎉 Cache warming complete! Total: 0 API calls (cache hit)\n');
      return;
    }

    console.log('  ❄️  Cache is cold, fetching fresh data...');

    // Step 1: Fetch complete token list with platform data (1 API call)
    console.log('  📋 Step 1: Fetching token list with platform data...');
    const tokens = await client.getAllTokens();
    console.log(`  ✅ Cached ${tokens.length} tokens with platform addresses`);

    // Override with 24h TTL for test stability
    await cacheService.set('coingecko:tokens:all', tokens, TTL_24_HOURS);
    console.log(`  🔧 Extended token list cache to 24h TTL`);

    // Step 2: Fetch market data for test tokens in batch (1 API call)
    console.log(`  💰 Step 2: Fetching market data for ${TEST_COIN_IDS.length} coins: ${TEST_COIN_IDS.join(', ')}...`);
    const marketData = await client.getCoinsMarketData(TEST_COIN_IDS);
    console.log(`  ✅ Cached market data for ${marketData.length} coins`);

    // Override with 24h TTL for test stability
    const sortedIds = [...TEST_COIN_IDS].sort();
    const marketCacheKey = `coingecko:markets:${sortedIds.join(',')}`;
    await cacheService.set(marketCacheKey, marketData, TTL_24_HOURS);
    console.log(`  🔧 Extended market data cache to 24h TTL`);

    // Step 3: Manually populate individual coin detail caches with 24h TTL
    console.log('  🔧 Step 3: Populating individual coin detail caches (24h TTL)...');

    for (const market of marketData) {
      // Find the corresponding token from the token list (has platform data)
      const token = tokens.find((t) => t.id === market.id);
      if (!token) {
        console.warn(`  ⚠️  Token ${market.id} not found in token list`);
        continue;
      }

      // Construct a CoinGeckoDetailedCoin object by combining both sources
      // This matches the structure returned by getCoinDetails()
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

      // Manually cache this coin detail with 24h TTL
      // (using the same cache key pattern as getCoinDetails)
      const cacheKey = `coingecko:coin:${market.id}`;
      await cacheService.set(cacheKey, detailedCoin, TTL_24_HOURS);
    }

    console.log(`  ✅ Populated ${marketData.length} individual coin detail caches (24h retention)`);
    console.log('🎉 Cache warming complete! Total: 2 API calls (getAllTokens + getCoinsMarketData)');
    console.log(`  📦 All 5 cache entries extended to 24h TTL (token list + market data + ${marketData.length} coin details)\n`);
  } catch (error) {
    console.warn('⚠️  Cache warming failed (tests will make real API calls):', error);
    // Don't throw - let tests proceed with real API calls if warming fails
  }
}

export default async function globalSetup() {
  console.log('\n🔧 Setting up E2E test environment...\n');

  // DATABASE_URL should be loaded from .env (Prisma convention)
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. Make sure .env exists with DATABASE_URL defined.\n' +
      'Point DATABASE_URL to the test database for running tests.'
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
    console.log('✅ Database schema ready');

    // Seed test database
    console.log('🌱 Seeding test database...');
    execSync('npx tsx prisma/seed.ts', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    console.log('✅ Test database seeded\n');

    // Warm up CoinGecko cache (reduces API calls across all E2E tests)
    await warmUpCoinGeckoCache();

    console.log('✅ E2E test environment ready!\n');

  } catch (error) {
    console.error('❌ Failed to setup test database:', error);
    throw error;
  }
}
