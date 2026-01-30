import { useNavigate } from 'react-router-dom';
import { ExternalLink, Check, TrendingDown, TrendingUp, Copy } from 'lucide-react';
import { useCreatePositionWizard } from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';

export function SummaryStep() {
  const navigate = useNavigate();
  const { state, reset } = useCreatePositionWizard();

  const token0 = state.selectedPool?.token0;
  const token1 = state.selectedPool?.token1;

  const handleViewPosition = () => {
    // Navigate to position detail page
    if (state.selectedPool && state.nftId) {
      navigate(`/positions/uniswapv3/${state.selectedPool.chainName.toLowerCase()}/${state.nftId}`);
    } else {
      navigate('/dashboard');
    }
  };

  const handleCreateAnother = () => {
    reset();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const renderInteractive = () => (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-white">Position Created!</h3>

      <div className="p-4 bg-green-600/10 border border-green-500/30 rounded-lg">
        <div className="flex items-center gap-3">
          <Check className="w-6 h-6 text-green-400" />
          <div>
            <p className="text-white font-medium">Your position is now active</p>
            <p className="text-sm text-slate-400">NFT ID: #{state.nftId}</p>
          </div>
        </div>
      </div>

      {/* Position details */}
      <div className="p-4 bg-slate-700/30 rounded-lg space-y-3">
        <h4 className="text-white font-medium">Position Details</h4>

        <div className="flex justify-between">
          <span className="text-slate-400">Pool</span>
          <span className="text-white">
            {token0?.symbol} / {token1?.symbol}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-slate-400">Chain</span>
          <span className="text-white">{state.selectedPool?.chainName}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-slate-400">Fee Tier</span>
          <span className="text-white">{state.selectedPool?.feeTier}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-slate-400">{token0?.symbol} Amount</span>
          <span className="text-white">{state.tokenAAmount || '0'}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-slate-400">{token1?.symbol} Amount</span>
          <span className="text-white">{state.tokenBAmount || '0'}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-slate-400">Tick Range</span>
          <span className="text-white font-mono">
            {state.tickLower} → {state.tickUpper}
          </span>
        </div>
      </div>

      {/* Automation summary */}
      {state.automationEnabled && (state.stopLossEnabled || state.takeProfitEnabled) && (
        <div className="p-4 bg-slate-700/30 rounded-lg space-y-3">
          <h4 className="text-white font-medium">Automation</h4>

          {state.stopLossEnabled && (
            <div className="flex items-center gap-2 text-orange-400">
              <TrendingDown className="w-4 h-4" />
              <span>Stop Loss at tick {state.stopLossTick}</span>
            </div>
          )}

          {state.takeProfitEnabled && (
            <div className="flex items-center gap-2 text-green-400">
              <TrendingUp className="w-4 h-4" />
              <span>Take Profit at tick {state.takeProfitTick}</span>
            </div>
          )}
        </div>
      )}

      {/* Transactions */}
      {state.transactions.length > 0 && (
        <div className="p-4 bg-slate-700/30 rounded-lg space-y-3">
          <h4 className="text-white font-medium">Transactions</h4>

          {state.transactions.map((tx) => (
            <div key={tx.hash} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-400" />
                <span className="text-slate-300 text-sm">{tx.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyToClipboard(tx.hash)}
                  className="text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <Copy className="w-3 h-3" />
                </button>
                <a
                  href={`https://etherscan.io/tx/${tx.hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-sm"
                >
                  {tx.hash.slice(0, 8)}...
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleViewPosition}
          className="flex-1 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer"
        >
          View Position
        </button>
        <button
          onClick={handleCreateAnother}
          className="flex-1 py-3 bg-slate-700/50 text-white rounded-lg font-medium hover:bg-slate-700 transition-colors cursor-pointer"
        >
          Create Another
        </button>
      </div>
    </div>
  );

  const renderVisual = () => (
    <div className="h-full flex flex-col">
      <h3 className="text-lg font-semibold text-white mb-4">Final Position</h3>

      {/* PnL curve with all markers */}
      <div className="flex-1 flex items-center justify-center bg-slate-700/20 rounded-lg border border-slate-600/30">
        <div className="w-full max-w-lg p-4">
          <svg viewBox="0 0 400 250" className="w-full h-64">
            {/* Background */}
            <rect width="400" height="250" fill="#1e293b" fillOpacity="0.3" />

            {/* Zero line */}
            <line x1="0" y1="125" x2="400" y2="125" stroke="#475569" strokeWidth="1" />

            {/* Range fill */}
            <rect x="80" y="0" width="240" height="250" fill="#3b82f6" fillOpacity="0.1" />

            {/* Range boundaries */}
            <line x1="80" y1="0" x2="80" y2="250" stroke="#3b82f6" strokeWidth="2" />
            <line x1="320" y1="0" x2="320" y2="250" stroke="#3b82f6" strokeWidth="2" />

            {/* PnL curve */}
            <path
              d="M 0 200 L 80 150 Q 200 80 320 150 L 400 200"
              fill="none"
              stroke="#22c55e"
              strokeWidth="3"
            />

            {/* Current price */}
            <line x1="200" y1="0" x2="200" y2="250" stroke="#eab308" strokeWidth="2" />
            <circle cx="200" cy="115" r="8" fill="#eab308" />

            {/* Stop Loss marker */}
            {state.stopLossEnabled && (
              <>
                <line x1="60" y1="0" x2="60" y2="250" stroke="#f97316" strokeWidth="2" />
                <circle cx="60" cy="180" r="8" fill="#f97316" />
              </>
            )}

            {/* Take Profit marker */}
            {state.takeProfitEnabled && (
              <>
                <line x1="340" y1="0" x2="340" y2="250" stroke="#22c55e" strokeWidth="2" />
                <circle cx="340" cy="180" r="8" fill="#22c55e" />
              </>
            )}

            {/* NFT ID label */}
            <text x="200" y="240" fill="#94a3b8" fontSize="12" textAnchor="middle">
              Position #{state.nftId}
            </text>
          </svg>
        </div>
      </div>

      {/* Quick stats */}
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="p-3 bg-slate-700/30 rounded-lg text-center">
          <p className="text-sm text-slate-400">Status</p>
          <p className="text-green-400 font-medium">Active</p>
        </div>
        <div className="p-3 bg-slate-700/30 rounded-lg text-center">
          <p className="text-sm text-slate-400">Range Width</p>
          <p className="text-white font-medium">±20%</p>
        </div>
        <div className="p-3 bg-slate-700/30 rounded-lg text-center">
          <p className="text-sm text-slate-400">Est. APR</p>
          <p className="text-green-400 font-medium">37.2%</p>
        </div>
      </div>
    </div>
  );

  const renderSummary = () => (
    <WizardSummaryPanel showFinish onFinish={handleViewPosition}>
      {/* Final summary info */}
      <div className="p-4 bg-blue-600/10 border border-blue-500/30 rounded-lg">
        <p className="text-blue-300 text-sm">
          Your position is now live! You can monitor it from the dashboard and
          manage it at any time.
        </p>
      </div>
    </WizardSummaryPanel>
  );

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
