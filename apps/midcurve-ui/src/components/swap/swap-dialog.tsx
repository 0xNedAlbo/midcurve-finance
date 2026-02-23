/**
 * SwapDialog Component
 *
 * Modal wrapper for the free-form swap widget.
 * Accessible from the user dropdown menu.
 * Uses Paraswap (Velora) for quoting and execution — no backend involved.
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useAccount } from 'wagmi';
import {
  PARASWAP_SUPPORTED_CHAIN_IDS,
  isParaswapSupportedChain,
} from '@/lib/paraswap-client';
import {
  getChainMetadataByChainId,
} from '@/config/chains';
import { FreeFormSwapWidget } from './free-form-swap-widget';
import type { SwapPrefill } from './free-form-swap-widget';

export interface SwapDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional prefill values for tokens, amount, and direction */
  prefill?: SwapPrefill;
  /** Override the chain selector — when prefill includes tokens for a specific chain */
  chainId?: number;
}

/**
 * Swap Dialog - Modal for standalone token swapping
 *
 * Provides a modal wrapper for the FreeFormSwapWidget component.
 * Includes a network selector for Paraswap-supported chains.
 */
export function SwapDialog({ isOpen, onClose, prefill, chainId: propChainId }: SwapDialogProps) {
  const [mounted, setMounted] = useState(false);
  const { chain } = useAccount();

  // Default to prop chainId > wallet chain > first supported chain
  const defaultChainId = useMemo(() => {
    if (propChainId && isParaswapSupportedChain(propChainId)) {
      return propChainId;
    }
    const walletChainId = chain?.id;
    if (walletChainId && isParaswapSupportedChain(walletChainId)) {
      return walletChainId;
    }
    return PARASWAP_SUPPORTED_CHAIN_IDS[0];
  }, [propChainId, chain?.id]);

  const [selectedChainId, setSelectedChainId] = useState(defaultChainId);

  // Sync default when wallet chain changes
  useEffect(() => {
    if (defaultChainId) {
      setSelectedChainId(defaultChainId);
    }
  }, [defaultChainId]);

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

  const walletConnected = !!chain?.id;

  const handleSwapClose = (reason: 'success' | 'cancelled' | 'error') => {
    if (reason === 'success') {
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
                Exchange tokens via Velora (ParaSwap)
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Network Selector — hidden when chain is prefilled */}
          {!propChainId && (
            <div className="px-6 pt-4 pb-2">
              <div className="flex flex-wrap gap-2">
                {PARASWAP_SUPPORTED_CHAIN_IDS.map((cid) => {
                  const meta = getChainMetadataByChainId(cid);
                  const isSelected = cid === selectedChainId;
                  return (
                    <button
                      key={cid}
                      onClick={() => setSelectedChainId(cid)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                          : 'bg-slate-700/40 text-slate-400 border border-slate-600/40 hover:bg-slate-700/60 hover:text-slate-300'
                      }`}
                    >
                      {meta?.shortName ?? `Chain ${cid}`}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Content */}
          <div className="p-6 pt-2 overflow-y-auto max-h-[calc(90vh-160px)]">
            {!walletConnected ? (
              <div className="text-center py-8">
                <p className="text-slate-300 mb-2">Please connect your wallet</p>
                <p className="text-slate-500 text-sm">
                  Connect a wallet to start swapping tokens
                </p>
              </div>
            ) : (
              <FreeFormSwapWidget
                key={selectedChainId}
                chainId={selectedChainId}
                onClose={handleSwapClose}
                prefill={selectedChainId === (propChainId ?? defaultChainId) ? prefill : undefined}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
}
