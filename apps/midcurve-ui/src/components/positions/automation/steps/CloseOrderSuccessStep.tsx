/**
 * Close Order Success Step
 *
 * Step 4: Show success message after order creation
 */

import { CheckCircle2, Shield, Clock } from 'lucide-react';
import type { SerializedCloseOrder } from '@midcurve/api-shared';
import { CloseOrderStatusBadge } from '../CloseOrderStatusBadge';

interface CloseOrderSuccessStepProps {
  order: SerializedCloseOrder;
  quoteTokenSymbol: string;
}

export function CloseOrderSuccessStep({ order, quoteTokenSymbol: _quoteTokenSymbol }: CloseOrderSuccessStepProps) {
  // Epoch (0) means "no expiry" per smart contract convention
  const parsedExpiry = order.validUntil ? new Date(order.validUntil) : null;
  const expiresAt = parsedExpiry && parsedExpiry.getTime() > 0 ? parsedExpiry : null;

  return (
    <div className="py-8 text-center">
      <div className="flex justify-center mb-6">
        <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
          <CheckCircle2 className="w-10 h-10 text-green-400" />
        </div>
      </div>

      <h3 className="text-xl font-semibold text-white mb-2">Order Created!</h3>
      <p className="text-sm text-slate-400 mb-6">
        Your close order has been registered and is now active.
      </p>

      {/* Order Details */}
      <div className="bg-slate-700/30 rounded-lg p-4 text-left space-y-3 max-w-sm mx-auto">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Status</span>
          <CloseOrderStatusBadge status={order.status} size="sm" />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Order ID</span>
          <span className="text-xs text-slate-300 font-mono">
            {order.id.slice(0, 8)}...
          </span>
        </div>

        {expiresAt && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Expires</span>
            <span className="text-sm text-slate-300">{expiresAt.toLocaleDateString()}</span>
          </div>
        )}
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-2 gap-3 mt-6">
        <div className="bg-slate-800/50 rounded-lg p-4">
          <Shield className="w-6 h-6 text-blue-400 mx-auto mb-2" />
          <p className="text-xs text-slate-400">
            Price monitoring
            <br />
            is now active
          </p>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-4">
          <Clock className="w-6 h-6 text-amber-400 mx-auto mb-2" />
          <p className="text-xs text-slate-400">
            You can cancel
            <br />
            anytime
          </p>
        </div>
      </div>
    </div>
  );
}
