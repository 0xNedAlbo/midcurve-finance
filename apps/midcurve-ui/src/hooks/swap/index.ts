/**
 * Swap Hooks
 *
 * React hooks for token swapping functionality.
 * - ParaSwap hooks (useSwapQuote, useExecuteSwap) used by SwapWidget
 * - MidcurveSwapRouter hooks (useRouterSwapQuote, useRouterExecuteSwap) used by SwapDialog
 */

// ParaSwap hooks (SwapWidget)
export { useSwapQuote } from './useSwapQuote';
export type { UseSwapQuoteParams, UseSwapQuoteResult } from './useSwapQuote';

export { useSwapApproval } from './useSwapApproval';
export type { UseSwapApprovalParams, UseSwapApprovalResult } from './useSwapApproval';

export { useExecuteSwap } from './useExecuteSwap';
export type {
  UseExecuteSwapParams,
  UseExecuteSwapResult,
  ExecuteSwapInput,
} from './useExecuteSwap';

// MidcurveSwapRouter hooks (SwapDialog)
export { useSwapRouterSupportedChains } from './useSwapRouterSupportedChains';
export type { UseSwapRouterSupportedChainsResult } from './useSwapRouterSupportedChains';

export { useRouterSwapQuote } from './useRouterSwapQuote';
export type { UseRouterSwapQuoteParams, UseRouterSwapQuoteResult } from './useRouterSwapQuote';

export { useRouterExecuteSwap } from './useRouterExecuteSwap';
export type {
  UseRouterExecuteSwapParams,
  UseRouterExecuteSwapResult,
  RouterExecuteSwapInput,
} from './useRouterExecuteSwap';
