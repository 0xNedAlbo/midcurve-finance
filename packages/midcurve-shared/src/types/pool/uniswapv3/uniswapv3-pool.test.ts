/**
 * UniswapV3Pool.fromWire
 *
 * The typed door for wire payloads. `fromJSON` takes the loose `PoolJSON`, whose
 * `config`/`state` are `Record<string, unknown>` and whose tokens are `TokenJSON`
 * — so deserializing a real API payload through it forced a cast at every UI call
 * site, and the cast hid a field the serializer was not sending (`tokenHash`).
 * These tests pin the wire shape to what `serializeUniswapV3Pool` actually emits.
 */

import { describe, it, expect } from 'vitest';
import { UniswapV3Pool, type UniswapV3PoolJSON } from './uniswapv3-pool.js';
import { Erc20Token } from '../../token/index.js';

const CHAIN_ID = 42161;
const POOL_ADDRESS = '0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443';
const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

/**
 * Field-for-field what `serializeUniswapV3Pool` returns — copied from the
 * serializer, not invented. If the serializer changes, this fixture is the thing
 * that should fail first.
 */
function wirePool(): UniswapV3PoolJSON {
  return {
    id: 'pool-weth-usdc-arb',
    protocol: 'uniswapv3',
    token0: {
      id: 'tok-weth-arb',
      tokenType: 'erc20',
      name: 'Wrapped Ether',
      symbol: 'WETH',
      decimals: 18,
      tokenHash: `erc20/${CHAIN_ID}/${WETH}`,
      config: { address: WETH, chainId: CHAIN_ID },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
    token1: {
      id: 'tok-usdc-arb',
      tokenType: 'erc20',
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      tokenHash: `erc20/${CHAIN_ID}/${USDC}`,
      config: { address: USDC, chainId: CHAIN_ID },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
    feeBps: 5,
    config: {
      chainId: CHAIN_ID,
      address: POOL_ADDRESS,
      token0: WETH,
      token1: USDC,
      feeBps: 5,
      tickSpacing: 10,
    },
    state: {
      sqrtPriceX96: '1461446703485210103287273052203988822378723970342',
      currentTick: -201234,
      liquidity: '5234567890123456789',
      feeGrowthGlobal0: '123456789012345678901234567890',
      feeGrowthGlobal1: '987654321098765432109876543210',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-03T12:30:00.000Z',
  };
}

describe('UniswapV3Pool.fromWire', () => {
  it('accepts the wire shape without a cast', () => {
    // The compile-time half of this test: `wirePool()` is typed, not `as`-ed.
    // If UniswapV3PoolJSON ever stops describing the serializer output, this
    // file fails to typecheck before it fails to run.
    const pool = UniswapV3Pool.fromWire(wirePool());
    expect(pool).toBeInstanceOf(UniswapV3Pool);
  });

  it('parses bigint state fields from their string representation', () => {
    const pool = UniswapV3Pool.fromWire(wirePool());

    expect(pool.sqrtPriceX96).toBe(
      1461446703485210103287273052203988822378723970342n
    );
    expect(pool.liquidity).toBe(5234567890123456789n);
    expect(pool.typedState.feeGrowthGlobal0).toBe(
      123456789012345678901234567890n
    );
    expect(pool.typedState.feeGrowthGlobal1).toBe(
      987654321098765432109876543210n
    );
  });

  it('keeps non-bigint state and config fields as-is', () => {
    const pool = UniswapV3Pool.fromWire(wirePool());

    expect(pool.currentTick).toBe(-201234);
    expect(pool.chainId).toBe(CHAIN_ID);
    expect(pool.address).toBe(POOL_ADDRESS);
    expect(pool.feeBps).toBe(5);
    expect(pool.tickSpacing).toBe(10);
  });

  it('revives ISO timestamps as Date instances', () => {
    const pool = UniswapV3Pool.fromWire(wirePool());

    expect(pool.createdAt).toBeInstanceOf(Date);
    expect(pool.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(pool.updatedAt.toISOString()).toBe('2026-01-03T12:30:00.000Z');
  });

  it('reconstructs both tokens as Erc20Token instances', () => {
    const pool = UniswapV3Pool.fromWire(wirePool());

    expect(pool.token0).toBeInstanceOf(Erc20Token);
    expect(pool.token1).toBeInstanceOf(Erc20Token);
    expect((pool.token0 as Erc20Token).address).toBe(WETH);
    expect((pool.token1 as Erc20Token).decimals).toBe(6);
  });

  it('carries tokenHash through, rather than leaving it undefined', () => {
    // The regression this factory exists for: `tokenHash` is declared
    // `readonly tokenHash: string` on BaseToken, but the wire type omitted it
    // and the serializer never sent it — so every UI-reconstructed pool had
    // `undefined` sitting in a field the compiler promised was a string.
    const pool = UniswapV3Pool.fromWire(wirePool());

    expect(pool.token0.tokenHash).toBe(`erc20/${CHAIN_ID}/${WETH}`);
    expect(pool.token1.tokenHash).toBe(`erc20/${CHAIN_ID}/${USDC}`);
  });

  it('throws when the payload is not a uniswapv3 pool', () => {
    const foreign = { ...wirePool(), protocol: 'orca' } as unknown as UniswapV3PoolJSON;

    expect(() => UniswapV3Pool.fromWire(foreign)).toThrow(
      "Expected protocol 'uniswapv3', got 'orca'"
    );
  });
});

describe('Erc20Token.fromWire', () => {
  it('throws when the payload is not an erc20 token', () => {
    const foreign = {
      ...wirePool().token0,
      tokenType: 'basic-currency',
    } as unknown as Parameters<typeof Erc20Token.fromWire>[0];

    expect(() => Erc20Token.fromWire(foreign)).toThrow(
      "Expected tokenType 'erc20', got 'basic-currency'"
    );
  });
});
