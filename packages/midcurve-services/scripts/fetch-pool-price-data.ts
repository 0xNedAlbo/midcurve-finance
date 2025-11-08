/**
 * Fetch Real Pool Price Data from Arbitrum
 *
 * This script fetches actual historical pool price data from the Arbitrum
 * WETH/USDC 0.05% pool at specific blocks and outputs TypeScript fixture code.
 *
 * Pool Details:
 * - Address: 0xC6962004f452bE9203591991D15f6b388e09E8D0
 * - WETH (token0): 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1 (18 decimals)
 * - USDC (token1): 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 (6 decimals)
 * - Fee: 0.05% (500 basis points)
 *
 * Usage:
 *   # Option 1: Use .env.test file
 *   node --env-file=.env.test --loader=tsx scripts/fetch-pool-price-data.ts
 *
 *   # Option 2: Use public Arbitrum RPC (no API key needed)
 *   RPC_URL_ARBITRUM=https://arb1.arbitrum.io/rpc npx tsx scripts/fetch-pool-price-data.ts
 *
 *   # Option 3: Provide your own Alchemy/Infura RPC
 *   RPC_URL_ARBITRUM=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY npx tsx scripts/fetch-pool-price-data.ts
 *
 * Requirements:
 *   - tsx installed (npm i -D tsx) OR use node with --loader=tsx
 */

import { createPublicClient, http } from 'viem';
import { arbitrum } from 'viem/chains';
import {
  pricePerToken0InToken1,
  pricePerToken1InToken0,
} from '../src/shared/utils/uniswapv3/price.js';

