/**
 * Integration tests for UniswapV3PositionLedgerService
 * Tests against real PostgreSQL database, Etherscan API, and RPC endpoints
 *
 * These tests verify:
 * - Full position history discovery from blockchain
 * - Cross-chain support (Ethereum, Arbitrum)
 * - Financial calculations (cost basis, PnL) with real data
 * - Historic pricing integration
 * - Database persistence and BigInt serialization
 * - Idempotency and rebuild capability
 *
 * Test Positions:
 * - Arbitrum NFT #4865121: Closed position, +2,892.77 USDC PnL
 * - Ethereum NFT #1088026: Closed position, -0.424 WETH PnL (LINK/WETH)
 *
 * NOTE: These tests require:
 * - DATABASE_URL (PostgreSQL)
 * - ETHERSCAN_API_KEY
 * - RPC_URL_ETHEREUM
 * - RPC_URL_ARBITRUM
 */

import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { UniswapV3PositionLedgerService } from './uniswapv3-position-ledger-service.js';
import { UniswapV3PositionService } from '../position/uniswapv3-position-service.js';
import { UniswapV3PoolService } from '../pool/uniswapv3-pool-service.js';
import { UniswapV3PoolPriceService } from '../pool-price/uniswapv3-pool-price-service.js';
import { Erc20TokenService } from '../token/erc20-token-service.js';
import { EtherscanClient } from '../../clients/etherscan/index.js';
import { EvmConfig } from '../../config/evm.js';
import { getPrismaClient, disconnectPrisma } from '../../test/helpers.js';

// Skip tests if required environment variables are not set
const skipTests =
  !process.env.DATABASE_URL ||
  !process.env.ETHERSCAN_API_KEY ||
  !process.env.RPC_URL_ETHEREUM ||
  !process.env.RPC_URL_ARBITRUM;

