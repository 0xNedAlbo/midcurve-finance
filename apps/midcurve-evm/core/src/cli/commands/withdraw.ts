import { Command } from 'commander';
import {
  createWalletClient,
  createPublicClient,
  http,
  formatEther,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { semseeChain } from '../../vm/chain.js';
import {
  WITHDRAW_REQUEST_DOMAIN,
  WITHDRAW_REQUEST_TYPES,
  ETH_ADDRESS,
} from '../../funding/index.js';

/**
 * Default withdrawal server URL
 */
const DEFAULT_WITHDRAWAL_SERVER = 'http://localhost:8547';

/**
 * Default validity window for withdrawal requests (5 minutes)
 */
const DEFAULT_VALIDITY_MS = 5 * 60 * 1000;

/**
 * Withdraw command - Request withdrawal of tokens from automation wallet
 *
 * This command:
 * 1. Signs a withdrawal request using EIP-712 typed data
 * 2. Submits the signed request to Core's withdrawal server
 * 3. Core verifies the signature and executes the withdrawal
 *
 * Usage:
 *   semsee withdraw erc20 <strategyAddress> <chainId> <tokenAddress> <amount> [recipient]
 *   semsee withdraw eth <strategyAddress> <chainId> <amount> [recipient]
 */
export const withdrawCommand = new Command('withdraw')
  .description('Request withdrawal of tokens from automation wallet')
  .addCommand(
    new Command('erc20')
      .description('Withdraw ERC-20 tokens')
      .argument('<strategyAddress>', 'Strategy contract address')
      .argument('<chainId>', 'Chain ID where tokens are held')
      .argument('<tokenAddress>', 'ERC-20 token address')
      .argument('<amount>', 'Amount to withdraw (in token decimals)')
      .argument('[recipient]', 'Recipient address (default: strategy owner)')
      .option('-k, --key <privateKey>', 'Private key of strategy owner', process.env.OWNER_PRIVATE_KEY)
      .option('-s, --server <url>', 'Withdrawal server URL', DEFAULT_WITHDRAWAL_SERVER)
      .action(async (
        strategyAddress: string,
        chainId: string,
        tokenAddress: string,
        amount: string,
        recipient: string | undefined,
        options
      ) => {
        await executeWithdraw({
          strategyAddress: strategyAddress as Address,
          chainId: BigInt(chainId),
          token: tokenAddress as Address,
          amount: BigInt(amount),
          recipient: recipient as Address | undefined,
          privateKey: options.key,
          serverUrl: options.server,
          isEth: false,
        });
      })
  )
  .addCommand(
    new Command('eth')
      .description('Withdraw native ETH')
      .argument('<strategyAddress>', 'Strategy contract address')
      .argument('<chainId>', 'Chain ID where ETH is held')
      .argument('<amount>', 'Amount to withdraw (in wei)')
      .argument('[recipient]', 'Recipient address (default: strategy owner)')
      .option('-k, --key <privateKey>', 'Private key of strategy owner', process.env.OWNER_PRIVATE_KEY)
      .option('-s, --server <url>', 'Withdrawal server URL', DEFAULT_WITHDRAWAL_SERVER)
      .action(async (
        strategyAddress: string,
        chainId: string,
        amount: string,
        recipient: string | undefined,
        options
      ) => {
        await executeWithdraw({
          strategyAddress: strategyAddress as Address,
          chainId: BigInt(chainId),
          token: ETH_ADDRESS,
          amount: BigInt(amount),
          recipient: recipient as Address | undefined,
          privateKey: options.key,
          serverUrl: options.server,
          isEth: true,
        });
      })
  );

interface WithdrawOptions {
  strategyAddress: Address;
  chainId: bigint;
  token: Address;
  amount: bigint;
  recipient?: Address;
  privateKey?: string;
  serverUrl: string;
  isEth: boolean;
}

async function executeWithdraw(options: WithdrawOptions): Promise<void> {
  const {
    strategyAddress,
    chainId,
    token,
    amount,
    privateKey,
    serverUrl,
    isEth,
  } = options;

  if (!privateKey) {
    console.error('Error: Private key required. Use --key or set OWNER_PRIVATE_KEY env var');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
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
      address: strategyAddress,
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
      console.error(`\n❌ Error: You are not the owner of this strategy`);
      console.error(`   Strategy owner: ${owner}`);
      console.error(`   Your address: ${account.address}`);
      process.exit(1);
    }

    // Use provided recipient or default to owner
    const recipient = options.recipient || account.address;

    // Create the withdrawal request message
    const now = BigInt(Date.now());
    const message = {
      strategyAddress,
      chainId,
      token,
      amount,
      recipient,
      nonce: now,
      expiry: now + BigInt(DEFAULT_VALIDITY_MS),
    };

    console.log(`\n📤 Signing ${isEth ? 'ETH' : 'ERC-20'} withdrawal request...`);
    console.log(`   Strategy: ${strategyAddress}`);
    console.log(`   Chain ID: ${chainId.toString()}`);
    if (!isEth) {
      console.log(`   Token: ${token}`);
    }
    console.log(`   Amount: ${isEth ? formatEther(amount) + ' ETH' : amount.toString()}`);
    console.log(`   Recipient: ${recipient}`);

    // Sign the request using EIP-712
    const signature = await walletClient.signTypedData({
      domain: WITHDRAW_REQUEST_DOMAIN,
      types: WITHDRAW_REQUEST_TYPES,
      primaryType: 'WithdrawRequest',
      message,
    });

    console.log(`\n   Signature: ${signature.slice(0, 20)}...${signature.slice(-8)}`);

    // Submit to withdrawal server
    console.log(`\n📡 Submitting to withdrawal server at ${serverUrl}...`);

    const response = await fetch(`${serverUrl}/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          strategyAddress: message.strategyAddress,
          chainId: message.chainId.toString(),
          token: message.token,
          amount: message.amount.toString(),
          recipient: message.recipient,
          nonce: message.nonce.toString(),
          expiry: message.expiry.toString(),
        },
        signature,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ errorMessage: 'Unknown error' })) as { errorMessage?: string };
      throw new Error(error.errorMessage || `HTTP ${response.status}`);
    }

    const result = await response.json() as {
      success: boolean;
      requestId?: Hex;
      txHash?: Hex;
      errorMessage?: string;
    };

    if (result.success) {
      console.log(`\n✅ Withdrawal executed successfully!`);
      console.log(`   Request ID: ${result.requestId}`);
      console.log(`   TX Hash: ${result.txHash}`);
      console.log(`   Tokens transferred to ${recipient}`);
    } else {
      console.error(`\n❌ Withdrawal failed: ${result.errorMessage}`);
      if (result.requestId) {
        console.error(`   Request ID: ${result.requestId}`);
      }
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
}
