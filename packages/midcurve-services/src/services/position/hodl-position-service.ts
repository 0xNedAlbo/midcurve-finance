/**
 * HODL Position Service
 *
 * Manages HODL positions (multi-token baskets) for tracking unallocated assets.
 * Unlike Uniswap V3 positions, HODL positions are manually managed:
 * - discover() creates a new position (not from on-chain data)
 * - refresh() only updates asset valuations using CoinGecko prices
 * - reset() rebuilds state from ledger events (no blockchain sync)
 *
 * HODL positions track:
 * - Multiple token holdings across multiple chains
 * - Cost basis and PnL in a user-selected quote token
 * - Wallet configurations for tracking purposes
 */

import { randomUUID } from 'crypto';
import type {
  Position,
  HodlPositionConfig,
  HodlPositionState,
  HodlPositionHolding,
  HodlWalletConfig,
  AnyToken,
  HodlLedgerEvent,
} from '@midcurve/shared';
import {
  PositionService,
  type PositionServiceDependencies,
} from './position-service.js';
import type { HodlPositionDiscoverInput } from '../types/position/position-input.js';
import { HodlPositionLedgerService } from '../position-ledger/hodl-position-ledger-service.js';
import { CoinGeckoClient } from '../../clients/coingecko/coingecko-client.js';
import { log } from '../../logging/index.js';

/**
 * Type alias for HODL Position
 */
type HodlPosition = Position<'hodl'>;

/**
 * Database representation of HODL position config
 */
interface HodlPositionConfigDB {
  wallets: HodlWalletConfig[];
}

/**
 * Database representation of HODL position state
 * All bigint fields serialized as strings
 */
interface HodlPositionStateDB {
  holdings: Record<
    string,
    {
      tokenSymbol: string;
      balance: string;
      costBasis: string;
    }
  >;
}

/**
 * Dependencies for HodlPositionService
 */
export interface HodlPositionServiceDependencies extends PositionServiceDependencies {
  /**
   * CoinGecko client for price lookups
   * If not provided, singleton instance will be used
   */
  coinGeckoClient?: CoinGeckoClient;

  /**
   * HODL position ledger service
   * If not provided, a new instance will be created
   */
  ledgerService?: HodlPositionLedgerService;
}

/**
 * HODL Position Service
 *
 * Manages multi-token basket positions for tracking unallocated strategy assets.
 */
export class HodlPositionService extends PositionService<'hodl'> {
  private readonly _coinGeckoClient: CoinGeckoClient;
  private readonly _ledgerService: HodlPositionLedgerService;

  constructor(dependencies: HodlPositionServiceDependencies = {}) {
    super(dependencies);
    this._coinGeckoClient = dependencies.coinGeckoClient ?? CoinGeckoClient.getInstance();
    this._ledgerService =
      dependencies.ledgerService ??
      new HodlPositionLedgerService({ prisma: this._prisma });
  }

  // ============================================================================
  // SERIALIZATION METHODS
  // ============================================================================

  /**
   * Parse config from database JSON to application type
   */
  parseConfig(configDB: unknown): HodlPositionConfig {
    const db = configDB as HodlPositionConfigDB;
    return {
      wallets: db.wallets ?? [],
    };
  }

  /**
   * Serialize config from application type to database JSON
   */
  serializeConfig(config: HodlPositionConfig): unknown {
    return {
      wallets: config.wallets,
    };
  }

  /**
   * Parse state from database JSON to application type
   * Converts string values to bigint
   */
  parseState(stateDB: unknown): HodlPositionState {
    const db = stateDB as HodlPositionStateDB;
    const holdings: Record<string, HodlPositionHolding> = {};

    if (db.holdings) {
      for (const [tokenId, h] of Object.entries(db.holdings)) {
        holdings[tokenId] = {
          tokenSymbol: h.tokenSymbol,
          balance: BigInt(h.balance),
          costBasis: BigInt(h.costBasis),
        };
      }
    }

    return { holdings };
  }

  /**
   * Serialize state from application type to database JSON
   * Converts bigint to string for JSON storage
   */
  serializeState(state: HodlPositionState): unknown {
    const holdings: Record<string, { tokenSymbol: string; balance: string; costBasis: string }> =
      {};

    for (const [tokenId, holding] of Object.entries(state.holdings)) {
      const h = holding as HodlPositionHolding;
      holdings[tokenId] = {
        tokenSymbol: h.tokenSymbol,
        balance: h.balance.toString(),
        costBasis: h.costBasis.toString(),
      };
    }

    return { holdings };
  }

  /**
   * Create position hash for database lookups
   * Uses UUID since HODL positions don't have natural on-chain identifiers
   */
  createPositionHash(_config: HodlPositionConfig): string {
    return `hodl/${randomUUID()}`;
  }

