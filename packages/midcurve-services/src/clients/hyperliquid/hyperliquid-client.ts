/**
 * Hyperliquid API Client
 *
 * Provides access to Hyperliquid exchange and info APIs for subaccount management.
 * Used for creating hedges on perpetual positions.
 *
 * Features:
 * - Subaccount creation and renaming
 * - USD transfers to/from subaccounts
 * - Subaccount state queries (positions, balances)
 * - Finding unused (available) subaccounts for reuse
 *
 * Design:
 * - Exchange operations require a wallet for signing (user signs via UI)
 * - Info operations are read-only and don't require wallet
 * - No private keys stored server-side
 */

import { HttpTransport } from '@nktkas/hyperliquid';
import {
  createSubAccount,
  subAccountModify,
  subAccountTransfer,
} from '@nktkas/hyperliquid/api/exchange';
import {
  subAccounts,
  clearinghouseState,
} from '@nktkas/hyperliquid/api/info';
import type { SubAccountsResponse } from '@nktkas/hyperliquid/api/info';
import type { ClearinghouseStateResponse } from '@nktkas/hyperliquid/api/info';
import type { LocalAccount } from 'viem/accounts';

import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { CacheService } from '../../services/cache/index.js';
import {
  type HyperliquidSubaccountInfo,
  type HyperliquidEnvironment,
  isUnusedSubaccountName,
  isMidcurveSubaccount,
} from '@midcurve/shared';

// ============ Types ============

/**
 * Configuration for HyperliquidClient
 */
export interface HyperliquidClientConfig {
  /** Hyperliquid environment (mainnet or testnet) */
  environment: HyperliquidEnvironment;
}

/**
 * Result of creating a subaccount
 */
export interface CreateSubAccountResult {
  /** Subaccount address (immutable identifier from Hyperliquid) */
  address: `0x${string}`;
  /** Name given to the subaccount */
  name: string;
}

/**
 * Market data for a specific perpetual asset
 */
export interface HyperliquidMarketData {
  /** Asset symbol (e.g., "ETH", "BTC") */
  coin: string;
  /** Current mark price */
  markPx: string;
  /** Current 8-hour funding rate (e.g., "0.0001" = 0.01%) */
  fundingRate: string;
  /** Maximum allowed leverage for this market */
  maxLeverage: number;
  /** Size decimal places for orders */
  szDecimals: number;
  /** Whether only isolated margin is allowed */
  onlyIsolated: boolean;
}

/**
 * Clearinghouse state for a subaccount (simplified)
 */
export interface SubAccountClearinghouseState {
  /** Account value in USD */
  accountValue: string;
  /** Amount available for withdrawal */
  withdrawable: string;
  /** Open perpetual positions */
  positions: Array<{
    /** Asset symbol (e.g., 'ETH', 'BTC') */
    coin: string;
    /** Signed position size (negative = short) */
    size: string;
    /** Entry price */
    entryPrice: string;
    /** Unrealized PnL */
    unrealizedPnl: string;
    /** Leverage info */
    leverage: {
      type: 'isolated' | 'cross';
      value: number;
    };
  }>;
}

// ============ Errors ============

/**
 * Base error for Hyperliquid client errors
 */
export class HyperliquidClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HyperliquidClientError';
  }
}

/**
 * Error thrown when Hyperliquid API returns an error
 */
export class HyperliquidApiError extends HyperliquidClientError {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'HyperliquidApiError';
  }
}

/**
 * Error thrown when subaccount is not found
 */
export class SubAccountNotFoundError extends HyperliquidClientError {
  constructor(address: string) {
    super(`Subaccount not found: ${address}`);
    this.name = 'SubAccountNotFoundError';
  }
}

/**
 * Error thrown when subaccount is not empty (has positions or balance)
 */
export class SubAccountNotEmptyError extends HyperliquidClientError {
  constructor(address: string, reason: string) {
    super(`Subaccount ${address} is not empty: ${reason}`);
    this.name = 'SubAccountNotEmptyError';
  }
}

// ============ Client ============

