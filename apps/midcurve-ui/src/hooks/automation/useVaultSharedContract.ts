/**
 * useVaultSharedContract - Fetch shared automation contracts for vault positions
 *
 * Similar to useChainSharedContract but looks up UniswapV3VaultPositionCloser
 * instead of UniswapV3PositionCloser.
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { automationApi } from '@/lib/api-client';
import {
  getUniswapV3VaultPositionCloserAbi,
  isVaultPositionCloserVersionSupported,
  type UniswapV3VaultPositionCloserAbi,
} from '@midcurve/shared';
import type {
  SharedContractsMap,
  ContractVersion,
} from '@midcurve/api-shared';

interface UseVaultSharedContractResult {
  contracts: SharedContractsMap;
  isSupported: boolean;
  contractAddress: string | null;
  version: ContractVersion | null;
  abi: UniswapV3VaultPositionCloserAbi | null;
}

const EMPTY_RESULT: UseVaultSharedContractResult = {
  contracts: {},
  isSupported: false,
  contractAddress: null,
  version: null,
  abi: null,
};

/**
 * Hook to fetch vault-specific shared contracts for a chain.
 *
 * @param chainId - The EVM chain ID
 */
export function useVaultSharedContract(
  chainId: number | undefined,
  options?: Omit<UseQueryOptions<UseVaultSharedContractResult>, 'queryKey' | 'queryFn' | 'enabled'>
) {
  return useQuery({
    queryKey: [...queryKeys.automation.sharedContracts.byChain(chainId ?? 0), 'vault'],
    queryFn: async (): Promise<UseVaultSharedContractResult> => {
      if (!chainId) {
        return EMPTY_RESULT;
      }

      const response = await automationApi.getChainSharedContracts(chainId);
      const contracts = response.data.contracts;
      const closerContract = contracts['UniswapV3VaultPositionCloser'];

      let abi: UniswapV3VaultPositionCloserAbi | null = null;
      if (closerContract?.version && isVaultPositionCloserVersionSupported(closerContract.version)) {
        abi = getUniswapV3VaultPositionCloserAbi(closerContract.version);
      }

      return {
        contracts,
        isSupported: !!closerContract && abi !== null,
        contractAddress: closerContract?.contractAddress ?? null,
        version: closerContract?.version ?? null,
        abi,
      };
    },
    enabled: !!chainId,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
}
