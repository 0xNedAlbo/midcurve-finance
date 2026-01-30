import { useCreatePositionWizard } from '../context/CreatePositionWizardContext';
import { StepNavigationButtons } from './StepNavigationButtons';

interface WizardSummaryPanelProps {
  showSkip?: boolean;
  onSkip?: () => void;
  skipLabel?: string;
  nextLabel?: string;
  nextDisabled?: boolean;
  onNext?: () => void;
  showFinish?: boolean;
  onFinish?: () => void;
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
  children,
}: WizardSummaryPanelProps) {
  const { state, currentStep } = useCreatePositionWizard();

  const formatAmount = (amount: string, symbol: string) => {
    if (!amount || amount === '0') return '-';
    return `${amount} ${symbol}`;
  };

  return (
    <div className="h-full flex flex-col">
      <h3 className="text-lg font-semibold text-white mb-4">Summary</h3>

      <div className="flex-1 space-y-4 overflow-auto">
        {/* Current Step */}
        <div className="p-4 bg-slate-700/30 rounded-lg">
          <p className="text-sm text-slate-400">Current Step</p>
          <p className="text-white font-medium">{currentStep.label}</p>
        </div>

        {/* Selected Pool */}
        {state.selectedPool && (
          <>
            <div className="p-4 bg-slate-700/30 rounded-lg">
              <p className="text-sm text-slate-400">Chain</p>
              <p className="text-white font-medium">{state.selectedPool.chainName}</p>
            </div>

            <div className="p-4 bg-slate-700/30 rounded-lg">
              <p className="text-sm text-slate-400">Pool</p>
              <p className="text-white font-medium">
                {state.selectedPool.token0.symbol} / {state.selectedPool.token1.symbol}
              </p>
              <p className="text-sm text-slate-400 mt-1">
                Fee: {state.selectedPool.feeTier}
              </p>
            </div>
          </>
        )}

        {/* Base/Quote Assignment */}
        {state.baseToken && state.quoteToken && (
          <div className="p-4 bg-slate-700/30 rounded-lg">
            <p className="text-sm text-slate-400">Token Assignment</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs px-2 py-0.5 bg-blue-600/30 text-blue-300 rounded">
                Base
              </span>
              <span className="text-white font-medium">{state.baseToken.symbol}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs px-2 py-0.5 bg-green-600/30 text-green-300 rounded">
                Quote
              </span>
              <span className="text-white font-medium">{state.quoteToken.symbol}</span>
            </div>
          </div>
        )}

        {/* Investment Amount */}
        {(state.tokenAAmount || state.tokenBAmount) && state.baseToken && state.quoteToken && (
          <div className="p-4 bg-slate-700/30 rounded-lg">
            <p className="text-sm text-slate-400">Investment</p>
            <p className="text-white font-medium">
              {formatAmount(state.tokenAAmount, state.selectedPool?.token0.symbol || 'Token A')}
            </p>
            <p className="text-white font-medium">
              {formatAmount(state.tokenBAmount, state.selectedPool?.token1.symbol || 'Token B')}
            </p>
            <p className="text-xs text-slate-500 mt-1 capitalize">
              Mode: {state.investmentMode}
            </p>
          </div>
        )}

        {/* Range */}
        {state.tickLower !== 0 && state.tickUpper !== 0 && (
          <div className="p-4 bg-slate-700/30 rounded-lg">
            <p className="text-sm text-slate-400">Price Range</p>
            <p className="text-white font-medium text-sm">
              Tick: {state.tickLower} to {state.tickUpper}
            </p>
          </div>
        )}

        {/* Automation */}
        {state.automationEnabled && (
          <div className="p-4 bg-slate-700/30 rounded-lg">
            <p className="text-sm text-slate-400">Automation</p>
            <div className="space-y-1 mt-1">
              {state.stopLossEnabled && (
                <p className="text-orange-400 text-sm">
                  Stop Loss: Tick {state.stopLossTick ?? 'Not set'}
                </p>
              )}
              {state.takeProfitEnabled && (
                <p className="text-green-400 text-sm">
                  Take Profit: Tick {state.takeProfitTick ?? 'Not set'}
                </p>
              )}
              {!state.stopLossEnabled && !state.takeProfitEnabled && (
                <p className="text-slate-400 text-sm">No triggers configured</p>
              )}
            </div>
          </div>
        )}

        {/* Transactions */}
        {state.transactions.length > 0 && (
          <div className="p-4 bg-slate-700/30 rounded-lg">
            <p className="text-sm text-slate-400">Transactions</p>
            <div className="space-y-2 mt-2">
              {state.transactions.map((tx) => (
                <div key={tx.hash} className="flex items-center justify-between">
                  <span className="text-white text-sm">{tx.label}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      tx.status === 'confirmed'
                        ? 'bg-green-600/30 text-green-300'
                        : tx.status === 'failed'
                          ? 'bg-red-600/30 text-red-300'
                          : 'bg-yellow-600/30 text-yellow-300'
                    }`}
                  >
                    {tx.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Position Created */}
        {state.nftId && (
          <div className="p-4 bg-green-700/30 rounded-lg border border-green-600/50">
            <p className="text-sm text-green-400">Position Created</p>
            <p className="text-white font-medium">NFT ID: #{state.nftId}</p>
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
