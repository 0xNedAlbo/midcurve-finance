/**
 * SystemConfigPage
 *
 * Admin-only page for updating instance configuration (API keys, allowlist).
 * Pre-populates with current (masked) values from the backend.
 */

import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Settings } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { apiClient } from '@/lib/api-client';

const inputClasses =
  'w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500';

interface SystemConfigResponse {
  config: Record<string, string>;
  allowlist: string[];
}

export function SystemConfigPage() {
  const { user, status } = useAuth();
  const navigate = useNavigate();

  const [alchemyApiKey, setAlchemyApiKey] = useState('');
  const [theGraphApiKey, setTheGraphApiKey] = useState('');
  const [walletconnectProjectId, setWalletconnectProjectId] = useState('');
  const [coingeckoApiKey, setCoingeckoApiKey] = useState('');
  const [allowlistText, setAllowlistText] = useState('');

  // Placeholders showing masked current values
  const [placeholders, setPlaceholders] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Auth guard
  useEffect(() => {
    if (status === 'unauthenticated' || (!user && status !== 'loading')) {
      navigate('/?modal=signin');
    } else if (status === 'authenticated' && user && !user.isAdmin) {
      navigate('/dashboard');
    }
  }, [status, user, navigate]);

  // Fetch current system config
  useEffect(() => {
    if (status !== 'authenticated' || !user?.isAdmin) return;

    async function fetchSystemConfig() {
      const response = await apiClient.get<SystemConfigResponse>('/api/v1/admin/system-config');
      const s = response.data.config;
      setPlaceholders({
        alchemy_api_key: s.alchemy_api_key ?? '',
        the_graph_api_key: s.the_graph_api_key ?? '',
        walletconnect_project_id: s.walletconnect_project_id ?? '',
        coingecko_api_key: s.coingecko_api_key ?? '',
      });
      // Pre-fill non-masked fields
      setWalletconnectProjectId(s.walletconnect_project_id ?? '');

      // Pre-fill allowlist (one address per line)
      const allowlist = response.data.allowlist ?? [];
      setAllowlistText(allowlist.join('\n'));

      setLoading(false);
    }

    fetchSystemConfig();
  }, [status, user]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSubmitting(true);

    const body: Record<string, unknown> = {};

    // Only send non-empty config fields
    if (alchemyApiKey) body.alchemyApiKey = alchemyApiKey;
    if (theGraphApiKey) body.theGraphApiKey = theGraphApiKey;
    if (walletconnectProjectId) body.walletconnectProjectId = walletconnectProjectId;
    if (coingeckoApiKey) body.coingeckoApiKey = coingeckoApiKey;

    // Always send the allowlist (it's a complete replacement)
    const allowlist = allowlistText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    body.allowlist = allowlist;

    const response = await apiClient.patch('/api/v1/admin/system-config', body);

    if (!response.success) {
      setError('Failed to save system configuration');
      setSubmitting(false);
      return;
    }

    setSuccess(true);
    setSubmitting(false);
    // Clear secret fields after save (they'll show as updated masked placeholders on reload)
    setAlchemyApiKey('');
    setTheGraphApiKey('');
    setCoingeckoApiKey('');
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  if (!user?.isAdmin) {
    return null;
  }

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

          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <Settings className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">System Configuration</h1>
              <p className="text-sm text-slate-400">
                Update API keys and instance configuration
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* API Keys */}
          <Section title="API Keys">
            <label className="block">
              <span className="text-sm font-medium text-slate-300">Alchemy API Key</span>
              <input
                type="text"
                value={alchemyApiKey}
                onChange={(e) => setAlchemyApiKey(e.target.value)}
                placeholder={placeholders.alchemy_api_key || 'Your Alchemy API key'}
                className={inputClasses}
              />
              <p className="text-xs text-slate-500 mt-1">
                Used for RPC access to Ethereum, Arbitrum, and Base. Leave empty to keep current value.
              </p>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-300">The Graph API Key</span>
              <input
                type="text"
                value={theGraphApiKey}
                onChange={(e) => setTheGraphApiKey(e.target.value)}
                placeholder={placeholders.the_graph_api_key || 'Your The Graph API key'}
                className={inputClasses}
              />
              <p className="text-xs text-slate-500 mt-1">
                Used for Uniswap V3 subgraph queries. Leave empty to keep current value.
              </p>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-300">WalletConnect Project ID</span>
              <input
                type="text"
                value={walletconnectProjectId}
                onChange={(e) => setWalletconnectProjectId(e.target.value)}
                placeholder="Your WalletConnect project ID"
                className={inputClasses}
              />
              <p className="text-xs text-slate-500 mt-1">
                Required for wallet connections via RainbowKit
              </p>
            </label>
          </Section>

          {/* Allowlist */}
          <Section title="Allowlist">
            <label className="block">
              <span className="text-sm font-medium text-slate-300">Allowed Wallet Addresses</span>
              <textarea
                value={allowlistText}
                onChange={(e) => setAllowlistText(e.target.value)}
                placeholder={"0x...\n0x...\n0x..."}
                rows={6}
                className={`${inputClasses} resize-y font-mono text-sm`}
              />
              <p className="text-xs text-slate-500 mt-1">
                One address per line. Only these addresses can sign in. Admin addresses are preserved automatically.
              </p>
            </label>
          </Section>

          {/* Optional */}
          <Section title="Optional">
            <label className="block">
              <span className="text-sm font-medium text-slate-300">CoinGecko API Key</span>
              <input
                type="text"
                value={coingeckoApiKey}
                onChange={(e) => setCoingeckoApiKey(e.target.value)}
                placeholder={placeholders.coingecko_api_key || 'Optional — for token logos and market data'}
                className={inputClasses}
              />
              <p className="text-xs text-slate-500 mt-1">
                Improves token metadata. Works without it (rate-limited free tier). Leave empty to keep current value.
              </p>
            </label>
          </Section>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-sm text-green-400">
              Configuration saved successfully
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {submitting ? 'Saving...' : 'Save Configuration'}
          </button>
        </form>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 space-y-4">
      <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">{title}</h2>
      {children}
    </div>
  );
}
