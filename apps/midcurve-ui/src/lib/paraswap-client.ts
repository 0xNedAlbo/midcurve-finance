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

export interface ParaswapBuildTxRequest {
  chainId: ParaswapSupportedChainId;
  srcToken: string;
  destToken: string;
  srcAmount: string;
  destAmount: string;
  priceRoute: ParaswapPriceRoute;
  userAddress: string;
  slippageBps: number;
}

export interface ParaswapTransactionResult {
  to: Address;
  data: Hex;
  value: string;
  gasLimit: string;
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
 * Build a swap transaction from a quote
 */
export async function buildParaswapTransaction(
  request: ParaswapBuildTxRequest
): Promise<ParaswapTransactionResult> {
  const {
    chainId,
    srcToken,
    destToken,
    srcAmount,
    destAmount,
    priceRoute,
    userAddress,
    slippageBps,
  } = request;

  const side = priceRoute.side as ParaswapSide;
  const deadline = Math.floor(Date.now() / 1000) + DEFAULT_QUOTE_VALIDITY_SECONDS;

  // Slippage handling depends on swap side:
  // SELL: user sells exact srcAmount, receives at least minDestAmount
  // BUY: user receives exact destAmount, pays at most maxSrcAmount
  let txSrcAmount: string;
  let txDestAmount: string;

  if (side === 'BUY') {
    const srcAmountBigInt = BigInt(srcAmount);
    const slippageMultiplier = 10000n + BigInt(slippageBps);
    const maxSrcAmount = (srcAmountBigInt * slippageMultiplier) / 10000n;
    txSrcAmount = maxSrcAmount.toString();
    txDestAmount = destAmount;
  } else {
    const destAmountBigInt = BigInt(destAmount);
    const slippageMultiplier = 10000n - BigInt(slippageBps);
    const minDest = (destAmountBigInt * slippageMultiplier) / 10000n;
    txSrcAmount = srcAmount;
    txDestAmount = minDest.toString();
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new ParaswapApiError(
      `Paraswap build tx failed: ${response.status} - ${errorBody}`,
      response.status,
      errorBody
    );
  }

  const txData = (await response.json()) as {
    from: string;
    to: string;
    value: string;
    data: string;
    gas?: string;
    chainId: number;
  };

  return {
    to: txData.to as Address,
    data: txData.data as Hex,
    value: txData.value || '0',
    gasLimit: txData.gas || '500000',
  };
}
