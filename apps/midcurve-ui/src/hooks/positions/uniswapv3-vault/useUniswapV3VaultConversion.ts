/**
 * React Query hook for UniswapV3 vault position conversion summary.
 *
 * Backed by /api/v1/positions/uniswapv3-vault/:chainId/:vaultAddress/:ownerAddress/conversion.
 * The server handles the vault-specific event adaptation before running the
 * shared conversion math.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  deserializeConversionSummary,
  type ConversionSummary,
  type SerializedConversionSummary,
} from '@midcurve/shared';
import { apiClientFn } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export function useUniswapV3VaultConversion(
  chainId: number,
  vaultAddress: string,
  ownerAddress: string,
): UseQueryResult<ConversionSummary, Error> {
  return useQuery<ConversionSummary, Error>({
    queryKey: queryKeys.positions.uniswapv3Vault.conversion(
      chainId,
      vaultAddress,
      ownerAddress,
    ),
    queryFn: async () => {
      const wire = await apiClientFn<SerializedConversionSummary>(
        `/api/v1/positions/uniswapv3-vault/${chainId}/${vaultAddress}/${ownerAddress}/conversion`,
      );
      return deserializeConversionSummary(wire);
    },
    staleTime: 60 * 1000,
    gcTime: 60 * 1000,
  });
}
