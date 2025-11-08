"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
import {
  Search,
  Loader2,
  Copy,
  ExternalLink,
  AlertCircle,
  X,
} from "lucide-react";
import type { EvmChainSlug } from "@/config/chains";
import {
  getUniswapV3PopularTokens,
  type PopularToken,
} from "@/config/protocols/uniswapv3";
import {
  useTokenSearch,
  type TokenSearchResult,
} from "@/hooks/positions/uniswapv3/wizard/useTokenSearch";
import { useTokenPairValidation } from "@/hooks/positions/uniswapv3/wizard/useTokenPairValidation";
import {
  truncateAddress,
  truncateText,
  getExplorerAddressUrl,
} from "@/utils/evm";

interface TokenSelection {
  token: TokenSearchResult | null;
  isSearching: boolean;
  showDropdown: boolean;
}

interface TokenInputProps {
  type: "base" | "quote";
  selection: TokenSelection;
  query: string;
  chain: EvmChainSlug;
  onQueryChange: (query: string) => void;
  onTokenSelect: (token: TokenSearchResult) => void;
  searchHook: ReturnType<typeof useTokenSearch>;
  popularTokens: PopularToken[];
  placeholder: string;
  label: string;
  color: string;
  onClearToken: () => void;
}

function TokenInput({
  selection,
  query,
  chain,
  onQueryChange,
  onTokenSelect,
  searchHook,
  popularTokens,
  placeholder,
  label,
  color,
  onClearToken,
}: TokenInputProps) {
  return (
    <div className="relative">
      <label className={`block text-sm font-medium ${color} mb-2`}>
        {label}
      </label>

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full pl-10 pr-4 py-3 bg-slate-700 border rounded-lg text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 border-slate-600 focus:ring-${
            color.split("-")[1]
          }-500`}
        />
        {searchHook.isLoading && (
          <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin" />
        )}
      </div>

      {/* Selected Token Display */}
      {selection.token && (
        <div className="mt-2 flex items-center gap-2 p-2 bg-slate-800 rounded border border-slate-700">
          {selection.token.logoUrl && (
            <Image
              src={selection.token.logoUrl}
              alt={selection.token.symbol}
              width={24}
              height={24}
              className="w-6 h-6 rounded-full"
            />
          )}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-white">
                {selection.token.symbol}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-400">
                {truncateText(selection.token.name, 16)}
              </span>
              {selection.token.address && (
                <>
                  <span className="text-slate-500 font-mono">
                    {truncateAddress(selection.token.address)}
                  </span>
                  <div className="flex items-center gap-1">
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        if (selection.token?.address) {
                          navigator.clipboard.writeText(
                            selection.token.address
                          );
                        }
                      }}
                      className="text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                      title="Copy address"
                    >
                      <Copy className="w-3 h-3" />
                    </div>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        if (selection.token?.address) {
                          window.open(
                            getExplorerAddressUrl(
                              selection.token.address,
                              chain
                            ),
                            "_blank"
                          );
                        }
                      }}
                      className="text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                      title="View on explorer"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
          <button
            onClick={onClearToken}
            className="text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Popular Tokens (when no search) */}
      {!selection.token && !query && popularTokens.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-slate-400 uppercase font-medium mb-2">
            Popular
          </p>
          <div className="flex flex-wrap gap-2">
            {popularTokens.map((token) => (
              <button
                key={token.address}
                onClick={() =>
                  onTokenSelect({
                    address: token.address,
                    symbol: token.symbol,
                    name: token.name,
                    decimals: 18, // Will be resolved from API
                  })
                }
                className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-full transition-colors cursor-pointer"
              >
                {token.symbol}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search Results Dropdown */}
      {selection.showDropdown && searchHook.results.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
          {searchHook.results.map((token) => (
            <button
              key={token.address}
              onClick={() => onTokenSelect(token)}
              className="w-full px-4 py-2 text-left hover:bg-slate-700 transition-colors border-b border-slate-700 last:border-b-0 cursor-pointer"
            >
              <div className="flex items-center gap-3">
                {token.logoUrl && (
                  <Image
                    src={token.logoUrl}
                    alt={token.symbol}
                    width={24}
                    height={24}
                    className="w-6 h-6 rounded-full flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">
                      {token.symbol}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-300">
                      {truncateText(token.name, 16)}
                    </span>
                    {token.address && (
                      <>
                        <span className="text-slate-500 font-mono text-xs">
                          {truncateAddress(token.address)}
                        </span>
                        <div className="flex items-center gap-1">
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(token.address);
                            }}
                            className="text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                            title="Copy address"
                          >
                            <Copy className="w-3 h-3" />
                          </div>
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(
                                getExplorerAddressUrl(token.address, chain),
                                "_blank"
                              );
                            }}
                            className="text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                            title="View on explorer"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Search Error */}
      {searchHook.error && (
        <div className="mt-2 text-sm text-red-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          {searchHook.error}
        </div>
      )}

      {/* No Results */}
      {searchHook.isEmpty && (
        <div className="mt-2 text-sm text-slate-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          No tokens found for &quot;{searchHook.debouncedQuery}&quot;
        </div>
      )}
    </div>
  );
}

interface TokenPairStepProps {
  chain: EvmChainSlug;
  baseToken: TokenSearchResult | null;
  quoteToken: TokenSearchResult | null;
  onTokenPairSelect: (
    base: TokenSearchResult,
    quote: TokenSearchResult
  ) => void;
}

export function TokenPairStep({
  chain,
  baseToken,
  quoteToken,
  onTokenPairSelect,
}: TokenPairStepProps) {
  // Token selection state - initialized from props
  const [baseSelection, setBaseSelection] = useState<TokenSelection>({
    token: baseToken,
    isSearching: false,
    showDropdown: false,
  });

  const [quoteSelection, setQuoteSelection] = useState<TokenSelection>({
    token: quoteToken,
    isSearching: false,
    showDropdown: false,
  });

  // Token search hooks
  const baseTokenSearch = useTokenSearch({
    chain,
    type: "base",
    enabled: baseSelection.isSearching,
  });

  const quoteTokenSearch = useTokenSearch({
    chain,
    type: "quote",
    enabled: quoteSelection.isSearching,
  });

  // Token pair validation
  const validation = useTokenPairValidation(
    baseSelection.token,
    quoteSelection.token
  );

  // Popular tokens
  const popularBaseTokens = getUniswapV3PopularTokens(chain, "base");
  const popularQuoteTokens = getUniswapV3PopularTokens(chain, "quote");

  // Handle base token search
  const handleBaseTokenSearch = useCallback(
    (query: string) => {
      baseTokenSearch.setQuery(query);
      setBaseSelection((prev) => ({
        ...prev,
        isSearching: query.length >= 2,
        showDropdown: query.length >= 2,
      }));
    },
    [baseTokenSearch]
  );

  // Handle quote token search
  const handleQuoteTokenSearch = useCallback(
    (query: string) => {
      quoteTokenSearch.setQuery(query);
      setQuoteSelection((prev) => ({
        ...prev,
        isSearching: query.length >= 2,
        showDropdown: query.length >= 2,
      }));
    },
    [quoteTokenSearch]
  );

  // Select base token
  const selectBaseToken = useCallback(
    (token: TokenSearchResult) => {
      setBaseSelection({
        token,
        isSearching: false,
        showDropdown: false,
      });
      baseTokenSearch.setQuery(token.symbol);

      // Notify parent if both tokens are now selected and valid
      if (quoteSelection.token && token.address !== quoteSelection.token.address) {
        onTokenPairSelect(token, quoteSelection.token);
      }
    },
    [baseTokenSearch, quoteSelection.token, onTokenPairSelect]
  );

  // Select quote token
  const selectQuoteToken = useCallback(
    (token: TokenSearchResult) => {
      setQuoteSelection({
        token,
        isSearching: false,
        showDropdown: false,
      });
      quoteTokenSearch.setQuery(token.symbol);

      // Notify parent if both tokens are now selected and valid
      if (baseSelection.token && token.address !== baseSelection.token.address) {
        onTokenPairSelect(baseSelection.token, token);
      }
    },
    [quoteTokenSearch, baseSelection.token, onTokenPairSelect]
  );

  return (
    <div className="space-y-6">
      <p className="text-slate-300">
        Select the token pair for your liquidity position. The base token is
        the asset you want to track, while the quote token is your value
        reference.
      </p>

      {/* Base/Quote Explanation */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
        <h4 className="text-white font-semibold mb-2">
          What are Base and Quote Tokens?
        </h4>
        <div className="space-y-2 text-sm text-slate-300">
          <p>
            <span className="text-blue-400 font-medium">Base Token:</span> The
            asset you want to track and have risk exposure to (e.g., ETH, BTC)
          </p>
          <p>
            <span className="text-green-400 font-medium">Quote Token:</span>{" "}
            Your value reference currency (e.g., USDC, WETH)
          </p>
        </div>
      </div>

      {/* Token Selection */}
      <div className="grid md:grid-cols-2 gap-6">
        <TokenInput
          type="base"
          selection={baseSelection}
          query={baseTokenSearch.query}
          chain={chain}
          onQueryChange={handleBaseTokenSearch}
          onTokenSelect={selectBaseToken}
          searchHook={baseTokenSearch}
          popularTokens={popularBaseTokens}
          placeholder="Search by symbol or address..."
          label="Base Token"
          color="text-blue-400"
          onClearToken={() => {
            setBaseSelection({
              token: null,
              isSearching: false,
              showDropdown: false,
            });
            baseTokenSearch.setQuery("");
          }}
        />

        <TokenInput
          type="quote"
          selection={quoteSelection}
          query={quoteTokenSearch.query}
          chain={chain}
          onQueryChange={handleQuoteTokenSearch}
          onTokenSelect={selectQuoteToken}
          searchHook={quoteTokenSearch}
          popularTokens={popularQuoteTokens}
          placeholder="Search by symbol or address..."
          label="Quote Token"
          color="text-green-400"
          onClearToken={() => {
            setQuoteSelection({
              token: null,
              isSearching: false,
              showDropdown: false,
            });
            quoteTokenSearch.setQuery("");
          }}
        />
      </div>

      {/* Validation Error */}
      {validation.error && baseSelection.token && quoteSelection.token && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <div>
              <h5 className="text-red-400 font-medium">Validation Error</h5>
              <p className="text-red-200/80 text-sm mt-1">
                {validation.error}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Note */}
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
        <p className="text-slate-400 text-sm">
          Your position value and PnL will be measured in quote token units. For
          example, if USDC is your quote token, all metrics will be shown in USD
          value.
        </p>
      </div>
    </div>
  );
}
