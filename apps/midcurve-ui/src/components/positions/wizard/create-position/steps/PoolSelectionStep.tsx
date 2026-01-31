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
import { usePoolLookup } from '@/hooks/pools/usePoolLookup';
import { useDiscoverPool } from '@/hooks/pools/useDiscoverPool';
import { usePoolFavorites, useTogglePoolFavorite } from '@/hooks/pools/usePoolFavorites';
import type { TokenSearchResult } from '@/hooks/tokens/useMultiChainTokenSearch';
import { getChainMetadataByChainId, type EvmChainSlug } from '@/config/chains';
import { isValidEthereumAddress } from '@/utils/evm';

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
    setIsDiscovering,
    setDiscoveredPool,
    setDiscoverError,
    setInteractiveZoom,
  } = useCreatePositionWizard();

  // Zoom constants
  const ZOOM_MIN = 0.75;
  const ZOOM_MAX = 1.25;
  const ZOOM_STEP = 0.125;

  // Zoom handlers using context state
  const handleZoomIn = useCallback(() => {
    setInteractiveZoom(Math.min(state.interactiveZoom + ZOOM_STEP, ZOOM_MAX));
  }, [state.interactiveZoom, setInteractiveZoom]);

  const handleZoomOut = useCallback(() => {
    setInteractiveZoom(Math.max(state.interactiveZoom - ZOOM_STEP, ZOOM_MIN));
  }, [state.interactiveZoom, setInteractiveZoom]);

  // Pool discovery mutation
  const discoverPool = useDiscoverPool();

  // Token set state - arrays of selected tokens
  const [tokenSetA, setTokenSetA] = useState<TokenSearchResult[]>([]);
  const [tokenSetB, setTokenSetB] = useState<TokenSearchResult[]>([]);
  const [directAddress, setDirectAddress] = useState('');
  const [selectedChainIds, setSelectedChainIds] = useState<number[]>([1, 42161, 8453]); // Ethereum, Arbitrum, Base

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

  // Direct address lookup state
  const [debouncedAddress, setDebouncedAddress] = useState('');

  // Debounce the address input (500ms delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedAddress(directAddress);
    }, 500);
    return () => clearTimeout(timer);
  }, [directAddress]);

  // Validate address format
  const isAddressValid = isValidEthereumAddress(directAddress);
  const showAddressError = directAddress.length > 0 && !isAddressValid;

  // Lookup pools by address across all chains
  const { pools: lookupPools, isLoading: isLookupLoading } = usePoolLookup({
    address: debouncedAddress,
    enabled: state.poolSelectionTab === 'direct' && isValidEthereumAddress(debouncedAddress),
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

  // Update validation when pool is discovered (not just selected)
  useEffect(() => {
    setStepValid('pool', state.discoveredPool !== null);
  }, [state.discoveredPool, setStepValid]);

  // Handle pool selection - triggers discover call
  const handleSelectPool = useCallback(
    async (pool: PoolSearchResultItem) => {
      // Store the selected pool info immediately for UI feedback
      selectPool(pool);

      // Start discovery
      setIsDiscovering(true);

      try {
        const result = await discoverPool.mutateAsync({
          chainId: pool.chainId,
          address: pool.poolAddress,
        });
        setDiscoveredPool(result.pool);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to discover pool';
        setDiscoverError(message);
      }
    },
    [selectPool, setIsDiscovering, setDiscoveredPool, setDiscoverError, discoverPool]
  );

  const renderInteractive = () => (
    <div className="space-y-4">
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
            disabled={state.interactiveZoom <= ZOOM_MIN}
            className={`p-1 rounded transition-colors cursor-pointer ${
              state.interactiveZoom <= ZOOM_MIN
                ? 'text-slate-600 cursor-not-allowed'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
            title="Zoom out"
          >
            <MinusCircle className="w-4 h-4" />
          </button>
          <button
            onClick={handleZoomIn}
            disabled={state.interactiveZoom >= ZOOM_MAX}
            className={`p-1 rounded transition-colors cursor-pointer ${
              state.interactiveZoom >= ZOOM_MAX
                ? 'text-slate-600 cursor-not-allowed'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
            title="Zoom in"
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
            <div className="flex-1 relative">
              <input
                type="text"
                value={directAddress}
                onChange={(e) => setDirectAddress(e.target.value)}
                placeholder="0x..."
                className={`w-full px-4 py-2 bg-slate-700/50 border rounded-lg text-white placeholder-slate-500 focus:outline-none font-mono text-sm ${
                  showAddressError
                    ? 'border-red-500 focus:border-red-500'
                    : 'border-slate-600 focus:border-blue-500'
                }`}
              />
              {isLookupLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
          </div>

          {showAddressError && (
            <p className="text-sm text-red-400">
              Invalid address format. Expected: 0x followed by 40 hex characters
            </p>
          )}

          {isAddressValid && !isLookupLoading && debouncedAddress && (
            <div className="text-sm text-slate-400">
              {lookupPools.length > 0 ? (
                <span>
                  Found {lookupPools.length} pool{lookupPools.length !== 1 ? 's' : ''} across {lookupPools.length} chain{lookupPools.length !== 1 ? 's' : ''}
                </span>
              ) : (
                <span>No pools found with this address on any supported chain.</span>
              )}
            </div>
          )}

          {!directAddress && (
            <p className="text-sm text-slate-400">
              Enter a pool contract address to search across all supported chains.
            </p>
          )}
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

    if (state.poolSelectionTab === 'direct') {
      return (
        <PoolTable
          pools={lookupPools}
          selectedPoolAddress={state.selectedPool?.poolAddress || null}
          onSelectPool={handleSelectPool}
          onToggleFavorite={handleToggleFavorite}
          isLoading={isLookupLoading}
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
    <WizardSummaryPanel nextDisabled={!state.discoveredPool || state.isDiscovering} />
  );

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
