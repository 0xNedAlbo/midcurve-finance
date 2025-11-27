/**
 * SigningKeyProvider Interface
 *
 * Abstract interface for managing encrypted private keys.
 * Enables pluggable key storage providers (local encryption, AWS KMS, etc.)
 *
 * SECURITY:
 * - Private keys are encrypted at rest
 * - Keys are decrypted only when signing is required
 * - Decrypted keys should be cleared from memory after use
 */

import type { LocalAccount } from 'viem/accounts';

/**
 * Provider types for key storage
 */
export type SigningKeyProviderType = 'local-encrypted' | 'aws-kms';

/**
 * Abstract interface for signing key providers.
 *
 * Implementations:
 * - LocalEncryptedKeyProvider: AES-256-GCM encryption with master key from env var
 * - AwsKmsKeyProvider: AWS KMS envelope encryption (future)
 */
export interface SigningKeyProvider {
  /**
   * Provider type identifier
   */
  readonly providerType: SigningKeyProviderType;

  /**
   * Encrypt and store a private key
   *
   * @param privateKey - The private key to encrypt (0x-prefixed hex string)
   * @returns Encrypted key string (format depends on provider)
   */
  storeKey(privateKey: string): Promise<string>;

  /**
   * Decrypt and return a LocalAccount for signing
   *
   * @param encryptedKey - The encrypted key string from storeKey()
   * @returns viem LocalAccount ready for signing operations
   */
  getLocalAccount(encryptedKey: string): Promise<LocalAccount>;

  /**
   * Validate that the provider is correctly configured
   *
   * @throws Error if configuration is invalid
   */
  validateConfig(): void;
}
