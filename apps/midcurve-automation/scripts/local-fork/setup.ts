/**
 * Local Fork Setup Script
 *
 * Runs all local fork setup steps in sequence, capturing and passing
 * addresses between steps automatically.
 *
 * Usage:
 *   pnpm local:setup
 *
 * Prerequisites:
 *   - Anvil running on port 8545 (pnpm local:anvil in another terminal)
 *   - .env file with RPC_URL_ETHEREUM set
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
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

// Foundry test account #0 (pre-funded in Anvil)
const FOUNDRY_SENDER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

interface SetupState {
  mockUsdAddress?: string;
  positionCloserAddress?: string;
  poolAddress?: string;
  positionTokenId?: string;
}

async function runCommand(
  command: string,
  args: string[],
  env: Record<string, string> = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';

    const proc = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    // Provide empty stdin to prevent TTY prompts
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
      reject(new Error(`Failed to start command: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`Command exited with code ${code}`));
      }
    });
  });
}

function extractAddress(output: string, pattern: RegExp): string | undefined {
  const match = output.match(pattern);
  return match ? match[1] : undefined;
}

/**
 * Update shared-contracts.json files with the deployed PositionCloser address.
 * Updates both automation and API config files.
 */
function updateSharedContractsConfig(positionCloserAddress: string): void {
  const configPaths = [
    resolve(process.cwd(), 'config/shared-contracts.json'), // automation
    resolve(process.cwd(), '../midcurve-api/config/shared-contracts.json'), // api
  ];

  const MAINNET_POSITION_MANAGER = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';

  for (const configPath of configPaths) {
    if (!existsSync(configPath)) {
      console.warn(`Warning: Config file not found: ${configPath}`);
      continue;
    }

    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));

      // Initialize uniswapv3 if not present
      if (!config.uniswapv3) {
        config.uniswapv3 = {};
      }

      // Add or update local chain entry (31337)
      config.uniswapv3['31337'] = {
        contractAddress: positionCloserAddress,
        positionManager: MAINNET_POSITION_MANAGER,
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
      console.log(`Updated: ${configPath}`);
    } catch (error) {
      console.error(`Failed to update ${configPath}:`, error);
    }
  }
}

async function step1Deploy(state: SetupState): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('Step 1: Deploy MockUSD and PositionCloser');
  console.log('='.repeat(60) + '\n');

  const output = await runCommand('forge', [
    'script',
    'script/DeployLocal.s.sol',
    '--rpc-url',
    'local',
    '--broadcast',
    '--unlocked',
    '--sender',
    FOUNDRY_SENDER,
  ]);

  // Extract addresses from output
  // Looking for patterns like "MockUSD deployed at: 0x..."
  state.mockUsdAddress = extractAddress(output, /MockUSD deployed at:\s*(0x[a-fA-F0-9]{40})/);
  state.positionCloserAddress = extractAddress(output, /PositionCloser deployed at:\s*(0x[a-fA-F0-9]{40})/);

  if (!state.mockUsdAddress) {
    throw new Error('Failed to extract MockUSD address from deploy output');
  }

  console.log('\n--- Extracted Addresses ---');
  console.log('MockUSD:', state.mockUsdAddress);
  console.log('PositionCloser:', state.positionCloserAddress || '(not found)');

  // Update shared-contracts.json with deployed PositionCloser address
  if (state.positionCloserAddress) {
    console.log('\n--- Updating Configuration ---');
    updateSharedContractsConfig(state.positionCloserAddress);
  }
}

async function step2CreatePool(state: SetupState): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('Step 2: Create WETH/MockUSD Pool');
  console.log('='.repeat(60) + '\n');

  if (!state.mockUsdAddress) {
    throw new Error('MockUSD address not set');
  }

  const output = await runCommand(
    'forge',
    [
      'script',
      'script/CreatePool.s.sol',
      '--rpc-url',
      'local',
      '--broadcast',
      '--unlocked',
      '--sender',
      FOUNDRY_SENDER,
    ],
    {
      MOCK_USD_ADDRESS: state.mockUsdAddress,
    }
  );

  // Extract pool address
  // Looking for pattern like "Pool created: 0x..."
  state.poolAddress = extractAddress(output, /Pool created:\s*(0x[a-fA-F0-9]{40})/);

  if (!state.poolAddress) {
    throw new Error('Failed to extract pool address from create-pool output');
  }

  console.log('\n--- Extracted Address ---');
  console.log('Pool:', state.poolAddress);
}

