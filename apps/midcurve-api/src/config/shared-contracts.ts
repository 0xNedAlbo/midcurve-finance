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

/**
 * Get the shared contract address for a protocol on a specific chain.
 * @throws Error if chain is not supported for the protocol
 */
export function getSharedContractAddress(
  protocol: CloseOrderProtocol,
  chainId: number
): string {
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
 * @throws Error if chain is not supported for the protocol
 */
export function getSharedContractConfig(
  protocol: CloseOrderProtocol,
  chainId: number
): SharedContractConfig {
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
 */
export function isChainSupported(
  protocol: CloseOrderProtocol,
  chainId: number
): boolean {
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
 */
export function getSupportedChains(protocol: CloseOrderProtocol): number[] {
  const protocolConfig = config[protocol];
  if (!protocolConfig) return [];

  return Object.entries(protocolConfig)
    .filter(([, cfg]) => !!cfg.contractAddress)
    .map(([chainId]) => parseInt(chainId, 10));
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
