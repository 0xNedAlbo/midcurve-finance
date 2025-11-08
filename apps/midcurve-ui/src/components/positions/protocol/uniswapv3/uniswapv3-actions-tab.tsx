"use client";

import { Activity } from "lucide-react";
import type { GetUniswapV3PositionResponse } from "@midcurve/api-shared";

interface UniswapV3ActionsTabProps {
  position: GetUniswapV3PositionResponse;
}

export function UniswapV3ActionsTab({}: UniswapV3ActionsTabProps) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="p-4 bg-slate-800/50 rounded-full">
            <Activity className="w-12 h-12 text-slate-400" />
          </div>
        </div>
        <h3 className="text-xl font-semibold text-white">Actions Coming Soon</h3>
        <p className="text-slate-400 max-w-md">
          Position actions and transaction history will be available here.
        </p>
      </div>
    </div>
  );
}
