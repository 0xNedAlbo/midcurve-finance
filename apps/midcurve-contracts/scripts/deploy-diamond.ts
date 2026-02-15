/**
 * Deploy PositionCloser Diamond
 *
 * Wraps the DeployPositionCloserDiamond.s.sol Forge script and outputs
 * export commands for use with the db:upsert-contract script.
 *
 * Usage:
 *   AUGUSTUS_REGISTRY=0x... OWNER=0x... CHAIN=arbitrum pnpm deploy:diamond
 *
 * Add --broadcast to actually deploy (default is dry-run):
 *   AUGUSTUS_REGISTRY=0x... OWNER=0x... CHAIN=arbitrum pnpm deploy:diamond -- --broadcast --verify
 *
 * Environment variables:
 *   AUGUSTUS_REGISTRY  - Paraswap AugustusRegistry address (required)
 *   OWNER             - Diamond owner address (required)
 *   CHAIN             - RPC endpoint name from foundry.toml: arbitrum, base, mainnet, optimism, polygon (required)
 *
 * Known AugustusRegistry addresses:
 *   Ethereum:  0xa68bEA62Dc4034A689AA0F58A76681433caCa663
 *   Arbitrum:  0xdC6E2b14260F972ad4e5a31c68294Fba7E720701
 *   Optimism:  0x6e7bE86000dF697facF4396efD2aE2C322165dC3
 *   Polygon:   0xca35a4866747Ff7A604EF7a2A7F246bb870f3ca1
 *   Base:      0x7E31B336F9E8bA52ba3c4ac861b033Ba90900bb3
 */

import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const CHAIN_IDS: Record<string, number> = {
  mainnet: 1,
  optimism: 10,
  polygon: 137,
  arbitrum: 42161,
  base: 8453,
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

  const augustusRegistry = process.env.AUGUSTUS_REGISTRY;
  const owner = process.env.OWNER;
  const chain = process.env.CHAIN;

  if (!augustusRegistry || !owner || !chain) {
    console.error('Missing required environment variables.');
    console.error('');
    console.error('Usage:');
    console.error('  AUGUSTUS_REGISTRY=0x... OWNER=0x... CHAIN=arbitrum pnpm deploy:diamond');
    console.error('');
    console.error('Add extra forge flags after --:');
    console.error('  AUGUSTUS_REGISTRY=0x... OWNER=0x... CHAIN=arbitrum pnpm deploy:diamond -- --broadcast --verify');
    process.exit(1);
  }

  const chainId = CHAIN_IDS[chain];
  if (!chainId) {
    console.error(`Unknown chain "${chain}". Supported: ${Object.keys(CHAIN_IDS).join(', ')}`);
    process.exit(1);
  }

  // Extra flags passed after -- (e.g., --broadcast --verify)
  const extraArgs = process.argv.slice(2).filter((arg) => arg !== '--');

  console.log('=== Deploy PositionCloser Diamond ===');
  console.log('  Chain:            ', chain, `(${chainId})`);
  console.log('  Augustus Registry:', augustusRegistry);
  console.log('  Owner:            ', owner);
  console.log('  Extra flags:      ', extraArgs.length > 0 ? extraArgs.join(' ') : '(dry-run)');
  console.log('');

  const forgeArgs = [
    'script',
    'script/DeployPositionCloserDiamond.s.sol',
    '--sig',
    'run(address,address)',
    augustusRegistry,
    owner,
    '--rpc-url',
    chain,
    '-vvvv',
    ...extraArgs,
  ];

  const output = await runForge(forgeArgs);

  // Extract deployed diamond address from forge output
  const match = output.match(/PositionCloser Diamond:\s*(0x[0-9a-fA-F]{40})/);

  console.log('');
  console.log('='.repeat(60));

  if (match) {
    const diamondAddress = match[1];
    console.log('');
    console.log('To register in database, run:');
    console.log('');
    console.log(`  CONTRACT_ADDRESS=${diamondAddress} CHAIN_ID=${chainId} pnpm db:upsert-contract`);
    console.log('');
    console.log('Or export for later use:');
    console.log('');
    console.log(`  export CONTRACT_ADDRESS=${diamondAddress}`);
    console.log(`  export CHAIN_ID=${chainId}`);
  } else {
    console.log('');
    console.log('Could not extract diamond address from output.');
    console.log('Check the forge output above for the deployed address.');
  }
}

main().catch((error) => {
  console.error('Deployment failed:', error.message);
  process.exit(1);
});
