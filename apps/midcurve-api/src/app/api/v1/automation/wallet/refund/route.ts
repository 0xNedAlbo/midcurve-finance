/**
 * Automation Wallet Refund API Endpoint
 *
 * POST /api/v1/automation/wallet/refund - Request refund of gas from autowallet
 *
 * Architecture:
 * - API handles all RPC operations (balance, nonce, gas, broadcast)
 * - Signer only signs the transaction (no external network access)
 * - Owner address is determined by signer from database (not passed by caller)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createPublicClient,
  http,
  type Address,
  type Hex,
} from 'viem';
import { mainnet, arbitrum, base, bsc, polygon, optimism, type Chain } from 'viem/chains';
import { withSessionAuth } from '@/middleware/with-session-auth';
import {
  createSuccessResponse,
  createErrorResponse,
  ApiErrorCode,
  RefundAutowalletRequestSchema,
  type RefundAutowalletResponse,
} from '@midcurve/api-shared';
import { apiLogger, apiLog } from '@/lib/logger';
import { createPreflightResponse } from '@/lib/cors';
import { storeRefundOperation } from '@/lib/refund-store';
import { nanoid } from 'nanoid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Signer service URL
const SIGNER_URL = process.env.SIGNER_URL || 'http://localhost:3003';
const SIGNER_INTERNAL_API_KEY = process.env.SIGNER_INTERNAL_API_KEY || '';

/**
 * Chain configurations with RPC URLs
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
 * Handle CORS preflight
 */
export async function OPTIONS(request: NextRequest): Promise<Response> {
  return createPreflightResponse(request.headers.get('origin'));
}

