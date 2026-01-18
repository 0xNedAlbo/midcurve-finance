/**
 * Paraswap AugustusRegistry addresses per chain
 *
 * AugustusRegistry is used by HedgeVault to validate Paraswap Augustus contracts
 * for token swaps during SIL/TIP execution and reopen operations.
 *
 * Source: apps/midcurve-automation/script/Deploy.s.sol
 */

const AUGUSTUS_REGISTRY_ADDRESSES: Record<number, `0x${string}`> = {
  1: '0xa68bEA62Dc4034A689AA0F58A76681433caCa663', // Ethereum
  42161: '0xdC6E2b14260F972ad4e5a31c68294Fba7E720701', // Arbitrum
  8453: '0x7E31B336F9E8bA52ba3c4ac861b033Ba90900bb3', // Base
  10: '0x6e7bE86000dF697facF4396efD2aE2C322165dC3', // Optimism
  137: '0xca35a4866747Ff7A604EF7a2A7F246bb870f3ca1', // Polygon
};

/**
 * Get the Paraswap AugustusRegistry address for a given chain
 * @param chainId - The chain ID
 * @returns The AugustusRegistry address or null if not supported
 */
export function getAugustusRegistryAddress(
  chainId: number
): `0x${string}` | null {
  return AUGUSTUS_REGISTRY_ADDRESSES[chainId] ?? null;
}
