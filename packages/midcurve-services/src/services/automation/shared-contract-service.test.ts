import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SharedContractService } from './shared-contract-service.js';
import { SharedContractTypeEnum, SharedContractNameEnum } from '@midcurve/shared';
import type { PrismaClient, SharedContract } from '@midcurve/database';

/**
 * Tests for SharedContractService
 *
 * Tests the service's ability to query SharedContract records from the database.
 */
describe('SharedContractService', () => {
  // Mock Prisma client
  const mockPrisma = {
    sharedContract: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  } as unknown as PrismaClient;

  let service: SharedContractService;

  // Test fixtures
  const createMockContract = (
    overrides: Partial<SharedContract> = {}
  ): SharedContract => ({
    id: 'contract-1',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    sharedContractType: SharedContractTypeEnum.EVM_SMART_CONTRACT,
    sharedContractName: SharedContractNameEnum.UNISWAP_V3_POSITION_CLOSER,
    interfaceVersionMajor: 1,
    interfaceVersionMinor: 0,
    sharedContractHash: 'evm/uniswap-v3-position-closer/1/0',
    config: {
      chainId: 1,
      address: '0x1234567890123456789012345678901234567890',
    },
    isActive: true,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SharedContractService({ prisma: mockPrisma });
  });

  describe('findLatestByChainAndName', () => {
    it('should return the contract for matching chainId and name', async () => {
      const mockContract = createMockContract();
      vi.mocked(mockPrisma.sharedContract.findMany).mockResolvedValue([
        mockContract,
      ]);

      const result = await service.findLatestByChainAndName(
        1,
        SharedContractNameEnum.UNISWAP_V3_POSITION_CLOSER
      );

      expect(result).not.toBeNull();
      expect(result?.id).toBe('contract-1');
      expect(result?.config.chainId).toBe(1);
      expect(result?.config.address).toBe('0x1234567890123456789012345678901234567890');

      // Verify query parameters
      expect(mockPrisma.sharedContract.findMany).toHaveBeenCalledWith({
        where: {
          sharedContractType: SharedContractTypeEnum.EVM_SMART_CONTRACT,
          sharedContractName: SharedContractNameEnum.UNISWAP_V3_POSITION_CLOSER,
          isActive: true,
        },
        orderBy: [
          { interfaceVersionMajor: 'desc' },
          { interfaceVersionMinor: 'desc' },
        ],
      });
    });

    it('should return null when no contract matches the chainId', async () => {
      const mockContract = createMockContract({
        config: { chainId: 42161, address: '0xabcd' },
      });
      vi.mocked(mockPrisma.sharedContract.findMany).mockResolvedValue([
        mockContract,
      ]);

      const result = await service.findLatestByChainAndName(
        1, // Looking for chainId 1, but contract is for 42161
        SharedContractNameEnum.UNISWAP_V3_POSITION_CLOSER
      );

      expect(result).toBeNull();
    });

    it('should return null when no contracts exist', async () => {
      vi.mocked(mockPrisma.sharedContract.findMany).mockResolvedValue([]);

      const result = await service.findLatestByChainAndName(
        1,
        SharedContractNameEnum.UNISWAP_V3_POSITION_CLOSER
      );

      expect(result).toBeNull();
    });

    it('should return the latest version when multiple exist for same chain', async () => {
      const olderVersion = createMockContract({
        id: 'contract-old',
        interfaceVersionMajor: 1,
        interfaceVersionMinor: 0,
        sharedContractHash: 'evm/uniswap-v3-position-closer/1/0',
      });
      const newerVersion = createMockContract({
        id: 'contract-new',
        interfaceVersionMajor: 1,
        interfaceVersionMinor: 1,
        sharedContractHash: 'evm/uniswap-v3-position-closer/1/1',
      });

      // Prisma returns ordered by version DESC, so newer first
      vi.mocked(mockPrisma.sharedContract.findMany).mockResolvedValue([
        newerVersion,
        olderVersion,
      ]);

      const result = await service.findLatestByChainAndName(
        1,
        SharedContractNameEnum.UNISWAP_V3_POSITION_CLOSER
      );

      expect(result?.id).toBe('contract-new');
      expect(result?.interfaceVersionMinor).toBe(1);
    });
  });

  describe('findLatestContractsForChain', () => {
    it('should return a map with contracts for the chain', async () => {
      const mockContract = createMockContract();
      vi.mocked(mockPrisma.sharedContract.findMany).mockResolvedValue([
        mockContract,
      ]);

      const result = await service.findLatestContractsForChain(1);

      expect(result.size).toBe(1);
      expect(result.has('UniswapV3PositionCloser')).toBe(true);
      expect(result.get('UniswapV3PositionCloser')?.config.address).toBe(
        '0x1234567890123456789012345678901234567890'
      );
    });

    it('should return empty map when no contracts exist for chain', async () => {
      vi.mocked(mockPrisma.sharedContract.findMany).mockResolvedValue([]);

      const result = await service.findLatestContractsForChain(1);

      expect(result.size).toBe(0);
    });

    it('should return only the latest version per contract name', async () => {
      const v1_0 = createMockContract({
        id: 'v1.0',
        interfaceVersionMajor: 1,
        interfaceVersionMinor: 0,
      });
      const v1_1 = createMockContract({
        id: 'v1.1',
        interfaceVersionMajor: 1,
        interfaceVersionMinor: 1,
      });

      // Both for same chain, ordered by name then version DESC
      vi.mocked(mockPrisma.sharedContract.findMany).mockResolvedValue([
        v1_1, // Latest first
        v1_0,
      ]);

      const result = await service.findLatestContractsForChain(1);

      expect(result.size).toBe(1);
      expect(result.get('UniswapV3PositionCloser')?.id).toBe('v1.1');
    });

    it('should filter out contracts for other chains', async () => {
      const ethContract = createMockContract({
        id: 'eth-contract',
        config: { chainId: 1, address: '0xeth' },
      });
      const arbContract = createMockContract({
        id: 'arb-contract',
        config: { chainId: 42161, address: '0xarb' },
      });

      vi.mocked(mockPrisma.sharedContract.findMany).mockResolvedValue([
        ethContract,
        arbContract,
      ]);

      const result = await service.findLatestContractsForChain(1);

      expect(result.size).toBe(1);
      expect(result.get('UniswapV3PositionCloser')?.id).toBe('eth-contract');
    });
  });

  describe('findByHash', () => {
    it('should return contract by semantic hash', async () => {
      const mockContract = createMockContract();
      vi.mocked(mockPrisma.sharedContract.findUnique).mockResolvedValue(
        mockContract
      );

      const result = await service.findByHash('evm/uniswap-v3-position-closer/1/0');

      expect(result).not.toBeNull();
      expect(result?.sharedContractHash).toBe('evm/uniswap-v3-position-closer/1/0');
      expect(mockPrisma.sharedContract.findUnique).toHaveBeenCalledWith({
        where: { sharedContractHash: 'evm/uniswap-v3-position-closer/1/0' },
      });
    });

    it('should return null when hash not found', async () => {
      vi.mocked(mockPrisma.sharedContract.findUnique).mockResolvedValue(null);

      const result = await service.findByHash('evm/nonexistent/1/0');

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('should return contract by database ID', async () => {
      const mockContract = createMockContract();
      vi.mocked(mockPrisma.sharedContract.findUnique).mockResolvedValue(
        mockContract
      );

      const result = await service.findById('contract-1');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('contract-1');
      expect(mockPrisma.sharedContract.findUnique).toHaveBeenCalledWith({
        where: { id: 'contract-1' },
      });
    });

    it('should return null when ID not found', async () => {
      vi.mocked(mockPrisma.sharedContract.findUnique).mockResolvedValue(null);

      const result = await service.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should propagate database errors', async () => {
      const dbError = new Error('Database connection failed');
      vi.mocked(mockPrisma.sharedContract.findMany).mockRejectedValue(dbError);

      await expect(
        service.findLatestByChainAndName(1, SharedContractNameEnum.UNISWAP_V3_POSITION_CLOSER)
      ).rejects.toThrow('Database connection failed');
    });
  });
});
