/**
 * ParaswapSwapService
 *
 * Builds two-phase swap parameters for post-close order execution:
 *   - Phase 1 (Guaranteed): Route through Paraswap with minAmountOut protection
 *   - Phase 2 (Surplus): Handled on-chain by the contract via the position's own pool
 *
 * This service only builds Phase 1 params. Phase 2 is built on-chain in ExecutionFacet.
 */

import type { Address } from 'viem';
import { encodePacked, keccak256, encodeAbiParameters } from 'viem';

import { createServiceLogger } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';
import { CoinGeckoClient } from '../../clients/coingecko/coingecko-client.js';
import { Erc20TokenService } from '../token/erc20-token-service.js';
import {
  getParaswapQuote,
  buildParaswapTransaction,
  isParaswapSupportedChain,
  type ParaswapSupportedChainId,
} from '../../clients/paraswap/index.js';
import type { SwapHop } from './types.js';

// ============================================================================
// Constants
// ============================================================================

/** Paraswap venue identifier for MidcurveSwapRouter */
export const PARASWAP_VENUE_ID = keccak256(
  encodePacked(['string'], ['Paraswap'])
) as `0x${string}`;

/** Swap deadline offset (5 minutes) */
const DEADLINE_OFFSET_SECONDS = 300;

/**
 * Slippage buffer for Paraswap calldata (bps).
 *
 * Augustus V6's simpleSwap enforces its own minDestAmount internally.
 * Setting this to 0 causes Augustus to revert on even tiny price movements
 * (AugustusCallFailed) before our on-chain minAmountOut check fires.
 *
 * We pass a generous buffer here; the real slippage protection is our
 * MidcurveSwapRouter minAmountOut (derived from the CoinGecko fair-value floor).
 */
const PARASWAP_INTERNAL_SLIPPAGE_BPS = 200;

// ============================================================================
// Types
// ============================================================================

export interface ParaswapSwapInput {
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  tokenInDecimals: number;
  tokenOutDecimals: number;
  /** Guaranteed minimum from withdrawal (after fees) — sent through Paraswap */
  guaranteedAmountIn: bigint;
  /** Fair value price protection in basis points (from on-chain swapSlippageBps) */
  swapSlippageBps: number;
  /** ParaswapAdapter deployed address (used as userAddress for Paraswap API) */
  paraswapAdapterAddress: Address;
}

export type ParaswapSwapResult =
  | ParaswapSwapExecute
  | ParaswapSwapDoNotExecute;

export interface ParaswapSwapExecute {
  kind: 'execute';
  minAmountOut: bigint;
  deadline: bigint;
  hops: SwapHop[];
}

export interface ParaswapSwapDoNotExecute {
  kind: 'do_not_execute';
  reason: string;
}

// ============================================================================
// Dependencies
// ============================================================================

export interface ParaswapSwapServiceDependencies {
  coinGeckoClient?: CoinGeckoClient;
  erc20TokenService?: Erc20TokenService;
}

// ============================================================================
// Service
// ============================================================================

export class ParaswapSwapService {
  private readonly coinGeckoClient: CoinGeckoClient;
  private readonly erc20TokenService: Erc20TokenService;
  private readonly logger: ServiceLogger;

  constructor(dependencies: ParaswapSwapServiceDependencies = {}) {
    this.coinGeckoClient =
      dependencies.coinGeckoClient ?? CoinGeckoClient.getInstance();
    this.erc20TokenService =
      dependencies.erc20TokenService ?? new Erc20TokenService();
    this.logger = createServiceLogger('ParaswapSwapService');
  }

