/**
 * Parse transaction errors from wagmi into user-friendly messages
 */

export interface ParsedTransactionError {
  title: string;
  message: string;
  canRetry: boolean;
}

export function parseTransactionError(error: Error): ParsedTransactionError {
  const errorMessage = error.message.toLowerCase();
  const errorString = error.toString().toLowerCase();

  // User rejected transaction
  if (
    errorMessage.includes('user rejected') ||
    errorMessage.includes('user denied') ||
    errorMessage.includes('user cancelled') ||
    errorMessage.includes('user canceled') ||
    errorString.includes('user rejected')
  ) {
    return {
      title: 'Transaction Cancelled',
      message: 'You cancelled the transaction in your wallet.',
      canRetry: true,
    };
  }

  // Out of gas (transaction ran out of gas during execution)
  if (errorMessage.includes('out of gas')) {
    return {
      title: 'Out of Gas',
      message: 'The transaction ran out of gas during execution. This usually means the gas limit was set too low. Try again with a higher gas limit.',
      canRetry: true,
    };
  }

  // Insufficient funds for gas
  if (
    errorMessage.includes('insufficient funds') ||
    errorMessage.includes('insufficient gas')
  ) {
    return {
      title: 'Insufficient Funds',
      message: 'You don\'t have enough ETH to pay for gas fees. Add ETH to your wallet and try again.',
      canRetry: true,
    };
  }

  // Slippage exceeded
  if (
    errorMessage.includes('slippage') ||
    errorMessage.includes('price') ||
    errorMessage.includes('too little received')
  ) {
    return {
      title: 'Slippage Exceeded',
      message: 'The price moved beyond your slippage tolerance. Try increasing slippage or wait for better conditions.',
      canRetry: true,
    };
  }

  // Invalid tick alignment (Uniswap V3 specific)
  if (errorMessage.includes('tick') || errorMessage.includes('ticklower') || errorMessage.includes('tickupper')) {
    return {
      title: 'Invalid Price Range',
      message: 'The selected price range is not aligned with the pool\'s tick spacing. Please adjust your range.',
      canRetry: true,
    };
  }

  // Insufficient token balance
  if (
    errorMessage.includes('insufficient balance') ||
    errorMessage.includes('insufficient allowance') ||
    errorMessage.includes('transfer amount exceeds balance')
  ) {
    return {
      title: 'Insufficient Token Balance',
      message: 'You don\'t have enough tokens for this transaction. Check your wallet balance.',
      canRetry: false,
    };
  }

  // Network errors
  if (
    errorMessage.includes('network') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('connection') ||
    errorMessage.includes('fetch failed')
  ) {
    return {
      title: 'Network Error',
      message: 'Connection to the blockchain failed. Check your internet connection and try again.',
      canRetry: true,
    };
  }

  // Contract execution reverted (generic)
  if (
    errorMessage.includes('execution reverted') ||
    errorMessage.includes('revert') ||
    errorMessage.includes('reverted')
  ) {
    // Try to extract revert reason if available
    const revertReasonMatch = errorMessage.match(/reason="([^"]+)"/);
    const revertReason = revertReasonMatch ? revertReasonMatch[1] : null;

    return {
      title: 'Transaction Failed',
      message: revertReason
        ? `The contract rejected the transaction: ${revertReason}`
        : 'The smart contract rejected this transaction. This may be due to invalid parameters or contract conditions.',
      canRetry: false,
    };
  }

  // Nonce too low (transaction already processed or replaced)
  if (errorMessage.includes('nonce too low') || errorMessage.includes('already known')) {
    return {
      title: 'Transaction Already Processed',
      message: 'This transaction was already processed or replaced. Please refresh the page.',
      canRetry: false,
    };
  }

  // Generic fallback
  return {
    title: 'Transaction Failed',
    message: error.message || 'An unexpected error occurred. Please try again.',
    canRetry: true,
  };
}
