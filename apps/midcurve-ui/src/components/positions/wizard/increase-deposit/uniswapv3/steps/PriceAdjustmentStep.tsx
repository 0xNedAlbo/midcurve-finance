import { useMemo } from 'react';
import { Circle, Check, Loader2, AlertCircle } from 'lucide-react';
import type { PoolSearchTokenInfo } from '@midcurve/api-shared';
import { formatCompactValue, compareAddresses } from '@midcurve/shared';
import type { UniswapV3Pool } from '@midcurve/shared';

interface PriceAdjustmentStepProps {
  status: 'idle' | 'calculating' | 'ready' | 'error';
  currentSqrtPriceX96: bigint | undefined;
  discoveredPool: UniswapV3Pool | null;
  baseToken: PoolSearchTokenInfo | null;
  quoteToken: PoolSearchTokenInfo | null;
  isIncreaseSuccess: boolean;
}

export function PriceAdjustmentStep({
  status,
  currentSqrtPriceX96,
  discoveredPool,
  baseToken,
  quoteToken,
  isIncreaseSuccess,
}: PriceAdjustmentStepProps) {
  // Determine display status
  // After increase tx succeeds, always show success (subscription is cancelled)
  const displayStatus = isIncreaseSuccess
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
          {/* Status Icon */}
          {isPending && <Circle className="w-5 h-5 text-slate-500" />}
          {isActive && <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />}
          {isSuccess && <Check className="w-5 h-5 text-green-400" />}
          {isError && <AlertCircle className="w-5 h-5 text-red-400" />}

          {/* Label */}
          <span
            className={
              isSuccess
                ? 'text-slate-400'
                : isError
                ? 'text-red-300'
                : 'text-white'
            }
          >
            Confirm Pool Price
          </span>
        </div>

        {/* Current price display */}
        <div className="flex items-center gap-2">
          {isSuccess && currentPriceText && (
            <span className="text-sm text-slate-300">
              {currentPriceText} {quoteToken?.symbol}
            </span>
          )}
          {isActive && (
            <span className="text-sm text-blue-400">Calculating...</span>
          )}
        </div>
      </div>
    </div>
  );
}
