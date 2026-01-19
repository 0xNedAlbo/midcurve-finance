/**
 * Erc20TokenService
 *
 * Specialized service for ERC-20 token management.
 * Handles serialization/deserialization of ERC-20 token config.
 */

import { PrismaClient } from '@midcurve/database';
import type { Token } from '@midcurve/shared';
import type { Erc20TokenConfig } from '@midcurve/shared';
import { isValidAddress, normalizeAddress } from '@midcurve/shared';
import type {
    CreateTokenInput,
    UpdateTokenInput,
    Erc20TokenDiscoverInput,
    Erc20TokenSearchInput,
    Erc20TokenSearchCandidate,
} from "../types/token/token-input.js";
import { TokenService } from "./token-service.js";
import {
    readTokenMetadata,
    TokenMetadataError,
} from "../../utils/evm/index.js";
import { EvmConfig, isLocalChain } from "../../config/evm.js";
import { CoinGeckoClient } from "../../clients/coingecko/index.js";
import { log } from "../../logging/index.js";

/**
 * Dependencies for Erc20TokenService
 * All dependencies are optional and will use defaults if not provided
 */
export interface Erc20TokenServiceDependencies {
    /**
     * Prisma client for database operations
     * If not provided, a new PrismaClient instance will be created
     */
    prisma?: PrismaClient;

    /**
     * EVM configuration for chain RPC access
     * If not provided, the singleton EvmConfig instance will be used
     */
    evmConfig?: EvmConfig;

    /**
     * CoinGecko API client for token enrichment
     * If not provided, the singleton CoinGeckoClient instance will be used
     */
    coinGeckoClient?: CoinGeckoClient;
}

/**
 * Erc20TokenService
 *
 * Provides token management for ERC-20 tokens.
 * Implements serialization methods for ERC-20 config type.
 */
export class Erc20TokenService extends TokenService<"erc20"> {
    private readonly _evmConfig: EvmConfig;
    private readonly _coinGeckoClient: CoinGeckoClient;

    /**
     * Creates a new Erc20TokenService instance
     *
     * @param dependencies - Optional dependencies object
     * @param dependencies.prisma - Prisma client instance (creates default if not provided)
     * @param dependencies.evmConfig - EVM configuration instance (uses singleton if not provided)
     * @param dependencies.coinGeckoClient - CoinGecko client instance (uses singleton if not provided)
     */
    constructor(dependencies: Erc20TokenServiceDependencies = {}) {
        super(dependencies);
        this._evmConfig = dependencies.evmConfig ?? EvmConfig.getInstance();
        this._coinGeckoClient =
            dependencies.coinGeckoClient ?? CoinGeckoClient.getInstance();
    }

    /**
     * Get the EVM configuration instance
     */
    protected get evmConfig(): EvmConfig {
        return this._evmConfig;
    }

    /**
     * Get the CoinGecko client instance
     */
    protected get coinGeckoClient(): CoinGeckoClient {
        return this._coinGeckoClient;
    }

    // ============================================================================
    // ABSTRACT METHOD IMPLEMENTATIONS
    // ============================================================================

    /**
     * Parse config from database JSON to application type
     *
     * For ERC-20, config contains address, chainId, and optional basicCurrencyId.
     *
     * @param configDB - Config object from database (JSON)
     * @returns Parsed ERC-20 config
     */
    parseConfig(configDB: unknown): Erc20TokenConfig {
        const db = configDB as {
            address: string;
            chainId: number;
            basicCurrencyId?: string;
        };

        const config: Erc20TokenConfig = {
            address: db.address,
            chainId: db.chainId,
        };

        // Only include basicCurrencyId if it exists
        if (db.basicCurrencyId) {
            config.basicCurrencyId = db.basicCurrencyId;
        }

        return config;
    }

    /**
     * Serialize config from application type to database JSON
     *
     * For ERC-20, config contains address, chainId, and optional basicCurrencyId.
     *
     * @param config - Application config
     * @returns Serialized config for database storage (JSON-serializable)
     */
    serializeConfig(config: Erc20TokenConfig): unknown {
        const serialized: Record<string, unknown> = {
            address: config.address,
            chainId: config.chainId,
        };

        // Only include basicCurrencyId if it exists
        if (config.basicCurrencyId) {
            serialized.basicCurrencyId = config.basicCurrencyId;
        }

        return serialized;
    }

    // ============================================================================
    // ABSTRACT METHOD IMPLEMENTATION - DISCOVERY
    // ============================================================================

