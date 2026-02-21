/**
 * ScanPositionsModal
 *
 * Chain selection + wallet scan for UniswapV3 positions.
 * Shows all production chains as checkboxes, triggers a blocking
 * POST to /api/v1/positions/discover, and displays results.
 */

import { X, Search, Loader2, CheckCircle2 } from "lucide-react";
import { useEffect, useCallback, useState } from "react";
import { useAccount } from "wagmi";
import { useDiscoverPositions } from "@/hooks/positions/useDiscoverPositions";
import { CHAIN_METADATA, type ChainMetadata } from "@/config/chains";
import type { DiscoverPositionsData } from "@midcurve/api-shared";

interface ScanPositionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanComplete?: () => void;
}

/** Get all production chains (exclude local) */
function getProductionChains(): ChainMetadata[] {
  return Object.values(CHAIN_METADATA).filter(
    (c): c is ChainMetadata => c !== undefined && !c.isLocal,
  );
}

export function ScanPositionsModal({
  isOpen,
  onClose,
  onScanComplete,
}: ScanPositionsModalProps) {
  const { address: connectedAddress } = useAccount();
  const productionChains = getProductionChains();
  const allChainIds = productionChains.map((c) => c.chainId);

  const [selectedChainIds, setSelectedChainIds] = useState<Set<number>>(
    () => new Set(allChainIds),
  );
  const [scanResult, setScanResult] = useState<DiscoverPositionsData | null>(
    null,
  );

  const discoverMutation = useDiscoverPositions();

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedChainIds(new Set(allChainIds));
      setScanResult(null);
      discoverMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Handle ESC key
  const handleClose = useCallback(() => {
    if (!discoverMutation.isPending) {
      onClose();
    }
  }, [discoverMutation.isPending, onClose]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        handleClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, handleClose]);

  const toggleChain = (chainId: number) => {
    setSelectedChainIds((prev) => {
      const next = new Set(prev);
      if (next.has(chainId)) {
        next.delete(chainId);
      } else {
        next.add(chainId);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedChainIds.size === allChainIds.length) {
      setSelectedChainIds(new Set());
    } else {
      setSelectedChainIds(new Set(allChainIds));
    }
  };

  const handleStartScan = () => {
    discoverMutation.mutate(
      { chainIds: Array.from(selectedChainIds), walletAddress: connectedAddress },
      {
        onSuccess: (data) => {
          setScanResult(data);
          if (data.imported > 0) {
            onScanComplete?.();
          }
        },
      },
    );
  };

  if (!isOpen) return null;

  const isScanning = discoverMutation.isPending;
  const hasResult = scanResult !== null;
  const hasError = discoverMutation.isError;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-slate-700">
            <div className="flex items-center gap-2">
              <Search className="w-5 h-5 text-blue-400" />
              <h2 className="text-lg font-semibold text-white">
                Scan for Positions
              </h2>
            </div>
            <button
              onClick={handleClose}
              disabled={isScanning}
              className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-4 space-y-4">
            {/* Chain Selection */}
            {!hasResult && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-400">
                    Select the chains to scan for existing positions
                  </p>
                  <button
                    onClick={toggleAll}
                    disabled={isScanning}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {selectedChainIds.size === allChainIds.length
                      ? "Deselect All"
                      : "Select All"}
                  </button>
                </div>

                <div className="space-y-2">
                  {productionChains.map((chain) => (
                    <label
                      key={chain.chainId}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
                        selectedChainIds.has(chain.chainId)
                          ? "bg-slate-700/50 border-blue-500/50"
                          : "bg-slate-800/50 border-slate-700/50 opacity-60"
                      } ${isScanning ? "pointer-events-none" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedChainIds.has(chain.chainId)}
                        onChange={() => toggleChain(chain.chainId)}
                        disabled={isScanning}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                      />
                      <div>
                        <div className="text-sm font-medium text-white">
                          {chain.shortName}
                        </div>
                        {chain.description && (
                          <div className="text-xs text-slate-400">
                            {chain.description}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}

            {/* Scanning State */}
            {isScanning && (
              <div className="flex flex-col items-center gap-3 py-6">
                <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                <p className="text-sm text-slate-300">
                  Scanning {selectedChainIds.size} chain
                  {selectedChainIds.size !== 1 ? "s" : ""} for positions...
                </p>
                <p className="text-xs text-slate-500">
                  This may take a moment
                </p>
              </div>
            )}

            {/* Results */}
            {hasResult && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-green-400">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="font-medium">Scan Complete</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-700/50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-white">
                      {scanResult.found}
                    </div>
                    <div className="text-xs text-slate-400">
                      Positions Found
                    </div>
                  </div>
                  <div className="bg-slate-700/50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-blue-400">
                      {scanResult.imported}
                    </div>
                    <div className="text-xs text-slate-400">Newly Imported</div>
                  </div>
                  <div className="bg-slate-700/50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-slate-400">
                      {scanResult.skipped}
                    </div>
                    <div className="text-xs text-slate-400">
                      Already Tracked
                    </div>
                  </div>
                  {scanResult.errors > 0 && (
                    <div className="bg-slate-700/50 rounded-lg p-3">
                      <div className="text-2xl font-bold text-red-400">
                        {scanResult.errors}
                      </div>
                      <div className="text-xs text-slate-400">Errors</div>
                    </div>
                  )}
                </div>

                {scanResult.imported > 0 && (
                  <p className="text-sm text-slate-400">
                    {scanResult.imported} new position
                    {scanResult.imported !== 1 ? "s have" : " has"} been added to
                    your dashboard.
                  </p>
                )}

                {scanResult.found === 0 && (
                  <p className="text-sm text-slate-400">
                    No active positions were found on the selected chains. You can
                    create a new position or import one by NFT ID.
                  </p>
                )}
              </div>
            )}

            {/* Error State */}
            {hasError && (
              <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                {discoverMutation.error?.message || "Failed to scan for positions"}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-slate-700">
            {!hasResult ? (
              <button
                onClick={handleStartScan}
                disabled={selectedChainIds.size === 0 || isScanning}
                className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:text-slate-400 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
              >
                {isScanning ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    Start Scan
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={onClose}
                className="w-full px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors font-medium cursor-pointer"
              >
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
