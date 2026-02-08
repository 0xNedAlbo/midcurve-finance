import { useCallback, useMemo, useState } from 'react';
import { PlusCircle, MinusCircle, RefreshCw } from 'lucide-react';
import {
  formatCompactValue,
  compareAddresses,
  UniswapV3Pool,
  type PoolJSON,
} from '@midcurve/shared';
import { useIncreaseDepositWizard } from '../context/IncreaseDepositWizardContext';
import { useDiscoverPool } from '@/hooks/pools/useDiscoverPool';
import { AllocatedCapitalSection } from '@/components/positions/wizard/create-position/uniswapv3/shared/AllocatedCapitalSection';
import { RiskTriggersSection } from '@/components/positions/wizard/create-position/uniswapv3/shared/RiskTriggersSection';
import { SelectedPoolSummary } from '@/components/positions/wizard/create-position/uniswapv3/shared/SelectedPoolSummary';

// Zoom constants
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.125;

interface IncreaseWizardSummaryPanelProps {
  showSkip?: boolean;
  onSkip?: () => void;
  skipLabel?: string;
  nextLabel?: string;
  nextDisabled?: boolean;
  onNext?: () => void;
  showFinish?: boolean;
  onFinish?: () => void;
  /** PnL at range boundaries (optional, computed by ConfigureStep) */
  rangePnl?: {
    lowerPriceBigInt: bigint;
    upperPriceBigInt: bigint;
    lowerPnlValue: bigint;
    upperPnlValue: bigint;
    lowerPnlPercent: number;
    upperPnlPercent: number;
  } | null;
  /** PnL at SL/TP trigger points (optional) */
  slDrawdown?: { pnlValue: bigint } | null;
  tpRunup?: { pnlValue: bigint } | null;
  /** Stop loss trigger price (bigint in quote units) */
  stopLossPrice?: bigint | null;
  /** Take profit trigger price (bigint in quote units) */
  takeProfitPrice?: bigint | null;
  children?: React.ReactNode;
}