// Uniswap V3 Pool ABI (minimal - just slot0)
const POOL_ABI = [
  {
    inputs: [],
    name: 'slot0',
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// Pool and token configuration
const WETH_USDC_POOL = {
  address: '0xC6962004f452bE9203591991D15f6b388e09E8D0' as const,
  wethAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  wethDecimals: 18,
  usdcDecimals: 6,
};

// Historical blocks to fetch (real Arbitrum blocks)
const HISTORICAL_BLOCKS = [
  { name: 'EARLY_2024', blockNumber: 150_000_000 },
  { name: 'MID_2024', blockNumber: 175_000_000 },
  { name: 'LATE_2024', blockNumber: 200_000_000 },
];

interface PoolPriceData {
  blockNumber: number;
  blockTimestamp: number;
  sqrtPriceX96: bigint;
  tick: number;
  token1PricePerToken0: bigint; // USDC per WETH (6 decimals)
  token0PricePerToken1: bigint; // WETH per USDC (18 decimals)
}

async function fetchPoolPriceAtBlock(
  client: any,
  blockNumber: number
): Promise<PoolPriceData> {
  console.log(`\nFetching data for block ${blockNumber}...`);

  // Fetch block info
  const block = await client.getBlock({
    blockNumber: BigInt(blockNumber),
  });

  const blockTimestamp = Number(block.timestamp);
  const timestamp = new Date(blockTimestamp * 1000);

  console.log(`  Block timestamp: ${timestamp.toISOString()}`);

  // Fetch pool slot0 at this block
  const slot0Data = (await client.readContract({
    address: WETH_USDC_POOL.address,
    abi: POOL_ABI,
    functionName: 'slot0',
    blockNumber: BigInt(blockNumber),
  })) as readonly [bigint, number, number, number, number, number, boolean];

  const sqrtPriceX96 = slot0Data[0];
  const tick = slot0Data[1];

  console.log(`  sqrtPriceX96: ${sqrtPriceX96}`);
  console.log(`  tick: ${tick}`);

  // Calculate prices using our utility functions
  // WETH is token0, USDC is token1
  const token1PricePerToken0 = pricePerToken0InToken1(
    sqrtPriceX96,
    WETH_USDC_POOL.wethDecimals
  );
  const token0PricePerToken1 = pricePerToken1InToken0(
    sqrtPriceX96,
    WETH_USDC_POOL.usdcDecimals
  );

  // Convert to human-readable prices for logging
  const wethPriceUsd =
    Number(token1PricePerToken0) / 10 ** WETH_USDC_POOL.usdcDecimals;
  const usdcPriceWeth =
    Number(token0PricePerToken1) / 10 ** WETH_USDC_POOL.wethDecimals;

  console.log(`  1 WETH = ${wethPriceUsd.toFixed(6)} USDC`);
  console.log(`  1 USDC = ${usdcPriceWeth.toFixed(18)} WETH`);

  return {
    blockNumber,
    blockTimestamp,
    sqrtPriceX96,
    tick,
    token1PricePerToken0,
    token0PricePerToken1,
  };
}

function generateFixtureCode(name: string, data: PoolPriceData): string {
  const timestamp = new Date(data.blockTimestamp * 1000).toISOString();
  const wethPriceUsd =
    Number(data.token1PricePerToken0) / 10 ** WETH_USDC_POOL.usdcDecimals;

  return `
/**
 * Real WETH/USDC Pool Price from Arbitrum
 * Block: ${data.blockNumber} (${timestamp})
 * Price: 1 WETH = ${wethPriceUsd.toFixed(6)} USDC
 */
export const ${name}: PoolPriceFixture = {
  input: {
    protocol: 'uniswapv3',
    poolId: 'pool_weth_usdc_arb_real', // Will be set to actual pool ID in tests
    timestamp: new Date('${timestamp}'),
    token1PricePerToken0: ${data.token1PricePerToken0}n,
    token0PricePerToken1: ${data.token0PricePerToken1}n,
    config: {
      blockNumber: ${data.blockNumber},
      blockTimestamp: ${data.blockTimestamp},
    },
    state: {
      sqrtPriceX96: ${data.sqrtPriceX96}n,
      tick: ${data.tick},
    },
  },
  dbResult: {
    id: 'poolprice_weth_usdc_arb_${name.toLowerCase()}',
    createdAt: new Date('${timestamp}'),
    updatedAt: new Date('${timestamp}'),
    protocol: 'uniswapv3',
    poolId: 'pool_weth_usdc_arb_real',
    timestamp: new Date('${timestamp}'),
    token1PricePerToken0: ${data.token1PricePerToken0}n,
    token0PricePerToken1: ${data.token0PricePerToken1}n,
    config: {
      blockNumber: ${data.blockNumber},
      blockTimestamp: ${data.blockTimestamp},
    },
    state: {
      sqrtPriceX96: ${data.sqrtPriceX96}n,
      tick: ${data.tick},
    },
  },
};`;
}

async function main() {
  console.log('========================================');
  console.log('Fetching Real Pool Price Data');
  console.log('========================================');
  console.log('Pool: WETH/USDC 0.05% on Arbitrum');
  console.log(`Address: ${WETH_USDC_POOL.address}`);
  console.log('========================================');

  // Check for RPC URL
  const rpcUrl = process.env.RPC_URL_ARBITRUM;
  if (!rpcUrl) {
    console.error('\n❌ ERROR: RPC_URL_ARBITRUM is not set');
    console.error('\nTry one of these options:');
    console.error('  1. Use public RPC (no API key needed):');
    console.error('     RPC_URL_ARBITRUM=https://arb1.arbitrum.io/rpc npx tsx scripts/fetch-pool-price-data.ts');
    console.error('\n  2. Use with .env.test file:');
    console.error('     node --env-file=.env.test --loader=tsx scripts/fetch-pool-price-data.ts');
    console.error('\n  3. Use your own Alchemy/Infura RPC:');
    console.error('     RPC_URL_ARBITRUM=https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY npx tsx scripts/fetch-pool-price-data.ts');
    process.exit(1);
  }

  // Create viem client
  const client = createPublicClient({
    chain: arbitrum,
    transport: http(rpcUrl),
  });

  console.log(`\n✓ Connected to Arbitrum RPC`);

  // Fetch data for all historical blocks
  const results: Array<{ name: string; data: PoolPriceData }> = [];

  for (const block of HISTORICAL_BLOCKS) {
    try {
      const data = await fetchPoolPriceAtBlock(client, block.blockNumber);
      results.push({ name: block.name, data });
    } catch (error) {
      console.error(`\n❌ Failed to fetch block ${block.blockNumber}:`, error);
      throw error;
    }
  }

  // Generate fixture code
  console.log('\n========================================');
  console.log('Generated Fixture Code');
  console.log('========================================');
  console.log('Copy the following code into test-fixtures.ts:\n');

  for (const { name, data } of results) {
    console.log(generateFixtureCode(name, data));
  }

  console.log('\n========================================');
  console.log('✓ Data fetch complete!');
  console.log('========================================');
  console.log('\nNext steps:');
  console.log('1. Copy the fixture code above into test-fixtures.ts');
  console.log('2. Update integration tests to use these real fixtures');
  console.log('3. Run: npm run test:integration -- pool-price');
  console.log('========================================\n');
}

// Run the script
main().catch((error) => {
  console.error('\n❌ Script failed:', error);
  process.exit(1);
});
