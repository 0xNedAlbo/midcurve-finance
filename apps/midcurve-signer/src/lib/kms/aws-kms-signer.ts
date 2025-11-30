/**
 * AWS KMS Signer
 *
 * Production-grade signer using AWS KMS with ECDSA secp256k1 keys.
 * The private key NEVER leaves the KMS Hardware Security Module (HSM).
 *
 * SECURITY:
 * - Key generation happens inside KMS HSM
 * - Signing operations use KMS API (key never exposed)
 * - Only public key and signatures are returned
 * - All operations are auditable via CloudTrail
 *
 * Key Specification: ECC_SECG_P256K1 (secp256k1, same as Ethereum)
 * Key Usage: SIGN_VERIFY
 */

import {
  KMSClient,
  CreateKeyCommand,
  GetPublicKeyCommand,
  SignCommand,
  KeyUsageType,
  KeySpec,
  SigningAlgorithmSpec,
  type CreateKeyCommandInput,
} from '@aws-sdk/client-kms';
import { type Address, type Hash, type Hex } from 'viem';
import { publicKeyToAddress } from 'viem/accounts';
import type { EvmSigner, AwsKmsSignerConfig, KmsWalletCreationResult, SignatureResult } from './types';
import { signerLogger, signerLog } from '../logger';

/**
 * Parse DER-encoded ECDSA signature to r and s values
 *
 * DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
 */
function parseDerSignature(derSignature: Uint8Array): { r: bigint; s: bigint } {
  // Validate DER structure
  if (derSignature[0] !== 0x30) {
    throw new Error('Invalid DER signature: missing sequence tag');
  }

  let offset = 2; // Skip sequence tag and length

  // Parse r
  if (derSignature[offset] !== 0x02) {
    throw new Error('Invalid DER signature: missing r integer tag');
  }
  offset++;

  const rLength = derSignature[offset]!;
  offset++;

  // r might have leading zero if high bit is set (to indicate positive number)
  let rStart = offset;
  let rLen = rLength;
  if (derSignature[rStart] === 0x00 && rLen > 1) {
    rStart++;
    rLen--;
  }

  const rBytes = derSignature.slice(rStart, offset + rLength);
  offset += rLength;

  // Parse s
  if (derSignature[offset] !== 0x02) {
    throw new Error('Invalid DER signature: missing s integer tag');
  }
  offset++;

  const sLength = derSignature[offset]!;
  offset++;

  let sStart = offset;
  let sLen = sLength;
  if (derSignature[sStart] === 0x00 && sLen > 1) {
    sStart++;
    sLen--;
  }

  const sBytes = derSignature.slice(sStart, offset + sLength);

  // Convert to bigint
  const r = BigInt('0x' + Buffer.from(rBytes).toString('hex'));
  const s = BigInt('0x' + Buffer.from(sBytes).toString('hex'));

  return { r, s };
}

/**
 * Normalize s value to low-s form (EIP-2)
 *
 * secp256k1 curve order n
 */
const SECP256K1_N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
const SECP256K1_HALF_N = SECP256K1_N / 2n;

function normalizeS(s: bigint): bigint {
  // If s > n/2, use n - s (low-s normalization per EIP-2)
  if (s > SECP256K1_HALF_N) {
    return SECP256K1_N - s;
  }
  return s;
}

/**
 * Convert bigint to 32-byte hex string
 */
function bigintToHex32(value: bigint): Hex {
  const hex = value.toString(16).padStart(64, '0');
  return `0x${hex}` as Hex;
}

/**
 * Parse uncompressed public key and derive Ethereum address
 *
 * KMS returns public key in DER/SPKI format:
 * 30 [len] 30 [len] 06 [oid-len] [oid] ... 03 [len] 00 04 [x: 32 bytes] [y: 32 bytes]
 */
function parsePublicKeyAndDeriveAddress(publicKeyDer: Uint8Array): Address {
  // Find the uncompressed point (starts with 0x04)
  // The public key is at the end of the DER structure
  // Look for 0x04 followed by 64 bytes (x and y coordinates)
  let offset = publicKeyDer.length - 65;

  // Scan backwards to find 0x04
  while (offset >= 0 && publicKeyDer[offset] !== 0x04) {
    offset--;
  }

  if (offset < 0 || publicKeyDer[offset] !== 0x04) {
    throw new Error('Could not find uncompressed public key in DER structure');
  }

  // Extract 65-byte uncompressed public key (04 || x || y)
  const uncompressedKey = publicKeyDer.slice(offset, offset + 65);

  // Use viem's publicKeyToAddress (expects 0x04... format)
  const publicKeyHex = `0x${Buffer.from(uncompressedKey).toString('hex')}` as Hex;

  // publicKeyToAddress expects compressed or uncompressed public key
  // For uncompressed, it needs the full 65 bytes starting with 04
  return publicKeyToAddress(publicKeyHex);
}

export class AwsKmsSigner implements EvmSigner {
  private readonly client: KMSClient;
  private readonly logger = signerLogger.child({ component: 'AwsKmsSigner' });

  // Cache for public keys (keyId -> address)
  private readonly addressCache = new Map<string, Address>();

