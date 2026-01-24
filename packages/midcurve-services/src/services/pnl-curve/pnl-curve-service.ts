/**
 * PnL Curve Service
 *
 * Generates PnL curves for Uniswap V3 positions with support for
 * automated close orders (stop-loss, take-profit).
 *
 * The service:
 * 1. Fetches position data including pool, tokens, and orders
 * 2. Generates the base PnL curve using position parameters
 * 3. Applies order effects to create adjusted values
 */

import type { PrismaClient } from '@midcurve/database';
import { prisma as defaultPrisma } from '@midcurve/database';
import type { Logger } from 'pino';
import { createServiceLogger, log } from '../../logging/index.js';
import {
  generatePnLCurve,
  tickToPrice,
  getTickSpacing,
  calculatePositionValue,
  UniswapV3PositionConfig,
  positionStateFromJSON,
  stateFromJSON as poolStateFromJSON,
  type UniswapV3PositionState,
  type UniswapV3PositionConfigJSON,
  type UniswapV3PositionStateJSON,
  type UniswapV3PoolStateJSON,
  type Erc20TokenConfig,
  type TriggerMode,
} from '@midcurve/shared';
import { TickMath } from '@uniswap/v3-sdk';
import JSBI from 'jsbi';
import type {
  PnLCurveData,
  PnLCurvePoint,
  PnLCurveOrder,
  GeneratePnLCurveInput,
  PositionDataForCurve,
  OrderType,
  OrderStatus,
} from './types.js';

/**
 * Service dependencies
 */
export interface PnLCurveServiceDependencies {
  prisma?: PrismaClient;
}

/**
 * PnL Curve Service
 *
 * Generates PnL curves for concentrated liquidity positions.
 */
export class PnLCurveService {
  protected readonly prisma: PrismaClient;
  protected readonly logger: Logger;

  constructor(dependencies: PnLCurveServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? defaultPrisma;
    this.logger = createServiceLogger('pnl-curve');
  }

  /**
   * Generate PnL curve data for a position
   *
   * @param input - Generation parameters
   * @returns Complete PnL curve data with order effects
   */
  async generate(input: GeneratePnLCurveInput): Promise<PnLCurveData> {
    log.methodEntry(this.logger, 'generate', { positionId: input.positionId });

    try {
      // 1. Fetch position with all related data
      const position = await this.fetchPositionData(input.positionId);

      if (!position) {
        throw new Error(`Position not found: ${input.positionId}`);
      }

      if (position.protocol !== 'uniswapv3') {
        throw new Error(`Unsupported protocol: ${position.protocol}. Only 'uniswapv3' is supported.`);
      }

      // 2. Parse position and pool data (convert JSON strings to bigint values)
      const positionConfig = UniswapV3PositionConfig.fromJSON(
        position.config as unknown as UniswapV3PositionConfigJSON
      );
      const positionState = positionStateFromJSON(
        position.state as unknown as UniswapV3PositionStateJSON
      );
      const poolState = poolStateFromJSON(
        position.pool.state as unknown as UniswapV3PoolStateJSON
      );

      // 3. Determine base and quote tokens
      const { baseToken, quoteToken } = this.resolveTokenRoles(
        position.pool.token0,
        position.pool.token1,
        position.isToken0Quote
      );

      // 4. Calculate current price and tick
      const currentTick = poolState.currentTick;
      const currentPrice = tickToPrice(
        currentTick,
        baseToken.config.address,
        quoteToken.config.address,
        baseToken.decimals
      );

      // 5. Calculate position range prices
      const { lowerPrice, upperPrice } = this.calculateRangePrices(
        positionConfig.tickLower,
        positionConfig.tickUpper,
        baseToken,
        quoteToken,
        position.isToken0Quote
      );

      // 6. Determine visualization price range
      const { priceMin, priceMax } = this.determinePriceRange(
        input.priceMin,
        input.priceMax,
        lowerPrice,
        upperPrice
      );

      // 7. Process orders
      const orders = this.processOrders(
        position.automationOrders,
        baseToken,
        quoteToken,
        positionConfig,
        positionState
      );

      // 8. Generate base curve
      const numPoints = input.numPoints ?? 150;
      const tickSpacing = getTickSpacing(position.pool.feeBps);
      const costBasis = BigInt(position.currentCostBasis);

      const baseCurve = generatePnLCurve(
        positionState.liquidity,
        positionConfig.tickLower,
        positionConfig.tickUpper,
        costBasis,
        baseToken.config.address,
        quoteToken.config.address,
        baseToken.decimals,
        tickSpacing,
        { min: priceMin, max: priceMax },
        numPoints
      );

      // 9. Apply order effects if requested
      const includeOrders = input.includeOrders ?? true;
      const curveWithOrderEffects = includeOrders
        ? this.applyOrderEffects(baseCurve, orders, costBasis)
        : baseCurve.map((point) => ({
            ...point,
            adjustedValue: point.positionValue,
            adjustedPnl: point.pnl,
            adjustedPnlPercent: point.pnlPercent,
          }));

      // 10. Build response
      const result: PnLCurveData = {
        positionId: position.id,
        tickLower: positionConfig.tickLower,
        tickUpper: positionConfig.tickUpper,
        liquidity: positionState.liquidity,
        costBasis,
        baseToken: {
          symbol: baseToken.symbol,
          decimals: baseToken.decimals,
          address: baseToken.config.address,
        },
        quoteToken: {
          symbol: quoteToken.symbol,
          decimals: quoteToken.decimals,
          address: quoteToken.config.address,
        },
        currentPrice,
        currentTick,
        lowerPrice,
        upperPrice,
        orders,
        curve: curveWithOrderEffects,
      };

      log.methodExit(this.logger, 'generate', {
        positionId: input.positionId,
        pointCount: result.curve.length,
        orderCount: result.orders.length,
      });

      return result;
    } catch (error) {
      log.methodError(this.logger, 'generate', error as Error, {
        positionId: input.positionId,
      });
      throw error;
    }
  }

