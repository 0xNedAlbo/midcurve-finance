/**
 * SetupWizardPage
 *
 * First-time setup wizard for self-hosted Midcurve deployments.
 * Collects required API keys and admin wallet address, then POSTs to /api/config.
 */

import { useState, type FormEvent } from 'react';
import { useConfig } from '@/providers/ConfigProvider';
import { API_URL } from '@/lib/env';

const inputClasses =
  'w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500';

export function SetupWizardPage() {
  const { refetch } = useConfig();

  const [configPassword, setConfigPassword] = useState('');
  const [alchemyApiKey, setAlchemyApiKey] = useState('');
  const [theGraphApiKey, setTheGraphApiKey] = useState('');
  const [walletconnectProjectId, setWalletconnectProjectId] = useState('');
  const [adminWalletAddress, setAdminWalletAddress] = useState('');
  const [coingeckoApiKey, setCoingeckoApiKey] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValid =
    configPassword.length > 0 &&
    alchemyApiKey.length > 0 &&
    theGraphApiKey.length > 0 &&
    walletconnectProjectId.length > 0 &&
    /^0x[a-fA-F0-9]{40}$/.test(adminWalletAddress);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const url = `${API_URL}/api/config`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Config-Password': configPassword,
      },
      body: JSON.stringify({
        alchemyApiKey,
        theGraphApiKey,
        walletconnectProjectId,
        adminWalletAddress,
        coingeckoApiKey: coingeckoApiKey || undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? `Request failed (${res.status})`);
      setSubmitting(false);
      return;
    }

    // Config saved — refetch config state so the app transitions to configured
    refetch();
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-100">Midcurve Setup</h1>
          <p className="text-sm text-slate-400 mt-2">
            Configure your self-hosted Midcurve instance
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Setup Password */}
          <Section title="Setup Password">
            <label className="block">
              <span className="text-sm font-medium text-slate-300">CONFIG_PASSWORD</span>
              <input
                type="password"
                value={configPassword}
                onChange={(e) => setConfigPassword(e.target.value)}
                placeholder="Enter your CONFIG_PASSWORD"
                className={inputClasses}
                required
              />
              <p className="text-xs text-slate-500 mt-1">
                The CONFIG_PASSWORD environment variable set on your server
              </p>
            </label>
          </Section>

          {/* Required API Keys */}
          <Section title="Required API Keys">
            <label className="block">
              <span className="text-sm font-medium text-slate-300">Alchemy API Key</span>
              <input
                type="text"
                value={alchemyApiKey}
                onChange={(e) => setAlchemyApiKey(e.target.value)}
                placeholder="Your Alchemy API key"
                className={inputClasses}
                required
              />
              <p className="text-xs text-slate-500 mt-1">
                Used for RPC access to Ethereum, Arbitrum, and Base
              </p>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-slate-300">The Graph API Key</span>
              <input
                type="text"
                value={theGraphApiKey}
                onChange={(e) => setTheGraphApiKey(e.target.value)}
                placeholder="Your The Graph API key"
                className={inputClasses}
                required
              />
              <p className="text-xs text-slate-500 mt-1">
                Used for Uniswap V3 subgraph queries
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
                required
              />
              <p className="text-xs text-slate-500 mt-1">
                Required for wallet connections via RainbowKit
              </p>
            </label>
          </Section>

          {/* Admin Access */}
          <Section title="Admin Access">
            <label className="block">
              <span className="text-sm font-medium text-slate-300">Admin Wallet Address</span>
              <input
                type="text"
                value={adminWalletAddress}
                onChange={(e) => setAdminWalletAddress(e.target.value)}
                placeholder="0x..."
                className={inputClasses}
                required
                pattern="^0x[a-fA-F0-9]{40}$"
              />
              <p className="text-xs text-slate-500 mt-1">
                This address will be added to the allow list and marked as admin
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
                placeholder="Optional — for token logos and market data"
                className={inputClasses}
              />
              <p className="text-xs text-slate-500 mt-1">
                Improves token metadata. Works without it (rate-limited free tier).
              </p>
            </label>
          </Section>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!isValid || submitting}
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
