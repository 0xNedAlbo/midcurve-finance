/**
 * ConfigProvider
 *
 * Fetches GET /api/config on mount to determine if the app is configured.
 * Provides config state to children, gating the main app behind the setup wizard.
 */

import { createContext, useContext, useCallback, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface ConfigData {
  configured: boolean;
  walletconnectProjectId?: string;
}

interface ConfigState {
  status: 'loading' | 'unconfigured' | 'configured';
  walletconnectProjectId: string | null;
  refetch: () => void;
}

const ConfigContext = createContext<ConfigState | null>(null);

export function useConfig(): ConfigState {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['app-config'],
    queryFn: async () => {
      const response = await apiClient.get<ConfigData>('/api/config');
      return response.data;
    },
    staleTime: Infinity, // Only refetch on manual invalidation
    retry: 2,
  });

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['app-config'] });
  }, [queryClient]);

  let status: ConfigState['status'];
  if (isLoading || !data) {
    status = 'loading';
  } else if (data.configured) {
    status = 'configured';
  } else {
    status = 'unconfigured';
  }

  const value: ConfigState = {
    status,
    walletconnectProjectId: data?.walletconnectProjectId ?? null,
    refetch,
  };

  return (
    <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
  );
}
