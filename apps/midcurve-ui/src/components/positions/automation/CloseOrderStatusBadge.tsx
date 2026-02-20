/**
 * Close Order Status Badge
 *
 * Displays a color-coded badge for close order automation states.
 * - monitoring: Green "Monitoring"
 * - executing:  Blue "Executing..."
 * - retrying:   Orange "Retrying..."
 * - failed:     Red "Failed"
 * - executed:   Gray "Executed"
 */

import type { AutomationState } from '@midcurve/api-shared';

interface CloseOrderStatusBadgeProps {
  /**
   * Close order automation state
   */
  status: AutomationState;
  /**
   * Optional size variant
   */
  size?: 'sm' | 'md';
}

/**
 * Status configuration for styling and display
 */
const STATUS_CONFIG: Record<
  AutomationState,
  {
    label: string;
    textColor: string;
    bgColor: string;
    borderColor: string;
    dot?: boolean;
    dotColor?: string;
  }
> = {
  monitoring: {
    label: 'Monitoring',
    textColor: 'text-emerald-300',
    bgColor: 'bg-emerald-900/30',
    borderColor: 'border-emerald-700/50',
    dot: true,
    dotColor: 'bg-emerald-400',
  },
  executing: {
    label: 'Executing...',
    textColor: 'text-blue-300',
    bgColor: 'bg-blue-900/30',
    borderColor: 'border-blue-700/50',
    dot: true,
    dotColor: 'bg-blue-400',
  },
  retrying: {
    label: 'Retrying...',
    textColor: 'text-amber-300',
    bgColor: 'bg-amber-900/30',
    borderColor: 'border-amber-700/50',
    dot: true,
    dotColor: 'bg-amber-400',
  },
  failed: {
    label: 'Failed',
    textColor: 'text-red-300',
    bgColor: 'bg-red-900/30',
    borderColor: 'border-red-700/50',
  },
  executed: {
    label: 'Executed',
    textColor: 'text-slate-400',
    bgColor: 'bg-slate-800/50',
    borderColor: 'border-slate-700/50',
  },
};

export function CloseOrderStatusBadge({ status, size = 'md' }: CloseOrderStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.monitoring;

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
            status === 'executing' || status === 'retrying'
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
export function getCloseOrderStatusLabel(status: AutomationState): string {
  return STATUS_CONFIG[status]?.label ?? status;
}

/**
 * Check if order is in a processing state (requires polling)
 */
export function isCloseOrderProcessing(status: AutomationState): boolean {
  return status === 'executing' || status === 'retrying';
}

/**
 * Check if order can be cancelled (only monitoring orders)
 */
export function canCancelCloseOrder(status: AutomationState): boolean {
  return status === 'monitoring';
}

/**
 * Check if order is in a terminal state
 */
export function isCloseOrderTerminal(status: AutomationState): boolean {
  return status === 'executed' || status === 'failed';
}
