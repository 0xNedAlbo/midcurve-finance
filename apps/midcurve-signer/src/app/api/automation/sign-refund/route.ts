/**
 * POST /api/automation/sign-refund - Sign Refund Transaction
 *
 * Signs a transaction to refund ETH from the automation wallet back to its owner.
 * The owner address is looked up from the database - NOT passed by caller.
 *
 * Security:
 * - Signer has NO external network access (no RPC calls)
 * - Owner address is determined from DB, preventing fund redirection
 * - Only signs, doesn't broadcast
 *
 * Request:
 * - Authorization: X-Internal-API-Key header
 * - Body: { walletAddress, chainId, amount, nonce, gasLimit, maxFeePerGas, maxPriorityFeePerGas }
 *
 * Response:
 * - 200: { success: true, data: { signedTransaction, to } }
 * - 400: Invalid request
 * - 404: Wallet or owner not found
 * - 401: Unauthorized
 * - 500: Server error
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { type Address, serializeTransaction, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum, base, bsc, polygon, optimism, type Chain } from 'viem/chains';
import { PrismaClient } from '@midcurve/database';
import {
  withInternalAuth,
  parseJsonBody,
  type AuthenticatedRequest,
} from '@/middleware/internal-auth';
import {
  automationWalletService,
  AutomationWalletServiceError,
} from '@/services/automation-wallet-service';
import { signerLogger } from '@/lib/logger';

const prisma = new PrismaClient();

/**
 * Request body schema
 */
const SignRefundRequestSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address'),
  chainId: z.number().int().positive(),
  amount: z.string().regex(/^\d+$/, 'Amount must be a numeric string (wei)'),
  nonce: z.number().int().min(0),
  gasLimit: z.string().regex(/^\d+$/, 'Gas limit must be a numeric string'),
  maxFeePerGas: z.string().regex(/^\d+$/, 'Max fee per gas must be a numeric string'),
  maxPriorityFeePerGas: z.string().regex(/^\d+$/, 'Max priority fee must be a numeric string'),
});

type SignRefundRequest = z.infer<typeof SignRefundRequestSchema>;

/**
 * Chain configurations (only for chain metadata, no RPC)
 */
const CHAIN_CONFIGS: Record<number, Chain> = {
  1: mainnet,
  42161: arbitrum,
  8453: base,
  56: bsc,
  137: polygon,
  10: optimism,
};

/**
 * POST /api/automation/sign-refund
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;
  const logger = signerLogger.child({ service: 'sign-refund', requestId });

  // Parse body
  const bodyResult = await parseJsonBody<SignRefundRequest>(request);
  if (!bodyResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'INVALID_REQUEST',
        message: bodyResult.error,
        requestId,
      },
      { status: 400 }
    );
  }

  // Validate body
  const validation = SignRefundRequestSchema.safeParse(bodyResult.data);
  if (!validation.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'VALIDATION_ERROR',
        message: validation.error.issues.map((i) => i.message).join(', '),
        requestId,
      },
      { status: 400 }
    );
  }

  const {
    walletAddress,
    chainId,
    amount,
    nonce,
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
  } = validation.data;

  logger.info({ walletAddress, chainId, amount, nonce }, 'Processing sign-refund request');

  // Check chain support
  const chain = CHAIN_CONFIGS[chainId];
  if (!chain) {
    return NextResponse.json(
      {
        success: false,
        error: 'CHAIN_NOT_SUPPORTED',
        message: `Chain ${chainId} is not supported`,
        requestId,
      },
      { status: 400 }
    );
  }

  try {
    // 1. Look up wallet by address
    const wallet = await automationWalletService.getWalletByAddress(walletAddress);
    if (!wallet) {
      return NextResponse.json(
        {
          success: false,
          error: 'WALLET_NOT_FOUND',
          message: `Automation wallet ${walletAddress} not found`,
          requestId,
        },
        { status: 404 }
      );
    }

    // 2. Look up owner's primary wallet address from database
    const ownerWallet = await prisma.authWalletAddress.findFirst({
      where: {
        userId: wallet.userId,
        isPrimary: true,
      },
    });

    if (!ownerWallet) {
      logger.error({ userId: wallet.userId }, 'Owner has no primary wallet address');
      return NextResponse.json(
        {
          success: false,
          error: 'OWNER_WALLET_NOT_FOUND',
          message: 'Owner does not have a primary wallet address configured',
          requestId,
        },
        { status: 404 }
      );
    }

    const toAddress = ownerWallet.address as Address;
    logger.info({ walletAddress, toAddress, amount }, 'Signing refund to owner');

    // 3. Get private key for the automation wallet
    const privateKey = await automationWalletService.getPrivateKey(wallet.id);
    const account = privateKeyToAccount(privateKey);

    // Verify the account address matches
    if (account.address.toLowerCase() !== walletAddress.toLowerCase()) {
      logger.error(
        { expected: walletAddress, actual: account.address },
        'Wallet address mismatch'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'WALLET_ADDRESS_MISMATCH',
          message: 'Wallet address does not match stored key',
          requestId,
        },
        { status: 500 }
      );
    }

    // 4. Build and sign the transaction (EIP-1559)
    const tx = {
      type: 'eip1559' as const,
      chainId,
      nonce,
      to: toAddress,
      value: BigInt(amount),
      gas: BigInt(gasLimit),
      maxFeePerGas: BigInt(maxFeePerGas),
      maxPriorityFeePerGas: BigInt(maxPriorityFeePerGas),
      data: '0x' as const, // Simple ETH transfer, no data
    };

    // Serialize the unsigned transaction
    const serializedUnsigned = serializeTransaction(tx);
    const txHash = keccak256(serializedUnsigned);

    // Sign the transaction
    const signature = await account.signTransaction(tx);

    logger.info(
      { txHash, to: toAddress, amount, nonce },
      'Refund transaction signed successfully'
    );

    // 5. Update last used timestamp
    await automationWalletService.updateLastUsed(wallet.id);

    // 6. Return signed transaction and owner address
    return NextResponse.json({
      success: true,
      data: {
        signedTransaction: signature,
        to: toAddress,
        from: walletAddress,
      },
      requestId,
    });
  } catch (error) {
    logger.error({ error }, 'Sign-refund failed');

    if (error instanceof AutomationWalletServiceError) {
      return NextResponse.json(
        {
          success: false,
          error: error.code,
          message: error.message,
          requestId,
        },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'SIGNING_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
        requestId,
      },
      { status: 500 }
    );
  }
});
