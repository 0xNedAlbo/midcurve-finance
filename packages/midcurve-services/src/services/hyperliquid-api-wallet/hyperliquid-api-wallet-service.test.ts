/**
 * HyperliquidApiWalletService Tests
 *
 * Unit tests for Hyperliquid API wallet management.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@midcurve/database';
import { privateKeyToAddress, privateKeyToAccount } from 'viem/accounts';
import { getAddress } from 'viem';

import { HyperliquidApiWalletService } from './hyperliquid-api-wallet-service.js';
import type { SigningKeyProvider } from '../../crypto/signing-key-provider.js';

// Test fixtures
const TEST_USER_ID = 'user_alice_001';
const TEST_PRIVATE_KEY =
  '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_WALLET_ADDRESS = getAddress(privateKeyToAddress(TEST_PRIVATE_KEY));
const TEST_ENCRYPTED_KEY = 'encrypted_key_data';
const TEST_WALLET_ID = 'wallet_001';

// Mock key provider
const createMockKeyProvider = (): SigningKeyProvider => ({
  providerType: 'local-encrypted',
  storeKey: vi.fn().mockResolvedValue(TEST_ENCRYPTED_KEY),
  getLocalAccount: vi.fn().mockResolvedValue(privateKeyToAccount(TEST_PRIVATE_KEY)),
  validateConfig: vi.fn(),
});

// Test expiration date (180 days from creation)
const TEST_EXPIRES_AT = new Date('2024-06-29T00:00:00.000Z');

// Database fixture factory
const createWalletDbRecord = (overrides: Partial<{
  id: string;
  userId: string;
  walletAddress: string;
  label: string;
  environment: string;
  encryptedPrivateKey: string;
  encryptionVersion: number;
  isActive: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}> = {}) => ({
  id: TEST_WALLET_ID,
  userId: TEST_USER_ID,
  walletAddress: TEST_WALLET_ADDRESS,
  label: 'Test Wallet',
  environment: 'mainnet',
  encryptedPrivateKey: TEST_ENCRYPTED_KEY,
  encryptionVersion: 1,
  isActive: true,
  lastUsedAt: null,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  expiresAt: TEST_EXPIRES_AT,
  ...overrides,
});

describe('HyperliquidApiWalletService', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let keyProviderMock: SigningKeyProvider;
  let service: HyperliquidApiWalletService;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    keyProviderMock = createMockKeyProvider();
    service = new HyperliquidApiWalletService({
      prisma: prismaMock,
      keyProvider: keyProviderMock,
    });
  });

  // ===========================================================================
  // registerWallet
  // ===========================================================================

  describe('registerWallet', () => {
    it('should register a new wallet successfully', async () => {
      // Arrange
      const dbRecord = createWalletDbRecord();
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(null);
      prismaMock.hyperliquidApiWallet.create.mockResolvedValue(dbRecord);

      // Act
      const result = await service.registerWallet({
        userId: TEST_USER_ID,
        privateKey: TEST_PRIVATE_KEY,
        label: 'Test Wallet',
        environment: 'mainnet',
        expiresAt: TEST_EXPIRES_AT,
      });

      // Assert
      expect(result.walletAddress).toBe(TEST_WALLET_ADDRESS);
      expect(result.label).toBe('Test Wallet');
      expect(result.environment).toBe('mainnet');
      expect(result.isActive).toBe(true);
      expect(result.expiresAt).toEqual(TEST_EXPIRES_AT);
      expect(keyProviderMock.storeKey).toHaveBeenCalledWith(TEST_PRIVATE_KEY);
    });

    it('should derive correct address from private key', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(null);
      prismaMock.hyperliquidApiWallet.create.mockResolvedValue(createWalletDbRecord());

      // Act
      await service.registerWallet({
        userId: TEST_USER_ID,
        privateKey: TEST_PRIVATE_KEY,
        label: 'Test',
        environment: 'mainnet',
        expiresAt: TEST_EXPIRES_AT,
      });

      // Assert
      expect(prismaMock.hyperliquidApiWallet.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          walletAddress: TEST_WALLET_ADDRESS,
        }),
      });
    });

    it('should throw for invalid private key format', async () => {
      // Act & Assert
      await expect(
        service.registerWallet({
          userId: TEST_USER_ID,
          privateKey: 'invalid',
          label: 'Test',
          environment: 'mainnet',
          expiresAt: TEST_EXPIRES_AT,
        })
      ).rejects.toThrow('Invalid private key format');
    });

    it('should throw for private key without 0x prefix', async () => {
      // Act & Assert
      await expect(
        service.registerWallet({
          userId: TEST_USER_ID,
          privateKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          label: 'Test',
          environment: 'mainnet',
          expiresAt: TEST_EXPIRES_AT,
        })
      ).rejects.toThrow('Invalid private key format');
    });

    it('should throw if wallet already exists and is active', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(
        createWalletDbRecord({ isActive: true })
      );

      // Act & Assert
      await expect(
        service.registerWallet({
          userId: TEST_USER_ID,
          privateKey: TEST_PRIVATE_KEY,
          label: 'Test',
          environment: 'mainnet',
          expiresAt: TEST_EXPIRES_AT,
        })
      ).rejects.toThrow('already registered');
    });

    it('should reactivate existing inactive wallet', async () => {
      // Arrange
      const inactiveWallet = createWalletDbRecord({ isActive: false });
      const reactivatedWallet = createWalletDbRecord({ isActive: true });
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(inactiveWallet);
      prismaMock.hyperliquidApiWallet.update.mockResolvedValue(reactivatedWallet);

      // Act
      const result = await service.registerWallet({
        userId: TEST_USER_ID,
        privateKey: TEST_PRIVATE_KEY,
        label: 'New Label',
        environment: 'mainnet',
        expiresAt: TEST_EXPIRES_AT,
      });

      // Assert
      expect(result.isActive).toBe(true);
      expect(prismaMock.hyperliquidApiWallet.update).toHaveBeenCalledWith({
        where: { id: inactiveWallet.id },
        data: expect.objectContaining({
          isActive: true,
          label: 'New Label',
        }),
      });
    });
  });

  // ===========================================================================
  // listWallets
  // ===========================================================================

  describe('listWallets', () => {
    it('should return all active wallets for user', async () => {
      // Arrange
      const wallets = [
        createWalletDbRecord({ id: 'wallet_1', label: 'Wallet 1' }),
        createWalletDbRecord({ id: 'wallet_2', label: 'Wallet 2' }),
      ];
      prismaMock.hyperliquidApiWallet.findMany.mockResolvedValue(wallets);

      // Act
      const result = await service.listWallets(TEST_USER_ID);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0].label).toBe('Wallet 1');
      expect(result[1].label).toBe('Wallet 2');
    });

    it('should filter by environment when provided', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findMany.mockResolvedValue([]);

      // Act
      await service.listWallets(TEST_USER_ID, 'testnet');

      // Assert
      expect(prismaMock.hyperliquidApiWallet.findMany).toHaveBeenCalledWith({
        where: {
          userId: TEST_USER_ID,
          isActive: true,
          environment: 'testnet',
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array if no wallets', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findMany.mockResolvedValue([]);

      // Act
      const result = await service.listWallets(TEST_USER_ID);

      // Assert
      expect(result).toEqual([]);
    });

    it('should not include encrypted key in results', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findMany.mockResolvedValue([
        createWalletDbRecord(),
      ]);

      // Act
      const result = await service.listWallets(TEST_USER_ID);

      // Assert
      expect(result[0]).not.toHaveProperty('encryptedPrivateKey');
    });
  });

  // ===========================================================================
  // getWallet
  // ===========================================================================

  describe('getWallet', () => {
    it('should return wallet info for valid wallet', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(
        createWalletDbRecord()
      );

      // Act
      const result = await service.getWallet(TEST_USER_ID, TEST_WALLET_ID);

      // Assert
      expect(result).not.toBeNull();
      expect(result?.id).toBe(TEST_WALLET_ID);
      expect(result?.walletAddress).toBe(TEST_WALLET_ADDRESS);
    });

    it('should return null if wallet not found', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(null);

      // Act
      const result = await service.getWallet(TEST_USER_ID, 'nonexistent');

      // Assert
      expect(result).toBeNull();
    });

    it('should return null if wallet belongs to different user', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(
        createWalletDbRecord({ userId: 'other_user' })
      );

      // Act
      const result = await service.getWallet(TEST_USER_ID, TEST_WALLET_ID);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null if wallet is inactive', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(
        createWalletDbRecord({ isActive: false })
      );

      // Act
      const result = await service.getWallet(TEST_USER_ID, TEST_WALLET_ID);

      // Assert
      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // revokeWallet
  // ===========================================================================

  describe('revokeWallet', () => {
    it('should deactivate wallet', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(
        createWalletDbRecord()
      );
      prismaMock.hyperliquidApiWallet.update.mockResolvedValue(
        createWalletDbRecord({ isActive: false })
      );

      // Act
      await service.revokeWallet(TEST_USER_ID, TEST_WALLET_ID);

      // Assert
      expect(prismaMock.hyperliquidApiWallet.update).toHaveBeenCalledWith({
        where: { id: TEST_WALLET_ID },
        data: { isActive: false },
      });
    });

    it('should throw if wallet not found', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.revokeWallet(TEST_USER_ID, 'nonexistent')
      ).rejects.toThrow('not found or does not belong to user');
    });

    it('should throw if wallet belongs to different user', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(
        createWalletDbRecord({ userId: 'other_user' })
      );

      // Act & Assert
      await expect(
        service.revokeWallet(TEST_USER_ID, TEST_WALLET_ID)
      ).rejects.toThrow('not found or does not belong to user');
    });

    it('should throw if wallet already revoked', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(
        createWalletDbRecord({ isActive: false })
      );

      // Act & Assert
      await expect(
        service.revokeWallet(TEST_USER_ID, TEST_WALLET_ID)
      ).rejects.toThrow('already revoked');
    });
  });

  // ===========================================================================
  // getLocalAccount
  // ===========================================================================

  describe('getLocalAccount', () => {
    it('should return LocalAccount for valid wallet', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(
        createWalletDbRecord()
      );
      prismaMock.hyperliquidApiWallet.update.mockResolvedValue(
        createWalletDbRecord()
      );

      // Act
      const account = await service.getLocalAccount(
        TEST_USER_ID,
        TEST_WALLET_ADDRESS,
        'mainnet'
      );

      // Assert
      expect(account.address).toBe(TEST_WALLET_ADDRESS);
      expect(keyProviderMock.getLocalAccount).toHaveBeenCalledWith(
        TEST_ENCRYPTED_KEY
      );
    });

    it('should throw if wallet not found', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.getLocalAccount(TEST_USER_ID, TEST_WALLET_ADDRESS, 'mainnet')
      ).rejects.toThrow('not found or revoked');
    });

    it('should throw if wallet is revoked', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(
        createWalletDbRecord({ isActive: false })
      );

      // Act & Assert
      await expect(
        service.getLocalAccount(TEST_USER_ID, TEST_WALLET_ADDRESS, 'mainnet')
      ).rejects.toThrow('not found or revoked');
    });

    it('should normalize wallet address', async () => {
      // Arrange
      const lowercaseAddress = TEST_WALLET_ADDRESS.toLowerCase();
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(
        createWalletDbRecord()
      );
      prismaMock.hyperliquidApiWallet.update.mockResolvedValue(
        createWalletDbRecord()
      );

      // Act
      await service.getLocalAccount(TEST_USER_ID, lowercaseAddress, 'mainnet');

      // Assert - Should query with normalized address
      expect(prismaMock.hyperliquidApiWallet.findUnique).toHaveBeenCalledWith({
        where: {
          userId_walletAddress_environment: {
            userId: TEST_USER_ID,
            walletAddress: TEST_WALLET_ADDRESS, // Checksummed
            environment: 'mainnet',
          },
        },
      });
    });
  });

  // ===========================================================================
  // testSign
  // ===========================================================================

  describe('testSign', () => {
    it('should sign message and return signature', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(
        createWalletDbRecord()
      );
      prismaMock.hyperliquidApiWallet.update.mockResolvedValue(
        createWalletDbRecord()
      );

      // Act
      const result = await service.testSign({
        userId: TEST_USER_ID,
        walletId: TEST_WALLET_ID,
        message: 'test message',
      });

      // Assert
      expect(result.signature).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(result.walletAddress).toBe(TEST_WALLET_ADDRESS);
    });

    it('should throw if wallet not found', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.testSign({
          userId: TEST_USER_ID,
          walletId: 'nonexistent',
          message: 'test',
        })
      ).rejects.toThrow('not found or unauthorized');
    });

    it('should throw if wallet belongs to different user', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(
        createWalletDbRecord({ userId: 'other_user' })
      );

      // Act & Assert
      await expect(
        service.testSign({
          userId: TEST_USER_ID,
          walletId: TEST_WALLET_ID,
          message: 'test',
        })
      ).rejects.toThrow('not found or unauthorized');
    });

    it('should update lastUsedAt after signing', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(
        createWalletDbRecord()
      );
      prismaMock.hyperliquidApiWallet.update.mockResolvedValue(
        createWalletDbRecord()
      );

      // Act
      await service.testSign({
        userId: TEST_USER_ID,
        walletId: TEST_WALLET_ID,
        message: 'test',
      });

      // Assert
      expect(prismaMock.hyperliquidApiWallet.update).toHaveBeenCalledWith({
        where: { id: TEST_WALLET_ID },
        data: { lastUsedAt: expect.any(Date) },
      });
    });
  });

  // ===========================================================================
  // hasActiveWallet
  // ===========================================================================

  describe('hasActiveWallet', () => {
    it('should return true for active wallet', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue({
        isActive: true,
      } as any);

      // Act
      const result = await service.hasActiveWallet(
        TEST_USER_ID,
        TEST_WALLET_ADDRESS,
        'mainnet'
      );

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for inactive wallet', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue({
        isActive: false,
      } as any);

      // Act
      const result = await service.hasActiveWallet(
        TEST_USER_ID,
        TEST_WALLET_ADDRESS,
        'mainnet'
      );

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for non-existent wallet', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(null);

      // Act
      const result = await service.hasActiveWallet(
        TEST_USER_ID,
        TEST_WALLET_ADDRESS,
        'mainnet'
      );

      // Assert
      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // Security Tests
  // ===========================================================================

  describe('Security', () => {
    it('should never expose encrypted key in wallet info', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findMany.mockResolvedValue([
        createWalletDbRecord(),
      ]);

      // Act
      const wallets = await service.listWallets(TEST_USER_ID);

      // Assert
      for (const wallet of wallets) {
        expect(wallet).not.toHaveProperty('encryptedPrivateKey');
        expect(wallet).not.toHaveProperty('encryptionVersion');
      }
    });

    it('should use key provider for encryption', async () => {
      // Arrange
      prismaMock.hyperliquidApiWallet.findUnique.mockResolvedValue(null);
      prismaMock.hyperliquidApiWallet.create.mockResolvedValue(
        createWalletDbRecord()
      );

      // Act
      await service.registerWallet({
        userId: TEST_USER_ID,
        privateKey: TEST_PRIVATE_KEY,
        label: 'Test',
        environment: 'mainnet',
        expiresAt: TEST_EXPIRES_AT,
      });

      // Assert - Key should be encrypted before storage
      expect(keyProviderMock.storeKey).toHaveBeenCalledWith(TEST_PRIVATE_KEY);
      expect(prismaMock.hyperliquidApiWallet.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          encryptedPrivateKey: TEST_ENCRYPTED_KEY,
        }),
      });
    });
  });
});