  // ============================================================================
  // CORE METHODS
  // ============================================================================

  /**
   * Create a new HODL position
   *
   * Unlike Uniswap V3, HODL positions are manually created, not discovered from on-chain.
   *
   * @param userId - User ID who owns this position
   * @param params - Discovery input with quote token and optional initial config
   * @returns The created position
   */
  async discover(userId: string, params: HodlPositionDiscoverInput): Promise<HodlPosition> {
    log.methodEntry(this.logger, 'discover', {
      userId,
      quoteTokenId: params.quoteTokenId,
      strategyId: params.strategyId,
    });

    try {
      // 1. Validate quote token exists
      const quoteToken = await this.prisma.token.findUnique({
        where: { id: params.quoteTokenId },
      });

      if (!quoteToken) {
        throw new Error(`Quote token not found: ${params.quoteTokenId}`);
      }

      // 2. Create or get virtual HODL pool for this quote token
      const pool = await this.createOrGetHodlPool(quoteToken);

      // 3. Build config and state
      const config: HodlPositionConfig = {
        wallets: params.wallets ?? [],
      };

      const state: HodlPositionState = {
        holdings: params.initialHoldings
          ? this.convertInitialHoldings(params.initialHoldings)
          : {},
      };

      // 4. Create the position
      const position = await this.create({
        protocol: 'hodl',
        positionType: 'SPOT',
        userId,
        poolId: pool.id,
        isToken0Quote: true, // Always true for HODL (token0 = token1 = quote)
        config,
        state,
      });

      // 5. Associate with strategy if provided
      if (params.strategyId) {
        await this.prisma.position.update({
          where: { id: position.id },
          data: { strategyId: params.strategyId },
        });
      }

      this.logger.info(
        {
          positionId: position.id,
          userId,
          quoteTokenId: params.quoteTokenId,
          strategyId: params.strategyId,
        },
        'HODL position created'
      );

      log.methodExit(this.logger, 'discover', { id: position.id });

      // Return fresh position with updated strategyId
      return (await this.findById(position.id))!;
    } catch (error) {
      log.methodError(this.logger, 'discover', error as Error, {
        userId,
        quoteTokenId: params.quoteTokenId,
      });
      throw error;
    }
  }

  /**
   * Refresh position valuations using current prices
   *
   * Unlike Uniswap V3, this does NOT sync on-chain data.
   * It only updates asset values using current CoinGecko prices.
   *
   * @param id - Position ID
   * @returns Updated position with fresh valuations
   */
  async refresh(id: string): Promise<HodlPosition> {
    log.methodEntry(this.logger, 'refresh', { id });

    try {
      const position = await this.findById(id);
      if (!position) {
        throw new Error(`Position not found: ${id}`);
      }

      // Verify this is a HODL position
      if (position.protocol !== 'hodl') {
        throw new Error(`Expected HODL position, got: ${position.protocol}`);
      }

      // Get quote token from pool
      const quoteToken = position.pool.token0;

      // Calculate current value of all holdings
      let totalValue = 0n;
      let totalCostBasis = 0n;

      for (const [tokenId, holdingEntry] of Object.entries(position.state.holdings)) {
        const holding = holdingEntry as HodlPositionHolding;
        totalCostBasis += holding.costBasis;

        if (holding.balance > 0n) {
          // Fetch token details
          const token = await this.prisma.token.findUnique({
            where: { id: tokenId },
          });

          if (!token) {
            this.logger.warn({ tokenId }, 'Token not found, skipping valuation');
            continue;
          }

          // Get price from CoinGecko
          const priceInQuote = await this.getTokenPriceInQuote(token, quoteToken);
          if (priceInQuote > 0n) {
            const holdingValue =
              (holding.balance * priceInQuote) / BigInt(10 ** token.decimals);
            totalValue += holdingValue;
          }
        }
      }

      // Calculate unrealized PnL
      const unrealizedPnl = totalValue - totalCostBasis;

      // Update position in database
      await this.prisma.position.update({
        where: { id },
        data: {
          currentValue: totalValue.toString(),
          currentCostBasis: totalCostBasis.toString(),
          unrealizedPnl: unrealizedPnl.toString(),
        },
      });

      this.logger.info(
        {
          positionId: id,
          totalValue: totalValue.toString(),
          totalCostBasis: totalCostBasis.toString(),
          unrealizedPnl: unrealizedPnl.toString(),
        },
        'HODL position refreshed'
      );

      log.methodExit(this.logger, 'refresh', { id });

      return (await this.findById(id))!;
    } catch (error) {
      log.methodError(this.logger, 'refresh', error as Error, { id });
      throw error;
    }
  }

