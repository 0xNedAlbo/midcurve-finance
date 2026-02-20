/**
 * useWizardUrlState Hook
 *
 * Manages bidirectional sync between URL search params and wizard state.
 *
 * On mount: Parse URL → discover pool → hydrate state
 * On state change: Debounced (300ms) state → URL sync
 *
 * Returns `{ isHydrating }` to show loading state during URL hydration.
 * All validation failures silently clear the URL and start a fresh wizard.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UniswapV3Pool, type PoolJSON } from '@midcurve/shared';
import type { PoolSearchResultItem } from '@midcurve/api-shared';
import { useDiscoverPool } from '@/hooks/pools/useDiscoverPool';
import type { CreatePositionWizardState, ConfigurationTab } from '../context/CreatePositionWizardContext';
import {
  parseWizardUrlParams,
  serializeWizardState,
  isValidPoolAddress,
  isValidChainId,
  getChainName,
} from './wizardUrlSchema';

/**
 * Hydration payload for the HYDRATE_FROM_URL action
 */
export interface HydrationPayload {
  isToken0Quote: boolean;
  baseInputAmount: string;
  quoteInputAmount: string;
  tickLower: number;
  tickUpper: number;
  stopLossTick: number | null;
  takeProfitTick: number | null;
  currentStepIndex: number;
  configurationTab: ConfigurationTab;
}

interface UseWizardUrlStateOptions {
  state: CreatePositionWizardState;
  selectPool: (pool: PoolSearchResultItem) => void;
  setDiscoveredPool: (pool: UniswapV3Pool) => void;
  onHydrate: (payload: HydrationPayload) => void;
}

interface UseWizardUrlStateResult {
  isHydrating: boolean;
}

export function useWizardUrlState({
  state,
  selectPool,
  setDiscoveredPool,
  onHydrate,
}: UseWizardUrlStateOptions): UseWizardUrlStateResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isHydrating, setIsHydrating] = useState(false);
  const hasHydrated = useRef(false);
  const discoverPool = useDiscoverPool();

  // Debounce timer ref for state->URL sync
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track if we're currently hydrating to skip URL updates
  const isHydratingRef = useRef(false);

  // ========== URL -> State (Hydration on mount) ==========
  useEffect(() => {
    // Only run once on mount
    if (hasHydrated.current) return;
    hasHydrated.current = true;

    const params = parseWizardUrlParams(searchParams);
    console.log('[WizardURL] Parsed URL params:', params);

    // Skip hydration if no pool params
    if (!params.chainId || !params.poolAddress) {
      console.log('[WizardURL] No chain/pool in URL, skipping hydration');
      return;
    }

    // Validate params - silently clear URL and start fresh on failure
    const chainValid = isValidChainId(params.chainId);
    const poolValid = isValidPoolAddress(params.poolAddress);
    if (!chainValid || !poolValid) {
      console.log('[WizardURL] Validation failed — chainValid:', chainValid, 'poolValid:', poolValid, '→ clearing URL');
      clearUrlParams();
      return;
    }

    // Start hydration
    console.log('[WizardURL] Starting hydration for chain', params.chainId, 'pool', params.poolAddress);
    setIsHydrating(true);
    isHydratingRef.current = true;

    // Discover pool from API
    discoverPool
      .mutateAsync({
        chainId: params.chainId,
        address: params.poolAddress,
      })
      .then((result) => {
        console.log('[WizardURL] Pool discovered:', result.pool);
        const poolInstance = UniswapV3Pool.fromJSON(result.pool as unknown as PoolJSON);

        // Create minimal PoolSearchResultItem for selectPool
        const poolSearchItem: PoolSearchResultItem = {
          poolAddress: params.poolAddress!,
          chainId: params.chainId!,
          chainName: getChainName(params.chainId!),
          feeTier: poolInstance.feeBps,
          token0: {
            address: poolInstance.token0.config.address as string,
            symbol: poolInstance.token0.symbol,
            decimals: poolInstance.token0.decimals,
          },
          token1: {
            address: poolInstance.token1.config.address as string,
            symbol: poolInstance.token1.symbol,
            decimals: poolInstance.token1.decimals,
          },
          tvlUSD: '0', // Not needed for hydration
          volume24hUSD: '0',
          fees24hUSD: '0',
          fees7dUSD: '0',
          apr7d: 0,
        };

        // Select pool (sets selectedPool, baseToken=token0, quoteToken=token1)
        selectPool(poolSearchItem);
        setDiscoveredPool(poolInstance);

        // Dispatch hydration with remaining params
        const hydrationPayload = {
          isToken0Quote: params.isToken0Quote,
          baseInputAmount: params.baseInputAmount,
          quoteInputAmount: params.quoteInputAmount,
          tickLower: params.tickLower ?? 0,
          tickUpper: params.tickUpper ?? 0,
          stopLossTick: params.stopLossTick,
          takeProfitTick: params.takeProfitTick,
          currentStepIndex: params.currentStepIndex,
          configurationTab: params.configurationTab,
        };
        console.log('[WizardURL] Dispatching HYDRATE_FROM_URL:', hydrationPayload);
        onHydrate(hydrationPayload);

        setIsHydrating(false);
        isHydratingRef.current = false;
        console.log('[WizardURL] Hydration complete');
      })
      .catch((error) => {
        console.log('[WizardURL] Pool discovery failed:', error, '→ clearing URL');
        clearUrlParams();
        setIsHydrating(false);
        isHydratingRef.current = false;
      });

    function clearUrlParams() {
      setSearchParams(new URLSearchParams(), { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // ========== State -> URL (Debounced sync) ==========
  const updateUrl = useCallback(() => {
    // Skip during hydration
    if (isHydratingRef.current) return;

    const params = serializeWizardState(state);
    setSearchParams(params, { replace: true });
  }, [state, setSearchParams]);

  useEffect(() => {
    // Skip during hydration
    if (isHydrating) return;

    // Clear any pending update
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
    }

    // Debounce URL updates (300ms)
    updateTimerRef.current = setTimeout(updateUrl, 300);

    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
    };
  }, [
    // Only watch fields that should trigger URL update
    state.selectedPool?.poolAddress,
    state.selectedPool?.chainId,
    state.baseToken?.address,
    state.quoteToken?.address,
    state.baseInputAmount,
    state.quoteInputAmount,
    state.tickLower,
    state.tickUpper,
    state.stopLossEnabled,
    state.stopLossTick,
    state.takeProfitEnabled,
    state.takeProfitTick,
    state.currentStepIndex,
    state.configurationTab,
    isHydrating,
    updateUrl,
  ]);

  return { isHydrating };
}
