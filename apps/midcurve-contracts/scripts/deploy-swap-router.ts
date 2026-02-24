/**
 * Deploy MidcurveSwapRouter + UniswapV3Adapter
 *
 * Wraps the DeploySwapRouter.s.sol Forge script and outputs
 * export commands for use with the db:upsert-contract script.
 *
 * Usage:
 *   CHAIN=arbitrum OWNER=0x... pnpm deploy:swap-router
 *
 * Add --broadcast to actually deploy (default is dry-run):
 *   CHAIN=arbitrum OWNER=0x... pnpm deploy:swap-router -- --broadcast --verify
 *
 * Environment variables:
 *   OWNER  - Initial manager address (required)
 *   CHAIN  - RPC endpoint name from foundry.toml: arbitrum, base, mainnet, optimism, polygon (required)
 */

import { spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ============================================================================
// Chain-specific addresses
// ============================================================================

const CHAIN_IDS: Record<string, number> = {
  mainnet: 1,
  optimism: 10,
  polygon: 137,
  arbitrum: 42161,
  base: 8453,
};

// Uniswap V3 SwapRouter02 addresses
const UNISWAP_V3_SWAP_ROUTER: Record<string, string> = {
  mainnet: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  arbitrum: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  optimism: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  polygon: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  base: '0x2626664c2603336E57B271c5C0b26F421741e481',
};

// WETH (or wrapped native token) addresses
const WETH: Record<string, string> = {
  mainnet: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  arbitrum: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  optimism: '0x4200000000000000000000000000000000000006',
  polygon: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
  base: '0x4200000000000000000000000000000000000006',
};

// USDC addresses (native, not bridged)
const USDC: Record<string, string> = {
  mainnet: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  optimism: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
};

// Paraswap Augustus V6.2 (same across all EVM chains)
const AUGUSTUS: Record<string, string> = {
  mainnet: '0x6A000F20005980200259B80c5102003040001068',
  arbitrum: '0x6A000F20005980200259B80c5102003040001068',
  optimism: '0x6A000F20005980200259B80c5102003040001068',
  polygon: '0x6A000F20005980200259B80c5102003040001068',
  base: '0x6A000F20005980200259B80c5102003040001068',
};

// Paraswap TokenTransferProxy (same across all EVM chains)
const TOKEN_TRANSFER_PROXY: Record<string, string> = {
  mainnet: '0x216B4B4Ba9F3e719726886d34a177484278Bfcae',
  arbitrum: '0x216B4B4Ba9F3e719726886d34a177484278Bfcae',
  optimism: '0x216B4B4Ba9F3e719726886d34a177484278Bfcae',
  polygon: '0x216B4B4Ba9F3e719726886d34a177484278Bfcae',
  base: '0x216B4B4Ba9F3e719726886d34a177484278Bfcae',
};

// ============================================================================
// Helpers
// ============================================================================

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

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  loadEnv();

  const owner = process.env.OWNER;
  const chain = process.env.CHAIN;

  if (!owner || !chain) {
    console.error('Missing required environment variables.');
    console.error('');
    console.error('Usage:');
    console.error('  CHAIN=arbitrum OWNER=0x... pnpm deploy:swap-router');
    console.error('');
    console.error('Add extra forge flags after --:');
    console.error('  CHAIN=arbitrum OWNER=0x... pnpm deploy:swap-router -- --broadcast --verify');
    process.exit(1);
  }

  const chainId = CHAIN_IDS[chain];
  if (!chainId) {
    console.error(`Unknown chain "${chain}". Supported: ${Object.keys(CHAIN_IDS).join(', ')}`);
    process.exit(1);
  }

  const swapRouterAddr = UNISWAP_V3_SWAP_ROUTER[chain];
  const wethAddr = WETH[chain];
  const usdcAddr = USDC[chain];
  const augustusAddr = AUGUSTUS[chain];
  const tokenTransferProxyAddr = TOKEN_TRANSFER_PROXY[chain];

  if (!swapRouterAddr || !wethAddr || !usdcAddr || !augustusAddr || !tokenTransferProxyAddr) {
    console.error(`Missing address configuration for chain "${chain}".`);
    process.exit(1);
  }

  // Extra flags passed after -- (e.g., --broadcast --verify)
  const extraArgs = process.argv.slice(2).filter((arg) => arg !== '--');

  console.log('=== Deploy MidcurveSwapRouter ===');
  console.log('  Chain:                  ', chain, `(${chainId})`);
  console.log('  Uniswap SwapRouter:     ', swapRouterAddr);
  console.log('  WETH:                   ', wethAddr);
  console.log('  USDC:                   ', usdcAddr);
  console.log('  Manager:                ', owner);
  console.log('  Paraswap Augustus:      ', augustusAddr);
  console.log('  Paraswap TransferProxy: ', tokenTransferProxyAddr);
  console.log('  Extra flags:            ', extraArgs.length > 0 ? extraArgs.join(' ') : '(dry-run)');
  console.log('');

  const forgeArgs = [
    'script',
    'script/DeploySwapRouter.s.sol',
    '--sig',
    'run(address,address,address,address,address,address)',
    swapRouterAddr,
    wethAddr,
    usdcAddr,
    owner,
    augustusAddr,
    tokenTransferProxyAddr,
    '--rpc-url',
    chain,
    '-vvvv',
    ...extraArgs,
  ];

  const output = await runForge(forgeArgs);

  // Extract deployed addresses from forge output
  const routerMatch = output.match(/MidcurveSwapRouter deployed at:\s*(0x[0-9a-fA-F]{40})/);
  const uniswapAdapterMatch = output.match(/UniswapV3Adapter deployed at:\s*(0x[0-9a-fA-F]{40})/);
  const paraswapAdapterMatch = output.match(/ParaswapAdapter deployed at:\s*(0x[0-9a-fA-F]{40})/);

  console.log('');
  console.log('='.repeat(60));

  if (routerMatch) {
    const routerAddress = routerMatch[1];
    console.log('');
    console.log('Deployed Addresses:');
    console.log(`  MidcurveSwapRouter: ${routerAddress}`);
    if (uniswapAdapterMatch) {
      console.log(`  UniswapV3Adapter:   ${uniswapAdapterMatch[1]}`);
    }
    if (paraswapAdapterMatch) {
      console.log(`  ParaswapAdapter:    ${paraswapAdapterMatch[1]}`);
    }
    console.log('');
    console.log('To register in database, run:');
    console.log('');
    console.log(`  CONTRACT_ADDRESS=${routerAddress} CHAIN_ID=${chainId} CONTRACT_NAME=MidcurveSwapRouter pnpm db:upsert-contract`);
    console.log('');
    console.log('Or export for later use:');
    console.log('');
    console.log(`  export SWAP_ROUTER_ADDRESS=${routerAddress}`);
    console.log(`  export CHAIN_ID=${chainId}`);
  } else {
    console.log('');
    console.log('Could not extract MidcurveSwapRouter address from output.');
    console.log('Check the forge output above for the deployed address.');
  }
}

main().catch((error) => {
  console.error('Deployment failed:', error.message);
  process.exit(1);
});
