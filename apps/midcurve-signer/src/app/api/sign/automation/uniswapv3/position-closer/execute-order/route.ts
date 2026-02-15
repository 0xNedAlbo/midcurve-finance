/**
 * POST /api/sign/automation/uniswapv3/position-closer/execute-order
 *
 * Sign an executeOrder() transaction for a UniswapV3PositionCloser contract.
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
 *     nftId: string (bigint as string),
 *     triggerMode: number (0=LOWER, 1=UPPER),
 *     feeRecipient: string,
 *     feeBps: number (0-100, max 1%),
 *     gasLimit: string (bigint as string),
 *     gasPrice: string (bigint as string),
 *     nonce: number (required, caller fetches from chain),
 *     swapParams?: {
 *       minAmountOut: string (minimum output amount for slippage protection),
 *       deadline: number (unix timestamp or 0),
 *       hops: Array<{
 *         venueId: string (bytes32 hex),
 *         tokenIn: string (address),
 *         tokenOut: string (address),
 *         venueData: string (hex-encoded venue data)
 *       }>
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

const logger = signerLogger.child({ endpoint: 'sign-automation-execute-order' });

/**
 * Hop schema for MidcurveSwapRouter route
 */
const HopSchema = z.object({
  venueId: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid venueId (must be bytes32)'),
  tokenIn: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid tokenIn address'),
  tokenOut: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid tokenOut address'),
  venueData: z.string().regex(/^0x[a-fA-F0-9]*$/, 'Invalid venueData'),
});

/**
 * Swap params schema for executeOrder with post-close swap via MidcurveSwapRouter
 */
const SwapParamsSchema = z.object({
  minAmountOut: z.string().regex(/^\d+$/, 'minAmountOut must be numeric string'),
  deadline: z.number().int().nonnegative('deadline must be non-negative'),
  hops: z.array(HopSchema).min(1, 'At least one hop is required'),
});

/**
 * Request body schema
 *
 * Gas parameters are provided as strings and transformed to BigInt.
 * This allows JSON transport of bigint values.
 */
const SignExecuteOrderSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  chainId: z.number().int().positive('chainId must be a positive integer'),
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
  nftId: z.string().regex(/^\d+$/, 'nftId must be a numeric string').transform((val) => BigInt(val)),
  triggerMode: z.number().int().min(0).max(1, 'triggerMode must be 0 (LOWER) or 1 (UPPER)'),
  feeRecipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid fee recipient address'),
  feeBps: z.number().int().min(0).max(100, 'feeBps must be 0-100 (max 1%)'),
  // Gas parameters from caller (signer does not access RPC)
  gasLimit: z.string().min(1, 'gasLimit is required').transform((val) => BigInt(val)),
  gasPrice: z.string().min(1, 'gasPrice is required').transform((val) => BigInt(val)),
  // Nonce is required - caller fetches from chain (signer is stateless)
  nonce: z.number().int().nonnegative('nonce is required'),
  // Optional swap params for post-close swap via MidcurveSwapRouter
  swapParams: SwapParamsSchema.optional(),
});

type SignExecuteOrderRequest = z.infer<typeof SignExecuteOrderSchema>;

/**
 * POST /api/sign/automation/uniswapv3/position-closer/execute-order
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  // 1. Parse request body
  const bodyResult = await parseJsonBody<SignExecuteOrderRequest>(request);
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
  const validation = SignExecuteOrderSchema.safeParse(bodyResult.data);
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

  const { userId, chainId, contractAddress, nftId, triggerMode, feeRecipient, feeBps, gasLimit, gasPrice, nonce, swapParams } = validation.data;

  logger.info({
    requestId,
    userId,
    chainId,
    contractAddress,
    nftId: nftId.toString(),
    triggerMode,
    feeBps,
    gasLimit: gasLimit.toString(),
    gasPrice: gasPrice.toString(),
    explicitNonce: nonce,
    hasSwap: !!swapParams,
    msg: 'Processing execute-order signing request',
  });

  try {
    // 3. Sign executeOrder transaction
    const result = await automationSigningService.signExecuteOrder({
      userId,
      chainId,
      contractAddress: contractAddress as Address,
      nftId,
      triggerMode,
      feeRecipient: feeRecipient as Address,
      feeBps,
      gasLimit,
      gasPrice,
      nonce,
      swapParams: swapParams
        ? {
            minAmountOut: swapParams.minAmountOut,
            deadline: swapParams.deadline,
            hops: swapParams.hops.map((hop) => ({
              venueId: hop.venueId,
              tokenIn: hop.tokenIn as Address,
              tokenOut: hop.tokenOut as Address,
              venueData: hop.venueData as `0x${string}`,
            })),
          }
        : undefined,
    });

    logger.info({
      requestId,
      userId,
      chainId,
      contractAddress,
      nftId: nftId.toString(),
      triggerMode,
      nonce: result.nonce,
      msg: 'Execute-order transaction signed successfully',
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
        msg: 'Execute-order signing failed with known error',
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
      msg: 'Unexpected error during execute-order signing',
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
