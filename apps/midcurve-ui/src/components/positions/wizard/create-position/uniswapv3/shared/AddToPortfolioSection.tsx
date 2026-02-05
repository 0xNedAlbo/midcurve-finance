'use client';

import { Loader2, Check, Circle, AlertTriangle } from 'lucide-react';

interface AddToPortfolioSectionProps {
  /** Whether the API call is in progress */
  isPending: boolean;
  /** Whether the position was successfully added to portfolio */
  isSuccess: boolean;
  /** Whether there was an error adding to portfolio */
  isError: boolean;
  /** Error object if the API call failed */
  error: Error | null;
}

/**
 * Displays the status of adding a minted position to the user's portfolio.
 *
 * Styled to match other transaction items in the wizard.
 * The API call is triggered automatically - this component displays the status.
 */
export function AddToPortfolioSection({
  isPending,
  isSuccess,
  isError,
  error,
}: AddToPortfolioSectionProps) {
  return (
    <div
      className={`py-3 px-4 rounded-lg transition-colors ${
        isError
          ? 'bg-red-500/10 border border-red-500/30'
          : isSuccess
            ? 'bg-green-500/10 border border-green-500/20'
            : isPending
              ? 'bg-blue-500/10 border border-blue-500/20'
              : 'bg-slate-700/30 border border-slate-600/20'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isSuccess ? (
            <Check className="w-5 h-5 text-green-500" />
          ) : isPending ? (
            <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
          ) : isError ? (
            <AlertTriangle className="w-5 h-5 text-red-400" />
          ) : (
            <Circle className="w-5 h-5 text-slate-400" />
          )}
          <span className="text-white">Add Position to Portfolio</span>
        </div>
      </div>

      {/* Error details */}
      {isError && error && (
        <div className="mt-2 text-sm text-red-300/90 ml-8">
          {error.message}
        </div>
      )}
    </div>
  );
}