  /**
   * Compute Paraswap-based swap parameters for the guaranteed portion of a two-phase swap.
   *
   * 1. Compute CoinGecko fair value floor using swapSlippageBps
   * 2. Get Paraswap quote for guaranteedAmountIn
   * 3. Compare quote vs floor → abort if below
   * 4. Build Paraswap transaction calldata
   * 5. Return SwapParams for on-chain execution
   */
  async computeParaswapSwapParams(
    input: ParaswapSwapInput
  ): Promise<ParaswapSwapResult> {
    const {
      chainId,
      tokenIn,
      tokenOut,
      tokenInDecimals,
      tokenOutDecimals,
      guaranteedAmountIn,
      swapSlippageBps,
      paraswapAdapterAddress,
    } = input;

    if (guaranteedAmountIn === 0n) {
      return {
        kind: 'do_not_execute',
        reason: 'guaranteedAmountIn is zero',
      };
    }

    if (!isParaswapSupportedChain(chainId)) {
      return {
        kind: 'do_not_execute',
        reason: `Chain ${chainId} not supported by Paraswap`,
      };
    }

    const paraswapChainId = chainId as ParaswapSupportedChainId;

    // Step 1: Compute fair value floor from CoinGecko
    const fairValue = await this._computeFairValueFloor(
      chainId,
      tokenIn,
      tokenOut,
      guaranteedAmountIn,
      tokenInDecimals,
      tokenOutDecimals,
      swapSlippageBps
    );

    this.logger.info(
      {
        tokenIn,
        tokenOut,
        guaranteedAmountIn: guaranteedAmountIn.toString(),
        absoluteFloor: fairValue.absoluteFloor.toString(),
        fairPrice: fairValue.fairPrice,
      },
      'Fair value floor computed'
    );

    // Step 2: Get Paraswap quote
    const quote = await getParaswapQuote({
      chainId: paraswapChainId,
      srcToken: tokenIn,
      srcDecimals: tokenInDecimals,
      destToken: tokenOut,
      destDecimals: tokenOutDecimals,
      amount: guaranteedAmountIn.toString(),
      userAddress: paraswapAdapterAddress,
      side: 'SELL',
    });

    const quotedDestAmount = BigInt(quote.destAmount);

    this.logger.info(
      {
        quotedDestAmount: quotedDestAmount.toString(),
        absoluteFloor: fairValue.absoluteFloor.toString(),
        priceImpact: quote.priceImpact,
      },
      'Paraswap quote received'
    );

    // Step 3: Compare quote vs fair value floor
    if (
      fairValue.absoluteFloor > 0n &&
      quotedDestAmount < fairValue.absoluteFloor
    ) {
      return {
        kind: 'do_not_execute',
        reason: `Paraswap quote ${quotedDestAmount.toString()} below fair value floor ${fairValue.absoluteFloor.toString()} (swapSlippageBps=${swapSlippageBps})`,
      };
    }

    // Step 4: Build Paraswap transaction
    // Augustus enforces its own internal minDestAmount. A buffer here prevents
    // AugustusCallFailed reverts on small price movements. Our MidcurveSwapRouter
    // minAmountOut (from the fair-value floor) is the real slippage protection.
    const txResult = await buildParaswapTransaction({
      chainId: paraswapChainId,
      srcToken: tokenIn,
      destToken: tokenOut,
      srcAmount: quote.srcAmount,
      destAmount: quote.destAmount,
      priceRoute: quote.priceRoute,
      userAddress: paraswapAdapterAddress,
      slippageBps: PARASWAP_INTERNAL_SLIPPAGE_BPS,
    });

    // Step 5: Build the Paraswap hop
    // venueData for Paraswap = abi.encode(bytes paraswapCalldata)
    const venueData = encodeAbiParameters(
      [{ type: 'bytes' }],
      [txResult.data]
    ) as `0x${string}`;

    const hop: SwapHop = {
      venueId: PARASWAP_VENUE_ID,
      tokenIn,
      tokenOut,
      venueData,
    };

    // minAmountOut = absoluteFloor if available, otherwise use the quoted amount
    const minAmountOut =
      fairValue.absoluteFloor > 0n ? fairValue.absoluteFloor : quotedDestAmount;

    const deadline = BigInt(
      Math.floor(Date.now() / 1000) + DEADLINE_OFFSET_SECONDS
    );

    this.logger.info(
      {
        minAmountOut: minAmountOut.toString(),
        deadline: deadline.toString(),
        venueId: PARASWAP_VENUE_ID,
      },
      'Paraswap swap params built'
    );

    return {
      kind: 'execute',
      minAmountOut,
      deadline,
      hops: [hop],
    };
  }

