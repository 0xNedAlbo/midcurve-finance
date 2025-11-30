/**
 * KMS Signer Module
 *
 * Factory for creating the appropriate signer based on environment.
 *
 * Environment Variables:
 * - SIGNER_USE_LOCAL_KEYS: Set to 'true' for local development (uses LocalDevSigner)
 * - AWS_REGION: AWS region for KMS (default: us-east-1)
 * - SIGNER_LOCAL_ENCRYPTION_KEY: 32-byte hex key for local encryption
 */

import type { EvmSigner } from './types.js';
import { AwsKmsSigner } from './aws-kms-signer.js';
import { LocalDevSigner } from './local-dev-signer.js';
import { signerLogger } from '../logger.js';

// Re-export types
export type {
  EvmSigner,
  AwsKmsSignerConfig,
  LocalSignerConfig,
  KmsWalletCreationResult,
  SignatureResult,
} from './types.js';

// Re-export classes
export { AwsKmsSigner } from './aws-kms-signer.js';
export { LocalDevSigner } from './local-dev-signer.js';

/**
 * Singleton signer instance
 */
let signerInstance: EvmSigner | null = null;

/**
 * Determine if we should use local keys based on environment
 */
export function shouldUseLocalKeys(): boolean {
  const useLocal = process.env.SIGNER_USE_LOCAL_KEYS;
  return useLocal === 'true' || useLocal === '1';
}

/**
 * Get or create the signer instance
 *
 * Uses LocalDevSigner if SIGNER_USE_LOCAL_KEYS is true, otherwise AwsKmsSigner.
 */
export function getSigner(): EvmSigner {
  if (signerInstance) {
    return signerInstance;
  }

  const logger = signerLogger.child({ component: 'SignerFactory' });

  if (shouldUseLocalKeys()) {
    logger.info({ msg: 'Using LocalDevSigner (SIGNER_USE_LOCAL_KEYS=true)' });
    signerInstance = new LocalDevSigner();
  } else {
    logger.info({ msg: 'Using AwsKmsSigner for production key management' });
    signerInstance = new AwsKmsSigner();
  }

  signerInstance.validateConfig();
  return signerInstance;
}

/**
 * Reset the signer instance (useful for testing)
 */
export function resetSigner(): void {
  signerInstance = null;
}

/**
 * Create a signer with explicit configuration (for testing)
 */
export function createSigner(options: {
  useLocalKeys: boolean;
  localConfig?: { masterKey?: string };
  awsConfig?: { region?: string; accessKeyId?: string; secretAccessKey?: string };
}): EvmSigner {
  if (options.useLocalKeys) {
    return new LocalDevSigner(options.localConfig);
  }
  return new AwsKmsSigner(options.awsConfig);
}