  /**
   * Reset position by rebuilding state from ledger events
   *
   * Unlike Uniswap V3, this does NOT fetch from blockchain.
   * It rebuilds the position state from existing ledger events.
   *
   * @param id - Position ID
   * @returns Position with rebuilt state
   */
  async reset(id: string): Promise<HodlPosition> {
    log.methodEntry(this.logger, 'reset', { id });

    try {
      const position = await this.findById(id);
      if (!position) {
        throw new Error(`Position not found: ${id}`);
      }

      // Verify this is a HODL position
      if (position.protocol !== 'hodl') {
        throw new Error(`Expected HODL position, got: ${position.protocol}`);
      }

      // Get all ledger events (cast to proper type since findAllItems returns generic type)
      const events = (await this._ledgerService.findAllItems(id)) as HodlLedgerEvent[];

      // Rebuild holdings from events
      const holdings: Record<string, HodlPositionHolding> = {};

      // Process events in chronological order (oldest first)
      // Events are returned in DESC order, so reverse them
      const sortedEvents = [...events].reverse();

      for (const event of sortedEvents) {
        const eventState = event.state;
        const tokenId = eventState.tokenId;
        const amount = eventState.amount;

        // Initialize holding if not exists
        if (!holdings[tokenId]) {
          holdings[tokenId] = {
            tokenSymbol: '', // Will be populated below
            balance: 0n,
            costBasis: 0n,
          };
        }

        // Update balance based on event type
        switch (eventState.eventType) {
          case 'EXTERNAL_DEPOSIT':
          case 'TRADE_IN':
          case 'INTERNAL_ALLOCATION_INFLOW':
            holdings[tokenId]!.balance += amount;
            holdings[tokenId]!.costBasis += event.deltaCostBasis;
            break;

          case 'EXTERNAL_WITHDRAW':
          case 'TRADE_OUT':
          case 'INTERNAL_ALLOCATION_OUTFLOW':
            holdings[tokenId]!.balance -= amount;
            // Cost basis reduced proportionally (simplified)
            holdings[tokenId]!.costBasis += event.deltaCostBasis;
            break;

          case 'TRADE_FEES':
            // Fees don't affect balance, only cost basis
            break;
        }
      }

      // Fetch token symbols for holdings
      for (const [tokenId, holding] of Object.entries(holdings)) {
        const token = await this.prisma.token.findUnique({
          where: { id: tokenId },
        });
        if (token) {
          holding.tokenSymbol = token.symbol;
        }
      }

      // Update position state
      const newState: HodlPositionState = { holdings };
      const stateDB = this.serializeState(newState);

      await this.prisma.position.update({
        where: { id },
        data: {
          state: stateDB as object,
        },
      });

      this.logger.info(
        {
          positionId: id,
          holdingsCount: Object.keys(holdings).length,
          eventsProcessed: events.length,
        },
        'HODL position reset from ledger events'
      );

      log.methodExit(this.logger, 'reset', { id });

      // Refresh to update valuations
      return this.refresh(id);
    } catch (error) {
      log.methodError(this.logger, 'reset', error as Error, { id });
      throw error;
    }
  }

  // ============================================================================
  // HODL-SPECIFIC METHODS
  // ============================================================================

