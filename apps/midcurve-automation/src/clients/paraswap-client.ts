/**
 * Paraswap Client
 *
 * HTTP client for the Paraswap API to get swap quotes and build transactions.
 * Used by the order executor to generate fresh swap calldata at execution time.
 *
 * API Reference: https://developers.paraswap.io/api/get-rate-for-a-token-pair
 */

import type { Address, Hex } from 'viem';
import { automationLogger } from '../lib/logger';

const log = automationLogger.child({ component: 'ParaswapClient' });

// =============================================================================
// Types
// =============================================================================

export type SwapDirection = 'BASE_TO_QUOTE' | 'QUOTE_TO_BASE';

/**
 * Supported chain IDs for Paraswap integration
 * Note: BSC and Polygon excluded per plan requirements
 */
export const PARASWAP_SUPPORTED_CHAINS = [1, 42161, 8453, 10] as const;
export type ParaswapSupportedChainId = (typeof PARASWAP_SUPPORTED_CHAINS)[number];

export interface ParaswapQuoteRequest {
  chainId: ParaswapSupportedChainId;
  srcToken: Address;
  srcDecimals: number;
  destToken: Address;
  destDecimals: number;
  amount: string; // Wei amount as string
  userAddress: Address; // Contract address that will execute the swap
  slippageBps: number; // 0-10000
}

export interface ParaswapPriceRoute {
  blockNumber: number;
  network: number;
  srcToken: string;
  srcDecimals: number;
  srcAmount: string;
  destToken: string;
  destDecimals: number;
  destAmount: string;
  bestRoute: unknown[];
  gasCostUSD: string;
  gasCost: string;
  side: string;
  tokenTransferProxy: string;
  contractAddress: string;
  contractMethod: string;
  srcUSD: string;
  destUSD: string;
  partner: string;
  partnerFee: number;
  maxImpactReached: boolean;
  hmac: string;
}

export interface ParaswapQuoteResult {
  priceRoute: ParaswapPriceRoute;
  srcToken: Address;
  destToken: Address;
  srcAmount: string;
  destAmount: string;
  minDestAmount: string;
  augustusAddress: Address;
  tokenTransferProxy: Address;
}

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

export interface ParaswapTransactionData {
  from: Address;
  to: Address;
  value: string;
  data: Hex;
  gasPrice: string;
  chainId: number;
}

/**
 * Complete swap params ready for contract execution
 */
export interface ParaswapSwapParams {
  augustusAddress: Address;
  spenderAddress: Address;
  swapCalldata: Hex;
  srcToken: Address;
  destToken: Address;
  srcAmount: string;
  destAmount: string;
  minDestAmount: string;
}

// =============================================================================
// Constants
// =============================================================================

const PARASWAP_API_BASE = 'https://api.paraswap.io';
const PARTNER_NAME = 'midcurve';

// =============================================================================
// Client
// =============================================================================

class ParaswapClient {
  /**
   * Check if a chain is supported for Paraswap swaps
   */
  isChainSupported(chainId: number): chainId is ParaswapSupportedChainId {
    return PARASWAP_SUPPORTED_CHAINS.includes(chainId as ParaswapSupportedChainId);
  }

  /**
   * Get a swap quote from Paraswap
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
      slippageBps,
    } = request;

    log.info({
      chainId,
      srcToken,
      destToken,
      amount,
      slippageBps,
      msg: 'Getting Paraswap quote',
    });

    // Build query params
    const params = new URLSearchParams({
      srcToken,
      srcDecimals: srcDecimals.toString(),
      destToken,
      destDecimals: destDecimals.toString(),
      amount,
      side: 'SELL',
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
        msg: 'Paraswap quote request failed',
      });
      throw new Error(`Paraswap quote failed: ${response.status} ${errorBody}`);
    }

    const data = await response.json();
    const priceRoute = data.priceRoute as ParaswapPriceRoute;

    // Calculate min amount with slippage
    const destAmountBigInt = BigInt(priceRoute.destAmount);
    const slippageMultiplier = 10000n - BigInt(slippageBps);
    const minDestAmount = (destAmountBigInt * slippageMultiplier) / 10000n;

    log.info({
      chainId,
      srcToken,
      destToken,
      srcAmount: priceRoute.srcAmount,
      destAmount: priceRoute.destAmount,
      minDestAmount: minDestAmount.toString(),
      msg: 'Paraswap quote received',
    });

    return {
      priceRoute,
      srcToken: srcToken,
      destToken: destToken,
      srcAmount: priceRoute.srcAmount,
      destAmount: priceRoute.destAmount,
      minDestAmount: minDestAmount.toString(),
      augustusAddress: priceRoute.contractAddress as Address,
      tokenTransferProxy: priceRoute.tokenTransferProxy as Address,
    };
  }

  /**
   * Build a swap transaction from a quote
   */
  async buildTransaction(request: ParaswapBuildTxRequest): Promise<ParaswapTransactionData> {
    const {
      chainId,
      srcToken,
      destToken,
      srcAmount,
      destAmount,
      priceRoute,
      userAddress,
      slippageBps,
      deadline,
    } = request;

    log.info({
      chainId,
      srcToken,
      destToken,
      srcAmount,
      userAddress,
      msg: 'Building Paraswap transaction',
    });

    // Calculate min amount with slippage
    const destAmountBigInt = BigInt(destAmount);
    const slippageMultiplier = 10000n - BigInt(slippageBps);
    const minDestAmount = (destAmountBigInt * slippageMultiplier) / 10000n;

    const body = {
      srcToken,
      destToken,
      srcAmount,
      destAmount: minDestAmount.toString(),
      priceRoute,
      userAddress,
      partner: PARTNER_NAME,
      srcDecimals: priceRoute.srcDecimals,
      destDecimals: priceRoute.destDecimals,
      ...(deadline && { deadline }),
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
        status: response.status,
        error: errorBody,
        msg: 'Paraswap build transaction failed',
      });
      throw new Error(`Paraswap build tx failed: ${response.status} ${errorBody}`);
    }

    const txData = (await response.json()) as ParaswapTransactionData;

    log.info({
      chainId,
      to: txData.to,
      dataLength: txData.data.length,
      msg: 'Paraswap transaction built',
    });

    return txData;
  }

  /**
   * Get complete swap params ready for contract execution
   * This is the main method used by the order executor
   */
  async getSwapParams(request: ParaswapQuoteRequest): Promise<ParaswapSwapParams> {
    // Get quote first
    const quote = await this.getQuote(request);

    // Build transaction with the quote
    const txData = await this.buildTransaction({
      chainId: request.chainId,
      srcToken: quote.srcToken,
      destToken: quote.destToken,
      srcAmount: quote.srcAmount,
      destAmount: quote.destAmount,
      priceRoute: quote.priceRoute,
      userAddress: request.userAddress,
      slippageBps: request.slippageBps,
    });

    return {
      augustusAddress: quote.augustusAddress,
      spenderAddress: quote.tokenTransferProxy,
      swapCalldata: txData.data,
      srcToken: quote.srcToken,
      destToken: quote.destToken,
      srcAmount: quote.srcAmount,
      destAmount: quote.destAmount,
      minDestAmount: quote.minDestAmount,
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

export { ParaswapClient };
