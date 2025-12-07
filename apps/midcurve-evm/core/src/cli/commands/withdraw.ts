import { Command } from 'commander';
import {
  createWalletClient,
  createPublicClient,
  http,
  formatEther,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { semseeChain } from '../../vm/chain.js';
import { FUNDING_ABI } from '../../abi/index.js';

/**
 * Withdraw command - Request withdrawal of tokens from automation wallet
 *
 * Usage:
 *   semsee withdraw erc20 <strategyAddress> <chainId> <tokenAddress> <amount>
 *   semsee withdraw eth <strategyAddress> <chainId> <amount>
 */
export const withdrawCommand = new Command('withdraw')
  .description('Request withdrawal of tokens from automation wallet to owner')
  .addCommand(
    new Command('erc20')
      .description('Withdraw ERC-20 tokens')
      .argument('<strategyAddress>', 'Strategy contract address')
      .argument('<chainId>', 'Chain ID where tokens are held')
      .argument('<tokenAddress>', 'ERC-20 token address')
      .argument('<amount>', 'Amount to withdraw (in token decimals)')
      .option('-k, --key <privateKey>', 'Private key of strategy owner', process.env.OWNER_PRIVATE_KEY)
      .action(async (strategyAddress: string, chainId: string, tokenAddress: string, amount: string, options) => {
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

          console.log(`\\n📤 Requesting ERC-20 withdrawal...`);
          console.log(`   Strategy: ${strategyAddress}`);
          console.log(`   Chain ID: ${chainId}`);
          console.log(`   Token: ${tokenAddress}`);
          console.log(`   Amount: ${amount}`);
          console.log(`   Recipient: ${account.address}`);

          const hash = await walletClient.writeContract({
            address: strategyAddress as Address,
            abi: FUNDING_ABI,
            functionName: 'withdrawErc20',
            args: [BigInt(chainId), tokenAddress as Address, BigInt(amount)],
          });

          console.log(`\\n   TX Hash: ${hash}`);

          // Wait for confirmation
          const receipt = await publicClient.waitForTransactionReceipt({ hash });

          if (receipt.status === 'success') {
            // Extract requestId from logs
            const requestIdLog = receipt.logs.find(
              (log) => log.topics[0] === '0x' + 'Erc20WithdrawRequested'.padEnd(64, '0')
            );
            const requestId = requestIdLog?.topics[1] || 'unknown';

            console.log(`\\n✅ Withdrawal requested successfully!`);
            console.log(`   Request ID: ${requestId}`);
            console.log(`   Core will process this request and transfer tokens to ${account.address}`);
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
      })
  )
  .addCommand(
    new Command('eth')
      .description('Withdraw native ETH')
      .argument('<strategyAddress>', 'Strategy contract address')
      .argument('<chainId>', 'Chain ID where ETH is held')
      .argument('<amount>', 'Amount to withdraw (in wei)')
      .option('-k, --key <privateKey>', 'Private key of strategy owner', process.env.OWNER_PRIVATE_KEY)
      .action(async (strategyAddress: string, chainId: string, amount: string, options) => {
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

          console.log(`\\n📤 Requesting ETH withdrawal...`);
          console.log(`   Strategy: ${strategyAddress}`);
          console.log(`   Chain ID: ${chainId}`);
          console.log(`   Amount: ${formatEther(BigInt(amount))} ETH (${amount} wei)`);
          console.log(`   Recipient: ${account.address}`);

          const hash = await walletClient.writeContract({
            address: strategyAddress as Address,
            abi: FUNDING_ABI,
            functionName: 'withdrawEth',
            args: [BigInt(chainId), BigInt(amount)],
          });

          console.log(`\\n   TX Hash: ${hash}`);

          // Wait for confirmation
          const receipt = await publicClient.waitForTransactionReceipt({ hash });

          if (receipt.status === 'success') {
            console.log(`\\n✅ Withdrawal requested successfully!`);
            console.log(`   Core will process this request and transfer ETH to ${account.address}`);
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
      })
  );
