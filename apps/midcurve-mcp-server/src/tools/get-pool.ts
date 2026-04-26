import { z } from 'zod';
import type { ApiClient } from '../api-client.js';
import { formatPool } from '../formatters.js';

const inputSchema = {
  chainId: z.number().int().describe('EVM chain ID, e.g. 42161 (Arbitrum).'),
  address: z.string().describe('EIP-55 checksummed Uniswap V3 pool contract address.'),
  metrics: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Include subgraph metrics (TVL, 24h volume/fees from the last complete UTC day, ' +
        '7d cumulative fees, 7d average daily volume/fees), fee-APR derivations, ' +
        'per-token σ vs USD, cross-pair σ, and the σ-filter verdict (PASS/FAIL/INSUFFICIENT_DATA). ' +
        'Setting this to false suppresses ALL of the above — no CoinGecko fetches happen.'
    ),
  fees: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include fee data for APR calculations.'),
};

export function buildGetPoolTool(client: ApiClient) {
  return {
    name: 'get_pool',
    config: {
      title: 'Get Uniswap V3 pool detail',
      description:
        'Returns pool state (tokens, fee tier, current tick / sqrtPrice) plus optional ' +
        'subgraph metrics, fee-APR, volatility (σ), and the σ-filter investibility verdict ' +
        '(PRD-pool-sigma-filter). Use this when you need pool-level context (not user-specific) ' +
        '— comparing fee tiers, checking liquidity depth, or screening for LP-viability.\n\n' +
        'Standalone pool detail uses the canonical Uniswap pool ordering (`token0`/`token1`) ' +
        'rather than the position-context base/quote pivot — outside a user\'s position there ' +
        'is no canonical base/quote preference (see convention §3.1). The pool\'s `state` ' +
        '(sqrtPriceX96, currentTick, liquidity, feeGrowthGlobal0/1) and optional `feeData` block are ' +
        'passed through as canonical bigint strings — single-emit per §2.\n\n' +
        '**`metrics` block** (when `metrics=true`):\n' +
        '- USD money fields are dual-emitted: `tvl`/`tvlRaw`, `volume24h`/`volume24hRaw`, ' +
        '`fees24h`/`fees24hRaw`, `fees7d`/`fees7dRaw`, `volume7dAvg`/`volume7dAvgRaw`, ' +
        '`fees7dAvg`/`fees7dAvgRaw`. Display is compact ("$123.5M"); Raw is the subgraph float string. ' +
        '24h is the last complete UTC day; 7d aggregations are over the last 7 complete UTC days ' +
        '(1–7 for young pools). The in-progress current UTC day is excluded.\n' +
        '- Fee-APR percentages are single-emit humanized strings (convention §73): ' +
        '`apr7d` (legacy field), `feeApr24h`, `feeApr7dAvg`, `feeAprPrimary`. ' +
        '`feeAprSource` enum (`24h` | `7d_avg` | `unavailable`) records which window feeds the verdict.\n' +
        '- `volatility` block: `token0` and `token1` carry per-token σ vs USD; `pair` is the ' +
        'synthetic cross-pair σ (direction-neutral for log returns). Each `sigma60d` / `sigma365d` ' +
        'has `{status, value, sigmaSqOver8?, nReturns}` where `value` and `sigmaSqOver8` are humanized ' +
        'percentages and `status` is `ok` | `insufficient_history` | `token_not_listed` | `fetch_failed`. ' +
        '`velocity` is `pair.sigma60d / pair.sigma365d` rounded to 3 decimals (vol-regime indicator).\n' +
        '- `sigmaFilter` block: the LP-viability verdict comparing fee-APR vs `σ²/8` (the LVR threshold). ' +
        'Fields: `feeApr`, `sigmaSqOver8_365d`, `sigmaSqOver8_60d` (humanized %); ' +
        '`marginLongTerm`, `marginShortTerm` (signed humanized %, e.g. `+18.3%` or `-3.7%`); ' +
        '`verdictLongTerm`, `verdictShortTerm` (`PASS` | `FAIL` | `INSUFFICIENT_DATA`); ' +
        '`verdictAgreement` (`AGREE` | `DIVERGENT` | `INSUFFICIENT_DATA`). ' +
        '**Use `verdictLongTerm` as the canonical filter signal** — the 365d window is the regime-neutral anchor. ' +
        'Short-term and agreement are diagnostic, not for default inclusion/exclusion.',
      inputSchema,
    },
    handler: async (args: { [K in keyof typeof inputSchema]: z.infer<(typeof inputSchema)[K]> }) => {
      const pool = await client.get<Parameters<typeof formatPool>[0]>(
        `/api/v1/pools/uniswapv3/${args.chainId}/${args.address}`,
        { metrics: args.metrics, fees: args.fees }
      );

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(formatPool(pool), null, 2) }],
      };
    },
  };
}
