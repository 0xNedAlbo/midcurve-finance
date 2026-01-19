/**
 * ParaSwap Client
 *
 * HTTP client for the ParaSwap API to fetch token lists, quotes, and build transactions.
 * Used by both midcurve-api (for the swap widget) and midcurve-automation (for order execution).
 *
 * API Reference: https://developers.paraswap.io/api/get-rate-for-a-token-pair
 */

import type { Address, Hex } from 'viem';
import {
  type ParaswapPriceRoute,
  type ParaswapSupportedChainId,
  PARASWAP_SUPPORTED_CHAIN_IDS,
  isParaswapSupportedChain,
} from '@midcurve/api-shared';
import { logger } from '../../logging/index.js';

const log = logger.child({ component: 'ParaswapClient' });

// =============================================================================
// Constants
// =============================================================================

const PARASWAP_API_BASE = 'https://api.paraswap.io';
const PARTNER_NAME = 'midcurve';

/** Default quote validity in seconds (5 minutes) */
const DEFAULT_QUOTE_VALIDITY_SECONDS = 300;

/** Default slippage in basis points (0.5%) */
const DEFAULT_SLIPPAGE_BPS = 50;

// =============================================================================
// Types
// =============================================================================

/** Swap side: SELL = fixed input, BUY = fixed output */
export type ParaswapSide = 'SELL' | 'BUY';

/** Request to get a swap quote */
export interface ParaswapQuoteRequest {
  chainId: ParaswapSupportedChainId;
  srcToken: Address;
  srcDecimals: number;
  destToken: Address;
  destDecimals: number;
  /** Amount in wei. For SELL: srcAmount, for BUY: destAmount */
  amount: string;
  userAddress: Address;
  /** SELL (default) = fixed input, BUY = fixed output */
  side?: ParaswapSide;
  slippageBps?: number;
}

/** Result of a swap quote */
export interface ParaswapQuoteResult {
  priceRoute: ParaswapPriceRoute;
  srcToken: Address;
  destToken: Address;
  srcAmount: string;
  destAmount: string;
  minDestAmount: string;
  priceImpact: number;
  gasCostUSD: string;
  gasCostWei: string;
  augustusAddress: Address;
  tokenTransferProxy: Address;
  expiresAt: string;
}

/** Request to build a swap transaction */
export interface ParaswapBuildTxRequest {
  chainId: ParaswapSupportedChainId;
  srcToken: Address;
  destToken: Address;
  srcAmount: string;
  destAmount: string;
  priceRoute: ParaswapPriceRoute;
  userAddress: Address;
  slippageBps: number;
  deadline?: number;
}

/** Raw transaction data from ParaSwap API */
export interface ParaswapTransactionData {
  from: Address;
  to: Address;
  value: string;
  data: Hex;
  gasPrice: string;
  chainId: number;
  gas?: string;
  swapAllBalanceOffset?: number;
}

/** Result of building a swap transaction */
export interface ParaswapTransactionResult {
  to: Address;
  data: Hex;
  value: string;
  gasLimit: string;
  minDestAmount: string;
  deadline: number;
}

/** Complete swap params ready for contract execution (used by automation) */
export interface ParaswapSwapParams {
  augustusAddress: Address;
  spenderAddress: Address;
  swapCalldata: Hex;
  srcToken: Address;
  destToken: Address;
  srcAmount: string;
  destAmount: string;
  minDestAmount: string;
  swapAllBalanceOffset: number;
}

// =============================================================================
// Errors
// =============================================================================

export class ParaswapApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: string
  ) {
    super(message);
    this.name = 'ParaswapApiError';
  }
}

export class ParaswapChainNotSupportedError extends Error {
  constructor(chainId: number) {
    super(
      `Chain ${chainId} is not supported by ParaSwap. Supported chains: ${PARASWAP_SUPPORTED_CHAIN_IDS.join(', ')}`
    );
    this.name = 'ParaswapChainNotSupportedError';
  }
}

// =============================================================================
// Client
// =============================================================================

