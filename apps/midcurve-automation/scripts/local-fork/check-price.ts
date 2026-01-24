/**
 * Check Pool Price
 *
 * Reads the current sqrtPriceX96 and tick from a Uniswap V3 pool.
 * Useful for verifying price manipulation results.
 *
 * Usage:
 *   MOCK_USD_WETH_POOL_ADDRESS="0x..." pnpm local:check-price
 */

import { createPublicClient, http } from 'viem';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Load .env file manually (no dotenv dependency)
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

loadEnv();
import { localhost } from 'viem/chains';
import { UNISWAP_V3_POOL_ABI } from '../../src/lib/evm';

const LOCAL_RPC = 'http://localhost:8545';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

async function main(): Promise<void> {
  const poolAddress = process.env.MOCK_USD_WETH_POOL_ADDRESS;

  if (!poolAddress) {
    console.error('ERROR: MOCK_USD_WETH_POOL_ADDRESS environment variable is required');
    console.error('');
    console.error('Usage:');
    console.error('  export MOCK_USD_WETH_POOL_ADDRESS="0x..."');
    console.error('  pnpm local:check-price');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Pool Price Check');
  console.log('='.repeat(60));
  console.log('RPC:', LOCAL_RPC);
  console.log('Pool:', poolAddress);
  console.log('');

  const client = createPublicClient({
    chain: { ...localhost, id: 31337 },
    transport: http(LOCAL_RPC),
  });

  try {
    // Read slot0
    const result = await client.readContract({
      address: poolAddress as `0x${string}`,
      abi: UNISWAP_V3_POOL_ABI,
      functionName: 'slot0',
    });

    const sqrtPriceX96 = result[0] as bigint;
    const tick = result[1] as number;

    console.log('=== Current Pool State ===');
    console.log('sqrtPriceX96:', sqrtPriceX96.toString());
    console.log('tick:', tick);
    console.log('');

    // Read token order
    const token0 = await client.readContract({
      address: poolAddress as `0x${string}`,
      abi: [{ inputs: [], name: 'token0', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' }],
      functionName: 'token0',
    });

    const isWethToken0 = (token0 as string).toLowerCase() === WETH.toLowerCase();
    console.log('Token order:', isWethToken0 ? 'WETH (token0), MockUSD (token1)' : 'MockUSD (token0), WETH (token1)');

    // Calculate price using BigInt math to avoid precision loss
    // sqrtPriceX96 = sqrt(price) * 2^96
    // price = (sqrtPriceX96 / 2^96)^2 = sqrtPriceX96^2 / 2^192
    //
    // For Uniswap V3: price = token1/token0 in raw units
    // If MockUSD (6 dec) is token0 and WETH (18 dec) is token1:
    //   price = WETH_raw / MockUSD_raw
    //   ETH price in USD = (1e18 WETH_raw) / price / 1e6 = 1e12 / price
    //
    // If WETH is token0 and MockUSD is token1:
    //   price = MockUSD_raw / WETH_raw
    //   ETH price in USD = price * 1e18 / 1e6 = price * 1e12

    // Use tick for reliable price calculation (avoids BigInt overflow issues)
    // price = 1.0001^tick
    const tickPrice = Math.pow(1.0001, tick);

    let ethPriceInUsd: number;
    if (isWethToken0) {
      // price = MockUSD_raw / WETH_raw
      // 1 ETH worth of MockUSD_raw = price * 1e18
      // In MockUSD tokens = (price * 1e18) / 1e6 = price * 1e12
      ethPriceInUsd = tickPrice * 1e12;
    } else {
      // price = WETH_raw / MockUSD_raw
      // 1 ETH costs (1e18 WETH_raw) which is 1e18/price MockUSD_raw
      // In MockUSD tokens = (1e18/price) / 1e6 = 1e12 / price
      ethPriceInUsd = 1e12 / tickPrice;
    }

    console.log('');
    console.log('=== Price Estimate (from tick) ===');
    console.log('ETH price in MockUSD:', ethPriceInUsd.toFixed(2));
  } catch (error) {
    console.error('Failed to read pool state:', error);
    console.error('');
    console.error('Make sure:');
    console.error('1. Anvil is running on port 8546');
    console.error('2. MOCK_USD_WETH_POOL_ADDRESS is correct');
    process.exit(1);
  }
}

main().catch(console.error);
