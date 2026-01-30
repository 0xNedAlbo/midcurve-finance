import { useState } from 'react';
import { FullPageWizardLayout } from '@/components/layout/wizard';

const WIZARD_STEPS = [
  { id: 'pool', label: 'Select Pool' },
  { id: 'range', label: 'Set Range' },
  { id: 'amount', label: 'Enter Amount' },
  { id: 'review', label: 'Review' },
];

export function WizardExamplePage() {
  const [currentStep, setCurrentStep] = useState(0);

  const handleNext = () => {
    if (currentStep < WIZARD_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <FullPageWizardLayout
      title="Create Uniswap V3 Position"
      steps={WIZARD_STEPS}
      currentStep={currentStep}
      interactiveContent={
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">Search Pools</h3>

          <div className="flex items-center gap-4">
            <label className="text-slate-400 w-32 shrink-0">First Token:</label>
            <input
              type="text"
              placeholder="WETH"
              className="flex-1 px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="text-slate-400 w-32 shrink-0">Second Token:</label>
            <input
              type="text"
              placeholder="USDC"
              className="flex-1 px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="text-slate-400 w-32 shrink-0">Chains:</label>
            <div className="flex-1 px-4 py-2 bg-blue-600/20 border border-blue-500/50 rounded-lg text-blue-300">
              Ethereum, Arbitrum, Base
            </div>
          </div>
        </div>
      }
      visualContent={
        <div className="h-full flex flex-col">
          <h3 className="text-lg font-semibold text-white mb-4">Visual Content</h3>
          <p className="text-slate-400 mb-4">
            This area is for tables, charts, previews, etc.
          </p>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="pb-3 text-slate-400 font-medium">Pool</th>
                  <th className="pb-3 text-slate-400 font-medium">TVL</th>
                  <th className="pb-3 text-slate-400 font-medium">Fees 7D</th>
                  <th className="pb-3 text-slate-400 font-medium">~APR 7D</th>
                </tr>
              </thead>
              <tbody className="text-white">
                <tr className="border-b border-slate-700/50">
                  <td className="py-3">Arbitrum, WETH/USDC, 0.05%</td>
                  <td className="py-3">$124.5M</td>
                  <td className="py-3">$892K</td>
                  <td className="py-3 text-green-400">37.2%</td>
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="py-3">Ethereum, WETH/USDC, 0.05%</td>
                  <td className="py-3">$312.1M</td>
                  <td className="py-3">$1.2M</td>
                  <td className="py-3 text-green-400">19.8%</td>
                </tr>
                <tr className="border-b border-slate-700/50">
                  <td className="py-3">Base, WETH/USDC, 0.05%</td>
                  <td className="py-3">$89.3M</td>
                  <td className="py-3">$421K</td>
                  <td className="py-3 text-green-400">24.5%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      }
      summaryContent={
        <div className="h-full flex flex-col">
          <h3 className="text-lg font-semibold text-white mb-4">Summary</h3>

          <div className="flex-1 space-y-4">
            <div className="p-4 bg-slate-700/30 rounded-lg">
              <p className="text-sm text-slate-400">Current Step</p>
              <p className="text-white font-medium">
                {WIZARD_STEPS[currentStep].label}
              </p>
            </div>

            <div className="p-4 bg-slate-700/30 rounded-lg">
              <p className="text-sm text-slate-400">Selected Chain</p>
              <p className="text-white font-medium">Arbitrum</p>
            </div>

            <div className="p-4 bg-slate-700/30 rounded-lg">
              <p className="text-sm text-slate-400">Token Pair</p>
              <p className="text-white font-medium">WETH / USDC</p>
            </div>

            <div className="p-4 bg-slate-700/30 rounded-lg">
              <p className="text-sm text-slate-400">Fee Tier</p>
              <p className="text-white font-medium">0.05%</p>
            </div>
          </div>

          {/* Navigation buttons */}
          <div className="flex gap-3 mt-6 pt-4 border-t border-slate-700/50">
            <button
              onClick={handleBack}
              disabled={currentStep === 0}
              className="flex-1 px-4 py-2 text-sm font-medium text-slate-300 bg-slate-700/50 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Back
            </button>
            <button
              onClick={handleNext}
              disabled={currentStep === WIZARD_STEPS.length - 1}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {currentStep === WIZARD_STEPS.length - 1 ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      }
    />
  );
}
