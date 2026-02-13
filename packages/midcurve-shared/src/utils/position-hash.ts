/**
 * Position Hash Parsing Utility
 *
 * Parses positionHash strings into structured, protocol-specific identifiers.
 * The positionHash format is: "{protocol}/{...protocol-specific-fields}"
 *
 * Supported formats:
 * - Uniswap V3: "uniswapv3/{chainId}/{nftId}" → { protocol: 'uniswapv3', chainId, nftId }
 *
 * @example
 * ```typescript
 * const parsed = parsePositionHash('uniswapv3/1/12345');
 * // { protocol: 'uniswapv3', chainId: 1, nftId: 12345 }
 *
 * if (parsed.protocol === 'uniswapv3') {
 *   console.log(parsed.chainId, parsed.nftId); // Type-safe access
 * }
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parsed UniswapV3 position hash
 */
export interface UniswapV3PositionHashData {
  protocol: 'uniswapv3';
  chainId: number;
  nftId: number;
}

// Future protocols:
// export interface OrcaPositionHashData {
//   protocol: 'orca';
//   positionId: string;
// }

/**
 * Discriminated union of all parsed position hash types.
 * Extend this union when adding new protocol support.
 */
export type ParsedPositionHash = UniswapV3PositionHashData;
// Future: | OrcaPositionHashData;

// ============================================================================
// PARSING
// ============================================================================

/**
 * Parse a positionHash string into a structured, protocol-specific object.
 *
 * @param hash - Position hash string (e.g. "uniswapv3/1/12345")
 * @returns Parsed position hash with protocol-specific fields
 * @throws Error if hash format is invalid or protocol is unknown
 */
export function parsePositionHash(hash: string): ParsedPositionHash {
  if (!hash || typeof hash !== 'string') {
    throw new Error(`Invalid positionHash: expected non-empty string, got ${typeof hash}`);
  }

  const parts = hash.split('/');
  if (parts.length < 2) {
    throw new Error(`Invalid positionHash format: "${hash}" (expected "protocol/...")`);
  }

  const protocol = parts[0];

  switch (protocol) {
    case 'uniswapv3': {
      if (parts.length !== 3) {
        throw new Error(
          `Invalid uniswapv3 positionHash: "${hash}" (expected "uniswapv3/{chainId}/{nftId}")`
        );
      }
      const chainId = Number(parts[1]);
      const nftId = Number(parts[2]);
      if (!Number.isInteger(chainId) || chainId <= 0) {
        throw new Error(`Invalid chainId in positionHash: "${parts[1]}"`);
      }
      if (!Number.isInteger(nftId) || nftId < 0) {
        throw new Error(`Invalid nftId in positionHash: "${parts[2]}"`);
      }
      return { protocol: 'uniswapv3', chainId, nftId };
    }

    default:
      throw new Error(`Unknown protocol in positionHash: "${protocol}"`);
  }
}
