import { useEffect, useCallback, useMemo, useState } from 'react';
import { Wallet, Banknote, TrendingUp, Shield, PlusCircle, MinusCircle, TrendingDown } from 'lucide-react';
import { formatUnits } from 'viem';
import { useAccount } from 'wagmi';
import { formatCompactValue, calculatePositionValue, tickToPrice, compareAddresses, generatePnLCurve, getTickSpacing } from '@midcurve/shared';
import { InteractivePnLCurve } from '@/components/positions/pnl-curve/uniswapv3';
import {
  useCreatePositionWizard,
  type ConfigurationTab,
} from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';
import { AllocatedCapitalSection } from '../shared/AllocatedCapitalSection';
import { useDefaultTickRange } from '../hooks/useDefaultTickRange';
import { useCapitalCalculations } from '../hooks/useCapitalCalculations';
import { useErc20TokenBalance } from '@/hooks/tokens/erc20/useErc20TokenBalance';

// Configuration section tabs
const CONFIG_TABS: { id: ConfigurationTab; label: string; description: string; icon: typeof Banknote }[] = [
  { id: 'capital', label: 'Capital Allocation', description: 'Enter the token amounts for your position', icon: Banknote },
  { id: 'range', label: 'Position Range', description: 'Configure the price range for your position', icon: TrendingUp },
  { id: 'sltp', label: 'SL/TP Setup', description: 'Set stop loss and take profit triggers', icon: Shield },
];

