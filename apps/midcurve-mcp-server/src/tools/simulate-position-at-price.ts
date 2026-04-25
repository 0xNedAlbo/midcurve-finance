import { z } from 'zod';
import type { PositionSimulationData } from '@midcurve/api-shared';
import { formatPercentage, formatTokenAmount } from '@midcurve/shared';
import type { ApiClient } from '../api-client.js';
import { formatPoolSummary } from '../formatters.js';
import { resolvePositionContext } from '../lib/position-context.js';

const inputSchema = {
  protocol: z
    .enum(['uniswapv3', 'uniswapv3-vault'])
    .describe(
      'Position protocol. Use "uniswapv3" for classic NFT positions (then provide nftId), ' +
        'or "uniswapv3-vault" for tokenized vault positions (then provide vaultAddress + ownerAddress).'
    ),
  chainId: z.number().int().describe('EVM chain ID, e.g. 42161 (Arbitrum).'),
  nftId: z
    .string()
    .optional()
    .describe('Required for protocol="uniswapv3". Numeric NFT token ID as a string.'),
  vaultAddress: z
    .string()
    .optional()
    .describe('Required for protocol="uniswapv3-vault". EIP-55 vault contract address.'),
  ownerAddress: z
    .string()
    .optional()
    .describe('Required for protocol="uniswapv3-vault". EIP-55 wallet address that owns the vault shares.'),
  price: z
    .string()
    .describe(
      'Hypothetical base-token price in quote-token units (raw bigint string scaled to ' +
        'baseTokenDecimals — i.e. the same form returned by other position endpoints).',
    ),
};

type Args = { [K in keyof typeof inputSchema]: z.infer<(typeof inputSchema)[K]> };

function buildPath(args: Args): string {
  if (args.protocol === 'uniswapv3') {
    if (!args.nftId) throw new Error('nftId is required when protocol="uniswapv3"');
    return `/api/v1/positions/uniswapv3/${args.chainId}/${args.nftId}/simulate`;
  }
  if (!args.vaultAddress || !args.ownerAddress) {
    throw new Error('vaultAddress and ownerAddress are required when protocol="uniswapv3-vault"');
  }
  return `/api/v1/positions/uniswapv3-vault/${args.chainId}/${args.vaultAddress}/${args.ownerAddress}/simulate`;
}

export function buildSimulatePositionAtPriceTool(client: ApiClient) {
  return {
    name: 'simulate_position_at_price',
    config: {
      title: 'Simulate position state at a hypothetical price',
      description:
        'Returns a hypothetical snapshot of a position at the given base-token price: position value ' +
        'in quote tokens, PnL vs cost basis, the base/quote token amounts the position would hold at ' +
        'that price, and the phase (below / in-range / above). Use to answer "if ETH dropped to $1500 ' +
        'what would my position look like" or to find the price at which a position breaks even. ' +
        'For vault positions the values are scaled by the user\'s share of total supply. ' +
        'Two protocols are supported: "uniswapv3" (chainId + nftId) and "uniswapv3-vault" ' +
        '(chainId + vaultAddress + ownerAddress).\n\n' +
        'Money and price fields are dual-emitted: `<field>` is a humanized display string in the ' +
        'position\'s quote token (e.g. "1,234.56 USDC"); `<field>Raw` is the bigint as decimal string ' +
        'in quote-token base units. Raw is canonical — use it for further computation; display is ' +
        'for narration/rendering.\n\n' +
        'Output shape:\n' +
        '- pool: { chainId, poolAddress, pair, feeBps, feeTier, baseToken, quoteToken } — §3.1 summary\n' +
        '- price/priceRaw: the simulated base-token price (raw scaled to baseTokenDecimals)\n' +
        '- positionValue/positionValueRaw, pnlValue/pnlValueRaw, ' +
        'baseTokenAmount/baseTokenAmountRaw, quoteTokenAmount/quoteTokenAmountRaw\n' +
        '- pnlPercent: percentage string (single-emit)\n' +
        '- phase: "below" | "in-range" | "above"',
      inputSchema,
    },
    handler: async (args: Args) => {
      const path = buildPath(args);
      const [sim, ctx] = await Promise.all([
        client.get<PositionSimulationData>(path, { price: args.price }),
        resolvePositionContext(client, args),
      ]);

      const pool = formatPoolSummary({
        chainId: ctx.pool.chainId,
        poolAddress: ctx.pool.address,
        feeBps: ctx.feeBps,
        isToken0Quote: ctx.isToken0Quote,
        token0: ctx.token0,
        token1: ctx.token1,
      });

      const result = {
        pool,
        phase: sim.phase,
        price: formatTokenAmount(sim.price, sim.quoteTokenSymbol, sim.quoteTokenDecimals),
        priceRaw: sim.price,
        positionValue: formatTokenAmount(sim.positionValue, sim.quoteTokenSymbol, sim.quoteTokenDecimals),
        positionValueRaw: sim.positionValue,
        pnlValue: formatTokenAmount(sim.pnlValue, sim.quoteTokenSymbol, sim.quoteTokenDecimals),
        pnlValueRaw: sim.pnlValue,
        pnlPercent: formatPercentage(sim.pnlPercent, 2),
        baseTokenAmount: formatTokenAmount(
          sim.baseTokenAmount,
          sim.baseTokenSymbol,
          sim.baseTokenDecimals,
        ),
        baseTokenAmountRaw: sim.baseTokenAmount,
        quoteTokenAmount: formatTokenAmount(
          sim.quoteTokenAmount,
          sim.quoteTokenSymbol,
          sim.quoteTokenDecimals,
        ),
        quoteTokenAmountRaw: sim.quoteTokenAmount,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  };
}
