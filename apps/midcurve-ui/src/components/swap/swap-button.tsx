/**
 * Swap Button Component
 *
 * Multi-state button that handles the swap flow:
 * - Select token
 * - Approve
 * - Swap
 * - Success
 */

'use client';

interface SwapButtonProps {
  hasSourceToken: boolean;
  hasQuote: boolean;
  isExpired: boolean;
  insufficientBalance: boolean;
  isLoadingBalance: boolean;
  needsApproval: boolean;
  isLoadingAllowance: boolean;
  isApproved: boolean;
  isApproving: boolean;
  isSwapping: boolean;
  isSuccess: boolean;
  sourceSymbol: string | undefined;
  onApprove: () => void;
  onSwap: () => void;
  onRefresh: () => void;
}

/**
 * Multi-state swap button
 */
export function SwapButton({
  hasSourceToken,
  hasQuote,
  isExpired,
  insufficientBalance,
  isLoadingBalance,
  needsApproval,
  isLoadingAllowance,
  isApproved,
  isApproving,
  isSwapping,
  isSuccess,
  sourceSymbol,
  onApprove,
  onSwap,
  onRefresh,
}: SwapButtonProps) {
  // Determine button state
  const getButtonConfig = () => {
    // Success state
    if (isSuccess) {
      return {
        text: 'Success!',
        disabled: true,
        onClick: () => {},
        className: 'bg-green-500 text-white',
      };
    }

    // No token selected
    if (!hasSourceToken) {
      return {
        text: 'Select a token',
        disabled: true,
        onClick: () => {},
        className: 'bg-slate-700 text-slate-400',
      };
    }

    // Loading quote
    if (!hasQuote) {
      return {
        text: 'Fetching quote...',
        disabled: true,
        onClick: () => {},
        className: 'bg-slate-700 text-slate-400',
      };
    }

    // Quote expired
    if (isExpired) {
      return {
        text: 'Refresh Quote',
        disabled: false,
        onClick: onRefresh,
        className: 'bg-amber-500 hover:bg-amber-600 text-slate-900',
      };
    }

    // Loading balance
    if (isLoadingBalance) {
      return {
        text: 'Checking balance...',
        disabled: true,
        onClick: () => {},
        className: 'bg-slate-700 text-slate-400',
      };
    }

    // Insufficient balance
    if (insufficientBalance) {
      return {
        text: `Insufficient ${sourceSymbol} balance`,
        disabled: true,
        onClick: () => {},
        className: 'bg-slate-700 text-slate-400',
      };
    }

    // Loading allowance
    if (isLoadingAllowance) {
      return {
        text: 'Checking approval...',
        disabled: true,
        onClick: () => {},
        className: 'bg-slate-700 text-slate-400',
      };
    }

    // Needs approval
    if (needsApproval && !isApproved) {
      if (isApproving) {
        return {
          text: 'Approving...',
          disabled: true,
          onClick: () => {},
          className: 'bg-amber-500/50 text-slate-900',
        };
      }
      return {
        text: `Approve ${sourceSymbol}`,
        disabled: false,
        onClick: onApprove,
        className: 'bg-amber-500 hover:bg-amber-600 text-slate-900',
      };
    }

    // Swapping
    if (isSwapping) {
      return {
        text: 'Swapping...',
        disabled: true,
        onClick: () => {},
        className: 'bg-amber-500/50 text-slate-900',
      };
    }

    // Ready to swap
    return {
      text: 'Swap',
      disabled: false,
      onClick: onSwap,
      className: 'bg-amber-500 hover:bg-amber-600 text-slate-900',
    };
  };

  const config = getButtonConfig();

  return (
    <button
      onClick={config.onClick}
      disabled={config.disabled}
      className={`w-full py-3 px-4 rounded-lg font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed ${config.className}`}
    >
      {config.text}
    </button>
  );
}
