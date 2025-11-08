"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { PencilLine, PencilOff, RefreshCw } from "lucide-react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { TokenAmountInput } from "./shared/token-amount-input";
import type { UniswapV3Pool, Erc20Token } from "@midcurve/shared";
import { getTokenAmountsFromLiquidity } from "@midcurve/shared";
import { formatCompactValue } from "@/lib/fraction-format";
import type { EvmChainSlug } from "@/config/chains";
import { usePositionSizeCalculation } from "@/hooks/positions/uniswapv3/wizard/usePositionSizeCalculation";

interface PositionSizeConfigProps {
  pool: UniswapV3Pool;
  baseToken: Erc20Token;
  quoteToken: Erc20Token;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint; // Current liquidity value from parent/URL
  onLiquidityChange: (liquidity: bigint) => void;
  initialMode?: "quote" | "base" | "matched" | "independent";
  chain?: EvmChainSlug;
  onRefreshPool?: () => Promise<unknown>;
  label?: string; // Custom label for the header (default: "Position Size:")
}

type InputMode = "quote" | "base" | "matched" | "independent";

export function PositionSizeConfig({
  pool,
  baseToken,
  quoteToken,
  tickLower,
  tickUpper,
  liquidity,
  onLiquidityChange,
  initialMode = "independent",
  chain,
  onRefreshPool,
  label = "Position Size:",
}: PositionSizeConfigProps) {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [mode, setMode] = useState<InputMode>(initialMode);
  const [baseAmount, setBaseAmount] = useState<string>("0");
  const [quoteAmount, setQuoteAmount] = useState<string>("0");
  const [baseAmountBigInt, setBaseAmountBigInt] = useState<bigint>(0n);
  const [quoteAmountBigInt, setQuoteAmountBigInt] = useState<bigint>(0n);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastEditedField, setLastEditedField] = useState<"base" | "quote" | null>(null);

  // Use the position size calculation hook
  const positionCalculation = usePositionSizeCalculation({
    baseAmount: baseAmountBigInt,
    quoteAmount: quoteAmountBigInt,
    baseToken,
    quoteToken,
    pool,
    tickLower,
    tickUpper,
  });

  // Initialize input fields from liquidity prop when component first loads
  useEffect(() => {
    if (!isInitialized && liquidity > 0n && pool.state.sqrtPriceX96) {
      try {
        const { token0Amount, token1Amount } = getTokenAmountsFromLiquidity(
          liquidity,
          BigInt(pool.state.sqrtPriceX96),
          tickLower,
          tickUpper
        );

        const baseTokenAmount = positionCalculation.isQuoteToken0
          ? token1Amount
          : token0Amount;
        const quoteTokenAmount = positionCalculation.isQuoteToken0
          ? token0Amount
          : token1Amount;

        // Set the amounts
        const baseAmountString = formatCompactValue(
          baseTokenAmount,
          baseToken.decimals
        );
        const quoteAmountString = formatCompactValue(
          quoteTokenAmount,
          quoteToken.decimals
        );

        setBaseAmount(baseAmountString);
        setQuoteAmount(quoteAmountString);
        setBaseAmountBigInt(baseTokenAmount);
        setQuoteAmountBigInt(quoteTokenAmount);
        setIsInitialized(true);
      } catch (error) {
        console.error("Error initializing amounts from liquidity:", error);
        setIsInitialized(true); // Still mark as initialized to prevent retry
      }
    } else if (!isInitialized && liquidity === 0n) {
      // If liquidity is 0, just mark as initialized with default values
      setIsInitialized(true);
    }
  }, [
    liquidity,
    pool.state.currentTick,
    pool.state.sqrtPriceX96,
    tickLower,
    tickUpper,
    baseToken,
    quoteToken,
    isInitialized,
    positionCalculation.isQuoteToken0,
  ]);

  // Handle base token amount change
  const handleBaseAmountChange = useCallback((value: string, valueBigInt: bigint) => {
    setBaseAmount(value);
    setBaseAmountBigInt(valueBigInt);
    setLastEditedField("base");
  }, []);

  // Handle quote token amount change
  const handleQuoteAmountChange = useCallback((value: string, valueBigInt: bigint) => {
    setQuoteAmount(value);
    setQuoteAmountBigInt(valueBigInt);
    setLastEditedField("quote");
  }, []);

  // Calculate liquidity from user input and emit to parent
  useEffect(() => {
    // Only calculate and emit changes after component is initialized
    // This prevents clearing liquidity during initial load from URL
    if (!isInitialized) return;

    const inputLiquidity = positionCalculation.liquidity;

    // Only emit change if the calculated liquidity differs from current prop
    // This prevents infinite loops when the component re-renders due to prop updates
    if (inputLiquidity !== liquidity) {
      onLiquidityChange(inputLiquidity);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    baseAmountBigInt,
    quoteAmountBigInt,
    positionCalculation.liquidity,
    liquidity,
    isInitialized,
    // Note: onLiquidityChange is intentionally omitted from deps
    // It's memoized in parent and including it causes infinite loops
  ]);

  // In matched mode, sync calculated amounts back to input fields
  useEffect(() => {
    if (!isInitialized || mode !== "matched") return;
    if (positionCalculation.liquidity === 0n) return;
    if (!lastEditedField) return; // Only sync when user has edited a field

    // Get the calculated token amounts from the hook
    const calculatedBaseAmount = positionCalculation.isQuoteToken0
      ? positionCalculation.token1Amount
      : positionCalculation.token0Amount;
    const calculatedQuoteAmount = positionCalculation.isQuoteToken0
      ? positionCalculation.token0Amount
      : positionCalculation.token1Amount;

    // Update quote field if user edited base (quote should reflect calculation)
    if (lastEditedField === "base" && calculatedQuoteAmount !== quoteAmountBigInt) {
      const quoteAmountString = formatCompactValue(calculatedQuoteAmount, quoteToken.decimals);
      setQuoteAmount(quoteAmountString);
      setQuoteAmountBigInt(calculatedQuoteAmount);
    }

    // Update base field if user edited quote (base should reflect calculation)
    if (lastEditedField === "quote" && calculatedBaseAmount !== baseAmountBigInt) {
      const baseAmountString = formatCompactValue(calculatedBaseAmount, baseToken.decimals);
      setBaseAmount(baseAmountString);
      setBaseAmountBigInt(calculatedBaseAmount);
    }
  }, [
    mode,
    isInitialized,
    positionCalculation.liquidity,
    positionCalculation.token0Amount,
    positionCalculation.token1Amount,
    positionCalculation.isQuoteToken0,
    baseToken.decimals,
    quoteToken.decimals,
    baseAmountBigInt,
    quoteAmountBigInt,
    lastEditedField,
  ]);

  // Mode change handler
  const handleModeChange = useCallback((newMode: InputMode) => {
    setMode(newMode);

    // In single-token modes, clear the other token to 0
    // This ensures the calculation treats it as a single-token investment
    if (newMode === "base") {
      // Base mode: user enters base amount, quote should be 0
      setQuoteAmount("0");
      setQuoteAmountBigInt(0n);
    } else if (newMode === "quote") {
      // Quote mode: user enters quote amount, base should be 0
      setBaseAmount("0");
      setBaseAmountBigInt(0n);
    }
    // For matched and independent modes, keep existing amounts
  }, []);

  // Refresh pool data handler
  const handleRefreshPool = useCallback(async () => {
    if (!onRefreshPool || isRefreshing) return;

    setIsRefreshing(true);
    try {
      await onRefreshPool();
    } catch (error) {
      console.error("Error refreshing pool data:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefreshPool, isRefreshing]);

  // Calculate resulting token amounts for display from calculated values
  const displayAmounts = useMemo(() => {
    if (positionCalculation.liquidity === 0n) {
      return { baseDisplay: "0", quoteDisplay: "0" };
    }

    // Use calculated amounts directly from the hook for immediate updates
    const baseTokenAmount = positionCalculation.isQuoteToken0
      ? positionCalculation.token1Amount
      : positionCalculation.token0Amount;
    const quoteTokenAmount = positionCalculation.isQuoteToken0
      ? positionCalculation.token0Amount
      : positionCalculation.token1Amount;

    return {
      baseDisplay: formatCompactValue(baseTokenAmount, baseToken.decimals),
      quoteDisplay: formatCompactValue(quoteTokenAmount, quoteToken.decimals),
    };
  }, [
    positionCalculation.liquidity,
    positionCalculation.token0Amount,
    positionCalculation.token1Amount,
    positionCalculation.isQuoteToken0,
    baseToken.decimals,
    quoteToken.decimals,
  ]);

  return (
    <div className="space-y-3">
      {/* Header with Position Size display */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-white font-medium">{label}</span>
        <div className="flex items-center gap-2">
          {onRefreshPool && (
            <button
              onClick={handleRefreshPool}
              disabled={isRefreshing}
              className="p-1 hover:bg-slate-700 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh pool price"
            >
              <RefreshCw
                className={`w-4 h-4 text-slate-400 ${
                  isRefreshing ? "animate-spin" : ""
                }`}
              />
            </button>
          )}
          <span className="text-white font-medium">
            {displayAmounts.baseDisplay} {baseToken.symbol} +{" "}
            {displayAmounts.quoteDisplay} {quoteToken.symbol}
          </span>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-slate-700 rounded transition-colors cursor-pointer"
          >
            {isExpanded ? (
              <PencilOff className="w-4 h-4 text-slate-400" />
            ) : (
              <PencilLine className="w-4 h-4 text-slate-400" />
            )}
          </button>
        </div>
      </div>

      {/* Collapsible content */}
      {isExpanded && (
        <div className="space-y-3 border-t border-slate-700 pt-3">
          {/* Mode selector buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-slate-300 text-sm font-medium">
                Your Investment
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleModeChange("base")}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                    mode === "base"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  {baseToken.symbol}
                </button>
                <button
                  onClick={() => handleModeChange("quote")}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                    mode === "quote"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  {quoteToken.symbol}
                </button>
                <button
                  onClick={() => handleModeChange("matched")}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                    mode === "matched"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  Matched
                </button>
                <button
                  onClick={() => handleModeChange("independent")}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                    mode === "independent"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
                >
                  Independent
                </button>
              </div>
            </div>

            {/* Connect wallet link */}
            {!isConnected && (
              <button
                onClick={() => openConnectModal?.()}
                className="text-blue-400 hover:text-blue-300 text-xs font-medium transition-colors cursor-pointer"
              >
                Connect Wallet
              </button>
            )}
          </div>

          {/* Conditional token inputs */}
          <div className="space-y-3">
            {/* Base token input - show in base, matched, or independent mode */}
            {(mode === "base" ||
              mode === "matched" ||
              mode === "independent") && (
              <TokenAmountInput
                token={baseToken}
                value={baseAmount}
                onChange={handleBaseAmountChange}
                chain={chain}
                placeholder="0.0"
                showMaxButton={true}
              />
            )}

            {/* Quote token input - show in quote, matched, or independent mode */}
            {(mode === "quote" ||
              mode === "matched" ||
              mode === "independent") && (
              <TokenAmountInput
                token={quoteToken}
                value={quoteAmount}
                onChange={handleQuoteAmountChange}
                chain={chain}
                placeholder="0.0"
                showMaxButton={true}
              />
            )}
          </div>

          {/* Help text */}
          <div className="text-xs text-slate-400">
            {mode === "quote" &&
              `Enter ${quoteToken.symbol} amount. ${baseToken.symbol} will be calculated automatically.`}
            {mode === "base" &&
              `Enter ${baseToken.symbol} amount. ${quoteToken.symbol} will be calculated automatically.`}
            {mode === "matched" &&
              `Enter either amount. The other will auto-match for balanced positions.`}
            {mode === "independent" &&
              `Enter both amounts independently for asymmetric positions.`}
          </div>
        </div>
      )}
    </div>
  );
}
