/**
 * POST /api/sign/automation/uniswapv3/vault-position-closer/execute-order
 *
 * Sign an executeOrder() transaction for a UniswapV3VaultPositionCloser contract.
 * Does NOT broadcast the transaction - that is handled by the caller.
 *
 * Vault version: takes vaultAddress + ownerAddress instead of nftId.
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

const logger = signerLogger.child({ endpoint: 'sign-vault-automation-execute-order' });

const HopSchema = z.object({
  venueId: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid venueId (must be bytes32)'),
  tokenIn: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid tokenIn address'),
  tokenOut: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid tokenOut address'),
  venueData: z.string().regex(/^0x[a-fA-F0-9]*$/, 'Invalid venueData'),
});

const WithdrawParamsSchema = z.object({
  amount0Min: z.string().regex(/^\d+$/, 'amount0Min must be numeric string'),
  amount1Min: z.string().regex(/^\d+$/, 'amount1Min must be numeric string'),
});

const SwapParamsSchema = z.object({
  guaranteedAmountIn: z.string().regex(/^\d+$/, 'guaranteedAmountIn must be numeric string'),
  minAmountOut: z.string().regex(/^\d+$/, 'minAmountOut must be numeric string'),
  deadline: z.number().int().nonnegative('deadline must be non-negative'),
  hops: z.array(HopSchema),
});

const FeeParamsSchema = z.object({
  feeRecipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid fee recipient address'),
  feeBps: z.number().int().min(0).max(100, 'feeBps must be 0-100 (max 1%)'),
});

const SignVaultExecuteOrderSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  chainId: z.number().int().positive('chainId must be a positive integer'),
  contractAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid contract address'),
  vaultAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid vault address'),
  ownerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid owner address'),
  triggerMode: z.number().int().min(0).max(1, 'triggerMode must be 0 (LOWER) or 1 (UPPER)'),
  gasLimit: z.string().min(1, 'gasLimit is required').transform((val) => BigInt(val)),
  gasPrice: z.string().min(1, 'gasPrice is required').transform((val) => BigInt(val)),
  nonce: z.number().int().nonnegative('nonce is required'),
  withdrawParams: WithdrawParamsSchema,
  swapParams: SwapParamsSchema,
  feeParams: FeeParamsSchema,
});

type SignVaultExecuteOrderRequest = z.infer<typeof SignVaultExecuteOrderSchema>;

export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  const bodyResult = await parseJsonBody<SignVaultExecuteOrderRequest>(request);
  if (!bodyResult.success) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_REQUEST', message: bodyResult.error }, requestId },
      { status: 400 }
    );
  }

  const validation = SignVaultExecuteOrderSchema.safeParse(bodyResult.data);
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: validation.error.issues.map((i) => i.message).join(', ') }, requestId },
      { status: 400 }
    );
  }

  const { userId, chainId, contractAddress, vaultAddress, ownerAddress, triggerMode, gasLimit, gasPrice, nonce, withdrawParams, swapParams, feeParams } = validation.data;

  logger.info({
    requestId, userId, chainId, contractAddress, vaultAddress, ownerAddress, triggerMode,
    feeBps: feeParams.feeBps, gasLimit: gasLimit.toString(), gasPrice: gasPrice.toString(),
    explicitNonce: nonce, hasSwap: swapParams.hops.length > 0,
    msg: 'Processing vault execute-order signing request',
  });

  try {
    const result = await automationSigningService.signVaultExecuteOrder({
      userId,
      chainId,
      contractAddress: contractAddress as Address,
      vaultAddress: vaultAddress as Address,
      ownerAddress: ownerAddress as Address,
      triggerMode,
      gasLimit,
      gasPrice,
      nonce,
      withdrawParams: { amount0Min: withdrawParams.amount0Min, amount1Min: withdrawParams.amount1Min },
      swapParams: {
        guaranteedAmountIn: swapParams.guaranteedAmountIn,
        minAmountOut: swapParams.minAmountOut,
        deadline: swapParams.deadline,
        hops: swapParams.hops.map((hop) => ({
          venueId: hop.venueId,
          tokenIn: hop.tokenIn as Address,
          tokenOut: hop.tokenOut as Address,
          venueData: hop.venueData as `0x${string}`,
        })),
      },
      feeParams: { feeRecipient: feeParams.feeRecipient as Address, feeBps: feeParams.feeBps },
    });

    logger.info({
      requestId, userId, chainId, contractAddress, vaultAddress, ownerAddress, triggerMode,
      nonce: result.nonce, msg: 'Vault execute-order transaction signed successfully',
    });

    return NextResponse.json({
      success: true,
      data: { signedTransaction: result.signedTransaction, nonce: result.nonce, txHash: result.txHash, from: result.from },
      requestId,
    });
  } catch (error) {
    if (error instanceof AutomationSigningError) {
      logger.warn({ requestId, userId, chainId, errorCode: error.code, errorMessage: error.message, msg: 'Vault execute-order signing failed with known error' });
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message, details: error.details }, requestId },
        { status: error.statusCode }
      );
    }

    logger.error({ requestId, userId, chainId, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined, msg: 'Unexpected error during vault execute-order signing' });
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred during signing' }, requestId },
      { status: 500 }
    );
  }
});
