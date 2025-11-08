/**
 * ERC-20 Contract Reader
 *
 * Utilities for reading token metadata from ERC-20 contracts.
 * Uses viem's multicall for efficient batch reads.
 */

import type { PublicClient } from "viem";
import { erc20Abi, type TokenMetadata } from "./erc20-abi.js";

/**
 * Error thrown when token contract does not implement required ERC-20 metadata
 */
export class TokenMetadataError extends Error {
    constructor(
        message: string,
        public readonly address: string,
        public override readonly cause?: unknown
    ) {
        super(message);
        this.name = "TokenMetadataError";
    }
}

/**
 * Read token metadata from an ERC-20 contract
 *
 * Uses viem's multicall to fetch name, symbol, and decimals in a single RPC call.
 * This is more efficient than making three separate contract calls.
 *
 * @param client - Viem PublicClient configured for the correct chain
 * @param address - Token contract address (must be checksummed)
 * @returns Token metadata (name, symbol, decimals)
 * @throws TokenMetadataError if contract doesn't implement ERC-20 metadata
 *
 * @example
 * ```typescript
 * const client = evmConfig.getPublicClient(1);
 * const metadata = await readTokenMetadata(
 *   client,
 *   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
 * );
 * // { name: 'USD Coin', symbol: 'USDC', decimals: 6 }
 * ```
 */
export async function readTokenMetadata(
    client: PublicClient,
    address: string
): Promise<TokenMetadata> {
    try {
        // Use multicall for efficient batch reading
        const results = await client.multicall({
            contracts: [
                {
                    address: address as `0x${string}`,
                    abi: erc20Abi,
                    functionName: "name",
                },
                {
                    address: address as `0x${string}`,
                    abi: erc20Abi,
                    functionName: "symbol",
                },
                {
                    address: address as `0x${string}`,
                    abi: erc20Abi,
                    functionName: "decimals",
                },
            ],
            allowFailure: false, // Throw if any call fails
        });

        // Extract results from multicall response
        const [name, symbol, decimals] = results;

        // Validate results
        if (typeof name !== "string" || !name) {
            throw new TokenMetadataError(
                "Token contract does not implement name() or returned invalid value",
                address
            );
        }

        if (typeof symbol !== "string" || !symbol) {
            throw new TokenMetadataError(
                "Token contract does not implement symbol() or returned invalid value",
                address
            );
        }

        if (typeof decimals !== "number" || decimals < 0 || decimals > 255) {
            throw new TokenMetadataError(
                "Token contract does not implement decimals() or returned invalid value",
                address
            );
        }

        return {
            name,
            symbol,
            decimals,
        };
    } catch (error) {
        // If it's already a TokenMetadataError, rethrow it
        if (error instanceof TokenMetadataError) {
            throw error;
        }

        // Wrap other errors in TokenMetadataError
        const errorMessage =
            error instanceof Error ? error.message : String(error);

        throw new TokenMetadataError(
            `Failed to read token metadata from contract: ${errorMessage}`,
            address,
            error
        );
    }
}
