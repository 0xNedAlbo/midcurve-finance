/**
 * POST /api/sign/automation/treasury/refuel-operator
 *
 * Sign a refuelOperator() transaction for a MidcurveTreasury contract.
 * Does NOT broadcast the transaction - that is handled by the caller.
 *
 * Called by the business logic service to refuel the operator wallet with ETH
 * from fee tokens accumulated in the treasury.
 *
 * Gas parameters (gasLimit, gasPrice) and nonce must be provided by the caller.
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

const logger = signerLogger.child({ endpoint: 'sign-automation-refuel-operator' });

const HopSchema = z.object({
  venueId: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid venueId (must be bytes32)'),
  tokenIn: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid tokenIn address'),
  tokenOut: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid tokenOut address'),
  venueData: z.string().regex(/^0x[a-fA-F0-9]*$/, 'Invalid venueData'),
});

const SignRefuelOperatorSchema = z.object({
  chainId: z.number().int().positive('chainId must be a positive integer'),
  treasuryAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid treasury address'),
  tokenIn: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid tokenIn address'),
  amountIn: z.string().min(1, 'amountIn is required').transform((val) => BigInt(val)),
  minEthOut: z.string().min(1, 'minEthOut is required').transform((val) => BigInt(val)),
  deadline: z.number().int().nonnegative('deadline must be non-negative'),
  hops: z.array(HopSchema),
  gasLimit: z.string().min(1, 'gasLimit is required').transform((val) => BigInt(val)),
  gasPrice: z.string().min(1, 'gasPrice is required').transform((val) => BigInt(val)),
  nonce: z.number().int().nonnegative('nonce is required'),
});

type SignRefuelOperatorRequest = z.infer<typeof SignRefuelOperatorSchema>;

/**
 * POST /api/sign/automation/treasury/refuel-operator
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  const bodyResult = await parseJsonBody<SignRefuelOperatorRequest>(request);
  if (!bodyResult.success) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_REQUEST', message: bodyResult.error }, requestId },
      { status: 400 }
    );
  }

  const validation = SignRefuelOperatorSchema.safeParse(bodyResult.data);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: validation.error.issues.map((i) => i.message).join(', ') }, requestId },
      { status: 400 }
    );
  }

  const { chainId, treasuryAddress, tokenIn, amountIn, minEthOut, deadline, hops, gasLimit, gasPrice, nonce } = validation.data;

  logger.info({
    requestId,
    chainId,
    treasuryAddress,
    tokenIn,
    amountIn: amountIn.toString(),
    nonce,
    hopCount: hops.length,
    msg: 'Processing refuel-operator signing request',
  });

  try {
    const result = await automationSigningService.signRefuelOperator({
      chainId,
      treasuryAddress: treasuryAddress as Address,
      tokenIn: tokenIn as Address,
      amountIn,
      minEthOut,
      deadline,
      hops: hops.map((hop) => ({
        venueId: hop.venueId,
        tokenIn: hop.tokenIn as Address,
        tokenOut: hop.tokenOut as Address,
        venueData: hop.venueData as `0x${string}`,
      })),
      gasLimit,
      gasPrice,
      nonce,
    });

    logger.info({
      requestId,
      chainId,
      treasuryAddress,
      nonce: result.nonce,
      msg: 'refuelOperator transaction signed successfully',
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
    if (error instanceof AutomationSigningError) {
      logger.warn({
        requestId,
        chainId,
        errorCode: error.code,
        errorMessage: error.message,
        msg: 'refuel-operator signing failed with known error',
      });

      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message, details: error.details }, requestId },
        { status: error.statusCode }
      );
    }

    logger.error({
      requestId,
      chainId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      msg: 'Unexpected error during refuel-operator signing',
    });

    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred during signing' }, requestId },
      { status: 500 }
    );
  }
});
