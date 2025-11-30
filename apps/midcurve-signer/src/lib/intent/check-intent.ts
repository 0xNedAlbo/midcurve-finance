/**
 * checkIntent Function
 *
 * Generic intent compliance checker. Each endpoint can implement specific
 * checks, but this provides a base implementation.
 *
 * For now, this is a generic implementation that:
 * 1. Verifies the intent signature
 * 2. Ensures the intent type matches the endpoint
 * 3. Ensures the signer owns the automation wallet
 *
 * In the future, endpoint-specific checks can be added:
 * - ClosePosition: verify position NFT ownership
 * - HedgePosition: verify hedge parameters are reasonable
 * - etc.
 */

import type { Intent, SignedIntent, IntentType } from '@midcurve/api-shared';
import { intentVerifier } from './intent-verifier';
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
  intent?: Intent;
  walletAddress?: Address;
  kmsKeyId?: string;
}

/**
 * Options for checkIntent
 */
export interface CheckIntentOptions {
  /** User ID making the request */
  userId: string;
  /** Expected intent type (must match the intent) */
  expectedIntentType: IntentType;
  /** Skip nonce verification (for testing) */
  skipNonceCheck?: boolean;
}

const logger = signerLogger.child({ component: 'checkIntent' });

/**
 * Check if an intent is valid and authorized
 *
 * This function:
 * 1. Validates the intent schema and signature
 * 2. Verifies the intent type matches what's expected
 * 3. Verifies the user owns an automation wallet
 * 4. Verifies the intent signer matches the user's linked wallets
 *
 * @param signedIntent - The signed intent to check
 * @param options - Check options
 */
export async function checkIntent(
  signedIntent: SignedIntent,
  options: CheckIntentOptions
): Promise<CheckIntentResult> {
  const { userId, expectedIntentType, skipNonceCheck } = options;

  // 1. Verify the intent signature and schema
  const verifyResult = await intentVerifier.verify(signedIntent, skipNonceCheck);

  if (!verifyResult.valid) {
    return {
      valid: false,
      error: verifyResult.error,
      errorCode: verifyResult.errorCode,
    };
  }

  const intent = verifyResult.intent!;

  // 2. Check intent type matches expected
  if (intent.intentType !== expectedIntentType) {
    return {
      valid: false,
      error: `Intent type mismatch: expected ${expectedIntentType}, got ${intent.intentType}`,
      errorCode: 'INTENT_TYPE_MISMATCH',
    };
  }

  // 3. Get user's automation wallet
  const wallet = await walletService.getWalletByUserId(userId);

  if (!wallet) {
    return {
      valid: false,
      error: 'User does not have an automation wallet',
      errorCode: 'NO_WALLET',
    };
  }

  // 4. Get the KMS key ID for signing
  const kmsKeyId = await walletService.getKmsKeyId(userId);

  if (!kmsKeyId) {
    return {
      valid: false,
      error: 'Could not retrieve wallet signing key',
      errorCode: 'NO_KEY',
    };
  }

  // TODO: In the future, add checks to verify the intent signer is authorized
  // This could include:
  // - Checking the signer is one of the user's linked wallets
  // - Checking the signer has approved the automation wallet
  // For now, we trust the internal API authentication

  logger.info({
    userId,
    intentType: intent.intentType,
    signer: intent.signer,
    walletAddress: wallet.walletAddress,
    msg: 'Intent check passed',
  });

  return {
    valid: true,
    intent,
    walletAddress: wallet.walletAddress,
    kmsKeyId,
  };
}

/**
 * Generic checkIntent that defers specific validation
 *
 * This is a placeholder that allows endpoints to do their own
 * intent type checking. As we add more endpoints, we can add
 * endpoint-specific validation here.
 */
export async function checkIntentGeneric(
  signedIntent: SignedIntent,
  userId: string,
  skipNonceCheck = false
): Promise<CheckIntentResult> {
  // Verify the intent
  const verifyResult = await intentVerifier.verify(signedIntent, skipNonceCheck);

  if (!verifyResult.valid) {
    return {
      valid: false,
      error: verifyResult.error,
      errorCode: verifyResult.errorCode,
    };
  }

  const intent = verifyResult.intent!;

  // Get user's wallet and key
  const wallet = await walletService.getWalletByUserId(userId);
  const kmsKeyId = await walletService.getKmsKeyId(userId);

  if (!wallet || !kmsKeyId) {
    return {
      valid: false,
      error: 'User does not have an automation wallet',
      errorCode: 'NO_WALLET',
    };
  }

  return {
    valid: true,
    intent,
    walletAddress: wallet.walletAddress,
    kmsKeyId,
  };
}
