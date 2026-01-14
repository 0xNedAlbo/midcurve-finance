/**
 * POST /api/sign/automation/execute-close - Sign Close Order Execution
 *
 * Signs an executeClose() transaction for a UniswapV3PositionCloser contract.
 * Does NOT broadcast the transaction - that is handled by the caller.
 *
 * Called by the automation service when a price trigger is met.
 *
 * Gas parameters (gasLimit, gasPrice) and nonce must be provided by the caller.
 * This keeps the signer stateless and isolated from external RPC endpoints.
 * The caller is responsible for fetching the on-chain nonce.
 *
 * Prerequisites:
 * - User must have an automation wallet
 * - Close order must be registered and active
 * - Price condition must be met
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Body: {
 *     userId: string,
 *     chainId: number,
 *     contractAddress: string,
 *     closeId: number,
 *     feeRecipient: string,
 *     feeBps: number (0-100, max 1%),
 *     gasLimit: string (bigint as string),
 *     gasPrice: string (bigint as string),
 *     nonce: number (required, caller fetches from chain),
 *     swapParams?: {
 *       augustus: string (swap contract address),
 *       swapCalldata: string (hex-encoded calldata),
 *       deadline: number (unix timestamp or 0),
 *       minAmountOut: string (minimum output amount for slippage protection)
 *     }
 *   }
 *
 * Response (Success):
 * - 200: {
 *     success: true,
 *     data: {
 *       signedTransaction: string,
 *       nonce: number,
 *       txHash: string,
 *       from: string
 *     }
 *   }
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  withInternalAuth,
  parseJsonBody,
  type AuthenticatedRequest,
} from '@/middleware/internal-auth';
import {
  automationSigningService,
  AutomationSigningError,
} from '@/services/automation-signing-service';
import { signerLogger } from '@/lib/logger';
import type { Address } from 'viem';

const logger = signerLogger.child({ endpoint: 'sign-automation-execute-close' });

/**
 * Request body schema
 *
 * Gas parameters are provided as strings and transformed to BigInt.
 * This allows JSON transport of bigint values.
 */
/**
 * Swap params schema for executeClose with post-close swap
 */
const SwapParamsSchema = z.object({
  augustus: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid augustus address'),
  swapCalldata: z.string().regex(/^0x[a-fA-F0-9]*$/, 'Invalid swap calldata'),
  deadline: z.number().int().nonnegative('deadline must be non-negative'),
  minAmountOut: z.string().regex(/^\d+$/, 'minAmountOut must be numeric string'),
});

const SignExecuteCloseSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  chainId: z.number().int().positive('chainId must be a positive integer'),
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
  closeId: z.number().int().nonnegative('closeId must be a non-negative integer'),
  feeRecipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid fee recipient address'),
  feeBps: z.number().int().min(0).max(100, 'feeBps must be 0-100 (max 1%)'),
  // Gas parameters from caller (signer does not access RPC)
  gasLimit: z.string().min(1, 'gasLimit is required').transform((val) => BigInt(val)),
  gasPrice: z.string().min(1, 'gasPrice is required').transform((val) => BigInt(val)),
  // Nonce is required - caller fetches from chain (signer is stateless)
  nonce: z.number().int().nonnegative('nonce is required'),
  // Optional swap params for post-close swap via Paraswap
  swapParams: SwapParamsSchema.optional(),
});

type SignExecuteCloseRequest = z.infer<typeof SignExecuteCloseSchema>;

/**
 * POST /api/sign/automation/execute-close
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  // 1. Parse request body
  const bodyResult = await parseJsonBody<SignExecuteCloseRequest>(request);
  if (!bodyResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: bodyResult.error,
        },
        requestId,
      },
      { status: 400 }
    );
  }

  // 2. Validate request schema
  const validation = SignExecuteCloseSchema.safeParse(bodyResult.data);
  if (!validation.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: validation.error.issues.map((i) => i.message).join(', '),
        },
        requestId,
      },
      { status: 400 }
    );
  }

  const { userId, chainId, contractAddress, closeId, feeRecipient, feeBps, gasLimit, gasPrice, nonce, swapParams } = validation.data;

  logger.info({
    requestId,
    userId,
    chainId,
    contractAddress,
    closeId,
    feeBps,
    gasLimit: gasLimit.toString(),
    gasPrice: gasPrice.toString(),
    explicitNonce: nonce,
    hasSwap: !!swapParams,
    msg: 'Processing execute-close signing request',
  });

  try {
    // 3. Sign executeClose transaction
    const result = await automationSigningService.signExecuteClose({
      userId,
      chainId,
      contractAddress: contractAddress as Address,
      closeId,
      feeRecipient: feeRecipient as Address,
      feeBps,
      gasLimit,
      gasPrice,
      nonce,
      swapParams: swapParams
        ? {
            augustus: swapParams.augustus as Address,
            swapCalldata: swapParams.swapCalldata as `0x${string}`,
            deadline: swapParams.deadline,
            minAmountOut: swapParams.minAmountOut,
          }
        : undefined,
    });

    logger.info({
      requestId,
      userId,
      chainId,
      contractAddress,
      closeId,
      nonce: result.nonce,
      msg: 'Execute-close transaction signed successfully',
    });

    return NextResponse.json({
      success: true,
      data: {
        signedTransaction: result.signedTransaction,
        nonce: result.nonce,
        txHash: result.txHash,
        from: result.from,
      },
      requestId,
    });
  } catch (error) {
    // Handle known signing errors
    if (error instanceof AutomationSigningError) {
      logger.warn({
        requestId,
        userId,
        chainId,
        errorCode: error.code,
        errorMessage: error.message,
        msg: 'Execute-close signing failed with known error',
      });

      return NextResponse.json(
        {
          success: false,
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          requestId,
        },
        { status: error.statusCode }
      );
    }

    // Handle unexpected errors
    logger.error({
      requestId,
      userId,
      chainId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      msg: 'Unexpected error during execute-close signing',
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred during signing',
        },
        requestId,
      },
      { status: 500 }
    );
  }
});
