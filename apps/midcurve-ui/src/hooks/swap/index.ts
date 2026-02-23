/**
 * Swap Hooks
 *
 * React hooks for Paraswap (Velora) token swapping functionality.
 */

// Token approval (shared — works for any spender address)
export { useSwapApproval } from './useSwapApproval';
export type { UseSwapApprovalParams, UseSwapApprovalResult } from './useSwapApproval';

// Paraswap hooks (SwapDialog)
export { useParaswapQuote } from './useParaswapQuote';
export type { UseParaswapQuoteParams, UseParaswapQuoteResult } from './useParaswapQuote';

export { useParaswapExecuteSwap } from './useParaswapExecuteSwap';
export type {
  UseParaswapExecuteSwapParams,
  UseParaswapExecuteSwapResult,
  ParaswapExecuteSwapInput,
} from './useParaswapExecuteSwap';
