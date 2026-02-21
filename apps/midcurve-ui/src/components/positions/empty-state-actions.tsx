"use client";

import { Wand2, FileText, Search, ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useImportPositionByNftId } from "@/hooks/positions/uniswapv3/useImportPositionByNftId";
import {
  getAllUniswapV3Chains,
  type UniswapV3ChainSlug,
} from "@/config/protocols/uniswapv3";
import { ScanPositionsModal } from "./scan-positions-modal";

interface EmptyStateActionsProps {
  onImportSuccess?: (position: any) => void;
}

export function EmptyStateActions({
  onImportSuccess,
}: EmptyStateActionsProps) {
  const [showNftForm, setShowNftForm] = useState(false);
  const [nftId, setNftId] = useState("");
  const [selectedChain, setSelectedChain] = useState<UniswapV3ChainSlug>("ethereum");
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<{
    chainName: string;
    nftId: string;
  } | null>(null);

  const [showScanModal, setShowScanModal] = useState(false);

  // Import mutation hook
  const importMutation = useImportPositionByNftId();

  // Navigation for wizard
  const navigate = useNavigate();
  const location = useLocation();

  // Real import handler using API
  const handleImportNft = () => {
    if (!nftId.trim()) return;

    setImportError(null);
    setImportSuccess(null);

    const chains = getAllUniswapV3Chains();
    const chainMetadata = chains.find((c) => c.slug === selectedChain);
    const chainId = chainMetadata?.chainId ?? 1;

    importMutation.mutate(
      { chainId, nftId: nftId.trim() },
      {
        onSuccess: (position) => {
          const config = position.config as { chainId: number; nftId: number };
          setImportSuccess({
            chainName: chainMetadata?.shortName ?? selectedChain,
            nftId: String(config.nftId),
          });
          onImportSuccess?.(position);

          // Reset form after 2 seconds
          setTimeout(() => {
            setShowNftForm(false);
            setNftId("");
            setImportSuccess(null);
          }, 2000);
        },
        onError: (error) => {
          setImportError(error.message || "Failed to import position");
        },
      }
    );
  };

  return (
    <div className="max-w-6xl mx-auto py-12">
      {/* Header */}
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold text-white mb-3">
          Get Started with Your Positions
        </h2>
        <p className="text-lg text-slate-400">
          Choose one of the options below to add your first liquidity position
        </p>
      </div>

      {/* Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Wizard Card */}
        <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-xl p-6 hover:border-blue-500/50 transition-all hover:shadow-lg hover:shadow-blue-500/10">
          <div className="flex flex-col h-full">
            {/* Icon */}
            <div className="w-12 h-12 bg-blue-500/10 rounded-lg flex items-center justify-center mb-4">
              <Wand2 className="w-6 h-6 text-blue-400" />
            </div>

            {/* Content */}
            <div className="flex-grow">
              <h3 className="text-xl font-semibold text-white mb-2">
                Create Position
              </h3>
              <p className="text-sm text-slate-400 mb-6">
                Use our guided wizard to create a new concentrated liquidity
                position step by step
              </p>
            </div>

            {/* Action Button */}
            <button
              onClick={() => navigate('/positions/create', { state: { returnTo: location.pathname } })}
              className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2 cursor-pointer"
            >
              Start Wizard
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* NFT Import Card */}
        <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-xl p-6 hover:border-blue-500/50 transition-all hover:shadow-lg hover:shadow-blue-500/10">
          <div className="flex flex-col h-full">
            {/* Icon */}
            <div className="w-12 h-12 bg-blue-500/10 rounded-lg flex items-center justify-center mb-4">
              <FileText className="w-6 h-6 text-blue-400" />
            </div>

            {/* Content */}
            <div className="flex-grow">
              <h3 className="text-xl font-semibold text-white mb-2">
                Import by NFT ID
              </h3>
              <p className="text-sm text-slate-400 mb-6">
                If you know your Uniswap V3 position NFT ID, you can import it
                directly
              </p>
            </div>

            {/* Action Button / Form */}
            {!showNftForm ? (
              <button
                onClick={() => setShowNftForm(true)}
                className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2 cursor-pointer"
              >
                Import by ID
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <div className="space-y-3 pt-2 border-t border-slate-700/50">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Blockchain
                  </label>
                  <select
                    value={selectedChain}
                    onChange={(e) => setSelectedChain(e.target.value as UniswapV3ChainSlug)}
                    className="w-full px-3 py-2 text-sm bg-slate-700 border border-slate-600 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  >
                    {getAllUniswapV3Chains().map((chain) => (
                      <option key={chain.slug} value={chain.slug}>
                        {chain.shortName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    NFT ID
                  </label>
                  <input
                    type="text"
                    value={nftId}
                    onChange={(e) => setNftId(e.target.value)}
                    placeholder="Enter NFT ID"
                    maxLength={8}
                    className="w-full px-3 py-2 text-sm bg-slate-700 border border-slate-600 rounded-lg text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setShowNftForm(false);
                      setNftId("");
                      setImportError(null);
                      setImportSuccess(null);
                    }}
                    className="flex-1 px-3 py-2 text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleImportNft}
                    disabled={!nftId.trim() || importMutation.isPending}
                    className="flex-1 px-3 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:text-slate-400 text-white rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {importMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    {importMutation.isPending ? "Importing..." : "Import"}
                  </button>
                </div>

                {/* Error Message */}
                {importError && (
                  <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
                    {importError}
                  </div>
                )}

                {/* Success Message */}
                {importSuccess && (
                  <div className="px-3 py-2 bg-green-500/10 border border-green-500/20 rounded-lg text-xs text-green-400">
                    <div className="font-medium">
                      Position imported successfully!
                    </div>
                    <div className="mt-1 text-slate-300">
                      NFT {importSuccess.nftId} on {importSuccess.chainName}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Scan Wallet Card */}
        <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-xl p-6 hover:border-blue-500/50 transition-all hover:shadow-lg hover:shadow-blue-500/10">
          <div className="flex flex-col h-full">
            {/* Icon */}
            <div className="w-12 h-12 bg-blue-500/10 rounded-lg flex items-center justify-center mb-4">
              <Search className="w-6 h-6 text-blue-400" />
            </div>

            {/* Content */}
            <div className="flex-grow">
              <h3 className="text-xl font-semibold text-white mb-2">
                Scan for Positions
              </h3>
              <p className="text-sm text-slate-400 mb-6">
                Automatically scan your wallet across multiple chains to find
                existing Uniswap V3 positions
              </p>
            </div>

            {/* Action Button */}
            <button
              onClick={() => setShowScanModal(true)}
              className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2 cursor-pointer"
            >
              Start Scan
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Scan Positions Modal */}
      <ScanPositionsModal
        isOpen={showScanModal}
        onClose={() => setShowScanModal(false)}
        onScanComplete={() => onImportSuccess?.(null)}
      />
    </div>
  );
}