/**
 * Hyperliquid API Client
 *
 * Wraps the @nktkas/hyperliquid SDK for subaccount management.
 * Exchange operations require a wallet for signing; info operations are read-only.
 */
export class HyperliquidClient {
  private readonly logger: ServiceLogger;
  private readonly transport: HttpTransport;
  private readonly isTestnet: boolean;
  private readonly environment: HyperliquidEnvironment;
  private readonly cacheService: CacheService;

  constructor(config: HyperliquidClientConfig) {
    this.logger = createServiceLogger('HyperliquidClient');
    // SDK uses isTestnet (opposite of isMainnet)
    this.environment = config.environment;
    this.isTestnet = config.environment === 'testnet';
    this.transport = new HttpTransport({ isTestnet: this.isTestnet });
    this.cacheService = CacheService.getInstance();

    this.logger.info(
      { environment: config.environment, isTestnet: this.isTestnet },
      'HyperliquidClient initialized'
    );
  }

  // ============ Exchange Operations (require wallet) ============

  /**
   * Create a new subaccount
   *
   * @param wallet - Viem LocalAccount for signing (from user's wallet)
   * @param name - Name for the new subaccount (e.g., "mc-a1b2c3d4")
   * @returns Created subaccount info with address and name
   * @throws HyperliquidApiError if creation fails
   */
  async createSubAccount(
    wallet: LocalAccount,
    name: string
  ): Promise<CreateSubAccountResult> {
    log.methodEntry(this.logger, 'createSubAccount', { name });

    try {
      log.externalApiCall(this.logger, 'Hyperliquid', 'createSubAccount', {
        name,
      });

      const result = await createSubAccount(
        { transport: this.transport, wallet },
        { name }
      );

      const subAccountResult: CreateSubAccountResult = {
        address: result.response.data,
        name,
      };

      this.logger.info(
        { name, address: subAccountResult.address },
        'Subaccount created successfully'
      );

      log.methodExit(this.logger, 'createSubAccount', {
        address: subAccountResult.address,
      });

      return subAccountResult;
    } catch (error) {
      const wrappedError = this.wrapError(error, 'createSubAccount');
      log.methodError(this.logger, 'createSubAccount', wrappedError, { name });
      throw wrappedError;
    }
  }

  /**
   * Rename a subaccount
   *
   * Used to:
   * - Mark subaccount as active: rename to "mc-{positionHash}"
   * - Release subaccount: rename to "unused-{index}"
   *
   * @param wallet - Viem LocalAccount for signing
   * @param subAccountAddress - Address of subaccount to rename
   * @param newName - New name for the subaccount
   * @throws HyperliquidApiError if rename fails
   */
  async renameSubAccount(
    wallet: LocalAccount,
    subAccountAddress: `0x${string}`,
    newName: string
  ): Promise<void> {
    log.methodEntry(this.logger, 'renameSubAccount', {
      subAccountAddress,
      newName,
    });

    try {
      log.externalApiCall(this.logger, 'Hyperliquid', 'subAccountModify', {
        subAccountAddress,
        newName,
      });

      await subAccountModify(
        { transport: this.transport, wallet },
        { subAccountUser: subAccountAddress, name: newName }
      );

      this.logger.info(
        { subAccountAddress, newName },
        'Subaccount renamed successfully'
      );

      log.methodExit(this.logger, 'renameSubAccount', { success: true });
    } catch (error) {
      const wrappedError = this.wrapError(error, 'renameSubAccount');
      log.methodError(this.logger, 'renameSubAccount', wrappedError, {
        subAccountAddress,
        newName,
      });
      throw wrappedError;
    }
  }

