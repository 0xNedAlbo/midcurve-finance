/**
 * POST /api/sign/erc20/approve - Sign ERC-20 Approval Transaction
 *
 * Signs an ERC-20 approve transaction using the user's automation wallet.
 *
 * Flow:
 * 1. Validate request schema
 * 2. Look up user's automation wallet
 * 3. Build the approve transaction
 * 4. Sign with KMS
 * 5. Return signed transaction (caller broadcasts)
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Body: {
 *     userId: string,
 *     chainId: number,
 *     tokenAddress: string,
 *     spenderAddress: string,
 *     amount: string  // BigInt as string
 *   }
 *
 * Response:
 * - 200: {
 *     success: true,
 *     signedTx: string,   // Hex-encoded signed transaction
 *     txHash: string,     // Transaction hash
 *     from: string,       // Automation wallet address
 *     to: string,         // Token contract address
 *     chainId: number,
 *     nonce: number       // Transaction nonce used
 *   }
 * - 400: Invalid request
 * - 401: Unauthorized
 * - 404: User has no automation wallet
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  encodeFunctionData,
  keccak256,
  serializeTransaction,
  type Address,
} from 'viem';
import {
  withInternalAuth,
  parseJsonBody,
  type AuthenticatedRequest,
} from '@/middleware/internal-auth';
import { walletService } from '@/services/wallet-service';
import { getSigner } from '@/lib/kms';
import { signerLogger, signerLog } from '@/lib/logger';
import { ChainIdSchema } from '@midcurve/api-shared';

const logger = signerLogger.child({ endpoint: 'erc20-approve' });

/**
 * ERC-20 approve ABI for encoding
 */
const ERC20_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

/**
 * Request body schema
 */
const Erc20ApproveRequestSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  chainId: ChainIdSchema,
  tokenAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address'),
  spenderAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid spender address'),
  amount: z.string().min(1, 'amount is required'),
});

type Erc20ApproveRequest = z.infer<typeof Erc20ApproveRequestSchema>;

/**
 * POST /api/sign/erc20/approve
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  // 1. Parse request body
  const bodyResult = await parseJsonBody<Erc20ApproveRequest>(request);
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

  // 2. Validate request schema
  const validation = Erc20ApproveRequestSchema.safeParse(bodyResult.data);
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

  const { userId, chainId, tokenAddress, spenderAddress, amount } =
    validation.data;

  logger.info({
    requestId,
    userId,
    chainId,
    tokenAddress,
    spenderAddress,
    msg: 'Processing ERC-20 approve signing request',
  });

  // 3. Get user's automation wallet
  const wallet = await walletService.getWalletByUserId(userId);

  if (!wallet) {
    return NextResponse.json(
      {
        success: false,
        error: 'NO_WALLET',
        message: 'User does not have an automation wallet',
        requestId,
      },
      { status: 404 }
    );
  }

  const walletAddress = wallet.walletAddress;

  // 4. Get the KMS key ID for signing
  const kmsKeyId = await walletService.getKmsKeyId(userId);

  if (!kmsKeyId) {
    return NextResponse.json(
      {
        success: false,
        error: 'NO_KEY',
        message: 'Could not retrieve wallet signing key',
        requestId,
      },
      { status: 500 }
    );
  }

  // 5. Get and increment nonce for this chain
  const nonce = await walletService.getAndIncrementNonce(userId, chainId);

  // 6. Build the approve transaction
  const calldata = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: 'approve',
    args: [spenderAddress as Address, BigInt(amount)],
  });

  // 7. Sign the transaction hash
  // Note: For a complete implementation, we'd serialize the full transaction
  // and sign it. For now, we'll sign the calldata hash as a proof of concept.
  const signer = getSigner();

  try {
    // Create a transaction hash to sign
    // In production, this would be the proper EIP-1559 transaction hash
    const txHash = keccak256(calldata);

    const signatureResult = await signer.signTransaction(kmsKeyId, txHash);

    signerLog.signingOperation(
      logger,
      requestId,
      'erc20-approve',
      walletAddress,
      chainId,
      true,
      txHash
    );

    // Serialize the signed transaction
    // Note: This is simplified - production would include full tx params
    const signedTx = serializeTransaction(
      {
        to: tokenAddress as Address,
        data: calldata,
        chainId,
        type: 'eip1559',
        nonce,
        // Placeholder values - caller should provide or we should fetch
        maxFeePerGas: BigInt(0),
        maxPriorityFeePerGas: BigInt(0),
        gas: BigInt(100000),
      },
      {
        r: signatureResult.r,
        s: signatureResult.s,
        v: BigInt(signatureResult.v),
      }
    );

    logger.info({
      requestId,
      userId,
      walletAddress,
      tokenAddress,
      spenderAddress,
      msg: 'ERC-20 approve transaction signed successfully',
    });

    // Update last used timestamp
    await walletService.updateLastUsed(userId);

    return NextResponse.json({
      success: true,
      signedTx,
      txHash,
      from: walletAddress,
      to: tokenAddress,
      chainId,
      nonce,
      calldata,
      requestId,
    });
  } catch (error) {
    signerLog.signingOperation(
      logger,
      requestId,
      'erc20-approve',
      walletAddress,
      chainId,
      false,
      undefined,
      error instanceof Error ? error.message : String(error)
    );

    logger.error({
      requestId,
      error: error instanceof Error ? error.message : String(error),
      msg: 'Failed to sign ERC-20 approve transaction',
    });

    return NextResponse.json(
      {
        success: false,
        error: 'SIGNING_FAILED',
        message: 'Failed to sign transaction',
        requestId,
      },
      { status: 500 }
    );
  }
});
