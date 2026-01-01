/**
 * POST /api/sign/automation/register-close - Sign Close Order Registration
 *
 * Signs a registerClose() transaction for a UniswapV3PositionCloser contract.
 * Does NOT broadcast the transaction - that is handled by the caller.
 *
 * Prerequisites:
 * - User must have an automation wallet
 * - Contract must be deployed
 * - NFT must be approved for transfer to the contract
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Body: {
 *     userId: string,
 *     chainId: number,
 *     contractAddress: string,
 *     nftId: string,             // bigint as string
 *     sqrtPriceX96Lower: string, // bigint as string
 *     sqrtPriceX96Upper: string, // bigint as string
 *     payoutAddress: string,
 *     validUntil: string,        // bigint as string (unix timestamp)
 *     slippageBps: number
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

const logger = signerLogger.child({ endpoint: 'sign-automation-register-close' });

/**
 * Request body schema
 */
const SignRegisterCloseSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  chainId: z.number().int().positive('chainId must be a positive integer'),
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
  nftId: z.string().min(1, 'nftId is required'),
  sqrtPriceX96Lower: z.string().min(1, 'sqrtPriceX96Lower is required'),
  sqrtPriceX96Upper: z.string().min(1, 'sqrtPriceX96Upper is required'),
  payoutAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid payout address'),
  validUntil: z.string().min(1, 'validUntil is required'),
  slippageBps: z.number().int().min(0).max(10000, 'slippageBps must be 0-10000'),
});

type SignRegisterCloseRequest = z.infer<typeof SignRegisterCloseSchema>;

/**
 * POST /api/sign/automation/register-close
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  // 1. Parse request body
  const bodyResult = await parseJsonBody<SignRegisterCloseRequest>(request);
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
  const validation = SignRegisterCloseSchema.safeParse(bodyResult.data);
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

  const {
    userId,
    chainId,
    contractAddress,
    nftId,
    sqrtPriceX96Lower,
    sqrtPriceX96Upper,
    payoutAddress,
    validUntil,
    slippageBps,
  } = validation.data;

  logger.info({
    requestId,
    userId,
    chainId,
    contractAddress,
    nftId,
    msg: 'Processing register-close signing request',
  });

  try {
    // 3. Sign registerClose transaction
    const result = await automationSigningService.signRegisterClose({
      userId,
      chainId,
      contractAddress: contractAddress as Address,
      nftId: BigInt(nftId),
      sqrtPriceX96Lower: BigInt(sqrtPriceX96Lower),
      sqrtPriceX96Upper: BigInt(sqrtPriceX96Upper),
      payoutAddress: payoutAddress as Address,
      validUntil: BigInt(validUntil),
      slippageBps,
    });

    logger.info({
      requestId,
      userId,
      chainId,
      contractAddress,
      nftId,
      nonce: result.nonce,
      msg: 'Register-close transaction signed successfully',
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
        msg: 'Register-close signing failed with known error',
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
      msg: 'Unexpected error during register-close signing',
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
