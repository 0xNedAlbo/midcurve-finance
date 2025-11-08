/**
 * Prisma Seed Script
 *
 * Seeds the database with test data for development and testing.
 * Run with: npm run prisma:seed
 */

import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

/**
 * Hash an API key using SHA-256
 */
function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Extract the prefix from an API key (first 8 characters)
 */
function extractKeyPrefix(key: string): string {
  return key.substring(0, 8);
}

async function main() {
  console.log('🌱 Starting database seed...\n');

  // ============================================================================
  // Test User
  // ============================================================================

  console.log('👤 Creating test user...');

  const testUser = await prisma.user.upsert({
    where: { id: 'test-user-seed' },
    update: {},
    create: {
      id: 'test-user-seed',
      name: 'Test Testmann',
      email: 'test@midcurve.finance',
      image: null,
    },
  });

  console.log(`   ✅ User created: ${testUser.name} (${testUser.id})`);

  // ============================================================================
  // Test Wallet
  // ============================================================================

  console.log('\n💼 Creating test wallet...');

  const testWallet = await prisma.authWalletAddress.upsert({
    where: { id: 'test-wallet-seed' },
    update: {},
    create: {
      id: 'test-wallet-seed',
      address: '0x1234567890123456789012345678901234567890',
      chainId: 1, // Ethereum
      isPrimary: true,
      userId: testUser.id,
    },
  });

  console.log(`   ✅ Wallet created: ${testWallet.address}`);

  // ============================================================================
  // Test API Key
  // ============================================================================

  console.log('\n🔑 Creating test API key...');

  const testApiKeyRaw = 'mc_test_1234567890abcdefghijklmnopqrstuvwxyz';
  const testApiKeyHash = hashApiKey(testApiKeyRaw);
  const testApiKeyPrefix = extractKeyPrefix(testApiKeyRaw);

  const testApiKey = await prisma.apiKey.upsert({
    where: { id: 'test-apikey-seed' },
    update: {},
    create: {
      id: 'test-apikey-seed',
      name: 'Test API Key',
      keyHash: testApiKeyHash,
      keyPrefix: testApiKeyPrefix,
      userId: testUser.id,
      lastUsed: null,
    },
  });

  console.log(`   ✅ API Key created: ${testApiKey.name}`);
  console.log(`   🔐 API Key (save this!): ${testApiKeyRaw}`);

  // ============================================================================
  // Summary
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('✨ Seed completed successfully!\n');
  console.log('Test User Details:');
  console.log(`  • ID: ${testUser.id}`);
  console.log(`  • Name: ${testUser.name}`);
  console.log(`  • Email: ${testUser.email}`);
  console.log(`  • Wallet: ${testWallet.address}`);
  console.log(`  • API Key: ${testApiKeyRaw}`);
  console.log('\nYou can now test the API with:');
  console.log(`  curl -H "Authorization: Bearer ${testApiKeyRaw}" http://localhost:3000/api/v1/...`);
  console.log('='.repeat(60) + '\n');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
