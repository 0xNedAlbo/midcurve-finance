'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ListPositionData } from '@midcurve/api-shared';
import { UniswapV3CollectFeesForm } from './protocol/uniswapv3/uniswapv3-collect-fees-form';

interface CollectFeesModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: ListPositionData;
  onCollectSuccess?: () => void;
}

/**
 * Collect Fees Modal - Protocol-Agnostic Shell
 *
 * Displays a modal for collecting accumulated fees from a position.
 * Routes to protocol-specific collect fees forms based on position.protocol.
 *
 * Supported protocols:
 * - uniswapv3: Uniswap V3 collect fees form
 * - Future: orca, raydium, etc.
 */
export function CollectFeesModal({
  isOpen,
  onClose,
  position,
  onCollectSuccess,
}: CollectFeesModalProps) {
  const [mounted, setMounted] = useState(false);

  // Ensure component is mounted on client side for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  // Render protocol-specific form
  const renderCollectFeesForm = () => {
    switch (position.protocol) {
      case 'uniswapv3':
        return (
          <UniswapV3CollectFeesForm
            position={position}
            onClose={onClose}
            onCollectSuccess={onCollectSuccess}
          />
        );
      default:
        return (
          <div className="text-center py-12">
            <p className="text-slate-400">
              Collect fees not supported for protocol: {position.protocol}
            </p>
          </div>
        );
    }
  };

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
            {renderCollectFeesForm()}
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
}
