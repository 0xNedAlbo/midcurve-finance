/**
 * useChainSharedContract - Fetch shared automation contracts by chain ID
 *
 * Simpler alternative to useSharedContract that only requires a chainId.
 * Use this when you don't have an nftId yet (e.g., before minting a position).
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { automationApi } from '@/lib/api-client';
import { getNonfungiblePositionManagerAddress } from '@/config/contracts/nonfungible-position-manager';
import {
  getUniswapV3PositionCloserAbi,
  isVersionSupported,
  type UniswapV3PositionCloserAbi,
} from '@midcurve/shared';
import type {
  SharedContractsMap,
  ContractVersion,
} from '@midcurve/api-shared';

interface UseChainSharedContractResult {
  /**
   * Map of contract names to contract info
   */
  contracts: SharedContractsMap;

  /**
   * Whether the chain has a UniswapV3PositionCloser contract available
   */
  isSupported: boolean;

  /**
   * Contract address of UniswapV3PositionCloser (if available)
   */
  contractAddress: string | null;

  /**
   * Position manager (NFPM) address for this chain (from local config)
   */
  positionManager: string | null;

  /**
   * Version of UniswapV3PositionCloser (if available)
   */
  version: ContractVersion | null;

  /**
   * ABI for the UniswapV3PositionCloser contract (version-specific)
   * Returns null if version is not supported
   */
  abi: UniswapV3PositionCloserAbi | null;
}

const EMPTY_RESULT: UseChainSharedContractResult = {
  contracts: {},
  isSupported: false,
  contractAddress: null,
  positionManager: null,
  version: null,
  abi: null,
};

/**
 * Hook to fetch shared contracts for a chain (no nftId needed)
 *
 * @param chainId - The EVM chain ID
 * @param options - React Query options
 */
export function useChainSharedContract(
  chainId: number | undefined,
  options?: Omit<UseQueryOptions<UseChainSharedContractResult>, 'queryKey' | 'queryFn' | 'enabled'>
) {
  return useQuery({
    queryKey: queryKeys.automation.sharedContracts.byChain(chainId ?? 0),
    queryFn: async (): Promise<UseChainSharedContractResult> => {
      if (!chainId) {
        return EMPTY_RESULT;
      }

      const response = await automationApi.getChainSharedContracts(chainId);
      const contracts = response.data.contracts;
      const closerContract = contracts['UniswapV3PositionCloser'];

      // Get positionManager from local config (not from API)
      const positionManager = getNonfungiblePositionManagerAddress(chainId) ?? null;

      // Get version-specific ABI (if version is supported)
      let abi: UniswapV3PositionCloserAbi | null = null;
      if (closerContract?.version && isVersionSupported(closerContract.version)) {
        abi = getUniswapV3PositionCloserAbi(closerContract.version);
      }

      return {
        contracts,
        isSupported: !!closerContract && abi !== null,
        contractAddress: closerContract?.contractAddress ?? null,
        positionManager,
        version: closerContract?.version ?? null,
        abi,
      };
    },
    enabled: !!chainId,
    staleTime: 5 * 60 * 1000, // 5 minutes - shared contracts rarely change
    ...options,
  });
}
