import { Command } from 'commander';
import {
  createPublicClient,
  http,
  formatEther,
  type Address,
} from 'viem';
import { semseeChain } from '../../vm/chain.js';
import { FUNDING_ABI } from '../../abi/index.js';
import { ETH_ADDRESS } from '../../funding/types.js';

/**
 * Balance command - Query strategy balances via FundingMixin
 *
 * The strategy contract has getBalance() and getAllBalances() methods
 * that query BalanceStore using the strategy as msg.sender.
 *
 * Usage:
 *   semsee balance <strategyAddress> [chainId]
 */
export const balanceCommand = new Command('balance')
  .description('Query strategy balances via FundingMixin')
  .argument('<strategyAddress>', 'Strategy contract address')
  .argument('[chainId]', 'Optional chain ID to filter by')
  .action(async (strategyAddress: string, chainId?: string) => {
    const publicClient = createPublicClient({
      chain: semseeChain,
      transport: http(),
    });

    try {
      console.log(`\n📊 Querying balances for strategy: ${strategyAddress}`);

      if (chainId) {
        // Query specific chain via strategy's getAllBalances
        const chainIdBigInt = BigInt(chainId);
        const entries = await publicClient.readContract({
          address: strategyAddress as Address,
          abi: FUNDING_ABI,
          functionName: 'getAllBalances',
          args: [chainIdBigInt],
        });

        console.log(`\n   Chain ${chainId}:`);

        if (entries.length === 0) {
          console.log(`   No balances found`);
        } else {
          for (const entry of entries) {
            const tokenDisplay =
              entry.token.toLowerCase() === ETH_ADDRESS.toLowerCase()
                ? 'ETH (Native)'
                : entry.token;
            const balanceDisplay =
              entry.token.toLowerCase() === ETH_ADDRESS.toLowerCase()
                ? `${formatEther(entry.balance)} ETH`
                : entry.balance.toString();

            console.log(`   Token: ${tokenDisplay}`);
            console.log(`   Balance: ${balanceDisplay}`);
            console.log(`   Last Updated: ${new Date(Number(entry.lastUpdated) * 1000).toISOString()}`);
            console.log('');
          }
        }
      } else {
        // Query all supported chains
        const supportedChains = [1, 42161, 8453, 10, 137, 56]; // Ethereum, Arbitrum, Base, Optimism, Polygon, BSC

        let totalEntries = 0;

        for (const chain of supportedChains) {
          try {
            const entries = await publicClient.readContract({
              address: strategyAddress as Address,
              abi: FUNDING_ABI,
              functionName: 'getAllBalances',
              args: [BigInt(chain)],
            });

            if (entries.length > 0) {
              console.log(`\n   Chain ${chain}:`);
              for (const entry of entries) {
                const tokenDisplay =
                  entry.token.toLowerCase() === ETH_ADDRESS.toLowerCase()
                    ? 'ETH (Native)'
                    : entry.token;
                const balanceDisplay =
                  entry.token.toLowerCase() === ETH_ADDRESS.toLowerCase()
                    ? `${formatEther(entry.balance)} ETH`
                    : entry.balance.toString();

                console.log(`   Token: ${tokenDisplay}`);
                console.log(`   Balance: ${balanceDisplay}`);
                console.log(`   Last Updated: ${new Date(Number(entry.lastUpdated) * 1000).toISOString()}`);
                console.log('');
                totalEntries++;
              }
            }
          } catch {
            // Chain not configured or no balances
            continue;
          }
        }

        if (totalEntries === 0) {
          console.log(`\n   No balances found across any chain`);
        }
      }

      console.log(`\n✅ Balance query complete`);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`\n❌ Error: ${error.message}`);
      } else {
        console.error('\n❌ Unknown error occurred');
      }
      process.exit(1);
    }
  });
