import { useEffect } from 'react';
import { Shield, TrendingDown, TrendingUp, SkipForward } from 'lucide-react';
import { useCreatePositionWizard } from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';

export function AutomationStep() {
  const {
    state,
    setAutomationEnabled,
    setStopLoss,
    setTakeProfit,
    setStepValid,
    goNext,
  } = useCreatePositionWizard();

  // This step is always valid (can skip)
  useEffect(() => {
    setStepValid('automation', true);
  }, [setStepValid]);

  const handleSkip = () => {
    setAutomationEnabled(false);
    goNext();
  };

  const handleStopLossChange = (tick: number | null) => {
    setStopLoss(tick !== null, tick);
  };

  const handleTakeProfitChange = (tick: number | null) => {
    setTakeProfit(tick !== null, tick);
  };

  const renderInteractive = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Position Automation</h3>
        <button
          onClick={handleSkip}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <SkipForward className="w-4 h-4" />
          Skip
        </button>
      </div>

      {/* Enable automation toggle */}
      <div className="flex items-center justify-between p-4 bg-slate-700/30 rounded-lg">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-blue-400" />
          <div>
            <p className="text-white font-medium">Enable Automation</p>
            <p className="text-sm text-slate-400">
              Automatically close position at stop-loss or take-profit levels
            </p>
          </div>
        </div>
        <button
          onClick={() => setAutomationEnabled(!state.automationEnabled)}
          className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer ${
            state.automationEnabled ? 'bg-blue-600' : 'bg-slate-600'
          }`}
        >
          <div
            className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
              state.automationEnabled ? 'translate-x-7' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {state.automationEnabled && (
        <>
          {/* Stop Loss */}
          <div className="p-4 bg-slate-700/30 rounded-lg space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <TrendingDown className="w-5 h-5 text-orange-400" />
                <div>
                  <p className="text-white font-medium">Stop Loss</p>
                  <p className="text-sm text-slate-400">
                    Close position when price drops below threshold
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleStopLossChange(state.stopLossEnabled ? null : state.tickLower)}
                className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer ${
                  state.stopLossEnabled ? 'bg-orange-600' : 'bg-slate-600'
                }`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    state.stopLossEnabled ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {state.stopLossEnabled && (
              <div className="space-y-2 pt-2 border-t border-slate-600/50">
                <label className="text-sm text-slate-400">Trigger Price (Tick)</label>
                <input
                  type="number"
                  value={state.stopLossTick ?? ''}
                  onChange={(e) => handleStopLossChange(e.target.value ? Number(e.target.value) : null)}
                  placeholder="Enter tick value"
                  className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                />
                <p className="text-xs text-slate-400">
                  Click on the PnL curve to set visually, or enter tick value manually
                </p>
              </div>
            )}
          </div>

          {/* Take Profit */}
          <div className="p-4 bg-slate-700/30 rounded-lg space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <TrendingUp className="w-5 h-5 text-green-400" />
                <div>
                  <p className="text-white font-medium">Take Profit</p>
                  <p className="text-sm text-slate-400">
                    Close position when price rises above threshold
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleTakeProfitChange(state.takeProfitEnabled ? null : state.tickUpper)}
                className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer ${
                  state.takeProfitEnabled ? 'bg-green-600' : 'bg-slate-600'
                }`}
              >
                <div
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                    state.takeProfitEnabled ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {state.takeProfitEnabled && (
              <div className="space-y-2 pt-2 border-t border-slate-600/50">
                <label className="text-sm text-slate-400">Trigger Price (Tick)</label>
                <input
                  type="number"
                  value={state.takeProfitTick ?? ''}
                  onChange={(e) => handleTakeProfitChange(e.target.value ? Number(e.target.value) : null)}
                  placeholder="Enter tick value"
                  className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-green-500"
                />
                <p className="text-xs text-slate-400">
                  Click on the PnL curve to set visually, or enter tick value manually
                </p>
              </div>
            )}
          </div>

          {/* Info box */}
          <div className="p-3 bg-blue-600/10 border border-blue-500/30 rounded-lg">
            <p className="text-sm text-blue-300">
              Automation requires an automation wallet. If you don't have one, it will be
              created in a later step.
            </p>
          </div>
        </>
      )}
    </div>
  );

  const renderVisual = () => (
    <div className="h-full flex flex-col">
      <h3 className="text-lg font-semibold text-white mb-4">Interactive PnL Curve</h3>

      {/* Interactive PnL curve */}
      <div className="flex-1 flex items-center justify-center bg-slate-700/20 rounded-lg border border-slate-600/30">
        <div className="w-full max-w-lg p-4">
          <svg viewBox="0 0 400 250" className="w-full h-64">
            {/* Background */}
            <rect width="400" height="250" fill="#1e293b" fillOpacity="0.3" />

            {/* Zero line */}
            <line x1="0" y1="125" x2="400" y2="125" stroke="#475569" strokeWidth="1" />

            {/* Range boundaries */}
            <line x1="80" y1="0" x2="80" y2="250" stroke="#3b82f6" strokeWidth="1" strokeDasharray="4" />
            <line x1="320" y1="0" x2="320" y2="250" stroke="#3b82f6" strokeWidth="1" strokeDasharray="4" />

            {/* PnL curve */}
            <path
              d="M 0 200 L 80 150 Q 200 80 320 150 L 400 200"
              fill="none"
              stroke="#22c55e"
              strokeWidth="2"
            />

            {/* Current price */}
            <line x1="200" y1="0" x2="200" y2="250" stroke="#eab308" strokeWidth="2" />
            <circle cx="200" cy="115" r="6" fill="#eab308" />

            {/* Stop Loss marker */}
            {state.stopLossEnabled && state.stopLossTick && (
              <>
                <line x1="60" y1="0" x2="60" y2="250" stroke="#f97316" strokeWidth="2" />
                <circle cx="60" cy="180" r="8" fill="#f97316" />
                <text x="45" y="15" fill="#f97316" fontSize="10">SL</text>
              </>
            )}

            {/* Take Profit marker */}
            {state.takeProfitEnabled && state.takeProfitTick && (
              <>
                <line x1="340" y1="0" x2="340" y2="250" stroke="#22c55e" strokeWidth="2" />
                <circle cx="340" cy="180" r="8" fill="#22c55e" />
                <text x="330" y="15" fill="#22c55e" fontSize="10">TP</text>
              </>
            )}

            {/* Click hint */}
            <text x="200" y="240" fill="#94a3b8" fontSize="10" textAnchor="middle">
              Click to set SL/TP levels
            </text>
          </svg>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex justify-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-yellow-400" />
          <span className="text-slate-400">Current Price</span>
        </div>
        {state.stopLossEnabled && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-orange-400" />
            <span className="text-slate-400">Stop Loss</span>
          </div>
        )}
        {state.takeProfitEnabled && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-400" />
            <span className="text-slate-400">Take Profit</span>
          </div>
        )}
      </div>
    </div>
  );

  const renderSummary = () => (
    <WizardSummaryPanel showSkip skipLabel="Skip Automation" onSkip={handleSkip}>
      {state.automationEnabled && (
        <div className="p-4 bg-slate-700/30 rounded-lg">
          <p className="text-sm text-slate-400">Automation Summary</p>
          <div className="mt-2 space-y-2">
            {state.stopLossEnabled ? (
              <div className="flex items-center gap-2 text-orange-400">
                <TrendingDown className="w-4 h-4" />
                <span className="text-sm">SL at tick {state.stopLossTick}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-slate-500">
                <TrendingDown className="w-4 h-4" />
                <span className="text-sm">No stop loss</span>
              </div>
            )}
            {state.takeProfitEnabled ? (
              <div className="flex items-center gap-2 text-green-400">
                <TrendingUp className="w-4 h-4" />
                <span className="text-sm">TP at tick {state.takeProfitTick}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-slate-500">
                <TrendingUp className="w-4 h-4" />
                <span className="text-sm">No take profit</span>
              </div>
            )}
          </div>
        </div>
      )}
    </WizardSummaryPanel>
  );

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
