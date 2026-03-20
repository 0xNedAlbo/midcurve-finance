/**
 * Dynamic Fee Calculation
 *
 * Computes feeBps dynamically per execution based on estimated gas cost
 * relative to the expected withdrawal value. This allows the operator
 * to recover gas costs via the feeRecipient mechanism in the
 * UniswapV3PositionCloser contract.
 *
 * Flow:
 * 1. Estimate gas cost in native currency (gasLimit * gasPrice)
 * 2. Get token prices in native currency via CoinGecko cross-rate
 * 3. Estimate withdrawal value in native currency
 * 4. Compute feeBps = (gasCost / withdrawalValue) * 10000
 * 5. Apply 20% margin buffer
 * 6. Cap at maxFeeBps (100 = 1%)
 */

import { getNativeCurrencyCoingeckoId } from '@midcurve/shared';
import { CoinGeckoClient } from '@midcurve/services';
import { automationLogger } from './logger';

const log = automationLogger.child({ component: 'DynamicFee' });

/** Maximum fee in basis points (enforced by contract) */
const MAX_FEE_BPS = 100; // 1%

/** Margin buffer for gas price volatility (20%) */
const GAS_MARGIN_MULTIPLIER = 120n;
const GAS_MARGIN_DIVISOR = 100n;

export interface DynamicFeeResult {
  /** Computed feeBps (0-100) */
  feeBps: number;
  /** Whether gas cost can be covered at maxFeeBps */
  canCoverGas: boolean;
  /** Estimated gas cost in native currency (wei) */
  estimatedGasCostWei: bigint;
  /** Estimated withdrawal value in native currency (wei-equivalent) */
  estimatedWithdrawalValueWei: bigint;
  /** Raw computed feeBps before capping (for logging) */
  rawFeeBps: number;
}

export interface DynamicFeeInput {
  /** Chain ID for native currency lookup */
  chainId: number;
  /** Estimated gas limit for the execution */
  gasLimit: bigint;
  /** Current gas price in wei */
  gasPrice: bigint;
  /** Token0 CoinGecko ID (optional — if missing, fee cannot be computed) */
  token0CoingeckoId: string | undefined;
  /** Token1 CoinGecko ID (optional — if missing, fee cannot be computed) */
  token1CoingeckoId: string | undefined;
  /** Token0 decimals */
  token0Decimals: number;
  /** Token1 decimals */
  token1Decimals: number;
  /** Estimated amount0 to be withdrawn (in token0 smallest units) */
  estimatedAmount0: bigint;
  /** Estimated amount1 to be withdrawn (in token1 smallest units) */
  estimatedAmount1: bigint;
}

/**
 * Compute dynamic feeBps based on gas cost vs withdrawal value.
 *
 * Returns a DynamicFeeResult with the computed feeBps and whether
 * gas costs can be covered. If token prices are unavailable,
 * falls back to 0 feeBps (no fee).
 */
