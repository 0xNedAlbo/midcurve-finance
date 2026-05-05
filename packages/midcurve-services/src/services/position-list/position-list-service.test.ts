import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@midcurve/database';
import { PositionListService } from './position-list-service.js';

/**
 * Tests for PositionListService.list({ includePool: true }) — the opt-in
 * pool enrichment used by the MCP `list_positions` tool.
 *
 * The default (lean) path is exercised implicitly by the API integration test;
 * here we focus on the new branch.
 */
describe('PositionListService', () => {
  // EIP-55 checksummed addresses used across fixtures
  const PAXG = '0x45804880De22913dAFE09f4980848ECE6EcbAf78';
  const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const POOL_PAXG_USDC = '0x32098BFCA7be083e26C52c9f687aff4ABb98dCf2';
  const WETH_BASE = '0x4200000000000000000000000000000000000006';
  const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
  const POOL_WETH_USDC_BASE = '0xd0b53D9277642d899DF5C87A3966A349A798F224';

  const baseRow = {
    id: 'cuid_v3_paxg',
    positionHash: 'uniswapv3-vault/1/0xA/0xB',
    protocol: 'uniswapv3-vault',
    type: 'VAULT_SHARES',
    currentValue: '0',
    costBasis: '0',
    realizedPnl: '0',
    unrealizedPnl: '0',
    realizedCashflow: '0',
    unrealizedCashflow: '0',
    collectedYield: '0',
    unclaimedYield: '0',
    lastYieldClaimedAt: null,
    baseApr: null,
    rewardApr: null,
    totalApr: null,
    positionOpenedAt: new Date('2025-01-01T00:00:00Z'),
    archivedAt: null,
    isArchived: false,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  };

  const paxgUsdcRow = {
    ...baseRow,
    config: {
      chainId: 1,
      poolAddress: POOL_PAXG_USDC,
      token0Address: PAXG,
      token1Address: USDC_ETH,
      feeBps: 3000,
      tickSpacing: 60,
      tickUpper: 200000,
      tickLower: 199000,
      isToken0Quote: false,
      priceRangeLower: '0',
      priceRangeUpper: '0',
    },
  };

  const wethUsdcBaseRow = {
    ...baseRow,
    id: 'cuid_v3_weth',
    positionHash: 'uniswapv3/8453/12345',
    protocol: 'uniswapv3',
    type: 'LP_CONCENTRATED',
    config: {
      chainId: 8453,
      nftId: 12345,
      poolAddress: POOL_WETH_USDC_BASE,
      token0Address: WETH_BASE,
      token1Address: USDC_BASE,
      feeBps: 500,
      tickSpacing: 10,
      tickUpper: 200920,
      tickLower: 200820,
      isToken0Quote: false,
      priceRangeLower: '0',
      priceRangeUpper: '0',
    },
  };

  const tokenRows = [
    {
      tokenHash: `erc20/1/${PAXG}`,
      symbol: 'PAXG',
      decimals: 18,
      config: { chainId: 1, address: PAXG },
    },
    {
      tokenHash: `erc20/1/${USDC_ETH}`,
      symbol: 'USDC',
      decimals: 6,
      config: { chainId: 1, address: USDC_ETH },
    },
    {
      tokenHash: `erc20/8453/${WETH_BASE}`,
      symbol: 'WETH',
      decimals: 18,
      config: { chainId: 8453, address: WETH_BASE },
    },
    {
      tokenHash: `erc20/8453/${USDC_BASE}`,
      symbol: 'USDC',
      decimals: 6,
      config: { chainId: 8453, address: USDC_BASE },
    },
  ];

  let mockPrisma: PrismaClient;
  let service: PositionListService;

  beforeEach(() => {
    mockPrisma = {
      position: {
        findMany: vi.fn(),
        count: vi.fn(),
      },
      token: {
        findMany: vi.fn(),
      },
    } as unknown as PrismaClient;
    service = new PositionListService({ prisma: mockPrisma });
  });

  it('omits pool field when includePool is not set', async () => {
    vi.mocked(mockPrisma.position.findMany).mockResolvedValue([paxgUsdcRow] as any);
    vi.mocked(mockPrisma.position.count).mockResolvedValue(1);

    const result = await service.list('user_1');

    expect(result.positions[0].pool).toBeUndefined();
    expect(mockPrisma.token.findMany).not.toHaveBeenCalled();
  });

  it('attaches pool summary for both uniswapv3 and uniswapv3-vault rows in a single batched token lookup', async () => {
    vi.mocked(mockPrisma.position.findMany).mockResolvedValue([
      paxgUsdcRow,
      wethUsdcBaseRow,
    ] as any);
    vi.mocked(mockPrisma.position.count).mockResolvedValue(2);
    vi.mocked(mockPrisma.token.findMany).mockResolvedValue(tokenRows as any);

    const result = await service.list('user_1', { includePool: true });

    expect(mockPrisma.token.findMany).toHaveBeenCalledTimes(1);
    const findManyArg = vi.mocked(mockPrisma.token.findMany).mock.calls[0][0]!;
    const tokenHashes = (findManyArg.where as any).tokenHash.in as string[];
    expect(tokenHashes).toHaveLength(4);
    expect(new Set(tokenHashes)).toEqual(
      new Set([
        `erc20/1/${PAXG}`,
        `erc20/1/${USDC_ETH}`,
        `erc20/8453/${WETH_BASE}`,
        `erc20/8453/${USDC_BASE}`,
      ])
    );

    const [paxg, weth] = result.positions;

    expect(paxg.pool).toEqual({
      chainId: 1,
      poolAddress: POOL_PAXG_USDC,
      feeBps: 3000,
      isToken0Quote: false,
      token0: { address: PAXG, symbol: 'PAXG', decimals: 18 },
      token1: { address: USDC_ETH, symbol: 'USDC', decimals: 6 },
    });

    expect(weth.pool).toEqual({
      chainId: 8453,
      poolAddress: POOL_WETH_USDC_BASE,
      feeBps: 500,
      isToken0Quote: false,
      token0: { address: WETH_BASE, symbol: 'WETH', decimals: 18 },
      token1: { address: USDC_BASE, symbol: 'USDC', decimals: 6 },
    });
  });

  it('throws when a referenced token is missing from the Token table', async () => {
    vi.mocked(mockPrisma.position.findMany).mockResolvedValue([paxgUsdcRow] as any);
    vi.mocked(mockPrisma.position.count).mockResolvedValue(1);
    // Token table missing PAXG entry
    vi.mocked(mockPrisma.token.findMany).mockResolvedValue([
      tokenRows[1], // USDC only
    ] as any);

    await expect(service.list('user_1', { includePool: true })).rejects.toThrow(
      /Token not found for erc20\/1\/0x4580/
    );
  });

  it('smoke: uniswapv3-staking row passes through findMany + pool enrichment', async () => {
    // SPEC-0003b PR4b refinement #4 — staking positions have the same
    // pool-config primitives as uniswapv3/uniswapv3-vault, so the lean list
    // path and the includePool enrichment must work without protocol-specific
    // branches. State (yieldTarget, vaultState) intentionally lives only on
    // the protocol-specific detail endpoint, not on PositionListRow.
    const stakingRow = {
      ...baseRow,
      id: 'cuid_v3_staking',
      positionHash: 'uniswapv3-staking/8453/0xVAULT',
      protocol: 'uniswapv3-staking',
      type: 'STAKING_VAULT',
      config: {
        chainId: 8453,
        vaultAddress: '0x000000000000000000000000000000000000Va01',
        poolAddress: POOL_WETH_USDC_BASE,
        token0Address: WETH_BASE,
        token1Address: USDC_BASE,
        feeBps: 500,
        tickSpacing: 10,
        tickLower: 200820,
        tickUpper: 200920,
        isToken0Quote: false,
        priceRangeLower: '0',
        priceRangeUpper: '0',
      },
    };

    vi.mocked(mockPrisma.position.findMany).mockResolvedValue([stakingRow] as any);
    vi.mocked(mockPrisma.position.count).mockResolvedValue(1);
    vi.mocked(mockPrisma.token.findMany).mockResolvedValue(
      tokenRows.filter((t) =>
        t.tokenHash === `erc20/8453/${WETH_BASE}` ||
        t.tokenHash === `erc20/8453/${USDC_BASE}`,
      ) as any,
    );

    const result = await service.list('user_1', { includePool: true });

    expect(result.positions).toHaveLength(1);
    const [row] = result.positions;
    expect(row.protocol).toBe('uniswapv3-staking');
    expect(row.pool).toEqual({
      chainId: 8453,
      poolAddress: POOL_WETH_USDC_BASE,
      feeBps: 500,
      isToken0Quote: false,
      token0: { address: WETH_BASE, symbol: 'WETH', decimals: 18 },
      token1: { address: USDC_BASE, symbol: 'USDC', decimals: 6 },
    });
  });

  it('skips token lookup entirely when result set is empty', async () => {
    vi.mocked(mockPrisma.position.findMany).mockResolvedValue([] as any);
    vi.mocked(mockPrisma.position.count).mockResolvedValue(0);

    const result = await service.list('user_1', { includePool: true });

    expect(result.positions).toHaveLength(0);
    expect(mockPrisma.token.findMany).not.toHaveBeenCalled();
  });
});
