/**
 * Crypto Module
 *
 * Provides encrypted private key storage with pluggable providers.
 *
 * Current Providers:
 * - LocalEncryptedKeyProvider: AES-256-GCM with master key from env var (dev/test)
 * - AwsKmsKeyProvider: AWS KMS envelope encryption (stub, future)
 */

export type {
  SigningKeyProvider,
  SigningKeyProviderType,
} from './signing-key-provider.js';

export * from './providers/index.js';