  /**
   * Update wallet configurations for a HODL position
   *
   * @param id - Position ID
   * @param wallets - New wallet configurations
   * @returns Updated position
   */
  async updateWallets(id: string, wallets: HodlWalletConfig[]): Promise<HodlPosition> {
    log.methodEntry(this.logger, 'updateWallets', { id, walletCount: wallets.length });

    try {
      const position = await this.findById(id);
      if (!position) {
        throw new Error(`Position not found: ${id}`);
      }

      // Verify this is a HODL position
      if (position.protocol !== 'hodl') {
        throw new Error(`Expected HODL position, got: ${position.protocol}`);
      }

      // Update config with new wallets
      const newConfig: HodlPositionConfig = {
        ...position.config,
        wallets,
      };

      const configDB = this.serializeConfig(newConfig);

      await this.prisma.position.update({
        where: { id },
        data: {
          config: configDB as object,
        },
      });

      this.logger.info(
        {
          positionId: id,
          walletCount: wallets.length,
        },
        'HODL position wallets updated'
      );

      log.methodExit(this.logger, 'updateWallets', { id });

      return (await this.findById(id))!;
    } catch (error) {
      log.methodError(this.logger, 'updateWallets', error as Error, { id });
      throw error;
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Create or get a virtual HODL pool for a quote token
   *
   * HODL pools are "virtual" pools where token0 = token1 = quoteToken.
   * They're used to reference a quote token for position valuation.
   */
  private async createOrGetHodlPool(quoteToken: AnyToken | { id: string; symbol: string }) {
    // Check if pool already exists
    const existingPool = await this.prisma.pool.findFirst({
      where: {
        protocol: 'hodl',
        token0Id: quoteToken.id,
        token1Id: quoteToken.id,
      },
      include: {
        token0: true,
        token1: true,
      },
    });

    if (existingPool) {
      return existingPool;
    }

    // Create new virtual pool
    const pool = await this.prisma.pool.create({
      data: {
        protocol: 'hodl',
        poolType: 'SPOT',
        token0Id: quoteToken.id,
        token1Id: quoteToken.id,
        feeBps: 0, // No fees for virtual pool
        config: {}, // Empty config
        state: {}, // Empty state
      },
      include: {
        token0: true,
        token1: true,
      },
    });

    this.logger.info(
      {
        poolId: pool.id,
        quoteTokenId: quoteToken.id,
        quoteTokenSymbol: quoteToken.symbol,
      },
      'Created virtual HODL pool'
    );

    return pool;
  }

  /**
   * Convert initial holdings input to HodlPositionHolding format
   */
  private convertInitialHoldings(
    initialHoldings: Record<string, { tokenSymbol: string; balance: bigint; costBasis: bigint }>
  ): Record<string, HodlPositionHolding> {
    const holdings: Record<string, HodlPositionHolding> = {};

    for (const [tokenId, h] of Object.entries(initialHoldings)) {
      holdings[tokenId] = {
        tokenSymbol: h.tokenSymbol,
        balance: h.balance,
        costBasis: h.costBasis,
      };
    }

    return holdings;
  }

  /**
   * Get token price in quote token units using CoinGecko
   *
   * Uses the CoinGeckoClient's price discovery methods to calculate cross-rates
   * between tokens. Returns the price scaled to the quote token's decimals.
   *
   * @param token - Token to price
   * @param quoteToken - Quote token (unit of account)
   * @param date - Optional date for historical price (omit for current price)
   * @returns Price in quote token's smallest units, or 0 if unavailable
   *
   * @example
   * ```typescript
   * // If ETH price is $3000 and quote token is USDC (6 decimals):
   * // Returns 3000_000_000n (3000 * 10^6)
   * const price = await getTokenPriceInQuote(ethToken, usdcToken);
   * ```
   */
  private async getTokenPriceInQuote(
    token: { id: string; coingeckoId?: string | null; decimals: number },
    quoteToken: { id: string; coingeckoId?: string | null; decimals: number },
    date?: Date
  ): Promise<bigint> {
    try {
      // If token is the quote token, price is 1 (in quote token units)
      if (token.id === quoteToken.id) {
        return BigInt(10 ** quoteToken.decimals);
      }

      // Need CoinGecko IDs for both tokens
      if (!token.coingeckoId || !quoteToken.coingeckoId) {
        this.logger.warn(
          {
            tokenId: token.id,
            quoteTokenId: quoteToken.id,
            hasTokenCoinGeckoId: !!token.coingeckoId,
            hasQuoteCoinGeckoId: !!quoteToken.coingeckoId,
          },
          'Missing CoinGecko ID for price lookup'
        );
        return 0n;
      }

      // Get price from CoinGecko (returns floating point price)
      const priceFloat = await this._coinGeckoClient.getTokenPriceInQuote(
        token.coingeckoId,
        quoteToken.coingeckoId,
        date
      );

      if (priceFloat === 0) {
        this.logger.warn(
          {
            tokenId: token.id,
            quoteTokenId: quoteToken.id,
            date: date?.toISOString(),
          },
          'Price not available from CoinGecko'
        );
        return 0n;
      }

      // Convert to bigint with quote token decimals
      // price = 1500.50 means 1 token = 1500.50 quote tokens
      // We want: price * 10^quoteDecimals
      const scaledPrice = Math.round(priceFloat * 10 ** quoteToken.decimals);
      return BigInt(scaledPrice);
    } catch (error) {
      this.logger.warn(
        {
          tokenId: token.id,
          quoteTokenId: quoteToken.id,
          date: date?.toISOString(),
          error: (error as Error).message,
        },
        'Failed to get token price from CoinGecko'
      );
      return 0n;
    }
  }

  // ============================================================================
  // OVERRIDDEN CRUD METHODS
  // ============================================================================

  /**
   * Find position by ID with protocol validation
   */
  override async findById(id: string): Promise<HodlPosition | null> {
    const position = await super.findById(id);

    if (position && position.protocol !== 'hodl') {
      this.logger.warn(
        { id, protocol: position.protocol },
        'Position found but is not HODL protocol'
      );
      return null;
    }

    return position;
  }

  /**
   * Delete position with protocol validation
   */
  override async delete(id: string): Promise<void> {
    const position = await this.findById(id);

    if (position && position.protocol !== 'hodl') {
      throw new Error(`Cannot delete non-HODL position with HodlPositionService: ${id}`);
    }

    // Delete ledger events first
    await this._ledgerService.deleteAllItems(id);

    // Delete position
    await super.delete(id);
  }
}