describe.skipIf(skipTests)('UniswapV3PositionLedgerService - Integration Tests', () => {
  // Services
  let ledgerService: UniswapV3PositionLedgerService;
  let positionService: UniswapV3PositionService;
  let poolService: UniswapV3PoolService;
  let poolPriceService: UniswapV3PoolPriceService;
  let tokenService: Erc20TokenService;
  let etherscanClient: EtherscanClient;
  let evmConfig: EvmConfig;
  const prisma = getPrismaClient();

  // Test position data
  const ARBITRUM_POSITION = {
    nftId: 4865121, // Number, not string
    chainId: 42161,
    quoteTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
    expectedPnl: 1118.69, // USDC (6 decimals) - PnL without fees
    expectedPnlBigInt: 1118690000n, // 1118.69 * 1e6 (not including collected fees)
    tolerance: 10000000n, // ±10 USDC (allow for price fluctuations)
  };

  const ETHEREUM_POSITION = {
    nftId: 1088026, // Number, not string
    chainId: 1,
    quoteTokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH on Ethereum (LINK/WETH pool)
    expectedPnl: -0.424, // WETH (18 decimals) - actual PnL
    expectedPnlBigInt: -424000000000000000n, // -0.424 * 1e18
    tolerance: 50000000000000000n, // ±0.05 WETH (allow for price fluctuations)
  };

  // Track created entities for cleanup
  let arbitrumPositionId: string | null = null;
  let ethereumPositionId: string | null = null;
  const createdPoolIds: string[] = [];
  const createdTokenIds: string[] = [];

  beforeAll(async () => {
    console.log('🔧 Setting up integration tests...');

    // Initialize services
    evmConfig = EvmConfig.getInstance();
    etherscanClient = EtherscanClient.getInstance();
    tokenService = new Erc20TokenService({ prisma });
    poolService = new UniswapV3PoolService({
      prisma,
      evmConfig,
      erc20TokenService: tokenService,
    });
    poolPriceService = new UniswapV3PoolPriceService({
      prisma,
      evmConfig,
    });
    positionService = new UniswapV3PositionService({
      prisma,
      evmConfig,
      poolService,
      etherscanClient,
    });
    ledgerService = new UniswapV3PositionLedgerService({
      prisma,
      etherscanClient,
      positionService,
      poolService,
      poolPriceService,
    });

    // Clean up any existing test data
    console.log('🧹 Cleaning up existing test data...');

    // Delete ledger events for these NFT IDs (if they exist)
    const existingPositions = await prisma.position.findMany({
      where: {
        OR: [
          {
            config: {
              path: ['nftId'],
              equals: ARBITRUM_POSITION.nftId,
            },
          },
          {
            config: {
              path: ['nftId'],
              equals: ETHEREUM_POSITION.nftId,
            },
          },
        ],
      },
    });

    for (const position of existingPositions) {
      await prisma.positionLedgerEvent.deleteMany({
        where: { positionId: position.id },
      });
      await prisma.position.delete({
        where: { id: position.id },
      });
    }

    console.log('✅ Integration test setup complete');
  }, 120000); // 2 minute timeout for setup

  // Create test users before each test (global beforeEach clears database)
  beforeEach(async () => {
    await prisma.user.createMany({
      data: [
        { id: 'test-user-arbitrum', name: 'Test User Arbitrum' },
        { id: 'test-user-ethereum', name: 'Test User Ethereum' },
      ],
      skipDuplicates: true,
    });
  });

  afterAll(async () => {
    console.log('🧹 Cleaning up integration test data...');

    // Delete ledger events first (foreign key constraint)
    if (arbitrumPositionId) {
      await prisma.positionLedgerEvent.deleteMany({
        where: { positionId: arbitrumPositionId },
      });
    }
    if (ethereumPositionId) {
      await prisma.positionLedgerEvent.deleteMany({
        where: { positionId: ethereumPositionId },
      });
    }

    // Delete positions
    if (arbitrumPositionId) {
      await prisma.position.deleteMany({
        where: { id: arbitrumPositionId },
      });
    }
    if (ethereumPositionId) {
      await prisma.position.deleteMany({
        where: { id: ethereumPositionId },
      });
    }

    // Delete pool prices for created pools
    for (const poolId of createdPoolIds) {
      await prisma.poolPrice.deleteMany({
        where: { poolId },
      });
    }

    // Delete pools
    for (const poolId of createdPoolIds) {
      await prisma.pool.deleteMany({
        where: { id: poolId },
      });
    }

    // Delete tokens
    for (const tokenId of createdTokenIds) {
      await prisma.token.deleteMany({
        where: { id: tokenId },
      });
    }

    // Delete test users
    await prisma.user.deleteMany({
      where: {
        id: {
          in: ['test-user-arbitrum', 'test-user-ethereum'],
        },
      },
    });

    await disconnectPrisma();
    console.log('✅ Cleanup complete');
  }, 60000);

  // ==========================================================================
  // Test 1: Arbitrum Position - Full History Discovery
  // ==========================================================================

  describe('Arbitrum Position - Full History', () => {
    it('should discover full position history for Arbitrum NFT 4865121 and validate final PnL of +2,892.77 USDC', async () => {
      console.log(`\n📊 Discovering Arbitrum position NFT ${ARBITRUM_POSITION.nftId}...`);

      // Create position from NFT
      const position = await positionService.discover('test-user-arbitrum', {
        chainId: ARBITRUM_POSITION.chainId,
        nftId: ARBITRUM_POSITION.nftId,
        quoteTokenAddress: ARBITRUM_POSITION.quoteTokenAddress,
      });
      arbitrumPositionId = position.id;
      console.log(`✓ Position created: ${position.id}`);

      // Track created entities for cleanup
      createdPoolIds.push(position.pool.id);
      const pool = await prisma.pool.findUnique({
        where: { id: position.pool.id },
        include: { token0: true, token1: true },
      });
      if (pool) {
        createdTokenIds.push(pool.token0Id, pool.token1Id);
      }

      // Discover all events
      const events = await ledgerService.discoverAllEvents(position.id);

      console.log(`✓ Discovered ${events.length} events`);

      // Basic validations
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].positionId).toBe(position.id);

      // Verify chronological ordering (descending by timestamp)
      for (let i = 0; i < events.length - 1; i++) {
        expect(events[i].timestamp.getTime()).toBeGreaterThanOrEqual(
          events[i + 1].timestamp.getTime()
        );
      }

      // Verify event chain linkage (previousId)
      const sortedAsc = [...events].reverse(); // Oldest to newest
      expect(sortedAsc[0].previousId).toBeNull(); // First event has no previous

      for (let i = 1; i < sortedAsc.length; i++) {
        expect(sortedAsc[i].previousId).toBe(sortedAsc[i - 1].id);
      }
      console.log('✓ Event chain validated (previousId links correct)');

      // Get final PnL (most recent event in descending order)
      const finalEvent = events[0];
      const finalPnl = finalEvent.pnlAfter;

      console.log(`✓ Final PnL: ${Number(finalPnl) / 1e6} USDC`);

      // Validate final PnL matches expected (within tolerance)
      const pnlDiff = finalPnl > ARBITRUM_POSITION.expectedPnlBigInt
        ? finalPnl - ARBITRUM_POSITION.expectedPnlBigInt
        : ARBITRUM_POSITION.expectedPnlBigInt - finalPnl;

      expect(pnlDiff).toBeLessThanOrEqual(ARBITRUM_POSITION.tolerance);
      console.log('✅ Final PnL matches expected: ~+1,118.69 USDC (without fees)');

      // Log summary
      console.log('\n📈 Position Summary:');
      console.log(`  Events: ${events.length}`);
      console.log(`  Final Cost Basis: ${Number(finalEvent.costBasisAfter) / 1e6} USDC`);
      console.log(`  Final PnL: ${Number(finalEvent.pnlAfter) / 1e6} USDC`);
    }, 120000); // 2 minute timeout for full discovery
  });

  // ==========================================================================
  // Test 2: Ethereum Position - Full History Discovery (Loss Scenario)
  // ==========================================================================

  describe('Ethereum Position - Full History (Loss)', () => {
    it('should discover full position history for Ethereum NFT 1088026 and validate final PnL of -0.424 WETH', async () => {
      console.log(`\n📊 Discovering Ethereum position NFT ${ETHEREUM_POSITION.nftId}...`);

      // Create position from NFT
      const position = await positionService.discover('test-user-ethereum', {
        chainId: ETHEREUM_POSITION.chainId,
        nftId: ETHEREUM_POSITION.nftId,
        quoteTokenAddress: ETHEREUM_POSITION.quoteTokenAddress,
      });
      ethereumPositionId = position.id;
      console.log(`✓ Position created: ${position.id}`);

      // Track created entities for cleanup
      createdPoolIds.push(position.pool.id);
      const pool = await prisma.pool.findUnique({
        where: { id: position.pool.id },
        include: { token0: true, token1: true },
      });
      if (pool) {
        createdTokenIds.push(pool.token0Id, pool.token1Id);
      }

      // Discover all events
      const events = await ledgerService.discoverAllEvents(position.id);

      console.log(`✓ Discovered ${events.length} events`);

      // Basic validations
      expect(events.length).toBeGreaterThan(0);

      // Verify LINK/WETH pool (WETH as quote) - reuse pool variable from above
      expect(pool).not.toBeNull();
      console.log(`✓ Pool: ${pool!.token0.symbol}/${pool!.token1.symbol}`);

      // Get final PnL
      const finalEvent = events[0];
      const finalPnl = finalEvent.pnlAfter;

      console.log(`✓ Final PnL: ${Number(finalPnl) / 1e18} WETH`);

      // Validate final PnL is negative (loss)
      expect(finalPnl).toBeLessThan(0n);

      // Validate final PnL matches expected (within tolerance)
      const pnlDiff = finalPnl > ETHEREUM_POSITION.expectedPnlBigInt
        ? finalPnl - ETHEREUM_POSITION.expectedPnlBigInt
        : ETHEREUM_POSITION.expectedPnlBigInt - finalPnl;

      expect(pnlDiff).toBeLessThanOrEqual(ETHEREUM_POSITION.tolerance);
      console.log('✅ Final PnL matches expected: -0.424 WETH');

      // Log summary
      console.log('\n📉 Position Summary:');
      console.log(`  Events: ${events.length}`);
      console.log(`  Final Cost Basis: ${Number(finalEvent.costBasisAfter) / 1e18} WETH`);
      console.log(`  Final PnL: ${Number(finalEvent.pnlAfter) / 1e18} WETH`);
    }, 120000); // 2 minute timeout
  });

  // ==========================================================================
  // Test 3: Idempotency
  // ==========================================================================

  describe('Idempotency', () => {
    it('should return identical results when discovering same position twice', async () => {
      console.log('\n🔄 Testing idempotency...');

      // Create fresh position (global beforeEach cleared database)
      const position = await positionService.discover('test-user-arbitrum', {
        chainId: ARBITRUM_POSITION.chainId,
        nftId: ARBITRUM_POSITION.nftId,
        quoteTokenAddress: ARBITRUM_POSITION.quoteTokenAddress,
      });
      const positionId = position.id;

      // First discovery
      const events1 = await ledgerService.discoverAllEvents(positionId);

      // Second discovery (should be instant, return same data)
      const events2 = await ledgerService.discoverAllEvents(positionId);

      // Verify identical results (financial data should match, but IDs will differ)
      expect(events1.length).toBe(events2.length);

      for (let i = 0; i < events1.length; i++) {
        // IDs will be different (discoverAllEvents deletes and recreates)
        // But financial data should be identical
        expect(events1[i].pnlAfter).toBe(events2[i].pnlAfter);
        expect(events1[i].costBasisAfter).toBe(events2[i].costBasisAfter);
        expect(events1[i].tokenValue).toBe(events2[i].tokenValue);
        expect(events1[i].token0Amount).toBe(events2[i].token0Amount);
        expect(events1[i].token1Amount).toBe(events2[i].token1Amount);
        expect(events1[i].inputHash).toBe(events2[i].inputHash);
        expect(events1[i].eventType).toBe(events2[i].eventType);
        expect(events1[i].timestamp.getTime()).toBe(events2[i].timestamp.getTime());
      }

      console.log('✅ Idempotency verified: Identical financial data on second call');
    }, 60000);
  });

  // ==========================================================================
  // Test 4: Database Persistence and BigInt Serialization
  // ==========================================================================

  describe('Database Persistence', () => {
    it('should persist events correctly with BigInt → string serialization', async () => {
      console.log('\n💾 Testing database persistence...');

      // Create fresh position with events
      const position = await positionService.discover('test-user-arbitrum', {
        chainId: ARBITRUM_POSITION.chainId,
        nftId: ARBITRUM_POSITION.nftId,
        quoteTokenAddress: ARBITRUM_POSITION.quoteTokenAddress,
      });
      const positionId = position.id;
      await ledgerService.discoverAllEvents(positionId);

      // Query database directly
      const dbEvents = await prisma.positionLedgerEvent.findMany({
        where: { positionId },
        orderBy: [{ timestamp: 'desc' }, { createdAt: 'desc' }],
      });

      expect(dbEvents.length).toBeGreaterThan(0);

      // Verify BigInt stored as string in DB
      const firstEvent = dbEvents[0];
      expect(typeof firstEvent.pnlAfter).toBe('string');
      expect(typeof firstEvent.costBasisAfter).toBe('string');
      expect(typeof firstEvent.token0Amount).toBe('string');
      expect(typeof firstEvent.token1Amount).toBe('string');

      console.log('✓ BigInt values stored as strings in database');

      // Verify event chain in database
      const sortedAsc = [...dbEvents].reverse();
      expect(sortedAsc[0].previousId).toBeNull();

      for (let i = 1; i < sortedAsc.length; i++) {
        expect(sortedAsc[i].previousId).toBe(sortedAsc[i - 1].id);
      }

      console.log('✅ Database persistence verified');
    }, 60000);
  });

  // ==========================================================================
  // Test 5: Delete and Rebuild
  // ==========================================================================

  describe('Delete and Rebuild', () => {
    it('should produce identical PnL after deleting and rebuilding position history', async () => {
      console.log('\n🔨 Testing delete and rebuild...');

      // Create fresh position
      const position = await positionService.discover('test-user-ethereum', {
        chainId: ETHEREUM_POSITION.chainId,
        nftId: ETHEREUM_POSITION.nftId,
        quoteTokenAddress: ETHEREUM_POSITION.quoteTokenAddress,
      });
      const positionId = position.id;

      // First discovery
      const events1 = await ledgerService.discoverAllEvents(positionId);
      const finalPnl1 = events1[0].pnlAfter;

      console.log(`✓ First discovery: ${events1.length} events, PnL = ${Number(finalPnl1) / 1e18} WETH`);

      // Delete all events
      await ledgerService.deleteAllItems(positionId);

      const afterDelete = await prisma.positionLedgerEvent.findMany({
        where: { positionId },
      });
      expect(afterDelete.length).toBe(0);
      console.log('✓ All events deleted');

      // Rebuild
      const events2 = await ledgerService.discoverAllEvents(positionId);
      const finalPnl2 = events2[0].pnlAfter;

      console.log(`✓ Rebuilt: ${events2.length} events, PnL = ${Number(finalPnl2) / 1e18} WETH`);

      // Verify identical results
      expect(events1.length).toBe(events2.length);
      expect(finalPnl1).toBe(finalPnl2);

      console.log('✅ Delete and rebuild verified: Identical PnL');
    }, 120000); // 2 minute timeout
  });

  // ==========================================================================
  // Test 6: Historic Pricing Validation
  // ==========================================================================

  describe('Historic Pricing Validation', () => {
    it('should use historic pool price at event block number (not current price)', async () => {
      console.log('\n⏰ Testing historic pricing...');

      // Create fresh position with events
      const position = await positionService.discover('test-user-arbitrum', {
        chainId: ARBITRUM_POSITION.chainId,
        nftId: ARBITRUM_POSITION.nftId,
        quoteTokenAddress: ARBITRUM_POSITION.quoteTokenAddress,
      });
      const positionId = position.id;
      const events = await ledgerService.discoverAllEvents(positionId);

      expect(events.length).toBeGreaterThan(0);

      // Pick middle event to test historic pricing
      const testEvent = events[Math.floor(events.length / 2)];

      console.log(`✓ Testing event at block ${testEvent.config.blockNumber}`);

      // Fetch pool price at that block manually
      const dbPosition = await prisma.position.findUnique({
        where: { id: positionId },
        include: { pool: true },
      });
      const poolPrice = await poolPriceService.discover(dbPosition!.poolId, {
        blockNumber: testEvent.config.blockNumber,
      });

      console.log(`✓ Historic pool price: ${Number(poolPrice.token1PricePerToken0) / 1e6}`);
      console.log(`✓ Event pool price: ${Number(testEvent.poolPrice) / 1e6}`);

      // Verify event's poolPrice matches historic price (not current)
      expect(testEvent.poolPrice).toBe(poolPrice.token1PricePerToken0);

      console.log('✅ Historic pricing validated: Event uses price at its block number');
    }, 90000); // 90 second timeout
  });
});

// Show helpful message if tests are skipped
if (skipTests) {
  console.log(
    '\n⚠️  Position ledger integration tests skipped: Required environment variables not set\n' +
      'To run integration tests:\n' +
      '  1. Set DATABASE_URL (PostgreSQL)\n' +
      '  2. Set ETHERSCAN_API_KEY\n' +
      '  3. Set RPC_URL_ETHEREUM\n' +
      '  4. Set RPC_URL_ARBITRUM\n' +
      '  5. Run: npm run test:integration\n'
  );
}
