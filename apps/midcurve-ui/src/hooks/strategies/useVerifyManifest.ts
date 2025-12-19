/**
 * useVerifyManifest - Verify a strategy manifest before deployment
 *
 * Mutation hook for validating an uploaded manifest file.
 * Checks schema, ABI parsing, constructor param matching, and bytecode.
 */

import { useMutation, type UseMutationOptions } from '@tanstack/react-query';
import { ApiError, apiClientFn } from '@/lib/api-client';
import type {
  VerifyManifestRequest,
  VerifyManifestResponse,
} from '@midcurve/api-shared';

export function useVerifyManifest(
  options?: Omit<
    UseMutationOptions<
      VerifyManifestResponse,
      ApiError,
      VerifyManifestRequest,
      unknown
    >,
    'mutationFn'
  >
) {
  return useMutation({
    ...options,

    mutationFn: async (request: VerifyManifestRequest) => {
      // Session validation happens automatically on the server via cookies
      return apiClientFn<VerifyManifestResponse>('/api/v1/strategies/verify-manifest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
    },
  });
}
