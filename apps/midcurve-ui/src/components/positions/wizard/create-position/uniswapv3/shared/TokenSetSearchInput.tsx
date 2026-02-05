/**
 * Token Set Search Input Component
 *
 * A dropdown search component that allows selecting multiple tokens.
 * Selected tokens appear as chips with (x) remove buttons.
 */

import { useState, useRef, useEffect } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import {
  useMultiChainTokenSearch,
  type TokenSearchResult,
} from '@/hooks/tokens/useMultiChainTokenSearch';

export interface TokenSetSearchInputProps {
  label: string;
  selectedTokens: TokenSearchResult[];
  onTokenSelect: (token: TokenSearchResult) => void;
  onTokenRemove: (token: TokenSearchResult) => void;
  chainIds: number[];
  placeholder?: string;
  maxTokens?: number;
  excludeTokens?: TokenSearchResult[];
}

export function TokenSetSearchInput({
  label,
  selectedTokens,
  onTokenSelect,
  onTokenRemove,
  chainIds,
  placeholder = 'Search...',
  maxTokens = 4,
  excludeTokens = [],
}: TokenSetSearchInputProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    query,
    setQuery,
    results,
    isLoading,
    isEmpty,
    hasSearched,
  } = useMultiChainTokenSearch({
    chainIds,
    enabled: chainIds.length > 0,
  });

  // Check if max tokens reached
  const isMaxReached = selectedTokens.length >= maxTokens;

  // Filter out already-selected tokens AND tokens from the other set
  const availableResults = results.filter(
    (result) =>
      !selectedTokens.some((t) => t.symbol === result.symbol) &&
      !excludeTokens.some((t) => t.symbol === result.symbol)
  );

  // Click outside detection
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Open dropdown when there are results
  useEffect(() => {
    if (results.length > 0 && query.length >= 2) {
      setIsDropdownOpen(true);
    }
  }, [results, query]);

  const handleTokenSelect = (token: TokenSearchResult) => {
    onTokenSelect(token);
    setQuery('');
    setIsDropdownOpen(false);
    inputRef.current?.focus();
  };

  const handleInputFocus = () => {
    if (query.length >= 2 && results.length > 0) {
      setIsDropdownOpen(true);
    }
  };

  return (
    <div className={`flex items-start gap-4 ${isDropdownOpen ? 'z-50 relative' : ''}`}>
      <label className="text-slate-400 w-32 shrink-0 pt-2">{label}:</label>

      <div className="relative" ref={containerRef}>
        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={handleInputFocus}
            placeholder={isMaxReached ? `Max ${maxTokens}` : placeholder}
            disabled={isMaxReached}
            className={`w-[11ch] pl-8 pr-2 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-sm ${
              isMaxReached ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          />
          {isLoading && (
            <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin" />
          )}
        </div>

        {/* Dropdown Results */}
        {isDropdownOpen && (
          <div className="absolute z-[9999] mt-1 w-64 max-h-64 overflow-y-auto bg-slate-800 border border-slate-700 rounded-lg shadow-xl">
            {availableResults.length > 0 ? (
              availableResults.map((token) => (
                <button
                  key={token.symbol}
                  onClick={() => handleTokenSelect(token)}
                  className="w-full px-3 py-2 flex items-center gap-3 hover:bg-slate-700/50 transition-colors cursor-pointer text-left"
                >
                  {token.logoUrl ? (
                    <img
                      src={token.logoUrl}
                      alt={token.symbol}
                      className="w-6 h-6 rounded-full"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-slate-600 flex items-center justify-center text-xs text-slate-300">
                      {token.symbol.charAt(0)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-medium text-sm">
                      {token.symbol}
                    </div>
                    <div className="text-slate-400 text-xs truncate">
                      {token.name}
                    </div>
                    {token.marketCap !== undefined && (
                      <div className="text-slate-500 text-xs">
                        MCap: ${token.marketCap.toLocaleString()}
                      </div>
                    )}
                  </div>
                </button>
              ))
            ) : isEmpty ? (
              <div className="px-3 py-4 text-center text-slate-400 text-sm">
                No tokens found
              </div>
            ) : hasSearched && availableResults.length === 0 && results.length > 0 ? (
              <div className="px-3 py-4 text-center text-slate-400 text-sm">
                All matching tokens already selected
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Selected Tokens Chips */}
      <div className="flex-1 flex flex-wrap gap-2 min-h-[36px] items-center">
        {selectedTokens.map((token) => (
          <span
            key={token.symbol}
            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600/30 text-blue-300 border border-blue-500/50 rounded text-sm"
          >
            {token.logoUrl && (
              <img
                src={token.logoUrl}
                alt={token.symbol}
                className="w-4 h-4 rounded-full"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            {token.symbol}
            <button
              onClick={() => onTokenRemove(token)}
              className="ml-0.5 hover:text-white transition-colors cursor-pointer"
              title={`Remove ${token.symbol}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {selectedTokens.length === 0 && (
          <span className="text-slate-500 text-sm italic">
            Type to search (max {maxTokens})
          </span>
        )}
      </div>
    </div>
  );
}
