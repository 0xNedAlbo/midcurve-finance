/**
 * Close Order Review Step
 *
 * Step 2: Review order summary before confirmation
 */

import { Link } from 'react-router-dom';
import { AlertCircle, TrendingDown, TrendingUp, ArrowRightLeft, Info, AlertTriangle } from 'lucide-react';
import type { TriggerMode } from '@midcurve/api-shared';
import type { CloseOrderFormData } from '../CloseOrderModal';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { EvmSwitchNetworkPrompt } from '@/components/common/EvmSwitchNetworkPrompt';
import { CHAIN_METADATA } from '@/config/chains';
import type { EvmChainSlug } from '@/config/chains';

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
   * Whether operator approval is needed
   */
  needsApproval?: boolean;
  /**
   * Whether wallet is connected
   */
  isConnected: boolean;
  /**
   * Connected wallet's chain ID
   */
  connectedChainId: number | undefined;
  /**
   * Position's chain ID
   */
  positionChainId: number;
  /**
   * Connected wallet address
   */
  connectedAddress: string | undefined;
  /**
   * Position owner address
   */
  positionOwner: string;
  /**
   * Whether the user has an autowallet configured
   */
  hasAutowallet: boolean;
}

function getTriggerModeIcon(mode: TriggerMode) {
  switch (mode) {
    case 'LOWER':
      return <TrendingDown className="w-5 h-5 text-red-400" />;
    case 'UPPER':
      return <TrendingUp className="w-5 h-5 text-green-400" />;
  }
}

function getTriggerModeLabel(mode: TriggerMode): string {
  switch (mode) {
    case 'LOWER':
      return 'Stop-Loss';
    case 'UPPER':
      return 'Take-Profit';
  }
}

// Helper to map chainId to chain slug
function getChainSlugFromChainId(chainId: number): EvmChainSlug | null {
  const entry = Object.entries(CHAIN_METADATA).find(
    ([_, meta]) => meta.chainId === chainId
  );
  return entry ? (entry[0] as EvmChainSlug) : null;
}

export function CloseOrderReviewStep({
  formData,
  baseToken,
  quoteToken,
  error,
  needsApproval = false,
  isConnected,
  connectedChainId,
  positionChainId,
  connectedAddress,
  positionOwner,
  hasAutowallet,
}: CloseOrderReviewStepProps) {
  // Calculate expiration date
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + formData.validUntilDays);

  // Get chain slug for NetworkSwitchStep
  const chain = getChainSlugFromChainId(positionChainId);

  // Determine swap direction in user-friendly terms
  // Token0 is the lower address, token1 is the higher address
  const baseIsToken0 = BigInt(baseToken.address) < BigInt(quoteToken.address);
  const isSwapToQuote = baseIsToken0
    ? formData.swapDirection === 'TOKEN0_TO_1'
    : formData.swapDirection === 'TOKEN1_TO_0';

  // Check if connected to wrong network
  const isWrongNetwork = !!(
    isConnected &&
    connectedChainId !== positionChainId
  );

  // Check if connected wallet is not the position owner
  const isWrongAccount = !!(
    isConnected &&
    connectedAddress &&
    positionOwner &&
    connectedAddress.toLowerCase() !== positionOwner.toLowerCase()
  );

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
        {formData.triggerMode === 'LOWER' && (
          <div className="p-4 flex items-center justify-between">
            <span className="text-slate-400">Lower Trigger</span>
            <span className="text-red-400 font-mono">
              {formData.priceLowerDisplay} {quoteToken.symbol}
            </span>
          </div>
        )}

        {/* Upper Price */}
        {formData.triggerMode === 'UPPER' && (
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

        {/* Post-Close Swap */}
        {formData.swapEnabled && (
          <>
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-blue-400" />
                <span className="text-slate-400">Post-Close Swap</span>
              </div>
              <span className="text-blue-400 font-medium">
                {isSwapToQuote
                  ? `${baseToken.symbol} → ${quoteToken.symbol}`
                  : `${quoteToken.symbol} → ${baseToken.symbol}`}
              </span>
            </div>
            <div className="p-4 flex items-center justify-between">
              <span className="text-slate-400">Swap Slippage</span>
              <span className="text-slate-200">{(formData.swapSlippageBps / 100).toFixed(1)}%</span>
            </div>
          </>
        )}
      </div>

      {/* Autowallet Setup Warning - shown when autowallet is not configured */}
      {!hasAutowallet && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-amber-300 mb-1">Autowallet Setup Required</h4>
              <p className="text-sm text-slate-400">
                You need to set up an autowallet before creating close orders.
              </p>
              <Link
                to="/automation/wallet"
                className="inline-block mt-2 text-sm text-blue-400 hover:text-blue-300 underline"
              >
                Go to Autowallet Setup →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Error Display - shown for errors (excluding autowallet errors which are handled above) */}
      {error && !error.toLowerCase().includes('autowallet') && (
        <div className="flex items-start gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-400">Order Failed</p>
            <p className="text-sm text-red-300 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Wallet/Network/Account Validation Section */}
      {/* 1. Wallet Connection Prompt - shown when wallet is not connected */}
      {!isConnected && (
        <EvmWalletConnectionPrompt
          title="Connect Wallet"
          description="Please connect your wallet to create a close order"
        />
      )}

      {/* 2. Account Switch Prompt - shown when connected wallet is not position owner */}
      {isConnected && isWrongAccount && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-amber-300 mb-1">Wrong Account</h4>
              <p className="text-sm text-slate-400">
                Please switch to the position owner account in your wallet.
              </p>
              <p className="text-xs text-slate-500 mt-2">
                Position Owner: {positionOwner.slice(0, 6)}...{positionOwner.slice(-4)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 3. Network Switch Prompt - shown when connected to wrong network */}
      {isConnected && !isWrongAccount && chain && (
        <EvmSwitchNetworkPrompt chain={chain} isWrongNetwork={isWrongNetwork} />
      )}

      {/* Setup Notice - shown when approval is needed */}
      {needsApproval && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-blue-300 mb-2">One-time Setup Required</h4>
              <p className="text-xs text-slate-400 mb-3">
                You need to approve the automation contract to manage your position.
              </p>
              <div className="text-xs text-slate-400 space-y-1">
                <p className="font-medium text-slate-300">You will be asked to sign:</p>
                <ul className="list-disc list-inside ml-1 space-y-0.5">
                  <li>Approve operator permissions (gas required)</li>
                  <li>Register close order (gas required)</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* High Swap Slippage Warning */}
      {formData.swapEnabled && formData.swapSlippageBps > 300 && (
        <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-yellow-300">
            High swap slippage ({(formData.swapSlippageBps / 100).toFixed(1)}%) may result in
            unfavorable swap rates. Consider lowering the slippage tolerance unless you expect
            high volatility or low liquidity.
          </p>
        </div>
      )}

      {/* What Happens Next */}
      <div className="bg-slate-800/50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-slate-300 mb-2">What happens next?</h4>
        <ul className="text-xs text-slate-400 space-y-1">
          <li>1. Your close order will be registered on-chain</li>
          <li>2. We monitor the pool price continuously</li>
          <li>3. When price reaches your trigger, we execute the close</li>
          {formData.swapEnabled ? (
            <>
              <li>4. Withdrawn assets are swapped to {isSwapToQuote ? quoteToken.symbol : baseToken.symbol} via Paraswap</li>
              <li>5. Final proceeds sent directly to your wallet</li>
            </>
          ) : (
            <li>4. Funds are sent directly to your wallet</li>
          )}
        </ul>
      </div>
    </div>
  );
}
