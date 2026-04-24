"use client";

import type { UniswapV3VaultPositionData } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition";
import type { UniswapV3VaultPositionConfigResponse } from "@midcurve/api-shared";
import { ConversionSummary } from "../uniswapv3/conversion-summary";
import { useUniswapV3VaultConversion } from "@/hooks/positions/uniswapv3-vault/useUniswapV3VaultConversion";

interface UniswapV3VaultConversionTabProps {
  position: UniswapV3VaultPositionData;
}

export function UniswapV3VaultConversionTab({ position }: UniswapV3VaultConversionTabProps) {
  const config = position.config as UniswapV3VaultPositionConfigResponse;

  const { data: summary, isLoading } = useUniswapV3VaultConversion(
    config.chainId,
    config.vaultAddress,
    config.ownerAddress,
  );

  return <ConversionSummary summary={summary ?? null} isLoading={isLoading} />;
}
