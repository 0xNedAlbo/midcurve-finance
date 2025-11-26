/**
 * React Query Hook for Hedge Eligibility Check
 *
 * Checks if a position is eligible for hedging and returns
 * risk classification and hedge market info.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  ApiResponse,
  CheckHedgeEligibilityResponse,
} from '@midcurve/api-shared';

/**
 * Check hedge eligibility for a position
 *
 * @param positionHash - Position identifier in format "protocol/chainId/nftId"
 *                       e.g., "uniswapv3/8453/5374877"
 * @param enabled - Whether to enable the query (default: true)
 * @returns React Query result with eligibility response
 *
 * Response structure when eligible:
 * - eligible: true
 * - eligibility: "simplePerp"
 * - riskView: { riskBase: "ETH", riskQuote: "USD", baseRole: "volatile", quoteRole: "stable" }
 * - hedgeMarket: { protocol: "hyperliquid", coin: "ETH", market: "ETH-USD", quote: "USD" }
 *
 * Response structure when NOT eligible:
 * - eligible: false
 * - eligibility: "none" | "advanced"
 * - riskView: { riskBase, riskQuote, baseRole, quoteRole }
 * - hedgeMarket: null
 * - reason: "Explanation of why not eligible"
 */
export function useHedgeEligibility(
  positionHash: string | undefined,
  enabled: boolean = true
): UseQueryResult<CheckHedgeEligibilityResponse, Error> {
  return useQuery<CheckHedgeEligibilityResponse, Error>({
    queryKey: ['hedge-eligibility', positionHash],
    queryFn: async () => {
      if (!positionHash) {
        throw new Error('Position hash is required');
      }

      const response = await fetch(
        `/api/v1/hedges/check-eligibility?position=${encodeURIComponent(positionHash)}`
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          message: 'Failed to check hedge eligibility',
        }));
        throw new Error(error.message || 'Failed to check hedge eligibility');
      }

      const apiResponse: ApiResponse<CheckHedgeEligibilityResponse> =
        await response.json();

      if (!apiResponse.success || !apiResponse.data) {
        throw new Error('Invalid API response');
      }

      return apiResponse.data;
    },
    enabled: enabled && !!positionHash,
    staleTime: 5 * 60 * 1000, // 5 minutes - eligibility doesn't change often
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}
