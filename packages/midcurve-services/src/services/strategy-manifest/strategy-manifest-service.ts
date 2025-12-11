/**
 * Strategy Manifest Service
 *
 * Provides CRUD operations for the StrategyManifest model.
 * Manifests define deployable strategy contracts with ABI, bytecode,
 * and parameter schemas.
 */

import { PrismaClient, Prisma } from '@midcurve/database';
import type {
  StrategyManifest,
  StrategyCapabilities,
  ConstructorParam,
  UserParam,
  AnyToken,
} from '@midcurve/shared';

// =============================================================================
// SERVICE INPUT TYPES
// =============================================================================

/**
 * Options for finding manifests
 */
export interface FindManifestOptions {
  /**
   * Filter by active status
   */
  isActive?: boolean;

  /**
   * Filter by basic currency ID
   */
  basicCurrencyId?: string;

  /**
   * Filter by tags (OR logic - matches if any tag present)
   */
  tags?: string[];

  /**
   * Include basic currency token in response
   */
  includeBasicCurrency?: boolean;
}

/**
 * Input for creating a manifest
 */
export interface CreateManifestInput {
  slug: string;
  version: string;
  name: string;
  description: string;
  abi: unknown[];
  bytecode: string;
  constructorParams: ConstructorParam[];
  capabilities: StrategyCapabilities;
  basicCurrencyId: string;
  userParams: UserParam[];
  isActive?: boolean;
  isAudited?: boolean;
  author?: string;
  repository?: string;
  tags?: string[];
}

/**
 * Input for updating a manifest
 */
export interface UpdateManifestInput {
  version?: string;
  name?: string;
  description?: string;
  abi?: unknown[];
  bytecode?: string;
  constructorParams?: ConstructorParam[];
  capabilities?: StrategyCapabilities;
  basicCurrencyId?: string;
  userParams?: UserParam[];
  isActive?: boolean;
  isAudited?: boolean;
  author?: string;
  repository?: string;
  tags?: string[];
}

// =============================================================================
// SERVICE DEPENDENCIES
// =============================================================================

/**
 * Dependencies for StrategyManifestService
 */
export interface StrategyManifestServiceDependencies {
  prisma?: PrismaClient;
}

// =============================================================================
// SERVICE CLASS
// =============================================================================

/**
 * Strategy Manifest Service
 *
 * Handles all strategy manifest-related database operations.
 */
export class StrategyManifestService {
  private readonly prisma: PrismaClient;

  /**
   * Creates a new StrategyManifestService instance
   *
   * @param dependencies - Service dependencies
   * @param dependencies.prisma - Prisma client instance (optional)
   */
  constructor(dependencies: StrategyManifestServiceDependencies = {}) {
    this.prisma = dependencies.prisma ?? new PrismaClient();
  }

  // ===========================================================================
  // READ OPERATIONS
  // ===========================================================================

  /**
   * Finds all manifests matching the given criteria
   *
   * @param options - Filter and include options
   * @returns Array of manifests
   *
   * @example
   * ```typescript
   * const manifests = await manifestService.findAll({
   *   isActive: true,
   *   tags: ['funding', 'yield'],
   *   includeBasicCurrency: true,
   * });
   * ```
   */
  async findAll(options: FindManifestOptions = {}): Promise<StrategyManifest[]> {
    const {
      isActive,
      basicCurrencyId,
      tags,
      includeBasicCurrency = false,
    } = options;

    // Build where clause
    const where: Record<string, unknown> = {};

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (basicCurrencyId) {
      where.basicCurrencyId = basicCurrencyId;
    }

    if (tags && tags.length > 0) {
      // PostgreSQL array overlap - matches if any tag is present
      where.tags = { hasSome: tags };
    }

    const dbResults = await this.prisma.strategyManifest.findMany({
      where,
      include: {
        basicCurrency: includeBasicCurrency,
      },
      orderBy: { name: 'asc' },
    });

    return dbResults.map((r) => this.mapToManifest(r, includeBasicCurrency));
  }

  /**
   * Finds a manifest by its unique slug
   *
   * @param slug - Manifest slug
   * @param options - Include options
   * @returns The manifest if found, null otherwise
   *
   * @example
   * ```typescript
   * const manifest = await manifestService.findBySlug('funding-example-v1', {
   *   includeBasicCurrency: true,
   * });
   * ```
   */
  async findBySlug(
    slug: string,
    options: { includeBasicCurrency?: boolean } = {}
  ): Promise<StrategyManifest | null> {
    const { includeBasicCurrency = false } = options;

    const dbResult = await this.prisma.strategyManifest.findUnique({
      where: { slug },
      include: {
        basicCurrency: includeBasicCurrency,
      },
    });

    if (!dbResult) {
      return null;
    }

    return this.mapToManifest(dbResult, includeBasicCurrency);
  }

  /**
   * Finds a manifest by ID
   *
   * @param id - Manifest ID
   * @param options - Include options
   * @returns The manifest if found, null otherwise
   */
  async findById(
    id: string,
    options: { includeBasicCurrency?: boolean } = {}
  ): Promise<StrategyManifest | null> {
    const { includeBasicCurrency = false } = options;

    const dbResult = await this.prisma.strategyManifest.findUnique({
      where: { id },
      include: {
        basicCurrency: includeBasicCurrency,
      },
    });

    if (!dbResult) {
      return null;
    }

    return this.mapToManifest(dbResult, includeBasicCurrency);
  }

  // ===========================================================================
  // WRITE OPERATIONS
  // ===========================================================================

