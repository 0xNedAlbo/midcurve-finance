/**
 * useSharedContract - Fetch shared automation contracts for a position
 *
 * Fetches the pre-deployed shared automation contracts for a position's chain.
 * Returns a map of contract names to contract info, with convenience fields
 * for the UniswapV3PositionCloser contract.
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { automationApi } from '@/lib/api-client';
import { getNonfungiblePositionManagerAddress } from '@/config/contracts/nonfungible-position-manager';
import type {
  SharedContractsMap,
  ContractVersion,
} from '@midcurve/api-shared';

interface UseSharedContractResult {
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
}

const EMPTY_RESULT: UseSharedContractResult = {
  contracts: {},
  isSupported: false,
  contractAddress: null,
  positionManager: null,
  version: null,
};

/**
 * Hook to fetch shared contracts for a position
 *
 * @param chainId - The EVM chain ID
 * @param nftId - The position NFT ID (as string)
 * @param options - React Query options
 */
export function useSharedContract(
  chainId: number | undefined,
  nftId: string | undefined,
  options?: Omit<UseQueryOptions<UseSharedContractResult>, 'queryKey' | 'queryFn' | 'enabled'>
) {
  return useQuery({
    queryKey: queryKeys.automation.sharedContracts.byPosition(chainId ?? 0, nftId ?? ''),
    queryFn: async (): Promise<UseSharedContractResult> => {
      if (!chainId || !nftId) {
        return EMPTY_RESULT;
      }

      const response = await automationApi.getPositionSharedContracts(chainId, nftId);
      const contracts = response.data.contracts;
      const closerContract = contracts['UniswapV3PositionCloser'];

      // Get positionManager from local config (not from API)
      const positionManager = getNonfungiblePositionManagerAddress(chainId) ?? null;

      return {
        contracts,
        isSupported: !!closerContract,
        contractAddress: closerContract?.contractAddress ?? null,
        positionManager,
        version: closerContract?.version ?? null,
      };
    },
    enabled: !!chainId && !!nftId,
    staleTime: 5 * 60 * 1000, // 5 minutes - shared contracts rarely change
    ...options,
  });
}
