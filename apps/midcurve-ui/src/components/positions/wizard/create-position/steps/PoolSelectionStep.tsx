import { useState, useEffect, useCallback } from 'react';
import { Search, Star, Hash, PlusCircle, MinusCircle } from 'lucide-react';
import {
  useCreatePositionWizard,
  type PoolSelectionTab,
  type MockPool,
  type MockToken,
} from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';
import { PoolTable } from '../shared/PoolTable';
import { TokenSetSearchInput } from '../shared/TokenSetSearchInput';
import type { TokenSearchResult } from '@/hooks/tokens/useMultiChainTokenSearch';
import type { EvmChainSlug } from '@/config/chains';

// Mock data for demonstration
const MOCK_POOLS: MockPool[] = [
  {
    id: '1',
    address: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
    chainId: 1,
    chainName: 'Ethereum',
    feeTier: '0.05%',
    feeBps: 500,
    token0: {
      address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
    },
    token1: {
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    },
    tvlUsd: 312_100_000,
    volume24hUsd: 89_500_000,
    fees24hUsd: 44_750,
    apr7d: 19.8,
    currentTick: 201234,
    sqrtPriceX96: '1234567890123456789012345678',
  },
  {
    id: '2',
    address: '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8',
    chainId: 42161,
    chainName: 'Arbitrum',
    feeTier: '0.05%',
    feeBps: 500,
    token0: {
      address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
    },
    token1: {
      address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    },
    tvlUsd: 124_500_000,
    volume24hUsd: 156_200_000,
    fees24hUsd: 78_100,
    apr7d: 37.2,
    currentTick: 201234,
    sqrtPriceX96: '1234567890123456789012345678',
  },
  {
    id: '3',
    address: '0x4c36388be6f416a29c8d8eee81c771ce6be14b18',
    chainId: 8453,
    chainName: 'Base',
    feeTier: '0.05%',
    feeBps: 500,
    token0: {
      address: '0x4200000000000000000000000000000000000006',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
    },
    token1: {
      address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    },
    tvlUsd: 89_300_000,
    volume24hUsd: 42_100_000,
    fees24hUsd: 21_050,
    apr7d: 24.5,
    currentTick: 201234,
    sqrtPriceX96: '1234567890123456789012345678',
  },
  {
    id: '4',
    address: '0xcbcdf9626bc03e24f779434178a73a0b4bad62ed',
    chainId: 1,
    chainName: 'Ethereum',
    feeTier: '0.3%',
    feeBps: 3000,
    token0: {
      address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
      symbol: 'WBTC',
      name: 'Wrapped Bitcoin',
      decimals: 8,
    },
    token1: {
      address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
    },
    tvlUsd: 45_600_000,
    volume24hUsd: 12_300_000,
    fees24hUsd: 36_900,
    apr7d: 28.4,
    currentTick: -12345,
    sqrtPriceX96: '987654321098765432109876543',
  },
];

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

  // Filter pools based on search
  const filteredPools = MOCK_POOLS.filter((pool) => {
    if (state.poolSelectionTab === 'favorites') {
      // TODO: Implement favorites filtering
      return false;
    }
    if (state.poolSelectionTab === 'direct') {
      return pool.address.toLowerCase() === directAddress.toLowerCase();
    }
    // Search tab - pool must have tokens from both sets (if sets are non-empty)
    const poolTokenSymbols = [pool.token0.symbol.toUpperCase(), pool.token1.symbol.toUpperCase()];

    const hasSetAToken =
      tokenSetA.length === 0 ||
      tokenSetA.some((t) => poolTokenSymbols.includes(t.symbol.toUpperCase()));

    const hasSetBToken =
      tokenSetB.length === 0 ||
      tokenSetB.some((t) => poolTokenSymbols.includes(t.symbol.toUpperCase()));

    const matchesChain = selectedChainIds.includes(pool.chainId);

    return hasSetAToken && hasSetBToken && matchesChain;
  });

  // Update validation when pool is selected
  useEffect(() => {
    setStepValid('pool', state.selectedPool !== null);
  }, [state.selectedPool, setStepValid]);

  const handleSelectPool = (pool: MockPool) => {
    // Determine base and quote tokens (for now, token0 is base, token1 is quote)
    const baseToken: MockToken = pool.token0;
    const quoteToken: MockToken = pool.token1;
    selectPool(pool, baseToken, quoteToken);
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
        <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-600/50">
          <p className="text-slate-400 text-center">
            Favorites feature coming soon. Use the Search tab to find pools.
          </p>
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

  const renderVisual = () => (
    <PoolTable
      pools={filteredPools}
      selectedPoolId={state.selectedPool?.id || null}
      onSelectPool={handleSelectPool}
    />
  );

  const renderSummary = () => (
    <WizardSummaryPanel nextDisabled={!state.selectedPool} />
  );

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