  /**
   * Fetch position data with related entities
   */
  private async fetchPositionData(positionId: string): Promise<PositionDataForCurve | null> {
    const position = await this.prisma.position.findUnique({
      where: { id: positionId },
      include: {
        pool: {
          include: {
            token0: true,
            token1: true,
          },
        },
        automationOrders: {
          where: {
            status: { in: ['active', 'pending', 'registering'] },
          },
        },
      },
    });

    if (!position) {
      return null;
    }

    return {
      id: position.id,
      protocol: position.protocol,
      isToken0Quote: position.isToken0Quote,
      currentCostBasis: position.currentCostBasis,
      pool: {
        id: position.pool.id,
        protocol: position.pool.protocol,
        feeBps: position.pool.feeBps,
        token0: {
          id: position.pool.token0.id,
          symbol: position.pool.token0.symbol,
          decimals: position.pool.token0.decimals,
          config: position.pool.token0.config,
        },
        token1: {
          id: position.pool.token1.id,
          symbol: position.pool.token1.symbol,
          decimals: position.pool.token1.decimals,
          config: position.pool.token1.config,
        },
        config: position.pool.config,
        state: position.pool.state,
      },
      config: position.config,
      state: position.state,
      automationOrders: position.automationOrders.map((order) => ({
        id: order.id,
        closeOrderType: order.closeOrderType,
        status: order.status,
        config: order.config,
        state: order.state,
      })),
    };
  }

  /**
   * Resolve base and quote tokens based on user preference
   */
  private resolveTokenRoles(
    token0: { id: string; symbol: string; decimals: number; config: unknown },
    token1: { id: string; symbol: string; decimals: number; config: unknown },
    isToken0Quote: boolean
  ): {
    baseToken: { symbol: string; decimals: number; config: Erc20TokenConfig };
    quoteToken: { symbol: string; decimals: number; config: Erc20TokenConfig };
  } {
    const token0Config = token0.config as Erc20TokenConfig;
    const token1Config = token1.config as Erc20TokenConfig;

    if (isToken0Quote) {
      return {
        baseToken: { symbol: token1.symbol, decimals: token1.decimals, config: token1Config },
        quoteToken: { symbol: token0.symbol, decimals: token0.decimals, config: token0Config },
      };
    } else {
      return {
        baseToken: { symbol: token0.symbol, decimals: token0.decimals, config: token0Config },
        quoteToken: { symbol: token1.symbol, decimals: token1.decimals, config: token1Config },
      };
    }
  }

