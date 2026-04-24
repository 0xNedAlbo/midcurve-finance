/**
 * React Query hook for Uniswap V3 position conversion summary.
 *
 * Backed by /api/v1/positions/uniswapv3/:chainId/:nftId/conversion — the
 * server runs the same replay the UI used to run locally, so the response
 * already has every bigint computed. We only deserialize wire strings back
 * to bigint for the rendering layer.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  deserializeConversionSummary,
  type ConversionSummary,
  type SerializedConversionSummary,
} from '@midcurve/shared';
import { apiClientFn } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export function useUniswapV3Conversion(
  chainId: number,
  nftId: string,
): UseQueryResult<ConversionSummary, Error> {
  return useQuery<ConversionSummary, Error>({
    queryKey: queryKeys.positions.uniswapv3.conversion(chainId, nftId),
    queryFn: async () => {
      const wire = await apiClientFn<SerializedConversionSummary>(
        `/api/v1/positions/uniswapv3/${chainId}/${nftId}/conversion`,
      );
      return deserializeConversionSummary(wire);
    },
    staleTime: 60 * 1000,
    gcTime: 60 * 1000,
  });
}
