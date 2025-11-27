/**
 * AwsKmsKeyProvider (Stub)
 *
 * Future implementation for AWS KMS envelope encryption.
 * This is a stub that throws NotImplementedError.
 *
 * When implemented, will use envelope encryption:
 * 1. KMS generates a data key
 * 2. Data key encrypts the private key locally
 * 3. Encrypted data key stored alongside encrypted private key
 * 4. KMS never sees the actual private key
 *
 * Benefits over local encryption:
 * - Master key never leaves AWS HSM
 * - CloudTrail audit logging
 * - IAM-based access control
 * - Key rotation support
 */

import type { LocalAccount } from 'viem/accounts';
import type { SigningKeyProvider } from '../signing-key-provider.js';

/**
 * Configuration for AwsKmsKeyProvider
 */
export interface AwsKmsKeyProviderConfig {
  /**
   * AWS region (e.g., 'us-east-1')
   */
  region: string;

  /**
   * KMS Key ID or ARN
   */
  kmsKeyId: string;
}

export class AwsKmsKeyProvider implements SigningKeyProvider {
  readonly providerType = 'aws-kms' as const;

  constructor(_config: AwsKmsKeyProviderConfig) {
    throw new Error(
      'AwsKmsKeyProvider is not yet implemented. ' +
        'Use LocalEncryptedKeyProvider for development/testing.'
    );
  }

  async storeKey(_privateKey: string): Promise<string> {
    throw new Error('AwsKmsKeyProvider is not yet implemented');
  }

  async getLocalAccount(_encryptedKey: string): Promise<LocalAccount> {
    throw new Error('AwsKmsKeyProvider is not yet implemented');
  }

  validateConfig(): void {
    throw new Error('AwsKmsKeyProvider is not yet implemented');
  }
}
