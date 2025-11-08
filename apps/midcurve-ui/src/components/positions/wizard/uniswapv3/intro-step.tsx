"use client";

import { Target, TrendingUp, Shield, BarChart3 } from "lucide-react";

export function IntroStep() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center space-y-4">
        <h3 className="text-2xl font-bold text-white">
          Create Uniswap V3 Position
        </h3>
        <p className="text-slate-300 text-lg leading-relaxed">
          Follow our step-by-step wizard to plan and open a concentrated
          liquidity position
        </p>
      </div>

      {/* Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <Target className="w-6 h-6 text-blue-400" />
            <h4 className="font-semibold text-white">Plan Your Position</h4>
          </div>
          <p className="text-slate-400 text-sm">
            Select price range, configure liquidity, and preview returns
          </p>
        </div>

        <div className="bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <TrendingUp className="w-6 h-6 text-green-400" />
            <h4 className="font-semibold text-white">Visualize Risk</h4>
          </div>
          <p className="text-slate-400 text-sm">
            Analyze PnL curve and understand your exposure
          </p>
        </div>

        <div className="bg-slate-800/30 backdrop-blur-sm border border-slate-700/50 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <Shield className="w-6 h-6 text-orange-400" />
            <h4 className="font-semibold text-white">Risk Management</h4>
          </div>
          <p className="text-slate-400 text-sm">
            Set stop-loss levels and manage position risk
          </p>
        </div>
      </div>

      {/* Process Steps */}
      <div className="bg-slate-800/20 backdrop-blur-sm border border-slate-700/30 rounded-lg p-6">
        <h4 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-400" />
          How it works
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-blue-600 text-white text-xs font-bold rounded-full flex items-center justify-center">
              1
            </div>
            <span className="text-slate-300 text-sm">Select Chain</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-blue-600 text-white text-xs font-bold rounded-full flex items-center justify-center">
              2
            </div>
            <span className="text-slate-300 text-sm">Choose Tokens</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-blue-600 text-white text-xs font-bold rounded-full flex items-center justify-center">
              3
            </div>
            <span className="text-slate-300 text-sm">Pick Pool</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-blue-600 text-white text-xs font-bold rounded-full flex items-center justify-center">
              4
            </div>
            <span className="text-slate-300 text-sm">
              Configure Position
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
