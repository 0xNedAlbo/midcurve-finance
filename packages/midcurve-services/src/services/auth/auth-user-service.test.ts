/**
 * AuthUserService Tests
 *
 * Unit tests for AuthUserService user and wallet management.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@midcurve/database';
import { AuthUserService } from './auth-user-service.js';
import {
  ALICE,
  BOB,
  CHARLIE,
  ALICE_ETHEREUM_WALLET,
  ALICE_ARBITRUM_WALLET,
  BOB_BASE_WALLET,
  UNREGISTERED_WALLET,
  createUserFixture,
  createWalletFixture,
} from './test-fixtures.js';

describe('AuthUserService', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let authUserService: AuthUserService;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    authUserService = new AuthUserService({ prisma: prismaMock });
  });

  // ===========================================================================
  // User Methods
  // ===========================================================================

  describe('findUserById', () => {
    it('should find user by id with relations', async () => {
      // Arrange
      const userWithRelations = {
        ...ALICE.dbResult,
        walletAddresses: [ALICE_ETHEREUM_WALLET.dbResult],
      };
      prismaMock.user.findUnique.mockResolvedValue(userWithRelations as any);

      // Act
      const result = await authUserService.findUserById('user_alice_001');

      // Assert
      expect(result).toEqual(userWithRelations);
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user_alice_001' },
        include: {
          walletAddresses: true,
        },
      });
    });

    it('should return null if user not found', async () => {
      // Arrange
      prismaMock.user.findUnique.mockResolvedValue(null);

      // Act
      const result = await authUserService.findUserById('nonexistent_id');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findUserByWallet', () => {
    it('should find user by wallet address and chain id', async () => {
      // Arrange
      const walletWithUser = {
        ...ALICE_ETHEREUM_WALLET.dbResult,
        user: ALICE.dbResult,
      };
      prismaMock.authWalletAddress.findUnique.mockResolvedValue(walletWithUser as any);

      // Act
      const result = await authUserService.findUserByWallet(
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        1
      );

      // Assert
      expect(result).toEqual(ALICE.dbResult);
      expect(prismaMock.authWalletAddress.findUnique).toHaveBeenCalledWith({
        where: {
          address_chainId: {
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            chainId: 1,
          },
        },
        include: { user: true },
      });
    });

    it('should normalize address before lookup (lowercase)', async () => {
      // Arrange
      const walletWithUser = {
        ...ALICE_ETHEREUM_WALLET.dbResult,
        user: ALICE.dbResult,
      };
      prismaMock.authWalletAddress.findUnique.mockResolvedValue(walletWithUser as any);

      // Act - Pass lowercase address
      await authUserService.findUserByWallet(
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        1
      );

      // Assert - Should be normalized to EIP-55 checksum
      expect(prismaMock.authWalletAddress.findUnique).toHaveBeenCalledWith({
        where: {
          address_chainId: {
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            chainId: 1,
          },
        },
        include: { user: true },
      });
    });

    it('should return null if wallet not registered', async () => {
      // Arrange
      prismaMock.authWalletAddress.findUnique.mockResolvedValue(null);

      // Act
      const result = await authUserService.findUserByWallet(UNREGISTERED_WALLET.address, 1);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('createUser', () => {
    it('should create user with initial wallet', async () => {
      // Arrange
      const userWithWallet = {
        ...ALICE.dbResult,
        walletAddresses: [ALICE_ETHEREUM_WALLET.dbResult],
      };
      prismaMock.user.create.mockResolvedValue(userWithWallet as any);

      // Act
      const result = await authUserService.createUser(ALICE.input);

      // Assert
      expect(result).toEqual(userWithWallet);
      expect(prismaMock.user.create).toHaveBeenCalledWith({
        data: {
          name: ALICE.input.name,
          email: ALICE.input.email,
          image: ALICE.input.image,
          walletAddresses: {
            create: {
              address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
              chainId: 1,
              isPrimary: true,
            },
          },
        },
        include: {
          walletAddresses: true,
        },
      });
    });

    it('should create user without wallet', async () => {
      // Arrange
      prismaMock.user.create.mockResolvedValue(BOB.dbResult);

      // Act
      const result = await authUserService.createUser(BOB.input);

      // Assert
      expect(result).toEqual(BOB.dbResult);
      expect(prismaMock.user.create).toHaveBeenCalledWith({
        data: {
          name: BOB.input.name,
          email: BOB.input.email,
          image: BOB.input.image,
        },
      });
    });

    it('should create user with email but no image', async () => {
      // Arrange
      prismaMock.user.create.mockResolvedValue(CHARLIE.dbResult);

      // Act
      const result = await authUserService.createUser(CHARLIE.input);

      // Assert
      expect(result.email).toBe('charlie@example.com');
      expect(result.image).toBeNull();
    });
  });

  describe('updateUser', () => {
    it('should update user profile fields', async () => {
      // Arrange
      const updatedUser = {
        ...ALICE.dbResult,
        name: 'Alice Smith',
        updatedAt: new Date('2024-01-10T00:00:00.000Z'),
      };
      prismaMock.user.update.mockResolvedValue(updatedUser);

      // Act
      const result = await authUserService.updateUser('user_alice_001', {
        name: 'Alice Smith',
      });

      // Assert
      expect(result.name).toBe('Alice Smith');
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user_alice_001' },
        data: { name: 'Alice Smith' },
      });
    });

    it('should update email and image', async () => {
      // Arrange
      const updatedUser = {
        ...BOB.dbResult,
        email: 'bob@example.com',
        image: 'https://example.com/bob.png',
      };
      prismaMock.user.update.mockResolvedValue(updatedUser);

      // Act
      const result = await authUserService.updateUser('user_bob_001', {
        email: 'bob@example.com',
        image: 'https://example.com/bob.png',
      });

      // Assert
      expect(result.email).toBe('bob@example.com');
      expect(result.image).toBe('https://example.com/bob.png');
    });
  });

  // ===========================================================================
  // Wallet Methods
  // ===========================================================================

  describe('findWalletByAddress', () => {
    it('should find wallet by address and chain id', async () => {
      // Arrange
      const walletWithUser = {
        ...ALICE_ETHEREUM_WALLET.dbResult,
        user: ALICE.dbResult,
      };
      prismaMock.authWalletAddress.findUnique.mockResolvedValue(walletWithUser as any);

      // Act
      const result = await authUserService.findWalletByAddress(
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        1
      );

      // Assert
      expect(result).toEqual(walletWithUser);
    });

    it('should normalize address before lookup', async () => {
      // Arrange
      prismaMock.authWalletAddress.findUnique.mockResolvedValue(null);

      // Act
      await authUserService.findWalletByAddress(
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        1
      );

      // Assert - Normalized address used
      expect(prismaMock.authWalletAddress.findUnique).toHaveBeenCalledWith({
        where: {
          address_chainId: {
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            chainId: 1,
          },
        },
        include: { user: true },
      });
    });

    it('should return null if wallet not found', async () => {
      // Arrange
      prismaMock.authWalletAddress.findUnique.mockResolvedValue(null);

      // Act
      const result = await authUserService.findWalletByAddress(UNREGISTERED_WALLET.address, 1);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('createWallet', () => {
    it('should create wallet as non-primary', async () => {
      // Arrange
      prismaMock.authWalletAddress.create.mockResolvedValue(
        ALICE_ARBITRUM_WALLET.dbResult
      );

      // Act
      const result = await authUserService.createWallet(
        'user_alice_001',
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        42161,
        false
      );

      // Assert
      expect(result).toEqual(ALICE_ARBITRUM_WALLET.dbResult);
      expect(result.isPrimary).toBe(false);
      expect(prismaMock.authWalletAddress.create).toHaveBeenCalledWith({
        data: {
          userId: 'user_alice_001',
          address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
          chainId: 42161,
          isPrimary: false,
        },
      });
    });

    it('should create wallet as primary and unset other primaries', async () => {
      // Arrange
      const primaryWallet = { ...ALICE_ETHEREUM_WALLET.dbResult };
      prismaMock.authWalletAddress.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.authWalletAddress.create.mockResolvedValue(primaryWallet);

      // Act
      const result = await authUserService.createWallet(
        'user_alice_001',
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        1,
        true
      );

      // Assert
      expect(result.isPrimary).toBe(true);
      expect(prismaMock.authWalletAddress.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user_alice_001' },
        data: { isPrimary: false },
      });
    });

    it('should normalize address before creation', async () => {
      // Arrange
      prismaMock.authWalletAddress.create.mockResolvedValue(
        ALICE_ETHEREUM_WALLET.dbResult
      );

      // Act
      await authUserService.createWallet(
        'user_alice_001',
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        1,
        false
      );

      // Assert
      expect(prismaMock.authWalletAddress.create).toHaveBeenCalledWith({
        data: {
          userId: 'user_alice_001',
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          chainId: 1,
          isPrimary: false,
        },
      });
    });
  });

  describe('linkWallet', () => {
    it('should link new wallet to user', async () => {
      // Arrange
      prismaMock.authWalletAddress.findUnique.mockResolvedValue(null); // Wallet available
      prismaMock.authWalletAddress.create.mockResolvedValue(
        ALICE_ARBITRUM_WALLET.dbResult
      );

      // Act
      const result = await authUserService.linkWallet(
        'user_alice_001',
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        42161
      );

      // Assert
      expect(result).toEqual(ALICE_ARBITRUM_WALLET.dbResult);
      expect(result.isPrimary).toBe(false); // Linked wallets are not primary by default
    });

    it('should throw error if wallet already registered', async () => {
      // Arrange
      const existingWallet = {
        ...ALICE_ETHEREUM_WALLET.dbResult,
        user: ALICE.dbResult,
      };
      prismaMock.authWalletAddress.findUnique.mockResolvedValue(existingWallet as any);

      // Act & Assert
      await expect(
        authUserService.linkWallet(
          'user_bob_001',
          '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          1
        )
      ).rejects.toThrow('Wallet already registered to a user');
    });
  });

  describe('getUserWallets', () => {
    it('should return all wallets for user (primary first)', async () => {
      // Arrange
      const wallets = [
        ALICE_ETHEREUM_WALLET.dbResult, // Primary
        ALICE_ARBITRUM_WALLET.dbResult, // Secondary
      ];
      prismaMock.authWalletAddress.findMany.mockResolvedValue(wallets);

      // Act
      const result = await authUserService.getUserWallets('user_alice_001');

      // Assert
      expect(result).toEqual(wallets);
      expect(result[0].isPrimary).toBe(true);
      expect(result[1].isPrimary).toBe(false);
      expect(prismaMock.authWalletAddress.findMany).toHaveBeenCalledWith({
        where: { userId: 'user_alice_001' },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      });
    });

    it('should return empty array if user has no wallets', async () => {
      // Arrange
      prismaMock.authWalletAddress.findMany.mockResolvedValue([]);

      // Act
      const result = await authUserService.getUserWallets('user_new_001');

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('setPrimaryWallet', () => {
    it('should set wallet as primary', async () => {
      // Arrange
      prismaMock.authWalletAddress.findUnique.mockResolvedValue(
        ALICE_ARBITRUM_WALLET.dbResult
      );

      const updatedWallet = {
        ...ALICE_ARBITRUM_WALLET.dbResult,
        isPrimary: true,
      };

      prismaMock.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          authWalletAddress: {
            updateMany: async () => ({ count: 1 }),
            update: async () => updatedWallet,
          },
        };
        return callback(tx);
      });

      // Act
      const result = await authUserService.setPrimaryWallet(
        'user_alice_001',
        'wallet_alice_arb_001'
      );

      // Assert
      expect(result.isPrimary).toBe(true);
    });

    it('should throw error if wallet not found', async () => {
      // Arrange
      prismaMock.authWalletAddress.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        authUserService.setPrimaryWallet('user_alice_001', 'nonexistent_wallet')
      ).rejects.toThrow('Wallet not found or does not belong to user');
    });

    it('should throw error if wallet belongs to different user', async () => {
      // Arrange
      prismaMock.authWalletAddress.findUnique.mockResolvedValue(
        ALICE_ETHEREUM_WALLET.dbResult
      );

      // Act & Assert
      await expect(
        authUserService.setPrimaryWallet('user_bob_001', 'wallet_alice_eth_001')
      ).rejects.toThrow('Wallet not found or does not belong to user');
    });
  });

  describe('isWalletAvailable', () => {
    it('should return true if wallet is available', async () => {
      // Arrange
      prismaMock.authWalletAddress.findUnique.mockResolvedValue(null);

      // Act
      const result = await authUserService.isWalletAvailable(
        UNREGISTERED_WALLET.address,
        1
      );

      // Assert
      expect(result).toBe(true);
    });

    it('should return false if wallet is already registered', async () => {
      // Arrange
      const walletWithUser = {
        ...ALICE_ETHEREUM_WALLET.dbResult,
        user: ALICE.dbResult,
      };
      prismaMock.authWalletAddress.findUnique.mockResolvedValue(walletWithUser as any);

      // Act
      const result = await authUserService.isWalletAvailable(
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        1
      );

      // Assert
      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // Constructor
  // ===========================================================================

  describe('constructor', () => {
    it('should accept custom prisma client', () => {
      // Arrange & Act
      const customService = new AuthUserService({ prisma: prismaMock });

      // Assert
      expect(customService).toBeInstanceOf(AuthUserService);
    });

    it('should work without dependencies (uses default PrismaClient)', () => {
      // Arrange & Act
      const defaultService = new AuthUserService();

      // Assert
      expect(defaultService).toBeInstanceOf(AuthUserService);
    });
  });
});
