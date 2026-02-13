'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { UniswapV3PositionData } from '@/hooks/positions/uniswapv3/useUniswapV3Position';
import { UniswapV3BurnNftForm } from './uniswapv3-burn-nft-form';

interface UniswapV3BurnNftModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: UniswapV3PositionData;
  onBurnSuccess?: () => void;
}

export function UniswapV3BurnNftModal({
  isOpen,
  onClose,
  position,
  onBurnSuccess,
}: UniswapV3BurnNftModalProps) {
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
        <div className="bg-slate-800/95 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-2xl shadow-black/40 w-full max-w-lg max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
            <div>
              <h2 className="text-2xl font-bold text-white">Burn Position NFT</h2>
              <p className="text-sm text-slate-400 mt-1">
                {position.pool.token0.symbol}/{position.pool.token1.symbol}
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
            <UniswapV3BurnNftForm
              position={position}
              onClose={onClose}
              onBurnSuccess={onBurnSuccess}
            />
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
}
