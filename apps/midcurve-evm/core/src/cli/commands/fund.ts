import { Command } from 'commander';
import { createWalletClient, createPublicClient, http, parseEther, formatEther, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { semseeChain } from '../../vm/chain.js';
import { CORE_PRIVATE_KEY, CORE_ADDRESS } from '../../utils/addresses.js';

export const fundCommand = new Command('fund')
  .description('Fund an account with ETH from the Core account')
  .argument('<address>', 'Address to fund')
  .argument('[amount]', 'Amount in ETH (default: 0.1)', '0.1')
  .action(async (address: string, amount: string) => {
    const targetAddress = address as Address;
    const ethAmount = parseEther(amount);

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
      // Check Core balance first
      const coreBalance = await publicClient.getBalance({ address: CORE_ADDRESS });
      console.log(`\n💰 Core balance: ${formatEther(coreBalance)} ETH`);

      if (coreBalance < ethAmount) {
        console.error(`\n❌ Insufficient funds in Core account`);
        console.error(`   Requested: ${amount} ETH`);
        console.error(`   Available: ${formatEther(coreBalance)} ETH`);
        process.exit(1);
      }

      // Get target's current balance
      const beforeBalance = await publicClient.getBalance({ address: targetAddress });
      console.log(`   Target balance before: ${formatEther(beforeBalance)} ETH`);

      console.log(`\n📤 Sending ${amount} ETH to ${targetAddress}...`);

      const hash = await walletClient.sendTransaction({
        to: targetAddress,
        value: ethAmount,
      });

      console.log(`   TX Hash: ${hash}`);

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      if (receipt.status === 'success') {
        const afterBalance = await publicClient.getBalance({ address: targetAddress });
        console.log(`\n✅ Funded successfully!`);
        console.log(`   Target balance after: ${formatEther(afterBalance)} ETH`);
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
