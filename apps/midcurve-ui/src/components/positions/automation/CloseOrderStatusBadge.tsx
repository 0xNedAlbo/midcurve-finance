/**
 * Close Order Status Badge
 *
 * Displays a color-coded badge for close order statuses.
 * - pending: Yellow "Setting up..."
 * - registering: Yellow "Registering..."
 * - active: Green "Active"
 * - triggering: Blue "Executing..."
 * - executed: Gray "Executed"
 * - cancelled: Gray "Cancelled"
 * - failed: Red "Failed"
 * - expired: Gray "Expired"
 */

import type { CloseOrderStatus } from '@midcurve/api-shared';

interface CloseOrderStatusBadgeProps {
  /**
   * Close order status value
   */
  status: CloseOrderStatus;
  /**
   * Optional size variant
   */
  size?: 'sm' | 'md';
}

/**
 * Status configuration for styling and display
 */
const STATUS_CONFIG: Record<
  CloseOrderStatus,
  {
    label: string;
    textColor: string;
    bgColor: string;
    borderColor: string;
    dot?: boolean;
    dotColor?: string;
  }
> = {
  pending: {
    label: 'Setting up...',
    textColor: 'text-amber-300',
    bgColor: 'bg-amber-900/30',
    borderColor: 'border-amber-700/50',
    dot: true,
    dotColor: 'bg-amber-400',
  },
  registering: {
    label: 'Registering...',
    textColor: 'text-amber-300',
    bgColor: 'bg-amber-900/30',
    borderColor: 'border-amber-700/50',
    dot: true,
    dotColor: 'bg-amber-400',
  },
  active: {
    label: 'Active',
    textColor: 'text-emerald-300',
    bgColor: 'bg-emerald-900/30',
    borderColor: 'border-emerald-700/50',
    dot: true,
    dotColor: 'bg-emerald-400',
  },
  triggering: {
    label: 'Executing...',
    textColor: 'text-blue-300',
    bgColor: 'bg-blue-900/30',
    borderColor: 'border-blue-700/50',
    dot: true,
    dotColor: 'bg-blue-400',
  },
  executed: {
    label: 'Executed',
    textColor: 'text-slate-400',
    bgColor: 'bg-slate-800/50',
    borderColor: 'border-slate-700/50',
  },
  cancelled: {
    label: 'Cancelled',
    textColor: 'text-slate-400',
    bgColor: 'bg-slate-800/50',
    borderColor: 'border-slate-700/50',
  },
  expired: {
    label: 'Expired',
    textColor: 'text-slate-400',
    bgColor: 'bg-slate-800/50',
    borderColor: 'border-slate-700/50',
  },
  failed: {
    label: 'Failed',
    textColor: 'text-red-300',
    bgColor: 'bg-red-900/30',
    borderColor: 'border-red-700/50',
  },
};

export function CloseOrderStatusBadge({ status, size = 'md' }: CloseOrderStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;

  const sizeClasses = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';
  const dotSize = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2';

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded font-medium border
        ${config.textColor} ${config.bgColor} ${config.borderColor}
        ${sizeClasses}
      `}
    >
      {config.dot && (
        <span
          className={`${dotSize} rounded-full ${config.dotColor} ${
            status === 'pending' || status === 'registering' || status === 'triggering'
              ? 'animate-pulse'
              : ''
          }`}
        />
      )}
      {config.label}
    </span>
  );
}

/**
 * Get status label for display
 */
export function getCloseOrderStatusLabel(status: CloseOrderStatus): string {
  return STATUS_CONFIG[status]?.label ?? status;
}

/**
 * Check if order is in a processing state (requires polling)
 */
export function isCloseOrderProcessing(status: CloseOrderStatus): boolean {
  return status === 'pending' || status === 'registering' || status === 'triggering';
}

/**
 * Check if order can be cancelled
 */
export function canCancelCloseOrder(status: CloseOrderStatus): boolean {
  return status === 'pending' || status === 'active';
}

/**
 * Check if order is in a terminal state
 */
export function isCloseOrderTerminal(status: CloseOrderStatus): boolean {
  return status === 'executed' || status === 'cancelled' || status === 'expired' || status === 'failed';
}
