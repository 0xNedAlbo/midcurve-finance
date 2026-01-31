import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Star, Hash, PlusCircle, MinusCircle } from 'lucide-react';
import type { PoolSearchResultItem, FavoritePoolItem } from '@midcurve/api-shared';
import {
  useCreatePositionWizard,
  type PoolSelectionTab,
} from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';
import { PoolTable } from '../shared/PoolTable';
import { TokenSetSearchInput } from '../shared/TokenSetSearchInput';
import { usePoolSearch } from '@/hooks/pools/usePoolSearch';
import { usePoolFavorites, useTogglePoolFavorite } from '@/hooks/pools/usePoolFavorites';
import type { TokenSearchResult } from '@/hooks/tokens/useMultiChainTokenSearch';
import { getChainMetadataByChainId, type EvmChainSlug } from '@/config/chains';

const TAB_CONFIG: { id: PoolSelectionTab; label: string; icon: React.ReactNode }[] = [
  { id: 'favorites', label: 'Favorites', icon: <Star className="w-4 h-4" /> },
  { id: 'search', label: 'Search', icon: <Search className="w-4 h-4" /> },
  { id: 'direct', label: 'Direct Address', icon: <Hash className="w-4 h-4" /> },
];

// Chain configuration for search
const SEARCH_CHAINS: { slug: EvmChainSlug; name: string; chainId: number }[] = [
  { slug: 'ethereum', name: 'Ethereum', chainId: 1 },
  { slug: 'arbitrum', name: 'Arbitrum', chainId: 42161 },
  { slug: 'base', name: 'Base', chainId: 8453 },
  { slug: 'polygon', name: 'Polygon', chainId: 137 },
  { slug: 'optimism', name: 'Optimism', chainId: 10 },
];

