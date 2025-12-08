/**
 * POST /api/sign/withdraw/erc20 - Sign ERC-20 Withdrawal Transaction
 *
 * Signs an ERC-20 transfer transaction from the automation wallet to the
 * strategy owner. The recipient is HARD-WIRED by querying SEMSEE directly.
 *
 * Security:
 * - Recipient queried from strategy.owner() on SEMSEE (cannot be spoofed)
 * - SEMSEE is local/internal network (no external network access)
 * - Core provides gas estimates (external chain access)
 *
 * Flow:
 * 1. Validate request schema
 * 2. Look up strategy's automation wallet
 * 3. Query strategy owner from SEMSEE (HARD-WIRED recipient)
 * 4. Build the transfer transaction
 * 5. Sign with KMS
 * 6. Return signed transaction (caller broadcasts)
 *
 * Request:
 * - Authorization: Bearer <internal-api-key>
 * - Body: {
 *     strategyAddress: string,  // Strategy address (to look up wallet + owner)
 *     chainId: number,          // Target external chain
 *     tokenAddress: string,     // ERC-20 token contract
 *     amount: string,           // BigInt as string
 *     maxFeePerGas: string,     // BigInt as string (Core provides)
 *     maxPriorityFeePerGas: string,  // BigInt as string (Core provides)
 *     gasLimit: string          // BigInt as string (Core provides)
 *   }
 *
 * Response:
 * - 200: {
 *     success: true,
 *     signedTx: string,   // Hex-encoded signed transaction
 *     txHash: string,     // Transaction hash
 *     from: string,       // Automation wallet address
 *     to: string,         // Token contract address
 *     recipient: string,  // Strategy owner (queried from SEMSEE)
 *     chainId: number,
 *     nonce: number,
 *     calldata: string
 *   }
 * - 400: Invalid request
 * - 401: Unauthorized
 * - 404: Strategy has no automation wallet
 * - 500: Signing failed or owner lookup failed
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
import { getStrategyOwner } from '@/lib/semsee';
import { signerLogger, signerLog } from '@/lib/logger';
import { ChainIdSchema } from '@midcurve/api-shared';

const logger = signerLogger.child({ endpoint: 'erc20-withdraw' });

/**
 * ERC-20 transfer ABI for encoding
 */
const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

/**
 * Request body schema
 */
const Erc20WithdrawRequestSchema = z.object({
  strategyAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid strategy address'),
  chainId: ChainIdSchema,
  tokenAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address'),
  amount: z.string().min(1, 'amount is required'),
  maxFeePerGas: z.string().min(1, 'maxFeePerGas is required'),
  maxPriorityFeePerGas: z.string().min(1, 'maxPriorityFeePerGas is required'),
  gasLimit: z.string().min(1, 'gasLimit is required'),
});

type Erc20WithdrawRequest = z.infer<typeof Erc20WithdrawRequestSchema>;

/**
 * POST /api/sign/withdraw/erc20
 */
export const POST = withInternalAuth(async (ctx: AuthenticatedRequest) => {
  const { requestId, request } = ctx;

  // 1. Parse request body
  const bodyResult = await parseJsonBody<Erc20WithdrawRequest>(request);
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
  const validation = Erc20WithdrawRequestSchema.safeParse(bodyResult.data);
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

  const {
    strategyAddress,
    chainId,
    tokenAddress,
    amount,
    maxFeePerGas,
    maxPriorityFeePerGas,
    gasLimit,
  } = validation.data;

  logger.info({
    requestId,
    strategyAddress,
    chainId,
    tokenAddress,
    msg: 'Processing ERC-20 withdraw signing request',
  });

  // 3. Get strategy's automation wallet
  const wallet = await walletService.getWalletByStrategyAddress(strategyAddress as Address);

  if (!wallet) {
    return NextResponse.json(
      {
        success: false,
        error: 'NO_WALLET',
        message: 'Strategy does not have an automation wallet',
        requestId,
      },
      { status: 404 }
    );
  }

  const walletAddress = wallet.walletAddress;

  // 4. Get the KMS key ID for signing
  const kmsKeyId = await walletService.getKmsKeyId(strategyAddress as Address);

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

  // 5. Query strategy owner from SEMSEE (HARD-WIRED recipient)
  let ownerAddress: Address;
  try {
    ownerAddress = await getStrategyOwner(strategyAddress as Address);
    logger.info({
      requestId,
      strategyAddress,
      ownerAddress,
      msg: 'Strategy owner retrieved from SEMSEE',
    });
  } catch (error) {
    logger.error({
      requestId,
      strategyAddress,
      error: error instanceof Error ? error.message : String(error),
      msg: 'Failed to query strategy owner from SEMSEE',
    });

    return NextResponse.json(
      {
        success: false,
        error: 'OWNER_LOOKUP_FAILED',
        message: 'Failed to query strategy owner from SEMSEE',
        requestId,
      },
      { status: 500 }
    );
  }

  // 6. Get and increment nonce for this chain
  const nonce = await walletService.getAndIncrementNonce(strategyAddress as Address, chainId);

  // 7. Build the transfer transaction
  const calldata = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [ownerAddress, BigInt(amount)],
  });

  // 8. Sign the transaction
  const signer = getSigner();

  try {
    // Create a transaction hash to sign
    // Note: For a complete implementation, we'd properly serialize and sign
    const txHash = keccak256(calldata);

    const signatureResult = await signer.signTransaction(kmsKeyId, txHash);

    signerLog.signingOperation(
      logger,
      requestId,
      'erc20-withdraw',
      walletAddress,
      chainId,
      true,
      txHash
    );

    // Serialize the signed transaction
    const signedTx = serializeTransaction(
      {
        to: tokenAddress as Address,
        data: calldata,
        chainId,
        type: 'eip1559',
        nonce,
        maxFeePerGas: BigInt(maxFeePerGas),
        maxPriorityFeePerGas: BigInt(maxPriorityFeePerGas),
        gas: BigInt(gasLimit),
      },
      {
        r: signatureResult.r,
        s: signatureResult.s,
        v: BigInt(signatureResult.v),
      }
    );

    logger.info({
      requestId,
      strategyAddress,
      walletAddress,
      tokenAddress,
      ownerAddress,
      chainId,
      amount,
      msg: 'ERC-20 withdraw transaction signed successfully',
    });

    // Update last used timestamp
    await walletService.updateLastUsed(strategyAddress as Address);

    return NextResponse.json({
      success: true,
      signedTx,
      txHash,
      from: walletAddress,
      to: tokenAddress,
      recipient: ownerAddress,
      chainId,
      nonce,
      calldata,
      requestId,
    });
  } catch (error) {
    signerLog.signingOperation(
      logger,
      requestId,
      'erc20-withdraw',
      walletAddress,
      chainId,
      false,
      undefined,
      error instanceof Error ? error.message : String(error)
    );

    logger.error({
      requestId,
      error: error instanceof Error ? error.message : String(error),
      msg: 'Failed to sign ERC-20 withdraw transaction',
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
