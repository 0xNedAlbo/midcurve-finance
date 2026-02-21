import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { apiClient } from '../lib/api-client';
import type { SessionResponse, SessionUser } from '@midcurve/api-shared';

// Use SessionUser from api-shared as our User type
type User = SessionUser;

interface AuthContextValue {
  user: User | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  signIn: (address: string, message: string, signature: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');

  // Check session on mount
  const refreshSession = useCallback(async () => {
    try {
      const response = await apiClient.get<SessionResponse>('/api/v1/auth/session');
      if (response.data && response.data.user) {
        setUser(response.data.user as User);
        setStatus('authenticated');
      } else {
        setUser(null);
        setStatus('unauthenticated');
      }
    } catch {
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const signIn = async (address: string, message: string, signature: string) => {
    try {
      setStatus('loading');
      const response = await apiClient.post<SessionResponse>('/api/v1/auth/verify', {
        address,
        message,
        signature,
      });

      if (response.data && response.data.user) {
        setUser(response.data.user as User);
        setStatus('authenticated');
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (error) {
      setStatus('unauthenticated');
      throw error;
    }
  };

  const signOut = async () => {
    try {
      await apiClient.post('/api/v1/auth/logout', {});
    } finally {
      setUser(null);
      setStatus('unauthenticated');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        status,
        signIn,
        signOut,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Compatibility hook for existing code that uses `useSession`
export function useSession() {
  const { user, status } = useAuth();
  return {
    data: user ? { user } : null,
    status,
  };
}