  // ==========================================================================
  // Private: Fair Value Floor
  // ==========================================================================

  private async _computeFairValueFloor(
    chainId: number,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    tokenInDecimals: number,
    tokenOutDecimals: number,
    maxDeviationBps: number
  ): Promise<{
    fairPrice: number | null;
    absoluteFloor: bigint;
  }> {
    // Look up CoinGecko IDs: prefer DB, fall back to CoinGecko API
    const [tokenInData, tokenOutData] = await Promise.all([
      this.erc20TokenService.findByAddressAndChain(tokenIn, chainId),
      this.erc20TokenService.findByAddressAndChain(tokenOut, chainId),
    ]);

    let tokenInCoinGeckoId: string | null = tokenInData?.coingeckoId ?? null;
    let tokenOutCoinGeckoId: string | null = tokenOutData?.coingeckoId ?? null;

    if (!tokenInCoinGeckoId) {
      tokenInCoinGeckoId = await this.coinGeckoClient.findCoinByAddress(
        chainId,
        tokenIn
      );
    }
    if (!tokenOutCoinGeckoId) {
      tokenOutCoinGeckoId = await this.coinGeckoClient.findCoinByAddress(
        chainId,
        tokenOut
      );
    }

    if (!tokenInCoinGeckoId || !tokenOutCoinGeckoId) {
      this.logger.warn(
        { tokenInCoinGeckoId, tokenOutCoinGeckoId },
        'Cannot compute fair value: missing CoinGecko IDs'
      );
      return { fairPrice: null, absoluteFloor: 0n };
    }

    try {
      const prices = await this.coinGeckoClient.getSimplePrices([
        tokenInCoinGeckoId,
        tokenOutCoinGeckoId,
      ]);

      const tokenInUsdPrice = prices[tokenInCoinGeckoId]?.usd ?? null;
      const tokenOutUsdPrice = prices[tokenOutCoinGeckoId]?.usd ?? null;

      if (
        tokenInUsdPrice === null ||
        tokenOutUsdPrice === null ||
        tokenOutUsdPrice === 0
      ) {
        this.logger.warn(
          { tokenInUsdPrice, tokenOutUsdPrice },
          'Cannot compute fair value: missing or zero USD prices'
        );
        return { fairPrice: null, absoluteFloor: 0n };
      }

      const fairPrice = tokenInUsdPrice / tokenOutUsdPrice;

      // Compute fair value output in raw units using integer math
      const PRECISION = 10n ** 18n;
      const fairPriceScaled = BigInt(Math.floor(fairPrice * 1e18));

      let fairValueOut: bigint;
      if (tokenOutDecimals >= tokenInDecimals) {
        const decimalAdjustment =
          10n ** BigInt(tokenOutDecimals) / 10n ** BigInt(tokenInDecimals);
        fairValueOut =
          (amountIn * fairPriceScaled * decimalAdjustment) / PRECISION;
      } else {
        const decimalDiff = BigInt(tokenInDecimals - tokenOutDecimals);
        fairValueOut =
          (amountIn * fairPriceScaled) / (PRECISION * 10n ** decimalDiff);
      }

      // absoluteFloor = fairValueOut * (10000 - maxDeviationBps) / 10000
      const absoluteFloor =
        (fairValueOut * BigInt(10000 - maxDeviationBps)) / 10000n;

      return { fairPrice, absoluteFloor };
    } catch (error) {
      this.logger.warn(
        { error },
        'Failed to compute fair value floor — proceeding without floor'
      );
      return { fairPrice: null, absoluteFloor: 0n };
    }
  }
}
