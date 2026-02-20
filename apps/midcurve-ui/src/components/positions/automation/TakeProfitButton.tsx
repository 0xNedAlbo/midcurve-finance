/**
 * Take Profit Button
 *
 * Action button for creating or displaying a take-profit order.
 *
 * Visual states (driven by automationState):
 * - Disabled: Slate, Plus icon (automation unavailable)
 * - No order: Green, Plus icon (navigates to Risk Triggers wizard)
 * - Monitoring: Emerald, Eye icon (actively watching price)
 * - Executing: Blue, Loader2 spinner (trigger fired, execution in progress)
 * - Suspended: Red, AlertTriangle icon (execution failed, needs attention)
 */

'use client';

import { useMemo } from 'react';
import { Plus, Eye, ArrowRight, Loader2, AlertTriangle } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Address } from 'viem';
import type { ListPositionData, TriggerMode, SerializedCloseOrder } from '@midcurve/api-shared';
import { getChainSlugByChainId } from '@/config/chains';
import {
  findOrderForTriggerMode,
  getOrderButtonLabel,
  getOrderButtonVisualState,
  type TokenConfig,
} from './order-button-utils';

interface TakeProfitButtonProps {
  position: ListPositionData;
  positionId: string;
  poolAddress: string;
  chainId: number;
  contractAddress?: Address;
  positionManager?: Address;
  nftId: bigint;
  positionOwner: Address;
  currentPriceDisplay: string;
  currentSqrtPriceX96: string;
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
  isToken0Quote: boolean;
  disabled?: boolean;
  disabledReason?: string;
  activeCloseOrders: SerializedCloseOrder[];
}

export function TakeProfitButton({
  chainId,
  nftId,
  baseToken,
  quoteToken,
  isToken0Quote,
  disabled = false,
  disabledReason,
  activeCloseOrders,
}: TakeProfitButtonProps) {
  const navigate = useNavigate();
  const location = useLocation();

  // Build token config for utilities
  const tokenConfig: TokenConfig = useMemo(
    () => ({
      baseTokenAddress: baseToken.address,
      quoteTokenAddress: quoteToken.address,
      baseTokenDecimals: baseToken.decimals,
      quoteTokenDecimals: quoteToken.decimals,
      baseTokenSymbol: baseToken.symbol,
      quoteTokenSymbol: quoteToken.symbol,
    }),
    [baseToken, quoteToken]
  );

  // Find the take-profit order — trigger mode depends on isToken0Quote
  const tpTriggerMode = (isToken0Quote ? 'LOWER' : 'UPPER') as TriggerMode;
  const activeOrder = useMemo(() => {
    return findOrderForTriggerMode(activeCloseOrders, tpTriggerMode);
  }, [activeCloseOrders, tpTriggerMode]);

  // Generate button label if order exists
  const buttonLabel = useMemo(() => {
    if (!activeOrder) return null;
    return getOrderButtonLabel(activeOrder, 'takeProfit', tokenConfig);
  }, [activeOrder, tokenConfig]);

  // Derive visual state from automationState
  const visualState = activeOrder ? getOrderButtonVisualState(activeOrder) : null;

  // If disabled, show disabled button with tooltip
  if (disabled) {
    return (
      <button
        disabled
        title={disabledReason}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg text-slate-500 bg-slate-800/30 border-slate-600/30 cursor-not-allowed"
      >
        <Plus className="w-3 h-3" />
        Take Profit
      </button>
    );
  }

  // Navigate to Risk Triggers wizard
  const handleNavigateToWizard = () => {
    const nftIdStr = nftId.toString();
    const chainSlug = getChainSlugByChainId(chainId);
    if (chainSlug) {
      navigate(`/positions/triggers/uniswapv3/${chainSlug}/${nftIdStr}`, {
        state: { returnTo: location.pathname },
      });
    }
  };

  // Price label content (shared across monitoring/executing/suspended states)
  const priceLabel = buttonLabel && (
    <span className="flex items-center gap-0.5">
      {buttonLabel.prefix} @{buttonLabel.priceDisplay}
      {buttonLabel.hasSwap && (
        <>
          <ArrowRight className="w-3 h-3 mx-0.5" />
          {buttonLabel.targetSymbol}
        </>
      )}
    </span>
  );

  // Executing state — blue, spinner, non-interactive
  if (visualState === 'executing') {
    return (
      <div className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg text-blue-300 bg-blue-900/20 border-blue-600/50">
        <Loader2 className="w-3 h-3 animate-spin" />
        {priceLabel}
      </div>
    );
  }

  // Suspended state — red, warning icon, clickable
  if (visualState === 'suspended') {
    return (
      <button
        onClick={handleNavigateToWizard}
        title="Execution failed — click to manage"
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg text-red-300 bg-red-900/20 hover:bg-red-800/30 border-red-600/50 transition-colors cursor-pointer"
      >
        <AlertTriangle className="w-3 h-3" />
        {priceLabel}
      </button>
    );
  }

  // Monitoring state — emerald, eye icon, clickable
  if (visualState === 'monitoring') {
    return (
      <button
        onClick={handleNavigateToWizard}
        title="Click to manage triggers"
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg text-emerald-300 bg-emerald-900/20 hover:bg-emerald-800/30 border-emerald-600/50 transition-colors cursor-pointer"
      >
        <Eye className="w-3 h-3" />
        {priceLabel}
      </button>
    );
  }

  // No order — green, plus icon, create button
  return (
    <button
      onClick={handleNavigateToWizard}
      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer text-green-300 bg-green-900/20 hover:bg-green-800/30 border-green-600/50"
    >
      <Plus className="w-3 h-3" />
      Take Profit
    </button>
  );
}
