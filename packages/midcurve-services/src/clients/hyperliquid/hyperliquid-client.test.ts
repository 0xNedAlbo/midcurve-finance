/**
 * Tests for HyperliquidClient
 *
 * Unit tests for the Hyperliquid SDK wrapper.
 * Mocks the SDK functions to test client logic without hitting the real API.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HyperliquidClient,
  HyperliquidApiError,
  HyperliquidClientError,
  type HyperliquidClientConfig,
} from './hyperliquid-client.js';

// Mock the SDK modules
vi.mock('@nktkas/hyperliquid', () => ({
  HttpTransport: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@nktkas/hyperliquid/api/exchange', () => ({
  createSubAccount: vi.fn(),
  subAccountModify: vi.fn(),
  subAccountTransfer: vi.fn(),
}));

vi.mock('@nktkas/hyperliquid/api/info', () => ({
  subAccounts: vi.fn(),
  clearinghouseState: vi.fn(),
}));

// Import the mocked functions for test control
import {
  createSubAccount as createSubAccountMock,
  subAccountModify as subAccountModifyMock,
  subAccountTransfer as subAccountTransferMock,
} from '@nktkas/hyperliquid/api/exchange';
import {
  subAccounts as subAccountsMock,
  clearinghouseState as clearinghouseStateMock,
} from '@nktkas/hyperliquid/api/info';

describe('HyperliquidClient', () => {
  let client: HyperliquidClient;
  const mockConfig: HyperliquidClientConfig = { environment: 'testnet' };

  // Mock wallet for exchange operations
  const mockWallet = {
    address: '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`,
    signTypedData: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new HyperliquidClient(mockConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with testnet config', () => {
      const testnetClient = new HyperliquidClient({ environment: 'testnet' });
      expect(testnetClient).toBeDefined();
    });

    it('should initialize with mainnet config', () => {
      const mainnetClient = new HyperliquidClient({ environment: 'mainnet' });
      expect(mainnetClient).toBeDefined();
    });
  });

  describe('createSubAccount()', () => {
    const mockSubAccountAddress =
      '0xabcdef1234567890abcdef1234567890abcdef12' as `0x${string}`;

    it('should create a subaccount and return address and name', async () => {
      vi.mocked(createSubAccountMock).mockResolvedValueOnce({
        status: 'ok',
        response: {
          type: 'createSubAccount',
          data: mockSubAccountAddress,
        },
      });

      const result = await client.createSubAccount(mockWallet, 'mc-a1b2c3d4');

      expect(result).toEqual({
        address: mockSubAccountAddress,
        name: 'mc-a1b2c3d4',
      });
      expect(createSubAccountMock).toHaveBeenCalledWith(
        expect.objectContaining({ wallet: mockWallet }),
        { name: 'mc-a1b2c3d4' }
      );
    });

    it('should throw HyperliquidApiError on SDK error', async () => {
      vi.mocked(createSubAccountMock).mockRejectedValueOnce(
        new Error('Subaccount name already exists')
      );

      await expect(
        client.createSubAccount(mockWallet, 'mc-existing')
      ).rejects.toThrow(HyperliquidApiError);
    });
  });

  describe('renameSubAccount()', () => {
    const mockSubAccountAddress =
      '0xabcdef1234567890abcdef1234567890abcdef12' as `0x${string}`;

    it('should rename a subaccount successfully', async () => {
      vi.mocked(subAccountModifyMock).mockResolvedValueOnce({
        status: 'ok',
        response: { type: 'default' },
      });

      await client.renameSubAccount(
        mockWallet,
        mockSubAccountAddress,
        'unused-1'
      );

      expect(subAccountModifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ wallet: mockWallet }),
        { subAccountUser: mockSubAccountAddress, name: 'unused-1' }
      );
    });

    it('should throw HyperliquidApiError on SDK error', async () => {
      vi.mocked(subAccountModifyMock).mockRejectedValueOnce(
        new Error('Subaccount not found')
      );

      await expect(
        client.renameSubAccount(mockWallet, mockSubAccountAddress, 'new-name')
      ).rejects.toThrow(HyperliquidApiError);
    });
  });

  describe('transferUsd()', () => {
    const mockSubAccountAddress =
      '0xabcdef1234567890abcdef1234567890abcdef12' as `0x${string}`;

    it('should transfer USD to subaccount (deposit)', async () => {
      vi.mocked(subAccountTransferMock).mockResolvedValueOnce({
        status: 'ok',
        response: { type: 'default' },
      });

      await client.transferUsd(mockWallet, mockSubAccountAddress, '100.50', true);

      expect(subAccountTransferMock).toHaveBeenCalledWith(
        expect.objectContaining({ wallet: mockWallet }),
        {
          subAccountUser: mockSubAccountAddress,
          isDeposit: true,
          usd: 100500000, // 100.50 * 1e6
        }
      );
    });

    it('should transfer USD from subaccount (withdraw)', async () => {
      vi.mocked(subAccountTransferMock).mockResolvedValueOnce({
        status: 'ok',
        response: { type: 'default' },
      });

      await client.transferUsd(
        mockWallet,
        mockSubAccountAddress,
        '50.25',
        false
      );

      expect(subAccountTransferMock).toHaveBeenCalledWith(
        expect.objectContaining({ wallet: mockWallet }),
        {
          subAccountUser: mockSubAccountAddress,
          isDeposit: false,
          usd: 50250000, // 50.25 * 1e6
        }
      );
    });

    it('should throw HyperliquidClientError for invalid amount', async () => {
      await expect(
        client.transferUsd(mockWallet, mockSubAccountAddress, 'invalid', true)
      ).rejects.toThrow(HyperliquidClientError);

      await expect(
        client.transferUsd(mockWallet, mockSubAccountAddress, '-10', true)
      ).rejects.toThrow(HyperliquidClientError);
    });
  });

  describe('getSubAccounts()', () => {
    const mockUserAddress =
      '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`;

    it('should return subaccounts when they exist', async () => {
      vi.mocked(subAccountsMock).mockResolvedValueOnce([
        {
          name: 'mc-a1b2c3d4',
          subAccountUser: '0xaaa0000000000000000000000000000000000001' as `0x${string}`,
          master: mockUserAddress,
          clearinghouseState: {
            marginSummary: {
              accountValue: '1000.0',
              totalNtlPos: '0',
              totalRawUsd: '1000.0',
              totalMarginUsed: '0',
            },
            crossMarginSummary: {
              accountValue: '1000.0',
              totalNtlPos: '0',
              totalRawUsd: '1000.0',
              totalMarginUsed: '0',
            },
            crossMaintenanceMarginUsed: '0',
            withdrawable: '1000.0',
            assetPositions: [],
            time: Date.now(),
          },
          spotState: { balances: [] },
        },
        {
          name: 'unused-1',
          subAccountUser: '0xbbb0000000000000000000000000000000000002' as `0x${string}`,
          master: mockUserAddress,
          clearinghouseState: {
            marginSummary: {
              accountValue: '0',
              totalNtlPos: '0',
              totalRawUsd: '0',
              totalMarginUsed: '0',
            },
            crossMarginSummary: {
              accountValue: '0',
              totalNtlPos: '0',
              totalRawUsd: '0',
              totalMarginUsed: '0',
            },
            crossMaintenanceMarginUsed: '0',
            withdrawable: '0',
            assetPositions: [],
            time: Date.now(),
          },
          spotState: { balances: [] },
        },
      ]);

      const result = await client.getSubAccounts(mockUserAddress);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        address: '0xaaa0000000000000000000000000000000000001',
        name: 'mc-a1b2c3d4',
        masterAddress: mockUserAddress,
      });
      expect(result[1]).toEqual({
        address: '0xbbb0000000000000000000000000000000000002',
        name: 'unused-1',
        masterAddress: mockUserAddress,
      });
    });

    it('should return empty array when no subaccounts', async () => {
      vi.mocked(subAccountsMock).mockResolvedValueOnce(null);

      const result = await client.getSubAccounts(mockUserAddress);

      expect(result).toEqual([]);
    });
  });

  describe('getSubAccountState()', () => {
    const mockSubAccountAddress =
      '0xabcdef1234567890abcdef1234567890abcdef12' as `0x${string}`;

    it('should return clearinghouse state with positions', async () => {
      vi.mocked(clearinghouseStateMock).mockResolvedValueOnce({
        marginSummary: {
          accountValue: '1500.0',
          totalNtlPos: '500.0',
          totalRawUsd: '1000.0',
          totalMarginUsed: '100.0',
        },
        crossMarginSummary: {
          accountValue: '1500.0',
          totalNtlPos: '500.0',
          totalRawUsd: '1000.0',
          totalMarginUsed: '100.0',
        },
        crossMaintenanceMarginUsed: '50.0',
        withdrawable: '900.0',
        assetPositions: [
          {
            type: 'oneWay' as const,
            position: {
              coin: 'ETH',
              szi: '-0.5', // Short position
              leverage: { type: 'isolated' as const, value: 5, rawUsd: '100.0' },
              entryPx: '2000.0',
              positionValue: '500.0',
              unrealizedPnl: '-25.0',
              returnOnEquity: '-0.25',
              liquidationPx: '2500.0',
              marginUsed: '100.0',
              maxLeverage: 50,
              cumFunding: { allTime: '5.0', sinceOpen: '2.0', sinceChange: '1.0' },
            },
          },
        ],
        time: Date.now(),
      });

      const result = await client.getSubAccountState(mockSubAccountAddress);

      expect(result).toEqual({
        accountValue: '1500.0',
        withdrawable: '900.0',
        positions: [
          {
            coin: 'ETH',
            size: '-0.5',
            entryPrice: '2000.0',
            unrealizedPnl: '-25.0',
            leverage: { type: 'isolated', value: 5 },
          },
        ],
      });
    });

    it('should return empty positions array when no positions', async () => {
      vi.mocked(clearinghouseStateMock).mockResolvedValueOnce({
        marginSummary: {
          accountValue: '0',
          totalNtlPos: '0',
          totalRawUsd: '0',
          totalMarginUsed: '0',
        },
        crossMarginSummary: {
          accountValue: '0',
          totalNtlPos: '0',
          totalRawUsd: '0',
          totalMarginUsed: '0',
        },
        crossMaintenanceMarginUsed: '0',
        withdrawable: '0',
        assetPositions: [],
        time: Date.now(),
      });

      const result = await client.getSubAccountState(mockSubAccountAddress);

      expect(result.positions).toEqual([]);
    });
  });

  describe('findUnusedSubAccounts()', () => {
    const mockUserAddress =
      '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`;

    it('should filter only unused subaccounts', async () => {
      vi.mocked(subAccountsMock).mockResolvedValueOnce([
        {
          name: 'mc-a1b2c3d4',
          subAccountUser: '0xaaa0000000000000000000000000000000000001' as `0x${string}`,
          master: mockUserAddress,
          clearinghouseState: {} as any,
          spotState: { balances: [] },
        },
        {
          name: 'unused-1',
          subAccountUser: '0xbbb0000000000000000000000000000000000002' as `0x${string}`,
          master: mockUserAddress,
          clearinghouseState: {} as any,
          spotState: { balances: [] },
        },
        {
          name: 'unused-2',
          subAccountUser: '0xccc0000000000000000000000000000000000003' as `0x${string}`,
          master: mockUserAddress,
          clearinghouseState: {} as any,
          spotState: { balances: [] },
        },
        {
          name: 'custom-name',
          subAccountUser: '0xddd0000000000000000000000000000000000004' as `0x${string}`,
          master: mockUserAddress,
          clearinghouseState: {} as any,
          spotState: { balances: [] },
        },
      ]);

      const result = await client.findUnusedSubAccounts(mockUserAddress);

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.name)).toEqual(['unused-1', 'unused-2']);
    });

    it('should return empty array when no unused subaccounts', async () => {
      vi.mocked(subAccountsMock).mockResolvedValueOnce([
        {
          name: 'mc-a1b2c3d4',
          subAccountUser: '0xaaa0000000000000000000000000000000000001' as `0x${string}`,
          master: mockUserAddress,
          clearinghouseState: {} as any,
          spotState: { balances: [] },
        },
      ]);

      const result = await client.findUnusedSubAccounts(mockUserAddress);

      expect(result).toEqual([]);
    });
  });

  describe('findMidcurveSubAccounts()', () => {
    const mockUserAddress =
      '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`;

    it('should filter both active (mc-) and unused subaccounts', async () => {
      vi.mocked(subAccountsMock).mockResolvedValueOnce([
        {
          name: 'mc-a1b2c3d4',
          subAccountUser: '0xaaa0000000000000000000000000000000000001' as `0x${string}`,
          master: mockUserAddress,
          clearinghouseState: {} as any,
          spotState: { balances: [] },
        },
        {
          name: 'unused-1',
          subAccountUser: '0xbbb0000000000000000000000000000000000002' as `0x${string}`,
          master: mockUserAddress,
          clearinghouseState: {} as any,
          spotState: { balances: [] },
        },
        {
          name: 'custom-name',
          subAccountUser: '0xccc0000000000000000000000000000000000003' as `0x${string}`,
          master: mockUserAddress,
          clearinghouseState: {} as any,
          spotState: { balances: [] },
        },
      ]);

      const result = await client.findMidcurveSubAccounts(mockUserAddress);

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.name)).toEqual(['mc-a1b2c3d4', 'unused-1']);
    });
  });

  describe('isSubAccountEmpty()', () => {
    const mockSubAccountAddress =
      '0xabcdef1234567890abcdef1234567890abcdef12' as `0x${string}`;

    it('should return true for empty subaccount', async () => {
      vi.mocked(clearinghouseStateMock).mockResolvedValueOnce({
        marginSummary: {
          accountValue: '0',
          totalNtlPos: '0',
          totalRawUsd: '0',
          totalMarginUsed: '0',
        },
        crossMarginSummary: {
          accountValue: '0',
          totalNtlPos: '0',
          totalRawUsd: '0',
          totalMarginUsed: '0',
        },
        crossMaintenanceMarginUsed: '0',
        withdrawable: '0.001', // Dust amount < $0.01
        assetPositions: [],
        time: Date.now(),
      });

      const result = await client.isSubAccountEmpty(mockSubAccountAddress);

      expect(result).toBe(true);
    });

    it('should return false if subaccount has positions', async () => {
      vi.mocked(clearinghouseStateMock).mockResolvedValueOnce({
        marginSummary: {
          accountValue: '100',
          totalNtlPos: '100',
          totalRawUsd: '0',
          totalMarginUsed: '20',
        },
        crossMarginSummary: {
          accountValue: '100',
          totalNtlPos: '100',
          totalRawUsd: '0',
          totalMarginUsed: '20',
        },
        crossMaintenanceMarginUsed: '10',
        withdrawable: '0',
        assetPositions: [
          {
            type: 'oneWay' as const,
            position: {
              coin: 'ETH',
              szi: '-0.1', // Open position
              leverage: { type: 'cross' as const, value: 5 },
              entryPx: '2000.0',
              positionValue: '100.0',
              unrealizedPnl: '0',
              returnOnEquity: '0',
              liquidationPx: null,
              marginUsed: '20',
              maxLeverage: 50,
              cumFunding: { allTime: '0', sinceOpen: '0', sinceChange: '0' },
            },
          },
        ],
        time: Date.now(),
      });

      const result = await client.isSubAccountEmpty(mockSubAccountAddress);

      expect(result).toBe(false);
    });

    it('should return false if subaccount has non-trivial balance', async () => {
      vi.mocked(clearinghouseStateMock).mockResolvedValueOnce({
        marginSummary: {
          accountValue: '50',
          totalNtlPos: '0',
          totalRawUsd: '50',
          totalMarginUsed: '0',
        },
        crossMarginSummary: {
          accountValue: '50',
          totalNtlPos: '0',
          totalRawUsd: '50',
          totalMarginUsed: '0',
        },
        crossMaintenanceMarginUsed: '0',
        withdrawable: '50', // Non-trivial balance
        assetPositions: [],
        time: Date.now(),
      });

      const result = await client.isSubAccountEmpty(mockSubAccountAddress);

      expect(result).toBe(false);
    });
  });

  describe('countUnusedSubAccounts()', () => {
    const mockUserAddress =
      '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`;

    it('should return count of unused subaccounts', async () => {
      vi.mocked(subAccountsMock).mockResolvedValueOnce([
        {
          name: 'mc-a1b2c3d4',
          subAccountUser: '0xaaa0000000000000000000000000000000000001' as `0x${string}`,
          master: mockUserAddress,
          clearinghouseState: {} as any,
          spotState: { balances: [] },
        },
        {
          name: 'unused-1',
          subAccountUser: '0xbbb0000000000000000000000000000000000002' as `0x${string}`,
          master: mockUserAddress,
          clearinghouseState: {} as any,
          spotState: { balances: [] },
        },
        {
          name: 'unused-2',
          subAccountUser: '0xccc0000000000000000000000000000000000003' as `0x${string}`,
          master: mockUserAddress,
          clearinghouseState: {} as any,
          spotState: { balances: [] },
        },
      ]);

      const count = await client.countUnusedSubAccounts(mockUserAddress);

      expect(count).toBe(2);
    });
  });
});
