/**
 * Strategy Service Unit Tests
 *
 * Tests for CRUD operations, state transitions, position/wallet management,
 * and metrics aggregation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import type { PrismaClient } from '@midcurve/database';
import { StrategyService } from './strategy-service.js';
import {
  StrategyInvalidStateError,
  StrategyQuoteTokenMismatchError,
} from './helpers/index.js';
import {
  MOCK_USER_ID,
  MOCK_STRATEGY_ID,
  MOCK_POSITION_ID,
  MOCK_WALLET_ID,
  MOCK_TOKEN_ID,
  createMockStrategyInput,
  createMockActivateInput,
  createMockStrategyDbResult,
  createMockActiveStrategyDbResult,
  createMockPositionDbResult,
  createMockAutomationWalletDbResult,
  createMockPoolDbResult,
  VALID_TRANSITIONS,
  INVALID_TRANSITIONS,
} from './test-fixtures.js';

// Mock Prisma client
const mockPrisma = mockDeep<PrismaClient>();

describe('StrategyService', () => {
  let service: StrategyService;

  beforeEach(() => {
    mockReset(mockPrisma);
    service = new StrategyService({ prisma: mockPrisma });
  });

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  describe('create', () => {
    it('should create a strategy with default state pending', async () => {
      const input = createMockStrategyInput();
      const expectedResult = createMockStrategyDbResult();

      mockPrisma.strategy.create.mockResolvedValue(expectedResult as any);

      const result = await service.create(input);

      expect(mockPrisma.strategy.create).toHaveBeenCalledWith({
        data: {
          userId: input.userId,
          name: input.name,
          strategyType: input.strategyType,
          config: input.config,
          quoteTokenId: undefined,
        },
        include: {},
      });
      expect(result.id).toBe(MOCK_STRATEGY_ID);
      expect(result.state).toBe('pending');
      expect(result.name).toBe(input.name);
    });

    it('should create a strategy with initial quote token', async () => {
      const input = createMockStrategyInput({ quoteTokenId: MOCK_TOKEN_ID });
      const expectedResult = createMockStrategyDbResult({
        quoteTokenId: MOCK_TOKEN_ID,
      });

      mockPrisma.strategy.create.mockResolvedValue(expectedResult as any);

      const result = await service.create(input);

      expect(mockPrisma.strategy.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          quoteTokenId: MOCK_TOKEN_ID,
        }),
        include: {},
      });
      expect(result.quoteTokenId).toBe(MOCK_TOKEN_ID);
    });
  });

  describe('findById', () => {
    it('should find a strategy by ID', async () => {
      const expectedResult = createMockStrategyDbResult();

      mockPrisma.strategy.findUnique.mockResolvedValue(expectedResult as any);

      const result = await service.findById(MOCK_STRATEGY_ID);

      expect(mockPrisma.strategy.findUnique).toHaveBeenCalledWith({
        where: { id: MOCK_STRATEGY_ID },
        include: {},
      });
      expect(result).not.toBeNull();
      expect(result!.id).toBe(MOCK_STRATEGY_ID);
    });

    it('should return null when strategy not found', async () => {
      mockPrisma.strategy.findUnique.mockResolvedValue(null);

      const result = await service.findById('nonexistent_id');

      expect(result).toBeNull();
    });

    it('should include positions when requested', async () => {
      const position = createMockPositionDbResult();
      const expectedResult = createMockStrategyDbResult({
        positions: [position],
      });

      mockPrisma.strategy.findUnique.mockResolvedValue(expectedResult as any);

      const result = await service.findById(MOCK_STRATEGY_ID, {
        includePositions: true,
      });

      expect(mockPrisma.strategy.findUnique).toHaveBeenCalledWith({
        where: { id: MOCK_STRATEGY_ID },
        include: {
          positions: {
            include: {
              pool: {
                include: {
                  token0: true,
                  token1: true,
                },
              },
            },
          },
        },
      });
      expect(result!.positions).toHaveLength(1);
    });

    it('should include wallets when requested', async () => {
      const wallet = createMockAutomationWalletDbResult();
      const expectedResult = createMockStrategyDbResult({
        automationWallets: [wallet],
      });

      mockPrisma.strategy.findUnique.mockResolvedValue(expectedResult as any);

      const result = await service.findById(MOCK_STRATEGY_ID, {
        includeWallets: true,
      });

      expect(result!.automationWallets).toHaveLength(1);
    });
  });

  describe('findByContractAddress', () => {
    it('should find a strategy by contract address', async () => {
      const contractAddress = '0x1234567890123456789012345678901234567890';
      const expectedResult = createMockActiveStrategyDbResult({
        contractAddress,
      });

      mockPrisma.strategy.findUnique.mockResolvedValue(expectedResult as any);

      const result = await service.findByContractAddress(contractAddress);

      expect(mockPrisma.strategy.findUnique).toHaveBeenCalledWith({
        where: { contractAddress },
        include: {},
      });
      expect(result).not.toBeNull();
      expect(result!.contractAddress).toBe(contractAddress);
    });
  });

  describe('findByUserId', () => {
    it('should find all strategies for a user', async () => {
      const strategies = [
        createMockStrategyDbResult({ id: 'strategy_1' }),
        createMockStrategyDbResult({ id: 'strategy_2', strategyType: 'yield-optimizer' }),
      ];

      mockPrisma.strategy.findMany.mockResolvedValue(strategies as any);

      const result = await service.findByUserId(MOCK_USER_ID);

      expect(mockPrisma.strategy.findMany).toHaveBeenCalledWith({
        where: { userId: MOCK_USER_ID },
        include: {},
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(2);
    });

    it('should filter by state', async () => {
      const strategies = [createMockActiveStrategyDbResult()];

      mockPrisma.strategy.findMany.mockResolvedValue(strategies as any);

      await service.findByUserId(MOCK_USER_ID, { state: 'active' });

      expect(mockPrisma.strategy.findMany).toHaveBeenCalledWith({
        where: {
          userId: MOCK_USER_ID,
          state: 'active',
        },
        include: {},
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter by multiple states', async () => {
      mockPrisma.strategy.findMany.mockResolvedValue([]);

      await service.findByUserId(MOCK_USER_ID, { state: ['active', 'paused'] });

      expect(mockPrisma.strategy.findMany).toHaveBeenCalledWith({
        where: {
          userId: MOCK_USER_ID,
          state: { in: ['active', 'paused'] },
        },
        include: {},
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter by strategy type', async () => {
      mockPrisma.strategy.findMany.mockResolvedValue([]);

      await service.findByUserId(MOCK_USER_ID, { strategyType: 'delta-neutral' });

      expect(mockPrisma.strategy.findMany).toHaveBeenCalledWith({
        where: {
          userId: MOCK_USER_ID,
          strategyType: 'delta-neutral',
        },
        include: {},
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('update', () => {
    it('should update strategy name', async () => {
      const updatedResult = createMockStrategyDbResult({
        name: 'Updated Strategy Name',
      });

      mockPrisma.strategy.update.mockResolvedValue(updatedResult as any);

      const result = await service.update(MOCK_STRATEGY_ID, {
        name: 'Updated Strategy Name',
      });

      expect(mockPrisma.strategy.update).toHaveBeenCalledWith({
        where: { id: MOCK_STRATEGY_ID },
        data: { name: 'Updated Strategy Name' },
        include: {},
      });
      expect(result.name).toBe('Updated Strategy Name');
    });

    it('should update strategy config', async () => {
      const newConfig = { targetDelta: 0.1, maxPositions: 10 };
      const updatedResult = createMockStrategyDbResult({ config: newConfig });

      mockPrisma.strategy.update.mockResolvedValue(updatedResult as any);

      const result = await service.update(MOCK_STRATEGY_ID, { config: newConfig });

      expect(mockPrisma.strategy.update).toHaveBeenCalledWith({
        where: { id: MOCK_STRATEGY_ID },
        data: { config: newConfig },
        include: {},
      });
      expect(result.config).toEqual(newConfig);
    });
  });

  describe('delete', () => {
    it('should delete a strategy', async () => {
      mockPrisma.strategy.delete.mockResolvedValue({} as any);

      await service.delete(MOCK_STRATEGY_ID);

      expect(mockPrisma.strategy.delete).toHaveBeenCalledWith({
        where: { id: MOCK_STRATEGY_ID },
      });
    });
  });

  // ============================================================================
  // STATE TRANSITIONS
  // ============================================================================

  describe('activate', () => {
    it('should activate a pending strategy', async () => {
      const activateInput = createMockActivateInput();
      const pendingResult = createMockStrategyDbResult({ state: 'pending' });
      const activatedResult = createMockActiveStrategyDbResult();

      mockPrisma.strategy.findUnique.mockResolvedValue(pendingResult as any);
      mockPrisma.strategy.update.mockResolvedValue(activatedResult as any);

      const result = await service.activate(MOCK_STRATEGY_ID, activateInput);

      expect(mockPrisma.strategy.update).toHaveBeenCalledWith({
        where: { id: MOCK_STRATEGY_ID },
        data: {
          state: 'active',
          chainId: activateInput.chainId,
          contractAddress: activateInput.contractAddress,
        },
        include: {},
      });
      expect(result.state).toBe('active');
      expect(result.contractAddress).toBe(activateInput.contractAddress);
    });

    it('should throw StrategyInvalidStateError when activating non-pending strategy', async () => {
      const activeResult = createMockActiveStrategyDbResult();

      mockPrisma.strategy.findUnique.mockResolvedValue(activeResult as any);

      await expect(
        service.activate(MOCK_STRATEGY_ID, createMockActivateInput())
      ).rejects.toThrow(StrategyInvalidStateError);
    });
  });

  describe('pause', () => {
    it('should pause an active strategy', async () => {
      const activeResult = createMockActiveStrategyDbResult();
      const pausedResult = createMockActiveStrategyDbResult({ state: 'paused' });

      mockPrisma.strategy.findUnique.mockResolvedValue(activeResult as any);
      mockPrisma.strategy.update.mockResolvedValue(pausedResult as any);

      const result = await service.pause(MOCK_STRATEGY_ID);

      expect(mockPrisma.strategy.update).toHaveBeenCalledWith({
        where: { id: MOCK_STRATEGY_ID },
        data: { state: 'paused' },
        include: {},
      });
      expect(result.state).toBe('paused');
    });

    it('should throw StrategyInvalidStateError when pausing pending strategy', async () => {
      const pendingResult = createMockStrategyDbResult({ state: 'pending' });

      mockPrisma.strategy.findUnique.mockResolvedValue(pendingResult as any);

      await expect(service.pause(MOCK_STRATEGY_ID)).rejects.toThrow(
        StrategyInvalidStateError
      );
    });
  });

  describe('resume', () => {
    it('should resume a paused strategy', async () => {
      const pausedResult = createMockActiveStrategyDbResult({ state: 'paused' });
      const activeResult = createMockActiveStrategyDbResult();

      mockPrisma.strategy.findUnique.mockResolvedValue(pausedResult as any);
      mockPrisma.strategy.update.mockResolvedValue(activeResult as any);

      const result = await service.resume(MOCK_STRATEGY_ID);

      expect(mockPrisma.strategy.update).toHaveBeenCalledWith({
        where: { id: MOCK_STRATEGY_ID },
        data: { state: 'active' },
        include: {},
      });
      expect(result.state).toBe('active');
    });

    it('should throw StrategyInvalidStateError when resuming active strategy', async () => {
      const activeResult = createMockActiveStrategyDbResult();

      mockPrisma.strategy.findUnique.mockResolvedValue(activeResult as any);

      await expect(service.resume(MOCK_STRATEGY_ID)).rejects.toThrow(
        StrategyInvalidStateError
      );
    });
  });

  describe('shutdown', () => {
    it('should shutdown an active strategy', async () => {
      const activeResult = createMockActiveStrategyDbResult();
      const shutdownResult = createMockActiveStrategyDbResult({ state: 'shutdown' });

      mockPrisma.strategy.findUnique.mockResolvedValue(activeResult as any);
      mockPrisma.strategy.update.mockResolvedValue(shutdownResult as any);

      const result = await service.shutdown(MOCK_STRATEGY_ID);

      expect(mockPrisma.strategy.update).toHaveBeenCalledWith({
        where: { id: MOCK_STRATEGY_ID },
        data: { state: 'shutdown' },
        include: {},
      });
      expect(result.state).toBe('shutdown');
    });

    it('should shutdown a paused strategy', async () => {
      const pausedResult = createMockActiveStrategyDbResult({ state: 'paused' });
      const shutdownResult = createMockActiveStrategyDbResult({ state: 'shutdown' });

      mockPrisma.strategy.findUnique.mockResolvedValue(pausedResult as any);
      mockPrisma.strategy.update.mockResolvedValue(shutdownResult as any);

      const result = await service.shutdown(MOCK_STRATEGY_ID);

      expect(result.state).toBe('shutdown');
    });

    it('should throw StrategyInvalidStateError when shutting down pending strategy', async () => {
      const pendingResult = createMockStrategyDbResult({ state: 'pending' });

      mockPrisma.strategy.findUnique.mockResolvedValue(pendingResult as any);

      await expect(service.shutdown(MOCK_STRATEGY_ID)).rejects.toThrow(
        StrategyInvalidStateError
      );
    });

    it('should throw StrategyInvalidStateError when shutting down already shutdown strategy', async () => {
      const shutdownResult = createMockActiveStrategyDbResult({ state: 'shutdown' });

      mockPrisma.strategy.findUnique.mockResolvedValue(shutdownResult as any);

      await expect(service.shutdown(MOCK_STRATEGY_ID)).rejects.toThrow(
        StrategyInvalidStateError
      );
    });
  });

  // ============================================================================
  // POSITION MANAGEMENT
  // ============================================================================

  describe('linkPosition', () => {
    it('should link a position and set quote token on first link', async () => {
      const strategy = createMockStrategyDbResult({ quoteTokenId: null });
      const position = createMockPositionDbResult();
      const updatedStrategy = createMockStrategyDbResult({
        quoteTokenId: MOCK_TOKEN_ID,
        currentValue: position.currentValue,
      });

      mockPrisma.strategy.findUnique.mockResolvedValue(strategy as any);
      mockPrisma.position.findUnique.mockResolvedValue(position as any);
      mockPrisma.$transaction.mockResolvedValue([{}, {}]);
      mockPrisma.position.findMany.mockResolvedValue([position] as any);
      mockPrisma.strategy.update.mockResolvedValue(updatedStrategy as any);

      const result = await service.linkPosition(MOCK_STRATEGY_ID, MOCK_POSITION_ID);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should throw StrategyQuoteTokenMismatchError when quote tokens dont match', async () => {
      const strategy = createMockStrategyDbResult({
        quoteTokenId: 'different_token_id',
      });
      const position = createMockPositionDbResult();

      mockPrisma.strategy.findUnique.mockResolvedValue(strategy as any);
      mockPrisma.position.findUnique.mockResolvedValue(position as any);

      await expect(
        service.linkPosition(MOCK_STRATEGY_ID, MOCK_POSITION_ID)
      ).rejects.toThrow(StrategyQuoteTokenMismatchError);
    });
  });

  describe('unlinkPosition', () => {
    it('should unlink a position from strategy', async () => {
      const position = createMockPositionDbResult({
        strategyId: MOCK_STRATEGY_ID,
      });
      const strategyResult = createMockStrategyDbResult();

      mockPrisma.position.findUnique.mockResolvedValue(position as any);
      mockPrisma.position.update.mockResolvedValue({} as any);
      mockPrisma.position.findMany.mockResolvedValue([]);
      mockPrisma.strategy.update.mockResolvedValue(strategyResult as any);

      await service.unlinkPosition(MOCK_POSITION_ID);

      expect(mockPrisma.position.update).toHaveBeenCalledWith({
        where: { id: MOCK_POSITION_ID },
        data: { strategyId: null },
      });
    });
  });

  describe('getPositions', () => {
    it('should return all positions linked to a strategy', async () => {
      const positions = [
        createMockPositionDbResult({ id: 'pos_1' }),
        createMockPositionDbResult({ id: 'pos_2' }),
      ];

      mockPrisma.position.findMany.mockResolvedValue(positions as any);

      const result = await service.getPositions(MOCK_STRATEGY_ID);

      expect(mockPrisma.position.findMany).toHaveBeenCalledWith({
        where: { strategyId: MOCK_STRATEGY_ID },
        include: {
          pool: {
            include: {
              token0: true,
              token1: true,
            },
          },
        },
      });
      expect(result).toHaveLength(2);
    });
  });

  // ============================================================================
  // WALLET MANAGEMENT
  // ============================================================================

  describe('linkWallet', () => {
    it('should link a wallet to a strategy', async () => {
      const strategy = createMockStrategyDbResult();
      const wallet = createMockAutomationWalletDbResult();
      const strategyWithWallet = createMockStrategyDbResult({
        automationWallets: [wallet],
      });

      mockPrisma.strategy.findUnique
        .mockResolvedValueOnce(strategy as any)
        .mockResolvedValueOnce(strategyWithWallet as any);
      mockPrisma.automationWallet.update.mockResolvedValue(wallet as any);

      const result = await service.linkWallet(MOCK_STRATEGY_ID, MOCK_WALLET_ID);

      expect(mockPrisma.automationWallet.update).toHaveBeenCalledWith({
        where: { id: MOCK_WALLET_ID },
        data: { strategyId: MOCK_STRATEGY_ID },
      });
      expect(result.automationWallets).toHaveLength(1);
    });
  });

  describe('unlinkWallet', () => {
    it('should unlink a wallet from strategy', async () => {
      mockPrisma.automationWallet.update.mockResolvedValue({} as any);

      await service.unlinkWallet(MOCK_WALLET_ID);

      expect(mockPrisma.automationWallet.update).toHaveBeenCalledWith({
        where: { id: MOCK_WALLET_ID },
        data: { strategyId: null },
      });
    });
  });

  describe('getWallets', () => {
    it('should return all wallets linked to a strategy', async () => {
      const wallets = [
        createMockAutomationWalletDbResult({ id: 'wallet_1' }),
        createMockAutomationWalletDbResult({ id: 'wallet_2', walletType: 'hyperliquid' }),
      ];

      mockPrisma.automationWallet.findMany.mockResolvedValue(wallets as any);

      const result = await service.getWallets(MOCK_STRATEGY_ID);

      expect(mockPrisma.automationWallet.findMany).toHaveBeenCalledWith({
        where: { strategyId: MOCK_STRATEGY_ID },
      });
      expect(result).toHaveLength(2);
    });
  });

  // ============================================================================
  // METRICS
  // ============================================================================

  describe('refreshMetrics', () => {
    it('should aggregate metrics from all positions', async () => {
      const positions = [
        createMockPositionDbResult({
          currentValue: '1000000000',
          currentCostBasis: '900000000',
          realizedPnl: '50000000',
          unrealizedPnl: '100000000',
          collectedFees: '25000000',
          unClaimedFees: '5000000',
          realizedCashflow: '0',
          unrealizedCashflow: '0',
        }),
        createMockPositionDbResult({
          id: 'pos_2',
          currentValue: '500000000',
          currentCostBasis: '450000000',
          realizedPnl: '25000000',
          unrealizedPnl: '50000000',
          collectedFees: '10000000',
          unClaimedFees: '2000000',
          realizedCashflow: '0',
          unrealizedCashflow: '0',
        }),
      ];

      const updatedStrategy = createMockStrategyDbResult({
        currentValue: '1500000000',
        currentCostBasis: '1350000000',
        realizedPnl: '75000000',
        unrealizedPnl: '150000000',
        collectedFees: '35000000',
        unClaimedFees: '7000000',
      });

      mockPrisma.position.findMany.mockResolvedValue(positions as any);
      mockPrisma.strategy.update.mockResolvedValue(updatedStrategy as any);

      const result = await service.refreshMetrics(MOCK_STRATEGY_ID);

      expect(mockPrisma.strategy.update).toHaveBeenCalledWith({
        where: { id: MOCK_STRATEGY_ID },
        data: {
          currentValue: '1500000000',
          currentCostBasis: '1350000000',
          realizedPnl: '75000000',
          unrealizedPnl: '150000000',
          collectedFees: '35000000',
          unClaimedFees: '7000000',
          realizedCashflow: '0',
          unrealizedCashflow: '0',
        },
        include: {},
      });
      expect(result.metrics.currentValue).toBe(1500000000n);
    });

    it('should set zero metrics when no positions linked', async () => {
      const updatedStrategy = createMockStrategyDbResult({
        currentValue: '0',
        currentCostBasis: '0',
      });

      mockPrisma.position.findMany.mockResolvedValue([]);
      mockPrisma.strategy.update.mockResolvedValue(updatedStrategy as any);

      const result = await service.refreshMetrics(MOCK_STRATEGY_ID);

      expect(mockPrisma.strategy.update).toHaveBeenCalledWith({
        where: { id: MOCK_STRATEGY_ID },
        data: expect.objectContaining({
          currentValue: '0',
          currentCostBasis: '0',
        }),
        include: {},
      });
      expect(result.metrics.currentValue).toBe(0n);
    });
  });

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('error handling', () => {
    it('should throw when strategy not found for state transition', async () => {
      mockPrisma.strategy.findUnique.mockResolvedValue(null);

      await expect(service.pause(MOCK_STRATEGY_ID)).rejects.toThrow(
        'Strategy not found'
      );
    });

    it('should throw when position not found for linking', async () => {
      const strategy = createMockStrategyDbResult();

      mockPrisma.strategy.findUnique.mockResolvedValue(strategy as any);
      mockPrisma.position.findUnique.mockResolvedValue(null);

      await expect(
        service.linkPosition(MOCK_STRATEGY_ID, MOCK_POSITION_ID)
      ).rejects.toThrow('Position not found');
    });

    it('should throw when strategy not found for position linking', async () => {
      mockPrisma.strategy.findUnique.mockResolvedValue(null);

      await expect(
        service.linkPosition(MOCK_STRATEGY_ID, MOCK_POSITION_ID)
      ).rejects.toThrow('Strategy not found');
    });
  });
});

// ============================================================================
// STATE TRANSITION VALIDATION TESTS
// ============================================================================

describe('State Transition Validation', () => {
  const mockPrisma = mockDeep<PrismaClient>();
  let service: StrategyService;

  beforeEach(() => {
    mockReset(mockPrisma);
    service = new StrategyService({ prisma: mockPrisma });
  });

  describe('valid transitions', () => {
    VALID_TRANSITIONS.forEach(({ from, to, method }) => {
      it(`should allow ${from} -> ${to} via ${method}()`, async () => {
        const currentStrategy = createMockStrategyDbResult({ state: from });
        const updatedStrategy = createMockStrategyDbResult({ state: to });

        // For activate, we need extra fields
        if (from === 'pending' && to === 'active') {
          Object.assign(updatedStrategy, {
            contractAddress: '0x1234567890123456789012345678901234567890',
            chainId: 1337,
          });
        }

        mockPrisma.strategy.findUnique.mockResolvedValue(currentStrategy as any);
        mockPrisma.strategy.update.mockResolvedValue(updatedStrategy as any);

        // Call the appropriate method
        if (method === 'activate') {
          const result = await service.activate(
            MOCK_STRATEGY_ID,
            createMockActivateInput()
          );
          expect(result.state).toBe(to);
        } else if (method === 'pause') {
          const result = await service.pause(MOCK_STRATEGY_ID);
          expect(result.state).toBe(to);
        } else if (method === 'resume') {
          const result = await service.resume(MOCK_STRATEGY_ID);
          expect(result.state).toBe(to);
        } else if (method === 'shutdown') {
          const result = await service.shutdown(MOCK_STRATEGY_ID);
          expect(result.state).toBe(to);
        }
      });
    });
  });

  describe('invalid transitions', () => {
    INVALID_TRANSITIONS.forEach(({ from, to, method }) => {
      it(`should reject ${from} -> ${to} via ${method}()`, async () => {
        const currentStrategy = createMockStrategyDbResult({ state: from });

        mockPrisma.strategy.findUnique.mockResolvedValue(currentStrategy as any);

        // Call the appropriate method and expect it to throw
        if (method === 'activate') {
          await expect(
            service.activate(MOCK_STRATEGY_ID, createMockActivateInput())
          ).rejects.toThrow(StrategyInvalidStateError);
        } else if (method === 'pause') {
          await expect(service.pause(MOCK_STRATEGY_ID)).rejects.toThrow(
            StrategyInvalidStateError
          );
        } else if (method === 'resume') {
          await expect(service.resume(MOCK_STRATEGY_ID)).rejects.toThrow(
            StrategyInvalidStateError
          );
        } else if (method === 'shutdown') {
          await expect(service.shutdown(MOCK_STRATEGY_ID)).rejects.toThrow(
            StrategyInvalidStateError
          );
        }
      });
    });
  });
});
