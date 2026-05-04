/**
 * Deploy UniswapV3StakingVault + Factory
 *
 * Wraps the DeployStakingVault.s.sol Forge script and prints the
 * pnpm db:upsert-contract invocation needed to register the factory in
 * the shared_contracts table.
 *
 * Usage:
 *   CHAIN=arbitrum pnpm deploy:staking-vault
 *
 * Add --broadcast to actually deploy (default is dry-run):
 *   CHAIN=arbitrum pnpm deploy:staking-vault -- --broadcast --verify
 *
 * Environment variables:
 *   CHAIN  - RPC endpoint name from foundry.toml: arbitrum, base, mainnet (required)
 */

import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const CHAIN_IDS: Record<string, number> = {
  mainnet: 1,
  arbitrum: 42161,
  base: 8453,
};

const POSITION_MANAGER: Record<string, `0x${string}`> = {
  mainnet: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  arbitrum: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  base: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
};

function loadEnv(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.substring(0, eqIndex).trim();
    let value = trimmed.substring(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function runForge(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';

    const proc = spawn('forge', args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdin?.end();

    proc.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });

    proc.stderr?.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stderr.write(text);
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to start forge: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`forge exited with code ${code}`));
      }
    });
  });
}

async function main(): Promise<void> {
  loadEnv();

  const chain = process.env.CHAIN;

  if (!chain) {
    console.error('Missing required environment variables.');
    console.error('');
    console.error('Usage:');
    console.error('  CHAIN=arbitrum pnpm deploy:staking-vault');
    console.error('');
    console.error('Add extra forge flags after --:');
    console.error('  CHAIN=arbitrum pnpm deploy:staking-vault -- --broadcast --verify');
    process.exit(1);
  }

  const chainId = CHAIN_IDS[chain];
  if (!chainId) {
    console.error(`Unknown chain "${chain}". Supported: ${Object.keys(CHAIN_IDS).join(', ')}`);
    process.exit(1);
  }

  const positionManager = POSITION_MANAGER[chain];
  if (!positionManager) {
    console.error(`No NonfungiblePositionManager address configured for chain "${chain}".`);
    process.exit(1);
  }

  // Extra flags passed after -- (e.g., --broadcast --verify)
  const extraArgs = process.argv.slice(2).filter((arg) => arg !== '--');

  console.log('=== Deploy UniswapV3StakingVaultFactory ===');
  console.log('  Chain:           ', chain, `(${chainId})`);
  console.log('  Position Manager:', positionManager);
  console.log('  Extra flags:     ', extraArgs.length > 0 ? extraArgs.join(' ') : '(dry-run)');
  console.log('');

  const forgeArgs = [
    'script',
    'script/DeployStakingVault.s.sol',
    '--sig',
    'run(address)',
    positionManager,
    '--rpc-url',
    chain,
    '-vvvv',
    ...extraArgs,
  ];

  const output = await runForge(forgeArgs);

  const implMatch = output.match(/UniswapV3StakingVault \(impl\):\s*(0x[0-9a-fA-F]{40})/);
  const factoryMatch = output.match(/UniswapV3StakingVaultFactory:\s*(0x[0-9a-fA-F]{40})/);

  console.log('');
  console.log('='.repeat(60));

  if (implMatch && factoryMatch) {
    const implAddress = implMatch[1];
    const factoryAddress = factoryMatch[1];

    console.log('');
    console.log('Deployed addresses:');
    console.log(`  UniswapV3StakingVault (impl): ${implAddress}`);
    console.log(`  UniswapV3StakingVaultFactory: ${factoryAddress}`);
    console.log('');
    console.log(`Add both addresses to apps/midcurve-contracts/deployments/${chain}.json`);
    console.log('under the "contracts" key. Bump "deployedAt" to the current UTC timestamp.');
    console.log('');
    console.log('To register the factory in the shared_contracts DB, run:');
    console.log('');
    console.log(
      `  CONTRACT_ADDRESS=${factoryAddress} CHAIN_ID=${chainId} CONTRACT_NAME=UniswapV3StakingVaultFactory pnpm db:upsert-contract`,
    );
    console.log('');
    console.log('Or export for later use:');
    console.log('');
    console.log(`  export CONTRACT_ADDRESS=${factoryAddress}`);
    console.log(`  export CHAIN_ID=${chainId}`);
  } else {
    console.log('');
    console.log('Could not extract deployed addresses from forge output.');
    console.log('Check the forge output above for the deployed addresses.');
  }
}

main().catch((error) => {
  console.error('Deployment failed:', error.message);
  process.exit(1);
});
