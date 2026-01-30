import { useState, useEffect } from 'react';
import { ArrowDownUp, Info } from 'lucide-react';
import { useCreatePositionWizard } from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';

export function SwapStep() {
  const { state, setStepValid, goNext, setNeedsSwap } = useCreatePositionWizard();

  const [swapAmount, setSwapAmount] = useState('');
  const [isSwapping, setIsSwapping] = useState(false);
  const [swapComplete, setSwapComplete] = useState(false);

  const token0 = state.selectedPool?.token0;
  const token1 = state.selectedPool?.token1;

  // Check if swap is actually needed
  useEffect(() => {
    // In real implementation, compare wallet balance with required amounts
    // For mockup, assume swap is needed
    setStepValid('swap', swapComplete);
  }, [swapComplete, setStepValid]);

  const handleSwap = async () => {
    setIsSwapping(true);
    // Simulate swap
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setIsSwapping(false);
    setSwapComplete(true);
  };

  const handleSkip = () => {
    setNeedsSwap(false);
    goNext();
  };

  const renderInteractive = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-white">Swap Tokens</h3>

      <div className="p-4 bg-blue-600/10 border border-blue-500/30 rounded-lg">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-blue-300 text-sm">
              Your wallet balance doesn't match the required token amounts for this position.
              Swap some tokens to get the right balance.
            </p>
          </div>
        </div>
      </div>

      {/* Required amounts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 bg-slate-700/30 rounded-lg">
          <p className="text-sm text-slate-400">Required {token0?.symbol}</p>
          <p className="text-white font-medium">{state.tokenAAmount || '0'}</p>
          <p className="text-xs text-slate-500 mt-1">Balance: 15,234.56</p>
        </div>
        <div className="p-3 bg-slate-700/30 rounded-lg">
          <p className="text-sm text-slate-400">Required {token1?.symbol}</p>
          <p className="text-white font-medium">{state.tokenBAmount || '0'}</p>
          <p className="text-xs text-slate-500 mt-1">Balance: 4.2345</p>
        </div>
      </div>

      {/* Swap form */}
      <div className="p-4 bg-slate-700/30 rounded-lg space-y-4">
        <div className="space-y-2">
          <label className="text-sm text-slate-400">You Pay</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={swapAmount}
              onChange={(e) => setSwapAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-lg text-white text-lg focus:outline-none focus:border-blue-500"
            />
            <div className="px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-lg text-white font-medium">
              {token0?.symbol}
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <div className="p-2 bg-slate-800/50 rounded-lg">
            <ArrowDownUp className="w-5 h-5 text-slate-400" />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-slate-400">You Receive (estimated)</label>
          <div className="flex gap-2">
            <div className="flex-1 px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-lg text-white text-lg">
              {swapAmount ? (Number(swapAmount) * 0.00042).toFixed(6) : '0.00'}
            </div>
            <div className="px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-lg text-white font-medium">
              {token1?.symbol}
            </div>
          </div>
        </div>

        {/* Swap details */}
        <div className="pt-4 border-t border-slate-600/50 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">Exchange Rate</span>
            <span className="text-white">1 {token0?.symbol} = 0.00042 {token1?.symbol}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Price Impact</span>
            <span className="text-green-400">&lt;0.01%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Slippage Tolerance</span>
            <span className="text-white">0.5%</span>
          </div>
        </div>
      </div>

      {/* Swap button */}
      <button
        onClick={handleSwap}
        disabled={!swapAmount || isSwapping || swapComplete}
        className={`w-full py-3 rounded-lg font-medium transition-colors cursor-pointer ${
          swapComplete
            ? 'bg-green-600 text-white'
            : isSwapping
              ? 'bg-blue-600/50 text-white cursor-wait'
              : 'bg-blue-600 text-white hover:bg-blue-700'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {swapComplete ? 'Swap Complete!' : isSwapping ? 'Swapping...' : 'Swap Tokens'}
      </button>

      <button
        onClick={handleSkip}
        className="w-full py-2 text-sm text-slate-400 hover:text-white transition-colors cursor-pointer"
      >
        Skip - I'll manage my token balance manually
      </button>
    </div>
  );

  const renderVisual = () => (
    <div className="h-full flex flex-col">
      <h3 className="text-lg font-semibold text-white mb-4">Swap Preview</h3>

      <div className="flex-1 flex items-center justify-center bg-slate-700/20 rounded-lg border border-slate-600/30">
        <div className="text-center p-8">
          <ArrowDownUp className="w-16 h-16 text-blue-400 mx-auto mb-4" />
          <p className="text-white text-lg font-medium mb-2">
            {swapAmount || '0'} {token0?.symbol}
          </p>
          <p className="text-slate-400 mb-2">↓</p>
          <p className="text-white text-lg font-medium">
            {swapAmount ? (Number(swapAmount) * 0.00042).toFixed(6) : '0'} {token1?.symbol}
          </p>

          {swapComplete && (
            <div className="mt-6 p-4 bg-green-600/20 border border-green-500/50 rounded-lg">
              <p className="text-green-400">Swap completed successfully!</p>
            </div>
          )}
        </div>
      </div>

      {/* Provider info */}
      <div className="mt-4 p-3 bg-slate-700/30 rounded-lg">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Swap Provider</span>
          <span className="text-white">ParaSwap</span>
        </div>
      </div>
    </div>
  );

  const renderSummary = () => (
    <WizardSummaryPanel
      nextDisabled={!swapComplete}
      nextLabel={swapComplete ? 'Continue' : 'Complete Swap First'}
    />
  );

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
