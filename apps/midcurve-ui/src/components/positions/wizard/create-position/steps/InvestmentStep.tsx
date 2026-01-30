import { useEffect } from 'react';
import { Wallet } from 'lucide-react';
import {
  useCreatePositionWizard,
  type InvestmentMode,
} from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';

const INVESTMENT_MODES: { id: InvestmentMode; label: string; description: string }[] = [
  {
    id: 'tokenA',
    label: 'All Token A',
    description: 'Invest only using Token A (e.g., 10,000 USDC)',
  },
  {
    id: 'tokenB',
    label: 'All Token B',
    description: 'Invest only using Token B (e.g., 3 ETH)',
  },
  {
    id: 'matched',
    label: 'Matched',
    description: 'Enter one amount, the other is calculated to match',
  },
  {
    id: 'independent',
    label: 'Independent',
    description: 'Enter both amounts independently',
  },
];

// Mock balances
const MOCK_BALANCES = {
  tokenA: '15,234.56',
  tokenB: '4.2345',
};

export function InvestmentStep() {
  const {
    state,
    setInvestmentMode,
    setTokenAAmount,
    setTokenBAmount,
    setStepValid,
  } = useCreatePositionWizard();

  const token0Symbol = state.selectedPool?.token0.symbol || 'Token A';
  const token1Symbol = state.selectedPool?.token1.symbol || 'Token B';

  // Validate step
  useEffect(() => {
    const hasAmount = state.tokenAAmount !== '' || state.tokenBAmount !== '';
    setStepValid('investment', hasAmount);
  }, [state.tokenAAmount, state.tokenBAmount, setStepValid]);

  const handleMaxClick = (token: 'A' | 'B') => {
    if (token === 'A') {
      setTokenAAmount(MOCK_BALANCES.tokenA.replace(/,/g, ''), true);
    } else {
      setTokenBAmount(MOCK_BALANCES.tokenB, true);
    }
  };

  const renderInteractive = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-white">Investment Amount</h3>

      {/* Mode selector */}
      <div className="space-y-2">
        <label className="text-sm text-slate-400">Investment Mode</label>
        <div className="grid grid-cols-2 gap-2">
          {INVESTMENT_MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => setInvestmentMode(mode.id)}
              className={`p-3 rounded-lg text-left transition-colors cursor-pointer ${
                state.investmentMode === mode.id
                  ? 'bg-blue-600/30 border border-blue-500/50'
                  : 'bg-slate-700/30 border border-slate-600/30 hover:bg-slate-700/50'
              }`}
            >
              <p className="text-white font-medium text-sm">{mode.label}</p>
              <p className="text-slate-400 text-xs mt-1">{mode.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Token A input */}
      {(state.investmentMode === 'tokenA' ||
        state.investmentMode === 'matched' ||
        state.investmentMode === 'independent') && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm text-slate-400">{token0Symbol} Amount</label>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Wallet className="w-4 h-4" />
              <span>Balance: {MOCK_BALANCES.tokenA}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={state.tokenAAmount}
              onChange={(e) => setTokenAAmount(e.target.value, false)}
              placeholder="0.00"
              className="flex-1 px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-lg placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => handleMaxClick('A')}
              className="px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-blue-400 font-medium hover:bg-slate-700 transition-colors cursor-pointer"
            >
              MAX
            </button>
          </div>
          {state.tokenAIsMax && (
            <p className="text-xs text-blue-400">Using maximum balance</p>
          )}
        </div>
      )}

      {/* Token B input */}
      {(state.investmentMode === 'tokenB' ||
        state.investmentMode === 'matched' ||
        state.investmentMode === 'independent') && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm text-slate-400">{token1Symbol} Amount</label>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Wallet className="w-4 h-4" />
              <span>Balance: {MOCK_BALANCES.tokenB}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={state.tokenBAmount}
              onChange={(e) => setTokenBAmount(e.target.value, false)}
              placeholder="0.00"
              className="flex-1 px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-lg placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => handleMaxClick('B')}
              className="px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-blue-400 font-medium hover:bg-slate-700 transition-colors cursor-pointer"
            >
              MAX
            </button>
          </div>
          {state.tokenBIsMax && (
            <p className="text-xs text-blue-400">Using maximum balance</p>
          )}
        </div>
      )}

      {/* Matched mode notice */}
      {state.investmentMode === 'matched' && (
        <div className="p-3 bg-blue-600/10 border border-blue-500/30 rounded-lg">
          <p className="text-sm text-blue-300">
            In matched mode, the matching token amount will be calculated based on
            your range selection in the next step.
          </p>
        </div>
      )}
    </div>
  );

  const renderVisual = () => (
    <div className="h-full flex flex-col">
      <h3 className="text-lg font-semibold text-white mb-4">Position Preview</h3>

      {/* Mock PnL curve placeholder */}
      <div className="flex-1 flex items-center justify-center bg-slate-700/20 rounded-lg border border-slate-600/30">
        <div className="text-center">
          <div className="w-full max-w-md mx-auto mb-4">
            {/* Simple ASCII-style PnL curve representation */}
            <svg viewBox="0 0 400 200" className="w-full h-48">
              {/* Grid lines */}
              <line x1="50" y1="180" x2="350" y2="180" stroke="#475569" strokeWidth="1" />
              <line x1="50" y1="100" x2="350" y2="100" stroke="#475569" strokeWidth="1" strokeDasharray="4" />

              {/* PnL curve */}
              <path
                d="M 50 150 Q 100 150 150 120 T 200 100 T 250 120 T 300 150 L 350 150"
                fill="none"
                stroke="#3b82f6"
                strokeWidth="2"
              />

              {/* Current price marker */}
              <circle cx="200" cy="100" r="5" fill="#3b82f6" />

              {/* Labels */}
              <text x="50" y="195" fill="#94a3b8" fontSize="12">Lower</text>
              <text x="180" y="195" fill="#94a3b8" fontSize="12">Current</text>
              <text x="320" y="195" fill="#94a3b8" fontSize="12">Upper</text>
            </svg>
          </div>
          <p className="text-slate-400">
            PnL curve will update based on your investment and range settings
          </p>
        </div>
      </div>

      {/* Investment summary */}
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div className="p-3 bg-slate-700/30 rounded-lg">
          <p className="text-sm text-slate-400">{token0Symbol}</p>
          <p className="text-white font-medium">
            {state.tokenAAmount || '0'} {token0Symbol}
          </p>
        </div>
        <div className="p-3 bg-slate-700/30 rounded-lg">
          <p className="text-sm text-slate-400">{token1Symbol}</p>
          <p className="text-white font-medium">
            {state.tokenBAmount || '0'} {token1Symbol}
          </p>
        </div>
      </div>
    </div>
  );

  const renderSummary = () => (
    <WizardSummaryPanel
      nextDisabled={state.tokenAAmount === '' && state.tokenBAmount === ''}
    />
  );

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
