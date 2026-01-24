/**
 * Paraswap AugustusRegistry addresses per chain
 *
 * AugustusRegistry is used by HedgeVault to validate Paraswap Augustus contracts
 * for token swaps during SIL/TIP execution and reopen operations.
 *
 * Source: apps/midcurve-automation/script/Deploy.s.sol
 */

import { isLocalChainEnabled } from '../chains';

const AUGUSTUS_REGISTRY_ADDRESSES: Record<number, `0x${string}`> = {
  1: '0xa68bEA62Dc4034A689AA0F58A76681433caCa663', // Ethereum
  42161: '0xdC6E2b14260F972ad4e5a31c68294Fba7E720701', // Arbitrum
  8453: '0x7E31B336F9E8bA52ba3c4ac861b033Ba90900bb3', // Base
  10: '0x6e7bE86000dF697facF4396efD2aE2C322165dC3', // Optimism
  137: '0xca35a4866747Ff7A604EF7a2A7F246bb870f3ca1', // Polygon
};

// Local chain ID (Anvil default)
const LOCAL_CHAIN_ID = 31337;

/**
 * Get the Paraswap AugustusRegistry address for a given chain
 * For local chain (31337), reads from VITE_MOCK_AUGUSTUS_ADDRESS env var
 * @param chainId - The chain ID
 * @returns The AugustusRegistry address or null if not supported
 */
export function getAugustusRegistryAddress(
  chainId: number
): `0x${string}` | null {
  // Check env var for local chain first
  if (chainId === LOCAL_CHAIN_ID && isLocalChainEnabled) {
    const localAddress = import.meta.env.VITE_MOCK_AUGUSTUS_ADDRESS;
    if (localAddress) {
      return localAddress as `0x${string}`;
    }
  }

  return AUGUSTUS_REGISTRY_ADDRESSES[chainId] ?? null;
}
