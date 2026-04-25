/**
 * Position-context helper for the math/simulation tools.
 *
 * Each tool accepts the same protocol-discriminator inputs as get_position
 * (`protocol`, `chainId`, `nftId` for NFT positions; `protocol`, `chainId`,
 * `vaultAddress`, `ownerAddress` for vault positions). When all required
 * fields are present, this helper fetches the position via the API and
 * extracts the canonical fields the math utilities need.
 *
 * Tools layer their own explicit overrides (sqrtPriceX96, ticks, …) on top
 * of the resolved context, so a user can simulate a hypothetical without
 * having to repeat every field.
 */

import { z } from 'zod';
import type { ApiClient } from '../api-client.js';

export const positionLookupInputSchema = {
  protocol: z
    .enum(['uniswapv3', 'uniswapv3-vault'])
    .optional()
    .describe(
      'Optional. When provided together with chainId + nftId (or chainId + vaultAddress + ownerAddress), ' +
        'the tool auto-fills missing arguments from the live position state. Any explicit override below ' +
        'wins over the resolved context.',
    ),
  chainId: z
    .number()
    .int()
    .optional()
    .describe('EVM chain ID for the position lookup (e.g. 42161). Required when protocol is given.'),
  nftId: z
    .string()
    .optional()
    .describe('Required when protocol="uniswapv3". Numeric NFT token ID as a string.'),
  vaultAddress: z
    .string()
    .optional()
    .describe('Required when protocol="uniswapv3-vault". EIP-55 vault contract address.'),
  ownerAddress: z
    .string()
    .optional()
    .describe('Required when protocol="uniswapv3-vault". EIP-55 wallet address that owns the vault shares.'),
};

export type PositionLookupArgs = {
  protocol?: 'uniswapv3' | 'uniswapv3-vault';
  chainId?: number;
  nftId?: string;
  vaultAddress?: string;
  ownerAddress?: string;
};

export interface PositionContext {
  positionHash: string;
  protocol: 'uniswapv3' | 'uniswapv3-vault';
  isToken0Quote: boolean;
  baseToken: { address: string; symbol: string; decimals: number };
  quoteToken: { address: string; symbol: string; decimals: number };
  token0: { address: string; symbol: string; decimals: number };
  token1: { address: string; symbol: string; decimals: number };
  feeBps: number;
  tickSpacing: number;
  pool: {
    address: string;
    chainId: number;
    sqrtPriceX96: string;
    currentTick: number;
  };
  position: {
    tickLower: number;
    tickUpper: number;
    liquidity: string;
  };
}

interface FetchedToken {
  symbol: string;
  decimals: number;
  config: { address: string; chainId: number };
}

interface FetchedPosition {
  positionHash: string;
  protocol: string;
  isToken0Quote: boolean;
  pool: {
    feeBps: number;
    token0: FetchedToken;
    token1: FetchedToken;
    config: { chainId: number; address?: string; poolAddress?: string; tickSpacing: number };
    state: { sqrtPriceX96: string; currentTick: number };
  };
  config: Record<string, unknown>;
  state: Record<string, unknown>;
}

function flattenToken(t: FetchedToken): { address: string; symbol: string; decimals: number } {
  return { address: t.config.address, symbol: t.symbol, decimals: t.decimals };
}

/**
 * Vault state.liquidity is the full vault's liquidity in the underlying NFT.
 * Pure-math tools should default to the *user's* proportional share, since
 * that's what "how much do I hold" questions are about.
 */
function effectiveLiquidity(fetched: FetchedPosition): bigint {
  const state = fetched.state as { liquidity: string; sharesBalance?: string; totalSupply?: string };
  const full = BigInt(state.liquidity);
  if (fetched.protocol !== 'uniswapv3-vault') return full;
  const shares = state.sharesBalance ? BigInt(state.sharesBalance) : 0n;
  const supply = state.totalSupply ? BigInt(state.totalSupply) : 0n;
  if (supply === 0n) return 0n;
  return (full * shares) / supply;
}

/**
 * Resolve a position into the canonical context the math tools consume.
 * Throws if the supplied arguments are insufficient OR inconsistent.
 */
export async function resolvePositionContext(
  client: ApiClient,
  args: PositionLookupArgs,
): Promise<PositionContext> {
  if (!args.protocol) {
    throw new Error('protocol is required to look up a position');
  }
  if (!args.chainId) {
    throw new Error('chainId is required to look up a position');
  }

  let path: string;
  if (args.protocol === 'uniswapv3') {
    if (!args.nftId) {
      throw new Error('nftId is required when protocol="uniswapv3"');
    }
    path = `/api/v1/positions/uniswapv3/${args.chainId}/${args.nftId}`;
  } else {
    if (!args.vaultAddress || !args.ownerAddress) {
      throw new Error(
        'vaultAddress and ownerAddress are both required when protocol="uniswapv3-vault"',
      );
    }
    path = `/api/v1/positions/uniswapv3-vault/${args.chainId}/${args.vaultAddress}/${args.ownerAddress}`;
  }

  const fetched = await client.get<FetchedPosition>(path);
  return toPositionContext(fetched);
}

function toPositionContext(fetched: FetchedPosition): PositionContext {
  const token0 = flattenToken(fetched.pool.token0);
  const token1 = flattenToken(fetched.pool.token1);
  const baseToken = fetched.isToken0Quote ? token1 : token0;
  const quoteToken = fetched.isToken0Quote ? token0 : token1;

  const cfg = fetched.config as { tickLower: number; tickUpper: number };
  const liquidity = effectiveLiquidity(fetched);

  return {
    positionHash: fetched.positionHash,
    protocol: fetched.protocol as 'uniswapv3' | 'uniswapv3-vault',
    isToken0Quote: fetched.isToken0Quote,
    baseToken,
    quoteToken,
    token0,
    token1,
    feeBps: fetched.pool.feeBps,
    tickSpacing: fetched.pool.config.tickSpacing,
    pool: {
      address: fetched.pool.config.address ?? fetched.pool.config.poolAddress ?? '',
      chainId: fetched.pool.config.chainId,
      sqrtPriceX96: fetched.pool.state.sqrtPriceX96,
      currentTick: fetched.pool.state.currentTick,
    },
    position: {
      tickLower: cfg.tickLower,
      tickUpper: cfg.tickUpper,
      liquidity: liquidity.toString(),
    },
  };
}

/**
 * `true` if any of the protocol-lookup fields is set. Tools use this to
 * decide whether to call resolvePositionContext.
 */
export function hasPositionLookupArgs(args: PositionLookupArgs): boolean {
  return !!(
    args.protocol ||
    args.nftId ||
    args.vaultAddress ||
    args.ownerAddress
  );
}