  /**
   * Calculate price boundaries for position range
   */
  private calculateRangePrices(
    tickLower: number,
    tickUpper: number,
    baseToken: { symbol: string; decimals: number; config: Erc20TokenConfig },
    quoteToken: { symbol: string; decimals: number; config: Erc20TokenConfig },
    isToken0Quote: boolean
  ): { lowerPrice: bigint; upperPrice: bigint } {
    const priceAtTickLower = tickToPrice(
      tickLower,
      baseToken.config.address,
      quoteToken.config.address,
      baseToken.decimals
    );

    const priceAtTickUpper = tickToPrice(
      tickUpper,
      baseToken.config.address,
      quoteToken.config.address,
      baseToken.decimals
    );

    // When quote is token0, tick-to-price relationship is inverted
    if (isToken0Quote) {
      return {
        lowerPrice: priceAtTickUpper,
        upperPrice: priceAtTickLower,
      };
    }

    return {
      lowerPrice: priceAtTickLower,
      upperPrice: priceAtTickUpper,
    };
  }

  /**
   * Determine the price range for visualization
   */
  private determinePriceRange(
    inputMin: bigint | undefined,
    inputMax: bigint | undefined,
    lowerPrice: bigint,
    upperPrice: bigint
  ): { priceMin: bigint; priceMax: bigint } {
    // Default: ±50% from position range
    const rangeWidth = upperPrice - lowerPrice;
    const buffer = rangeWidth / 2n;

    const priceMin = inputMin ?? (lowerPrice - buffer > 0n ? lowerPrice - buffer : 1n);
    const priceMax = inputMax ?? upperPrice + buffer;

    return { priceMin, priceMax };
  }

  /**
   * Validate sqrtPriceX96 is within valid Uniswap V3 range
   * MIN_SQRT_RATIO = 4295128739
   * MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342
   */
  private isValidSqrtPriceX96(sqrtPriceX96: bigint): boolean {
    const MIN_SQRT_RATIO = 4295128739n;
    const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;
    return sqrtPriceX96 >= MIN_SQRT_RATIO && sqrtPriceX96 <= MAX_SQRT_RATIO;
  }

  /**
   * Process automation orders into curve-friendly format
   */
  private processOrders(
    orders: { id: string; closeOrderType: string; status: string; config: unknown; state: unknown }[],
    baseToken: { symbol: string; decimals: number; config: Erc20TokenConfig },
    quoteToken: { symbol: string; decimals: number; config: Erc20TokenConfig },
    positionConfig: UniswapV3PositionConfig,
    positionState: UniswapV3PositionState
  ): PnLCurveOrder[] {
    const result: PnLCurveOrder[] = [];

    for (const order of orders) {
      if (order.closeOrderType !== 'uniswapv3') {
        continue;
      }

      const config = order.config as {
        triggerMode: TriggerMode;
        sqrtPriceX96Lower: string;
        sqrtPriceX96Upper: string;
      };

      const status = this.mapOrderStatus(order.status);
      const baseIsToken0 = BigInt(baseToken.config.address) < BigInt(quoteToken.config.address);

      // Process LOWER trigger (stop-loss)
      if (config.triggerMode === 'LOWER' || config.triggerMode === 'BOTH') {
        const sqrtPriceX96Lower = BigInt(config.sqrtPriceX96Lower || '0');

        // Only process if sqrtPriceX96 is valid (not a sentinel value)
        if (this.isValidSqrtPriceX96(sqrtPriceX96Lower)) {
          // Convert BigInt to JSBI for Uniswap SDK compatibility
          const sqrtRatioJSBI = JSBI.BigInt(sqrtPriceX96Lower.toString());
          const triggerTick = TickMath.getTickAtSqrtRatio(sqrtRatioJSBI);

          const triggerPrice = tickToPrice(
            triggerTick,
            baseToken.config.address,
            quoteToken.config.address,
            baseToken.decimals
          );

          const valueAtTrigger = calculatePositionValue(
            positionState.liquidity,
            sqrtPriceX96Lower,
            positionConfig.tickLower,
            positionConfig.tickUpper,
            baseIsToken0
          );

          result.push({
            type: 'stop-loss',
            triggerPrice,
            triggerTick,
            status,
            valueAtTrigger,
          });
        } else {
          this.logger.debug(
            { orderId: order.id, sqrtPriceX96Lower: sqrtPriceX96Lower.toString() },
            'Skipping LOWER trigger: invalid sqrtPriceX96 (sentinel value)'
          );
          // NOTE: No continue! Let code flow to UPPER block for 'BOTH' mode
        }
      }

      // Process UPPER trigger (take-profit)
      if (config.triggerMode === 'UPPER' || config.triggerMode === 'BOTH') {
        const sqrtPriceX96Upper = BigInt(config.sqrtPriceX96Upper || '0');

        // Only process if sqrtPriceX96 is valid (not a sentinel value)
        if (this.isValidSqrtPriceX96(sqrtPriceX96Upper)) {
          // Convert BigInt to JSBI for Uniswap SDK compatibility
          const sqrtRatioJSBI = JSBI.BigInt(sqrtPriceX96Upper.toString());
          const triggerTick = TickMath.getTickAtSqrtRatio(sqrtRatioJSBI);

          const triggerPrice = tickToPrice(
            triggerTick,
            baseToken.config.address,
            quoteToken.config.address,
            baseToken.decimals
          );

          const valueAtTrigger = calculatePositionValue(
            positionState.liquidity,
            sqrtPriceX96Upper,
            positionConfig.tickLower,
            positionConfig.tickUpper,
            baseIsToken0
          );

          result.push({
            type: 'take-profit',
            triggerPrice,
            triggerTick,
            status,
            valueAtTrigger,
          });
        } else {
          this.logger.debug(
            { orderId: order.id, sqrtPriceX96Upper: sqrtPriceX96Upper.toString() },
            'Skipping UPPER trigger: invalid sqrtPriceX96 (sentinel value)'
          );
          // NOTE: No continue!
        }
      }
    }

    return result;
  }