/**
 * POST /api/v1/automation/wallet/refund
 *
 * Request refund of gas from autowallet back to user's wallet.
 * The destination is the user's primary wallet (determined by signer from DB).
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withSessionAuth(request, async (user, requestId) => {
    const startTime = Date.now();

    try {
      // Parse JSON body
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid JSON in request body'
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      // Validate request
      const validation = RefundAutowalletRequestSchema.safeParse(body);
      if (!validation.success) {
        apiLog.validationError(apiLogger, requestId, validation.error.errors);
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          'Invalid request body',
          validation.error.errors
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      const { chainId, amount } = validation.data;

      // Log business operation
      apiLog.businessOperation(
        apiLogger,
        requestId,
        'refund',
        'autowallet',
        user.id,
        { chainId, amount }
      );

      // Check chain support and get RPC URL
      const chainConfig = CHAIN_CONFIGS[chainId];
      if (!chainConfig) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          `Chain ${chainId} is not supported`
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      const rpcUrl = process.env[chainConfig.rpcEnvVar];
      if (!rpcUrl) {
        apiLogger.error({ chainId, rpcEnvVar: chainConfig.rpcEnvVar }, 'RPC URL not configured');
        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          `RPC not configured for chain ${chainId}`
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      // 1. Get user's automation wallet address from signer
      const walletResponse = await fetch(
        `${SIGNER_URL}/api/wallets/automation?userId=${encodeURIComponent(user.id)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${SIGNER_INTERNAL_API_KEY}`,
          },
        }
      );

      if (!walletResponse.ok) {
        const errorText = await walletResponse.text();
        apiLogger.error({ status: walletResponse.status, error: errorText }, 'Failed to get wallet');
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          'Automation wallet not found'
        );
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 404 });
      }

      const walletData = await walletResponse.json();
      if (!walletData.wallet) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.NOT_FOUND,
          'No automation wallet found for this user'
        );
        apiLog.requestEnd(apiLogger, requestId, 404, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 404 });
      }

      const walletAddress = walletData.wallet.walletAddress as Address;

      // 2. Create public client to fetch chain data
      const publicClient = createPublicClient({
        chain: chainConfig.chain,
        transport: http(rpcUrl),
      });

      // 3. Fetch balance, nonce, and gas prices
      const [balance, nonce, feeData] = await Promise.all([
        publicClient.getBalance({ address: walletAddress }),
        publicClient.getTransactionCount({ address: walletAddress }),
        publicClient.estimateFeesPerGas(),
      ]);

      const refundAmount = BigInt(amount);

      // Check balance
      if (balance < refundAmount) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          `Insufficient balance. Available: ${balance.toString()}, Requested: ${amount}`
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      // Estimate gas for a simple ETH transfer (21000 is standard)
      const gasLimit = 21000n;
      const maxFeePerGas = feeData.maxFeePerGas ?? 0n;
      const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 0n;
      const gasCost = gasLimit * maxFeePerGas;

      // Check if balance covers amount + gas
      if (balance < refundAmount + gasCost) {
        const errorResponse = createErrorResponse(
          ApiErrorCode.VALIDATION_ERROR,
          `Insufficient balance for amount + gas. Available: ${balance.toString()}, Required: ${(refundAmount + gasCost).toString()}`
        );
        apiLog.requestEnd(apiLogger, requestId, 400, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 400 });
      }

      // 4. Call signer to get signed transaction
      const signResponse = await fetch(`${SIGNER_URL}/api/automation/sign-refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SIGNER_INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({
          walletAddress,
          chainId,
          amount,
          nonce,
          gasLimit: gasLimit.toString(),
          maxFeePerGas: maxFeePerGas.toString(),
          maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
        }),
      });

      if (!signResponse.ok) {
        const errorText = await signResponse.text();
        apiLogger.error({ status: signResponse.status, error: errorText }, 'Failed to sign refund');

        // Parse error for better messaging
        let errorMessage = 'Failed to sign refund transaction';
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.message || errorMessage;
        } catch {
          // Keep default message
        }

        const errorResponse = createErrorResponse(
          ApiErrorCode.INTERNAL_SERVER_ERROR,
          errorMessage
        );
        apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
        return NextResponse.json(errorResponse, { status: 500 });
      }

      const signData = await signResponse.json();
      const signedTransaction = signData.data.signedTransaction as Hex;
      const toAddress = signData.data.to as Address;

      apiLogger.info(
        { walletAddress, toAddress, amount, nonce },
        'Transaction signed, broadcasting...'
      );

      // 5. Broadcast the signed transaction
      const txHash = await publicClient.sendRawTransaction({
        serializedTransaction: signedTransaction,
      });

      apiLogger.info({ txHash }, 'Refund transaction broadcast');

      // 6. Wait for confirmation (with timeout)
      let receipt;
      try {
        receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
          confirmations: 1,
          timeout: 60_000, // 60 second timeout
        });
      } catch (error) {
        // Transaction might still succeed, return pending status
        apiLogger.warn({ txHash, error }, 'Timeout waiting for confirmation');
      }

      const operationStatus = receipt?.status === 'success'
        ? 'completed'
        : receipt?.status === 'reverted'
          ? 'failed'
          : 'pending';

      // Generate request ID for tracking
      const refundRequestId = nanoid();
      const pollUrl = `/api/v1/automation/wallet/refund/${refundRequestId}`;

      // Store the operation for polling
      storeRefundOperation({
        requestId: refundRequestId,
        chainId,
        amount,
        toAddress,
        operationStatus,
        txHash,
        createdAt: new Date(),
      });

      // Return success response
      const response: RefundAutowalletResponse = createSuccessResponse({
        requestId: refundRequestId,
        chainId,
        amount,
        toAddress,
        operationStatus,
        txHash,
        pollUrl,
      });

      const statusCode = operationStatus === 'completed' ? 200 : 202;
      apiLog.requestEnd(apiLogger, requestId, statusCode, Date.now() - startTime);
      return NextResponse.json(response, {
        status: statusCode,
        headers: operationStatus !== 'completed' ? { Location: pollUrl } : undefined,
      });
    } catch (error) {
      apiLog.methodError(
        apiLogger,
        'POST /api/v1/automation/wallet/refund',
        error,
        { requestId }
      );
      const errorResponse = createErrorResponse(
        ApiErrorCode.INTERNAL_SERVER_ERROR,
        error instanceof Error ? error.message : 'Failed to process refund'
      );
      apiLog.requestEnd(apiLogger, requestId, 500, Date.now() - startTime);
      return NextResponse.json(errorResponse, { status: 500 });
    }
  });
}
