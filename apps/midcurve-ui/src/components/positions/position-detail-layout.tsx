"use client";

import type { GetUniswapV3PositionResponse } from "@midcurve/api-shared";
import { UniswapV3PositionDetail } from "./protocol/uniswapv3/uniswapv3-position-detail";
import { AlertCircle } from "lucide-react";

interface PositionDetailLayoutProps {
  position: GetUniswapV3PositionResponse; // Expand union type when adding more protocols
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function PositionDetailLayout({ position, onRefresh, isRefreshing }: PositionDetailLayoutProps) {
  // Protocol-agnostic dispatcher
  switch (position.protocol) {
    case "uniswapv3":
      return (
        <UniswapV3PositionDetail
          position={position}
          onRefresh={onRefresh}
          isRefreshing={isRefreshing}
        />
      );

    // Future protocols can be added here:
    // case "orca":
    //   return <OrcaPositionDetail position={position} />;
    // case "raydium":
    //   return <RaydiumPositionDetail position={position} />;

    default:
      return (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <div className="p-4 bg-red-500/20 rounded-full">
                <AlertCircle className="w-12 h-12 text-red-400" />
              </div>
            </div>
            <h3 className="text-xl font-semibold text-white">
              Unsupported Protocol
            </h3>
            <p className="text-slate-400 max-w-md">
              Position details for protocol &quot;{position.protocol}&quot; are not
              yet supported.
            </p>
          </div>
        </div>
      );
  }
}