  /**
   * Map database order status to curve-friendly status
   */
  private mapOrderStatus(status: string): OrderStatus {
    switch (status) {
      case 'active':
        return 'active';
      case 'pending':
      case 'registering':
        return 'pending';
      case 'executed':
      case 'triggering':
        return 'executed';
      case 'cancelled':
        return 'cancelled';
      case 'expired':
        return 'expired';
      default:
        return 'pending';
    }
  }

  /**
   * Apply order effects to the PnL curve
   *
   * For stop-loss orders: curve becomes flat at trigger value for all prices below trigger
   * For take-profit orders: curve becomes flat at trigger value for all prices above trigger
   */
  private applyOrderEffects(
    baseCurve: { price: bigint; positionValue: bigint; pnl: bigint; pnlPercent: number; phase: string }[],
    orders: PnLCurveOrder[],
    costBasis: bigint
  ): PnLCurvePoint[] {
    // Find active SL and TP orders
    const stopLoss = orders.find((o) => o.type === 'stop-loss' && o.status === 'active');
    const takeProfit = orders.find((o) => o.type === 'take-profit' && o.status === 'active');

    return baseCurve.map((point) => {
      let adjustedValue = point.positionValue;
      let orderTriggered: OrderType | undefined;

      // Apply stop-loss effect (price below SL trigger)
      if (stopLoss && point.price <= stopLoss.triggerPrice) {
        adjustedValue = stopLoss.valueAtTrigger;
        orderTriggered = 'stop-loss';
      }

      // Apply take-profit effect (price above TP trigger)
      if (takeProfit && point.price >= takeProfit.triggerPrice) {
        adjustedValue = takeProfit.valueAtTrigger;
        orderTriggered = 'take-profit';
      }

      const adjustedPnl = adjustedValue - costBasis;
      const adjustedPnlPercent = costBasis > 0n
        ? Number((adjustedPnl * 10000n) / costBasis) / 100
        : 0;

      return {
        price: point.price,
        positionValue: point.positionValue,
        adjustedValue,
        pnl: point.pnl,
        adjustedPnl,
        pnlPercent: point.pnlPercent,
        adjustedPnlPercent,
        phase: point.phase as 'below' | 'in-range' | 'above',
        orderTriggered,
      };
    });
  }
}
