import { z } from 'zod';
import type { SerializedCloseOrder } from '@midcurve/api-shared';
import type { ApiClient } from '../api-client.js';
import { formatCloseOrders } from '../formatters.js';
import { resolvePositionContext } from '../lib/position-context.js';

const inputSchema = {
  protocol: z
    .enum(['uniswapv3', 'uniswapv3-vault'])
    .describe('Position protocol — same semantics as in get_position.'),
  chainId: z.number().int().describe('EVM chain ID.'),
  nftId: z.string().optional().describe('Required for protocol="uniswapv3".'),
  vaultAddress: z
    .string()
    .optional()
    .describe('Required for protocol="uniswapv3-vault".'),
  ownerAddress: z
    .string()
    .optional()
    .describe('Required for protocol="uniswapv3-vault".'),
};

type Args = { [K in keyof typeof inputSchema]: z.infer<(typeof inputSchema)[K]> };

function buildPath(args: Args): string {
  if (args.protocol === 'uniswapv3') {
    if (!args.nftId) throw new Error('nftId is required when protocol="uniswapv3"');
    return `/api/v1/positions/uniswapv3/${args.chainId}/${args.nftId}/close-orders`;
  }
  if (!args.vaultAddress || !args.ownerAddress) {
    throw new Error('vaultAddress and ownerAddress are required when protocol="uniswapv3-vault"');
  }
  return `/api/v1/positions/uniswapv3-vault/${args.chainId}/${args.vaultAddress}/${args.ownerAddress}/close-orders`;
}

export function buildListCloseOrdersTool(client: ApiClient) {
  return {
    name: 'list_close_orders',
    config: {
      title: 'List close orders for a position',
      description:
        'List stop-loss and take-profit orders attached to a position, with their automation state ' +
        '("monitoring", "executing", "retrying", "failed", "executed", "inactive") and trigger conditions. ' +
        'Same args shape as get_position.\n\n' +
        'Money and price fields are dual-emitted: `<field>` is a humanized display string in the ' +
        'position\'s quote token (e.g. "3,808.49 USDC"); `<field>Raw` is the bigint as decimal string ' +
        'in quote-token base units. Raw is canonical — use it for further computation; display is ' +
        'for narration/rendering.\n\n' +
        'Per-item shape:\n' +
        '- pool: { chainId, poolAddress, pair, feeBps, feeTier, baseToken, quoteToken } — §3.1 summary\n' +
        '- triggerTick: canonical Uniswap tick (single-emit int)\n' +
        '- triggerPrice / triggerPriceRaw: humanized quote-per-base price (raw is bigint scaled to ' +
        'quote-token decimals); both null when triggerTick is null\n' +
        '- closeOrderType ("STOP_LOSS"|"TAKE_PROFIT"), automationState, executionAttempts, lastError\n' +
        '- triggerMode, slippageBps, swapDirection, swapSlippageBps\n' +
        '- validUntil, createdAt, updatedAt — humanized timestamps\n' +
        '- contractAddress, payoutAddress, operatorAddress',
      inputSchema,
    },
    handler: async (args: Args) => {
      const path = buildPath(args);
      const [orders, ctx] = await Promise.all([
        client.get<SerializedCloseOrder[]>(path),
        resolvePositionContext(client, args),
      ]);
      const formatted = formatCloseOrders(orders, ctx);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(formatted, null, 2) }],
      };
    },
  };
}
