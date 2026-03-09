/**
 * Paraswap (Velora) Client — Frontend-Only
 *
 * Calls the public Paraswap API directly from the browser.
 * No API key required. Supports both SELL (exact input) and BUY (exact output).
 *
 * API docs: https://developers.velora.xyz
 */

import type { Address, Hex } from 'viem';

// =============================================================================
// Constants
// =============================================================================

const PARASWAP_API_BASE = 'https://api.paraswap.io';
const PARTNER_NAME = 'midcurve';

/** Default quote validity in seconds (5 minutes) */
const DEFAULT_QUOTE_VALIDITY_SECONDS = 300;

/** Chains supported by Paraswap */
export const PARASWAP_SUPPORTED_CHAIN_IDS = [1, 42161, 8453, 10] as const;
export type ParaswapSupportedChainId = (typeof PARASWAP_SUPPORTED_CHAIN_IDS)[number];

export function isParaswapSupportedChain(chainId: number): chainId is ParaswapSupportedChainId {
  return (PARASWAP_SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

// =============================================================================
// Types
// =============================================================================

export type ParaswapSide = 'SELL' | 'BUY';

export interface ParaswapQuoteRequest {
  chainId: ParaswapSupportedChainId;
  srcToken: string;
  srcDecimals: number;
  destToken: string;
  destDecimals: number;
  /** Amount in wei. For SELL: srcAmount, for BUY: destAmount */
  amount: string;
  userAddress: string;
  side?: ParaswapSide;
}

/** The priceRoute object returned by Paraswap's /prices endpoint */
export interface ParaswapPriceRoute {
  srcToken: string;
  srcDecimals: number;
  srcAmount: string;
  srcUSD: string;
  destToken: string;
  destDecimals: number;
  destAmount: string;
  destUSD: string;
  gasCost: string;
  gasCostUSD: string;
  side: string;
  contractAddress: string;
  tokenTransferProxy: string;
  contractMethod: string;
  [key: string]: unknown;
}

export interface ParaswapQuoteResult {
  priceRoute: ParaswapPriceRoute;
  srcToken: string;
  destToken: string;
  srcAmount: string;
  destAmount: string;
  priceImpact: number;
  gasCostUSD: string;
  gasCostWei: string;
  /** The address that needs token approval (Paraswap's TokenTransferProxy) */
  tokenTransferProxy: Address;
  /** The Augustus swap contract address */
  augustusAddress: Address;
  expiresAt: string;
  side: ParaswapSide;
}

export interface ParaswapSwapRequest {
  chainId: ParaswapSupportedChainId;
  srcToken: string;
  srcDecimals: number;
  destToken: string;
  destDecimals: number;
  /** Amount in wei. For SELL: srcAmount, for BUY: destAmount */
  amount: string;
  userAddress: string;
  side: ParaswapSide;
  /** Slippage tolerance in basis points (e.g. 50 = 0.5%) */
  slippageBps: number;
}

export interface ParaswapSwapResult {
  to: Address;
  data: Hex;
  value: string;
  chainId: number;
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

// =============================================================================
// Client Functions
// =============================================================================

/**
 * Get a swap quote from Paraswap
 */
export async function getParaswapQuote(request: ParaswapQuoteRequest): Promise<ParaswapQuoteResult> {
  const {
    chainId,
    srcToken,
    srcDecimals,
    destToken,
    destDecimals,
    amount,
    userAddress,
    side = 'SELL',
  } = request;

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
    throw new ParaswapApiError(
      `Paraswap quote failed: ${response.status}`,
      response.status,
      errorBody
    );
  }

  const data = (await response.json()) as { priceRoute: ParaswapPriceRoute };
  const priceRoute = data.priceRoute;

  // Calculate price impact
  const srcUSD = parseFloat(priceRoute.srcUSD);
  const destUSD = parseFloat(priceRoute.destUSD);
  const priceImpact = srcUSD > 0 ? (srcUSD - destUSD) / srcUSD : 0;

  const expiresAt = new Date(Date.now() + DEFAULT_QUOTE_VALIDITY_SECONDS * 1000).toISOString();

  return {
    priceRoute,
    srcToken: priceRoute.srcToken,
    destToken: priceRoute.destToken,
    srcAmount: priceRoute.srcAmount,
    destAmount: priceRoute.destAmount,
    priceImpact,
    gasCostUSD: priceRoute.gasCostUSD,
    gasCostWei: priceRoute.gasCost,
    augustusAddress: priceRoute.contractAddress as Address,
    tokenTransferProxy: priceRoute.tokenTransferProxy as Address,
    expiresAt,
    side,
  };
}

/**
 * Get a fresh quote + ready-to-submit tx calldata in a single atomic API call.
 * Uses Velora's /swap endpoint to eliminate staleness between quote and tx build.
 * Docs: https://developers.velora.xyz/api/velora-api/velora-market-api/get-rate-for-a-token-pair-1
 */
export async function getParaswapSwap(
  request: ParaswapSwapRequest
): Promise<ParaswapSwapResult> {
  const {
    chainId,
    srcToken,
    srcDecimals,
    destToken,
    destDecimals,
    amount,
    userAddress,
    side,
    slippageBps,
  } = request;

  const params = new URLSearchParams({
    srcToken,
    srcDecimals: srcDecimals.toString(),
    destToken,
    destDecimals: destDecimals.toString(),
    amount,
    side,
    network: chainId.toString(),
    slippage: slippageBps.toString(),
    userAddress,
    partner: PARTNER_NAME,
  });

  const url = `${PARASWAP_API_BASE}/swap?${params}`;
  const response = await fetch(url);

  if (!response.ok) {
    const errorBody = await response.text();
    throw new ParaswapApiError(
      `Paraswap swap failed: ${response.status} - ${errorBody}`,
      response.status,
      errorBody
    );
  }

  const data = (await response.json()) as {
    priceRoute: ParaswapPriceRoute;
    txParams: {
      from: string;
      to: string;
      value: string;
      data: string;
      chainId: number;
    };
  };

  return {
    to: data.txParams.to as Address,
    data: data.txParams.data as Hex,
    value: data.txParams.value || '0',
    chainId: data.txParams.chainId,
  };
}