export class ParaswapClient {
  /**
   * Check if a chain is supported for ParaSwap swaps
   */
  isChainSupported(chainId: number): chainId is ParaswapSupportedChainId {
    return isParaswapSupportedChain(chainId);
  }

  /**
   * Get a swap quote from ParaSwap
   */
  async getQuote(request: ParaswapQuoteRequest): Promise<ParaswapQuoteResult> {
    const {
      chainId,
      srcToken,
      srcDecimals,
      destToken,
      destDecimals,
      amount,
      userAddress,
      side = 'SELL',
      slippageBps = DEFAULT_SLIPPAGE_BPS,
    } = request;

    log.info({
      chainId,
      srcToken,
      destToken,
      amount,
      side,
      slippageBps,
      msg: 'Getting ParaSwap quote',
    });

    // Build query params
    const params = new URLSearchParams({
      srcToken,
      srcDecimals: srcDecimals.toString(),
      destToken,
      destDecimals: destDecimals.toString(),
      amount,
      side,
      network: chainId.toString(),
      partner: PARTNER_NAME,
      userAddress,
    });

    const url = `${PARASWAP_API_BASE}/prices?${params}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorBody = await response.text();
      log.error({
        chainId,
        srcToken,
        destToken,
        status: response.status,
        error: errorBody,
        msg: 'ParaSwap quote request failed',
      });
      throw new ParaswapApiError(
        `ParaSwap quote failed: ${response.status}`,
        response.status,
        errorBody
      );
    }

    const data = (await response.json()) as { priceRoute: ParaswapPriceRoute };
    const priceRoute = data.priceRoute;

    // Calculate min amount with slippage
    const destAmountBigInt = BigInt(priceRoute.destAmount);
    const slippageMultiplier = 10000n - BigInt(slippageBps);
    const minDestAmount = (destAmountBigInt * slippageMultiplier) / 10000n;

    // Calculate price impact
    const srcUSD = parseFloat(priceRoute.srcUSD);
    const destUSD = parseFloat(priceRoute.destUSD);
    const priceImpact = srcUSD > 0 ? (srcUSD - destUSD) / srcUSD : 0;

    // Calculate expiration (current time + validity period)
    const expiresAt = new Date(Date.now() + DEFAULT_QUOTE_VALIDITY_SECONDS * 1000).toISOString();

    log.info({
      chainId,
      srcToken,
      destToken,
      srcAmount: priceRoute.srcAmount,
      destAmount: priceRoute.destAmount,
      minDestAmount: minDestAmount.toString(),
      priceImpact,
      expiresAt,
      msg: 'ParaSwap quote received',
    });

    return {
      priceRoute,
      srcToken,
      destToken,
      srcAmount: priceRoute.srcAmount,
      destAmount: priceRoute.destAmount,
      minDestAmount: minDestAmount.toString(),
      priceImpact,
      gasCostUSD: priceRoute.gasCostUSD,
      gasCostWei: priceRoute.gasCost,
      augustusAddress: priceRoute.contractAddress as Address,
      tokenTransferProxy: priceRoute.tokenTransferProxy as Address,
      expiresAt,
    };
  }

  /**
   * Build a swap transaction from a quote
   */
  async buildTransaction(request: ParaswapBuildTxRequest): Promise<ParaswapTransactionResult> {
    const {
      chainId,
      srcToken,
      destToken,
      srcAmount,
      destAmount,
      priceRoute,
      userAddress,
      slippageBps,
      deadline: customDeadline,
    } = request;

    const side = priceRoute.side as ParaswapSide;

    log.info({
      chainId,
      srcToken,
      destToken,
      srcAmount,
      destAmount,
      side,
      slippageBps,
      userAddress,
      msg: 'Building ParaSwap transaction',
    });

    // Calculate deadline (5 minutes from now, or custom)
    const deadline = customDeadline || Math.floor(Date.now() / 1000) + DEFAULT_QUOTE_VALIDITY_SECONDS;

    // Slippage handling depends on swap side:
    // - SELL: User sells exact srcAmount, receives at least minDestAmount (slippage on dest)
    // - BUY: User receives exact destAmount, pays at most maxSrcAmount (slippage on src)
    let txSrcAmount: string;
    let txDestAmount: string;
    let minDestAmount: string;

    if (side === 'BUY') {
      // BUY: destAmount is fixed (user wants exact amount), apply slippage to srcAmount
      const srcAmountBigInt = BigInt(srcAmount);
      const slippageMultiplier = 10000n + BigInt(slippageBps); // Add slippage (max willing to pay)
      const maxSrcAmount = (srcAmountBigInt * slippageMultiplier) / 10000n;

      txSrcAmount = maxSrcAmount.toString();
      txDestAmount = destAmount; // Keep exact destAmount from quote
      minDestAmount = destAmount; // For BUY, min received = exact amount wanted
    } else {
      // SELL: srcAmount is fixed (user sells exact amount), apply slippage to destAmount
      const destAmountBigInt = BigInt(destAmount);
      const slippageMultiplier = 10000n - BigInt(slippageBps); // Subtract slippage (min willing to receive)
      const minDest = (destAmountBigInt * slippageMultiplier) / 10000n;

      txSrcAmount = srcAmount; // Keep exact srcAmount
      txDestAmount = minDest.toString(); // Use minDestAmount with slippage
      minDestAmount = minDest.toString();
    }

    const body = {
      srcToken,
      destToken,
      srcAmount: txSrcAmount,
      destAmount: txDestAmount,
      priceRoute,
      userAddress,
      partner: PARTNER_NAME,
      srcDecimals: priceRoute.srcDecimals,
      destDecimals: priceRoute.destDecimals,
      deadline,
    };

    const url = `${PARASWAP_API_BASE}/transactions/${chainId}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      log.error({
        chainId,
        srcToken,
        destToken,
        srcAmount,
        minDestAmount: minDestAmount.toString(),
        userAddress,
        deadline,
        status: response.status,
        errorBody,
        requestBody: body,
        msg: 'ParaSwap build transaction failed',
      });
      throw new ParaswapApiError(
        `ParaSwap build tx failed: ${response.status} - ${errorBody}`,
        response.status,
        errorBody
      );
    }

