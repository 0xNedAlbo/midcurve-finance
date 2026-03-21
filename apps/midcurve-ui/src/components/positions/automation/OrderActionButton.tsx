/**
 * OrderActionButton — inline 3-zone control for an existing close order.
 *
 * Layout: | status-icon | SL@2800.03 -> USDC ✏️ | ✕ |
 *
 * - Left zone: monitoring state toggle (click to pause/resume)
 *   - For inactive orders: on-chain setOperator() tx, then API toggle to monitoring
 *   - For paused/failed/monitoring: API-only toggle
 * - Middle zone: price label + pen icon (click to open wizard)
 * - Right zone: cancel order (on-chain tx via wallet)
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Eye,
  Pause,
  EyeOff,
  AlertTriangle,
  Loader2,
  Pencil,
  X,
  ArrowRight,
} from 'lucide-react';
import type { Address } from 'viem';
import type { SerializedCloseOrder } from '@midcurve/api-shared';
import { useSetAutomationState } from '@/hooks/automation/useSetAutomationState';
import { useCancelCloseOrder } from '@/hooks/automation/useCancelCloseOrder';
import { useUpdateCloseOrder } from '@/hooks/automation/useUpdateCloseOrder';
import { useConfig } from '@/providers/ConfigProvider';
import type { OrderType } from '@/hooks/automation/useCreateCloseOrder';
import type { OrderButtonVisualState, OrderButtonLabel } from './order-button-utils';

interface OrderActionButtonProps {
  order: SerializedCloseOrder;
  orderType: OrderType;
  visualState: OrderButtonVisualState;
  buttonLabel: OrderButtonLabel;
  chainId: number;
  nftId: string;
  onNavigateToWizard: () => void;
}

const STATUS_ICON_CONFIG: Record<
  OrderButtonVisualState,
  {
    Icon: typeof Eye;
    colorClass: string;
    hoverClass: string;
    title: string;
    interactive: boolean;
  }
> = {
  monitoring: {
    Icon: Eye,
    colorClass: 'text-green-400',
    hoverClass: 'hover:text-green-300 hover:bg-green-900/30',
    title: 'Monitoring — click to pause',
    interactive: true,
  },
  paused: {
    Icon: Pause,
    colorClass: 'text-slate-400',
    hoverClass: 'hover:text-slate-300 hover:bg-slate-700/30',
    title: 'Paused — click to resume',
    interactive: true,
  },
  suspended: {
    Icon: AlertTriangle,
    colorClass: 'text-red-400',
    hoverClass: 'hover:text-red-300 hover:bg-red-900/30',
    title: 'Failed — click to resume monitoring',
    interactive: true,
  },
  inactive: {
    Icon: EyeOff,
    colorClass: 'text-slate-500',
    hoverClass: 'hover:text-slate-400 hover:bg-slate-700/30',
    title: 'Inactive — click to activate monitoring',
    interactive: true,
  },
  executing: {
    Icon: Loader2,
    colorClass: 'text-blue-400',
    hoverClass: '',
    title: 'Executing...',
    interactive: false,
  },
};

const CONTAINER_STYLE: Record<OrderButtonVisualState, string> = {
  monitoring: 'border-green-600/50 bg-green-900/20',
  paused: 'border-slate-600/50',
  suspended: 'border-red-600/50',
  inactive: 'border-slate-600/30',
  executing: 'border-blue-600/50',
};

export function OrderActionButton({
  order,
  orderType,
  visualState,
  buttonLabel,
  chainId,
  nftId,
  onNavigateToWizard,
}: OrderActionButtonProps) {
  const { operatorAddress } = useConfig();
  const setAutomationState = useSetAutomationState();
  const {
    cancelOrder,
    isCancelling,
    isWaitingForConfirmation: isCancelWaiting,
  } = useCancelCloseOrder(chainId, nftId);
  const {
    updateOrder,
    isUpdating: isOperatorUpdating,
    isWaitingForConfirmation: isOperatorWaiting,
    isSuccess: isOperatorSuccess,
    reset: resetOperatorUpdate,
  } = useUpdateCloseOrder(chainId, nftId);

  const isCancelBusy = isCancelling || isCancelWaiting;
  const isOperatorBusy = isOperatorUpdating || isOperatorWaiting;

  // Track the target state we're toggling to. Stays set until the order prop
  // reflects the new state (i.e. polling has caught up), keeping the spinner visible.
  const [togglingTo, setTogglingTo] = useState<'monitoring' | 'paused' | null>(null);

  useEffect(() => {
    if (togglingTo && order.automationState === togglingTo) {
      setTogglingTo(null);
    }
  }, [order.automationState, togglingTo]);

  // After on-chain operator change succeeds, fire the PATCH call to activate
  // monitoring. The backend will refresh() on-chain state (inactive→paused)
  // and then apply paused→monitoring in a single request.
  useEffect(() => {
    if (isOperatorSuccess && order.closeOrderHash) {
      resetOperatorUpdate();
      setTogglingTo('monitoring');
      setAutomationState.mutate({
        chainId,
        nftId,
        closeOrderHash: order.closeOrderHash,
        automationState: 'monitoring',
      });
    }
  }, [isOperatorSuccess, order.closeOrderHash, chainId, nftId, setAutomationState, resetOperatorUpdate]);

  // Toggle monitoring state
  const handleToggleMonitoring = useCallback(() => {
    if (!order.closeOrderHash) return;

    // Inactive orders need an on-chain operator change first
    if (visualState === 'inactive') {
      if (!operatorAddress) return;
      updateOrder({
        updateType: 'operator',
        orderType,
        operatorAddress: operatorAddress as Address,
        closeOrderHash: order.closeOrderHash,
      });
      return;
    }

    // All other states: API-only toggle
    const newState = order.automationState === 'monitoring' ? 'paused' : 'monitoring';
    setTogglingTo(newState);
    setAutomationState.mutate({
      chainId,
      nftId,
      closeOrderHash: order.closeOrderHash,
      automationState: newState,
    });
  }, [order.automationState, order.closeOrderHash, visualState, operatorAddress, chainId, nftId, orderType, setAutomationState, updateOrder]);

  // Cancel order on-chain
  const handleCancel = useCallback(() => {
    cancelOrder({ orderType });
  }, [cancelOrder, orderType]);

  const statusConfig = STATUS_ICON_CONFIG[visualState];
  const { Icon, colorClass, hoverClass, title, interactive } = statusConfig;
  const isToggling = setAutomationState.isPending || isOperatorBusy || togglingTo !== null;
  const isMonitoring = visualState === 'monitoring';

  return (
    <div
      className={`flex items-center text-xs font-medium border rounded-lg overflow-hidden ${CONTAINER_STYLE[visualState]}`}
    >
      {/* Left zone: status icon / toggle */}
      {interactive ? (
        <button
          onClick={handleToggleMonitoring}
          disabled={isToggling}
          title={title}
          className={`flex items-center justify-center px-2 py-1.5 transition-colors cursor-pointer ${colorClass} ${hoverClass} ${
            isToggling ? 'opacity-50' : ''
          }`}
        >
          {isToggling ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Icon className="w-3 h-3" />
          )}
        </button>
      ) : (
        <div
          title={title}
          className={`flex items-center justify-center px-2 py-1.5 ${colorClass}`}
        >
          <Icon className={`w-3 h-3 ${visualState === 'executing' ? 'animate-spin' : ''}`} />
        </div>
      )}

      {/* Middle zone: price label + edit icon */}
      <button
        onClick={onNavigateToWizard}
        className={`flex items-center gap-1 px-2 py-1.5 transition-colors cursor-pointer border-l border-r ${
          isMonitoring
            ? 'text-green-300 hover:text-green-200 hover:bg-green-800/30 border-green-600/30'
            : 'text-slate-200 hover:text-white hover:bg-slate-700/30 border-slate-600/30'
        }`}
      >
        <span className="flex items-center gap-0.5">
          {buttonLabel.prefix}@{buttonLabel.priceDisplay}
          {buttonLabel.hasSwap && (
            <>
              <ArrowRight className="w-3 h-3 mx-0.5" />
              {buttonLabel.targetSymbol}
            </>
          )}
        </span>
        <Pencil className={`w-2.5 h-2.5 ${isMonitoring ? 'text-green-500' : 'text-slate-500'}`} />
      </button>

      {/* Right zone: cancel */}
      <button
        onClick={handleCancel}
        disabled={isCancelBusy}
        title="Cancel order"
        className={`flex items-center justify-center px-2 py-1.5 transition-colors cursor-pointer hover:text-red-400 hover:bg-red-900/20 ${
          isMonitoring ? 'text-green-500' : 'text-slate-500'
        } ${isCancelBusy ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {isCancelBusy ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <X className="w-3 h-3" />
        )}
      </button>
    </div>
  );
}
