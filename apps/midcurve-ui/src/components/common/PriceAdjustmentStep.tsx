/**
 * PriceAdjustmentStep - Shared pool price adjustment UI for wizard transaction steps
 *
 * Displays current pool price, price change percentage, and an "Adjust token amounts"
 * link when the price has moved. Shows recalculating spinner with min 1s feedback.
 *
 * Used by create position and increase deposit wizards.
 */

import { useMemo } from 'react';
import { Circle, Check, Loader2, AlertCircle } from 'lucide-react';
import type { PoolSearchTokenInfo } from '@midcurve/api-shared';
import { formatCompactValue, compareAddresses } from '@midcurve/shared';
import type { UniswapV3Pool } from '@midcurve/shared';

export interface PriceAdjustmentStepProps {
  /** Hook status: idle, calculating, ready, error */
  status: 'idle' | 'calculating' | 'ready' | 'error';
  /** Current sqrtPriceX96 from pool watcher */
  currentSqrtPriceX96: bigint | undefined;
  /** Discovered pool instance */
  discoveredPool: UniswapV3Pool | null;
  /** Base token info */
  baseToken: PoolSearchTokenInfo | null;
  /** Quote token info */
  quoteToken: PoolSearchTokenInfo | null;
  /** Whether the main transaction (mint/increase) succeeded */
  isTxSuccess: boolean;
  /** Price change percentage from baseline (from usePriceAdjustment) */
  priceChangePercent: number | null;
  /** Callback when user clicks "Adjust token amounts" */
  onAdjust: () => void;
  /** Whether recalculation is in progress (min 1s spinner) */
  isRecalculating: boolean;
  /** Whether amounts have been manually adjusted at least once */
  hasAdjusted: boolean;
  /** Error message from price adjustment hook */
  error?: string | null;
}

export function PriceAdjustmentStep({
  status,
  currentSqrtPriceX96,
  discoveredPool,
  baseToken,
  quoteToken,
  isTxSuccess,
  priceChangePercent,
  onAdjust,
  isRecalculating,
  hasAdjusted,
  error: errorProp,
}: PriceAdjustmentStepProps) {
  const hasPriceMoved = priceChangePercent !== null && Math.abs(priceChangePercent) >= 0.01;

  // Determine display status
  const displayStatus = isRecalculating
    ? 'calculating'
    : isTxSuccess
      ? 'success'
      : status === 'calculating'
        ? 'calculating'
        : status === 'error'
          ? 'error'
          : status === 'ready'
            ? 'success'
            : 'pending';

  const isActive = displayStatus === 'calculating';
  const isError = displayStatus === 'error';
  const isSuccess = displayStatus === 'success';
  const isPending = displayStatus === 'pending';

  // Dynamic label based on state
  const label = isRecalculating
    ? 'Recalculating...'
    : hasAdjusted && isSuccess && !hasPriceMoved
      ? 'Adjusted token amounts to pool price.'
      : hasPriceMoved && isSuccess
        ? `Pool price moved by ${priceChangePercent! >= 0 ? '+' : ''}${priceChangePercent!.toFixed(2)}%`
        : 'Confirm Pool Price';

  // Calculate current price text from sqrtPriceX96
  const currentPriceText = useMemo(() => {
    if (!currentSqrtPriceX96 || !discoveredPool || !baseToken || !quoteToken) {
      return null;
    }

    try {
      const sqrtPriceX96 = currentSqrtPriceX96;
      const isToken0Base = compareAddresses(
        discoveredPool.token0.config.address as string,
        baseToken.address
      ) === 0;

      const Q96 = 2n ** 96n;
      const Q192 = Q96 * Q96;
      const rawPriceNum = sqrtPriceX96 * sqrtPriceX96;

      const token0Decimals = discoveredPool.token0.decimals;
      const token1Decimals = discoveredPool.token1.decimals;
      const quoteDecimals = quoteToken.decimals;

      let priceBigint: bigint;
      if (isToken0Base) {
        const decimalDiff = token0Decimals - token1Decimals;
        if (decimalDiff >= 0) {
          const adjustment = 10n ** BigInt(decimalDiff);
          priceBigint = (rawPriceNum * adjustment * (10n ** BigInt(quoteDecimals))) / Q192;
        } else {
          const adjustment = 10n ** BigInt(-decimalDiff);
          priceBigint = (rawPriceNum * (10n ** BigInt(quoteDecimals))) / (Q192 * adjustment);
        }
      } else {
        const decimalDiff = token1Decimals - token0Decimals;
        if (decimalDiff >= 0) {
          const adjustment = 10n ** BigInt(decimalDiff);
          priceBigint = (Q192 * adjustment * (10n ** BigInt(quoteDecimals))) / rawPriceNum;
        } else {
          const adjustment = 10n ** BigInt(-decimalDiff);
          priceBigint = (Q192 * (10n ** BigInt(quoteDecimals))) / (rawPriceNum * adjustment);
        }
      }

      return formatCompactValue(priceBigint, quoteDecimals);
    } catch {
      return null;
    }
  }, [currentSqrtPriceX96, discoveredPool, baseToken, quoteToken]);

  const showAdjustLink = !isTxSuccess && !isActive && hasPriceMoved;

  return (
    <div
      className={`py-3 px-4 rounded-lg transition-colors ${
        isError
          ? 'bg-red-500/10 border border-red-500/30'
          : isSuccess
          ? 'bg-green-500/10 border border-green-500/20'
          : isActive
          ? 'bg-blue-500/10 border border-blue-500/20'
          : 'bg-slate-700/30 border border-slate-600/20'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isPending && <Circle className="w-5 h-5 text-slate-500" />}
          {isActive && <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />}
          {isSuccess && <Check className="w-5 h-5 text-green-400" />}
          {isError && <AlertCircle className="w-5 h-5 text-red-400" />}

          <span
            className={
              isSuccess
                ? 'text-slate-400'
                : isError
                ? 'text-red-300'
                : 'text-white'
            }
          >
            {label}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isSuccess && currentPriceText && (
            <span className="text-sm text-slate-300">
              {currentPriceText} {quoteToken?.symbol}
            </span>
          )}
          {showAdjustLink && (
            <button
              onClick={onAdjust}
              className="text-sm text-yellow-400 hover:text-yellow-300 underline decoration-dashed underline-offset-2 transition-colors cursor-pointer"
            >
              Adjust token amounts
            </button>
          )}
        </div>
      </div>

      {isError && errorProp && (
        <div className="mt-2 pl-8">
          <div className="max-h-20 overflow-y-auto text-sm text-red-400/80 bg-red-950/30 rounded p-2">
            {errorProp}
          </div>
        </div>
      )}
    </div>
  );
}
