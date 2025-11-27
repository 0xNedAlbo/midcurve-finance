/**
 * Frontend Hyperliquid Client Hook
 *
 * Provides access to Hyperliquid exchange and info APIs from the frontend.
 * Uses the user's connected wallet for signing operations.
 *
 * Features:
 * - Subaccount management (create, rename, transfer)
 * - Order placement (market orders via aggressive IOC limit)
 * - Order status monitoring
 * - Read-only queries (subaccounts, clearinghouse state)
 *
 * Design:
 * - Uses wagmi's useWalletClient for signing
 * - HttpTransport with keepalive: false for Next.js compatibility
 * - Environment-aware (mainnet vs testnet)
 */

"use client";

import { useMemo, useCallback, useRef } from "react";
import { useAccount, useSwitchChain, useConfig } from "wagmi";
import { getWalletClient } from "@wagmi/core";
import { HttpTransport } from "@nktkas/hyperliquid";
import { hyperliquidL1 } from "@/lib/wagmi";
import {
  createSubAccount,
  subAccountModify,
  subAccountTransfer,
  order,
} from "@nktkas/hyperliquid/api/exchange";
import {
  subAccounts,
  clearinghouseState,
  orderStatus,
  metaAndAssetCtxs,
} from "@nktkas/hyperliquid/api/info";
import type { SubAccountsResponse } from "@nktkas/hyperliquid/api/info";
import type { ClearinghouseStateResponse } from "@nktkas/hyperliquid/api/info";
import type { WalletClient } from "viem";
import {
  type HyperliquidSubaccountInfo,
  type HyperliquidEnvironment,
  isUnusedSubaccountName,
  generateSubaccountName,
} from "@midcurve/shared";

// ============ Types ============

export interface HyperliquidClientConfig {
  environment?: HyperliquidEnvironment;
}

export interface CreateSubAccountResult {
  address: `0x${string}`;
  name: string;
}

export interface SubAccountState {
  accountValue: string;
  withdrawable: string;
  positions: Array<{
    coin: string;
    size: string;
    entryPrice: string;
    unrealizedPnl: string;
    leverage: {
      type: "isolated" | "cross";
      value: number;
    };
  }>;
}

export interface PlaceOrderParams {
  subAccountAddress: `0x${string}`;
  coin: string;
  size: string; // Positive for size (side determined by isBuy)
  isBuy: boolean; // true = long, false = short
  price: string; // Limit price (use aggressive price for market-like)
  reduceOnly?: boolean;
}

export interface PlaceOrderResult {
  orderId: number;
  status: "resting" | "filled";
  filledSize?: string;
  avgPrice?: string;
}

export interface OrderStatusResult {
  found: boolean;
  status?: "open" | "filled" | "canceled" | "unknown";
  filledSize?: string;
  avgPrice?: string;
}

export interface MarketMetadata {
  coin: string;
  assetIndex: number;
  maxLeverage: number;
  szDecimals: number;
  markPx: string;
  fundingRate: string;
  onlyIsolated: boolean;
}

// ============ Errors ============

export class HyperliquidError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "HyperliquidError";
  }
}

export class UserRejectedError extends HyperliquidError {
  constructor() {
    super("User rejected the transaction");
    this.name = "UserRejectedError";
  }
}

export class InsufficientBalanceError extends HyperliquidError {
  constructor(required: string, available: string) {
    super(
      `Insufficient balance: need ${required} USD but only have ${available} USD`
    );
    this.name = "InsufficientBalanceError";
  }
}

// ============ Hook ============

export interface UseHyperliquidClientResult {
  // State
  isReady: boolean;
  walletAddress: `0x${string}` | undefined;

  // Subaccount Operations
  createSubAccount: (name: string) => Promise<CreateSubAccountResult>;
  renameSubAccount: (
    subAccountAddress: `0x${string}`,
    newName: string
  ) => Promise<void>;
  transferUsd: (
    subAccountAddress: `0x${string}`,
    amountUsd: string,
    isDeposit: boolean
  ) => Promise<void>;

