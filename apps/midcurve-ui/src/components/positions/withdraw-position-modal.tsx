'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { ListPositionData } from '@midcurve/api-shared';
import { UniswapV3WithdrawForm } from './protocol/uniswapv3/uniswapv3-withdraw-form';

interface WithdrawPositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: ListPositionData;
  onWithdrawSuccess?: () => void;
}

/**
 * Withdraw Position Modal - Protocol-Agnostic Shell
 *
 * Displays a modal for withdrawing liquidity from a position.
 * Routes to protocol-specific withdraw forms based on position.protocol.
 *
 * Supported protocols:
 * - uniswapv3: Uniswap V3 withdraw form
 * - Future: orca, raydium, etc.
 */
export function WithdrawPositionModal({
  isOpen,
  onClose,
  position,
  onWithdrawSuccess,
}: WithdrawPositionModalProps) {
  const [mounted, setMounted] = useState(false);

  // Ensure component is mounted on client side for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  // Render protocol-specific form
  const renderWithdrawForm = () => {
    switch (position.protocol) {
      case 'uniswapv3':
        return (
          <UniswapV3WithdrawForm
            position={position}
            onClose={onClose}
            onWithdrawSuccess={onWithdrawSuccess}
          />
        );
      default:
        return (
          <div className="text-center py-12">
            <p className="text-slate-400">
              Withdraw not supported for protocol: {position.protocol}
            </p>
          </div>
        );
    }
  };

  const modalContent = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800/90 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
            <div>
              <h2 className="text-2xl font-bold text-white">
                Withdraw Liquidity
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Remove liquidity from your {position.pool.token0.symbol}/
                {position.pool.token1.symbol} position
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
            {renderWithdrawForm()}
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
}
