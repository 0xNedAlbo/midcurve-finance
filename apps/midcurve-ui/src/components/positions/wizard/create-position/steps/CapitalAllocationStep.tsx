import { useEffect, useCallback } from 'react';
import { Wallet, ArrowLeftRight, Activity, Banknote, Scale, Sigma, PlusCircle, MinusCircle } from 'lucide-react';
import { formatUnits } from 'viem';
import { useAccount } from 'wagmi';
import { formatCompactValue } from '@midcurve/shared';
import {
  useCreatePositionWizard,
  type CapitalAllocationMode,
} from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';
import { AllocatedCapitalSection } from '../shared/AllocatedCapitalSection';
import { useDefaultTickRange } from '../hooks/useDefaultTickRange';
import { useCapitalCalculations } from '../hooks/useCapitalCalculations';
import { useErc20TokenBalance } from '@/hooks/tokens/erc20/useErc20TokenBalance';

const MODE_TABS: { id: CapitalAllocationMode; label: string; description: string; icon: typeof Banknote }[] = [
  { id: 'quoteOnly', label: 'Quote Only', description: 'Enter total investment in quote token', icon: Banknote },
  { id: 'baseOnly', label: 'Base Only', description: 'Enter base token amount to invest', icon: Activity },
  { id: 'matched', label: 'Matched', description: 'Enter one token, calculate matching amount', icon: Scale },
  { id: 'custom', label: 'Custom', description: 'Enter both token amounts independently', icon: Sigma },
];

export function CapitalAllocationStep() {
  const {
    state,
    setCapitalAllocationMode,
    setBaseInput,
    setQuoteInput,
    setMatchedInputSide,
    setMatchedUsedMax,
    setAllocatedAmounts,
    setDefaultTickRange,
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

  // Calculate default tick range (±20%) when pool is discovered
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

  // Calculate allocations
  const calculations = useCapitalCalculations({
    mode: state.capitalAllocationMode,
    baseInputAmount: state.baseInputAmount,
    quoteInputAmount: state.quoteInputAmount,
    matchedInputSide: state.matchedInputSide,
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
    setStepValid('investment', calculations.isValid);
  }, [calculations.isValid, setStepValid]);

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
    if (state.capitalAllocationMode === 'matched') {
      setMatchedUsedMax(true);
    }
  }, [baseBalance, state.baseToken, state.capitalAllocationMode, setBaseInput, setMatchedUsedMax]);

  // Handle MAX button for quote token
  const handleQuoteMax = useCallback(() => {
    if (!quoteBalance || !state.quoteToken) return;
    const formatted = formatUnits(quoteBalance, state.quoteToken.decimals);
    setQuoteInput(formatted, true);
    if (state.capitalAllocationMode === 'matched') {
      setMatchedUsedMax(true);
    }
  }, [quoteBalance, state.quoteToken, state.capitalAllocationMode, setQuoteInput, setMatchedUsedMax]);

  // Handle matched mode input side toggle
  const handleToggleMatchedSide = useCallback(() => {
    const newSide = state.matchedInputSide === 'base' ? 'quote' : 'base';
    setMatchedInputSide(newSide);
    // Clear inputs when switching sides
    setBaseInput('', false);
    setQuoteInput('', false);
    setMatchedUsedMax(false);
  }, [state.matchedInputSide, setMatchedInputSide, setBaseInput, setQuoteInput, setMatchedUsedMax]);

  const renderInteractive = () => (
    <div className="space-y-4">
      {/* Header with tabs and zoom controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-8">
          <h3 className="text-lg font-semibold text-white">Allocate Capital</h3>
          <div className="flex items-center gap-6">
            {MODE_TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setCapitalAllocationMode(tab.id)}
                  className={`flex items-center gap-1.5 pb-2 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
                    state.capitalAllocationMode === tab.id
                      ? 'text-blue-400 border-blue-300'
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

      {/* Mode description */}
      <p className="text-sm text-slate-400">
        {MODE_TABS.find((t) => t.id === state.capitalAllocationMode)?.description}
      </p>

      {/* Input forms based on mode */}
      <div className="space-y-4 pt-2">
        {/* Quote Only mode */}
        {state.capitalAllocationMode === 'quoteOnly' && (
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
        )}

        {/* Base Only mode */}
        {state.capitalAllocationMode === 'baseOnly' && (
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
        )}

        {/* Matched mode */}
        {state.capitalAllocationMode === 'matched' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">Input token:</span>
              <button
                onClick={handleToggleMatchedSide}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-700/50 rounded text-sm text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
              >
                {state.matchedInputSide === 'base'
                  ? state.baseToken?.symbol || 'Base'
                  : state.quoteToken?.symbol || 'Quote'}
                <ArrowLeftRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {state.matchedInputSide === 'base' ? (
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
            ) : (
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
            )}
          </div>
        )}

        {/* Custom mode */}
        {state.capitalAllocationMode === 'custom' && (
          <div className="space-y-4">
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
        )}
      </div>
    </div>
  );

  const renderVisual = () => (
    <div className="h-full flex items-center justify-center text-slate-500">
      <p className="text-sm">Position visualization coming soon</p>
    </div>
  );

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
      <div className="flex items-center gap-2">
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
          className="flex-1 px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm"
        />
        <button
          onClick={onMax}
          disabled={isMaxDisabled}
          className="px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          MAX
        </button>
      </div>
    </div>
  );
}
