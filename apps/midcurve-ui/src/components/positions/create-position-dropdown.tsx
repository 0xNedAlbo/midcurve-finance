"use client";

import { useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Plus, ChevronDown, Loader2 } from "lucide-react";
import { useImportPositionByNftId } from "@/hooks/positions/uniswapv3/useImportPositionByNftId";
import {
  getAllUniswapV3Chains,
  type UniswapV3ChainSlug,
} from "@/config/protocols/uniswapv3";
import { ScanPositionsModal } from "./scan-positions-modal";

export function CreatePositionDropdown() {
  // Dropdown state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showNftForm, setShowNftForm] = useState(false);
  const [selectedChain, setSelectedChain] = useState<UniswapV3ChainSlug>("ethereum");
  const [nftId, setNftId] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [showScanModal, setShowScanModal] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Import position mutation
  const importMutation = useImportPositionByNftId();

  // Toggle dropdown (no click-outside detection as per requirements)
  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
    // Reset NFT form when closing
    if (isDropdownOpen) {
      setShowNftForm(false);
      setNftId("");
      setImportError(null);
      setImportSuccess(null);
    }
  };

  // Handle menu item clicks
  const handleCreateNew = () => {
    setIsDropdownOpen(false);
    navigate('/positions/create', { state: { returnTo: location.pathname } });
  };

  const handleScanWallet = () => {
    setIsDropdownOpen(false);
    setShowScanModal(true);
  };

  const handleToggleNftForm = () => {
    setShowNftForm(!showNftForm);
    setImportError(null);
    setImportSuccess(null);
  };

  // Handle NFT import via API
  const handleImportNft = () => {
    setImportError(null);
    setImportSuccess(null);

    const chains = getAllUniswapV3Chains();
    const chainMetadata = chains.find((c) => c.slug === selectedChain);
    const chainId = chainMetadata?.chainId ?? 1;

    importMutation.mutate(
      { chainId, nftId: nftId.trim() },
      {
        onSuccess: (position) => {
          // Note: mutation returns unwrapped position data directly (not response.data)
          const config = position.config as { chainId: number; nftId: number };
          setImportSuccess(`NFT ${config.nftId} imported successfully!`);

          // Auto-close after 2 seconds
          setTimeout(() => {
            setIsDropdownOpen(false);
            setShowNftForm(false);
            setNftId("");
            setImportSuccess(null);
          }, 2000);
        },
        onError: (error) => {
          setImportError(error.message || 'Failed to import position');
        },
      }
    );
  };

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        {/* Button */}
        <button
          onClick={toggleDropdown}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium cursor-pointer"
        >
          <Plus className="w-5 h-5" />
          Add Position
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${
              isDropdownOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        {/* Dropdown Menu */}
        {isDropdownOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-slate-800/90 backdrop-blur-md rounded-lg border border-slate-700/50 shadow-xl shadow-black/20 z-50">
          <div className="py-2">
            {/* Option 1: Create New Position */}
            <button
              onClick={handleCreateNew}
              className="w-full px-4 py-3 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 transition-colors cursor-pointer"
            >
              <div className="text-left">
                <div className="font-medium">Create New Position</div>
                <div className="text-xs text-slate-400">
                  Step-by-step wizard to open a new position
                </div>
              </div>
            </button>

            {/* Option 2: Import NFT by ID */}
            <button
              onClick={handleToggleNftForm}
              className="w-full px-4 py-3 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 transition-colors cursor-pointer"
            >
              <div className="text-left">
                <div className="font-medium">Import NFT by ID</div>
                <div className="text-xs text-slate-400">
                  Import a specific position NFT by token ID
                </div>
              </div>
            </button>

            {/* Option 3: Scan for Positions */}
            <button
              onClick={handleScanWallet}
              className="w-full px-4 py-3 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 transition-colors cursor-pointer"
            >
              <div className="text-left">
                <div className="font-medium">Scan Wallet</div>
                <div className="text-xs text-slate-400">
                  Find existing positions across chains
                </div>
              </div>
            </button>

            {/* NFT Import Form (expandable) */}
            {showNftForm && (
              <div className="px-4 py-3 border-t border-slate-700/50">
                <div className="space-y-3">
                  {/* Chain Selector */}
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Blockchain
                    </label>
                    <select
                      value={selectedChain}
                      onChange={(e) => setSelectedChain(e.target.value as UniswapV3ChainSlug)}
                      className="w-full px-2 py-1.5 text-sm bg-slate-700 border border-slate-600 rounded text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    >
                      {getAllUniswapV3Chains().map((chain) => (
                        <option key={chain.slug} value={chain.slug}>
                          {chain.shortName}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* NFT ID Input */}
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      NFT Token ID
                    </label>
                    <input
                      type="text"
                      value={nftId}
                      onChange={(e) => setNftId(e.target.value)}
                      placeholder="e.g., 123456"
                      className="w-full px-2 py-1.5 text-sm bg-slate-700 border border-slate-600 rounded text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400"
                    />
                  </div>

                  {/* Import Button */}
                  <button
                    onClick={handleImportNft}
                    disabled={!nftId.trim() || importMutation.isPending}
                    className="w-full px-3 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {importMutation.isPending && (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    )}
                    {importMutation.isPending ? "Importing..." : "Import Position"}
                  </button>

                  {/* Error Message */}
                  {importError && (
                    <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
                      {importError}
                    </div>
                  )}

                  {/* Success Message */}
                  {importSuccess && (
                    <div className="px-3 py-2 bg-green-500/10 border border-green-500/20 rounded text-xs text-green-400">
                      <div className="font-medium">Import Successful!</div>
                      <div className="mt-1 text-slate-300">{importSuccess}</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {/* Scan Positions Modal */}
      <ScanPositionsModal
        isOpen={showScanModal}
        onClose={() => setShowScanModal(false)}
      />
    </>
  );
}
