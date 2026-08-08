/**
 * Close Order Identity Hash
 *
 * The identity of a close order is the pair (position, triggerMode). The hash
 * encodes only what determines the position, plus the trigger mode:
 *
 * - NFT:   "uniswapv3/{chainId}/{nftId}/{triggerMode}"
 * - Vault: "uniswapv3-vault/{chainId}/{vaultAddress}/{ownerAddress}/{triggerMode}"
 *
 * A vault is an ERC-20 whose shares can be held by several owners, each able to
 * hold their own orders — so the vault discriminator comprises vault address AND
 * owner address, matching the vault position hash
 * "uniswapv3-vault/{chainId}/{vaultAddress}/{ownerAddress}".
 *
 * Addresses are EIP-55 checksummed, exactly as in the position hash. This is the
 * single place where that normalization happens: every writer of a CloseOrder row
 * (the on-chain event rule and UniswapV3CloseOrderService.refresh()) must go
 * through here, or the same slot ends up with two differently-cased hashes and
 * collides on the @@unique([positionId, closeOrderHash]) constraint.
 */

import { normalizeAddress } from '@midcurve/shared';
import type { ContractTriggerMode } from '@midcurve/shared';

/** Identity components for a UniswapV3 NFT close order */
export interface NftCloseOrderIdentity {
  protocol: 'uniswapv3';
  chainId: number;
  nftId: string | number;
  triggerMode: ContractTriggerMode | number;
}

/** Identity components for a UniswapV3 vault close order */
export interface VaultCloseOrderIdentity {
  protocol: 'uniswapv3-vault';
  chainId: number;
  vaultAddress: string;
  ownerAddress: string;
  triggerMode: ContractTriggerMode | number;
}

export type CloseOrderIdentity = NftCloseOrderIdentity | VaultCloseOrderIdentity;

/**
 * Builds the unique identity hash for a close order.
 *
 * @throws if a vault identity is missing the vault or owner address, or if either
 *         address is not a valid EVM address (normalizeAddress throws)
 */
export function createCloseOrderIdentityHash(identity: CloseOrderIdentity): string {
  if (identity.protocol === 'uniswapv3-vault') {
    const { chainId, vaultAddress, ownerAddress, triggerMode } = identity;

    if (!vaultAddress || !ownerAddress) {
      throw new Error(
        `Vault close order identity requires vaultAddress and ownerAddress ` +
          `(chainId=${chainId}, triggerMode=${triggerMode})`,
      );
    }

    return [
      'uniswapv3-vault',
      chainId,
      normalizeAddress(vaultAddress),
      normalizeAddress(ownerAddress),
      triggerMode,
    ].join('/');
  }

  const { chainId, nftId, triggerMode } = identity;

  if (nftId === undefined || nftId === null || nftId === '') {
    throw new Error(
      `NFT close order identity requires nftId (chainId=${chainId}, triggerMode=${triggerMode})`,
    );
  }

  return ['uniswapv3', chainId, nftId, triggerMode].join('/');
}
