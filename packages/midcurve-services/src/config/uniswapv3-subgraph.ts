/**
 * Uniswap V3 Subgraph Configuration
 *
 * Maps chain IDs to The Graph subgraph endpoints for Uniswap V3 protocol.
 * These endpoints provide historical data, metrics, and analytics for Uniswap V3 pools.
 *
 * Official documentation: https://docs.uniswap.org/api/subgraph/overview
 */

import { SupportedChainId } from "./evm.js";

/**
 * Uniswap V3 subgraph endpoints by chain ID
 *
 * These are hosted subgraphs on The Graph's decentralized network.
 * Each subgraph indexes Uniswap V3 events and provides a GraphQL API.
 *
 * Sources:
 * - Ethereum: https://thegraph.com/explorer/subgraphs/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV
 * - Arbitrum: https://thegraph.com/explorer/subgraphs/FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aJM
 * - Base: https://api.studio.thegraph.com/query/48211/uniswap-v3-base/version/latest
 * - Optimism: https://thegraph.com/explorer/subgraphs/Cghf4LfVqPiFw6fp6Y5X5Ubc8UpmUhSfJL82zwiBFLaj
 * - Polygon: https://thegraph.com/explorer/subgraphs/3hCPRGf4z88VC5rsBKU5AA9FBBq5nF3jbKJG7VZCbhjm
 * - BSC: Community-maintained subgraph (if available)
 */
export const UNISWAP_V3_SUBGRAPH_ENDPOINTS: Partial<
    Record<SupportedChainId, string>
> = {
    // Ethereum Mainnet
    [SupportedChainId.ETHEREUM]:
        "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV",

    // Arbitrum One
    [SupportedChainId.ARBITRUM]:
        "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/FbCGRftH4a3yZugY7TnbYgPJVEv2LvMT6oF1fxPe9aJM",

    // Base
    [SupportedChainId.BASE]:
        "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/HMuAwufqZ1YCRmzL2SfHTVkzZovC9VL2UAKhjvRqKiR1",

    // Optimism
    [SupportedChainId.OPTIMISM]:
        "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/AUpZ47RTWDBpco7YTTffGyRkBJ2i26Ms8dQSkUdxPHGc",

    // Polygon
    [SupportedChainId.POLYGON]:
        "https://gateway.thegraph.com/api/[api-key]/subgraphs/id/3hCPRGf4z88VC5rsBKU5AA9FBBq5nF3jbKJG7VZCbhjm",

    // BSC - Note: Uniswap V3 may not be officially deployed on BSC
    // Uncomment if/when a reliable subgraph becomes available
    // [SupportedChainId.BSC]:
    //   'https://api.thegraph.com/subgraphs/name/ianlapham/uniswap-v3-bsc',
};

/**
 * Get The Graph API key from environment variable
 *
 * @returns The API key
 * @throws Error if API key is not configured (unless in test mode)
 */
function getTheGraphApiKey(): string {
    const apiKey = process.env.THE_GRAPH_API_KEY;

    if (!apiKey) {
        // In test mode, return a placeholder to avoid breaking tests
        // This allows unit tests to run without a real API key
        if (process.env.NODE_ENV === 'test') {
            return 'test-api-key-placeholder';
        }

        throw new Error(
            `The Graph API key not configured.\n\n` +
                `Please set the THE_GRAPH_API_KEY environment variable.\n` +
                `You can get an API key from: https://thegraph.com/studio/apikeys/\n\n` +
                `Example:\n` +
                `THE_GRAPH_API_KEY=your_api_key_here`
        );
    }

    return apiKey;
}

/**
 * Get the Uniswap V3 subgraph endpoint for a given chain
 *
 * Automatically replaces the [api-key] placeholder with the API key
 * from the THE_GRAPH_API_KEY environment variable.
 *
 * @param chainId - The chain ID to get the endpoint for
 * @returns The subgraph GraphQL endpoint URL with API key
 * @throws Error if chain is not supported or API key not configured
 *
 * @example
 * ```typescript
 * // With THE_GRAPH_API_KEY=abc123 in environment
 * const endpoint = getUniswapV3SubgraphEndpoint(1); // Ethereum
 * // Returns: 'https://gateway.thegraph.com/api/abc123/subgraphs/id/5zvR82Q...'
 * ```
 */
export function getUniswapV3SubgraphEndpoint(chainId: number): string {
    const endpointTemplate =
        UNISWAP_V3_SUBGRAPH_ENDPOINTS[chainId as SupportedChainId];

    if (!endpointTemplate) {
        const supportedChains = Object.keys(UNISWAP_V3_SUBGRAPH_ENDPOINTS)
            .map(Number)
            .join(", ");

        throw new Error(
            `Uniswap V3 subgraph not available for chain ${chainId}. ` +
                `Supported chains: ${supportedChains}\n\n` +
                `If you believe this chain should have a subgraph, please check:\n` +
                `- https://docs.uniswap.org/api/subgraph/overview\n` +
                `- https://thegraph.com/explorer`
        );
    }

    // Replace [api-key] placeholder with actual API key
    const apiKey = getTheGraphApiKey();
    const endpoint = endpointTemplate.replace("[api-key]", apiKey);

    return endpoint;
}

/**
 * Check if Uniswap V3 subgraph is available for a given chain
 *
 * @param chainId - The chain ID to check
 * @returns true if subgraph is available, false otherwise
 *
 * @example
 * ```typescript
 * if (isUniswapV3SubgraphSupported(1)) {
 *   // Query subgraph for Ethereum
 * }
 * ```
 */
export function isUniswapV3SubgraphSupported(chainId: number): boolean {
    return chainId in UNISWAP_V3_SUBGRAPH_ENDPOINTS;
}

/**
 * Get all chain IDs with Uniswap V3 subgraph support
 *
 * @returns Array of supported chain IDs
 *
 * @example
 * ```typescript
 * const chains = getSupportedUniswapV3SubgraphChains();
 * // Returns: [1, 42161, 8453, 10, 137]
 * ```
 */
export function getSupportedUniswapV3SubgraphChains(): number[] {
    return Object.keys(UNISWAP_V3_SUBGRAPH_ENDPOINTS).map(Number);
}
