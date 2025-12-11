/**
 * Strategy Manifest Seed Script
 *
 * Seeds the database with example strategy manifests.
 * Run with: npx tsx prisma/seed/strategy-manifests.ts
 *
 * Prerequisites:
 * - Database must be running with migrations applied
 * - Basic currency token (USD) must exist in the database
 * - Contract artifacts must be compiled in midcurve-evm/contracts/out/
 */

import { PrismaClient, type Prisma } from '../../src/generated/prisma';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

// Path to compiled contracts
const CONTRACTS_OUT_PATH = path.resolve(
  __dirname,
  '../../../../apps/midcurve-evm/contracts/out'
);

/**
 * Read ABI and bytecode from Foundry compiled JSON
 */
function readContractArtifact(contractName: string): {
  abi: unknown[];
  bytecode: string;
} {
  const artifactPath = path.join(
    CONTRACTS_OUT_PATH,
    `${contractName}.sol`,
    `${contractName}.json`
  );

  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `Contract artifact not found: ${artifactPath}\n` +
        'Run `forge build` in midcurve-evm/contracts/ first.'
    );
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));

  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
  };
}

/**
 * Manifest definitions
 */
interface ManifestDefinition {
  slug: string;
  version: string;
  name: string;
  description: string;
  contractName: string;
  constructorParams: Prisma.InputJsonValue;
  capabilities: Prisma.InputJsonValue;
  userParams: Prisma.InputJsonValue;
  isActive: boolean;
  isAudited: boolean;
  author: string;
  repository?: string;
  tags: string[];
}

const MANIFESTS: ManifestDefinition[] = [
  {
    slug: 'funding-example-v1',
    version: '1.0.0',
    name: 'Funding Example Strategy',
    description: `Basic strategy demonstrating deposit and withdrawal capabilities.

**Features:**
- ERC-20 token deposits and withdrawals
- ETH balance tracking
- Event emission for all funding operations

**Use Case:**
Ideal for testing the strategy deployment flow and understanding how funding works.

**Risk Level:** Low (no active trading)`,
    contractName: 'FundingExampleStrategy',
    constructorParams: [
      {
        name: '_owner',
        type: 'address',
        source: 'user-wallet',
        description: 'Your wallet address (owner of the strategy)',
      },
    ],
    capabilities: {
      funding: true,
      ohlcConsumer: false,
      poolConsumer: false,
      balanceConsumer: false,
      uniswapV3Actions: false,
    },
    userParams: [],
    isActive: true,
    isAudited: false,
    author: 'Midcurve Finance',
    repository: 'https://github.com/midcurve/midcurve-finance',
    tags: ['funding', 'example', 'beginner'],
  },
  // Future manifests can be added here
  // {
  //   slug: 'ohlc-logger-v1',
  //   ...
  // },
];

async function findOrCreateUsdBasicCurrency(): Promise<string> {
  // First, try to find an existing USD basic currency
  const existingUsd = await prisma.token.findFirst({
    where: {
      tokenType: 'basic-currency',
      symbol: 'USD',
    },
  });

  if (existingUsd) {
    console.log(`Found existing USD basic currency: ${existingUsd.id}`);
    return existingUsd.id;
  }

  // Create a new USD basic currency token
  const usd = await prisma.token.create({
    data: {
      tokenType: 'basic-currency',
      name: 'US Dollar',
      symbol: 'USD',
      decimals: 18, // Basic currencies use 18 decimals for consistency
      config: {
        currency: 'USD',
        description: 'United States Dollar - base currency for strategy metrics',
      },
    },
  });

  console.log(`Created USD basic currency: ${usd.id}`);
  return usd.id;
}

async function seedManifests() {
  console.log('Starting strategy manifest seed...\n');

  // Get or create USD basic currency
  const usdBasicCurrencyId = await findOrCreateUsdBasicCurrency();

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const manifest of MANIFESTS) {
    try {
      // Check if manifest already exists
      const existing = await prisma.strategyManifest.findUnique({
        where: { slug: manifest.slug },
      });

      if (existing) {
        console.log(`⏭️  Skipping ${manifest.slug} (already exists)`);
        skipped++;
        continue;
      }

      // Read contract artifact
      console.log(`📄 Reading ${manifest.contractName} artifact...`);
      const { abi, bytecode } = readContractArtifact(manifest.contractName);

      // Create manifest
      const result = await prisma.strategyManifest.create({
        data: {
          slug: manifest.slug,
          version: manifest.version,
          name: manifest.name,
          description: manifest.description,
          abi: abi as Prisma.InputJsonValue,
          bytecode: bytecode,
          constructorParams: manifest.constructorParams,
          capabilities: manifest.capabilities,
          basicCurrencyId: usdBasicCurrencyId,
          userParams: manifest.userParams,
          isActive: manifest.isActive,
          isAudited: manifest.isAudited,
          author: manifest.author,
          repository: manifest.repository,
          tags: manifest.tags,
        },
      });

      console.log(`✅ Created ${manifest.slug} (ID: ${result.id})`);
      created++;
    } catch (error) {
      console.error(`❌ Failed to create ${manifest.slug}:`, error);
      errors++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Created: ${created}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
}

async function main() {
  try {
    await seedManifests();
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
