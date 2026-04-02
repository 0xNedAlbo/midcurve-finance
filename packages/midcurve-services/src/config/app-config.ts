/**
 * AppConfig — Central configuration singleton backed by the `system_config` DB table.
 *
 * All system-level config (API keys, admin wallet, WalletConnect project ID) is stored
 * in the database and accessed exclusively through `getAppConfig()`. No process.env reads
 * for any DB-backed values.
 *
 * Lifecycle:
 *   1. Backend services call `await initAppConfig()` at startup.
 *   2. `initAppConfig()` polls `SystemConfigService.hasAll()` every 30 s until all required
 *      config keys are present, then builds the config and initializes downstream singletons
 *      (EvmConfig, etc.).
 *   3. After that, `getAppConfig()` returns the frozen config object synchronously.
 *   4. `isAppConfigReady()` is used by the API 503 middleware to gate data routes.
 */

import { createServiceLogger } from '../logging/index.js';
import { SystemConfigService } from '../services/system-config/system-config-service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppConfig {
  // Stored in DB (user-provided)
  alchemyApiKey: string;
  theGraphApiKey: string;
  coingeckoApiKey: string | null;
  walletconnectProjectId: string;

  // Derived from alchemyApiKey
  rpcUrlEthereum: string;
  rpcUrlArbitrum: string;
  rpcUrlBase: string;
}

// ---------------------------------------------------------------------------
// Required setting keys (must be present before the app starts serving data)
// ---------------------------------------------------------------------------

export const REQUIRED_SYSTEM_CONFIG_KEYS = [
  'alchemy_api_key',
  'the_graph_api_key',
  'walletconnect_project_id',
  'admin_wallet_address',
] as const;

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

const logger = createServiceLogger('AppConfig');

let _config: AppConfig | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize AppConfig by waiting for all required system config keys to be present in the DB,
 * then build the config and initialize downstream singletons (EvmConfig).
 *
 * This function blocks (via polling) until the config wizard has been completed.
 * Backend services call this at startup before any workers begin processing.
 */
export async function initAppConfig(): Promise<void> {
  if (_config) {
    logger.info('AppConfig already initialized, skipping');
    return;
  }

  const systemConfigService = SystemConfigService.getInstance();
  const POLL_INTERVAL_MS = 30_000;

  logger.info('Waiting for required system config...');

  // Poll until all required system config keys exist
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ready = await systemConfigService.hasAll([...REQUIRED_SYSTEM_CONFIG_KEYS]);
    if (ready) break;
    logger.info(
      { requiredKeys: REQUIRED_SYSTEM_CONFIG_KEYS, pollIntervalMs: POLL_INTERVAL_MS },
      'Required system config not yet present, retrying...',
    );
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const settings = await systemConfigService.getMany([
    ...REQUIRED_SYSTEM_CONFIG_KEYS,
    'coingecko_api_key',
  ]);

  _config = buildConfig(settings);

  // Initialize downstream singletons that depend on config
  const { EvmConfig } = await import('./evm.js');
  EvmConfig.initialize(_config);

  logger.info('AppConfig initialized successfully');
}

/**
 * Get the current AppConfig. Throws if `initAppConfig()` hasn't completed yet.
 */
export function getAppConfig(): AppConfig {
  if (!_config) {
    throw new Error('AppConfig not initialized — call initAppConfig() first');
  }
  return _config;
}

/**
 * Returns true once `initAppConfig()` has completed.
 * Used by API middleware to gate data routes with 503 until configured.
 */
export function isAppConfigReady(): boolean {
  return _config !== null;
}

/**
 * Reset the config singleton. Only for testing.
 */
export function resetAppConfig(): void {
  _config = null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildConfig(settings: Record<string, string>): AppConfig {
  const alchemyApiKey = settings['alchemy_api_key']!;

  return Object.freeze({
    alchemyApiKey,
    theGraphApiKey: settings['the_graph_api_key']!,
    coingeckoApiKey: settings['coingecko_api_key'] ?? null,
    walletconnectProjectId: settings['walletconnect_project_id']!,

    rpcUrlEthereum: `https://eth-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
    rpcUrlArbitrum: `https://arb-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
    rpcUrlBase: `https://base-mainnet.g.alchemy.com/v2/${alchemyApiKey}`,
  });
}
