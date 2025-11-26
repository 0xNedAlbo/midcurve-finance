"use client";

import type { GetUniswapV3PositionResponse } from "@midcurve/api-shared";
import { tickToPrice } from "@midcurve/shared";
import { HedgeTab } from "@/components/positions/hedging";
import { useHedgeEligibility } from "@/hooks/hedges/useHedgeEligibility";

interface UniswapV3HedgingTabProps {
  position: GetUniswapV3PositionResponse;
}

/**
 * Maps on-chain token symbols to their economic risk asset equivalents.
 * The risk layer abstracts specific tokens (WETH, stETH) to their underlying
 * economic exposure (ETH) for consistent hedge market selection.
 */
function getRiskAssetSymbol(tokenSymbol: string): string {
  // ETH variants
  if (["WETH", "stETH", "cbETH", "wstETH", "rETH"].includes(tokenSymbol)) return "ETH";
  // BTC variants
  if (["WBTC", "tBTC", "cbBTC"].includes(tokenSymbol)) return "BTC";
  // USD stablecoins
  if (["USDC", "USDT", "DAI", "FRAX", "BUSD", "TUSD"].includes(tokenSymbol)) return "USD";
  // EUR stablecoins
  if (["EURS", "EURT"].includes(tokenSymbol)) return "EUR";
  // Fallback: return original symbol
  return tokenSymbol;
}

export function UniswapV3HedgingTab({ position }: UniswapV3HedgingTabProps) {
  // Determine quote and base tokens
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;
  const baseToken = position.isToken0Quote
    ? position.pool.token1
    : position.pool.token0;

  // Get current pool price from tick
  const poolState = position.pool.state as { currentTick: number };
  const baseTokenConfig = baseToken.config as { address: string };
  const quoteTokenConfig = quoteToken.config as { address: string };

  // Calculate current price using tickToPrice (returns bigint in quote token units with quote decimals)
  const currentPriceBigInt = tickToPrice(
    poolState.currentTick,
    baseTokenConfig.address,
    quoteTokenConfig.address,
    baseToken.decimals
  );
  // Convert to number for calculations
  const currentPrice = Number(currentPriceBigInt) / Math.pow(10, quoteToken.decimals);

  // Calculate base asset amount from position
  // For Uniswap V3, we need to derive this from position value and price
  // Using simplified calculation: baseAssetAmount ≈ currentValue / currentPrice (for positions in range)
  // This is a rough estimate - actual calculation should come from the position state
  const currentValueNum = parseFloat(position.currentValue) / Math.pow(10, quoteToken.decimals);
  const estimatedBaseAmount = currentPrice > 0
    ? (currentValueNum / currentPrice) * Math.pow(10, baseToken.decimals)
    : 0;
  const baseAssetAmount = BigInt(Math.floor(estimatedBaseAmount));

  // Extract PnL values
  const positionUnrealizedPnl = BigInt(position.currentValue) - BigInt(position.currentCostBasis) + BigInt(position.unClaimedFees);
  const positionRealizedPnl = BigInt(position.realizedPnl) + BigInt(position.collectedFees);

  // Check hedge eligibility via API
  const {
    data: eligibility,
    isLoading: isLoadingEligibility,
    error: eligibilityError,
  } = useHedgeEligibility(position.positionHash);

  // Use API response for risk symbols if available, fallback to local mapping
  const riskBaseSymbol = eligibility?.riskView.riskBase ?? getRiskAssetSymbol(baseToken.symbol);
  const riskQuoteSymbol = eligibility?.riskView.riskQuote ?? getRiskAssetSymbol(quoteToken.symbol);

  return (
    <HedgeTab
      baseAssetAmount={baseAssetAmount}
      baseAssetDecimals={baseToken.decimals}
      baseAssetSymbol={baseToken.symbol}
      quoteTokenSymbol={quoteToken.symbol}
      quoteTokenDecimals={quoteToken.decimals}
      riskBaseSymbol={riskBaseSymbol}
      riskQuoteSymbol={riskQuoteSymbol}
      currentPrice={currentPrice}
      positionUnrealizedPnl={positionUnrealizedPnl}
      positionRealizedPnl={positionRealizedPnl}
      hedge={null} // No hedge for now - will be fetched from API later
      ledgerEvents={[]}
      isLoading={isLoadingEligibility}
      // Eligibility info from API
      eligibility={eligibility ?? undefined}
      eligibilityError={eligibilityError ?? undefined}
    />
  );
}
