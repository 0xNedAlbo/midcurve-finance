/**
 * Close Order Review Step
 *
 * Step 2: Review order summary before confirmation
 */

import { AlertCircle, TrendingDown, TrendingUp, ArrowLeftRight, Info } from 'lucide-react';
import type { TriggerMode } from '@midcurve/api-shared';
import type { CloseOrderFormData } from '../CloseOrderModal';

interface CloseOrderReviewStepProps {
  formData: CloseOrderFormData;
  baseToken: {
    address: string;
    symbol: string;
    decimals: number;
  };
  quoteToken: {
    address: string;
    symbol: string;
    decimals: number;
  };
  error: string | null;
  /**
   * Whether a contract deployment is needed
   */
  needsDeploy?: boolean;
  /**
   * Whether operator approval is needed
   */
  needsApproval?: boolean;
}

function getTriggerModeIcon(mode: TriggerMode) {
  switch (mode) {
    case 'LOWER':
      return <TrendingDown className="w-5 h-5 text-red-400" />;
    case 'UPPER':
      return <TrendingUp className="w-5 h-5 text-green-400" />;
    case 'BOTH':
      return <ArrowLeftRight className="w-5 h-5 text-blue-400" />;
  }
}

function getTriggerModeLabel(mode: TriggerMode): string {
  switch (mode) {
    case 'LOWER':
      return 'Stop-Loss';
    case 'UPPER':
      return 'Take-Profit';
    case 'BOTH':
      return 'Range Exit';
  }
}

export function CloseOrderReviewStep({
  formData,
  baseToken,
  quoteToken,
  error,
  needsDeploy = false,
  needsApproval = false,
}: CloseOrderReviewStepProps) {
  // Calculate expiration date
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + formData.validUntilDays);

  return (
    <div className="space-y-6">
      <div className="text-center mb-4">
        <h3 className="text-lg font-semibold text-slate-200">Review Your Order</h3>
        <p className="text-sm text-slate-400 mt-1">
          Please review the details before confirming
        </p>
      </div>

      {/* Order Summary */}
      <div className="bg-slate-700/30 rounded-lg divide-y divide-slate-600/50">
        {/* Trigger Mode */}
        <div className="p-4 flex items-center justify-between">
          <span className="text-slate-400">Order Type</span>
          <div className="flex items-center gap-2">
            {getTriggerModeIcon(formData.triggerMode)}
            <span className="text-white font-medium">{getTriggerModeLabel(formData.triggerMode)}</span>
          </div>
        </div>

        {/* Lower Price */}
        {(formData.triggerMode === 'LOWER' || formData.triggerMode === 'BOTH') && (
          <div className="p-4 flex items-center justify-between">
            <span className="text-slate-400">Lower Trigger</span>
            <span className="text-red-400 font-mono">
              {formData.priceLowerDisplay} {quoteToken.symbol}
            </span>
          </div>
        )}

        {/* Upper Price */}
        {(formData.triggerMode === 'UPPER' || formData.triggerMode === 'BOTH') && (
          <div className="p-4 flex items-center justify-between">
            <span className="text-slate-400">Upper Trigger</span>
            <span className="text-green-400 font-mono">
              {formData.priceUpperDisplay} {quoteToken.symbol}
            </span>
          </div>
        )}

        {/* Slippage */}
        <div className="p-4 flex items-center justify-between">
          <span className="text-slate-400">Slippage Tolerance</span>
          <span className="text-slate-200">{(formData.slippageBps / 100).toFixed(1)}%</span>
        </div>

        {/* Expiration */}
        <div className="p-4 flex items-center justify-between">
          <span className="text-slate-400">Valid Until</span>
          <span className="text-slate-200">{expirationDate.toLocaleDateString()}</span>
        </div>

        {/* Token Pair */}
        <div className="p-4 flex items-center justify-between">
          <span className="text-slate-400">Token Pair</span>
          <span className="text-slate-200">
            {baseToken.symbol}/{quoteToken.symbol}
          </span>
        </div>
      </div>

      {/* Error Display - shown prominently after summary */}
      {error && (
        <div className="flex items-start gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-400">Order Failed</p>
            <p className="text-sm text-red-300 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Setup Notice - shown when deploy or approval needed */}
      {(needsDeploy || needsApproval) && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-blue-300 mb-2">One-time Setup Required</h4>
              <p className="text-xs text-slate-400 mb-3">
                {needsDeploy
                  ? 'This is your first close order on this chain. You will need to deploy your automation contract first.'
                  : 'You need to approve the automation contract to manage your position.'}
              </p>
              <div className="text-xs text-slate-400 space-y-1">
                <p className="font-medium text-slate-300">You will be asked to sign:</p>
                <ul className="list-disc list-inside ml-1 space-y-0.5">
                  {needsDeploy && <li>Deploy automation contract (gas required)</li>}
                  {needsApproval && <li>Approve operator permissions (gas required)</li>}
                  <li>Register close order (gas required)</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* What Happens Next */}
      <div className="bg-slate-800/50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-slate-300 mb-2">What happens next?</h4>
        <ul className="text-xs text-slate-400 space-y-1">
          <li>1. Your close order will be registered on-chain</li>
          <li>2. We monitor the pool price continuously</li>
          <li>3. When price reaches your trigger, we execute the close</li>
          <li>4. Funds are sent directly to your wallet</li>
        </ul>
      </div>
    </div>
  );
}
