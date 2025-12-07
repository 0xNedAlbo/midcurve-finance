import { Command } from 'commander';
import {
  createWalletClient,
  createPublicClient,
  http,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { semseeChain } from '../../vm/chain.js';
import { FUNDING_ABI } from '../../abi/index.js';

/**
 * Update ETH Balance command - Request Core to poll and update ETH balance
 *
 * Usage:
 *   semsee update-eth-balance <strategyAddress> <chainId>
 *
 * Use this after sending ETH to the automation wallet on an external chain.
 * Core will poll the ETH balance and update BalanceStore.
 */
export const updateEthBalanceCommand = new Command('update-eth-balance')
  .description('Request Core to poll and update ETH balance for a strategy')
  .argument('<strategyAddress>', 'Strategy contract address')
  .argument('<chainId>', 'Chain ID to poll ETH balance from')
  .option('-k, --key <privateKey>', 'Private key of strategy owner', process.env.OWNER_PRIVATE_KEY)
  .action(async (strategyAddress: string, chainId: string, options) => {
    if (!options.key) {
      console.error('Error: Private key required. Use --key or set OWNER_PRIVATE_KEY env var');
      process.exit(1);
    }

    const account = privateKeyToAccount(options.key as `0x${string}`);
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
      // Verify the caller is the strategy owner
      const owner = await publicClient.readContract({
        address: strategyAddress as Address,
        abi: [
          {
            type: 'function',
            name: 'owner',
            inputs: [],
            outputs: [{ name: '', type: 'address' }],
            stateMutability: 'view',
          },
        ],
        functionName: 'owner',
      });

      if (owner.toLowerCase() !== account.address.toLowerCase()) {
        console.error(`\\n❌ Error: You are not the owner of this strategy`);
        console.error(`   Strategy owner: ${owner}`);
        console.error(`   Your address: ${account.address}`);
        process.exit(1);
      }

      console.log(`\\n🔄 Requesting ETH balance update...`);
      console.log(`   Strategy: ${strategyAddress}`);
      console.log(`   Chain ID: ${chainId}`);

      const hash = await walletClient.writeContract({
        address: strategyAddress as Address,
        abi: FUNDING_ABI,
        functionName: 'updateEthBalance',
        args: [BigInt(chainId)],
      });

      console.log(`\\n   TX Hash: ${hash}`);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'success') {
        console.log(`\\n✅ ETH balance update requested successfully!`);
        console.log(`   Core will poll the ETH balance on chain ${chainId}`);
        console.log(`   and update BalanceStore with the result.`);
      } else {
        console.error(`\\n❌ Transaction failed`);
        process.exit(1);
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(`\\n❌ Error: ${error.message}`);
      } else {
        console.error('\\n❌ Unknown error occurred');
      }
      process.exit(1);
    }
  });
