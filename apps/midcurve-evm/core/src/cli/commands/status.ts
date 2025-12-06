import { Command } from 'commander';
import { createPublicClient, http, formatEther, type Address } from 'viem';
import { semseeChain } from '../../vm/chain.js';
import { SYSTEM_REGISTRY_ADDRESS, CORE_ADDRESS } from '../../utils/addresses.js';
import { SYSTEM_REGISTRY_ABI } from '../../abi/SystemRegistry.js';
import { STRATEGY_ABI, OHLC_LOGGER_ABI, STRATEGY_STATES } from '../abis.js';

export const statusCommand = new Command('status')
  .description('Show strategy or system status')
  .argument('[address]', 'Strategy address (optional - shows system status if omitted)')
  .action(async (address?: string) => {
    const client = createPublicClient({
      chain: semseeChain,
      transport: http(),
    });

    try {
      if (address) {
        // Show strategy status
        await showStrategyStatus(client, address as Address);
      } else {
        // Show system status
        await showSystemStatus(client);
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(`\n❌ Error: ${error.message}`);
      } else {
        console.error('\n❌ Unknown error occurred');
      }
      process.exit(1);
    }
  });

async function showSystemStatus(client: ReturnType<typeof createPublicClient>) {
  console.log('\n🖥️  SEMSEE System Status\n');

  // Check RPC connectivity
  let blockNumber: bigint;
  try {
    blockNumber = await client.getBlockNumber();
    console.log(`   ✅ RPC:           http://localhost:8545 (connected)`);
    console.log(`   📦 Block:         ${blockNumber}`);
  } catch {
    console.log(`   ❌ RPC:           http://localhost:8545 (not connected)`);
    console.log(`\n   Run 'npm run up' to start the SEMSEE node.`);
    return;
  }

  // Check Core account balance
  const coreBalance = await client.getBalance({ address: CORE_ADDRESS });
  console.log(`   💰 Core Account:  ${CORE_ADDRESS}`);
  console.log(`                     Balance: ${formatEther(coreBalance)} ETH`);

  // Check SystemRegistry
  console.log(`\n   📋 SystemRegistry: ${SYSTEM_REGISTRY_ADDRESS}`);

  try {
    const [poolStore, positionStore, balanceStore] = await Promise.all([
      client.readContract({
        address: SYSTEM_REGISTRY_ADDRESS,
        abi: SYSTEM_REGISTRY_ABI,
        functionName: 'poolStore',
      }),
      client.readContract({
        address: SYSTEM_REGISTRY_ADDRESS,
        abi: SYSTEM_REGISTRY_ABI,
        functionName: 'positionStore',
      }),
      client.readContract({
        address: SYSTEM_REGISTRY_ADDRESS,
        abi: SYSTEM_REGISTRY_ABI,
        functionName: 'balanceStore',
      }),
    ]);

    const zeroAddr = '0x0000000000000000000000000000000000000000';
    console.log(`      PoolStore:     ${poolStore === zeroAddr ? '❌ Not deployed' : poolStore}`);
    console.log(`      PositionStore: ${positionStore === zeroAddr ? '❌ Not deployed' : positionStore}`);
    console.log(`      BalanceStore:  ${balanceStore === zeroAddr ? '❌ Not deployed' : balanceStore}`);
  } catch {
    console.log(`      ❌ Unable to read store addresses (registry may not be deployed)`);
  }

  console.log('\n   Quick Commands:');
  console.log('     npm run strategy:create MyStrategy  # Create new strategy');
  console.log('     npm run strategy:deploy MyStrategy  # Deploy strategy');
  console.log('     npm run strategy:status <address>   # Check strategy status');
  console.log('');
}

async function showStrategyStatus(client: ReturnType<typeof createPublicClient>, address: Address) {
  console.log(`\n📊 Strategy Status: ${address}\n`);

  try {
    // Read basic strategy info
    const [owner, state] = await Promise.all([
      client.readContract({
        address,
        abi: STRATEGY_ABI,
        functionName: 'owner',
      }),
      client.readContract({
        address,
        abi: STRATEGY_ABI,
        functionName: 'state',
      }),
    ]);

    const stateIndex = Number(state);
    const stateName = STRATEGY_STATES[stateIndex] || 'Unknown';
    const stateIcon = stateIndex === 0 ? '⏸️ ' : stateIndex === 1 ? '▶️ ' : '⏹️ ';

    console.log(`   Owner:   ${owner}`);
    console.log(`   State:   ${stateIcon}${stateName}`);

    // Try to read OhlcLogger-specific fields
    try {
      const [candleCount, marketId] = await Promise.all([
        client.readContract({
          address,
          abi: OHLC_LOGGER_ABI,
          functionName: 'candleCount',
        }),
        client.readContract({
          address,
          abi: OHLC_LOGGER_ABI,
          functionName: 'ETH_USD_MARKET',
        }),
      ]);

      console.log(`\n   📈 OHLC Logger Stats:`);
      console.log(`      Market ID:      ${marketId}`);
      console.log(`      Candles:        ${candleCount}`);
    } catch {
      // Not an OhlcLoggerStrategy, that's fine
    }

    // Show available actions based on state
    console.log('\n   Available Actions:');
    if (stateIndex === 0) {
      console.log(`     npm run strategy:start ${address}     # Start the strategy`);
    } else if (stateIndex === 1) {
      console.log(`     npm run strategy:logs ${address}      # Watch logs`);
      console.log(`     npm run strategy:event ohlc ${address} # Send test event`);
      console.log(`     npm run strategy:shutdown ${address}  # Shutdown`);
    } else {
      console.log('     (Strategy is shutdown, no actions available)');
    }
    console.log('');
  } catch (error) {
    if (error instanceof Error && error.message.includes('returned no data')) {
      console.log(`   ❌ No contract found at this address`);
    } else {
      throw error;
    }
  }
}
