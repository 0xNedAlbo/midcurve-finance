/**
 * Uniswap V3 Subgraph Configuration
 *
 * Maps chain IDs to The Graph subgraph endpoints for Uniswap V3 protocol.
 * These endpoints provide historical data, metrics, and analytics for Uniswap V3 pools.
 *
 * Subgraph deployment IDs are configured via environment variables:
 * - UNISWAP_V3_SUBGRAPH_ID_ETHEREUM
 * - UNISWAP_V3_SUBGRAPH_ID_ARBITRUM
 * - UNISWAP_V3_SUBGRAPH_ID_BASE
 * - UNISWAP_V3_SUBGRAPH_ID_OPTIMISM
 * - UNISWAP_V3_SUBGRAPH_ID_POLYGON
 * - UNISWAP_V3_SUBGRAPH_ID_BSC
 *
 * Find deployment IDs at: https://thegraph.com/explorer
 * Official documentation: https://docs.uniswap.org/api/subgraph/overview
 */

import { SupportedChainId } from "./evm.js";

/**
 * Environment variable names for Uniswap V3 subgraph deployment IDs
 */
const SUBGRAPH_ENV_VARS: Partial<Record<SupportedChainId, string>> = {
    [SupportedChainId.ETHEREUM]: "UNISWAP_V3_SUBGRAPH_ID_ETHEREUM",
    [SupportedChainId.ARBITRUM]: "UNISWAP_V3_SUBGRAPH_ID_ARBITRUM",
    [SupportedChainId.BASE]: "UNISWAP_V3_SUBGRAPH_ID_BASE",
    [SupportedChainId.OPTIMISM]: "UNISWAP_V3_SUBGRAPH_ID_OPTIMISM",
    [SupportedChainId.POLYGON]: "UNISWAP_V3_SUBGRAPH_ID_POLYGON",
    [SupportedChainId.BSC]: "UNISWAP_V3_SUBGRAPH_ID_BSC",
};

/**
 * The Graph gateway base URL
 */
const THE_GRAPH_GATEWAY = "https://gateway.thegraph.com/api";

/**
 * Get the subgraph deployment ID for a chain from environment variables
 *
 * @param chainId - The chain ID
 * @returns The subgraph deployment ID or undefined if not configured
 */
function getSubgraphId(chainId: SupportedChainId): string | undefined {
    const envVar = SUBGRAPH_ENV_VARS[chainId];
    return envVar ? process.env[envVar] : undefined;
}

/**
 * Get The Graph API key from environment variable
 *
 * @returns The API key
 * @throws Error if API key is not configured (unless in test mode)
 */
function getTheGraphApiKey(): string {
    const apiKey = process.env.THE_GRAPH_API_KEY;

    if (!apiKey) {
        if (process.env.NODE_ENV === "test") {
            return "test-api-key-placeholder";
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
 * Builds the endpoint URL from environment variables:
 * - THE_GRAPH_API_KEY: Your API key from The Graph
 * - UNISWAP_V3_SUBGRAPH_ID_<CHAIN>: The deployment ID for the chain
 *
 * @param chainId - The chain ID to get the endpoint for
 * @returns The subgraph GraphQL endpoint URL
 * @throws Error if chain is not supported or required env vars not configured
 *
 * @example
 * ```typescript
 * // With env vars:
 * // THE_GRAPH_API_KEY=abc123
 * // UNISWAP_V3_SUBGRAPH_ID_ETHEREUM=5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV
 *
 * const endpoint = getUniswapV3SubgraphEndpoint(1);
 * // Returns: 'https://gateway.thegraph.com/api/abc123/subgraphs/id/5zvR82Q...'
 * ```
 */
export function getUniswapV3SubgraphEndpoint(chainId: number): string {
    const envVar = SUBGRAPH_ENV_VARS[chainId as SupportedChainId];

    if (!envVar) {
        const supportedChains = Object.keys(SUBGRAPH_ENV_VARS)
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

    const subgraphId = getSubgraphId(chainId as SupportedChainId);

    if (!subgraphId) {
        throw new Error(
            `Uniswap V3 subgraph ID not configured for chain ${chainId}.\n\n` +
                `Please set the ${envVar} environment variable.\n` +
                `You can find deployment IDs at: https://thegraph.com/explorer\n\n` +
                `Example:\n` +
                `${envVar}=5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV`
        );
    }

    const apiKey = getTheGraphApiKey();

    return `${THE_GRAPH_GATEWAY}/${apiKey}/subgraphs/id/${subgraphId}`;
}

/**
 * Check if Uniswap V3 subgraph is available for a given chain
 *
 * Returns true only if both the chain is supported AND the subgraph ID
 * environment variable is configured.
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
    const envVar = SUBGRAPH_ENV_VARS[chainId as SupportedChainId];
    if (!envVar) return false;

    const subgraphId = process.env[envVar];
    return !!subgraphId;
}

/**
 * Get all chain IDs with Uniswap V3 subgraph support configured
 *
 * Only returns chains that have their subgraph ID environment variable set.
 *
 * @returns Array of supported chain IDs
 *
 * @example
 * ```typescript
 * const chains = getSupportedUniswapV3SubgraphChains();
 * // Returns: [1, 42161, 8453, 10, 137] (depending on configured env vars)
 * ```
 */
export function getSupportedUniswapV3SubgraphChains(): number[] {
    return Object.entries(SUBGRAPH_ENV_VARS)
        .filter(([, envVar]) => envVar && process.env[envVar])
        .map(([chainId]) => Number(chainId));
}