  /**
   * Transfer USD to or from a subaccount
   *
   * @param wallet - Viem LocalAccount for signing
   * @param subAccountAddress - Subaccount address
   * @param amountUsd - Amount in USD (e.g., "100.50" for $100.50)
   * @param isDeposit - true = deposit to subaccount, false = withdraw from subaccount
   * @throws HyperliquidApiError if transfer fails
   */
  async transferUsd(
    wallet: LocalAccount,
    subAccountAddress: `0x${string}`,
    amountUsd: string,
    isDeposit: boolean
  ): Promise<void> {
    log.methodEntry(this.logger, 'transferUsd', {
      subAccountAddress,
      amountUsd,
      isDeposit,
    });

    try {
      // Convert USD string to the format expected by Hyperliquid
      // SDK expects: float * 1e6 as number (e.g., $100.50 → 100500000)
      const amountFloat = parseFloat(amountUsd);
      if (isNaN(amountFloat) || amountFloat <= 0) {
        throw new HyperliquidClientError(
          `Invalid USD amount: ${amountUsd}. Must be a positive number.`
        );
      }

      // Hyperliquid expects usd as a number (micro-dollars: 1 USD = 1e6)
      const usdMicro = Math.round(amountFloat * 1e6);

      log.externalApiCall(this.logger, 'Hyperliquid', 'subAccountTransfer', {
        subAccountAddress,
        usdMicro,
        isDeposit,
      });

      await subAccountTransfer(
        { transport: this.transport, wallet },
        {
          subAccountUser: subAccountAddress,
          isDeposit,
          usd: usdMicro,
        }
      );

      this.logger.info(
        { subAccountAddress, amountUsd, isDeposit },
        `USD ${isDeposit ? 'deposited to' : 'withdrawn from'} subaccount`
      );

      log.methodExit(this.logger, 'transferUsd', { success: true });
    } catch (error) {
      const wrappedError = this.wrapError(error, 'transferUsd');
      log.methodError(this.logger, 'transferUsd', wrappedError, {
        subAccountAddress,
        amountUsd,
        isDeposit,
      });
      throw wrappedError;
    }
  }

  // ============ Info Operations (no wallet needed) ============

  /**
   * Get all subaccounts for a user
   *
   * @param userAddress - Master account address
   * @returns Array of subaccount info (empty array if no subaccounts)
   */
  async getSubAccounts(
    userAddress: `0x${string}`
  ): Promise<HyperliquidSubaccountInfo[]> {
    log.methodEntry(this.logger, 'getSubAccounts', { userAddress });

    try {
      log.externalApiCall(this.logger, 'Hyperliquid', 'subAccounts', {
        userAddress,
      });

      const result: SubAccountsResponse = await subAccounts(
        { transport: this.transport },
        { user: userAddress }
      );

      // Handle null response (no subaccounts)
      if (!result) {
        log.methodExit(this.logger, 'getSubAccounts', { count: 0 });
        return [];
      }

      const mapped: HyperliquidSubaccountInfo[] = result.map((sub) => ({
        address: sub.subAccountUser,
        name: sub.name,
        masterAddress: sub.master,
      }));

      this.logger.debug(
        { userAddress, count: mapped.length },
        'Retrieved subaccounts'
      );

      log.methodExit(this.logger, 'getSubAccounts', { count: mapped.length });
      return mapped;
    } catch (error) {
      const wrappedError = this.wrapError(error, 'getSubAccounts');
      log.methodError(this.logger, 'getSubAccounts', wrappedError, {
        userAddress,
      });
      throw wrappedError;
    }
  }