export function IncreaseWizardSummaryPanel({
  showSkip,
  onSkip,
  skipLabel = 'Skip',
  nextLabel = 'Next',
  nextDisabled = false,
  onNext,
  showFinish,
  onFinish,
  rangePnl,
  slDrawdown,
  tpRunup,
  stopLossPrice,
  takeProfitPrice,
  children,
}: IncreaseWizardSummaryPanelProps) {
  const { state, setSummaryZoom, setDiscoveredPool, goBack, goNext, canGoBack, canGoNext, currentStep, isStepValid } =
    useIncreaseDepositWizard();
  const [isRefreshingPool, setIsRefreshingPool] = useState(false);
  const discoverPool = useDiscoverPool();

  // Extract position data
  const position = state.position;
  const pool = position?.pool;

  // Get base/quote tokens from position
  const baseToken = useMemo(() => {
    if (!pool) return null;
    return position?.isToken0Quote ? pool.token1 : pool.token0;
  }, [pool, position?.isToken0Quote]);

  const quoteToken = useMemo(() => {
    if (!pool) return null;
    return position?.isToken0Quote ? pool.token0 : pool.token1;
  }, [pool, position?.isToken0Quote]);

  // Handler for refresh button
  const handleRefreshPool = useCallback(async () => {
    if (!pool) return;
    const poolConfig = pool.config as { address: string; chainId: number };
    setIsRefreshingPool(true);
    try {
      const result = await discoverPool.mutateAsync({
        chainId: poolConfig.chainId,
        address: poolConfig.address,
      });
      const poolInstance = UniswapV3Pool.fromJSON(
        result.pool as unknown as PoolJSON
      );
      setDiscoveredPool(poolInstance);
    } catch (error) {
      console.error('Failed to refresh pool:', error);
    } finally {
      setIsRefreshingPool(false);
    }
  }, [pool, discoverPool, setDiscoveredPool]);

  // Calculate current price from discovered pool
  const currentPriceBigint = useMemo(() => {
    if (!state.discoveredPool || !baseToken || !quoteToken) return null;

    try {
      const discoveredPool = state.discoveredPool;
      const sqrtPriceX96 = BigInt(
        discoveredPool.state.sqrtPriceX96 as string
      );

      const isToken0Base =
        compareAddresses(
          discoveredPool.token0.config.address as string,
          (baseToken.config as { address: string }).address
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
          priceBigint =
            (rawPriceNum * adjustment * 10n ** BigInt(quoteDecimals)) / Q192;
        } else {
          const adjustment = 10n ** BigInt(-decimalDiff);
          priceBigint =
            (rawPriceNum * 10n ** BigInt(quoteDecimals)) /
            (Q192 * adjustment);
        }
      } else {
        const decimalDiff = token1Decimals - token0Decimals;
        if (decimalDiff >= 0) {
          const adjustment = 10n ** BigInt(decimalDiff);
          priceBigint =
            (Q192 * adjustment * 10n ** BigInt(quoteDecimals)) / rawPriceNum;
        } else {
          const adjustment = 10n ** BigInt(-decimalDiff);
          priceBigint =
            (Q192 * 10n ** BigInt(quoteDecimals)) /
            (rawPriceNum * adjustment);
        }
      }

      return priceBigint;
    } catch {
      return null;
    }
  }, [state.discoveredPool, baseToken, quoteToken]);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setSummaryZoom(Math.min(state.summaryZoom + ZOOM_STEP, ZOOM_MAX));
  }, [state.summaryZoom, setSummaryZoom]);

  const handleZoomOut = useCallback(() => {
    setSummaryZoom(Math.max(state.summaryZoom - ZOOM_STEP, ZOOM_MIN));
  }, [state.summaryZoom, setSummaryZoom]);

  // Navigation
  const handleNext = () => {
    if (onNext) {
      onNext();
    } else {
      goNext();
    }
  };

  const isCurrentStepValid = isStepValid(currentStep.id);
  const isNextDisabled = nextDisabled || (!isCurrentStepValid && !showSkip);

  const quoteDecimals = quoteToken?.decimals ?? 18;
  const quoteSymbol = quoteToken?.symbol ?? '';

  return (
    <div className="h-full flex flex-col">
      {/* Header with zoom controls */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Summary</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            disabled={state.summaryZoom <= ZOOM_MIN}
            className={`p-1 rounded transition-colors cursor-pointer ${
              state.summaryZoom <= ZOOM_MIN
                ? 'text-slate-600 cursor-not-allowed'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
            title="Zoom out"
          >
            <MinusCircle className="w-4 h-4" />
          </button>
          <button
            onClick={handleZoomIn}
            disabled={state.summaryZoom >= ZOOM_MAX}
            className={`p-1 rounded transition-colors cursor-pointer ${
              state.summaryZoom >= ZOOM_MAX
                ? 'text-slate-600 cursor-not-allowed'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
            title="Zoom in"
          >
            <PlusCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-auto">
        {/* Pool info */}
        <SelectedPoolSummary
          selectedPool={null}
          discoveredPool={state.discoveredPool}
          isDiscovering={false}
          discoverError={null}
          baseToken={
            baseToken
              ? {
                  address: (baseToken.config as { address: string }).address,
                  symbol: baseToken.symbol,
                  decimals: baseToken.decimals,
                }
              : null
          }
          quoteToken={
            quoteToken
              ? {
                  address: (quoteToken.config as { address: string }).address,
                  symbol: quoteToken.symbol,
                  decimals: quoteToken.decimals,
                }
              : null
          }
        />

        {/* Current Price */}
        {quoteToken && currentPriceBigint !== null && (
          <div className="flex items-center justify-between px-3 py-2 bg-slate-700/30 rounded-lg">
            <span className="text-xs text-slate-400">
              Current Price:{' '}
              <span className="text-white font-medium">
                {formatCompactValue(currentPriceBigint, quoteDecimals)}
              </span>
            </span>
            <button
              onClick={handleRefreshPool}
              disabled={isRefreshingPool}
              className={`p-1 rounded transition-colors cursor-pointer ${
                isRefreshingPool
                  ? 'text-slate-600 cursor-not-allowed'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
              title="Refresh price"
            >
              <RefreshCw
                className={`w-3 h-3 ${isRefreshingPool ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
        )}

        {/* Allocated Capital (additional deposit) */}
        <AllocatedCapitalSection
          allocatedBaseAmount={state.allocatedBaseAmount}
          allocatedQuoteAmount={state.allocatedQuoteAmount}
          totalQuoteValue={state.totalQuoteValue}
          baseToken={
            baseToken
              ? {
                  address: (baseToken.config as { address: string }).address,
                  symbol: baseToken.symbol,
                  decimals: baseToken.decimals,
                }
              : null
          }
          quoteToken={
            quoteToken
              ? {
                  address: (quoteToken.config as { address: string }).address,
                  symbol: quoteToken.symbol,
                  decimals: quoteToken.decimals,
                }
              : null
          }
          baseLogoUrl={baseToken?.logoUrl}
          quoteLogoUrl={quoteToken?.logoUrl}
        />

        {/* PnL at Range Bounds */}
        {rangePnl && BigInt(state.additionalLiquidity || '0') > 0n && (
          <div className="p-3 bg-slate-700/30 rounded-lg space-y-2.5">
            <p className="text-xs text-slate-400">PnL at Range Boundaries</p>
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">At Lower</span>
                <span
                  className={`font-medium ${rangePnl.lowerPnlValue >= 0n ? 'text-green-400' : 'text-red-400'}`}
                >
                  {rangePnl.lowerPnlValue >= 0n ? '+' : ''}
                  {formatCompactValue(rangePnl.lowerPnlValue, quoteDecimals)}{' '}
                  {quoteSymbol}
                  <span className="text-slate-500 font-normal ml-1">
                    ({rangePnl.lowerPnlPercent >= 0 ? '+' : ''}
                    {rangePnl.lowerPnlPercent.toFixed(1)}%)
                  </span>
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">At Upper</span>
                <span
                  className={`font-medium ${rangePnl.upperPnlValue >= 0n ? 'text-green-400' : 'text-red-400'}`}
                >
                  {rangePnl.upperPnlValue >= 0n ? '+' : ''}
                  {formatCompactValue(rangePnl.upperPnlValue, quoteDecimals)}{' '}
                  {quoteSymbol}
                  <span className="text-slate-500 font-normal ml-1">
                    ({rangePnl.upperPnlPercent >= 0 ? '+' : ''}
                    {rangePnl.upperPnlPercent.toFixed(1)}%)
                  </span>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Risk Triggers (SL/TP from existing close orders) */}
        <RiskTriggersSection
          stopLossPrice={stopLossPrice ?? null}
          takeProfitPrice={takeProfitPrice ?? null}
          slDrawdown={slDrawdown}
          tpRunup={tpRunup}
          quoteTokenDecimals={quoteDecimals}
        />

        {/* Custom content from step */}
        {children}
      </div>

      {/* Navigation Buttons */}
      <div className="flex gap-3 mt-6 pt-4 border-t border-slate-700/50">
        <button
          onClick={goBack}
          disabled={!canGoBack}
          className="flex-1 px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Back
        </button>

        {showSkip && (
          <button
            onClick={onSkip || goNext}
            className="flex-1 px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
          >
            {skipLabel}
          </button>
        )}

        {showFinish ? (
          <button
            onClick={onFinish}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors cursor-pointer"
          >
            Finish
          </button>
        ) : (
          <button
            onClick={handleNext}
            disabled={isNextDisabled || !canGoNext}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {nextLabel}
          </button>
        )}
      </div>
    </div>
  );
}
