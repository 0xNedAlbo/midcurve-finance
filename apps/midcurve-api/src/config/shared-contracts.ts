import sharedContractsConfig from '../../config/shared-contracts.json';

export type CloseOrderProtocol = 'uniswapv3';

export interface SharedContractConfig {
  contractAddress: string;
  positionManager: string;
}

type SharedContractsConfig = {
  [protocol in CloseOrderProtocol]: {
    [chainId: string]: SharedContractConfig;
  };
};

const config = sharedContractsConfig as SharedContractsConfig;

// Local chain ID (Anvil default)
const LOCAL_CHAIN_ID = 31337;
const DEFAULT_POSITION_MANAGER = '0xC36442b4a4522E871399CD717aBDD847Ab11FE88';

/**
 * Get local chain config from environment variables.
 * Used for development to avoid committing local contract addresses to git.
 */
function getLocalChainConfig(): SharedContractConfig | null {
  const contractAddress = process.env.POSITION_CLOSER_ADDRESS_LOCAL;
  if (!contractAddress) return null;

  const positionManager =
    process.env.POSITION_MANAGER_LOCAL || DEFAULT_POSITION_MANAGER;
  return { contractAddress, positionManager };
}

/**
 * Get the shared contract address for a protocol on a specific chain.
 * For local chain (31337), checks environment variable first.
 * @throws Error if chain is not supported for the protocol
 */
export function getSharedContractAddress(
  protocol: CloseOrderProtocol,
  chainId: number
): string {
  // Check env var for local chain first
  if (chainId === LOCAL_CHAIN_ID) {
    const localConfig = getLocalChainConfig();
    if (localConfig) return localConfig.contractAddress;
  }

  const chainConfig = config[protocol]?.[chainId.toString()];
  if (!chainConfig) {
    throw new Error(
      `Chain ${chainId} is not supported for protocol ${protocol}`
    );
  }
  if (!chainConfig.contractAddress) {
    throw new Error(
      `Shared contract not deployed for protocol ${protocol} on chain ${chainId}`
    );
  }
  return chainConfig.contractAddress;
}

/**
 * Get the full shared contract config for a protocol on a specific chain.
 * For local chain (31337), checks environment variable first.
 * @throws Error if chain is not supported for the protocol
 */
export function getSharedContractConfig(
  protocol: CloseOrderProtocol,
  chainId: number
): SharedContractConfig {
  // Check env var for local chain first
  if (chainId === LOCAL_CHAIN_ID) {
    const localConfig = getLocalChainConfig();
    if (localConfig) return localConfig;
  }

  const chainConfig = config[protocol]?.[chainId.toString()];
  if (!chainConfig) {
    throw new Error(
      `Chain ${chainId} is not supported for protocol ${protocol}`
    );
  }
  if (!chainConfig.contractAddress) {
    throw new Error(
      `Shared contract not deployed for protocol ${protocol} on chain ${chainId}`
    );
  }
  return chainConfig;
}

/**
 * Check if a chain is supported for a protocol.
 * For local chain (31337), checks environment variable first.
 */
export function isChainSupported(
  protocol: CloseOrderProtocol,
  chainId: number
): boolean {
  // Check env var for local chain first
  if (chainId === LOCAL_CHAIN_ID) {
    const localConfig = getLocalChainConfig();
    if (localConfig) return true;
  }

  const chainConfig = config[protocol]?.[chainId.toString()];
  return !!(chainConfig && chainConfig.contractAddress);
}

/**
 * Check if a chain is configured for a protocol (may not have contract deployed yet).
 */
export function isChainConfigured(
  protocol: CloseOrderProtocol,
  chainId: number
): boolean {
  return !!config[protocol]?.[chainId.toString()];
}

/**
 * Get all supported chains for a protocol (with deployed contracts).
 * Includes local chain (31337) if environment variable is set.
 */
export function getSupportedChains(protocol: CloseOrderProtocol): number[] {
  const protocolConfig = config[protocol];
  const chains: number[] = [];

  // Add local chain if env var is set
  const localConfig = getLocalChainConfig();
  if (localConfig) {
    chains.push(LOCAL_CHAIN_ID);
  }

  if (protocolConfig) {
    const configChains = Object.entries(protocolConfig)
      .filter(([chainId, cfg]) => {
        // Skip local chain from JSON (use env var instead)
        if (parseInt(chainId, 10) === LOCAL_CHAIN_ID) return false;
        return !!cfg.contractAddress;
      })
      .map(([chainId]) => parseInt(chainId, 10));
    chains.push(...configChains);
  }

  return chains;
}

/**
 * Get all configured chains for a protocol (may or may not have deployed contracts).
 */
export function getConfiguredChains(protocol: CloseOrderProtocol): number[] {
  const protocolConfig = config[protocol];
  if (!protocolConfig) return [];

  return Object.keys(protocolConfig).map((chainId) => parseInt(chainId, 10));
}

export const SUPPORTED_PROTOCOLS: CloseOrderProtocol[] = ['uniswapv3'];
