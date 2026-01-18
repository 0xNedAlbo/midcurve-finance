'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Shield } from 'lucide-react';
import type { ListPositionData } from '@midcurve/api-shared';

interface CreateHedgedPositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: ListPositionData;
}

/**
 * CreateHedgedPositionModal - Modal for creating a hedged position
 *
 * Converts an existing Uniswap V3 position into a Hedge Vault with
 * SIL (Stop Impermanent Loss) and TIP (Take Impermanent Profit) triggers.
 *
 * Currently a placeholder - form content will be added later.
 */
export function CreateHedgedPositionModal({
  isOpen,
  onClose,
  position,
}: CreateHedgedPositionModalProps) {
  const [mounted, setMounted] = useState(false);

  // Ensure component is mounted on client side for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800/95 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-2xl shadow-black/40 w-full max-w-2xl max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-violet-900/30 rounded-lg flex items-center justify-center">
                <Shield className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">
                  Create Hedged Position
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  Configure SIL/TIP triggers for {position.pool.token0.symbol}/
                  {position.pool.token1.symbol}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content - Placeholder */}
          <div className="p-6">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 bg-violet-900/20 rounded-full flex items-center justify-center mb-4">
                <Shield className="w-8 h-8 text-violet-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">
                Coming Soon
              </h3>
              <p className="text-slate-400 max-w-sm">
                Hedge Vault configuration will be available here. You'll be able
                to set SIL and TIP trigger prices, loss cap, and cooldown
                settings.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
}
