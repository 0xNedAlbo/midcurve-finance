/**
 * Open Hyperliquid Hedge Hook
 *
 * Orchestrates the 5-step flow to open a hedge position on Hyperliquid:
 * 1. Prepare Subaccount - Create or reuse existing
 * 2. Fund Subaccount - Transfer margin + 2% buffer
 * 3. Place Order - Submit market order (IOC)
 * 4. Monitor Execution - Poll until filled
 * 5. Complete - Signal success for UI update
 */

"use client";

import { useState, useCallback, useRef } from "react";
import {
  useHyperliquidClient,
  HyperliquidError,
  UserRejectedError,
  type PlaceOrderResult,
} from "./useHyperliquidClient";

// ============ Types ============

export type HedgeStep =
  | "idle"
  | "preparing_subaccount"
  | "funding_subaccount"
  | "placing_order"
  | "monitoring_order"
  | "complete";

export interface OpenHedgeParams {
  positionHash: string;
  coin: string; // e.g., "ETH"
  hedgeSize: string; // e.g., "1.5" (always positive)
  leverage: number;
  notionalValueUsd: number;
  markPrice: number;
}

export interface HedgeStepStatus {
  isComplete: boolean;
  isLoading: boolean;
  error: Error | null;
}

export interface UseOpenHyperliquidHedgeResult {
  // Current state
  currentStep: HedgeStep;
  isRunning: boolean;
  isComplete: boolean;

  // Step statuses
  prepareSubaccountStatus: HedgeStepStatus;
  fundSubaccountStatus: HedgeStepStatus;
  placeOrderStatus: HedgeStepStatus;
  monitorOrderStatus: HedgeStepStatus;

  // Results
  subaccountAddress: `0x${string}` | null;
  orderId: number | null;
  fillPrice: string | null;
  fillSize: string | null;
  marginTransferred: string | null;

  // Actions
  start: (params: OpenHedgeParams) => Promise<void>;
  reset: () => void;
  retry: () => Promise<void>;
}

// Polling configuration
const POLL_CONFIG = {
  fastPhaseMs: 5000,
  fastIntervalMs: 500,
  normalIntervalMs: 1000,
  timeoutMs: 30000,
};

// Margin buffer (2%)
const MARGIN_BUFFER = 1.02;

// ============ Hook ============