  /**
   * Get clearinghouse state for a subaccount (positions and balances)
   *
   * @param subAccountAddress - Subaccount address
   * @returns Simplified clearinghouse state
   */
  async getSubAccountState(
    subAccountAddress: `0x${string}`
  ): Promise<SubAccountClearinghouseState> {
    log.methodEntry(this.logger, 'getSubAccountState', { subAccountAddress });

    try {
      log.externalApiCall(this.logger, 'Hyperliquid', 'clearinghouseState', {
        subAccountAddress,
      });

      const result: ClearinghouseStateResponse = await clearinghouseState(
        { transport: this.transport },
        { user: subAccountAddress }
      );

      const state: SubAccountClearinghouseState = {
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

      this.logger.debug(
        {
          subAccountAddress,
          accountValue: state.accountValue,
          positionCount: state.positions.length,
        },
        'Retrieved subaccount state'
      );

      log.methodExit(this.logger, 'getSubAccountState', {
        accountValue: state.accountValue,
        positionCount: state.positions.length,
      });

      return state;
    } catch (error) {
      const wrappedError = this.wrapError(error, 'getSubAccountState');
      log.methodError(this.logger, 'getSubAccountState', wrappedError, {
        subAccountAddress,
      });
      throw wrappedError;
    }
  }

  /**
   * Find unused subaccounts (name starts with "unused-")
   *
   * These are subaccounts that were previously used for hedges but have been
   * released and can be reused for new hedges.
   *
   * @param userAddress - Master account address
   * @returns Array of unused subaccount info
   */
  async findUnusedSubAccounts(
    userAddress: `0x${string}`
  ): Promise<HyperliquidSubaccountInfo[]> {
    log.methodEntry(this.logger, 'findUnusedSubAccounts', { userAddress });

    const all = await this.getSubAccounts(userAddress);
    const unused = all.filter((sub) => isUnusedSubaccountName(sub.name));

    this.logger.debug(
      { userAddress, total: all.length, unused: unused.length },
      'Found unused subaccounts'
    );

    log.methodExit(this.logger, 'findUnusedSubAccounts', {
      count: unused.length,
    });

    return unused;
  }

  /**
   * Find all Midcurve-managed subaccounts (both active and unused)
   *
   * @param userAddress - Master account address
   * @returns Array of Midcurve subaccount info
   */
  async findMidcurveSubAccounts(
    userAddress: `0x${string}`
  ): Promise<HyperliquidSubaccountInfo[]> {
    log.methodEntry(this.logger, 'findMidcurveSubAccounts', { userAddress });

    const all = await this.getSubAccounts(userAddress);
    const midcurve = all.filter((sub) => isMidcurveSubaccount(sub.name));

    this.logger.debug(
      { userAddress, total: all.length, midcurve: midcurve.length },
      'Found Midcurve subaccounts'
    );

    log.methodExit(this.logger, 'findMidcurveSubAccounts', {
      count: midcurve.length,
    });

    return midcurve;
  }

  /**
   * Check if a subaccount is empty (no positions, minimal balance)
   *
   * A subaccount is considered empty if:
   * - No open perpetual positions
   * - Withdrawable balance < $0.01 (allow small dust)
   *
   * @param subAccountAddress - Subaccount address
   * @returns true if subaccount is empty
   */
  async isSubAccountEmpty(subAccountAddress: `0x${string}`): Promise<boolean> {
    log.methodEntry(this.logger, 'isSubAccountEmpty', { subAccountAddress });

    const state = await this.getSubAccountState(subAccountAddress);

    // Check for open positions (non-zero size)
    const hasPositions = state.positions.some(
      (p) => parseFloat(p.size) !== 0
    );
    if (hasPositions) {
      this.logger.debug(
        { subAccountAddress, hasPositions: true },
        'Subaccount has open positions'
      );
      log.methodExit(this.logger, 'isSubAccountEmpty', { isEmpty: false });
      return false;
    }

    // Check for non-trivial balance (allow small dust < $0.01)
    const withdrawable = parseFloat(state.withdrawable);
    if (withdrawable > 0.01) {
      this.logger.debug(
        { subAccountAddress, withdrawable },
        'Subaccount has non-trivial balance'
      );
      log.methodExit(this.logger, 'isSubAccountEmpty', { isEmpty: false });
      return false;
    }

    log.methodExit(this.logger, 'isSubAccountEmpty', { isEmpty: true });
    return true;
  }

  /**
   * Count total unused subaccounts for generating next unused-{n} name
   *
   * @param userAddress - Master account address
   * @returns Number of unused subaccounts
   */
  async countUnusedSubAccounts(userAddress: `0x${string}`): Promise<number> {
    const unused = await this.findUnusedSubAccounts(userAddress);
    return unused.length;
  }

  // ============ Market Data Operations ============

  /**
   * Get market data for a specific coin
   *
   * Fetches metadata (max leverage, decimals) and real-time context (mark price, funding rate)
   * from Hyperliquid. Uses CacheService to cache the full response for 5 minutes.
   *
   * Note: Uses direct fetch instead of SDK to avoid `keepalive: true` incompatibility
   * with Next.js server-side fetch implementation.
   *
   * @param coin - Asset symbol (e.g., "ETH", "BTC")
   * @returns Market data or null if coin not found
   */
  async getMarketData(coin: string): Promise<HyperliquidMarketData | null> {
    log.methodEntry(this.logger, 'getMarketData', { coin });

    const cacheKey = `hyperliquid:markets:${this.environment}`;
    const CACHE_TTL_SECONDS = 300; // 5 minutes - market data changes frequently

    try {
      // Check cache for full markets response
      type MarketsCache = {
        universe: Array<{
          name: string;
          maxLeverage: number;
          szDecimals: number;
          onlyIsolated?: boolean;
        }>;
        assetCtxs: Array<{
          markPx: string;
          funding: string;
        }>;
      };

      let marketsData = await this.cacheService.get<MarketsCache>(cacheKey);

      if (!marketsData) {
        log.externalApiCall(this.logger, 'Hyperliquid', 'metaAndAssetCtxs', {});

        // Fetch fresh data from Hyperliquid using direct fetch
        // Note: SDK's HttpTransport uses keepalive: true which is incompatible
        // with Next.js server-side fetch. Using direct fetch as workaround.
        const apiUrl = this.isTestnet
          ? 'https://api.hyperliquid-testnet.xyz/info'
          : 'https://api.hyperliquid.xyz/info';

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
        });

        if (!response.ok) {
          throw new Error(`Hyperliquid API error: ${response.status} ${response.statusText}`);
        }

        const rawData = await response.json() as [
          { universe: MarketsCache['universe'] },
          MarketsCache['assetCtxs']
        ];

        marketsData = {
          universe: rawData[0].universe,
          assetCtxs: rawData[1],
        };

        // Cache the full response
        await this.cacheService.set(cacheKey, marketsData, CACHE_TTL_SECONDS);

        this.logger.debug(
          { marketCount: marketsData.universe.length },
          'Fetched and cached Hyperliquid markets data'
        );
      }

      // Extract the specific coin
      const coinIndex = marketsData.universe.findIndex((u) => u.name === coin);
      if (coinIndex === -1) {
        this.logger.debug({ coin }, 'Coin not found in Hyperliquid universe');
        log.methodExit(this.logger, 'getMarketData', { found: false });
        return null;
      }

      const universeEntry = marketsData.universe[coinIndex];
      const assetCtx = marketsData.assetCtxs[coinIndex];

      // Safety check - should never happen if coinIndex is valid, but TypeScript requires it
      if (!universeEntry || !assetCtx) {
        this.logger.warn({ coin, coinIndex }, 'Missing universe or assetCtx data for valid coin index');
        log.methodExit(this.logger, 'getMarketData', { found: false });
        return null;
      }

      const marketData: HyperliquidMarketData = {
        coin,
        markPx: assetCtx.markPx,
        fundingRate: assetCtx.funding,
        maxLeverage: universeEntry.maxLeverage,
        szDecimals: universeEntry.szDecimals,
        onlyIsolated: universeEntry.onlyIsolated ?? false,
      };

      this.logger.debug(
        { coin, markPx: marketData.markPx, maxLeverage: marketData.maxLeverage },
        'Market data retrieved'
      );

      log.methodExit(this.logger, 'getMarketData', { found: true });
      return marketData;
    } catch (error) {
      const wrappedError = this.wrapError(error, 'getMarketData');
      log.methodError(this.logger, 'getMarketData', wrappedError, { coin });
      throw wrappedError;
    }
  }

  // ============ Private Helpers ============

  /**
   * Wrap SDK errors into HyperliquidApiError
   */
  private wrapError(error: unknown, operation: string): HyperliquidClientError {
    if (error instanceof HyperliquidClientError) {
      return error;
    }

    if (error instanceof Error) {
      return new HyperliquidApiError(
        `Hyperliquid ${operation} failed: ${error.message}`,
        undefined,
        error
      );
    }

    return new HyperliquidApiError(
      `Hyperliquid ${operation} failed: Unknown error`,
      undefined,
      error
    );
  }
}
