/**
 * Stop Loss Button
 *
 * When no order exists: green "+" button to create via wizard.
 * When order exists: 3-zone inline control (toggle monitoring | edit | cancel).
 */

'use client';

import { useMemo } from 'react';
import { Plus } from 'lucide-react';
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
import { OrderActionButton } from './OrderActionButton';

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
  closeOrders: SerializedCloseOrder[];
}

export function StopLossButton({
  chainId,
  nftId,
  baseToken,
  quoteToken,
  isToken0Quote,
  disabled = false,
  disabledReason,
  closeOrders,
}: StopLossButtonProps) {
  const navigate = useNavigate();
  const location = useLocation();

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

  const slTriggerMode = (isToken0Quote ? 'UPPER' : 'LOWER') as TriggerMode;
  const activeOrder = useMemo(() => {
    return findOrderForTriggerMode(closeOrders, slTriggerMode);
  }, [closeOrders, slTriggerMode]);

  const buttonLabel = useMemo(() => {
    if (!activeOrder) return null;
    return getOrderButtonLabel(activeOrder, 'stopLoss', tokenConfig);
  }, [activeOrder, tokenConfig]);

  const visualState = activeOrder ? getOrderButtonVisualState(activeOrder) : null;

  const handleNavigateToWizard = () => {
    const nftIdStr = nftId.toString();
    const chainSlug = getChainSlugByChainId(chainId);
    if (chainSlug) {
      navigate(`/positions/triggers/uniswapv3/${chainSlug}/${nftIdStr}`, {
        state: { returnTo: location.pathname },
      });
    }
  };

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

  // Active order → 3-zone inline control
  if (activeOrder && buttonLabel && visualState) {
    return (
      <OrderActionButton
        order={activeOrder}
        orderType="STOP_LOSS"
        visualState={visualState}
        buttonLabel={buttonLabel}
        chainId={chainId}
        nftId={nftId.toString()}
        onNavigateToWizard={handleNavigateToWizard}
      />
    );
  }

  // No order → create button
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
