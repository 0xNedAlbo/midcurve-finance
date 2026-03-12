/**
 * Seed script for SharedContract records.
 *
 * Reads deployment JSON files from apps/midcurve-contracts/deployments/
 * and upserts each contract into the shared_contracts table.
 * Skips testnet chains (11155111, 31337).
 *
 * Idempotent — safe to run multiple times without duplicating rows.
 *
 * Usage: npx tsx prisma/seed-contracts.ts
 */

import { readdirSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import { PrismaClient } from '../src/generated/prisma/index.js';

const prisma = new PrismaClient();

const TESTNET_CHAIN_IDS = [11155111, 31337];

const CONTRACT_NAME_TO_KEBAB: Record<string, string> = {
  UniswapV3PositionCloser: 'uniswap-v3-position-closer',
  MidcurveSwapRouter: 'midcurve-swap-router',
};

interface DeploymentFile {
  chainId: number;
  network: string;
  deployedAt: string;
  contracts: Record<string, string>;
}

async function main() {
  console.log('Seeding SharedContracts...');

  const deploymentsDir = resolve(
    process.cwd(),
    'apps/midcurve-contracts/deployments',
  );

  const files = readdirSync(deploymentsDir).filter((f) => f.endsWith('.json'));
  let seeded = 0;

  for (const file of files) {
    const filePath = join(deploymentsDir, file);
    const deployment: DeploymentFile = JSON.parse(
      readFileSync(filePath, 'utf-8'),
    );

    if (TESTNET_CHAIN_IDS.includes(deployment.chainId)) {
      console.log(`  ⊘ Skipping ${file} (testnet chain ${deployment.chainId})`);
      continue;
    }

    for (const [contractName, address] of Object.entries(
      deployment.contracts,
    )) {
      const kebabName = CONTRACT_NAME_TO_KEBAB[contractName];
      if (!kebabName) {
        console.log(`  ⊘ Skipping unknown contract: ${contractName}`);
        continue;
      }

      const sharedContractHash = `evm/${kebabName}/1/0/${deployment.chainId}`;

      await prisma.sharedContract.upsert({
        where: { sharedContractHash },
        update: {
          config: { chainId: deployment.chainId, address },
          isActive: true,
        },
        create: {
          sharedContractType: 'evm-smart-contract',
          sharedContractName: contractName,
          interfaceVersionMajor: 1,
          interfaceVersionMinor: 0,
          sharedContractHash,
          config: { chainId: deployment.chainId, address },
          isActive: true,
        },
      });

      console.log(
        `  + ${contractName} on ${deployment.network} (${deployment.chainId}): ${address}`,
      );
      seeded++;
    }
  }

  console.log(`\nSeeded ${seeded} shared contracts.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
