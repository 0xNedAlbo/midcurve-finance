/**
 * SEMSEE EVM Client
 *
 * Provides read-only access to the local SEMSEE EVM chain for strategy-related queries.
 * SEMSEE is a local Geth instance running at localhost:8545.
 *
 * This client is used to:
 * - Query strategy owner addresses (for hard-wired withdrawal recipients)
 *
 * Security: This is LOCAL-ONLY network access. No external RPC calls are made.
 */

import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { signerLogger } from './logger';

const logger = signerLogger.child({ module: 'semsee' });

/**
 * Strategy owner ABI for on-chain query
 */
const STRATEGY_OWNER_ABI = [
  {
    name: 'owner',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

/**
 * SEMSEE chain configuration
 * SEMSEE is a custom Clique PoA chain with instant mining
 */
const semseeChain = {
  id: 31337, // Foundry/Anvil chain ID (matches genesis.json)
  name: 'SEMSEE',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: [process.env.SEMSEE_RPC_URL || 'http://localhost:8545'],
    },
  },
} as const;

/**
 * Singleton SEMSEE client instance
 */
let semseeClient: PublicClient | null = null;

/**
 * Get or create the SEMSEE public client
 */
function getSemseeClient(): PublicClient {
  if (!semseeClient) {
    const rpcUrl = process.env.SEMSEE_RPC_URL || 'http://localhost:8545';
    logger.info({ rpcUrl }, 'Initializing SEMSEE client');

    semseeClient = createPublicClient({
      chain: semseeChain,
      transport: http(rpcUrl),
    });
  }
  return semseeClient;
}

/**
 * Query strategy owner from SEMSEE chain
 *
 * @param strategyAddress - The strategy contract address
 * @returns The owner address of the strategy
 * @throws Error if query fails
 */
export async function getStrategyOwner(strategyAddress: Address): Promise<Address> {
  logger.debug({ strategyAddress }, 'Querying strategy owner from SEMSEE');

  const client = getSemseeClient();

  try {
    const owner = await client.readContract({
      address: strategyAddress,
      abi: STRATEGY_OWNER_ABI,
      functionName: 'owner',
    });

    logger.debug({ strategyAddress, owner }, 'Strategy owner retrieved');
    return owner as Address;
  } catch (error) {
    logger.error(
      {
        strategyAddress,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to query strategy owner from SEMSEE'
    );
    throw new Error(
      `Failed to query strategy owner: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Check if SEMSEE is reachable
 *
 * @returns true if SEMSEE is reachable, false otherwise
 */
export async function isSemseeReachable(): Promise<boolean> {
  try {
    const client = getSemseeClient();
    await client.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}
