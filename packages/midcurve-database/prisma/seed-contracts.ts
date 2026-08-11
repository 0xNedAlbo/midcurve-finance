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
  UniswapV3Vault: 'uniswap-v3-vault',
  AllowlistedUniswapV3Vault: 'allowlisted-uniswap-v3-vault',
  UniswapV3VaultFactory: 'uniswap-v3-vault-factory',
  UniswapV3VaultPositionCloser: 'uniswap-v3-vault-position-closer',
  MidcurveTreasuryFactory: 'midcurve-treasury-factory',
};

/**
 * Names that must never reach shared_contracts from a deployment file, with the
 * reason attached to the throw rather than to a comment nobody reads.
 *
 * An unrecognised name is skipped with a log line. That is the wrong treatment
 * for these two: adding `MidcurveTreasury: 'midcurve-treasury'` to the map above
 * is a one-line change that looks obviously right and is catastrophic. The row
 * it writes is what `getFeeRecipient()` returns, so every execution fee on that
 * chain would be paid into the shared *implementation* — a contract whose
 * `admin` is address(0), from which nothing can ever be withdrawn.
 *
 * A treasury is one instance per environment, deployed at kickstart through
 * MidcurveTreasuryFactory and registered at runtime. It is not publisher
 * infrastructure and it does not belong in a deployment file.
 */
const NEVER_SEEDED: Record<string, string> = {
  MidcurveTreasury:
    'a treasury is per-environment and registered at runtime by the gas readiness gate',
  MidcurveTreasuryImplementation:
    'the implementation is the delegatecall target for every clone, not a treasury; ' +
    'registering it would send execution fees to a contract with no admin',
};

interface DeploymentFile {
  chainId: number;
  network: string;
  deployedAt: string;
  /** Seeded into shared_contracts, subject to the two maps above. */
  contracts: Record<string, string>;
  /**
   * Recorded for provenance, never seeded and never iterated.
   *
   * Where a deployed address is worth writing down but must not become a
   * shared_contracts row — the MidcurveTreasury implementation being the case
   * this exists for. Putting it in `contracts` instead trips NEVER_SEEDED.
   */
  references?: Record<string, string>;
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
      const forbidden = NEVER_SEEDED[contractName];
      if (forbidden) {
        throw new Error(
          `Refusing to seed ${contractName} from ${file}: ${forbidden}. ` +
            'Remove it from the deployment file, or record it under a name that is not seeded.',
        );
      }

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
