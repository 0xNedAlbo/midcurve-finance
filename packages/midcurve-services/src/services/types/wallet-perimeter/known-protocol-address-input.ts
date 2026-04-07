/**
 * Known Protocol Address Input Types
 *
 * Input types for KnownProtocolAddress CRUD operations.
 * Service-layer only — not shared with UI/API.
 */

export interface CreateKnownProtocolAddressInput {
  chainType: string; // 'evm' | 'solana'
  protocolName: string; // 'arrakis', 'aave', etc.
  interactionType: string; // 'vault' | 'staking' | 'bridge' | 'router'
  address: string; // Raw address — service builds protocolAddressHash and config
  chainId: number; // Chain ID for the protocol address hash
  label?: string;
}

export interface UpdateKnownProtocolAddressInput {
  label?: string;
  interactionType?: string;
  isActive?: boolean;
}
