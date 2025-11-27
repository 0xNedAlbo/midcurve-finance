/**
 * LocalEncryptedKeyProvider
 *
 * Encrypts private keys using AES-256-GCM with a master key from environment variable.
 * Suitable for development and testing. For production, consider using AWS KMS or similar.
 *
 * SECURITY:
 * - Uses AES-256-GCM for authenticated encryption
 * - Unique IV (12 bytes) per encryption
 * - Master key must be 32 bytes (64 hex characters)
 * - Keys are decrypted only when needed for signing
 *
 * Encrypted format: Base64(IV):Base64(AuthTag):Base64(Ciphertext)
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { privateKeyToAccount, type LocalAccount } from 'viem/accounts';
import type { SigningKeyProvider } from '../signing-key-provider.js';

/**
 * Environment variable name for the master encryption key
 */
const MASTER_KEY_ENV_VAR = 'HYPERLIQUID_WALLET_ENCRYPTION_KEY';

/**
 * Configuration for LocalEncryptedKeyProvider
 */
export interface LocalEncryptedKeyProviderConfig {
  /**
   * Optional master key override (useful for testing)
   * If not provided, reads from HYPERLIQUID_WALLET_ENCRYPTION_KEY env var
   */
  masterKey?: string;
}

export class LocalEncryptedKeyProvider implements SigningKeyProvider {
  readonly providerType = 'local-encrypted' as const;
  private readonly masterKey: Buffer;

  constructor(config: LocalEncryptedKeyProviderConfig = {}) {
    const keyHex = config.masterKey ?? process.env[MASTER_KEY_ENV_VAR];

    if (!keyHex) {
      throw new Error(
        `${MASTER_KEY_ENV_VAR} environment variable is required. ` +
          'Generate with: openssl rand -hex 32'
      );
    }

    if (!/^[a-fA-F0-9]{64}$/.test(keyHex)) {
      throw new Error(
        `${MASTER_KEY_ENV_VAR} must be exactly 64 hex characters (32 bytes). ` +
          'Generate with: openssl rand -hex 32'
      );
    }

    this.masterKey = Buffer.from(keyHex, 'hex');
  }

  /**
   * Encrypt a private key using AES-256-GCM
   *
   * @param privateKey - Private key in 0x-prefixed hex format (66 characters)
   * @returns Encrypted string in format: Base64(IV):Base64(AuthTag):Base64(Ciphertext)
   */
  async storeKey(privateKey: string): Promise<string> {
    // Validate private key format
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
      throw new Error(
        'Invalid private key format. Must be 0x followed by 64 hex characters.'
      );
    }

    // Generate random IV (12 bytes for GCM)
    const iv = randomBytes(12);

    // Create cipher
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);

    // Encrypt the private key
    let encrypted = cipher.update(privateKey, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    // Get authentication tag
    const authTag = cipher.getAuthTag();

    // Return formatted string: IV:AuthTag:Ciphertext (all base64)
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  /**
   * Decrypt an encrypted key and return a viem LocalAccount
   *
   * @param encryptedKey - Encrypted string from storeKey()
   * @returns viem LocalAccount ready for signing
   */
  async getLocalAccount(encryptedKey: string): Promise<LocalAccount> {
    const privateKey = await this.decryptKey(encryptedKey);
    return privateKeyToAccount(privateKey as `0x${string}`);
  }

  /**
   * Validate that the provider is correctly configured
   */
  validateConfig(): void {
    // Constructor already validates, this is for interface compliance
    if (!this.masterKey || this.masterKey.length !== 32) {
      throw new Error('Master key is not properly configured');
    }
  }

  /**
   * Decrypt an encrypted key string
   *
   * @param encryptedKey - Encrypted string in format: Base64(IV):Base64(AuthTag):Base64(Ciphertext)
   * @returns Decrypted private key (0x-prefixed)
   */
  private async decryptKey(encryptedKey: string): Promise<string> {
    const parts = encryptedKey.split(':');

    if (parts.length !== 3) {
      throw new Error(
        'Invalid encrypted key format. Expected IV:AuthTag:Ciphertext'
      );
    }

    // We've validated parts.length === 3, so these are guaranteed to exist
    const ivB64 = parts[0]!;
    const tagB64 = parts[1]!;
    const cipherB64 = parts[2]!;

    // Decode from base64
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const ciphertext = Buffer.from(cipherB64, 'base64');

    // Validate IV length (12 bytes for GCM)
    if (iv.length !== 12) {
      throw new Error('Invalid IV length');
    }

    // Validate auth tag length (16 bytes)
    if (authTag.length !== 16) {
      throw new Error('Invalid authentication tag length');
    }

    // Create decipher
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  }
}
