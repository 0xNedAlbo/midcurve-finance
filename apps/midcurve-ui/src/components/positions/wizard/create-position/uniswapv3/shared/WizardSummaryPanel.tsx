import { useCallback, useMemo, useState } from 'react';
import { PlusCircle, MinusCircle, ArrowLeftRight, RefreshCw } from 'lucide-react';
import { compareAddresses, formatCompactValue, UniswapV3Pool, type PoolJSON } from '@midcurve/shared';
import { useCreatePositionWizard } from '../context/CreatePositionWizardContext';
import { useDiscoverPool } from '@/hooks/pools/useDiscoverPool';
import { StepNavigationButtons } from './StepNavigationButtons';
import { SelectedPoolSummary } from './SelectedPoolSummary';

// Zoom constants
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 1.25;
const ZOOM_STEP = 0.125;

interface WizardSummaryPanelProps {
  showSkip?: boolean;
  onSkip?: () => void;
  skipLabel?: string;
  nextLabel?: string;
  nextDisabled?: boolean;
  onNext?: () => void;
  showFinish?: boolean;
  onFinish?: () => void;
  showCurrentPrice?: boolean;
  children?: React.ReactNode;
}

export function WizardSummaryPanel({
  showSkip,
  onSkip,
  skipLabel,
  nextLabel,
  nextDisabled,
  onNext,
  showFinish,
  onFinish,
  showCurrentPrice = true,
  children,
}: WizardSummaryPanelProps) {
  const { state, setSummaryZoom, swapQuoteBase, setDiscoveredPool } = useCreatePositionWizard();
  const [isRefreshingPool, setIsRefreshingPool] = useState(false);

  // Hook to fetch fresh pool data
  const discoverPool = useDiscoverPool();

  // Handler for refresh button - fetches entire pool with fresh state
  const handleRefreshPool = useCallback(async () => {
    if (!state.discoveredPool) return;

    const chainId = state.discoveredPool.typedConfig.chainId;
    const address = state.discoveredPool.typedConfig.address;

    setIsRefreshingPool(true);
    try {
      const result = await discoverPool.mutateAsync({ chainId, address });
      // Deserialize JSON to class instance for proper method access
      const poolInstance = UniswapV3Pool.fromJSON(result.pool as unknown as PoolJSON);
      setDiscoveredPool(poolInstance);
    } catch (error) {
      // Silently fail - pool stays at current state
      console.error('Failed to refresh pool:', error);
    } finally {
      setIsRefreshingPool(false);
    }
  }, [state.discoveredPool, discoverPool, setDiscoveredPool]);

  // Calculate current price from sqrtPriceX96
  const currentPriceBigint = useMemo(() => {
    if (!state.discoveredPool || !state.baseToken || !state.quoteToken) {
      return null;
    }

    try {
      const pool = state.discoveredPool;
      const sqrtPriceX96 = BigInt(pool.state.sqrtPriceX96 as string);

      const isToken0Base = compareAddresses(
        pool.token0.config.address as string,
        state.baseToken.address
      ) === 0;

      // price = (sqrtPriceX96 / 2^96)^2
      const Q96 = 2n ** 96n;
      const Q192 = Q96 * Q96;

      const rawPriceNum = sqrtPriceX96 * sqrtPriceX96;

      const token0Decimals = pool.token0.decimals;
      const token1Decimals = pool.token1.decimals;
      const quoteDecimals = state.quoteToken.decimals;

      // Calculate price as bigint with quote token decimals precision
      let priceBigint: bigint;
      if (isToken0Base) {
        // Price is token1/token0 (quote per base)
        const decimalDiff = token0Decimals - token1Decimals;
        if (decimalDiff >= 0) {
          const adjustment = 10n ** BigInt(decimalDiff);
          priceBigint = (rawPriceNum * adjustment * (10n ** BigInt(quoteDecimals))) / Q192;
        } else {
          const adjustment = 10n ** BigInt(-decimalDiff);
          priceBigint = (rawPriceNum * (10n ** BigInt(quoteDecimals))) / (Q192 * adjustment);
        }
      } else {
        // Price is token0/token1 (quote per base) = 1 / (token1/token0)
        const decimalDiff = token1Decimals - token0Decimals;
        if (decimalDiff >= 0) {
          const adjustment = 10n ** BigInt(decimalDiff);
          priceBigint = (Q192 * adjustment * (10n ** BigInt(quoteDecimals))) / rawPriceNum;
        } else {
          const adjustment = 10n ** BigInt(-decimalDiff);
          priceBigint = (Q192 * (10n ** BigInt(quoteDecimals))) / (rawPriceNum * adjustment);
        }
      }

      return priceBigint;
    } catch {
      return null;
    }
  }, [state.discoveredPool, state.baseToken, state.quoteToken]);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setSummaryZoom(Math.min(state.summaryZoom + ZOOM_STEP, ZOOM_MAX));
  }, [state.summaryZoom, setSummaryZoom]);

  const handleZoomOut = useCallback(() => {
    setSummaryZoom(Math.max(state.summaryZoom - ZOOM_STEP, ZOOM_MIN));
  }, [state.summaryZoom, setSummaryZoom]);

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
        {/* Selected Pool Summary */}
        <SelectedPoolSummary
          selectedPool={state.selectedPool}
          discoveredPool={state.discoveredPool}
          isDiscovering={state.isDiscovering}
          discoverError={state.discoverError}
          baseToken={state.baseToken}
          quoteToken={state.quoteToken}
        />

        {/* Current Price Line */}
        {showCurrentPrice && state.quoteToken && currentPriceBigint !== null && (
          <div className="flex items-center justify-between px-3 py-2 bg-slate-700/30 rounded-lg">
            <span className="text-xs text-slate-400">
              Current Price:{' '}
              <span className="text-white font-medium">
                {formatCompactValue(currentPriceBigint, state.quoteToken.decimals)}
              </span>
            </span>
            <div className="flex items-center gap-1">
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
                <RefreshCw className={`w-3 h-3 ${isRefreshingPool ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={swapQuoteBase}
                className="flex items-center gap-1 px-2 py-1 bg-slate-600/50 rounded text-xs text-slate-300 hover:bg-slate-600 hover:text-white transition-colors cursor-pointer"
                title="Flip quote/base token"
              >
                <ArrowLeftRight className="w-3 h-3" />
                Flip
              </button>
            </div>
          </div>
        )}

        {/* Custom content from step */}
        {children}
      </div>

      {/* Navigation Buttons */}
      <StepNavigationButtons
        showSkip={showSkip}
        onSkip={onSkip}
        skipLabel={skipLabel}
        nextLabel={nextLabel}
        nextDisabled={nextDisabled}
        onNext={onNext}
        showFinish={showFinish}
        onFinish={onFinish}
      />
    </div>
  );
}
