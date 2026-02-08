/**
 * Upsert SharedContract Database Record
 *
 * Registers or updates a deployed contract address in the database.
 * Uses SharedContractService.upsert() which is idempotent — safe to run
 * multiple times with the same inputs.
 *
 * Usage:
 *   CONTRACT_ADDRESS=0x543e... CHAIN_ID=42161 pnpm db:upsert-contract
 *
 * Environment variables:
 *   CONTRACT_ADDRESS  - The deployed contract address (required)
 *   CHAIN_ID          - Target chain ID, e.g. 42161 (required)
 *   VERSION_MAJOR     - Interface version major (default: 1)
 *   VERSION_MINOR     - Interface version minor (default: 0)
 *   DATABASE_URL      - PostgreSQL connection string (from .env)
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import {
  SharedContractTypeEnum,
  SharedContractNameEnum,
} from '@midcurve/shared';
import { SharedContractService } from '@midcurve/services';

// Load .env file (same pattern as local-fork/setup.ts)
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

async function main(): Promise<void> {
  loadEnv();

  const contractAddress = process.env.CONTRACT_ADDRESS;
  const chainIdStr = process.env.CHAIN_ID;
  const versionMajor = parseInt(process.env.VERSION_MAJOR || '1', 10);
  const versionMinor = parseInt(process.env.VERSION_MINOR || '0', 10);

  if (!contractAddress) {
    console.error('Error: CONTRACT_ADDRESS environment variable is required');
    console.error('Usage: CONTRACT_ADDRESS=0x... CHAIN_ID=42161 pnpm db:upsert-contract');
    process.exit(1);
  }

  if (!chainIdStr) {
    console.error('Error: CHAIN_ID environment variable is required');
    console.error('Usage: CONTRACT_ADDRESS=0x... CHAIN_ID=42161 pnpm db:upsert-contract');
    process.exit(1);
  }

  const chainId = parseInt(chainIdStr, 10);
  if (isNaN(chainId)) {
    console.error(`Error: CHAIN_ID must be a number, got "${chainIdStr}"`);
    process.exit(1);
  }

  console.log('=== Upsert SharedContract ===');
  console.log('  Contract:', contractAddress);
  console.log('  Chain ID:', chainId);
  console.log(`  Version:  v${versionMajor}.${versionMinor}`);
  console.log('');

  const sharedContractService = new SharedContractService();

  const result = await sharedContractService.upsert({
    sharedContractType: SharedContractTypeEnum.EVM_SMART_CONTRACT,
    sharedContractName: SharedContractNameEnum.UNISWAP_V3_POSITION_CLOSER,
    interfaceVersionMajor: versionMajor,
    interfaceVersionMinor: versionMinor,
    chainId,
    address: contractAddress,
    isActive: true,
  });

  console.log('SharedContract upserted:');
  console.log('  ID:      ', result.id);
  console.log('  Hash:    ', result.sharedContractHash);
  console.log('  Address: ', result.config.address);
  console.log(`  Version:  v${result.interfaceVersionMajor}.${result.interfaceVersionMinor}`);
  console.log('  Active:  ', result.isActive);

  process.exit(0);
}

main().catch((error) => {
  console.error('Failed to upsert SharedContract:', error);
  process.exit(1);
});