export function PoolSelectionStep() {
  const {
    state,
    setPoolTab,
    selectPool,
    setStepValid,
  } = useCreatePositionWizard();

  // Token set state - arrays of selected tokens
  const [tokenSetA, setTokenSetA] = useState<TokenSearchResult[]>([]);
  const [tokenSetB, setTokenSetB] = useState<TokenSearchResult[]>([]);
  const [directAddress, setDirectAddress] = useState('');
  const [selectedChainIds, setSelectedChainIds] = useState<number[]>([1, 42161, 8453]); // Ethereum, Arbitrum, Base

  // Font size scale (0.75 = 75%, 1.0 = 100%, 1.25 = 125%)
  const [fontScale, setFontScale] = useState(1.0);
  const MIN_SCALE = 0.75;
  const MAX_SCALE = 1.25;
  const SCALE_STEP = 0.125;

  // Pool search hook
  const { pools, isLoading } = usePoolSearch({
    tokenSetA: tokenSetA.map((t) => t.symbol),
    tokenSetB: tokenSetB.map((t) => t.symbol),
    chainIds: selectedChainIds,
    sortBy: 'tvlUSD',
    limit: 50,
    enabled: state.poolSelectionTab === 'search' && tokenSetA.length > 0 && tokenSetB.length > 0,
  });

  // Toggle favorite mutation
  const toggleFavorite = useTogglePoolFavorite();

  // Fetch favorites when tab is active
  const { data: favoritesData, isLoading: isFavoritesLoading } = usePoolFavorites({
    protocol: 'uniswapv3',
    enabled: state.poolSelectionTab === 'favorites',
  });

  // Transform FavoritePoolItem to PoolSearchResultItem for PoolTable
  const transformFavoriteToSearchResult = useCallback(
    (favorite: FavoritePoolItem): PoolSearchResultItem => {
      const chainMeta = getChainMetadataByChainId(favorite.chainId);
      return {
        poolAddress: favorite.poolAddress,
        chainId: favorite.chainId,
        chainName: chainMeta?.shortName ?? `Chain ${favorite.chainId}`,
        feeTier: favorite.pool.feeBps,
        token0: {
          address: favorite.pool.token0.config.address as string,
          symbol: favorite.pool.token0.symbol,
          decimals: favorite.pool.token0.decimals,
        },
        token1: {
          address: favorite.pool.token1.config.address as string,
          symbol: favorite.pool.token1.symbol,
          decimals: favorite.pool.token1.decimals,
        },
        tvlUSD: favorite.tvlUSD,
        volume24hUSD: favorite.volume24hUSD,
        fees24hUSD: favorite.fees24hUSD,
        fees7dUSD: favorite.fees7dUSD,
        apr7d: favorite.apr7d,
        isFavorite: true,
      };
    },
    []
  );

  // Transform favorites for PoolTable
  const favoritePools = useMemo(
    () => (favoritesData?.favorites ?? []).map(transformFavoriteToSearchResult),
    [favoritesData?.favorites, transformFavoriteToSearchResult]
  );

  const handleZoomIn = useCallback(() => {
    setFontScale((prev) => Math.min(prev + SCALE_STEP, MAX_SCALE));
  }, []);

  const handleZoomOut = useCallback(() => {
    setFontScale((prev) => Math.max(prev - SCALE_STEP, MIN_SCALE));
  }, []);

  // Token selection handlers
  const handleTokenASelect = useCallback((token: TokenSearchResult) => {
    setTokenSetA((prev) => {
      if (prev.some((t) => t.symbol === token.symbol)) return prev;
      return [...prev, token];
    });
  }, []);

  const handleTokenARemove = useCallback((token: TokenSearchResult) => {
    setTokenSetA((prev) => prev.filter((t) => t.symbol !== token.symbol));
  }, []);

  const handleTokenBSelect = useCallback((token: TokenSearchResult) => {
    setTokenSetB((prev) => {
      if (prev.some((t) => t.symbol === token.symbol)) return prev;
      return [...prev, token];
    });
  }, []);

  const handleTokenBRemove = useCallback((token: TokenSearchResult) => {
    setTokenSetB((prev) => prev.filter((t) => t.symbol !== token.symbol));
  }, []);

  // Chain toggle handler
  const toggleChain = useCallback((chainId: number) => {
    setSelectedChainIds((prev) =>
      prev.includes(chainId)
        ? prev.filter((id) => id !== chainId)
        : [...prev, chainId]
    );
  }, []);

  // Handle favorite toggle
  const handleToggleFavorite = useCallback(
    (pool: PoolSearchResultItem) => {
      toggleFavorite.mutate({
        protocol: 'uniswapv3',
        chainId: pool.chainId,
        poolAddress: pool.poolAddress,
        isFavorite: pool.isFavorite ?? false,
      });
    },
    [toggleFavorite]
  );

  // Update validation when pool is selected
  useEffect(() => {
    setStepValid('pool', state.selectedPool !== null);
  }, [state.selectedPool, setStepValid]);

  const handleSelectPool = (pool: PoolSearchResultItem) => {
    // Convert PoolSearchResultItem to the format expected by the wizard context
    selectPool(pool);
  };

  const renderInteractive = () => (
    <div className="space-y-4" style={{ zoom: fontScale }}>
      {/* Header with tabs and zoom controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-8">
          <h3 className="text-lg font-semibold text-white">Select Pool</h3>
          <div className="flex items-center gap-6">
            {TAB_CONFIG.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setPoolTab(tab.id)}
                className={`flex items-center gap-2 pb-2 text-sm font-medium transition-colors cursor-pointer border-b-2 ${
                  state.poolSelectionTab === tab.id
                    ? 'text-blue-400 border-blue-300'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            disabled={fontScale <= MIN_SCALE}
            className={`p-1 rounded transition-colors cursor-pointer ${
              fontScale <= MIN_SCALE
                ? 'text-slate-600 cursor-not-allowed'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
            title="Decrease font size"
          >
            <MinusCircle className="w-4 h-4" />
          </button>
          <button
            onClick={handleZoomIn}
            disabled={fontScale >= MAX_SCALE}
            className={`p-1 rounded transition-colors cursor-pointer ${
              fontScale >= MAX_SCALE
                ? 'text-slate-600 cursor-not-allowed'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
            title="Increase font size"
          >
            <PlusCircle className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tab content */}
      {state.poolSelectionTab === 'favorites' && (
        <div className="text-sm text-slate-400">
          {isFavoritesLoading ? (
            <span>Loading favorites...</span>
          ) : favoritePools.length > 0 ? (
            <span>{favoritePools.length} favorite pool{favoritePools.length !== 1 ? 's' : ''}</span>
          ) : (
            <span>No favorites yet. Use the Search tab to find and star pools.</span>
          )}
        </div>
      )}

      {state.poolSelectionTab === 'search' && (
        <div className="space-y-4">
          <TokenSetSearchInput
            label="Base Token"
            selectedTokens={tokenSetA}
            onTokenSelect={handleTokenASelect}
            onTokenRemove={handleTokenARemove}
            chainIds={selectedChainIds}
            placeholder="Search..."
            maxTokens={4}
            excludeTokens={tokenSetB}
          />

          <TokenSetSearchInput
            label="Quote Token"
            selectedTokens={tokenSetB}
            onTokenSelect={handleTokenBSelect}
            onTokenRemove={handleTokenBRemove}
            chainIds={selectedChainIds}
            placeholder="Search..."
            maxTokens={4}
            excludeTokens={tokenSetA}
          />

          <div className="flex items-center gap-4">
            <label className="text-slate-400 w-32 shrink-0">Chains:</label>
            <div className="flex-1 flex flex-wrap gap-2">
              {SEARCH_CHAINS.map((chain) => (
                <button
                  key={chain.chainId}
                  onClick={() => toggleChain(chain.chainId)}
                  className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    selectedChainIds.includes(chain.chainId)
                      ? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
                      : 'bg-slate-700/50 text-slate-400 border border-transparent hover:bg-slate-700'
                  }`}
                >
                  {chain.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {state.poolSelectionTab === 'direct' && (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <label className="text-slate-400 w-32 shrink-0">Pool Address:</label>
            <input
              type="text"
              value={directAddress}
              onChange={(e) => setDirectAddress(e.target.value)}
              placeholder="0x..."
              className="flex-1 px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono text-sm"
            />
          </div>
          <p className="text-sm text-slate-400">
            Enter the pool contract address directly to load pool information.
          </p>
        </div>
      )}
    </div>
  );

  const renderVisual = () => {
    if (state.poolSelectionTab === 'favorites') {
      return (
        <PoolTable
          pools={favoritePools}
          selectedPoolAddress={state.selectedPool?.poolAddress || null}
          onSelectPool={handleSelectPool}
          onToggleFavorite={handleToggleFavorite}
          isLoading={isFavoritesLoading}
        />
      );
    }

    return (
      <PoolTable
        pools={pools}
        selectedPoolAddress={state.selectedPool?.poolAddress || null}
        onSelectPool={handleSelectPool}
        onToggleFavorite={handleToggleFavorite}
        isLoading={isLoading}
      />
    );
  };

  const renderSummary = () => (
    <WizardSummaryPanel nextDisabled={!state.selectedPool} />
  );

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
