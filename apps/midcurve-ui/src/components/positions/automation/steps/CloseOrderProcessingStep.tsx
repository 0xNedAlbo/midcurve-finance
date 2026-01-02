/**
 * Close Order Processing Step
 *
 * Step 3: Show progress while order is being created
 */

import { Loader2 } from 'lucide-react';

export function CloseOrderProcessingStep() {
  return (
    <div className="py-12 text-center">
      <div className="flex justify-center mb-6">
        <div className="relative">
          <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
          </div>
          <div className="absolute inset-0 w-16 h-16 rounded-full border-2 border-blue-500/20 animate-ping" />
        </div>
      </div>

      <h3 className="text-lg font-semibold text-slate-200 mb-2">Creating Your Order</h3>
      <p className="text-sm text-slate-400">
        Please wait while we register your close order...
      </p>

      <div className="mt-6 space-y-2 max-w-xs mx-auto">
        <div className="flex items-center gap-3 text-sm">
          <div className="w-2 h-2 rounded-full bg-blue-400" />
          <span className="text-slate-400">Validating order parameters</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-slate-400">Registering with automation service</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="w-2 h-2 rounded-full bg-slate-600" />
          <span className="text-slate-500">Confirming activation</span>
        </div>
      </div>
    </div>
  );
}
