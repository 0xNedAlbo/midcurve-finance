/**
 * Stop Loss Button
 *
 * Action button for creating or displaying a stop-loss order.
 *
 * States:
 * - No order: Green "+ | Stop Loss" button (navigates to Risk Triggers wizard)
 * - Order active: Pink "SL @{price}" button (navigates to Risk Triggers wizard)
 * - Order executing: Amber spinner + "SL @{price}" (no navigation, order is being executed)
 */

'use client';

import { useMemo } from 'react';
import { Plus, ArrowRight, Loader2 } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Address } from 'viem';
import type { ListPositionData, TriggerMode, SerializedCloseOrder } from '@midcurve/api-shared';
import { getChainSlugByChainId } from '@/config/chains';
import {
  findClosestOrder,
  getOrderButtonLabel,
  isOrderExecuting,
  type TokenConfig,
} from './order-button-utils';

interface StopLossButtonProps {
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

export function StopLossButton({
  chainId,
  nftId,
  currentPriceDisplay,
  baseToken,
  quoteToken,
  disabled = false,
  disabledReason,
  activeCloseOrders,
}: StopLossButtonProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const orders = activeCloseOrders;

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

  // Find the closest active stop-loss order
  const activeOrder = useMemo(() => {
    return findClosestOrder(orders, currentPriceDisplay, 'LOWER' as TriggerMode, tokenConfig);
  }, [orders, currentPriceDisplay, tokenConfig]);

  // Generate button label if order exists
  const buttonLabel = useMemo(() => {
    if (!activeOrder) return null;
    return getOrderButtonLabel(activeOrder, 'stopLoss', tokenConfig);
  }, [activeOrder, tokenConfig]);

  // Check if order is currently executing
  const isExecuting = activeOrder ? isOrderExecuting(activeOrder) : false;

  // If disabled, show disabled button with tooltip
  if (disabled) {
    return (
      <button
        disabled
        title={disabledReason}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg text-slate-500 bg-slate-800/30 border-slate-600/30 cursor-not-allowed"
      >
        <Plus className="w-3 h-3" />
        Stop Loss
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

  // If order is executing, show amber spinner state (no navigation)
  if (isExecuting) {
    return (
      <div className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg text-amber-300 bg-amber-900/20 border-amber-600/50">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span className="flex items-center gap-0.5">
          {buttonLabel!.prefix} @{buttonLabel!.priceDisplay}
          {buttonLabel!.hasSwap && (
            <>
              <ArrowRight className="w-3 h-3 mx-0.5" />
              {buttonLabel!.targetSymbol}
            </>
          )}
        </span>
      </div>
    );
  }

  // If no active order, show create button (green)
  if (!activeOrder) {
    return (
      <button
        onClick={handleNavigateToWizard}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer text-green-300 bg-green-900/20 hover:bg-green-800/30 border-green-600/50"
      >
        <Plus className="w-3 h-3" />
        Stop Loss
      </button>
    );
  }

  // If active order exists, show display button (pink) - navigates to wizard
  return (
    <button
      onClick={handleNavigateToWizard}
      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg text-pink-300 bg-pink-900/20 hover:bg-pink-800/30 border-pink-600/50 transition-colors cursor-pointer"
      title="Click to manage triggers"
    >
      <span className="flex items-center gap-0.5">
        {buttonLabel!.prefix} @{buttonLabel!.priceDisplay}
        {buttonLabel!.hasSwap && (
          <>
            <ArrowRight className="w-3 h-3 mx-0.5" />
            {buttonLabel!.targetSymbol}
          </>
        )}
      </span>
    </button>
  );
}
