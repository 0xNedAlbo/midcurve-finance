/**
 * useRefreshAllPositions - Mutation hook for bulk position refresh.
 *
 * Handles 429 rate-limiting by tracking retryAfter state.
 */

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@/lib/api-client';

interface RefreshAllSuccess {
  refreshedCount: number;
  oldestUpdatedAt: string;
}

interface RefreshAllRateLimited {
  skipped: true;
  retryAfter: number;
  oldestUpdatedAt: string;
}

export function useRefreshAllPositions() {
  const queryClient = useQueryClient();
  const [retryAfter, setRetryAfter] = useState(0);

  // Countdown timer
  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = setInterval(() => {
      setRetryAfter((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAfter]);

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<RefreshAllSuccess | RefreshAllRateLimited>(
        '/api/v1/positions/refresh-all',
        {},
      );
      return response;
    },
    onSuccess: (response) => {
      if ('skipped' in response.data) {
        // 429 rate-limited
        setRetryAfter(response.data.retryAfter);
      } else {
        // Invalidate accounting queries to refetch fresh data
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      }
    },
  });

  return {
    refresh: mutation.mutate,
    isRefreshing: mutation.isPending,
    isRateLimited: retryAfter > 0,
    retryAfter,
  };
}