export function useOpenHyperliquidHedge(): UseOpenHyperliquidHedgeResult {
  const hlClient = useHyperliquidClient();

  // State
  const [currentStep, setCurrentStep] = useState<HedgeStep>("idle");
  const [isRunning, setIsRunning] = useState(false);

  // Step statuses
  const [prepareStatus, setPrepareStatus] = useState<HedgeStepStatus>({
    isComplete: false,
    isLoading: false,
    error: null,
  });
  const [fundStatus, setFundStatus] = useState<HedgeStepStatus>({
    isComplete: false,
    isLoading: false,
    error: null,
  });
  const [orderStatus, setOrderStatus] = useState<HedgeStepStatus>({
    isComplete: false,
    isLoading: false,
    error: null,
  });
  const [monitorStatus, setMonitorStatus] = useState<HedgeStepStatus>({
    isComplete: false,
    isLoading: false,
    error: null,
  });

  // Results
  const [subaccountAddress, setSubaccountAddress] = useState<`0x${string}` | null>(null);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [fillPrice, setFillPrice] = useState<string | null>(null);
  const [fillSize, setFillSize] = useState<string | null>(null);
  const [marginTransferred, setMarginTransferred] = useState<string | null>(null);

  // Store params for retry
  const paramsRef = useRef<OpenHedgeParams | null>(null);

  // Reset all state
  const reset = useCallback(() => {
    setCurrentStep("idle");
    setIsRunning(false);
    setPrepareStatus({ isComplete: false, isLoading: false, error: null });
    setFundStatus({ isComplete: false, isLoading: false, error: null });
    setOrderStatus({ isComplete: false, isLoading: false, error: null });
    setMonitorStatus({ isComplete: false, isLoading: false, error: null });
    setSubaccountAddress(null);
    setOrderId(null);
    setFillPrice(null);
    setFillSize(null);
    setMarginTransferred(null);
    paramsRef.current = null;
  }, []);

  // Step 1: Prepare subaccount
  const prepareSubaccount = useCallback(
    async (positionHash: string): Promise<`0x${string}`> => {
      setCurrentStep("preparing_subaccount");
      setPrepareStatus({ isComplete: false, isLoading: true, error: null });

      try {
        const address = await hlClient.prepareSubaccount(positionHash);
        setSubaccountAddress(address);
        setPrepareStatus({ isComplete: true, isLoading: false, error: null });
        return address;
      } catch (error) {
        const err = error instanceof Error ? error : new Error("Unknown error");
        setPrepareStatus({ isComplete: false, isLoading: false, error: err });
        throw error;
      }
    },
    [hlClient]
  );

  // Step 2: Fund subaccount
  const fundSubaccount = useCallback(
    async (
      subAccountAddr: `0x${string}`,
      notionalValueUsd: number,
      leverage: number
    ): Promise<string> => {
      setCurrentStep("funding_subaccount");
      setFundStatus({ isComplete: false, isLoading: true, error: null });

      try {
        // Calculate required margin with buffer
        const requiredMargin = (notionalValueUsd / leverage) * MARGIN_BUFFER;
        const marginStr = requiredMargin.toFixed(2);

        // Check main account balance first
        const mainState = await hlClient.getMainAccountState();
        const availableBalance = parseFloat(mainState.withdrawable);

        if (availableBalance < requiredMargin) {
          throw new HyperliquidError(
            `Insufficient balance: need $${marginStr} but only have $${availableBalance.toFixed(2)} available`
          );
        }

        // Transfer to subaccount
        await hlClient.transferUsd(subAccountAddr, marginStr, true);

        setMarginTransferred(marginStr);
        setFundStatus({ isComplete: true, isLoading: false, error: null });
        return marginStr;
      } catch (error) {
        const err = error instanceof Error ? error : new Error("Unknown error");
        setFundStatus({ isComplete: false, isLoading: false, error: err });
        throw error;
      }
    },
    [hlClient]
  );

  // Step 3: Place order
  const placeOrder = useCallback(
    async (
      subAccountAddr: `0x${string}`,
      coin: string,
      hedgeSize: string,
      markPrice: number
    ): Promise<PlaceOrderResult> => {
      setCurrentStep("placing_order");
      setOrderStatus({ isComplete: false, isLoading: true, error: null });

      try {
        // Use aggressive price for short: 1% below mark price
        // This ensures IOC order fills immediately
        const aggressivePrice = (markPrice * 0.99).toFixed(2);

        const result = await hlClient.placeOrder({
          subAccountAddress: subAccountAddr,
          coin,
          size: hedgeSize,
          isBuy: false, // Short position
          price: aggressivePrice,
          reduceOnly: false,
        });

        setOrderId(result.orderId);

        if (result.status === "filled") {
          // Immediately filled
          setFillPrice(result.avgPrice ?? null);
          setFillSize(result.filledSize ?? null);
          setOrderStatus({ isComplete: true, isLoading: false, error: null });
        } else {
          // Resting order (unlikely for IOC but handle it)
          setOrderStatus({ isComplete: true, isLoading: false, error: null });
        }

        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error("Unknown error");
        setOrderStatus({ isComplete: false, isLoading: false, error: err });
        throw error;
      }
    },
    [hlClient]
  );

  // Step 4: Monitor order execution
  const monitorOrder = useCallback(
    async (
      subAccountAddr: `0x${string}`,
      oid: number,
      coin: string
    ): Promise<void> => {
      setCurrentStep("monitoring_order");
      setMonitorStatus({ isComplete: false, isLoading: true, error: null });

      const startTime = Date.now();

      try {
        while (Date.now() - startTime < POLL_CONFIG.timeoutMs) {
          // Check order status
          const status = await hlClient.getOrderStatus(subAccountAddr, oid);

          if (status.found && status.status === "filled") {
            setFillSize(status.filledSize ?? null);
            setMonitorStatus({ isComplete: true, isLoading: false, error: null });
            return;
          }

          if (status.found && status.status === "canceled") {
            throw new HyperliquidError(
              "Order was cancelled. Market may have moved. Please retry."
            );
          }

          // Determine poll interval
          const elapsed = Date.now() - startTime;
          const interval =
            elapsed < POLL_CONFIG.fastPhaseMs
              ? POLL_CONFIG.fastIntervalMs
              : POLL_CONFIG.normalIntervalMs;

          await new Promise((resolve) => setTimeout(resolve, interval));
        }

        // Timeout - check position state as fallback
        const state = await hlClient.getSubAccountState(subAccountAddr);
        const position = state.positions.find((p) => p.coin === coin);

        if (position && parseFloat(position.size) !== 0) {
          // Position exists - order must have filled
          setFillSize(Math.abs(parseFloat(position.size)).toString());
          setFillPrice(position.entryPrice);
          setMonitorStatus({ isComplete: true, isLoading: false, error: null });
          return;
        }

        // True timeout
        throw new HyperliquidError(
          "Order status unknown after 30 seconds. Please check Hyperliquid manually."
        );
      } catch (error) {
        const err = error instanceof Error ? error : new Error("Unknown error");
        setMonitorStatus({ isComplete: false, isLoading: false, error: err });
        throw error;
      }
    },
    [hlClient]
  );

  // Main start function
  const start = useCallback(
    async (params: OpenHedgeParams): Promise<void> => {
      if (isRunning) {
        throw new Error("Hedge opening already in progress");
      }

      if (!hlClient.isReady) {
        throw new Error("Wallet not connected");
      }

      paramsRef.current = params;
      setIsRunning(true);

      try {
        // Step 1: Prepare subaccount
        const subAddr = await prepareSubaccount(params.positionHash);

        // Step 2: Fund subaccount
        await fundSubaccount(subAddr, params.notionalValueUsd, params.leverage);

        // Step 3: Place order
        const orderResult = await placeOrder(
          subAddr,
          params.coin,
          params.hedgeSize,
          params.markPrice
        );

        // Step 4: Monitor if not immediately filled
        if (orderResult.status === "resting") {
          await monitorOrder(subAddr, orderResult.orderId, params.coin);
        }

        // Step 5: Complete
        setCurrentStep("complete");
      } catch (error) {
        // Don't set isRunning to false on user rejection - they can retry
        if (!(error instanceof UserRejectedError)) {
          // Keep isRunning true so retry is available
        }
        throw error;
      }
    },
    [
      isRunning,
      hlClient.isReady,
      prepareSubaccount,
      fundSubaccount,
      placeOrder,
      monitorOrder,
    ]
  );

  // Retry from current failed step
  const retry = useCallback(async (): Promise<void> => {
    const params = paramsRef.current;
    if (!params) {
      throw new Error("No params to retry with");
    }

    try {
      // Determine which step failed and retry from there
      if (prepareStatus.error) {
        // Retry from step 1
        const subAddr = await prepareSubaccount(params.positionHash);
        await fundSubaccount(subAddr, params.notionalValueUsd, params.leverage);
        const orderResult = await placeOrder(
          subAddr,
          params.coin,
          params.hedgeSize,
          params.markPrice
        );
        if (orderResult.status === "resting") {
          await monitorOrder(subAddr, orderResult.orderId, params.coin);
        }
        setCurrentStep("complete");
      } else if (fundStatus.error && subaccountAddress) {
        // Retry from step 2
        await fundSubaccount(
          subaccountAddress,
          params.notionalValueUsd,
          params.leverage
        );
        const orderResult = await placeOrder(
          subaccountAddress,
          params.coin,
          params.hedgeSize,
          params.markPrice
        );
        if (orderResult.status === "resting") {
          await monitorOrder(subaccountAddress, orderResult.orderId, params.coin);
        }
        setCurrentStep("complete");
      } else if (orderStatus.error && subaccountAddress) {
        // Retry from step 3
        const orderResult = await placeOrder(
          subaccountAddress,
          params.coin,
          params.hedgeSize,
          params.markPrice
        );
        if (orderResult.status === "resting") {
          await monitorOrder(subaccountAddress, orderResult.orderId, params.coin);
        }
        setCurrentStep("complete");
      } else if (monitorStatus.error && subaccountAddress && orderId) {
        // Retry from step 4
        await monitorOrder(subaccountAddress, orderId, params.coin);
        setCurrentStep("complete");
      }
    } catch {
      // Error already set in step function
    }
  }, [
    prepareStatus.error,
    fundStatus.error,
    orderStatus.error,
    monitorStatus.error,
    subaccountAddress,
    orderId,
    prepareSubaccount,
    fundSubaccount,
    placeOrder,
    monitorOrder,
  ]);

  return {
    currentStep,
    isRunning,
    isComplete: currentStep === "complete",

    prepareSubaccountStatus: prepareStatus,
    fundSubaccountStatus: fundStatus,
    placeOrderStatus: orderStatus,
    monitorOrderStatus: monitorStatus,

    subaccountAddress,
    orderId,
    fillPrice,
    fillSize,
    marginTransferred,

    start,
    reset,
    retry,
  };
}
