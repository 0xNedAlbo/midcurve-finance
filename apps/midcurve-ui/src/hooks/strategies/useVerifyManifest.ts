/**
 * useVerifyManifest - Verify a strategy manifest before deployment
 *
 * Mutation hook for validating an uploaded manifest file.
 * Checks schema, ABI parsing, constructor param matching, and bytecode.
 */

import { useMutation, type UseMutationOptions } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import type {
  VerifyManifestRequest,
  VerifyManifestResponse,
} from '@midcurve/api-shared';
import { getSession } from 'next-auth/react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

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
      // Verify session before making request
      const session = await getSession();
      if (!session?.user) {
        throw new ApiError(
          'Not authenticated. Please sign in first.',
          401,
          'UNAUTHENTICATED'
        );
      }

      const response = await fetch(`${API_BASE_URL}/api/v1/strategies/verify-manifest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(request),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new ApiError(
          data.error?.message || 'Verification failed',
          response.status,
          data.error?.code,
          data.error?.details
        );
      }

      // API returns { success, data: VerifyManifestResponse }
      return data.data as VerifyManifestResponse;
    },
  });
}
