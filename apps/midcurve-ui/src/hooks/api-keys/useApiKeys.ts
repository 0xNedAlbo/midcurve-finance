/**
 * API Key Hooks
 *
 * React Query hooks for managing user-issued API keys.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ListApiKeysResponseData,
  CreateApiKeyRequest,
  CreateApiKeyData,
  RevokeApiKeyData,
} from '@midcurve/api-shared';
import { apiKeysApi } from '../../lib/api-client';
import { queryKeys } from '../../lib/query-keys';

export function useApiKeys() {
  return useQuery<ListApiKeysResponseData>({
    queryKey: queryKeys.user.apiKeys(),
    queryFn: async () => {
      const response = await apiKeysApi.listKeys();
      return response.data;
    },
  });
}

export function useCreateApiKey() {
  const queryClient = useQueryClient();

  return useMutation<CreateApiKeyData, Error, CreateApiKeyRequest>({
    mutationFn: async (body) => {
      const response = await apiKeysApi.createKey(body);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.user.apiKeys() });
    },
  });
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient();

  return useMutation<RevokeApiKeyData, Error, string>({
    mutationFn: async (keyId: string) => {
      const response = await apiKeysApi.revokeKey(keyId);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.user.apiKeys() });
    },
  });
}
