import { useState, useEffect } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { useCreatePositionWizard } from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';
import { usePoolPrice } from '@/hooks/pools/usePoolPrice';

const RANGE_PRESETS = [
  { label: '±5%', value: 5 },
  { label: '±10%', value: 10 },
  { label: '±20%', value: 20 },
  { label: '±30%', value: 30 },
  { label: '±50%', value: 50 },
  { label: 'Full', value: 100 },
];

export function RangeStep() {
  const { state, setTickRange, swapQuoteBase, setStepValid } = useCreatePositionWizard();

  // Local state for slider
  const [lowerPercent, setLowerPercent] = useState(-10);
  const [upperPercent, setUpperPercent] = useState(10);

  const baseToken = state.baseToken;
  const quoteToken = state.quoteToken;

  // Fetch current tick from pool
  const { currentTick: fetchedTick } = usePoolPrice({
    chainId: state.selectedPool?.chainId?.toString(),
    poolAddress: state.selectedPool?.poolAddress,
    enabled: !!state.selectedPool,
  });
  const currentTick = fetchedTick ?? 0;

  // Calculate ticks from percentage
  const calculateTicks = (lowerPct: number, upperPct: number) => {
    // Simplified tick calculation (in real implementation, use proper math)
    const tickSpacing = 10; // Depends on fee tier
    const ticksPerPercent = 100;
    const tickLower = Math.floor((currentTick + lowerPct * ticksPerPercent) / tickSpacing) * tickSpacing;
    const tickUpper = Math.ceil((currentTick + upperPct * ticksPerPercent) / tickSpacing) * tickSpacing;
    return { tickLower, tickUpper };
  };

  // Update ticks when percentage changes
  useEffect(() => {
    const { tickLower, tickUpper } = calculateTicks(lowerPercent, upperPercent);
    setTickRange(tickLower, tickUpper);
  }, [lowerPercent, upperPercent, currentTick]);

  // Validate step
  useEffect(() => {
    setStepValid('range', state.tickLower < state.tickUpper);
  }, [state.tickLower, state.tickUpper, setStepValid]);

  const handlePreset = (percent: number) => {
    if (percent === 100) {
      // Full range
      setLowerPercent(-99);
      setUpperPercent(99);
    } else {
      setLowerPercent(-percent);
      setUpperPercent(percent);
    }
  };

  const renderInteractive = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Price Range</h3>

        {/* Quote/Base toggle */}
        <button
          onClick={swapQuoteBase}
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-slate-300 hover:bg-slate-700 transition-colors cursor-pointer"
        >
          <ArrowLeftRight className="w-4 h-4" />
          Swap Quote/Base
        </button>
      </div>

      {/* Token assignment display */}
      {baseToken && quoteToken && (
        <div className="flex items-center gap-4 p-3 bg-slate-700/30 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 bg-blue-600/30 text-blue-300 rounded">Base</span>
            <span className="text-white font-medium">{baseToken.symbol}</span>
          </div>
          <span className="text-slate-500">/</span>
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 bg-green-600/30 text-green-300 rounded">Quote</span>
            <span className="text-white font-medium">{quoteToken.symbol}</span>
          </div>
        </div>
      )}

      {/* Range presets */}
      <div className="space-y-2">
        <label className="text-sm text-slate-400">Quick Presets</label>
        <div className="flex flex-wrap gap-2">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => handlePreset(preset.value)}
              className="px-3 py-1.5 bg-slate-700/50 border border-slate-600 rounded-lg text-sm text-slate-300 hover:bg-slate-700 hover:border-blue-500/50 transition-colors cursor-pointer"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Manual range inputs */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm text-slate-400">Lower Price (%)</label>
          <input
            type="number"
            value={lowerPercent}
            onChange={(e) => setLowerPercent(Number(e.target.value))}
            className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm text-slate-400">Upper Price (%)</label>
          <input
            type="number"
            value={upperPercent}
            onChange={(e) => setUpperPercent(Number(e.target.value))}
            className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Range slider visualization */}
      <div className="space-y-2">
        <label className="text-sm text-slate-400">Range Visualization</label>
        <div className="relative h-8 bg-slate-700/30 rounded-lg overflow-hidden">
          {/* Range fill */}
          <div
            className="absolute h-full bg-blue-600/30"
            style={{
              left: `${Math.max(0, 50 + lowerPercent / 2)}%`,
              width: `${Math.min(100, (upperPercent - lowerPercent) / 2)}%`,
            }}
          />
          {/* Current price marker */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-yellow-400"
            style={{ left: '50%' }}
          />
          {/* Lower handle */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-6 bg-blue-500 rounded cursor-ew-resize"
            style={{ left: `calc(${50 + lowerPercent / 2}% - 6px)` }}
          />
          {/* Upper handle */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-6 bg-blue-500 rounded cursor-ew-resize"
            style={{ left: `calc(${50 + upperPercent / 2}% - 6px)` }}
          />
        </div>
        <div className="flex justify-between text-xs text-slate-400">
          <span>{lowerPercent}%</span>
          <span>Current</span>
          <span>+{upperPercent}%</span>
        </div>
      </div>

      {/* Tick display */}
      <div className="p-3 bg-slate-700/20 rounded-lg">
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Tick Range:</span>
          <span className="text-white font-mono">
            {state.tickLower} → {state.tickUpper}
          </span>
        </div>
      </div>
    </div>
  );

  const renderVisual = () => (
    <div className="h-full flex flex-col">
      <h3 className="text-lg font-semibold text-white mb-4">PnL Curve</h3>

      {/* Mock PnL curve with range */}
      <div className="flex-1 flex items-center justify-center bg-slate-700/20 rounded-lg border border-slate-600/30">
        <div className="w-full max-w-lg p-4">
          <svg viewBox="0 0 400 250" className="w-full h-64">
            {/* Background grid */}
            <defs>
              <pattern id="grid" width="40" height="25" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 25" fill="none" stroke="#334155" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="400" height="250" fill="url(#grid)" />

            {/* Zero line */}
            <line x1="0" y1="125" x2="400" y2="125" stroke="#475569" strokeWidth="1" />

            {/* Range boundaries */}
            <line
              x1={100 + lowerPercent * 2}
              y1="0"
              x2={100 + lowerPercent * 2}
              y2="250"
              stroke="#3b82f6"
              strokeWidth="1"
              strokeDasharray="4"
            />
            <line
              x1={300 + upperPercent * 2}
              y1="0"
              x2={300 + upperPercent * 2}
              y2="250"
              stroke="#3b82f6"
              strokeWidth="1"
              strokeDasharray="4"
            />

            {/* PnL curve */}
            <path
              d={`M 0 200
                  L ${100 + lowerPercent * 2} 150
                  Q ${200} 100 ${300 + upperPercent * 2} 150
                  L 400 200`}
              fill="none"
              stroke="#22c55e"
              strokeWidth="2"
            />

            {/* Range fill */}
            <rect
              x={100 + lowerPercent * 2}
              y="0"
              width={(upperPercent - lowerPercent) * 2 + 200}
              height="250"
              fill="#3b82f6"
              fillOpacity="0.1"
            />

            {/* Current price */}
            <line x1="200" y1="0" x2="200" y2="250" stroke="#eab308" strokeWidth="2" />
            <circle cx="200" cy="125" r="5" fill="#eab308" />

            {/* Labels */}
            <text x="10" y="240" fill="#94a3b8" fontSize="11">Lower</text>
            <text x="185" y="240" fill="#eab308" fontSize="11">Current</text>
            <text x="360" y="240" fill="#94a3b8" fontSize="11">Upper</text>
            <text x="10" y="15" fill="#94a3b8" fontSize="11">PnL ({quoteToken?.symbol || 'Quote'})</text>
          </svg>
        </div>
      </div>

      {/* Range info */}
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="p-3 bg-slate-700/30 rounded-lg text-center">
          <p className="text-sm text-slate-400">Lower Bound</p>
          <p className="text-white font-medium">{lowerPercent}%</p>
        </div>
        <div className="p-3 bg-yellow-600/20 rounded-lg text-center border border-yellow-500/30">
          <p className="text-sm text-yellow-400">Current Price</p>
          <p className="text-white font-medium">$2,345.67</p>
        </div>
        <div className="p-3 bg-slate-700/30 rounded-lg text-center">
          <p className="text-sm text-slate-400">Upper Bound</p>
          <p className="text-white font-medium">+{upperPercent}%</p>
        </div>
      </div>
    </div>
  );

  const renderSummary = () => (
    <WizardSummaryPanel nextDisabled={state.tickLower >= state.tickUpper}>
      {/* APR estimate */}
      <div className="p-4 bg-green-700/20 rounded-lg border border-green-600/30">
        <p className="text-sm text-green-400">Estimated APR</p>
        <p className="text-2xl font-bold text-white">~{(37.2 * (10 / (upperPercent - lowerPercent + 1))).toFixed(1)}%</p>
        <p className="text-xs text-slate-400 mt-1">Based on 7-day pool performance</p>
      </div>
    </WizardSummaryPanel>
  );

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
