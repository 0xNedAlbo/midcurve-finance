/**
 * Strategy Intent Verification Service
 *
 * Verifies EIP-712 signed strategy intents:
 * 1. Validates the intent schema using Zod
 * 2. Verifies the signature matches the signer
 *
 * Note: Nonce checking and expiration are NOT implemented in StrategyIntentV1.
 * These are permission grants, not per-operation intents.
 */

import {
  hashTypedData,
  recoverAddress,
  keccak256,
  toHex,
  type Hex,
  type Address,
} from 'viem';
import { signerLogger, signerLog } from '../logger';
import {
  SignedStrategyIntentV1Schema,
  type ValidatedSignedStrategyIntentV1,
  type ValidatedStrategyIntentV1,
} from '@midcurve/api-shared';
import type { StrategyIntentV1 } from '@midcurve/shared';
import {
  createStrategyIntentDomain,
  StrategyIntentV1Types,
  STRATEGY_INTENT_PRIMARY_TYPE,
} from './eip712-types';

/**
 * Verification result
 */
export interface VerificationResult {
  valid: boolean;
  error?: string;
  errorCode?: string;
  intent?: StrategyIntentV1;
  recoveredAddress?: Address;
}

/**
 * Intent verification errors
 */
export const IntentVerificationError = {
  INVALID_SCHEMA: 'INVALID_SCHEMA',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  SIGNER_MISMATCH: 'SIGNER_MISMATCH',
} as const;

export type IntentVerificationErrorCode =
  (typeof IntentVerificationError)[keyof typeof IntentVerificationError];

/**
 * Convert a validated intent (from Zod) to a typed StrategyIntentV1
 */
function toTypedIntent(validated: ValidatedStrategyIntentV1): StrategyIntentV1 {
  return validated as unknown as StrategyIntentV1;
}

/**
 * Hash a JSON object for EIP-712 signing
 * Used for complex nested structures (allowedCurrencies, allowedEffects, strategy)
 */
function hashJsonObject(obj: unknown): Hex {
  const json = JSON.stringify(obj, Object.keys(obj as object).sort());
  return keccak256(toHex(json));
}

/**
 * EIP-712 message structure for StrategyIntentV1
 */
interface StrategyIntentV1Message {
  id: string;
  name: string;
  description: string;
  allowedCurrenciesHash: Hex;
  allowedEffectsHash: Hex;
  strategyHash: Hex;
}

/**
 * Prepare intent for EIP-712 signing
 * Converts nested structures to hashes
 */
function prepareIntentForSigning(intent: StrategyIntentV1): StrategyIntentV1Message {
  return {
    id: intent.id,
    name: intent.name ?? '',
    description: intent.description ?? '',
    allowedCurrenciesHash: hashJsonObject(intent.allowedCurrencies),
    allowedEffectsHash: hashJsonObject(intent.allowedEffects),
    strategyHash: hashJsonObject(intent.strategy),
  };
}

class StrategyIntentVerifier {
  private readonly logger = signerLogger.child({
    component: 'StrategyIntentVerifier',
  });

  /**
   * Verify a signed strategy intent
   *
   * @param signedIntent - The signed intent to verify
   * @param chainId - The chain ID for EIP-712 domain
   */
  async verify(
    signedIntent: ValidatedSignedStrategyIntentV1,
    chainId: number
  ): Promise<VerificationResult> {
    const requestId = `verify-${Date.now()}`;

    try {
      // 1. Validate intent schema
      const schemaResult = SignedStrategyIntentV1Schema.safeParse(signedIntent);
      if (!schemaResult.success) {
        return {
          valid: false,
          error: `Invalid intent schema: ${schemaResult.error.issues.map((i) => i.message).join(', ')}`,
          errorCode: IntentVerificationError.INVALID_SCHEMA,
        };
      }

      // Convert validated intent to typed intent
      const intent = toTypedIntent(schemaResult.data.intent);

      // 2. Verify signature
      const recoveredAddress = await this.recoverSigner(
        intent,
        signedIntent.signature as Hex,
        chainId
      );

      if (!recoveredAddress) {
        return {
          valid: false,
          error: 'Could not recover signer from signature',
          errorCode: IntentVerificationError.INVALID_SIGNATURE,
        };
      }

      // 3. Check recovered address matches claimed signer
      if (recoveredAddress.toLowerCase() !== signedIntent.signer.toLowerCase()) {
        return {
          valid: false,
          error: `Signer mismatch: expected ${signedIntent.signer}, got ${recoveredAddress}`,
          errorCode: IntentVerificationError.SIGNER_MISMATCH,
        };
      }

      signerLog.intentVerification(
        this.logger,
        requestId,
        true,
        `strategy:${intent.id}`
      );

      return {
        valid: true,
        intent,
        recoveredAddress,
      };
    } catch (error) {
      this.logger.error({
        requestId,
        error: error instanceof Error ? error.message : String(error),
        msg: 'Strategy intent verification failed with error',
      });

      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Verification failed',
        errorCode: IntentVerificationError.INVALID_SIGNATURE,
      };
    }
  }

  /**
   * Recover the signer address from an intent and signature
   */
  private async recoverSigner(
    intent: StrategyIntentV1,
    signature: Hex,
    chainId: number
  ): Promise<Address | null> {
    try {
      const domain = createStrategyIntentDomain(chainId);
      const message = prepareIntentForSigning(intent);

      // Hash the typed data
      const hash = hashTypedData({
        domain,
        types: StrategyIntentV1Types,
        primaryType: STRATEGY_INTENT_PRIMARY_TYPE,
        message,
      });

      // Recover the address from the signature
      const recoveredAddress = await recoverAddress({
        hash,
        signature,
      });

      return recoveredAddress;
    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : String(error),
        msg: 'Failed to recover signer',
      });
      return null;
    }
  }
}

// Export singleton instance
export const strategyIntentVerifier = new StrategyIntentVerifier();
