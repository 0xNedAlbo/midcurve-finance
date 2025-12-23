/**
 * Local Development Signer
 *
 * A development-only signer that generates and stores keys locally.
 * Uses AES-256-GCM encryption for at-rest key storage.
 *
 * ⚠️  FOR DEVELOPMENT/TESTING ONLY - DO NOT USE IN PRODUCTION
 *
 * In production, use AwsKmsSigner where the private key never leaves the HSM.
 * This signer stores encrypted keys in memory/database for local development.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import {
  privateKeyToAccount,
  generatePrivateKey,
  type LocalAccount,
} from 'viem/accounts';
import { type Address, type Hash, type Hex } from 'viem';
import { secp256k1 } from '@noble/curves/secp256k1';
import type { EvmSigner, LocalSignerConfig, KmsWalletCreationResult, SignatureResult } from './types';
import { signerLogger, signerLog } from '../logger';

/**
 * Environment variable name for the master encryption key
 */
const MASTER_KEY_ENV_VAR = 'SIGNER_LOCAL_ENCRYPTION_KEY';

/**
 * In-memory store for local keys (keyId -> encryptedPrivateKey)
 * In a real local dev setup, these would be persisted to the database
 */
const localKeyStore = new Map<string, string>();

/**
 * Convert bigint to 32-byte hex string
 */
function bigintToHex32(value: bigint): Hex {
  const hex = value.toString(16).padStart(64, '0');
  return `0x${hex}` as Hex;
}

export class LocalDevSigner implements EvmSigner {
  private readonly masterKey: Buffer;
  private readonly logger = signerLogger.child({ component: 'LocalDevSigner' });

  constructor(config: LocalSignerConfig = {}) {
    const keyHex = config.masterKey ?? process.env[MASTER_KEY_ENV_VAR];

    // FAIL FAST: Don't accept requests without proper configuration
    // A random key would make all encrypted private keys unrecoverable after restart
    if (!keyHex) {
      throw new Error(
        `${MASTER_KEY_ENV_VAR} environment variable is required for LocalDevSigner. ` +
          'Generate a key with: openssl rand -hex 32'
      );
    }

    // Validate 64 hex chars (32 bytes)
    if (!/^[a-fA-F0-9]{64}$/.test(keyHex)) {
      throw new Error(
        `${MASTER_KEY_ENV_VAR} must be exactly 64 hex characters (32 bytes). ` +
          'Generate with: openssl rand -hex 32'
      );
    }

    this.masterKey = Buffer.from(keyHex, 'hex');
    this.logger.info({ msg: 'LocalDevSigner initialized (DEVELOPMENT ONLY)' });
  }

  /**
   * Create a new local key pair
   */
  async createKey(label: string): Promise<KmsWalletCreationResult> {
    const startTime = Date.now();

    try {
      signerLog.methodEntry(this.logger, 'createKey', { label });

      // Generate a new private key
      const privateKey = generatePrivateKey();

      // Create account to get address
      const account = privateKeyToAccount(privateKey);

      // Generate a unique key ID (simulating KMS key ID)
      const keyId = `local-${randomBytes(16).toString('hex')}`;

      // Encrypt and store the private key
      const encryptedKey = this.encryptKey(privateKey);
      localKeyStore.set(keyId, encryptedKey);

      const durationMs = Date.now() - startTime;
      signerLog.kmsOperation(this.logger, `create-${Date.now()}`, 'createKey', true, keyId, durationMs);

      return {
        keyId,
        walletAddress: account.address,
      };
    } catch (error) {
      signerLog.kmsOperation(
        this.logger,
        `create-${Date.now()}`,
        'createKey',
        false,
        undefined,
        undefined,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Get Ethereum address for a local key
   */
  async getAddress(keyId: string): Promise<Address> {
    const account = await this.getAccount(keyId);
    return account.address;
  }

  /**
   * Sign a 32-byte hash using raw secp256k1 ECDSA
   *
   * This method signs the hash directly WITHOUT any EIP-191 prefix.
   * This is required for transaction signing where we need to recover
   * the correct sender address from the signature.
   */
  async signHash(keyId: string, hash: Hash): Promise<SignatureResult> {
    const requestId = `sign-${Date.now()}`;
    const startTime = Date.now();

    try {
      // Get the encrypted private key and decrypt it
      const encryptedKey = localKeyStore.get(keyId);
      if (!encryptedKey) {
        throw new Error(`Key not found: ${keyId}`);
      }
      const privateKey = this.decryptKey(encryptedKey);

      // Remove 0x prefix from hash and private key for noble-curves
      const hashBytes = Buffer.from(hash.slice(2), 'hex');
      const privateKeyBytes = Buffer.from(privateKey.slice(2), 'hex');

      // Sign the hash directly using secp256k1 (no EIP-191 prefix!)
      const sig = secp256k1.sign(hashBytes, privateKeyBytes);

      // Extract r, s, and recovery (v)
      const r = sig.r;
      const s = sig.s;
      const recovery = sig.recovery; // 0 or 1

      // Convert to v value (27 or 28 for legacy transactions)
      const v = recovery + 27;

      const durationMs = Date.now() - startTime;
      signerLog.kmsOperation(this.logger, requestId, 'sign', true, keyId, durationMs);

      // Build the full signature hex (r + s + v)
      const rHex = bigintToHex32(r);
      const sHex = bigintToHex32(s);
      const vHex = v.toString(16).padStart(2, '0');
      const fullSignature = `${rHex}${sHex.slice(2)}${vHex}` as Hex;

      return {
        r: rHex,
        s: sHex,
        v,
        signature: fullSignature,
      };
    } catch (error) {
      signerLog.kmsOperation(
        this.logger,
        requestId,
        'sign',
        false,
        keyId,
        undefined,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Sign typed data hash (EIP-712)
   */
  async signTypedDataHash(keyId: string, typedDataHash: Hash): Promise<SignatureResult> {
    return this.signHash(keyId, typedDataHash);
  }

  /**
   * Sign a transaction hash
   */
  async signTransaction(keyId: string, txHash: Hash): Promise<SignatureResult> {
    return this.signHash(keyId, txHash);
  }

  /**
   * Validate configuration
   */
  validateConfig(): void {
    if (!this.masterKey || this.masterKey.length !== 32) {
      throw new Error('Master key is not properly configured');
    }
    this.logger.debug({ msg: 'Local dev signer configured' });
  }

  /**
   * Store an existing encrypted key (for loading from database)
   */
  loadKey(keyId: string, encryptedKey: string): void {
    localKeyStore.set(keyId, encryptedKey);
  }

  /**
   * Get the encrypted key for storage
   */
  getEncryptedKey(keyId: string): string | undefined {
    return localKeyStore.get(keyId);
  }

  /**
   * Get the LocalAccount for a key ID
   */
  private async getAccount(keyId: string): Promise<LocalAccount> {
    const encryptedKey = localKeyStore.get(keyId);

    if (!encryptedKey) {
      throw new Error(`Key not found: ${keyId}`);
    }

    const privateKey = this.decryptKey(encryptedKey);
    return privateKeyToAccount(privateKey as `0x${string}`);
  }

  /**
   * Encrypt a private key using AES-256-GCM
   */
  private encryptKey(privateKey: string): string {
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
   * Decrypt an encrypted key string
   */
  private decryptKey(encryptedKey: string): string {
    const parts = encryptedKey.split(':');

    if (parts.length !== 3) {
      throw new Error('Invalid encrypted key format. Expected IV:AuthTag:Ciphertext');
    }

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
