import { Command } from 'commander';
import { createWalletClient, createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { semseeChain } from '../../vm/chain.js';
import { CORE_PRIVATE_KEY } from '../../utils/addresses.js';
import { STRATEGY_ABI, STRATEGY_STATES } from '../abis.js';

export const shutdownCommand = new Command('shutdown')
  .description('Shutdown a running strategy')
  .argument('<address>', 'Strategy contract address')
  .action(async (address: string) => {
    const strategyAddress = address as Address;

    const account = privateKeyToAccount(CORE_PRIVATE_KEY);
    const walletClient = createWalletClient({
      account,
      chain: semseeChain,
      transport: http(),
    });
    const publicClient = createPublicClient({
      chain: semseeChain,
      transport: http(),
    });

    try {
      // Check current state
      const currentState = await publicClient.readContract({
        address: strategyAddress,
        abi: STRATEGY_ABI,
        functionName: 'state',
      });

      const stateIndex = Number(currentState);
      if (stateIndex !== 1) {
        console.error(`\n❌ Cannot shutdown strategy`);
        console.error(`   Current state: ${STRATEGY_STATES[stateIndex]}`);
        console.error(`   Strategy must be in 'Running' state to shutdown`);
        process.exit(1);
      }

      console.log(`\n⏹️  Shutting down strategy at ${strategyAddress}...`);

      const hash = await walletClient.writeContract({
        address: strategyAddress,
        abi: STRATEGY_ABI,
        functionName: 'shutdown',
      });

      console.log(`   TX Hash: ${hash}`);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'success') {
        console.log(`\n✅ Strategy shutdown complete!`);
        console.log(`\n   The strategy is now inactive and cannot be restarted.`);
        console.log(`   Deploy a new strategy to continue.`);
        console.log('');
      } else {
        console.error(`\n❌ Transaction failed`);
        process.exit(1);
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
