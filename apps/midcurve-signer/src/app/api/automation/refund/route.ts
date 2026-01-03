/**
 * POST /api/automation/refund - Refund Gas from Automation Wallet
 *
 * Signs and broadcasts an ETH transfer from the automation wallet
 * back to the user's wallet.
 *
 * Request:
 * - Authorization: X-Internal-API-Key header
 * - Body: { requestId, userId, chainId, amount, toAddress }
 *
 * Response:
 * - 200: { success: true, data: { operationStatus, txHash? } }
 * - 400: Invalid request or insufficient balance
 * - 404: Wallet not found
 * - 401: Unauthorized
 * - 500: Server error
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum, base, bsc, polygon, optimism, type Chain } from 'viem/chains';
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

/**
 * Request body schema
 */
const RefundRequestSchema = z.object({
  requestId: z.string().min(1),
  userId: z.string().min(1),
  chainId: z.number().int().positive(),
  amount: z.string().regex(/^\d+$/, 'Amount must be a numeric string'),
  toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
});

type RefundRequest = z.infer<typeof RefundRequestSchema>;

/**
 * Chain configurations
 */
const CHAIN_CONFIGS: Record<number, { chain: Chain; rpcEnvVar: string }> = {
  1: { chain: mainnet, rpcEnvVar: 'RPC_URL_ETHEREUM' },
  42161: { chain: arbitrum, rpcEnvVar: 'RPC_URL_ARBITRUM' },
  8453: { chain: base, rpcEnvVar: 'RPC_URL_BASE' },
  56: { chain: bsc, rpcEnvVar: 'RPC_URL_BSC' },
  137: { chain: polygon, rpcEnvVar: 'RPC_URL_POLYGON' },
  10: { chain: optimism, rpcEnvVar: 'RPC_URL_OPTIMISM' },
};

/**
 * POST /api/automation/refund
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId: ctxRequestId, request } = ctx;
  const logger = signerLogger.child({ service: 'automation-refund' });

  // Parse body
  const bodyResult = await parseJsonBody<RefundRequest>(request);
  if (!bodyResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'INVALID_REQUEST',
        message: bodyResult.error,
        requestId: ctxRequestId,
      },
      { status: 400 }
    );
  }

  // Validate body
  const validation = RefundRequestSchema.safeParse(bodyResult.data);
  if (!validation.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'VALIDATION_ERROR',
        message: validation.error.issues.map((i) => i.message).join(', '),
        requestId: ctxRequestId,
      },
      { status: 400 }
    );
  }

  const { requestId, userId, chainId, amount, toAddress } = validation.data;

  logger.info({ requestId, userId, chainId, toAddress }, 'Processing refund request');

  // Check chain support
  const chainConfig = CHAIN_CONFIGS[chainId];
  if (!chainConfig) {
    return NextResponse.json(
      {
        success: false,
        error: 'CHAIN_NOT_SUPPORTED',
        message: `Chain ${chainId} is not supported`,
        requestId: ctxRequestId,
      },
      { status: 400 }
    );
  }

  const rpcUrl = process.env[chainConfig.rpcEnvVar];
  if (!rpcUrl) {
    return NextResponse.json(
      {
        success: false,
        error: 'RPC_NOT_CONFIGURED',
        message: `RPC URL not configured for chain ${chainId}`,
        requestId: ctxRequestId,
      },
      { status: 500 }
    );
  }

  try {
    // Get wallet
    const wallet = await automationWalletService.getWalletByUserId(userId);

    if (!wallet) {
      return NextResponse.json(
        {
          success: false,
          error: 'WALLET_NOT_FOUND',
          message: 'No automation wallet found for this user',
          requestId: ctxRequestId,
        },
        { status: 404 }
      );
    }

    // Create clients
    const publicClient = createPublicClient({
      chain: chainConfig.chain,
      transport: http(rpcUrl),
    });

    // Check balance
    const balance = await publicClient.getBalance({ address: wallet.walletAddress });
    const refundAmount = BigInt(amount);

    if (balance < refundAmount) {
      return NextResponse.json(
        {
          success: false,
          error: 'INSUFFICIENT_BALANCE',
          message: `Insufficient balance. Available: ${balance.toString()}, Requested: ${amount}`,
          requestId: ctxRequestId,
        },
        { status: 400 }
      );
    }

    // Get private key
    const privateKey = await automationWalletService.getPrivateKey(wallet.id);
    const account = privateKeyToAccount(privateKey);

    // Create wallet client
    const walletClient = createWalletClient({
      account,
      chain: chainConfig.chain,
      transport: http(rpcUrl),
    });

    // Estimate gas and get gas price
    const gasPrice = await publicClient.getGasPrice();
    const gasEstimate = await publicClient.estimateGas({
      account: wallet.walletAddress,
      to: toAddress as Address,
      value: refundAmount,
    });
    const gasLimit = (gasEstimate * 120n) / 100n; // 20% buffer
    const gasCost = gasLimit * gasPrice;

    // Ensure we have enough for gas
    if (balance < refundAmount + gasCost) {
      // Adjust amount to account for gas
      const adjustedAmount = balance - gasCost;
      if (adjustedAmount <= 0n) {
        return NextResponse.json(
          {
            success: false,
            error: 'INSUFFICIENT_FOR_GAS',
            message: 'Balance insufficient to cover gas costs',
            requestId: ctxRequestId,
          },
          { status: 400 }
        );
      }

      logger.info(
        {
          requestId,
          originalAmount: amount,
          adjustedAmount: adjustedAmount.toString(),
        },
        'Adjusted refund amount to account for gas'
      );
    }

    // Send transaction
    const txHash = await walletClient.sendTransaction({
      to: toAddress as Address,
      value: refundAmount,
      gas: gasLimit,
      gasPrice,
    });

    logger.info({ requestId, txHash, amount }, 'Refund transaction sent');

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 1,
    });

    logger.info(
      { requestId, txHash, status: receipt.status },
      'Refund transaction confirmed'
    );

    // Update last used
    await automationWalletService.updateLastUsed(wallet.id);

    return NextResponse.json({
      success: true,
      data: {
        operationStatus: receipt.status === 'success' ? 'completed' : 'failed',
        txHash,
      },
      requestId: ctxRequestId,
    });
  } catch (error) {
    logger.error({ error, requestId }, 'Refund failed');

    if (error instanceof AutomationWalletServiceError) {
      return NextResponse.json(
        {
          success: false,
          error: error.code,
          message: error.message,
          requestId: ctxRequestId,
        },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'REFUND_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
        requestId: ctxRequestId,
      },
      { status: 500 }
    );
  }
});