    /**
     * Discover and create an ERC-20 token from on-chain contract data
     *
     * Checks the database first for an existing token. If not found, reads
     * token metadata (name, symbol, decimals) from the contract, fetches
     * enrichment data from CoinGecko, and creates a new token entry.
     *
     * CoinGecko enrichment is MANDATORY - the method fails if CoinGecko data
     * cannot be fetched.
     *
     * @param params - Discovery parameters { address, chainId }
     * @returns The discovered or existing token with full CoinGecko enrichment
     * @throws Error if address format is invalid
     * @throws Error if chain ID is not supported
     * @throws TokenMetadataError if contract doesn't implement ERC-20 metadata
     * @throws CoinGeckoApiError if CoinGecko API request fails
     */
    override async discover(params: Erc20TokenDiscoverInput): Promise<Token<"erc20">> {
        const { address, chainId } = params;
        log.methodEntry(this.logger, "discover", { address, chainId });

        try {
            // 1. Validate address format
            if (!isValidAddress(address)) {
                const error = new Error(`Invalid Ethereum address format: ${address}`);
                log.methodError(this.logger, "discover", error, { address, chainId });
                throw error;
            }

            // 2. Normalize to EIP-55
            const normalizedAddress = normalizeAddress(address);
            this.logger.debug(
                { original: address, normalized: normalizedAddress },
                "Address normalized for discovery"
            );

            // 3. Check database first (optimization)
            const existing = await this.findByAddressAndChain(normalizedAddress, chainId);

            if (existing) {
                // If already has CoinGecko data, return immediately
                if (existing.coingeckoId) {
                    this.logger.info(
                        {
                            id: existing.id,
                            address: normalizedAddress,
                            chainId,
                            symbol: existing.symbol,
                        },
                        "Token already exists with CoinGecko data, skipping on-chain discovery"
                    );
                    log.methodExit(this.logger, "discover", { id: existing.id, fromDatabase: true });
                    return existing;
                }

                // For local chains, CoinGecko enrichment is not possible - return as-is
                if (isLocalChain(chainId)) {
                    this.logger.info(
                        {
                            id: existing.id,
                            address: normalizedAddress,
                            chainId,
                            symbol: existing.symbol,
                        },
                        "Token exists on local chain, skipping CoinGecko enrichment"
                    );
                    log.methodExit(this.logger, "discover", { id: existing.id, fromDatabase: true });
                    return existing;
                }

                // Token exists but not enriched - enrich and return
                this.logger.info(
                    { id: existing.id, symbol: existing.symbol },
                    "Token exists but needs CoinGecko enrichment"
                );
                const enriched = await this.enrichToken(existing.id);
                log.methodExit(this.logger, "discover", { id: enriched.id, enriched: true });
                return enriched;
            }

            // 4. Verify chain is supported
            if (!this.evmConfig.isChainSupported(chainId)) {
                const error = new Error(
                    `Chain ${chainId} is not configured. Supported chains: ${this.evmConfig
                        .getSupportedChainIds()
                        .join(", ")}`
                );
                log.methodError(this.logger, "discover", error, { chainId });
                throw error;
            }

            this.logger.debug({ chainId }, "Chain is supported, proceeding with on-chain discovery");

            // 5. Read on-chain metadata
            const client = this.evmConfig.getPublicClient(chainId);
            this.logger.debug(
                { address: normalizedAddress, chainId },
                "Reading token metadata from contract"
            );

            let metadata;
            try {
                metadata = await readTokenMetadata(client, normalizedAddress);
            } catch (error) {
                if (error instanceof TokenMetadataError) {
                    log.methodError(this.logger, "discover", error, {
                        address: normalizedAddress,
                        chainId,
                    });
                    throw error;
                }
                const wrappedError = new Error(
                    `Failed to read token metadata from contract at ${normalizedAddress} on chain ${chainId}: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
                log.methodError(this.logger, "discover", wrappedError, {
                    address: normalizedAddress,
                    chainId,
                });
                throw wrappedError;
            }

            this.logger.info(
                {
                    address: normalizedAddress,
                    chainId,
                    name: metadata.name,
                    symbol: metadata.symbol,
                    decimals: metadata.decimals,
                },
                "Token metadata discovered from contract"
            );

            // 6. Fetch CoinGecko enrichment data
            // For local chains, skip CoinGecko (not indexed) and use on-chain data only
            let enrichmentData: {
                coingeckoId: string | null;
                logoUrl: string | null | undefined;
                marketCap: number | null | undefined;
            };

            if (isLocalChain(chainId)) {
                // Local chain is a mainnet fork - try CoinGecko with mainnet chainId,
                // then fall back to symbol-based matching for local-only tokens
                this.logger.debug(
                    { address: normalizedAddress, chainId },
                    "Using local chain enrichment strategy (mainnet lookup + symbol fallback)"
                );
                enrichmentData = await this.getLocalChainEnrichment(
                    normalizedAddress,
                    metadata.symbol
                );
            } else {
                this.logger.debug(
                    { address: normalizedAddress, chainId },
                    "Fetching CoinGecko enrichment data"
                );

                enrichmentData = await this.coinGeckoClient.getErc20EnrichmentData(
                    chainId,
                    normalizedAddress
                );

                this.logger.info(
                    {
                        coingeckoId: enrichmentData.coingeckoId,
                        marketCap: enrichmentData.marketCap,
                    },
                    "CoinGecko enrichment data fetched"
                );
            }

            // 7. Check for auto-linking to basic currency
            const basicCurrencyCode = Erc20TokenService.getAutoLinkBasicCurrency(metadata.symbol);
            let basicCurrencyId: string | undefined;

            if (basicCurrencyCode) {
                // Look up or create the basic currency
                const basicCurrency = await this.ensureBasicCurrency(basicCurrencyCode);
                basicCurrencyId = basicCurrency.id;
                this.logger.info(
                    {
                        symbol: metadata.symbol,
                        basicCurrencyCode,
                        basicCurrencyId,
                    },
                    "Auto-linking token to basic currency"
                );
            }

            // 8. Create token with all data
            // Convert null to undefined for optional fields (create() expects undefined, not null)
            const token = await this.create({
                tokenType: "erc20",
                name: metadata.name,
                symbol: metadata.symbol,
                decimals: metadata.decimals,
                logoUrl: enrichmentData.logoUrl ?? undefined,
                coingeckoId: enrichmentData.coingeckoId ?? undefined,
                marketCap: enrichmentData.marketCap ?? undefined,
                config: {
                    address: normalizedAddress,
                    chainId,
                    ...(basicCurrencyId && { basicCurrencyId }),
                },
            });

            this.logger.info(
                {
                    id: token.id,
                    address: normalizedAddress,
                    chainId,
                    symbol: token.symbol,
                    basicCurrencyId: basicCurrencyId ?? null,
                },
                "Token discovered and created successfully"
            );
            log.methodExit(this.logger, "discover", { id: token.id, fromBlockchain: true });
            return token;
        } catch (error) {
            // Only log if not already logged
            if (
                !(
                    error instanceof Error &&
                    (error.message.includes("Invalid Ethereum address") ||
                        error.message.includes("not configured") ||
                        error instanceof TokenMetadataError ||
                        error.message.includes("Failed to read token metadata"))
                )
            ) {
                log.methodError(this.logger, "discover", error as Error, { address, chainId });
            }
            throw error;
        }
    }

    // ============================================================================
    // CRUD OPERATIONS
    // ============================================================================

    /**
     * Find an ERC-20 token by its database ID
     *
     * @param id - Token database ID
     * @returns The token if found and is ERC-20 type, null otherwise
     */
    override async findById(id: string): Promise<Token<"erc20"> | null> {
        log.methodEntry(this.logger, "findById", { id });

        try {
            log.dbOperation(this.logger, "findUnique", "Token", { id });

            const result = await this.prisma.token.findUnique({
                where: { id },
            });

            if (!result) {
                this.logger.debug({ id }, "Token not found");
                log.methodExit(this.logger, "findById", { found: false });
                return null;
            }

            // Type filter: Only return if it's an ERC-20 token
            if (result.tokenType !== "erc20") {
                this.logger.debug(
                    { id, tokenType: result.tokenType },
                    "Token is not ERC-20 type"
                );
                log.methodExit(this.logger, "findById", {
                    found: false,
                    wrongType: true,
                });
                return null;
            }

            const token = this.mapToToken(result);

            this.logger.debug({ id, symbol: token.symbol }, "ERC-20 token found");
            log.methodExit(this.logger, "findById", { id });
            return token;
        } catch (error) {
            log.methodError(this.logger, "findById", error as Error, { id });
            throw error;
        }
    }

    /**
     * Create a new ERC-20 token or return existing one
     *
     * Validates and normalizes the token address to EIP-55 checksum format.
     * Checks if a token with the same address and chainId already exists.
     * If it exists, returns the existing token. Otherwise, creates a new one.
     *
     * @param input - ERC-20 token data to create (omits id, createdAt, updatedAt)
     * @returns The created or existing token with all fields populated
     * @throws Error if the address format is invalid
     */
    override async create(
        input: CreateTokenInput<"erc20">
    ): Promise<Token<"erc20">> {
        log.methodEntry(this.logger, "create", {
            address: input.config.address,
            chainId: input.config.chainId,
            symbol: input.symbol,
        });

        try {
            // Validate address format
            if (!isValidAddress(input.config.address)) {
                const error = new Error(
                    `Invalid Ethereum address format: ${input.config.address}`
                );
                log.methodError(this.logger, "create", error, {
                    address: input.config.address,
                });
                throw error;
            }

            // Normalize address to EIP-55 checksum format
            const normalizedAddress = normalizeAddress(input.config.address);
            this.logger.debug(
                {
                    original: input.config.address,
                    normalized: normalizedAddress,
                },
                "Address normalized"
            );

            // Check if token already exists with same address and chainId
            log.dbOperation(this.logger, "findFirst", "Token", {
                address: normalizedAddress,
                chainId: input.config.chainId,
            });

            const existing = await this.prisma.token.findFirst({
                where: {
                    tokenType: "erc20",
                    config: {
                        path: ["address"],
                        equals: normalizedAddress,
                    },
                    AND: {
                        config: {
                            path: ["chainId"],
                            equals: input.config.chainId,
                        },
                    },
                },
            });

            // If token exists, return it
            if (existing) {
                this.logger.info(
                    {
                        id: existing.id,
                        address: normalizedAddress,
                        chainId: input.config.chainId,
                        symbol: existing.symbol,
                    },
                    "Token already exists, returning existing token"
                );
                log.methodExit(this.logger, "create", {
                    id: existing.id,
                    duplicate: true,
                });
                return this.mapToToken(existing);
            }

            // Create new token with normalized address
            const normalizedInput: CreateTokenInput<"erc20"> = {
                ...input,
                config: {
                    ...input.config,
                    address: normalizedAddress,
                },
            };

            const token = await super.create(normalizedInput);

            this.logger.info(
                {
                    id: token.id,
                    address: normalizedAddress,
                    chainId: input.config.chainId,
                    symbol: token.symbol,
                },
                "ERC-20 token created successfully"
            );

            log.methodExit(this.logger, "create", { id: token.id });
            return token;
        } catch (error) {
            // Only log if not already logged
            if (
                !(
                    error instanceof Error &&
                    error.message.includes("Invalid Ethereum address")
                )
            ) {
                log.methodError(this.logger, "create", error as Error, {
                    address: input.config.address,
                    chainId: input.config.chainId,
                });
            }
            throw error;
        }
    }

    /**
     * Update an existing ERC-20 token
     *
     * Validates token exists and is ERC-20 type.
     * If updating address, validates and normalizes to EIP-55 checksum format.
     *
     * @param id - Token database ID
     * @param input - Partial token data to update
     * @returns The updated token
     * @throws Error if token not found or not ERC-20 type
     * @throws Error if address format is invalid (when updating address)
     */
    override async update(
        id: string,
        input: UpdateTokenInput<"erc20">
    ): Promise<Token<"erc20">> {
        log.methodEntry(this.logger, "update", {
            id,
            fields: Object.keys(input),
        });

        try {
            // Verify token exists and is ERC-20 type
            log.dbOperation(this.logger, "findUnique", "Token", { id });

            const existing = await this.prisma.token.findUnique({
                where: { id },
            });

            if (!existing) {
                const error = new Error(`Token with id ${id} not found`);
                log.methodError(this.logger, "update", error, { id });
                throw error;
            }

            if (existing.tokenType !== "erc20") {
                const error = new Error(
                    `Token ${id} is not an ERC-20 token (type: ${existing.tokenType})`
                );
                log.methodError(this.logger, "update", error, {
                    id,
                    tokenType: existing.tokenType,
                });
                throw error;
            }

            // If updating address, validate and normalize it
            let normalizedInput: UpdateTokenInput<"erc20"> = input;
            if (input.config?.address) {
                if (!isValidAddress(input.config.address)) {
                    const error = new Error(
                        `Invalid Ethereum address format: ${input.config.address}`
                    );
                    log.methodError(this.logger, "update", error, {
                        id,
                        address: input.config.address,
                    });
                    throw error;
                }
                const normalizedAddress = normalizeAddress(input.config.address);
                this.logger.debug(
                    {
                        original: input.config.address,
                        normalized: normalizedAddress,
                    },
                    "Address normalized for update"
                );
                normalizedInput = {
                    ...input,
                    config: {
                        ...input.config,
                        address: normalizedAddress,
                    },
                };
            }

            // Delegate to base class for update
            const token = await super.update(id, normalizedInput);

            this.logger.info(
                { id, symbol: token.symbol },
                "ERC-20 token updated successfully"
            );
            log.methodExit(this.logger, "update", { id });
            return token;
        } catch (error) {
            // Only log if not already logged
            if (
                !(
                    error instanceof Error &&
                    (error.message.includes("not found") ||
                        error.message.includes("not an ERC-20 token") ||
                        error.message.includes("Invalid Ethereum address"))
                )
            ) {
                log.methodError(this.logger, "update", error as Error, { id });
            }
            throw error;
        }
    }

    /**
     * Delete an ERC-20 token
     *
     * Validates token is ERC-20 type before deletion.
     * This operation is idempotent for non-existent tokens (returns silently),
     * but throws an error if attempting to delete a non-ERC-20 token (type safety).
     *
     * @param id - Token database ID
     * @throws Error if token exists but is not ERC-20 type
     */
    override async delete(id: string): Promise<void> {
        log.methodEntry(this.logger, "delete", { id });

        try {
            // Verify token exists and is ERC-20 type
            log.dbOperation(this.logger, "findUnique", "Token", { id });

            const existing = await this.prisma.token.findUnique({
                where: { id },
            });

            if (!existing) {
                this.logger.debug({ id }, "Token not found, nothing to delete");
                log.methodExit(this.logger, "delete", { id, found: false });
                return; // Idempotent: silently return if token doesn't exist
            }

            if (existing.tokenType !== "erc20") {
                const error = new Error(
                    `Token ${id} is not an ERC-20 token (type: ${existing.tokenType})`
                );
                log.methodError(this.logger, "delete", error, {
                    id,
                    tokenType: existing.tokenType,
                });
                throw error;
            }

            // Delegate to base class for deletion
            await super.delete(id);

            this.logger.info(
                { id, symbol: existing.symbol },
                "ERC-20 token deleted successfully"
            );
            log.methodExit(this.logger, "delete", { id });
        } catch (error) {
            // Only log if not already logged
            if (
                !(
                    error instanceof Error &&
                    error.message.includes("not an ERC-20 token")
                )
            ) {
                log.methodError(this.logger, "delete", error as Error, { id });
            }
            throw error;
        }
    }

    // ============================================================================
    // DISCOVERY HELPERS
    // ============================================================================

    /**
     * Find an ERC-20 token by address and chain ID
     *
     * @param address - Token contract address (will be normalized)
     * @param chainId - Chain ID
     * @returns The token if found, null otherwise
     * @throws Error if the address format is invalid
     */
    async findByAddressAndChain(
        address: string,
        chainId: number
    ): Promise<Token<"erc20"> | null> {
        log.methodEntry(this.logger, "findByAddressAndChain", { address, chainId });

        try {
            // Validate and normalize address
            if (!isValidAddress(address)) {
                const error = new Error(`Invalid Ethereum address format: ${address}`);
                log.methodError(this.logger, "findByAddressAndChain", error, { address });
                throw error;
            }
            const normalizedAddress = normalizeAddress(address);

            // Query database with JSON path
            log.dbOperation(this.logger, "findFirst", "Token", {
                address: normalizedAddress,
                chainId,
            });

            const result = await this.prisma.token.findFirst({
                where: {
                    tokenType: "erc20",
                    config: {
                        path: ["address"],
                        equals: normalizedAddress,
                    },
                    AND: {
                        config: {
                            path: ["chainId"],
                            equals: chainId,
                        },
                    },
                },
            });

            if (!result) {
                this.logger.debug({ address: normalizedAddress, chainId }, "Token not found");
                log.methodExit(this.logger, "findByAddressAndChain", { found: false });
                return null;
            }

            this.logger.debug(
                { id: result.id, address: normalizedAddress, chainId, symbol: result.symbol },
                "Token found"
            );
            log.methodExit(this.logger, "findByAddressAndChain", { id: result.id });
            return this.mapToToken(result);
        } catch (error) {
            if (!(error instanceof Error && error.message.includes("Invalid Ethereum address"))) {
                log.methodError(this.logger, "findByAddressAndChain", error as Error, {
                    address,
                    chainId,
                });
            }
            throw error;
        }
    }

    /**
     * Enrich an ERC-20 token with metadata from CoinGecko
     *
     * Updates the token with logoUrl, coingeckoId, and marketCap from CoinGecko.
     * The token must already exist in the database before enrichment.
     *
     * If the token already has a coingeckoId, it's assumed to be properly enriched
     * and will be returned immediately without making any API calls.
     *
     * @param tokenId - Token database ID
     * @returns The enriched token with updated fields
     * @throws Error if token not found in database
     * @throws Error if token is not ERC-20 type
     * @throws CoinGeckoApiError if CoinGecko API request fails
     */
    async enrichToken(tokenId: string): Promise<Token<"erc20">> {
        log.methodEntry(this.logger, "enrichToken", { tokenId });

        try {
            // Load and verify token
            log.dbOperation(this.logger, "findUnique", "Token", { id: tokenId });

            const existing = await this.prisma.token.findUnique({
                where: { id: tokenId },
            });

            if (!existing) {
                const error = new Error(`Token with id ${tokenId} not found`);
                log.methodError(this.logger, "enrichToken", error, { tokenId });
                throw error;
            }

            if (existing.tokenType !== "erc20") {
                const error = new Error(
                    `Token ${tokenId} is not an ERC-20 token (type: ${existing.tokenType})`
                );
                log.methodError(this.logger, "enrichToken", error, {
                    tokenId,
                    tokenType: existing.tokenType,
                });
                throw error;
            }

            // Skip if already enriched (idempotent)
            if (existing.coingeckoId) {
                this.logger.info(
                    { tokenId, coingeckoId: existing.coingeckoId, symbol: existing.symbol },
                    "Token already enriched, skipping CoinGecko API call"
                );
                log.methodExit(this.logger, "enrichToken", { tokenId, alreadyEnriched: true });
                return this.mapToToken(existing);
            }

            // Extract config
            const config = existing.config as { address: string; chainId: number };
            const { address, chainId } = config;

            this.logger.debug(
                { tokenId, address, chainId, symbol: existing.symbol },
                "Fetching enrichment data"
            );

            // Fetch enrichment data - use local chain strategy for forked chains
            let enrichmentData: {
                coingeckoId: string | null;
                logoUrl: string | null | undefined;
                marketCap: number | null | undefined;
            };

            if (isLocalChain(chainId)) {
                // Local chain is a mainnet fork - try mainnet lookup + symbol fallback
                this.logger.debug(
                    { tokenId, address, chainId },
                    "Using local chain enrichment strategy"
                );
                enrichmentData = await this.getLocalChainEnrichment(
                    address,
                    existing.symbol
                );
            } else {
                // Standard CoinGecko enrichment for production chains
                enrichmentData = await this.coinGeckoClient.getErc20EnrichmentData(
                    chainId,
                    address
                );
            }

            // Update token in database
            log.dbOperation(this.logger, "update", "Token", {
                id: tokenId,
                fields: ["logoUrl", "coingeckoId", "marketCap"],
            });

            const updated = await this.prisma.token.update({
                where: { id: tokenId },
                data: {
                    logoUrl: enrichmentData.logoUrl,
                    coingeckoId: enrichmentData.coingeckoId,
                    marketCap: enrichmentData.marketCap,
                },
            });

            this.logger.info(
                {
                    tokenId,
                    coingeckoId: enrichmentData.coingeckoId,
                    symbol: updated.symbol,
                    marketCap: enrichmentData.marketCap,
                },
                "Token enriched successfully with CoinGecko data"
            );

            log.methodExit(this.logger, "enrichToken", {
                tokenId,
                coingeckoId: enrichmentData.coingeckoId,
            });
            return this.mapToToken(updated);
        } catch (error) {
            // Only log if not already logged
            if (
                !(
                    error instanceof Error &&
                    (error.message.includes("not found") ||
                        error.message.includes("not an ERC-20 token"))
                )
            ) {
                log.methodError(this.logger, "enrichToken", error as Error, { tokenId });
            }
            throw error;
        }
    }

    // ============================================================================
    // SEARCH OPERATIONS
    // ============================================================================

    /**
     * Search for ERC-20 tokens by symbol and/or name within a specific chain using CoinGecko
     *
     * This method searches CoinGecko's token catalog (NOT the local database).
     * Results are tokens that match the search criteria and are available on the specified chain.
     *
     * Returns up to 10 matching tokens, ordered alphabetically by symbol.
     * Users should provide more specific search terms if they need fewer results.
     *
     * To add a token to the database, use the discover() method with the address from search results.
     *
     * @param input.chainId - EVM chain ID (REQUIRED)
     * @param input.symbol - Partial symbol match (optional, case-insensitive)
     * @param input.name - Partial name match (optional, case-insensitive)
     * @returns Array of matching token candidates from CoinGecko (max 10)
     * @throws Error if neither symbol nor name provided
     * @throws Error if chain ID is not supported
     * @throws CoinGeckoApiError if CoinGecko API request fails
     *
     * @example
     * ```typescript
     * const service = new Erc20TokenService();
     *
     * // Search for tokens with "usd" in symbol on Ethereum
     * const candidates = await service.searchTokens({
     *   chainId: 1,
     *   symbol: 'usd'
     * });
     * // Returns: [{ coingeckoId: 'usd-coin', symbol: 'USDC', name: 'USD Coin', address: '0x...', chainId: 1 }, ...]
     *
     * // To add to database, call discover() with the address
     * const token = await service.discover({
     *   address: candidates[0].address,
     *   chainId: candidates[0].chainId
     * });
     * ```
     */
    override async searchTokens(
        input: Erc20TokenSearchInput
    ): Promise<Erc20TokenSearchCandidate[]> {
        const { chainId, symbol, name, address } = input;
        log.methodEntry(this.logger, "searchTokens", { chainId, symbol, name, address });

        try {
            // Validate at least one search term provided
            if (!symbol && !name && !address) {
                const error = new Error(
                    "At least one search parameter (symbol, name, or address) must be provided"
                );
                log.methodError(this.logger, "searchTokens", error, { chainId });
                throw error;
            }

            // Validate and normalize address if provided
            let normalizedAddress: string | undefined;
            if (address) {
                if (!isValidAddress(address)) {
                    const error = new Error(`Invalid Ethereum address format: ${address}`);
                    log.methodError(this.logger, "searchTokens", error, { chainId, address });
                    throw error;
                }
                normalizedAddress = normalizeAddress(address);
                this.logger.debug(
                    { original: address, normalized: normalizedAddress },
                    "Address normalized for search"
                );
            }

            // Verify chain is supported
            if (!this.evmConfig.isChainSupported(chainId)) {
                const error = new Error(
                    `Chain ${chainId} is not configured. Supported chains: ${this.evmConfig
                        .getSupportedChainIds()
                        .join(", ")}`
                );
                log.methodError(this.logger, "searchTokens", error, { chainId });
                throw error;
            }

            // Get platform ID for this chain (null for local chains)
            const platformId = this.getPlatformId(chainId);
            const isLocal = isLocalChain(chainId);

            // For non-local chains, require a CoinGecko platform mapping
            if (!platformId && !isLocal) {
                const error = new Error(
                    `No CoinGecko platform mapping for chain ${chainId}`
                );
                log.methodError(this.logger, "searchTokens", error, { chainId });
                throw error;
            }

            // 1. Search database first for existing tokens
            this.logger.debug(
                { chainId, symbol, name, address: normalizedAddress },
                "Searching database for tokens"
            );

            // Build database query where clause
            const where: any = {
                tokenType: "erc20",
                config: {
                    path: ["chainId"],
                    equals: chainId,
                },
            };

            // Add symbol/name filter with OR logic (if both provided, match either)
            if (symbol && name) {
                // Both symbol and name provided - match EITHER (OR logic)
                where.OR = [
                    {
                        symbol: {
                            contains: symbol,
                            mode: "insensitive",
                        },
                    },
                    {
                        name: {
                            contains: name,
                            mode: "insensitive",
                        },
                    },
                ];
            } else if (symbol) {
                // Only symbol provided
                where.symbol = {
                    contains: symbol,
                    mode: "insensitive",
                };
            } else if (name) {
                // Only name provided
                where.name = {
                    contains: name,
                    mode: "insensitive",
                };
            }

            // Add address filter if provided
            if (normalizedAddress) {
                where.AND = {
                    config: {
                        path: ["address"],
                        equals: normalizedAddress,
                    },
                };
            }

            log.dbOperation(this.logger, "findMany", "Token", {
                chainId,
                symbol,
                name,
                address: normalizedAddress,
                limit: 10,
            });

            // Execute database query with ordering
            const dbTokens = await this.prisma.token.findMany({
                where,
                orderBy: [
                    { marketCap: { sort: "desc", nulls: "last" } }, // High mcap first
                    { symbol: "asc" }, // Then alphabetically
                ],
                take: 10, // Max 10 from DB
            });

            // Convert database tokens to search candidate format
            const dbCandidates: Erc20TokenSearchCandidate[] = dbTokens.map((token) => {
                const config = token.config as { address: string; chainId: number };
                return {
                    coingeckoId: token.coingeckoId || "", // Empty string if not enriched
                    symbol: token.symbol,
                    name: token.name,
                    address: config.address,
                    chainId: config.chainId,
                    logoUrl: token.logoUrl || undefined,
                    marketCap: token.marketCap || undefined,
                };
            });

            this.logger.info(
                { chainId, symbol, name, address: normalizedAddress, dbCount: dbCandidates.length },
                "Database search completed"
            );

            // 2. If we have less than 10 DB results, search CoinGecko for more
            // Skip CoinGecko search for local chains (no platform mapping available)
            let coinGeckoToAdd: Erc20TokenSearchCandidate[] = [];

            if (dbCandidates.length < 10 && platformId) {
                this.logger.debug(
                    { chainId, platformId, symbol, name, address: normalizedAddress },
                    "Searching CoinGecko for additional tokens"
                );

                // Search CoinGecko (platform-agnostic method)
                const coinGeckoResults = await this.coinGeckoClient.searchTokens({
                    platform: platformId,
                    symbol,
                    name,
                    address: normalizedAddress,
                });

                // Create set of addresses already in DB (normalized, lowercase for comparison)
                const dbAddresses = new Set(
                    dbCandidates.map((c) => c.address.toLowerCase())
                );

                // Filter out tokens already in DB
                const uniqueCoinGeckoResults = coinGeckoResults.filter(
                    (cgToken) => !dbAddresses.has(cgToken.address.toLowerCase())
                );

                // Calculate how many CoinGecko tokens to add
                const remainingSlots = 10 - dbCandidates.length;

                // Take only what we need from CoinGecko (already sorted alphabetically)
                const coinGeckoFiltered = uniqueCoinGeckoResults.slice(0, remainingSlots);

                // Transform to ERC-20 format (add chainId to results)
                coinGeckoToAdd = coinGeckoFiltered.map((result) => ({
                    coingeckoId: result.coingeckoId,
                    symbol: result.symbol,
                    name: result.name,
                    address: result.address,
                    chainId, // Add chainId from input
                }));

                this.logger.info(
                    {
                        chainId,
                        platformId,
                        coinGeckoTotal: coinGeckoResults.length,
                        coinGeckoUnique: uniqueCoinGeckoResults.length,
                        coinGeckoAdded: coinGeckoToAdd.length,
                    },
                    "CoinGecko search completed"
                );
            } else if (isLocal) {
                this.logger.debug(
                    { chainId, dbCount: dbCandidates.length },
                    "Skipping CoinGecko search (local chain - no platform mapping)"
                );
            } else {
                this.logger.debug(
                    { dbCount: dbCandidates.length },
                    "Skipping CoinGecko search (DB has 10+ results)"
                );
            }

            // 3. Combine results: DB first (ordered by mcap), then CoinGecko (alphabetically)
            const candidates: Erc20TokenSearchCandidate[] = [
                ...dbCandidates,
                ...coinGeckoToAdd,
            ];

            // 4. Auto-discover fallback for LOCAL CHAINS only
            // If user searched by specific address on a local chain and we found nothing,
            // try on-chain discovery (CoinGecko doesn't index local chains)
            if (candidates.length === 0 && normalizedAddress && isLocal) {
                this.logger.debug(
                    { chainId, address: normalizedAddress },
                    "No search results on local chain, attempting on-chain discovery"
                );

                try {
                    // Attempt to discover token directly from contract
                    const discovered = await this.discover({
                        address: normalizedAddress,
                        chainId,
                    });

                    // Convert discovered token to search candidate format
                    const config = discovered.config as { address: string; chainId: number };
                    candidates.push({
                        coingeckoId: discovered.coingeckoId || "",
                        symbol: discovered.symbol,
                        name: discovered.name,
                        address: config.address,
                        chainId: config.chainId,
                        logoUrl: discovered.logoUrl || undefined,
                        marketCap: discovered.marketCap || undefined,
                    });

                    this.logger.info(
                        { chainId, address: normalizedAddress, symbol: discovered.symbol },
                        "Token auto-discovered from contract on local chain"
                    );
                } catch (error) {
                    // Discovery failed - not a valid ERC-20 contract or RPC error
                    // Log and return empty results (expected behavior)
                    this.logger.debug(
                        { chainId, address: normalizedAddress, error: (error as Error).message },
                        "Auto-discovery failed - not a valid ERC-20 contract"
                    );
                }
            }

            this.logger.info(
                {
                    chainId,
                    symbol,
                    name,
                    address: normalizedAddress,
                    dbCount: dbCandidates.length,
                    coinGeckoCount: coinGeckoToAdd.length,
                    totalCount: candidates.length,
                },
                "Token search completed (DB + CoinGecko)"
            );

            log.methodExit(this.logger, "searchTokens", {
                count: candidates.length,
            });

            return candidates;
        } catch (error) {
            // Only log if not already logged
            if (
                !(
                    error instanceof Error &&
                    (error.message.includes("At least one search parameter") ||
                        error.message.includes("not configured") ||
                        error.message.includes("No CoinGecko platform mapping") ||
                        error.message.includes("Invalid Ethereum address"))
                )
            ) {
                log.methodError(this.logger, "searchTokens", error as Error, {
                    chainId,
                    symbol,
                    name,
                    address,
                });
            }
            throw error;
        }
    }

    /**
     * Get CoinGecko platform ID for an EVM chain ID
     *
     * @param chainId - EVM chain ID
     * @returns CoinGecko platform ID or null if not supported
     */
    private getPlatformId(chainId: number): string | null {
        const mapping: Record<number, string> = {
            1: "ethereum", // Ethereum
            42161: "arbitrum-one", // Arbitrum One
            8453: "base", // Base
            56: "binance-smart-chain", // BNB Smart Chain
            137: "polygon-pos", // Polygon
            10: "optimistic-ethereum", // Optimism
        };
        return mapping[chainId] || null;
    }

    // ============================================================================
    // LOCAL CHAIN ENRICHMENT
    // ============================================================================

    /**
     * Get enrichment data for tokens on local chain (mainnet fork).
     *
     * Strategy:
     * 1. Try CoinGecko with chainId=1 (mainnet) - works for forked tokens like WETH
     * 2. If not found, use symbol-based fallback mapping
     *
     * @param address - Token contract address
     * @param symbol - Token symbol from on-chain metadata
     * @returns Enrichment data (coingeckoId, logoUrl, marketCap)
     */
    private async getLocalChainEnrichment(
        address: string,
        symbol: string
    ): Promise<{
        coingeckoId: string | null;
        logoUrl: string | null | undefined;
        marketCap: number | null | undefined;
    }> {
        // Step 1: Try CoinGecko with mainnet chainId
        // Local chain is a mainnet fork, so forked tokens have identical addresses
        try {
            const mainnetEnrichment =
                await this.coinGeckoClient.getErc20EnrichmentData(
                    1, // Ethereum mainnet
                    address
                );

            if (mainnetEnrichment.coingeckoId) {
                this.logger.info(
                    {
                        address,
                        symbol,
                        coingeckoId: mainnetEnrichment.coingeckoId,
                    },
                    "Local chain token found on CoinGecko via mainnet lookup"
                );
                return mainnetEnrichment;
            }
        } catch (error) {
            this.logger.debug(
                { address, symbol, error: (error as Error).message },
                "CoinGecko mainnet lookup failed, trying symbol fallback"
            );
        }

        // Step 2: Symbol-based fallback for local-only tokens
        return this.getSymbolBasedFallback(symbol);
    }

    /**
     * Fallback enrichment based on token symbol patterns.
     * Uses well-known tokens as proxies for similar local tokens.
     *
     * @param symbol - Token symbol to match against patterns
     * @returns Enrichment data from proxy token, or empty if no match
     */
    private async getSymbolBasedFallback(symbol: string): Promise<{
        coingeckoId: string | null;
        logoUrl: string | null | undefined;
        marketCap: number | null | undefined;
    }> {
        const upperSymbol = symbol.toUpperCase();

        // USD-like tokens → use USDC data
        if (upperSymbol.includes("USD")) {
            try {
                const usdcData =
                    await this.coinGeckoClient.getErc20EnrichmentData(
                        1, // mainnet
                        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" // USDC mainnet address
                    );
                this.logger.info(
                    { symbol },
                    "Using USDC fallback enrichment for USD-like token"
                );
                return usdcData;
            } catch (error) {
                this.logger.debug(
                    { symbol, error: (error as Error).message },
                    "USDC fallback lookup failed"
                );
            }
        }

        // ETH-like tokens → use cbETH data
        if (upperSymbol.includes("ETH")) {
            try {
                const cbethData =
                    await this.coinGeckoClient.getErc20EnrichmentData(
                        1, // mainnet
                        "0xBe9895146f7AF43049ca1c1AE358B0541Ea49704" // cbETH mainnet address
                    );
                this.logger.info(
                    { symbol },
                    "Using cbETH fallback enrichment for ETH-like token"
                );
                return cbethData;
            } catch (error) {
                this.logger.debug(
                    { symbol, error: (error as Error).message },
                    "cbETH fallback lookup failed"
                );
            }
        }

        // No fallback available
        this.logger.debug(
            { symbol },
            "No symbol fallback available for local chain token"
        );
        return { coingeckoId: null, logoUrl: undefined, marketCap: undefined };
    }

    // ============================================================================
    // BASIC CURRENCY MANAGEMENT
    // ============================================================================

    /**
     * Ensure a basic currency exists, creating it if necessary.
     *
     * This is used during auto-linking to lazily create basic currencies
     * when tokens are discovered.
     *
     * @param currencyCode - Currency code ('USD', 'ETH', or 'BTC')
     * @returns The basic currency token record
     */
    private async ensureBasicCurrency(
        currencyCode: "USD" | "ETH" | "BTC"
    ): Promise<{ id: string }> {
        // Check if already exists
        const existing = await this.prisma.token.findFirst({
            where: {
                tokenType: "basic-currency",
                config: {
                    path: ["currencyCode"],
                    equals: currencyCode,
                },
            },
        });

        if (existing) {
            return { id: existing.id };
        }

        // Create new basic currency
        const currencyDefs: Record<"USD" | "ETH" | "BTC", { name: string; symbol: string }> = {
            USD: { name: "US Dollar", symbol: "USD" },
            ETH: { name: "Ethereum", symbol: "ETH" },
            BTC: { name: "Bitcoin", symbol: "BTC" },
        };

        const currencyDef = currencyDefs[currencyCode];

        this.logger.info(
            { currencyCode },
            "Auto-creating basic currency"
        );

        const created = await this.prisma.token.create({
            data: {
                tokenType: "basic-currency",
                name: currencyDef.name,
                symbol: currencyDef.symbol,
                decimals: 18, // All basic currencies use 18 decimals
                config: {
                    currencyCode,
                },
            },
        });

        return { id: created.id };
    }

    // ============================================================================
    // BASIC CURRENCY LINKING
    // ============================================================================

    /**
     * Link an ERC-20 token to a basic currency.
     *
     * This enables the token to be used in cross-platform aggregations.
     * The link represents a 1:1 value relationship (e.g., 1 USDC = 1 USD).
     *
     * Common mappings:
     * - USDC, USDT, DAI → USD
     * - WETH → ETH
     * - WBTC, cbBTC → BTC
     *
     * Note: Value-accruing tokens (stETH, rETH, wstETH) should NOT be linked
     * since they don't have a 1:1 relationship with their underlying asset.
     *
     * @param tokenId - ERC-20 token database ID
     * @param basicCurrencyId - Basic currency token ID to link to
     * @returns The updated token with basicCurrencyId in config
     * @throws Error if token not found or not ERC-20
     * @throws Error if basicCurrencyId doesn't reference a basic currency token
     */
    async linkToBasicCurrency(
        tokenId: string,
        basicCurrencyId: string
    ): Promise<Token<"erc20">> {
        log.methodEntry(this.logger, "linkToBasicCurrency", {
            tokenId,
            basicCurrencyId,
        });

        try {
            // Verify token exists and is ERC-20
            const existing = await this.findById(tokenId);
            if (!existing) {
                const error = new Error(`Token with id ${tokenId} not found`);
                log.methodError(this.logger, "linkToBasicCurrency", error, { tokenId });
                throw error;
            }

            // Verify basic currency exists and is correct type
            log.dbOperation(this.logger, "findUnique", "Token", { id: basicCurrencyId });

            const basicCurrency = await this.prisma.token.findUnique({
                where: { id: basicCurrencyId },
            });

            if (!basicCurrency) {
                const error = new Error(
                    `Basic currency with id ${basicCurrencyId} not found`
                );
                log.methodError(this.logger, "linkToBasicCurrency", error, {
                    tokenId,
                    basicCurrencyId,
                });
                throw error;
            }

            if (basicCurrency.tokenType !== "basic-currency") {
                const error = new Error(
                    `Token ${basicCurrencyId} is not a basic currency (type: ${basicCurrency.tokenType})`
                );
                log.methodError(this.logger, "linkToBasicCurrency", error, {
                    tokenId,
                    basicCurrencyId,
                    actualType: basicCurrency.tokenType,
                });
                throw error;
            }

            // Update config with basicCurrencyId
            const updatedConfig: Erc20TokenConfig = {
                ...existing.config,
                basicCurrencyId,
            };

            const updated = await this.update(tokenId, {
                config: updatedConfig,
            });

            this.logger.info(
                {
                    tokenId,
                    symbol: updated.symbol,
                    basicCurrencyId,
                    basicCurrencySymbol: basicCurrency.symbol,
                },
                "ERC-20 token linked to basic currency"
            );
            log.methodExit(this.logger, "linkToBasicCurrency", { tokenId });
            return updated;
        } catch (error) {
            // Only log if not already logged
            if (
                !(
                    error instanceof Error &&
                    (error.message.includes("not found") ||
                        error.message.includes("not a basic currency"))
                )
            ) {
                log.methodError(this.logger, "linkToBasicCurrency", error as Error, {
                    tokenId,
                    basicCurrencyId,
                });
            }
            throw error;
        }
    }

    /**
     * Unlink an ERC-20 token from its basic currency.
     *
     * @param tokenId - ERC-20 token database ID
     * @returns The updated token without basicCurrencyId
     * @throws Error if token not found or not ERC-20
     */
    async unlinkFromBasicCurrency(tokenId: string): Promise<Token<"erc20">> {
        log.methodEntry(this.logger, "unlinkFromBasicCurrency", { tokenId });

        try {
            const existing = await this.findById(tokenId);
            if (!existing) {
                const error = new Error(`Token with id ${tokenId} not found`);
                log.methodError(this.logger, "unlinkFromBasicCurrency", error, { tokenId });
                throw error;
            }

            // Remove basicCurrencyId from config
            const { basicCurrencyId: _, ...restConfig } = existing.config;

            const updated = await this.update(tokenId, {
                config: restConfig as Erc20TokenConfig,
            });

            this.logger.info(
                { tokenId, symbol: updated.symbol },
                "ERC-20 token unlinked from basic currency"
            );
            log.methodExit(this.logger, "unlinkFromBasicCurrency", { tokenId });
            return updated;
        } catch (error) {
            if (!(error instanceof Error && error.message.includes("not found"))) {
                log.methodError(this.logger, "unlinkFromBasicCurrency", error as Error, {
                    tokenId,
                });
            }
            throw error;
        }
    }

    /**
     * Check if a token symbol should be auto-linked to a basic currency.
     *
     * Only 1:1 wrapped tokens are auto-linked. Value-accruing tokens
     * (stETH, rETH, wstETH, cbETH) are excluded.
     *
     * @param symbol - Token symbol (case-insensitive)
     * @returns Basic currency code ('USD' | 'ETH' | 'BTC') or null if not auto-linkable
     */
    static getAutoLinkBasicCurrency(symbol: string): "USD" | "ETH" | "BTC" | null {
        const normalizedSymbol = symbol.toUpperCase();
        return SYMBOL_TO_BASIC_CURRENCY[normalizedSymbol] ?? null;
    }
}

// =============================================================================
// AUTO-LINK SYMBOL MAPPING
// =============================================================================

/**
 * Mapping of token symbols to basic currency codes.
 *
 * Only includes 1:1 wrapped/pegged tokens.
 * Value-accruing tokens (stETH, rETH, wstETH, cbETH) are explicitly excluded.
 */
const SYMBOL_TO_BASIC_CURRENCY: Record<string, "USD" | "ETH" | "BTC"> = {
    // USD stablecoins (1:1 pegged)
    USDC: "USD",
    USDT: "USD",
    DAI: "USD",
    BUSD: "USD",
    FRAX: "USD",
    TUSD: "USD",
    USDP: "USD",
    LUSD: "USD",
    // ETH wrapped (1:1 only)
    WETH: "ETH",
    // BTC wrapped (1:1 only)
    WBTC: "BTC",
    CBBTC: "BTC",
    RENBTC: "BTC",
    TBTC: "BTC",
};
