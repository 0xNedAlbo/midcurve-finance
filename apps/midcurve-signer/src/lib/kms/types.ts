/**
 * KMS Signer Types
 *
 * Type definitions for the KMS signing infrastructure.
 */

import type { Address, Hex, Hash } from 'viem';

/**
 * Result from creating a new KMS-backed wallet
 */
export interface KmsWalletCreationResult {
  /** AWS KMS Key ID or ARN */
  keyId: string;
  /** Derived Ethereum address from the KMS public key */
  walletAddress: Address;
  /**
   * Encrypted private key (LocalDevSigner only)
   * Must be stored in database for persistence across restarts.
   * For AWS KMS, this is undefined as keys never leave the HSM.
   */
  encryptedPrivateKey?: string;
}

/**
 * Configuration for AWS KMS signer
 */
export interface AwsKmsSignerConfig {
  /** AWS region (default: from env or us-east-1) */
  region?: string;
  /** Optional AWS access key ID (uses default credential chain if not provided) */
  accessKeyId?: string;
  /** Optional AWS secret access key */
  secretAccessKey?: string;
}

/**
 * Configuration for local development signer
 */
export interface LocalSignerConfig {
  /** Master encryption key (32 bytes / 64 hex characters) */
  masterKey?: string;
}

/**
 * Signature result from KMS or local signer
 */
export interface SignatureResult {
  /** Signature r value */
  r: Hex;
  /** Signature s value */
  s: Hex;
  /** Recovery ID (0 or 1) */
  v: number;
  /** Full signature in Ethereum format */
  signature: Hex;
}

/**
 * Signer interface for the midcurve-signer app
 *
 * Unlike the SigningKeyProvider interface which expects encrypted keys,
 * this interface works directly with KMS key IDs (the key never leaves KMS).
 */
export interface EvmSigner {
  /**
   * Create a new signing key and return the key ID and derived wallet address
   */
  createKey(label: string): Promise<KmsWalletCreationResult>;

  /**
   * Get the Ethereum address for a KMS key
   */
  getAddress(keyId: string): Promise<Address>;

  /**
   * Sign a message hash
   *
   * @param keyId - KMS key ID or local key identifier
   * @param hash - 32-byte hash to sign (keccak256 of message)
   * @returns Ethereum signature (r, s, v)
   */
  signHash(keyId: string, hash: Hash): Promise<SignatureResult>;

  /**
   * Sign typed data (EIP-712)
   *
   * @param keyId - KMS key ID or local key identifier
   * @param typedDataHash - Hash of the typed data (using hashTypedData from viem)
   * @returns Ethereum signature
   */
  signTypedDataHash(keyId: string, typedDataHash: Hash): Promise<SignatureResult>;

  /**
   * Sign a transaction
   *
   * @param keyId - KMS key ID or local key identifier
   * @param txHash - Transaction hash to sign
   * @returns Ethereum signature
   */
  signTransaction(keyId: string, txHash: Hash): Promise<SignatureResult>;

  /**
   * Validate signer configuration
   */
  validateConfig(): void;
}