export async function computeDynamicFeeBps(input: DynamicFeeInput): Promise<DynamicFeeResult> {
  const {
    chainId,
    gasLimit,
    gasPrice,
    token0CoingeckoId,
    token1CoingeckoId,
    token0Decimals,
    token1Decimals,
    estimatedAmount0,
    estimatedAmount1,
  } = input;

  // 1. Estimate gas cost in native currency (with 20% margin)
  const rawGasCost = gasLimit * gasPrice;
  const estimatedGasCostWei = (rawGasCost * GAS_MARGIN_MULTIPLIER) / GAS_MARGIN_DIVISOR;

  // 2. Get native currency CoinGecko ID
  const nativeCurrencyId = getNativeCurrencyCoingeckoId(chainId);

  // 3. Collect CoinGecko IDs to fetch (deduplicate, skip missing)
  const coinIdsToFetch = new Set<string>([nativeCurrencyId]);
  if (token0CoingeckoId) coinIdsToFetch.add(token0CoingeckoId);
  if (token1CoingeckoId) coinIdsToFetch.add(token1CoingeckoId);

  // If neither token has a CoinGecko ID, we can't compute the fee
  if (!token0CoingeckoId && !token1CoingeckoId) {
    log.warn({
      chainId,
      msg: 'Neither token has a CoinGecko ID, cannot compute dynamic fee — using 0 feeBps',
    });
    return {
      feeBps: 0,
      canCoverGas: false,
      estimatedGasCostWei,
      estimatedWithdrawalValueWei: 0n,
      rawFeeBps: 0,
    };
  }

  // 4. Fetch current USD prices via CoinGecko (60s cached)
  const coingeckoClient = CoinGeckoClient.getInstance();
  const prices = await coingeckoClient.getSimplePrices([...coinIdsToFetch]);

  const nativeUsd = prices[nativeCurrencyId]?.usd ?? 0;
  if (nativeUsd === 0) {
    log.warn({
      chainId,
      nativeCurrencyId,
      msg: 'Native currency USD price is 0, cannot compute dynamic fee — using 0 feeBps',
    });
    return {
      feeBps: 0,
      canCoverGas: false,
      estimatedGasCostWei,
      estimatedWithdrawalValueWei: 0n,
      rawFeeBps: 0,
    };
  }

  // 5. Compute token prices in native currency (cross-rate)
  const token0Usd = token0CoingeckoId ? (prices[token0CoingeckoId]?.usd ?? 0) : 0;
  const token1Usd = token1CoingeckoId ? (prices[token1CoingeckoId]?.usd ?? 0) : 0;

  const token0PriceInNative = token0Usd / nativeUsd;
  const token1PriceInNative = token1Usd / nativeUsd;

  // 6. Estimate withdrawal value in native currency
  // Convert token amounts to native currency value using 18-decimal precision
  const PRECISION = 10n ** 18n;

  const token0ValueWei = estimatedAmount0 > 0n
    ? (estimatedAmount0 * BigInt(Math.round(token0PriceInNative * 1e18))) / (10n ** BigInt(token0Decimals))
    : 0n;

  const token1ValueWei = estimatedAmount1 > 0n
    ? (estimatedAmount1 * BigInt(Math.round(token1PriceInNative * 1e18))) / (10n ** BigInt(token1Decimals))
    : 0n;

  const estimatedWithdrawalValueWei = token0ValueWei + token1ValueWei;

  // 7. Compute feeBps
  if (estimatedWithdrawalValueWei === 0n) {
    log.warn({
      chainId,
      token0PriceInNative,
      token1PriceInNative,
      estimatedAmount0: estimatedAmount0.toString(),
      estimatedAmount1: estimatedAmount1.toString(),
      msg: 'Estimated withdrawal value is 0, cannot compute dynamic fee — using 0 feeBps',
    });
    return {
      feeBps: 0,
      canCoverGas: false,
      estimatedGasCostWei,
      estimatedWithdrawalValueWei: 0n,
      rawFeeBps: 0,
    };
  }

  // feeBps = (gasCost / withdrawalValue) * 10000
  // Using PRECISION to maintain accuracy with bigint division
  const rawFeeBpsScaled = (estimatedGasCostWei * PRECISION * 10000n) / (estimatedWithdrawalValueWei * PRECISION);
  const rawFeeBps = Number(rawFeeBpsScaled);

  // Cap at maxFeeBps
  const feeBps = Math.min(rawFeeBps, MAX_FEE_BPS);
  const canCoverGas = rawFeeBps <= MAX_FEE_BPS;

  log.info({
    chainId,
    estimatedGasCostWei: estimatedGasCostWei.toString(),
    estimatedWithdrawalValueWei: estimatedWithdrawalValueWei.toString(),
    nativeUsd,
    token0Usd,
    token1Usd,
    rawFeeBps,
    feeBps,
    canCoverGas,
    msg: 'Dynamic fee computed',
  });

  return {
    feeBps,
    canCoverGas,
    estimatedGasCostWei,
    estimatedWithdrawalValueWei,
    rawFeeBps,
  };
}