  /**
   * Creates a new manifest
   *
   * @param input - Manifest creation input
   * @returns The created manifest
   *
   * @example
   * ```typescript
   * const manifest = await manifestService.create({
   *   slug: 'funding-example-v1',
   *   version: '1.0.0',
   *   name: 'Funding Example Strategy',
   *   description: 'Basic strategy for deposits and withdrawals',
   *   abi: [...],
   *   bytecode: '0x...',
   *   constructorParams: [{ name: '_owner', type: 'address', source: 'user-wallet' }],
   *   capabilities: { funding: true, ohlcConsumer: false, ... },
   *   basicCurrencyId: 'usd-currency-id',
   *   userParams: [],
   * });
   * ```
   */
  async create(input: CreateManifestInput): Promise<StrategyManifest> {
    const dbResult = await this.prisma.strategyManifest.create({
      data: {
        slug: input.slug,
        version: input.version,
        name: input.name,
        description: input.description,
        abi: input.abi as Prisma.InputJsonValue,
        bytecode: input.bytecode,
        constructorParams: input.constructorParams as unknown as Prisma.InputJsonValue,
        capabilities: input.capabilities as unknown as Prisma.InputJsonValue,
        basicCurrencyId: input.basicCurrencyId,
        userParams: input.userParams as unknown as Prisma.InputJsonValue,
        isActive: input.isActive ?? true,
        isAudited: input.isAudited ?? false,
        author: input.author,
        repository: input.repository,
        tags: input.tags ?? [],
      },
      include: {
        basicCurrency: true,
      },
    });

    return this.mapToManifest(dbResult, true);
  }

  /**
   * Updates a manifest by slug
   *
   * @param slug - Manifest slug
   * @param input - Update input
   * @returns The updated manifest
   *
   * @example
   * ```typescript
   * const updated = await manifestService.update('funding-example-v1', {
   *   isActive: false,
   * });
   * ```
   */
  async update(slug: string, input: UpdateManifestInput): Promise<StrategyManifest> {
    const data: Prisma.StrategyManifestUpdateInput = {};

    if (input.version !== undefined) data.version = input.version;
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.abi !== undefined) data.abi = input.abi as Prisma.InputJsonValue;
    if (input.bytecode !== undefined) data.bytecode = input.bytecode;
    if (input.constructorParams !== undefined) {
      data.constructorParams = input.constructorParams as unknown as Prisma.InputJsonValue;
    }
    if (input.capabilities !== undefined) {
      data.capabilities = input.capabilities as unknown as Prisma.InputJsonValue;
    }
    if (input.basicCurrencyId !== undefined) {
      data.basicCurrency = { connect: { id: input.basicCurrencyId } };
    }
    if (input.userParams !== undefined) {
      data.userParams = input.userParams as unknown as Prisma.InputJsonValue;
    }
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.isAudited !== undefined) data.isAudited = input.isAudited;
    if (input.author !== undefined) data.author = input.author;
    if (input.repository !== undefined) data.repository = input.repository;
    if (input.tags !== undefined) data.tags = input.tags;

    const dbResult = await this.prisma.strategyManifest.update({
      where: { slug },
      data,
      include: {
        basicCurrency: true,
      },
    });

    return this.mapToManifest(dbResult, true);
  }

  /**
   * Deletes a manifest by slug
   *
   * @param slug - Manifest slug
   *
   * @example
   * ```typescript
   * await manifestService.delete('old-strategy-v1');
   * ```
   */
  async delete(slug: string): Promise<void> {
    await this.prisma.strategyManifest.delete({
      where: { slug },
    });
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Maps a database result to a StrategyManifest type
   */
  private mapToManifest(
    dbResult: Record<string, unknown>,
    includeBasicCurrency: boolean
  ): StrategyManifest {
    const manifest: StrategyManifest = {
      id: dbResult.id as string,
      createdAt: dbResult.createdAt as Date,
      updatedAt: dbResult.updatedAt as Date,
      slug: dbResult.slug as string,
      version: dbResult.version as string,
      name: dbResult.name as string,
      description: dbResult.description as string,
      abi: dbResult.abi as unknown[],
      bytecode: dbResult.bytecode as string,
      constructorParams: dbResult.constructorParams as ConstructorParam[],
      capabilities: dbResult.capabilities as StrategyCapabilities,
      basicCurrencyId: dbResult.basicCurrencyId as string,
      userParams: dbResult.userParams as UserParam[],
      isActive: dbResult.isActive as boolean,
      isAudited: dbResult.isAudited as boolean,
      author: dbResult.author as string | undefined,
      repository: dbResult.repository as string | undefined,
      tags: dbResult.tags as string[],
    };

    if (includeBasicCurrency && dbResult.basicCurrency) {
      manifest.basicCurrency = this.mapDbTokenToAnyToken(
        dbResult.basicCurrency as Record<string, unknown>
      );
    }

    return manifest;
  }

  /**
   * Maps a database token to AnyToken type
   */
  private mapDbTokenToAnyToken(dbToken: Record<string, unknown>): AnyToken {
    return {
      id: dbToken.id as string,
      createdAt: dbToken.createdAt as Date,
      updatedAt: dbToken.updatedAt as Date,
      tokenType: dbToken.tokenType as string,
      name: dbToken.name as string,
      symbol: dbToken.symbol as string,
      decimals: dbToken.decimals as number,
      logoUrl: dbToken.logoUrl as string | undefined,
      coingeckoId: dbToken.coingeckoId as string | undefined,
      marketCap: dbToken.marketCap as number | undefined,
      config: dbToken.config,
    } as AnyToken;
  }
}
