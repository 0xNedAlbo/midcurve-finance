/**
 * Unit tests for UniswapV3QuoteTokenService
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import { PrismaClient } from '@midcurve/database';
import { UniswapV3QuoteTokenService } from './uniswapv3-quote-token-service.js';
import {
  SCENARIO_WETH_USDC_ETH,
  SCENARIO_USDC_LINK_ETH,
  SCENARIO_LINK_WETH_ETH,
  SCENARIO_UNI_LINK_ETH,
  SCENARIO_WETH_ARB_ARBITRUM,
  SCENARIO_USDC_USDT_ETH,
  SCENARIO_USDT_DAI_ETH,
  SCENARIO_USER_PREFERS_WETH,
  SCENARIO_CASE_INSENSITIVE,
  TEST_USER_IDS,
  TOKENS,
  createQuoteTokenInput,
} from './test-fixtures.js';
import { SupportedChainId } from '../../config/evm.js';

describe('UniswapV3QuoteTokenService', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let service: UniswapV3QuoteTokenService;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    service = new UniswapV3QuoteTokenService({ prisma: prismaMock });
  });

  // ============================================================================
  // Default Preference Tests
  // ============================================================================

  describe('determineQuoteToken - Default Preferences', () => {
    beforeEach(() => {
      // Mock: No user preferences
      prismaMock.userQuoteTokenPreference.findUnique.mockResolvedValue(null);
    });

    it('should determine USDC as quote for WETH/USDC (stablecoin priority)', async () => {
      const result = await service.determineQuoteToken(
        SCENARIO_WETH_USDC_ETH.input
      );

      expect(result).toMatchObject(SCENARIO_WETH_USDC_ETH.expected);
    });

    it('should determine USDC as quote for USDC/LINK (stablecoin priority)', async () => {
      const result = await service.determineQuoteToken(
        SCENARIO_USDC_LINK_ETH.input
      );

      expect(result).toMatchObject(SCENARIO_USDC_LINK_ETH.expected);
    });

    it('should determine WETH as quote for LINK/WETH (wrapped native priority)', async () => {
      const result = await service.determineQuoteToken(
        SCENARIO_LINK_WETH_ETH.input
      );

      expect(result).toMatchObject(SCENARIO_LINK_WETH_ETH.expected);
    });

    it('should use token0 as quote for UNI/LINK (fallback)', async () => {
      const result = await service.determineQuoteToken(
        SCENARIO_UNI_LINK_ETH.input
      );

      expect(result).toMatchObject(SCENARIO_UNI_LINK_ETH.expected);
    });

    it('should determine WETH as quote for WETH/ARB on Arbitrum', async () => {
      const result = await service.determineQuoteToken(
        SCENARIO_WETH_ARB_ARBITRUM.input
      );

      expect(result).toMatchObject(SCENARIO_WETH_ARB_ARBITRUM.expected);
    });

    it('should handle both tokens matching defaults (USDC > USDT)', async () => {
      const result = await service.determineQuoteToken(
        SCENARIO_USDC_USDT_ETH.input
      );

      expect(result).toMatchObject(SCENARIO_USDC_USDT_ETH.expected);
    });

    it('should handle both tokens matching defaults (USDT > DAI)', async () => {
      const result = await service.determineQuoteToken(
        SCENARIO_USDT_DAI_ETH.input
      );

      expect(result).toMatchObject(SCENARIO_USDT_DAI_ETH.expected);
    });

    it('should handle case-insensitive address matching', async () => {
      const result = await service.determineQuoteToken(
        SCENARIO_CASE_INSENSITIVE.input
      );

      expect(result.isToken0Quote).toBe(
        SCENARIO_CASE_INSENSITIVE.expected.isToken0Quote
      );
      expect(result.matchedBy).toBe(
        SCENARIO_CASE_INSENSITIVE.expected.matchedBy
      );
      // Addresses should be normalized to checksum format
      expect(result.quoteTokenId).toBe(TOKENS.ETHEREUM.USDC);
      expect(result.baseTokenId).toBe(TOKENS.ETHEREUM.WETH);
    });
  });

  // ============================================================================
  // User Preference Tests
  // ============================================================================

  describe('determineQuoteToken - User Preferences', () => {
    it('should use user preference over defaults', async () => {
      // Mock: User prefers WETH
      prismaMock.userQuoteTokenPreference.findUnique.mockResolvedValue({
        id: 'pref_001',
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: SCENARIO_USER_PREFERS_WETH.input.userId,
        protocol: 'uniswapv3',
        preferredQuoteTokens: SCENARIO_USER_PREFERS_WETH.userPreferences,
      });

      const result = await service.determineQuoteToken(
        SCENARIO_USER_PREFERS_WETH.input
      );

      expect(result).toMatchObject(SCENARIO_USER_PREFERS_WETH.expected);
    });

    it('should fall back to defaults if user preference does not match', async () => {
      // Mock: User prefers ARB (not in this pair)
      prismaMock.userQuoteTokenPreference.findUnique.mockResolvedValue({
        id: 'pref_002',
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: TEST_USER_IDS.ALICE,
        protocol: 'uniswapv3',
        preferredQuoteTokens: [TOKENS.ARBITRUM.ARB], // Not in WETH/USDC pair
      });

      const result = await service.determineQuoteToken(
        SCENARIO_WETH_USDC_ETH.input
      );

      // Should fall back to defaults (USDC)
      expect(result.matchedBy).toBe('default');
      expect(result.quoteTokenId).toBe(TOKENS.ETHEREUM.USDC);
    });

    it('should handle user preference with multiple tokens', async () => {
      // Mock: User prefers [LINK, WETH] - LINK has higher priority
      prismaMock.userQuoteTokenPreference.findUnique.mockResolvedValue({
        id: 'pref_003',
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: TEST_USER_IDS.CHARLIE,
        protocol: 'uniswapv3',
        preferredQuoteTokens: [TOKENS.ETHEREUM.LINK, TOKENS.ETHEREUM.WETH],
      });

      const input = createQuoteTokenInput({
        userId: TEST_USER_IDS.CHARLIE,
        token0Address: TOKENS.ETHEREUM.LINK,
        token1Address: TOKENS.ETHEREUM.WETH,
      });

      const result = await service.determineQuoteToken(input);

      expect(result.matchedBy).toBe('user_preference');
      expect(result.quoteTokenId).toBe(TOKENS.ETHEREUM.LINK);
      expect(result.baseTokenId).toBe(TOKENS.ETHEREUM.WETH);
    });

    it('should handle empty user preferences array', async () => {
      // Mock: User has empty preferences
      prismaMock.userQuoteTokenPreference.findUnique.mockResolvedValue({
        id: 'pref_004',
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: TEST_USER_IDS.ALICE,
        protocol: 'uniswapv3',
        preferredQuoteTokens: [],
      });

      const result = await service.determineQuoteToken(
        SCENARIO_WETH_USDC_ETH.input
      );

      // Should fall back to defaults
      expect(result.matchedBy).toBe('default');
      expect(result.quoteTokenId).toBe(TOKENS.ETHEREUM.USDC);
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('determineQuoteToken - Edge Cases', () => {
    beforeEach(() => {
      prismaMock.userQuoteTokenPreference.findUnique.mockResolvedValue(null);
    });

    it('should handle unsupported chain ID (no defaults)', async () => {
      const input = createQuoteTokenInput({
        chainId: 999999, // Unsupported chain
      });

      const result = await service.determineQuoteToken(input);

      // Should fall back to token0
      expect(result.matchedBy).toBe('fallback');
      expect(result.isToken0Quote).toBe(true);
    });

    it('should normalize addresses in result', async () => {
      const input = createQuoteTokenInput({
        token0Address: TOKENS.ETHEREUM.WETH.toLowerCase(),
        token1Address: TOKENS.ETHEREUM.USDC.toLowerCase(),
      });

      const result = await service.determineQuoteToken(input);

      // Result should have checksum addresses
      expect(result.quoteTokenId).toBe(TOKENS.ETHEREUM.USDC);
      expect(result.baseTokenId).toBe(TOKENS.ETHEREUM.WETH);
    });

    it('should throw error for invalid token0 address', async () => {
      const input = createQuoteTokenInput({
        token0Address: 'invalid',
      });

      await expect(service.determineQuoteToken(input)).rejects.toThrow();
    });

    it('should throw error for invalid token1 address', async () => {
      const input = createQuoteTokenInput({
        token1Address: '0x123', // Too short
      });

      await expect(service.determineQuoteToken(input)).rejects.toThrow();
    });
  });

  // ============================================================================
  // User Preference Management
  // ============================================================================

  describe('setUserPreferences', () => {
    it('should create new preferences for user', async () => {
      prismaMock.userQuoteTokenPreference.upsert.mockResolvedValue({
        id: 'pref_new',
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: TEST_USER_IDS.ALICE,
        protocol: 'uniswapv3',
        preferredQuoteTokens: [TOKENS.ETHEREUM.WETH],
      });

      await service.setUserPreferences(TEST_USER_IDS.ALICE, [
        TOKENS.ETHEREUM.WETH,
      ]);

      expect(prismaMock.userQuoteTokenPreference.upsert).toHaveBeenCalledWith({
        where: {
          userId_protocol: {
            userId: TEST_USER_IDS.ALICE,
            protocol: 'uniswapv3',
          },
        },
        update: {
          preferredQuoteTokens: [TOKENS.ETHEREUM.WETH],
        },
        create: {
          userId: TEST_USER_IDS.ALICE,
          protocol: 'uniswapv3',
          preferredQuoteTokens: [TOKENS.ETHEREUM.WETH],
        },
      });
    });

    it('should normalize addresses before saving', async () => {
      prismaMock.userQuoteTokenPreference.upsert.mockResolvedValue({
        id: 'pref_normalized',
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: TEST_USER_IDS.BOB,
        protocol: 'uniswapv3',
        preferredQuoteTokens: [TOKENS.ETHEREUM.WETH],
      });

      // Pass lowercase address
      await service.setUserPreferences(TEST_USER_IDS.BOB, [
        TOKENS.ETHEREUM.WETH.toLowerCase(),
      ]);

      // Should be normalized to checksum format
      expect(prismaMock.userQuoteTokenPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: {
            preferredQuoteTokens: [TOKENS.ETHEREUM.WETH],
          },
          create: expect.objectContaining({
            preferredQuoteTokens: [TOKENS.ETHEREUM.WETH],
          }),
        })
      );
    });

    it('should throw error for invalid address in preferences', async () => {
      await expect(
        service.setUserPreferences(TEST_USER_IDS.ALICE, ['invalid'])
      ).rejects.toThrow();
    });
  });

  describe('getUserPreferences', () => {
    it('should return user preferences if they exist', async () => {
      prismaMock.userQuoteTokenPreference.findUnique.mockResolvedValue({
        id: 'pref_existing',
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: TEST_USER_IDS.ALICE,
        protocol: 'uniswapv3',
        preferredQuoteTokens: [TOKENS.ETHEREUM.WETH, TOKENS.ETHEREUM.USDC],
      });

      const prefs = await service.getUserPreferences(TEST_USER_IDS.ALICE);

      expect(prefs).toEqual([TOKENS.ETHEREUM.WETH, TOKENS.ETHEREUM.USDC]);
    });

    it('should return null if user has no preferences', async () => {
      prismaMock.userQuoteTokenPreference.findUnique.mockResolvedValue(null);

      const prefs = await service.getUserPreferences(TEST_USER_IDS.ALICE);

      expect(prefs).toBeNull();
    });
  });

  describe('resetToDefaults', () => {
    it('should delete user preferences', async () => {
      prismaMock.userQuoteTokenPreference.delete.mockResolvedValue({
        id: 'pref_deleted',
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: TEST_USER_IDS.ALICE,
        protocol: 'uniswapv3',
        preferredQuoteTokens: [],
      });

      await service.resetToDefaults(TEST_USER_IDS.ALICE);

      expect(prismaMock.userQuoteTokenPreference.delete).toHaveBeenCalledWith({
        where: {
          userId_protocol: {
            userId: TEST_USER_IDS.ALICE,
            protocol: 'uniswapv3',
          },
        },
      });
    });

    it('should not throw if preferences do not exist', async () => {
      // Mock: Prisma throws P2025 (record not found)
      prismaMock.userQuoteTokenPreference.delete.mockRejectedValue({
        code: 'P2025',
        message: 'Record not found',
      });

      await expect(
        service.resetToDefaults(TEST_USER_IDS.ALICE)
      ).resolves.not.toThrow();
    });

    it('should throw for other database errors', async () => {
      // Mock: Other database error
      prismaMock.userQuoteTokenPreference.delete.mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(service.resetToDefaults(TEST_USER_IDS.ALICE)).rejects.toThrow(
        'Database connection failed'
      );
    });
  });

  // ============================================================================
  // Utility Methods
  // ============================================================================

  describe('Utility Methods', () => {
    it('normalizeTokenId should convert to checksum format', () => {
      const normalized = service.normalizeTokenId(
        TOKENS.ETHEREUM.WETH.toLowerCase()
      );
      expect(normalized).toBe(TOKENS.ETHEREUM.WETH);
    });

    it('normalizeTokenId should throw for invalid address', () => {
      expect(() => service.normalizeTokenId('invalid')).toThrow();
    });

    it('compareTokenIds should return true for same address (different case)', () => {
      const result = service.compareTokenIds(
        TOKENS.ETHEREUM.WETH.toLowerCase(),
        TOKENS.ETHEREUM.WETH // Checksum format
      );
      expect(result).toBe(true);
    });

    it('compareTokenIds should return false for different addresses', () => {
      const result = service.compareTokenIds(
        TOKENS.ETHEREUM.WETH,
        TOKENS.ETHEREUM.USDC
      );
      expect(result).toBe(false);
    });

    it('compareTokenIds should return false for invalid addresses', () => {
      const result = service.compareTokenIds('invalid', TOKENS.ETHEREUM.WETH);
      expect(result).toBe(false);
    });

    it('getDefaultQuoteTokens should return empty array', () => {
      const defaults = service.getDefaultQuoteTokens();
      expect(defaults).toEqual([]);
    });
  });
});
