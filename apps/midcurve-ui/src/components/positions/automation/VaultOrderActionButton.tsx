/**
 * VaultOrderActionButton — inline 3-zone control for an existing vault close order.
 *
 * Layout: | status-icon | SL@2800.03 -> USDC ✏️ | ✕ |
 *
 * Vault-specific:
 * - Cancel uses useVaultCancelCloseOrder (vault closer contract)
 * - Status toggle navigates to wizard (vault close order API endpoints not yet implemented)
 * - Edit navigates to vault risk triggers wizard
 */

'use client';

import { useCallback, useState } from 'react';
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
import { useChainId, useSwitchChain } from 'wagmi';
import type { SerializedCloseOrder } from '@midcurve/api-shared';
import { useVaultCancelCloseOrder } from '@/hooks/automation/useVaultCancelCloseOrder';
import type { OrderType } from '@/hooks/automation/useCreateCloseOrder';
import type { OrderButtonVisualState, OrderButtonLabel } from './order-button-utils';

interface VaultOrderActionButtonProps {
  order: SerializedCloseOrder;
  orderType: OrderType;
  visualState: OrderButtonVisualState;
  buttonLabel: OrderButtonLabel;
  chainId: number;
  vaultAddress: string;
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
    title: 'Monitoring — click to edit in wizard',
    interactive: true,
  },
  paused: {
    Icon: Pause,
    colorClass: 'text-slate-400',
    hoverClass: 'hover:text-slate-300 hover:bg-slate-700/30',
    title: 'Paused — click to edit in wizard',
    interactive: true,
  },
  suspended: {
    Icon: AlertTriangle,
    colorClass: 'text-red-400',
    hoverClass: 'hover:text-red-300 hover:bg-red-900/30',
    title: 'Failed — click to edit in wizard',
    interactive: true,
  },
  inactive: {
    Icon: EyeOff,
    colorClass: 'text-slate-500',
    hoverClass: 'hover:text-slate-400 hover:bg-slate-700/30',
    title: 'Inactive — click to edit in wizard',
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

export function VaultOrderActionButton({
  order: _order,
  orderType,
  visualState,
  buttonLabel,
  chainId,
  vaultAddress,
  onNavigateToWizard,
}: VaultOrderActionButtonProps) {
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const {
    cancelOrder,
    isCancelling,
    isWaitingForConfirmation: isCancelWaiting,
  } = useVaultCancelCloseOrder(chainId, vaultAddress);

  const isCancelBusy = isCancelling || isCancelWaiting;
  const [isToggling] = useState(false);

  const ensureCorrectChain = useCallback(async () => {
    if (walletChainId !== chainId) {
      await switchChainAsync({ chainId });
    }
  }, [walletChainId, chainId, switchChainAsync]);

  // Status toggle → navigate to wizard (vault API endpoints for inline toggle not yet available)
  const handleToggleMonitoring = useCallback(() => {
    onNavigateToWizard();
  }, [onNavigateToWizard]);

  const handleCancel = useCallback(async () => {
    try {
      await ensureCorrectChain();
    } catch {
      return;
    }
    cancelOrder({ orderType });
  }, [cancelOrder, orderType, ensureCorrectChain]);

  const statusConfig = STATUS_ICON_CONFIG[visualState];
  const { Icon, colorClass, hoverClass, title, interactive } = statusConfig;
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
