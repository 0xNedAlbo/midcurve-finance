/**
 * POST /api/strategy/deploy - Deploy Strategy Contract
 *
 * Deploys a strategy contract using the manifest's bytecode and ABI.
 * Creates an automation wallet for the strategy and broadcasts the deployment
 * transaction to the SEMSEE chain.
 *
 * This endpoint is called by the midcurve-ui after creating a strategy record
 * in 'pending' state.
 *
 * Flow:
 * 1. Validate request schema
 * 2. Fetch strategy and manifest
 * 3. Create automation wallet (KMS-backed)
 * 4. Build constructor arguments from manifest + user values
 * 5. Deploy contract
 * 6. Update strategy with contract address
 * 7. Return deployment result
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Body: {
 *     strategyId: string,     // ID of the pending strategy
 *     chainId: number,        // Target chain for deployment (SEMSEE chain ID)
 *     ownerAddress: string    // User's wallet address (for _owner param)
 *   }
 *
 * Response (Success):
 * - 200: {
 *     success: true,
 *     data: {
 *       contractAddress: string,
 *       transactionHash: string,
 *       automationWallet: { id: string, address: string },
 *       blockNumber: number
 *     }
 *   }
 *
 * Response (Error):
 * - 400: Invalid request or strategy state
 * - 401: Unauthorized
 * - 404: Strategy or manifest not found
 * - 500: Deployment failed
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  withInternalAuth,
  parseJsonBody,
  type AuthenticatedRequest,
} from '@/middleware/internal-auth';
import {
  strategyDeploymentService,
  StrategyDeploymentError,
} from '@/services/strategy-deployment-service';
import { signerLogger } from '@/lib/logger';

const logger = signerLogger.child({ endpoint: 'strategy-deploy' });

/**
 * Request body schema
 */
const DeployStrategyRequestSchema = z.object({
  strategyId: z.string().min(1, 'strategyId is required'),
  chainId: z.number().int().positive('chainId must be a positive integer'),
  ownerAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid owner address format'),
});

type DeployStrategyRequest = z.infer<typeof DeployStrategyRequestSchema>;

/**
 * POST /api/strategy/deploy
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  // 1. Parse request body
  const bodyResult = await parseJsonBody<DeployStrategyRequest>(request);
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
  const validation = DeployStrategyRequestSchema.safeParse(bodyResult.data);
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

  const { strategyId, chainId, ownerAddress } = validation.data;

  logger.info({
    requestId,
    strategyId,
    chainId,
    ownerAddress,
    msg: 'Processing strategy deployment request',
  });

  try {
    // 3. Deploy strategy
    const result = await strategyDeploymentService.deployStrategy({
      strategyId,
      chainId,
      ownerAddress,
    });

    logger.info({
      requestId,
      strategyId,
      contractAddress: result.contractAddress,
      transactionHash: result.transactionHash,
      walletAddress: result.automationWallet.address,
      msg: 'Strategy deployed successfully',
    });

    return NextResponse.json({
      success: true,
      data: {
        contractAddress: result.contractAddress,
        transactionHash: result.transactionHash,
        automationWallet: {
          id: result.automationWallet.id,
          address: result.automationWallet.address,
        },
        blockNumber: result.blockNumber,
      },
      requestId,
    });
  } catch (error) {
    // Handle known deployment errors
    if (error instanceof StrategyDeploymentError) {
      logger.warn({
        requestId,
        strategyId,
        errorCode: error.code,
        errorMessage: error.message,
        msg: 'Strategy deployment failed with known error',
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
      strategyId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      msg: 'Unexpected error during strategy deployment',
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred during deployment',
        },
        requestId,
      },
      { status: 500 }
    );
  }
});
