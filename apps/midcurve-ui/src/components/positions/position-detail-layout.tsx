"use client";

import type { GetUniswapV3PositionResponse, GetUniswapV3VaultPositionResponse } from "@midcurve/api-shared";
import { UniswapV3PositionDetail } from "./protocol/uniswapv3/uniswapv3-position-detail";
import { UniswapV3VaultPositionDetail } from "./protocol/uniswapv3-vault/uniswapv3-vault-position-detail";
import { AlertCircle } from "lucide-react";

type AnyPositionResponse = GetUniswapV3PositionResponse | GetUniswapV3VaultPositionResponse;

interface PositionDetailLayoutProps {
  position: AnyPositionResponse;
}

export function PositionDetailLayout({ position }: PositionDetailLayoutProps) {
  // Protocol-agnostic dispatcher
  switch (position.protocol) {
    case "uniswapv3":
      return (
        <UniswapV3PositionDetail
          position={position as GetUniswapV3PositionResponse}
        />
      );

    case "uniswapv3-vault":
      return (
        <UniswapV3VaultPositionDetail
          position={position as GetUniswapV3VaultPositionResponse}
        />
      );

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
              Position details for protocol &quot;{(position as AnyPositionResponse).protocol}&quot; are not
              yet supported.
            </p>
          </div>
        </div>
      );
  }
}
