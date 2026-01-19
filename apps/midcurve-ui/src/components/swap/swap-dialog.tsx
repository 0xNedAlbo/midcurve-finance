/**
 * SwapDialog Component
 *
 * Modal wrapper for the free-form swap widget.
 * Accessible from the user dropdown menu.
 */

'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useAccount } from 'wagmi';
import { isSwapSupportedChain } from '@midcurve/api-shared';
import { FreeFormSwapWidget } from './free-form-swap-widget';

export interface SwapDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Swap Dialog - Modal for standalone token swapping
 *
 * Provides a modal wrapper for the FreeFormSwapWidget component.
 * Handles chain detection and unsupported chain messaging.
 */
export function SwapDialog({ isOpen, onClose }: SwapDialogProps) {
  const [mounted, setMounted] = useState(false);
  const { chain } = useAccount();

  // Ensure component is mounted on client side for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle ESC key to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen || !mounted) return null;

  const chainId = chain?.id;
  const isChainSupported = chainId ? isSwapSupportedChain(chainId) : false;

  const handleSwapClose = (reason: 'success' | 'cancelled' | 'error') => {
    if (reason === 'success') {
      // Small delay to show success state before closing
      setTimeout(() => onClose(), 500);
    } else {
      onClose();
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
        <div className="bg-slate-800/95 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-2xl shadow-black/40 w-full max-w-lg max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
            <div>
              <h2 className="text-xl font-bold text-white">Swap Tokens</h2>
              <p className="text-sm text-slate-400 mt-1">
                Exchange tokens using ParaSwap
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-100px)]">
            {!chainId ? (
              <div className="text-center py-8">
                <p className="text-slate-300 mb-2">Please connect your wallet</p>
                <p className="text-slate-500 text-sm">
                  Connect a wallet to start swapping tokens
                </p>
              </div>
            ) : !isChainSupported ? (
              <div className="text-center py-8">
                <p className="text-slate-300 mb-2">
                  Swaps not available on this network
                </p>
                <p className="text-slate-500 text-sm">
                  Supported chains: Ethereum, Arbitrum, Base, Optimism, or Local fork
                </p>
              </div>
            ) : (
              <FreeFormSwapWidget
                chainId={chainId}
                onClose={handleSwapClose}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
}
