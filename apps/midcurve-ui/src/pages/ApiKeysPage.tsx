/**
 * API Keys Management Page
 *
 * Lists the user's personal access tokens with create/revoke actions.
 * Tokens authenticate non-browser clients (e.g. an MCP server) against
 * the same endpoints a browser session can access.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../providers/AuthProvider';
import { ArrowLeft, Key, Plus, AlertCircle } from 'lucide-react';
import type { ApiKeyResponse } from '@midcurve/api-shared';
import { useApiKeys } from '../hooks/api-keys/useApiKeys';
import { CreateApiKeyModal } from '../components/api-keys/create-api-key-modal';
import { RevokeApiKeyModal } from '../components/api-keys/revoke-api-key-modal';
import { formatDateTime, formatRelativeTime } from '../lib/date-utils';

export function ApiKeysPage() {
  const { user, status } = useAuth();
  const navigate = useNavigate();

  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyResponse | null>(null);

  const { data, isLoading, isError, error } = useApiKeys();

  useEffect(() => {
    if (status === 'unauthenticated' || (!user && status !== 'loading')) {
      navigate('/?modal=signin');
    }
  }, [status, user, navigate]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  if (status === 'unauthenticated' || !user) {
    return null;
  }

  const keys = data?.keys ?? [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      {/* Header */}
      <div className="bg-slate-800/50 border-b border-slate-700/50">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-4 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                <Key className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-white">API Keys</h1>
                <p className="text-sm text-slate-400">
                  Long-lived tokens for programmatic access (MCP servers, scripts, etc.)
                </p>
              </div>
            </div>

            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Create Key
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {isLoading && (
          <div className="text-center py-16 text-slate-500">Loading keys...</div>
        )}

        {isError && (
          <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error?.message || 'Failed to load API keys'}
          </div>
        )}

        {!isLoading && !isError && keys.length === 0 && (
          <div className="text-center py-16 border border-dashed border-slate-700 rounded-lg">
            <Key className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-300 font-medium">No API keys yet</p>
            <p className="text-sm text-slate-500 mt-1">
              Create one to authenticate an MCP server or other automated client.
            </p>
          </div>
        )}

        {!isLoading && !isError && keys.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-slate-700/50">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Prefix</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Last Used</th>
                  <th className="px-4 py-3 font-medium">Expires</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50 bg-slate-800/30">
                {keys.map((key) => (
                  <tr key={key.id} className="text-slate-200">
                    <td className="px-4 py-3 font-medium">{key.name}</td>
                    <td className="px-4 py-3 font-mono text-slate-400">{key.keyPrefix}…</td>
                    <td className="px-4 py-3 text-slate-400" title={formatDateTime(key.createdAt)}>
                      {formatRelativeTime(key.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {key.lastUsedAt ? (
                        <span title={formatDateTime(key.lastUsedAt)}>
                          {formatRelativeTime(key.lastUsedAt)}
                        </span>
                      ) : (
                        <span className="text-slate-600">never</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {key.expiresAt ? (
                        <span title={formatDateTime(key.expiresAt)}>
                          {formatRelativeTime(key.expiresAt)}
                        </span>
                      ) : (
                        <span className="text-slate-600">never</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setRevokeTarget(key)}
                        className="px-3 py-1 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors cursor-pointer"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {createOpen && (
        <CreateApiKeyModal isOpen onClose={() => setCreateOpen(false)} />
      )}
      {revokeTarget && (
        <RevokeApiKeyModal
          isOpen
          apiKey={revokeTarget}
          onClose={() => setRevokeTarget(null)}
        />
      )}
    </div>
  );
}
