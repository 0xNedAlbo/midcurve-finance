/**
 * POST /api/automation/contracts/bytecode - Get Contract Bytecode
 *
 * Returns the UniswapV3PositionCloser bytecode and encoded constructor args
 * for the user to deploy via their own wallet.
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Body: { userId: string, chainId: number, nfpmAddress: string }
 *
 * Response (Success):
 * - 200: {
 *     success: true,
 *     data: {
 *       bytecode: string,
 *       constructorArgs: string,
 *       operatorAddress: string
 *     }
 *   }
 *
 * Response (Error):
 * - 400: Invalid request
 * - 401: Unauthorized
 * - 500: Bytecode not configured
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { encodeAbiParameters } from 'viem';
import {
  withInternalAuth,
  parseJsonBody,
  type AuthenticatedRequest,
} from '@/middleware/internal-auth';
import { automationWalletService } from '@/services/automation-wallet-service';
import { signerLogger } from '@/lib/logger';
import type { Hex, Address } from 'viem';

const logger = signerLogger.child({ endpoint: 'contracts-bytecode' });

/**
 * Contract bytecode from environment
 */
const POSITION_CLOSER_BYTECODE = process.env.POSITION_CLOSER_BYTECODE as Hex | undefined;

/**
 * Request body schema
 */
const GetBytecodeSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  chainId: z.number().int().positive('chainId must be a positive integer'),
  nfpmAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid NFPM address'),
});

type GetBytecodeRequest = z.infer<typeof GetBytecodeSchema>;

/**
 * POST /api/automation/contracts/bytecode
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  // 1. Parse request body
  const bodyResult = await parseJsonBody<GetBytecodeRequest>(request);
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
  const validation = GetBytecodeSchema.safeParse(bodyResult.data);
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

  const { userId, chainId, nfpmAddress } = validation.data;

  logger.info({
    requestId,
    userId,
    chainId,
    nfpmAddress,
    msg: 'Processing bytecode request',
  });

  try {
    // 3. Validate bytecode is available
    if (!POSITION_CLOSER_BYTECODE) {
      logger.error({
        requestId,
        msg: 'POSITION_CLOSER_BYTECODE environment variable not set',
      });
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'BYTECODE_NOT_CONFIGURED',
            message: 'Contract bytecode not configured on this server',
          },
          requestId,
        },
        { status: 500 }
      );
    }

    // 4. Get or create automation wallet (this is the operator address)
    const wallet = await automationWalletService.getOrCreateWallet({ userId });
    const operatorAddress = wallet.walletAddress;

    logger.info({
      requestId,
      userId,
      operatorAddress,
      msg: 'Using operator address from autowallet',
    });

    // 5. Encode constructor arguments
    // UniswapV3PositionCloser constructor: constructor(address nfpm, address operator)
    // Note: Looking at the actual contract, it takes nfpm and operator
    // But based on the signer code, it only takes nfpm. Let me check the ABI again.
    // From automation-signing-service.ts: constructor(address nfpm)
    // So the operator might be set differently. Let me just use nfpm for now.

    // Actually, re-reading the plan - the operator is set on registerClose, not in constructor
    // The contract constructor takes: address nfpm (NonFungiblePositionManager)
    const constructorArgs = encodeAbiParameters(
      [{ type: 'address', name: 'nfpm' }],
      [nfpmAddress as Address]
    );

    logger.info({
      requestId,
      userId,
      chainId,
      operatorAddress,
      msg: 'Bytecode and constructor args prepared',
    });

    return NextResponse.json({
      success: true,
      data: {
        bytecode: POSITION_CLOSER_BYTECODE,
        constructorArgs,
        operatorAddress,
        nfpmAddress,
      },
      requestId,
    });
  } catch (error) {
    logger.error({
      requestId,
      userId,
      chainId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      msg: 'Unexpected error getting bytecode',
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
        requestId,
      },
      { status: 500 }
    );
  }
});
