/**
 * Intent Verification Service
 *
 * Verifies EIP-712 signed intents:
 * 1. Validates the intent schema
 * 2. Verifies the signature matches the signer
 * 3. Checks nonce hasn't been used (replay protection)
 * 4. Checks intent hasn't expired
 */

import { hashTypedData, recoverAddress, type Hex, type Address } from 'viem';
import { prisma } from '../prisma.js';
import { signerLogger, signerLog } from '../logger.js';
import {
  type Intent,
  type SignedIntent,
  IntentSchema,
  type IntentType,
  type ValidatedIntent,
} from '@midcurve/api-shared';
import {
  createIntentDomain,
  INTENT_TYPE_DEFINITIONS,
  INTENT_PRIMARY_TYPES,
} from './eip712-types.js';

/**
 * Verification result
 */
export interface VerificationResult {
  valid: boolean;
  error?: string;
  errorCode?: string;
  intent?: Intent;
  recoveredAddress?: Address;
}

/**
 * Intent verification errors
 */
export const IntentVerificationError = {
  INVALID_SCHEMA: 'INVALID_SCHEMA',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  SIGNER_MISMATCH: 'SIGNER_MISMATCH',
  NONCE_USED: 'NONCE_USED',
  INTENT_EXPIRED: 'INTENT_EXPIRED',
  UNKNOWN_INTENT_TYPE: 'UNKNOWN_INTENT_TYPE',
} as const;

export type IntentVerificationErrorCode =
  (typeof IntentVerificationError)[keyof typeof IntentVerificationError];

/**
 * Convert a validated intent (from Zod) to a typed Intent
 *
 * This is needed because Zod infers `string` for addresses,
 * but our Intent type uses `Address` (0x${string}).
 * Since we validate the address format with regex, this cast is safe.
 */
function toTypedIntent(validated: ValidatedIntent): Intent {
  return validated as unknown as Intent;
}

class IntentVerifier {
  private readonly logger = signerLogger.child({ component: 'IntentVerifier' });

  /**
   * Verify a signed intent
   *
   * @param signedIntent - The signed intent to verify
   * @param skipNonceCheck - Skip nonce verification (for testing)
   */
  async verify(
    signedIntent: SignedIntent,
    skipNonceCheck = false
  ): Promise<VerificationResult> {
    const requestId = `verify-${Date.now()}`;

    try {
      // 1. Validate intent schema
      const schemaResult = IntentSchema.safeParse(signedIntent.intent);
      if (!schemaResult.success) {
        return {
          valid: false,
          error: `Invalid intent schema: ${schemaResult.error.issues.map((i) => i.message).join(', ')}`,
          errorCode: IntentVerificationError.INVALID_SCHEMA,
        };
      }

      // Convert validated intent to typed intent
      const intent = toTypedIntent(schemaResult.data);

      // 2. Check intent hasn't expired
      if (intent.expiresAt) {
        const expiresAt = new Date(intent.expiresAt);
        if (expiresAt < new Date()) {
          return {
            valid: false,
            error: 'Intent has expired',
            errorCode: IntentVerificationError.INTENT_EXPIRED,
          };
        }
      }

      // 3. Verify signature
      const recoveredAddress = await this.recoverSigner(intent, signedIntent.signature);

      if (!recoveredAddress) {
        return {
          valid: false,
          error: 'Could not recover signer from signature',
          errorCode: IntentVerificationError.INVALID_SIGNATURE,
        };
      }

      // 4. Check recovered address matches claimed signer
      if (recoveredAddress.toLowerCase() !== intent.signer.toLowerCase()) {
        return {
          valid: false,
          error: `Signer mismatch: expected ${intent.signer}, got ${recoveredAddress}`,
          errorCode: IntentVerificationError.SIGNER_MISMATCH,
        };
      }

      // 5. Check nonce hasn't been used (replay protection)
      if (!skipNonceCheck) {
        const nonceUsed = await this.isNonceUsed(
          intent.signer,
          intent.chainId,
          intent.nonce
        );

        if (nonceUsed) {
          return {
            valid: false,
            error: 'Nonce has already been used',
            errorCode: IntentVerificationError.NONCE_USED,
          };
        }
      }

      signerLog.intentVerification(
        this.logger,
        requestId,
        true,
        `${intent.intentType}:${intent.nonce}`
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
        msg: 'Intent verification failed with error',
      });

      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Verification failed',
        errorCode: IntentVerificationError.INVALID_SIGNATURE,
      };
    }
  }

  /**
   * Record a nonce as used (call after successful signing)
   */
  async recordNonceUsed(intent: Intent): Promise<void> {
    await prisma.intentNonce.create({
      data: {
        signer: intent.signer.toLowerCase(),
        chainId: intent.chainId,
        nonce: intent.nonce,
        intentType: intent.intentType,
        usedAt: new Date(),
      },
    });
  }

  /**
   * Recover the signer address from an intent and signature
   */
  private async recoverSigner(
    intent: Intent,
    signature: Hex
  ): Promise<Address | null> {
    try {
      const intentType = intent.intentType as IntentType;
      const types = INTENT_TYPE_DEFINITIONS[intentType];
      const primaryType = INTENT_PRIMARY_TYPES[intentType];

      if (!types || !primaryType) {
        this.logger.error({
          intentType,
          msg: 'Unknown intent type',
        });
        return null;
      }

      const domain = createIntentDomain(intent.chainId);

      // Prepare the message for signing (remove optional fields that are undefined)
      const message = this.prepareMessageForSigning(intent);

      // Hash the typed data - use type assertion for compatibility
      const hash = hashTypedData({
        domain,
        types,
        primaryType,
        message,
      } as Parameters<typeof hashTypedData>[0]);

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

  /**
   * Check if a nonce has already been used
   */
  private async isNonceUsed(
    signer: Address,
    chainId: number,
    nonce: string
  ): Promise<boolean> {
    const existing = await prisma.intentNonce.findUnique({
      where: {
        signer_chainId_nonce: {
          signer: signer.toLowerCase(),
          chainId,
          nonce,
        },
      },
    });

    return existing !== null;
  }

  /**
   * Prepare intent for EIP-712 signing by removing undefined optional fields
   */
  private prepareMessageForSigning(intent: Intent): Record<string, unknown> {
    // Create a copy with only defined values
    const message: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(intent)) {
      if (value !== undefined) {
        message[key] = value;
      }
    }

    return message;
  }
}

// Export singleton instance
export const intentVerifier = new IntentVerifier();
