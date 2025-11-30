/**
 * checkIntent Function
 *
 * Verifies a signed strategy intent and retrieves the user's automation wallet.
 *
 * This is a simplified implementation that:
 * 1. Verifies the intent signature
 * 2. Ensures the user has an automation wallet
 * 3. Returns the wallet info for signing
 *
 * Future enhancements could include:
 * - Checking if the signer is authorized for the user
 * - Validating intent-specific permissions
 */

import type { StrategyIntentV1 } from '@midcurve/shared';
import type { ValidatedSignedStrategyIntentV1 } from '@midcurve/api-shared';
import { strategyIntentVerifier } from './intent-verifier';
import { walletService } from '../../services/wallet-service';
import { signerLogger } from '../logger';
import type { Address } from 'viem';

/**
 * Result from checkIntent
 */
export interface CheckIntentResult {
  valid: boolean;
  error?: string;
  errorCode?: string;
  intent?: StrategyIntentV1;
  signer?: Address;
  walletAddress?: Address;
  kmsKeyId?: string;
}

/**
 * Options for checkIntent
 */
export interface CheckIntentOptions {
  /** User ID making the request */
  userId: string;
  /** Chain ID for EIP-712 domain */
  chainId: number;
}

const logger = signerLogger.child({ component: 'checkIntent' });

/**
 * Check if a strategy intent is valid and authorized
 *
 * This function:
 * 1. Validates the intent schema and signature
 * 2. Verifies the user owns an automation wallet
 * 3. Returns wallet info for transaction signing
 *
 * @param signedIntent - The signed strategy intent to check
 * @param options - Check options
 */
export async function checkIntent(
  signedIntent: ValidatedSignedStrategyIntentV1,
  options: CheckIntentOptions
): Promise<CheckIntentResult> {
  const { userId, chainId } = options;

  // 1. Verify the intent signature and schema
  const verifyResult = await strategyIntentVerifier.verify(signedIntent, chainId);

  if (!verifyResult.valid) {
    return {
      valid: false,
      error: verifyResult.error,
      errorCode: verifyResult.errorCode,
    };
  }

  const intent = verifyResult.intent!;
  const signer = verifyResult.recoveredAddress!;

  // 2. Get user's automation wallet
  const wallet = await walletService.getWalletByUserId(userId);

  if (!wallet) {
    return {
      valid: false,
      error: 'User does not have an automation wallet',
      errorCode: 'NO_WALLET',
    };
  }

  // 3. Get the KMS key ID for signing
  const kmsKeyId = await walletService.getKmsKeyId(userId);

  if (!kmsKeyId) {
    return {
      valid: false,
      error: 'Could not retrieve wallet signing key',
      errorCode: 'NO_KEY',
    };
  }

  logger.info({
    userId,
    strategyType: intent.strategy.strategyType,
    signer,
    walletAddress: wallet.walletAddress,
    msg: 'Strategy intent check passed',
  });

  return {
    valid: true,
    intent,
    signer,
    walletAddress: wallet.walletAddress,
    kmsKeyId,
  };
}
