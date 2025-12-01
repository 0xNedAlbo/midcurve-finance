/**
 * Worker Configuration
 *
 * Environment-based configuration for the strategy worker.
 */

export interface WorkerConfig {
  /** Database connection string */
  databaseUrl: string;

  /** Signer service configuration */
  signer: {
    url: string;
    apiKey: string;
  };

  /** RPC endpoints by chain ID */
  rpcUrls: Record<number, string>;

  /** Hyperliquid WebSocket URL for market data */
  hyperliquidWsUrl: string;

  /** Polling interval for new actions (ms) */
  actionPollIntervalMs: number;

  /** Health check port (0 to disable) */
  healthCheckPort: number;

  /** Log level */
  logLevel: string;

  /** Environment */
  nodeEnv: string;
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): WorkerConfig {
  const databaseUrl = requireEnv('DATABASE_URL');
  const signerUrl = requireEnv('SIGNER_URL');
  const signerApiKey = requireEnv('SIGNER_INTERNAL_API_KEY');

  // RPC URLs - load all available chains
  const rpcUrls: Record<number, string> = {};
  if (process.env.RPC_URL_ETHEREUM) rpcUrls[1] = process.env.RPC_URL_ETHEREUM;
  if (process.env.RPC_URL_ARBITRUM) rpcUrls[42161] = process.env.RPC_URL_ARBITRUM;
  if (process.env.RPC_URL_BASE) rpcUrls[8453] = process.env.RPC_URL_BASE;
  if (process.env.RPC_URL_BSC) rpcUrls[56] = process.env.RPC_URL_BSC;
  if (process.env.RPC_URL_POLYGON) rpcUrls[137] = process.env.RPC_URL_POLYGON;
  if (process.env.RPC_URL_OPTIMISM) rpcUrls[10] = process.env.RPC_URL_OPTIMISM;

  return {
    databaseUrl,
    signer: {
      url: signerUrl,
      apiKey: signerApiKey,
    },
    rpcUrls,
    hyperliquidWsUrl: process.env.HYPERLIQUID_WS_URL ?? 'wss://api.hyperliquid.xyz/ws',
    actionPollIntervalMs: parseInt(process.env.ACTION_POLL_INTERVAL_MS ?? '5000', 10),
    healthCheckPort: parseInt(process.env.HEALTH_CHECK_PORT ?? '8080', 10),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    nodeEnv: process.env.NODE_ENV ?? 'development',
  };
}

/**
 * Require an environment variable or throw
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Validate the configuration
 */
export function validateConfig(config: WorkerConfig): void {
  if (Object.keys(config.rpcUrls).length === 0) {
    throw new Error('At least one RPC_URL_* must be configured');
  }

  if (!config.databaseUrl.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection string');
  }

  if (!config.signer.url.startsWith('http')) {
    throw new Error('SIGNER_URL must be an HTTP(S) URL');
  }
}
