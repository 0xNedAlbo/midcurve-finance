/**
 * UniswapV3CollectFeesModal - Protocol-specific modal for collecting fees
 *
 * Uniswap V3 specific modal that wraps UniswapV3CollectFeesForm.
 * Uses React Portal for proper z-index stacking.
 */

'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { UniswapV3PositionData } from '@/hooks/positions/uniswapv3/useUniswapV3Position';
import { UniswapV3CollectFeesForm } from './uniswapv3-collect-fees-form';

interface UniswapV3CollectFeesModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: UniswapV3PositionData;
  onCollectSuccess?: () => void;
}

export function UniswapV3CollectFeesModal({
  isOpen,
  onClose,
  position,
  onCollectSuccess,
}: UniswapV3CollectFeesModalProps) {
  const [mounted, setMounted] = useState(false);

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
            <div>
              <h2 className="text-2xl font-bold text-white">Collect Fees</h2>
              <p className="text-sm text-slate-400 mt-1">
                Claim accumulated fees from {position.pool.token0.symbol}/
                {position.pool.token1.symbol}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-180px)]">
            <UniswapV3CollectFeesForm
              position={position}
              onClose={onClose}
              onCollectSuccess={onCollectSuccess}
            />
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
}
