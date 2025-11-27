/**
 * LocalEncryptedKeyProvider Tests
 *
 * Unit tests for AES-256-GCM encryption/decryption of private keys.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalEncryptedKeyProvider } from './local-encrypted-provider.js';
import { privateKeyToAddress } from 'viem/accounts';

// Test fixtures
const TEST_MASTER_KEY =
  'a'.repeat(64); // 64 hex chars = 32 bytes
const VALID_PRIVATE_KEY =
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const EXPECTED_ADDRESS = privateKeyToAddress(VALID_PRIVATE_KEY);

describe('LocalEncryptedKeyProvider', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Save original env var
    originalEnv = process.env.HYPERLIQUID_WALLET_ENCRYPTION_KEY;
  });

  afterEach(() => {
    // Restore original env var
    if (originalEnv !== undefined) {
      process.env.HYPERLIQUID_WALLET_ENCRYPTION_KEY = originalEnv;
    } else {
      delete process.env.HYPERLIQUID_WALLET_ENCRYPTION_KEY;
    }
  });

  // ===========================================================================
  // Constructor
  // ===========================================================================

  describe('constructor', () => {
    it('should accept master key from config', () => {
      // Act & Assert - Should not throw
      const provider = new LocalEncryptedKeyProvider({
        masterKey: TEST_MASTER_KEY,
      });
      expect(provider.providerType).toBe('local-encrypted');
    });

    it('should accept master key from environment variable', () => {
      // Arrange
      process.env.HYPERLIQUID_WALLET_ENCRYPTION_KEY = TEST_MASTER_KEY;

      // Act & Assert - Should not throw
      const provider = new LocalEncryptedKeyProvider();
      expect(provider.providerType).toBe('local-encrypted');
    });

    it('should throw if master key is missing', () => {
      // Arrange
      delete process.env.HYPERLIQUID_WALLET_ENCRYPTION_KEY;

      // Act & Assert
      expect(() => new LocalEncryptedKeyProvider()).toThrow(
        'HYPERLIQUID_WALLET_ENCRYPTION_KEY environment variable is required'
      );
    });

    it('should throw if master key is too short', () => {
      // Act & Assert
      expect(
        () => new LocalEncryptedKeyProvider({ masterKey: 'a'.repeat(32) })
      ).toThrow('must be exactly 64 hex characters');
    });

    it('should throw if master key is too long', () => {
      // Act & Assert
      expect(
        () => new LocalEncryptedKeyProvider({ masterKey: 'a'.repeat(128) })
      ).toThrow('must be exactly 64 hex characters');
    });

    it('should throw if master key contains invalid characters', () => {
      // Act & Assert
      expect(
        () => new LocalEncryptedKeyProvider({ masterKey: 'g'.repeat(64) })
      ).toThrow('must be exactly 64 hex characters');
    });
  });

  // ===========================================================================
  // storeKey
  // ===========================================================================

  describe('storeKey', () => {
    let provider: LocalEncryptedKeyProvider;

    beforeEach(() => {
      provider = new LocalEncryptedKeyProvider({ masterKey: TEST_MASTER_KEY });
    });

    it('should encrypt a valid private key', async () => {
      // Act
      const encrypted = await provider.storeKey(VALID_PRIVATE_KEY);

      // Assert - Should return formatted string
      expect(typeof encrypted).toBe('string');
      expect(encrypted).toContain(':'); // Format: IV:AuthTag:Ciphertext
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(3);
    });

    it('should return different ciphertext for same key (random IV)', async () => {
      // Act
      const encrypted1 = await provider.storeKey(VALID_PRIVATE_KEY);
      const encrypted2 = await provider.storeKey(VALID_PRIVATE_KEY);

      // Assert - Different IVs should produce different outputs
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should throw for invalid private key format (missing 0x)', async () => {
      // Act & Assert
      await expect(
        provider.storeKey('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef')
      ).rejects.toThrow('Invalid private key format');
    });

    it('should throw for invalid private key format (too short)', async () => {
      // Act & Assert
      await expect(provider.storeKey('0x1234')).rejects.toThrow(
        'Invalid private key format'
      );
    });

    it('should throw for invalid private key format (too long)', async () => {
      // Act & Assert
      await expect(
        provider.storeKey('0x' + 'a'.repeat(128))
      ).rejects.toThrow('Invalid private key format');
    });

    it('should produce base64-encoded parts', async () => {
      // Act
      const encrypted = await provider.storeKey(VALID_PRIVATE_KEY);
      const parts = encrypted.split(':');

      // Assert - Each part should be valid base64
      for (const part of parts) {
        expect(() => Buffer.from(part, 'base64')).not.toThrow();
      }
    });
  });

  // ===========================================================================
  // getLocalAccount
  // ===========================================================================

  describe('getLocalAccount', () => {
    let provider: LocalEncryptedKeyProvider;

    beforeEach(() => {
      provider = new LocalEncryptedKeyProvider({ masterKey: TEST_MASTER_KEY });
    });

    it('should decrypt and return a LocalAccount', async () => {
      // Arrange
      const encrypted = await provider.storeKey(VALID_PRIVATE_KEY);

      // Act
      const account = await provider.getLocalAccount(encrypted);

      // Assert
      expect(account.address).toBe(EXPECTED_ADDRESS);
    });

    it('should be able to sign messages', async () => {
      // Arrange
      const encrypted = await provider.storeKey(VALID_PRIVATE_KEY);
      const account = await provider.getLocalAccount(encrypted);

      // Act
      const signature = await account.signMessage({ message: 'test' });

      // Assert
      expect(signature).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(signature.length).toBe(132); // 65 bytes = 130 hex + '0x'
    });

    it('should throw for invalid encrypted format (wrong parts count)', async () => {
      // Act & Assert
      await expect(provider.getLocalAccount('invalid')).rejects.toThrow(
        'Invalid encrypted key format'
      );
    });

    it('should throw for invalid encrypted format (two parts)', async () => {
      // Act & Assert
      await expect(provider.getLocalAccount('part1:part2')).rejects.toThrow(
        'Invalid encrypted key format'
      );
    });

    it('should throw for tampered ciphertext (authentication failure)', async () => {
      // Arrange
      const encrypted = await provider.storeKey(VALID_PRIVATE_KEY);
      const parts = encrypted.split(':');
      // Tamper with ciphertext
      const tamperedCiphertext = Buffer.from('tampered').toString('base64');
      const tampered = `${parts[0]}:${parts[1]}:${tamperedCiphertext}`;

      // Act & Assert
      await expect(provider.getLocalAccount(tampered)).rejects.toThrow();
    });

    it('should throw for tampered auth tag', async () => {
      // Arrange
      const encrypted = await provider.storeKey(VALID_PRIVATE_KEY);
      const parts = encrypted.split(':');
      // Tamper with auth tag
      const tamperedTag = Buffer.from('a'.repeat(16)).toString('base64');
      const tampered = `${parts[0]}:${tamperedTag}:${parts[2]}`;

      // Act & Assert
      await expect(provider.getLocalAccount(tampered)).rejects.toThrow();
    });

    it('should throw for wrong master key', async () => {
      // Arrange
      const encrypted = await provider.storeKey(VALID_PRIVATE_KEY);
      const otherProvider = new LocalEncryptedKeyProvider({
        masterKey: 'b'.repeat(64),
      });

      // Act & Assert
      await expect(otherProvider.getLocalAccount(encrypted)).rejects.toThrow();
    });
  });

  // ===========================================================================
  // Round-trip Tests
  // ===========================================================================

  describe('round-trip', () => {
    let provider: LocalEncryptedKeyProvider;

    beforeEach(() => {
      provider = new LocalEncryptedKeyProvider({ masterKey: TEST_MASTER_KEY });
    });

    it('should successfully round-trip a private key', async () => {
      // Arrange
      const privateKey =
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      const expectedAddress = privateKeyToAddress(privateKey);

      // Act
      const encrypted = await provider.storeKey(privateKey);
      const account = await provider.getLocalAccount(encrypted);

      // Assert
      expect(account.address).toBe(expectedAddress);
    });

    it('should work with multiple different private keys', async () => {
      // Arrange
      const keys = [
        '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        '0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      ];

      for (const privateKey of keys) {
        // Act
        const encrypted = await provider.storeKey(privateKey);
        const account = await provider.getLocalAccount(encrypted);

        // Assert
        expect(account.address).toBe(privateKeyToAddress(privateKey));
      }
    });
  });

  // ===========================================================================
  // validateConfig
  // ===========================================================================

  describe('validateConfig', () => {
    it('should not throw for valid configuration', () => {
      // Arrange
      const provider = new LocalEncryptedKeyProvider({
        masterKey: TEST_MASTER_KEY,
      });

      // Act & Assert
      expect(() => provider.validateConfig()).not.toThrow();
    });
  });
});