  constructor(config: AwsKmsSignerConfig = {}) {
    const region = config.region ?? process.env.AWS_REGION ?? 'us-east-1';

    this.client = new KMSClient({
      region,
      ...(config.accessKeyId && config.secretAccessKey
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }
        : {}),
    });
  }

  /**
   * Create a new KMS key for Ethereum signing
   */
  async createKey(label: string): Promise<KmsWalletCreationResult> {
    const requestId = `create-${Date.now()}`;
    const startTime = Date.now();

    try {
      signerLog.methodEntry(this.logger, 'createKey', { label });

      const input: CreateKeyCommandInput = {
        KeySpec: KeySpec.ECC_SECG_P256K1,
        KeyUsage: KeyUsageType.SIGN_VERIFY,
        Description: `Midcurve EVM Automation Wallet: ${label}`,
        Tags: [
          { TagKey: 'Application', TagValue: 'MidcurveSigner' },
          { TagKey: 'Label', TagValue: label },
          { TagKey: 'CreatedAt', TagValue: new Date().toISOString() },
        ],
      };

      const command = new CreateKeyCommand(input);
      const response = await this.client.send(command);

      if (!response.KeyMetadata?.KeyId) {
        throw new Error('KMS CreateKey did not return a KeyId');
      }

      const keyId = response.KeyMetadata.KeyId;

      // Get the public key and derive the Ethereum address
      const walletAddress = await this.getAddress(keyId);

      const durationMs = Date.now() - startTime;
      signerLog.kmsOperation(this.logger, requestId, 'createKey', true, keyId, durationMs);

      return { keyId, walletAddress };
    } catch (error) {
      signerLog.kmsOperation(
        this.logger,
        requestId,
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
   * Get Ethereum address for a KMS key
   */
  async getAddress(keyId: string): Promise<Address> {
    // Check cache first
    const cached = this.addressCache.get(keyId);
    if (cached) {
      return cached;
    }

    const requestId = `getpub-${Date.now()}`;
    const startTime = Date.now();

    try {
      const command = new GetPublicKeyCommand({ KeyId: keyId });
      const response = await this.client.send(command);

      if (!response.PublicKey) {
        throw new Error('KMS GetPublicKey did not return a public key');
      }

      const address = parsePublicKeyAndDeriveAddress(response.PublicKey);

      // Cache the result
      this.addressCache.set(keyId, address);

      const durationMs = Date.now() - startTime;
      signerLog.kmsOperation(this.logger, requestId, 'getPublicKey', true, keyId, durationMs);

      return address;
    } catch (error) {
      signerLog.kmsOperation(
        this.logger,
        requestId,
        'getPublicKey',
        false,
        keyId,
        undefined,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  /**
   * Sign a 32-byte hash using KMS
   */
  async signHash(keyId: string, hash: Hash): Promise<SignatureResult> {
    const requestId = `sign-${Date.now()}`;
    const startTime = Date.now();

    try {
      // Convert hash to Uint8Array
      const hashBytes = Buffer.from(hash.slice(2), 'hex');

      if (hashBytes.length !== 32) {
        throw new Error(`Hash must be 32 bytes, got ${hashBytes.length}`);
      }

      const command = new SignCommand({
        KeyId: keyId,
        Message: hashBytes,
        MessageType: 'DIGEST',
        SigningAlgorithm: SigningAlgorithmSpec.ECDSA_SHA_256,
      });

      const response = await this.client.send(command);

      if (!response.Signature) {
        throw new Error('KMS Sign did not return a signature');
      }

      // Parse DER signature
      const { r, s: rawS } = parseDerSignature(response.Signature);

      // Normalize s to low-s form (EIP-2)
      const s = normalizeS(rawS);

      // Get the address to recover v
      const address = await this.getAddress(keyId);

      // Try both recovery IDs (27 and 28, or 0 and 1)
      const v = await this.recoverV(hash, r, s, address);

      const rHex = bigintToHex32(r);
      const sHex = bigintToHex32(s);

      // Combine into full signature (r || s || v)
      const signature = (rHex + sHex.slice(2) + v.toString(16).padStart(2, '0')) as Hex;

      const durationMs = Date.now() - startTime;
      signerLog.kmsOperation(this.logger, requestId, 'sign', true, keyId, durationMs);

      return { r: rHex, s: sHex, v, signature };
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
   * Validate KMS configuration
   */
  validateConfig(): void {
    // The KMS client will throw on first use if misconfigured
    // We could add a DescribeKey call here for eager validation
    this.logger.debug({ msg: 'AWS KMS signer configured' });
  }

  /**
   * Recover the v value by trying both possible recovery IDs
   */
  private async recoverV(hash: Hash, r: bigint, s: bigint, expectedAddress: Address): Promise<number> {
    // Try v = 27 first (recovery id 0)
    const sig27 = (bigintToHex32(r) + bigintToHex32(s).slice(2) + '1b') as Hex;
    try {
      const { recoverAddress } = await import('viem');
      const recovered27 = await recoverAddress({ hash, signature: sig27 });
      if (recovered27.toLowerCase() === expectedAddress.toLowerCase()) {
        return 27;
      }
    } catch {
      // Try v = 28
    }

    // Try v = 28 (recovery id 1)
    const sig28 = (bigintToHex32(r) + bigintToHex32(s).slice(2) + '1c') as Hex;
    try {
      const { recoverAddress } = await import('viem');
      const recovered28 = await recoverAddress({ hash, signature: sig28 });
      if (recovered28.toLowerCase() === expectedAddress.toLowerCase()) {
        return 28;
      }
    } catch {
      // Neither worked
    }

    throw new Error('Could not recover valid v value for signature');
  }
}