    const txData = (await response.json()) as ParaswapTransactionData;

    log.info({
      chainId,
      to: txData.to,
      dataLength: txData.data?.length,
      deadline,
      msg: 'ParaSwap transaction built',
    });

    return {
      to: txData.to,
      data: txData.data,
      value: txData.value || '0',
      gasLimit: txData.gas || '500000',
      minDestAmount: minDestAmount.toString(),
      deadline,
    };
  }

  /**
   * Get complete swap params ready for contract execution
   * This is the main method used by the order executor in midcurve-automation
   */
  async getSwapParams(request: ParaswapQuoteRequest): Promise<ParaswapSwapParams> {
    const slippageBps = request.slippageBps || DEFAULT_SLIPPAGE_BPS;

    // Get quote first
    const quote = await this.getQuote({ ...request, slippageBps });

    // Build transaction with the quote
    const txResult = await this.buildTransaction({
      chainId: request.chainId,
      srcToken: quote.srcToken,
      destToken: quote.destToken,
      srcAmount: quote.srcAmount,
      destAmount: quote.destAmount,
      priceRoute: quote.priceRoute,
      userAddress: request.userAddress,
      slippageBps,
    });

    return {
      augustusAddress: quote.augustusAddress,
      spenderAddress: quote.tokenTransferProxy,
      swapCalldata: txResult.data,
      srcToken: quote.srcToken,
      destToken: quote.destToken,
      srcAmount: quote.srcAmount,
      destAmount: quote.destAmount,
      minDestAmount: txResult.minDestAmount,
      swapAllBalanceOffset: 0, // ParaSwap doesn't provide this in the new format
    };
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _paraswapClient: ParaswapClient | null = null;

export function getParaswapClient(): ParaswapClient {
  if (!_paraswapClient) {
    _paraswapClient = new ParaswapClient();
  }
  return _paraswapClient;
}
