/**
 * POST /api/wallets/fund - Fund a wallet with ETH from CORE
 *
 * This endpoint is used during strategy deployment to fund the automation
 * wallet so it can pay for gas when deploying the strategy contract.
 *
 * Request: { walletAddress: string, amountEth?: string }
 * Response: { txHash: string, funded: string, walletAddress: string }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { logger } from '../../../../lib/logger';

const log = logger.child({ route: 'POST /api/wallets/fund' });

const SEMSEE_CHAIN_ID = 31337;

const semseeChain = {
  id: SEMSEE_CHAIN_ID,
  name: 'SEMSEE',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: [process.env.SEMSEE_RPC_URL || 'http://localhost:8545'] },
  },
} as const;

const FundRequestSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amountEth: z.string().optional().default('1'),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parseResult = FundRequestSchema.safeParse(body);

    if (!parseResult.success) {
      log.warn({ errors: parseResult.error.errors, msg: 'Invalid request' });
      return NextResponse.json(
        { error: 'Invalid request', details: parseResult.error.errors },
        { status: 400 }
      );
    }

    const { walletAddress, amountEth } = parseResult.data;

    const corePrivateKey = process.env.CORE_PRIVATE_KEY;
    if (!corePrivateKey) {
      log.error({ msg: 'CORE_PRIVATE_KEY not configured' });
      return NextResponse.json(
        { error: 'CORE_PRIVATE_KEY not configured' },
        { status: 500 }
      );
    }

    const rpcUrl = process.env.SEMSEE_RPC_URL || 'http://localhost:8545';

    const walletClient = createWalletClient({
      account: privateKeyToAccount(corePrivateKey as `0x${string}`),
      chain: semseeChain,
      transport: http(rpcUrl),
    });

    log.info({ walletAddress, amountEth, msg: 'Funding wallet from CORE' });

    // Use fixed gas limit to avoid eth_estimateGas call
    // (Geth Clique PoA has a bug that crashes on estimateGas)
    const txHash = await walletClient.sendTransaction({
      to: walletAddress as Address,
      value: parseEther(amountEth),
      gas: 21000n, // Standard ETH transfer gas
    });

    // Wait for confirmation
    const publicClient = createPublicClient({
      chain: semseeChain,
      transport: http(rpcUrl),
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });

    log.info({ walletAddress, amountEth, txHash, msg: 'Wallet funded successfully' });

    return NextResponse.json({
      txHash,
      funded: amountEth,
      walletAddress,
    });
  } catch (error) {
    log.error({
      error: error instanceof Error ? error.message : 'Unknown error',
      msg: 'Failed to fund wallet',
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