  // Info Operations
  getSubAccounts: () => Promise<HyperliquidSubaccountInfo[]>;
  findUnusedSubAccounts: () => Promise<HyperliquidSubaccountInfo[]>;
  getSubAccountState: (
    subAccountAddress: `0x${string}`
  ) => Promise<SubAccountState>;
  getMainAccountState: () => Promise<SubAccountState>;

  // Order Operations
  placeOrder: (params: PlaceOrderParams) => Promise<PlaceOrderResult>;
  getOrderStatus: (
    userAddress: `0x${string}`,
    orderId: number
  ) => Promise<OrderStatusResult>;

  // Market Data
  getMarketMetadata: (coin: string) => Promise<MarketMetadata | null>;

  // Utilities
  prepareSubaccount: (positionHash: string) => Promise<`0x${string}`>;
}

// Hyperliquid requires chain ID 1337 for L1 action signatures
// This is a Hyperliquid-specific requirement - the wallet must be switched to this chain for signing
const HYPERLIQUID_CHAIN_ID = hyperliquidL1.id; // 1337

/**
 * Hook for interacting with Hyperliquid from the frontend
 */
export function useHyperliquidClient(
  hookConfig: HyperliquidClientConfig = {}
): UseHyperliquidClientResult {
  const { environment = "mainnet" } = hookConfig;
  const wagmiConfig = useConfig();
  const { address: walletAddress, isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  // Track original chain to restore after signing
  const originalChainIdRef = useRef<number | null>(null);

  // Create transport (memoized)
  const transport = useMemo(() => {
    return new HttpTransport({
      isTestnet: environment === "testnet",
      fetchOptions: { keepalive: false },
    });
  }, [environment]);

  // Check if client is ready for operations
  const isReady = isConnected && !!walletAddress;

  // Helper to get a fresh wallet client for Hyperliquid signing
  // This ensures we get a wallet client configured for chainId 1337
  const getHyperliquidWallet = useCallback(async (): Promise<WalletClient> => {
    if (!isConnected) {
      throw new HyperliquidError("Wallet not connected");
    }

    // Get a fresh wallet client for the Hyperliquid chain
    // This is crucial because the SDK requires chainId 1337 in the EIP-712 domain
    // We cast to 'never' to work around strict type checking between different viem versions
    const client = await getWalletClient(wagmiConfig as never, {
      chainId: HYPERLIQUID_CHAIN_ID,
    });

    if (!client) {
      throw new HyperliquidError("Failed to get wallet client for Hyperliquid");
    }

    return client as WalletClient;
  }, [isConnected, wagmiConfig]);

  // Helper to extract error message including cause chain
  const getFullErrorMessage = useCallback((error: unknown): string => {
    if (!(error instanceof Error)) {
      return String(error);
    }

    const messages: string[] = [error.message];
    let currentError: unknown = error.cause;

    // Walk the cause chain (up to 5 levels to prevent infinite loops)
    for (let i = 0; i < 5 && currentError; i++) {
      if (currentError instanceof Error) {
        messages.push(currentError.message);
        currentError = currentError.cause;
      } else if (typeof currentError === "string") {
        messages.push(currentError);
        break;
      } else {
        messages.push(String(currentError));
        break;
      }
    }

    return messages.join(" → ");
  }, []);

  // Helper to detect user rejection (check error and all causes)
  const isUserRejection = useCallback((error: unknown): boolean => {
    const checkError = (err: unknown): boolean => {
      if (err instanceof Error) {
        const message = err.message.toLowerCase();
        if (
          message.includes("user rejected") ||
          message.includes("user denied") ||
          message.includes("rejected by user") ||
          message.includes("user refused") ||
          message.includes("action_rejected")
        ) {
          return true;
        }
        // Check the cause recursively
        if (err.cause) {
          return checkError(err.cause);
        }
      }
      return false;
    };
    return checkError(error);
  }, []);

  // Helper to switch to Hyperliquid chain for signing
  const switchToHyperliquid = useCallback(async (): Promise<void> => {
    if (chainId !== HYPERLIQUID_CHAIN_ID) {
      // Store original chain to restore later
      originalChainIdRef.current = chainId ?? null;
      try {
        await switchChainAsync({ chainId: HYPERLIQUID_CHAIN_ID });
      } catch (error) {
        throw new HyperliquidError(
          `Failed to switch to Hyperliquid network for signing: ${getFullErrorMessage(error)}`
        );
      }
    }
  }, [chainId, switchChainAsync, getFullErrorMessage]);

  // Helper to restore original chain after signing
  const restoreOriginalChain = useCallback(async (): Promise<void> => {
    if (originalChainIdRef.current && originalChainIdRef.current !== HYPERLIQUID_CHAIN_ID) {
      try {
        await switchChainAsync({ chainId: originalChainIdRef.current });
      } catch {
        // Silently fail - user can manually switch back
        console.warn("Failed to restore original chain, user may need to switch manually");
      }
      originalChainIdRef.current = null;
    }
  }, [switchChainAsync]);

  // ============ Subaccount Operations ============

  const createSubAccountFn = useCallback(
    async (name: string): Promise<CreateSubAccountResult> => {
      // Switch to Hyperliquid chain for signing
      await switchToHyperliquid();

      try {
        // Get a fresh wallet client configured for chainId 1337
        const wallet = await getHyperliquidWallet();

        const result = await createSubAccount(
          {
            transport,
            wallet: wallet as never,
          },
          { name }
        );

        // Restore original chain after successful signing
        await restoreOriginalChain();

        return {
          address: result.response.data,
          name,
        };
      } catch (error) {
        // Restore original chain even on error
        await restoreOriginalChain();

        if (isUserRejection(error)) {
          throw new UserRejectedError();
        }
        throw new HyperliquidError(
          `Failed to create subaccount: ${getFullErrorMessage(error)}`
        );
      }
    },
    [transport, getHyperliquidWallet, switchToHyperliquid, restoreOriginalChain, isUserRejection, getFullErrorMessage]
  );

  const renameSubAccountFn = useCallback(
    async (
      subAccountAddress: `0x${string}`,
      newName: string
    ): Promise<void> => {
      // Switch to Hyperliquid chain for signing
      await switchToHyperliquid();

      try {
        // Get a fresh wallet client configured for chainId 1337
        const wallet = await getHyperliquidWallet();

        await subAccountModify(
          {
            transport,
            wallet: wallet as never,
          },
          { subAccountUser: subAccountAddress, name: newName }
        );

        // Restore original chain after successful signing
        await restoreOriginalChain();
      } catch (error) {
        // Restore original chain even on error
        await restoreOriginalChain();

        if (isUserRejection(error)) {
          throw new UserRejectedError();
        }
        throw new HyperliquidError(
          `Failed to rename subaccount: ${getFullErrorMessage(error)}`
        );
      }
    },
    [transport, getHyperliquidWallet, switchToHyperliquid, restoreOriginalChain, isUserRejection, getFullErrorMessage]
  );

  const transferUsdFn = useCallback(
    async (
      subAccountAddress: `0x${string}`,
      amountUsd: string,
      isDeposit: boolean
    ): Promise<void> => {
      const amountFloat = parseFloat(amountUsd);
      if (isNaN(amountFloat) || amountFloat <= 0) {
        throw new HyperliquidError(
          `Invalid USD amount: ${amountUsd}. Must be a positive number.`
        );
      }

      // Convert to micro-dollars (1 USD = 1e6)
      const usdMicro = Math.round(amountFloat * 1e6);

      // Switch to Hyperliquid chain for signing
      await switchToHyperliquid();

      try {
        // Get a fresh wallet client configured for chainId 1337
        const wallet = await getHyperliquidWallet();

        await subAccountTransfer(
          {
            transport,
            wallet: wallet as never,
          },
          {
            subAccountUser: subAccountAddress,
            isDeposit,
            usd: usdMicro,
          }
        );

        // Restore original chain after successful signing
        await restoreOriginalChain();
      } catch (error) {
        // Restore original chain even on error
        await restoreOriginalChain();

        if (isUserRejection(error)) {
          throw new UserRejectedError();
        }
        throw new HyperliquidError(
          `Failed to transfer USD: ${getFullErrorMessage(error)}`
        );
      }
    },
    [transport, getHyperliquidWallet, switchToHyperliquid, restoreOriginalChain, isUserRejection, getFullErrorMessage]
  );

  // ============ Info Operations ============

  const getSubAccountsFn = useCallback(async (): Promise<
    HyperliquidSubaccountInfo[]
  > => {
    if (!walletAddress) {
      throw new HyperliquidError("Wallet not connected");
    }

    const result: SubAccountsResponse = await subAccounts(
      { transport },
      { user: walletAddress }
    );

    if (!result) {
      return [];
    }

    return result.map((sub) => ({
      address: sub.subAccountUser,
      name: sub.name,
      masterAddress: sub.master,
    }));
  }, [transport, walletAddress]);

  const findUnusedSubAccountsFn = useCallback(async (): Promise<
    HyperliquidSubaccountInfo[]
  > => {
    const all = await getSubAccountsFn();
    return all.filter((sub) => isUnusedSubaccountName(sub.name));
  }, [getSubAccountsFn]);

  const getSubAccountStateFn = useCallback(
    async (subAccountAddress: `0x${string}`): Promise<SubAccountState> => {
      const result: ClearinghouseStateResponse = await clearinghouseState(
        { transport },
        { user: subAccountAddress }
      );

      return {
        accountValue: result.marginSummary.accountValue,
        withdrawable: result.withdrawable,
        positions: result.assetPositions.map((ap) => ({
          coin: ap.position.coin,
          size: ap.position.szi,
          entryPrice: ap.position.entryPx,
          unrealizedPnl: ap.position.unrealizedPnl,
          leverage: {
            type: ap.position.leverage.type,
            value: ap.position.leverage.value,
          },
        })),
      };
    },
    [transport]
  );

  const getMainAccountStateFn = useCallback(async (): Promise<SubAccountState> => {
    if (!walletAddress) {
      throw new HyperliquidError("Wallet not connected");
    }
    return getSubAccountStateFn(walletAddress);
  }, [walletAddress, getSubAccountStateFn]);

  // ============ Order Operations ============

  const getMarketMetadataFn = useCallback(
    async (coin: string): Promise<MarketMetadata | null> => {
      const rawData = await metaAndAssetCtxs({ transport });

      const coinIndex = rawData[0].universe.findIndex((u) => u.name === coin);
      if (coinIndex === -1) {
        return null;
      }

      const universeEntry = rawData[0].universe[coinIndex];
      const assetCtx = rawData[1][coinIndex];

      if (!universeEntry || !assetCtx) {
        return null;
      }

      return {
        coin,
        assetIndex: coinIndex,
        maxLeverage: universeEntry.maxLeverage,
        szDecimals: universeEntry.szDecimals,
        markPx: assetCtx.markPx,
        fundingRate: assetCtx.funding,
        onlyIsolated: universeEntry.onlyIsolated ?? false,
      };
    },
    [transport]
  );

  const placeOrderFn = useCallback(
    async (params: PlaceOrderParams): Promise<PlaceOrderResult> => {
      // Get asset index (before switching chain - this is a read operation)
      const metadata = await getMarketMetadataFn(params.coin);
      if (!metadata) {
        throw new HyperliquidError(`Market not found for ${params.coin}`);
      }

      // Switch to Hyperliquid chain for signing
      await switchToHyperliquid();

      try {
        // Get a fresh wallet client configured for chainId 1337
        const wallet = await getHyperliquidWallet();

        const result = await order(
          {
            transport,
            wallet: wallet as never,
          },
          {
            orders: [
              {
                a: metadata.assetIndex,
                b: params.isBuy,
                p: params.price,
                s: params.size,
                r: params.reduceOnly ?? false,
                t: { limit: { tif: "Ioc" } }, // Immediate-or-Cancel for market-like execution
              },
            ],
            grouping: "na",
          },
          { vaultAddress: params.subAccountAddress } // Trade as subaccount
        );

        // Restore original chain after successful signing
        await restoreOriginalChain();

        const status = result.response.data.statuses[0];

        if (!status) {
          throw new HyperliquidError("No order status returned");
        }

        // Check for error
        if ("error" in status) {
          throw new HyperliquidError(`Order rejected: ${status.error}`);
        }

        // Check for filled
        if ("filled" in status) {
          return {
            orderId: status.filled.oid,
            status: "filled",
            filledSize: status.filled.totalSz,
            avgPrice: status.filled.avgPx,
          };
        }

        // Check for resting (unlikely for IOC but handle it)
        if ("resting" in status) {
          return {
            orderId: status.resting.oid,
            status: "resting",
          };
        }

        throw new HyperliquidError("Unknown order status");
      } catch (error) {
        // Restore original chain even on error
        await restoreOriginalChain();

        if (isUserRejection(error)) {
          throw new UserRejectedError();
        }
        if (error instanceof HyperliquidError) {
          throw error;
        }
        throw new HyperliquidError(
          `Failed to place order: ${getFullErrorMessage(error)}`
        );
      }
    },
    [transport, getHyperliquidWallet, switchToHyperliquid, restoreOriginalChain, isUserRejection, getFullErrorMessage, getMarketMetadataFn]
  );

  const getOrderStatusFn = useCallback(
    async (
      userAddress: `0x${string}`,
      orderId: number
    ): Promise<OrderStatusResult> => {
      const result = await orderStatus(
        { transport },
        { user: userAddress, oid: orderId }
      );

      if (result.status === "unknownOid") {
        return { found: false };
      }

      if (result.status === "order" && result.order) {
        // Determine status from order data
        const orderData = result.order;

        // Check if fully filled (size remaining is 0)
        const remainingSize = parseFloat(orderData.order.sz);
        if (remainingSize === 0) {
          return {
            found: true,
            status: "filled",
            filledSize: orderData.order.origSz,
          };
        }

        return {
          found: true,
          status: "open",
        };
      }

      return { found: true, status: "unknown" };
    },
    [transport]
  );

  // ============ High-Level Utilities ============

  /**
   * Prepare a subaccount for hedging
   * 1. Check for existing unused subaccounts
   * 2. If found: rename to mc-{positionHash}
   * 3. If not found: create new with name mc-{positionHash}
   * Returns the subaccount address
   */
  const prepareSubaccountFn = useCallback(
    async (positionHash: string): Promise<`0x${string}`> => {
      const subaccountName = generateSubaccountName(positionHash);

      // Check for unused subaccounts
      const unused = await findUnusedSubAccountsFn();

      if (unused.length > 0) {
        // Reuse first unused subaccount
        const toReuse = unused[0]!;
        await renameSubAccountFn(
          toReuse.address as `0x${string}`,
          subaccountName
        );
        return toReuse.address as `0x${string}`;
      }

      // Create new subaccount
      const result = await createSubAccountFn(subaccountName);
      return result.address;
    },
    [findUnusedSubAccountsFn, renameSubAccountFn, createSubAccountFn]
  );

  return {
    isReady,
    walletAddress,

    // Subaccount Operations
    createSubAccount: createSubAccountFn,
    renameSubAccount: renameSubAccountFn,
    transferUsd: transferUsdFn,

    // Info Operations
    getSubAccounts: getSubAccountsFn,
    findUnusedSubAccounts: findUnusedSubAccountsFn,
    getSubAccountState: getSubAccountStateFn,
    getMainAccountState: getMainAccountStateFn,

    // Order Operations
    placeOrder: placeOrderFn,
    getOrderStatus: getOrderStatusFn,

    // Market Data
    getMarketMetadata: getMarketMetadataFn,

    // Utilities
    prepareSubaccount: prepareSubaccountFn,
  };
}