async function step3AddLiquidity(state: SetupState): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('Step 3: Add Liquidity to Pool');
  console.log('='.repeat(60) + '\n');

  if (!state.mockUsdAddress || !state.poolAddress) {
    throw new Error('MockUSD or Pool address not set');
  }

  const output = await runCommand(
    'forge',
    [
      'script',
      'script/AddLiquidity.s.sol',
      '--rpc-url',
      'local',
      '--broadcast',
      '--unlocked',
      '--sender',
      FOUNDRY_SENDER,
    ],
    {
      MOCK_USD_ADDRESS: state.mockUsdAddress,
      POOL_ADDRESS: state.poolAddress,
    }
  );

  // Extract position token ID
  // Looking for pattern like "Token ID: 123"
  state.positionTokenId = extractAddress(output, /Token ID:\s*(\d+)/);

  console.log('\n--- Position Created ---');
  console.log('Token ID:', state.positionTokenId || '(not found)');
}

async function step4FundTestAccount(state: SetupState): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('Step 4: Fund Test Account');
  console.log('='.repeat(60) + '\n');

  if (!state.mockUsdAddress) {
    throw new Error('MockUSD address not set');
  }

  await runCommand(
    'forge',
    [
      'script',
      'script/FundTestAccount.s.sol',
      '--rpc-url',
      'local',
      '--broadcast',
      '--unlocked',
      '--sender',
      FOUNDRY_SENDER,
    ],
    {
      MOCK_USD_ADDRESS: state.mockUsdAddress,
    }
  );
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Local Fork Setup');
  console.log('='.repeat(60));
  console.log('');
  console.log('This script will:');
  console.log('1. Deploy MockUSD token and PositionCloser contract');
  console.log('2. Create a WETH/MockUSD Uniswap V3 pool');
  console.log('3. Add initial liquidity to the pool');
  console.log('4. Fund test account #0 with 100 WETH + 1,000,000 MockUSD');
  console.log('');
  console.log('Prerequisites:');
  console.log('- Anvil running on port 8545 (pnpm local:anvil)');
  console.log('');

  const state: SetupState = {};

  try {
    await step1Deploy(state);
    await step2CreatePool(state);
    await step3AddLiquidity(state);
    await step4FundTestAccount(state);

    console.log('\n' + '='.repeat(60));
    console.log('Setup Complete!');
    console.log('='.repeat(60));
    console.log('');
    console.log('Deployed Addresses:');
    console.log('  MockUSD:', state.mockUsdAddress);
    console.log('  PositionCloser:', state.positionCloserAddress || '(not deployed)');
    console.log('  Pool:', state.poolAddress);
    console.log('');
    console.log('Position NFT Token ID:', state.positionTokenId || '(not minted)');
    console.log('');
    console.log('Environment Variables for Manual Commands:');
    console.log(`  export MOCK_USD_ADDRESS="${state.mockUsdAddress}"`);
    console.log(`  export POOL_ADDRESS="${state.poolAddress}"`);
    console.log(`  export POSITION_CLOSER_ADDRESS="${state.positionCloserAddress}"`);
    console.log('');
    console.log('Next Steps:');
    console.log('1. Check pool price:');
    console.log(`   POOL_ADDRESS="${state.poolAddress}" pnpm local:check-price`);
    console.log('');
    console.log('2. Manipulate ETH price UP (buy ETH with MockUSD - makes ETH more expensive):');
    console.log(`   MOCK_USD_ADDRESS="${state.mockUsdAddress}" POOL_ADDRESS="${state.poolAddress}" DIRECTION=up SWAP_AMOUNT=1000000000 pnpm local:price-up`);
    console.log('   (Note: SWAP_AMOUNT=1000000000 = 1000 MockUSD. Use smaller amounts to avoid draining liquidity)');
    console.log('');
    console.log('3. Manipulate ETH price DOWN (sell ETH for MockUSD - makes ETH cheaper):');
    console.log(`   MOCK_USD_ADDRESS="${state.mockUsdAddress}" POOL_ADDRESS="${state.poolAddress}" DIRECTION=down SWAP_AMOUNT=300000000000000000 pnpm local:price-down`);
    console.log('   (Note: SWAP_AMOUNT=300000000000000000 = 0.3 ETH. Use smaller amounts to avoid draining liquidity)');
  } catch (error) {
    console.error('\n' + '='.repeat(60));
    console.error('Setup Failed!');
    console.error('='.repeat(60));
    console.error('');
    console.error('Error:', error instanceof Error ? error.message : error);
    console.error('');
    console.error('Current state:');
    console.error('  MockUSD:', state.mockUsdAddress || '(not deployed)');
    console.error('  Pool:', state.poolAddress || '(not created)');
    console.error('');
    console.error('Make sure Anvil is running: pnpm local:anvil');
    process.exit(1);
  }
}

main();
