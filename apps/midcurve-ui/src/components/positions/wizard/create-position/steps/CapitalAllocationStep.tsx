import { useEffect, useCallback } from 'react';
import { Wallet, ArrowLeftRight } from 'lucide-react';
import { formatUnits } from 'viem';
import { useAccount } from 'wagmi';
import {
  useCreatePositionWizard,
  type CapitalAllocationMode,
} from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';
import { QuoteTokenSection } from '../shared/QuoteTokenSection';
import { AllocatedCapitalSection } from '../shared/AllocatedCapitalSection';
import { useDefaultTickRange } from '../hooks/useDefaultTickRange';
import { useCapitalCalculations } from '../hooks/useCapitalCalculations';
import { useErc20TokenBalance } from '@/hooks/tokens/erc20/useErc20TokenBalance';

const MODE_TABS: { id: CapitalAllocationMode; label: string; description: string }[] = [
  { id: 'quoteOnly', label: 'Quote Only', description: 'Enter total investment in quote token' },
  { id: 'baseOnly', label: 'Base Only', description: 'Enter base token amount to invest' },
  { id: 'matched', label: 'Matched', description: 'Enter one token, calculate matching amount' },
  { id: 'custom', label: 'Custom', description: 'Enter both token amounts independently' },
];

/**
 * Format a balance for display
 */
function formatBalance(balance: bigint | undefined, decimals: number): string {
  if (balance === undefined || balance === 0n) return '0';
  const formatted = formatUnits(balance, decimals);
  const num = parseFloat(formatted);
  if (num < 0.0001) return '<0.0001';
  if (num < 1) return num.toFixed(6);
  if (num < 1000) return num.toFixed(4);
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

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
    swapQuoteBase,
    setStepValid,
  } = useCreatePositionWizard();

  const { address: walletAddress } = useAccount();

  // Get token balances for MAX buttons
  const { balanceBigInt: baseBalance, isLoading: isBaseBalanceLoading } = useErc20TokenBalance({
    walletAddress: walletAddress ?? null,
    tokenAddress: state.baseToken?.address ?? null,
    chainId: state.selectedPool?.chainId ?? 1,
    enabled: !!walletAddress && !!state.baseToken?.address,
  });

  const { balanceBigInt: quoteBalance, isLoading: isQuoteBalanceLoading } = useErc20TokenBalance({
    walletAddress: walletAddress ?? null,
    tokenAddress: state.quoteToken?.address ?? null,
    chainId: state.selectedPool?.chainId ?? 1,
    enabled: !!walletAddress && !!state.quoteToken?.address,
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
      {/* Header with tabs inline */}
      <div className="flex items-center gap-8">
        <h3 className="text-lg font-semibold text-white">Allocate Capital</h3>
        <div className="flex items-center gap-6">
          {MODE_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setCapitalAllocationMode(tab.id)}
              className={`flex items-center gap-2 pb-2 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
                state.capitalAllocationMode === tab.id
                  ? 'text-blue-400 border-blue-300'
                  : 'text-slate-400 border-transparent hover:text-slate-200'
              }`}
              title={tab.description}
            >
              {tab.label}
            </button>
          ))}
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

  const renderSummary = () => (
    <WizardSummaryPanel nextDisabled={!calculations.isValid}>
      <QuoteTokenSection
        quoteToken={state.quoteToken}
        baseToken={state.baseToken}
        onSwap={swapQuoteBase}
      />
      <AllocatedCapitalSection
        allocatedBaseAmount={state.allocatedBaseAmount}
        allocatedQuoteAmount={state.allocatedQuoteAmount}
        totalQuoteValue={state.totalQuoteValue}
        baseToken={state.baseToken}
        quoteToken={state.quoteToken}
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
  placeholder = '0.0',
}: TokenAmountInputProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm text-slate-400">{label}</label>
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <Wallet className="w-3 h-3" />
          {isBalanceLoading ? (
            <span>Loading...</span>
          ) : (
            <span>
              {formatBalance(balance, decimals)} {symbol}
            </span>
          )}
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
          disabled={!balance || balance === 0n}
          className="px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          MAX
        </button>
      </div>
    </div>
  );
}