export function PositionConfigStep() {
  const {
    state,
    setConfigurationTab,
    setBaseInput,
    setQuoteInput,
    setAllocatedAmounts,
    setDefaultTickRange,
    setTickRange,
    setLiquidity,
    setStepValid,
    setInteractiveZoom,
  } = useCreatePositionWizard();

  const { address: walletAddress, isConnected } = useAccount();

  // Zoom constants
  const ZOOM_MIN = 0.75;
  const ZOOM_MAX = 1.25;
  const ZOOM_STEP = 0.125;

  // Zoom handlers using context state
  const handleZoomIn = useCallback(() => {
    setInteractiveZoom(Math.min(state.interactiveZoom + ZOOM_STEP, ZOOM_MAX));
  }, [state.interactiveZoom, setInteractiveZoom]);

  const handleZoomOut = useCallback(() => {
    setInteractiveZoom(Math.max(state.interactiveZoom - ZOOM_STEP, ZOOM_MIN));
  }, [state.interactiveZoom, setInteractiveZoom]);

  // Get token balances for MAX buttons
  // Balance fetching uses backend RPC, so it works regardless of connected network
  const { balanceBigInt: baseBalance, isLoading: isBaseBalanceLoading } = useErc20TokenBalance({
    walletAddress: walletAddress ?? null,
    tokenAddress: state.baseToken?.address ?? null,
    chainId: state.selectedPool?.chainId ?? 1,
    enabled: isConnected && !!state.baseToken?.address,
  });

  const { balanceBigInt: quoteBalance, isLoading: isQuoteBalanceLoading } = useErc20TokenBalance({
    walletAddress: walletAddress ?? null,
    tokenAddress: state.quoteToken?.address ?? null,
    chainId: state.selectedPool?.chainId ?? 1,
    enabled: isConnected && !!state.quoteToken?.address,
  });

  // Calculate default tick range (-20% / +10%) when pool is discovered
  const handleDefaultRangeCalculated = useCallback(
    (tickLower: number, tickUpper: number) => {
      setDefaultTickRange(tickLower, tickUpper);
    },
    [setDefaultTickRange]
  );

  useDefaultTickRange(state.discoveredPool, handleDefaultRangeCalculated);

  // Determine which tick range to use for calculations
  // Use custom range if set (tickLower !== tickUpper), otherwise use default
  const effectiveTickLower =
    state.tickLower !== 0 || state.tickUpper !== 0
      ? state.tickLower
      : state.defaultTickLower;
  const effectiveTickUpper =
    state.tickLower !== 0 || state.tickUpper !== 0
      ? state.tickUpper
      : state.defaultTickUpper;

  // Calculate allocations (always uses custom/independent mode now)
  const calculations = useCapitalCalculations({
    baseInputAmount: state.baseInputAmount,
    quoteInputAmount: state.quoteInputAmount,
    discoveredPool: state.discoveredPool,
    baseToken: state.baseToken,
    quoteToken: state.quoteToken,
    tickLower: effectiveTickLower,
    tickUpper: effectiveTickUpper,
  });

  // Update state when calculations change
  useEffect(() => {
    setAllocatedAmounts(
      calculations.allocatedBaseAmount,
      calculations.allocatedQuoteAmount,
      calculations.totalQuoteValue
    );
    setLiquidity(calculations.liquidity);
  }, [
    calculations.allocatedBaseAmount,
    calculations.allocatedQuoteAmount,
    calculations.totalQuoteValue,
    calculations.liquidity,
    setAllocatedAmounts,
    setLiquidity,
  ]);

  // Update step validation
  useEffect(() => {
    setStepValid('configure', calculations.isValid);
  }, [calculations.isValid, setStepValid]);

  // ============================================================================
  // PnL Curve Data Calculations
  // ============================================================================

  // Slider bounds for PnL curve visualization
  const [sliderBounds, setSliderBounds] = useState<{ min: number; max: number }>({ min: 0, max: 0 });

  // Determine if base token is token0
  const isToken0Base = useMemo(() => {
    if (!state.discoveredPool || !state.baseToken) return false;
    return compareAddresses(
      state.discoveredPool.token0.config.address as string,
      state.baseToken.address
    ) === 0;
  }, [state.discoveredPool, state.baseToken]);

  // Calculate current price for slider bounds initialization
  const currentPrice = useMemo(() => {
    if (!state.discoveredPool || !state.baseToken || !state.quoteToken) {
      return 0;
    }

    try {
      const pool = state.discoveredPool;
      // Access currentTick from raw state (consistent with useDefaultTickRange)
      const currentTick = pool.state.currentTick as number;
      const baseTokenDecimals = isToken0Base
        ? pool.token0.decimals
        : pool.token1.decimals;

      const priceBigInt = tickToPrice(
        currentTick,
        state.baseToken.address,
        state.quoteToken.address,
        baseTokenDecimals
      );

      const divisor = 10n ** BigInt(state.quoteToken.decimals);
      return Number(priceBigInt) / Number(divisor);
    } catch (error) {
      console.error("Error calculating current price:", error);
      return 0;
    }
  }, [state.discoveredPool, state.baseToken, state.quoteToken, isToken0Base]);

  // Initialize slider bounds when current price is available
  useEffect(() => {
    if (currentPrice > 0 && sliderBounds.min === 0 && sliderBounds.max === 0) {
      // Symmetric default x-axis range: ±35% of current price
      setSliderBounds({
        min: currentPrice * 0.65,  // -35%
        max: currentPrice * 1.35,  // +35%
      });
    }
  }, [currentPrice, sliderBounds.min, sliderBounds.max]);

  // Calculate cost basis (position value at current price)
  const costBasis = useMemo(() => {
    const liquidityBigInt = BigInt(state.liquidity || '0');
    if (liquidityBigInt === 0n || !state.discoveredPool) {
      return 0n;
    }

    try {
      // Access sqrtPriceX96 from raw state and convert to bigint (consistent with useCapitalCalculations)
      const sqrtPriceX96 = BigInt(state.discoveredPool.state.sqrtPriceX96 as string);
      return calculatePositionValue(
        liquidityBigInt,
        sqrtPriceX96,
        effectiveTickLower,
        effectiveTickUpper,
        isToken0Base
      );
    } catch (error) {
      console.error("Error calculating cost basis:", error);
      return 0n;
    }
  }, [state.liquidity, state.discoveredPool, effectiveTickLower, effectiveTickUpper, isToken0Base]);

  // Handle base input change
  const handleBaseInputChange = useCallback(
    (value: string) => {
      setBaseInput(value, false);
    },
    [setBaseInput]
  );

  // Handle quote input change
  const handleQuoteInputChange = useCallback(
    (value: string) => {
      setQuoteInput(value, false);
    },
    [setQuoteInput]
  );

  // Handle MAX button for base token
  const handleBaseMax = useCallback(() => {
    if (!baseBalance || !state.baseToken) return;
    const formatted = formatUnits(baseBalance, state.baseToken.decimals);
    setBaseInput(formatted, true);
  }, [baseBalance, state.baseToken, setBaseInput]);

  // Handle MAX button for quote token
  const handleQuoteMax = useCallback(() => {
    if (!quoteBalance || !state.quoteToken) return;
    const formatted = formatUnits(quoteBalance, state.quoteToken.decimals);
    setQuoteInput(formatted, true);
  }, [quoteBalance, state.quoteToken, setQuoteInput]);

  // Handle tick range boundary changes from PnL curve drag
  const handleTickLowerChange = useCallback(
    (newTickLower: number) => {
      setTickRange(newTickLower, effectiveTickUpper);
    },
    [setTickRange, effectiveTickUpper]
  );

  const handleTickUpperChange = useCallback(
    (newTickUpper: number) => {
      setTickRange(effectiveTickLower, newTickUpper);
    },
    [setTickRange, effectiveTickLower]
  );

  // Handle range boundary interaction - switch to Range tab
  const handleRangeBoundaryInteraction = useCallback(() => {
    setConfigurationTab('range');
  }, [setConfigurationTab]);

  // Render Capital Allocation tab content
  const renderCapitalTab = () => (
    <div className="grid grid-cols-2 gap-4">
      <TokenAmountInput
        label={`${state.baseToken?.symbol || 'Base'} Amount`}
        value={state.baseInputAmount}
        onChange={handleBaseInputChange}
        onMax={handleBaseMax}
        balance={baseBalance}
        decimals={state.baseToken?.decimals ?? 18}
        symbol={state.baseToken?.symbol ?? ''}
        isBalanceLoading={isBaseBalanceLoading}
        isConnected={isConnected}
        placeholder="0.0"
      />
      <TokenAmountInput
        label={`${state.quoteToken?.symbol || 'Quote'} Amount`}
        value={state.quoteInputAmount}
        onChange={handleQuoteInputChange}
        onMax={handleQuoteMax}
        balance={quoteBalance}
        decimals={state.quoteToken?.decimals ?? 18}
        symbol={state.quoteToken?.symbol ?? ''}
        isBalanceLoading={isQuoteBalanceLoading}
        isConnected={isConnected}
        placeholder="0.0"
      />
    </div>
  );

  // Calculate boundary prices and PnL for Range tab
  const rangeBoundaryInfo = useMemo(() => {
    if (!state.discoveredPool || !state.baseToken || !state.quoteToken) {
      return null;
    }

    try {
      const baseTokenDecimals = isToken0Base
        ? state.discoveredPool.token0.decimals
        : state.discoveredPool.token1.decimals;

      // Calculate lower and upper prices from ticks
      const lowerPriceBigInt = tickToPrice(
        effectiveTickLower,
        state.baseToken.address,
        state.quoteToken.address,
        baseTokenDecimals
      );
      const upperPriceBigInt = tickToPrice(
        effectiveTickUpper,
        state.baseToken.address,
        state.quoteToken.address,
        baseTokenDecimals
      );

      const quoteDecimals = state.quoteToken.decimals;
      const divisor = 10n ** BigInt(quoteDecimals);

      // Adjust for token order (same logic as in InteractivePnLCurve)
      // Keep bigint for formatCompactValue
      const lowerPriceBigIntAdjusted = isToken0Base ? lowerPriceBigInt : upperPriceBigInt;
      const upperPriceBigIntAdjusted = isToken0Base ? upperPriceBigInt : lowerPriceBigInt;
      const lowerPrice = Number(lowerPriceBigIntAdjusted) / Number(divisor);
      const upperPrice = Number(upperPriceBigIntAdjusted) / Number(divisor);

      // Calculate PnL at boundary prices using generatePnLCurve
      const liquidityBigInt = BigInt(state.liquidity || '0');
      if (liquidityBigInt === 0n) {
        return {
          lowerPriceBigInt: lowerPriceBigIntAdjusted,
          upperPriceBigInt: upperPriceBigIntAdjusted,
          lowerPrice,
          upperPrice,
          lowerPnlValue: 0n,
          upperPnlValue: 0n,
          lowerPnlPercent: 0,
          upperPnlPercent: 0,
        };
      }

      const tickSpacing = getTickSpacing(state.discoveredPool.feeBps);

      // Generate curve with just a few points around the boundaries
      const lowerPriceMinBigInt = BigInt(Math.floor(lowerPrice * 0.99 * Number(divisor)));
      const lowerPriceMaxBigInt = BigInt(Math.floor(lowerPrice * 1.01 * Number(divisor)));
      const upperPriceMinBigInt = BigInt(Math.floor(upperPrice * 0.99 * Number(divisor)));
      const upperPriceMaxBigInt = BigInt(Math.floor(upperPrice * 1.01 * Number(divisor)));

      // Get PnL at lower boundary
      const lowerCurve = generatePnLCurve(
        liquidityBigInt,
        effectiveTickLower,
        effectiveTickUpper,
        costBasis,
        state.baseToken.address,
        state.quoteToken.address,
        state.baseToken.decimals,
        tickSpacing,
        { min: lowerPriceMinBigInt > 0n ? lowerPriceMinBigInt : 1n, max: lowerPriceMaxBigInt }
      );

      // Get PnL at upper boundary
      const upperCurve = generatePnLCurve(
        liquidityBigInt,
        effectiveTickLower,
        effectiveTickUpper,
        costBasis,
        state.baseToken.address,
        state.quoteToken.address,
        state.baseToken.decimals,
        tickSpacing,
        { min: upperPriceMinBigInt > 0n ? upperPriceMinBigInt : 1n, max: upperPriceMaxBigInt }
      );

      // Find the closest point to our target prices
      const lowerPoint = lowerCurve.length > 0 ? lowerCurve[Math.floor(lowerCurve.length / 2)] : null;
      const upperPoint = upperCurve.length > 0 ? upperCurve[Math.floor(upperCurve.length / 2)] : null;

      return {
        lowerPriceBigInt: lowerPriceBigIntAdjusted,
        upperPriceBigInt: upperPriceBigIntAdjusted,
        lowerPrice,
        upperPrice,
        lowerPnlValue: lowerPoint?.pnl ?? 0n,
        upperPnlValue: upperPoint?.pnl ?? 0n,
        lowerPnlPercent: lowerPoint?.pnlPercent ?? 0,
        upperPnlPercent: upperPoint?.pnlPercent ?? 0,
      };
    } catch (error) {
      console.error("Error calculating range boundary info:", error);
      return null;
    }
  }, [
    state.discoveredPool,
    state.baseToken,
    state.quoteToken,
    state.liquidity,
    effectiveTickLower,
    effectiveTickUpper,
    costBasis,
    isToken0Base,
  ]);

  // Render Position Range tab content
  const renderRangeTab = () => {
    if (!rangeBoundaryInfo) {
      return (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <TrendingUp className="w-8 h-8 text-slate-600 mb-3" />
          <h4 className="text-sm font-medium text-slate-300 mb-1">Position Range</h4>
          <p className="text-xs text-slate-500 max-w-md">
            Select a pool to configure the price range.
          </p>
        </div>
      );
    }

    const { lowerPriceBigInt, upperPriceBigInt, lowerPnlValue, upperPnlValue, lowerPnlPercent, upperPnlPercent } = rangeBoundaryInfo;
    const quoteSymbol = state.quoteToken?.symbol || 'Quote';
    const quoteDecimals = state.quoteToken?.decimals ?? 18;

    return (
      <div className="grid grid-cols-2 gap-4">
        {/* Lower Price Column */}
        <div className="bg-slate-700/30 rounded-lg p-3 border border-slate-600/50">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Lower Price</div>
          <div className="text-sm font-medium text-teal-400">
            {formatCompactValue(lowerPriceBigInt, quoteDecimals)} {quoteSymbol}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-600/50">
            <div className="text-[10px] text-slate-400 mb-0.5">PnL at boundary</div>
            <div className={`text-sm font-medium ${lowerPnlValue >= 0n ? 'text-green-400' : 'text-red-400'}`}>
              {lowerPnlValue >= 0n ? '+' : ''}{formatCompactValue(lowerPnlValue, quoteDecimals)} {quoteSymbol}
              <span className="text-xs text-slate-500 ml-1">
                ({lowerPnlPercent >= 0 ? '+' : ''}{lowerPnlPercent.toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>

        {/* Upper Price Column */}
        <div className="bg-slate-700/30 rounded-lg p-3 border border-slate-600/50">
          <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Upper Price</div>
          <div className="text-sm font-medium text-teal-400">
            {formatCompactValue(upperPriceBigInt, quoteDecimals)} {quoteSymbol}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-600/50">
            <div className="text-[10px] text-slate-400 mb-0.5">PnL at boundary</div>
            <div className={`text-sm font-medium ${upperPnlValue >= 0n ? 'text-green-400' : 'text-red-400'}`}>
              {upperPnlValue >= 0n ? '+' : ''}{formatCompactValue(upperPnlValue, quoteDecimals)} {quoteSymbol}
              <span className="text-xs text-slate-500 ml-1">
                ({upperPnlPercent >= 0 ? '+' : ''}{upperPnlPercent.toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render SL/TP Setup tab content (placeholder)
  const renderSltpTab = () => (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Shield className="w-12 h-12 text-slate-600 mb-4" />
      <h4 className="text-lg font-medium text-slate-300 mb-2">Stop Loss / Take Profit</h4>
      <p className="text-sm text-slate-500 max-w-md">
        Set automatic triggers to close your position when price reaches your targets.
        This section will be implemented in Phase 2.
      </p>
    </div>
  );

  // Render tab content based on current configuration tab
  const renderTabContent = () => {
    switch (state.configurationTab) {
      case 'capital':
        return renderCapitalTab();
      case 'range':
        return renderRangeTab();
      case 'sltp':
        return renderSltpTab();
      default:
        return renderCapitalTab();
    }
  };

  const renderInteractive = () => (
    <div className="space-y-4">
      {/* Header with tabs and zoom controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          {CONFIG_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setConfigurationTab(tab.id)}
                className={`flex items-center gap-1.5 pb-2 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
                  state.configurationTab === tab.id
                    ? 'text-blue-400 border-blue-400'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
                title={tab.description}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            disabled={state.interactiveZoom <= ZOOM_MIN}
            className={`p-1 rounded transition-colors cursor-pointer ${
              state.interactiveZoom <= ZOOM_MIN
                ? 'text-slate-600 cursor-not-allowed'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
            title="Zoom out"
          >
            <MinusCircle className="w-4 h-4" />
          </button>
          <button
            onClick={handleZoomIn}
            disabled={state.interactiveZoom >= ZOOM_MAX}
            className={`p-1 rounded transition-colors cursor-pointer ${
              state.interactiveZoom >= ZOOM_MAX
                ? 'text-slate-600 cursor-not-allowed'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
            title="Zoom in"
          >
            <PlusCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="pt-2">
        {renderTabContent()}
      </div>
    </div>
  );

  const renderVisual = () => {
    // Check if we have enough data to render the curve (pool and tokens are required, liquidity is optional)
    const liquidityBigInt = BigInt(state.liquidity || '0');
    const hasPoolData = state.discoveredPool &&
      state.baseToken &&
      state.quoteToken &&
      sliderBounds.min > 0;

    if (hasPoolData) {
      const pool = state.discoveredPool!;
      return (
        <div className="h-full flex flex-col min-h-0">
          <InteractivePnLCurve
            poolData={{
              token0Address: pool.token0.config.address as string,
              token0Decimals: pool.token0.decimals,
              token1Address: pool.token1.config.address as string,
              token1Decimals: pool.token1.decimals,
              feeBps: pool.feeBps,
              currentTick: pool.state.currentTick as number,
              sqrtPriceX96: pool.state.sqrtPriceX96 as string,
            }}
            baseToken={{
              address: state.baseToken!.address,
              symbol: state.baseToken!.symbol,
              decimals: state.baseToken!.decimals,
            }}
            quoteToken={{
              address: state.quoteToken!.address,
              symbol: state.quoteToken!.symbol,
              decimals: state.quoteToken!.decimals,
            }}
            tickLower={effectiveTickLower}
            tickUpper={effectiveTickUpper}
            liquidity={liquidityBigInt}
            costBasis={costBasis}
            sliderBounds={sliderBounds}
            onSliderBoundsChange={setSliderBounds}
            onTickLowerChange={handleTickLowerChange}
            onTickUpperChange={handleTickUpperChange}
            onRangeBoundaryInteraction={handleRangeBoundaryInteraction}
            className="flex-1 min-h-0"
          />
          <p className="text-xs text-slate-400 mt-2 text-center shrink-0">
            <span className="font-semibold">Risk Profile.</span> Shows how your position value changes with price movements.
          </p>
        </div>
      );
    }

    // Placeholder when no data
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-500">
        <div className="w-full max-w-md space-y-6">
          {/* Mock chart axes */}
          <div className="relative h-48 border-l-2 border-b-2 border-slate-700">
            <div className="absolute -left-8 top-1/2 -translate-y-1/2 -rotate-90 text-xs text-slate-600 whitespace-nowrap">
              Position Value
            </div>
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path
                d="M 0 80 Q 20 75 35 50 T 50 30 T 65 30 T 100 30"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="4 4"
                className="text-slate-600"
              />
              <line
                x1="50"
                y1="0"
                x2="50"
                y2="100"
                stroke="currentColor"
                strokeWidth="1"
                strokeDasharray="2 2"
                className="text-blue-500/50"
              />
            </svg>
            <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-slate-600">
              Base Token Price
            </div>
          </div>
          <div className="text-center space-y-2">
            <TrendingDown className="w-8 h-8 mx-auto text-slate-600" />
            <p className="text-sm font-medium text-slate-400">PnL Curve Visualization</p>
            <p className="text-xs text-slate-500">
              Enter token amounts to see the risk profile
            </p>
          </div>
        </div>
      </div>
    );
  };

  // Get logo URLs from the discovered pool
  const getLogoUrls = () => {
    if (!state.discoveredPool || !state.baseToken || !state.quoteToken) {
      return { baseLogoUrl: null, quoteLogoUrl: null };
    }
    const pool = state.discoveredPool;
    const token0Address = (pool.token0.config.address as string).toLowerCase();
    const baseAddress = state.baseToken.address.toLowerCase();

    // Map base/quote to token0/token1
    if (token0Address === baseAddress) {
      return {
        baseLogoUrl: pool.token0.logoUrl,
        quoteLogoUrl: pool.token1.logoUrl,
      };
    } else {
      return {
        baseLogoUrl: pool.token1.logoUrl,
        quoteLogoUrl: pool.token0.logoUrl,
      };
    }
  };

  const { baseLogoUrl, quoteLogoUrl } = getLogoUrls();

  const renderSummary = () => (
    <WizardSummaryPanel nextDisabled={!calculations.isValid}>
      <AllocatedCapitalSection
        allocatedBaseAmount={state.allocatedBaseAmount}
        allocatedQuoteAmount={state.allocatedQuoteAmount}
        totalQuoteValue={state.totalQuoteValue}
        baseToken={state.baseToken}
        quoteToken={state.quoteToken}
        baseLogoUrl={baseLogoUrl}
        quoteLogoUrl={quoteLogoUrl}
      />
    </WizardSummaryPanel>
  );

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}

// ============================================================================
// Token Amount Input Component
// ============================================================================

interface TokenAmountInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onMax: () => void;
  balance: bigint | undefined;
  decimals: number;
  symbol: string;
  isBalanceLoading: boolean;
  isConnected: boolean;
  placeholder?: string;
}

function TokenAmountInput({
  label,
  value,
  onChange,
  onMax,
  balance,
  decimals,
  symbol,
  isBalanceLoading,
  isConnected,
  placeholder = '0.0',
}: TokenAmountInputProps) {
  // Determine what to show for the balance
  const renderBalance = () => {
    if (!isConnected) {
      return <span className="text-slate-500">-- {symbol}</span>;
    }
    if (isBalanceLoading) {
      return <span>Loading...</span>;
    }
    return (
      <span>
        {formatCompactValue(balance ?? 0n, decimals)} {symbol}
      </span>
    );
  };

  // MAX button is disabled when: not connected or no balance
  const isMaxDisabled = !isConnected || !balance || balance === 0n;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm text-slate-400">{label}</label>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Wallet className="w-3 h-3" />
          {renderBalance()}
        </div>
      </div>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            // Allow only valid decimal input
            const val = e.target.value;
            if (val === '' || /^[0-9]*\.?[0-9]*$/.test(val)) {
              onChange(val);
            }
          }}
          placeholder={placeholder}
          className="w-full px-3 py-2 pr-14 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm"
        />
        <button
          onClick={onMax}
          disabled={isMaxDisabled}
          className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-0.5 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:text-slate-500"
        >
          MAX
        </button>
      </div>
    </div>
  );
}
