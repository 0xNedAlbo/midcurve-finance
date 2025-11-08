# Midcurve Services

> **Business logic layer for Midcurve Finance** - Core services, database operations, and on-chain data reading

## Quick Navigation

📚 **Architecture & Concepts:** [Monorepo CLAUDE.md](../CLAUDE.md)
- Ecosystem overview, package roles, core architecture principles, project philosophy

🌐 **API Layer:** [API CLAUDE.md](../midcurve-api/CLAUDE.md)
- REST endpoints, request validation, response formatting

📦 **Shared Types:** [Shared README.md](../midcurve-shared/README.md)
- Type definitions, utilities, math functions

---

## Project Overview

**Midcurve Services** is a shared TypeScript library that implements the core business logic for **Midcurve Finance**. This repository serves as the **single source of truth** for business logic, service layers, and database operations.

### Role in the Ecosystem

The Services layer provides:
- Business logic and CRUD operations (requires Prisma)
- Database schema definition (Prisma models)
- External API clients (CoinGecko, with distributed caching)
- Service-specific utilities (ERC-20 readers, APR calculations)
- Distributed caching (PostgreSQL-based)

**Consumed by:** API, Workers, Background processors

For complete ecosystem architecture and package responsibilities, see:
**[Package Roles & Responsibilities](../CLAUDE.md#package-roles--responsibilities)**

---

## Architecture Overview

For comprehensive architectural documentation, see the [monorepo CLAUDE.md](../CLAUDE.md):

- **[Monorepo Architecture](../CLAUDE.md#monorepo-architecture)** - Ecosystem diagram
- **[Type Hierarchy](../CLAUDE.md#1-type-hierarchy--separation-of-concerns)** - Why types come from @midcurve/shared
- **[Prisma Schema Management](../CLAUDE.md#2-prisma-schema-management--peer-dependencies)** - Peer dependency pattern
- **[Multi-Platform Abstraction](../CLAUDE.md#4-abstraction-strategy-for-multi-platform-support)** - Generic interfaces + platform configs
- **[PostgreSQL Caching Rationale](../CLAUDE.md#5-distributed-caching-with-postgresql)** - Why PostgreSQL not Redis
- **[Project Philosophy](../CLAUDE.md#project-philosophy--risk-management-approach)** - Quote/base tokens, risk definition
- **[Supported Platforms](../CLAUDE.md#supported-platforms)** - EVM chains, Solana (future)
- **[Code Style & Best Practices](../CLAUDE.md#code-style--best-practices)** - Monorepo-wide standards

### Services-Specific Architecture Notes

**Prisma Client as Peer Dependency:**
This package declares `@prisma/client` as a **peer dependency**. Consuming projects (API, workers) install Prisma directly, and services uses their instance. This ensures a single Prisma client across the application.

**Type Imports:**
Always import domain types from `@midcurve/shared`:

```typescript
// ✅ Correct
import type { Token, Erc20Token } from '@midcurve/shared';

// ❌ Wrong
import type { Token } from '@prisma/client';
```

**BigInt Handling:**
For values exceeding `Number.MAX_SAFE_INTEGER`:
- TypeScript: Use native `bigint`
- Database: Store as `string` in JSON fields
- Service layer handles conversion

```typescript
// TypeScript
interface UniswapV3PoolState {
  sqrtPriceX96: bigint;
  liquidity: bigint;
}

// Database
interface UniswapV3PoolStateDB {
  sqrtPriceX96: string;  // "1234567890123456789"
  liquidity: string;
}
```

---
## Project Structure

```
midcurve-services/
├── src/
│   ├── cache/                     # Distributed caching layer
│   │   ├── cache-service.ts       # PostgreSQL-based cache
│   │   ├── cache-service.test.ts  # Cache tests
│   │   └── index.ts               # Barrel exports
│   │
│   ├── config/                    # Configuration layer
│   │   ├── evm.ts                 # EVM chain configuration
│   │   ├── evm.test.ts            # Config tests
│   │   └── index.ts               # Barrel exports
│   │
│   ├── clients/                   # External API clients
│   │   └── coingecko/             # CoinGecko API client
│   │       ├── coingecko-client.ts                      # API client with distributed caching
│   │       ├── coingecko-client.integration.test.ts     # Integration tests
│   │       └── index.ts
│   │
│   ├── services/                  # Business logic layer
│   │   ├── token/                 # Token management
│   │   │   ├── token-service.ts              # Base CRUD service
│   │   │   ├── erc20-token-service.ts        # ERC-20 specialized service
│   │   │   ├── erc20-token-service.test.ts   # ERC-20 service tests
│   │   │   ├── test-fixtures.ts              # Test data
│   │   │   ├── token-service.test.ts         # Unit tests
│   │   │   └── index.ts
│   │   │
│   │   └── types/                 # Service-layer types (DB only)
│   │       ├── token/             # Token input types
│   │       │   ├── token-input.ts        # Create/Update inputs
│   │       │   └── index.ts
│   │       ├── pool/              # Pool input types
│   │       │   ├── pool-input.ts         # Create/Update inputs
│   │       │   └── index.ts
│   │       ├── uniswapv3/         # Protocol DB types
│   │       │   ├── pool-db.ts            # DB serialization
│   │       │   └── index.ts
│   │       └── index.ts
│   │
│   ├── utils/                     # Service-specific utilities
│   │   ├── evm/                   # EVM utilities (services-specific)
│   │   │   ├── erc20-abi.ts           # Minimal ERC-20 ABI
│   │   │   ├── erc20-reader.ts        # Contract metadata reader
│   │   │   ├── erc20-reader.test.ts   # Reader tests
│   │   │   └── index.ts
│   │   ├── apr/                   # APR calculation utilities
│   │   └── request-scheduler/     # Rate limiting utilities
│   │
│   └── index.ts                   # Main entry point
│
├── prisma/
│   └── schema.prisma              # Database schema (PostgreSQL)
│
├── .env.example                   # Environment variables template
├── vitest.config.ts               # Test configuration
├── package.json                   # ESM, Next.js/Vercel compatible
└── tsconfig.json                  # Strict TypeScript config
```

### Directory Organization

**Note:** Shared types and utilities are now in the `@midcurve/shared` package (separate repository).

**`src/cache/`** - Distributed caching layer
- PostgreSQL-based cache service
- Shared cache across all workers/processes/serverless functions
- TTL-based expiration, graceful error handling

**`src/config/`** - Configuration layer
- EVM chain configuration (RPC URLs, public clients)
- Centralized config management
- Environment-based setup

**`src/clients/`** - External API clients
- CoinGecko API client with distributed caching
- Future: Other external data sources

**`src/services/`** - Business logic and CRUD operations
- Token management (create, read, update, delete, discover)
- Future: Pool management, position tracking, risk calculations

**`src/services/types/`** - Service-layer specific types
- Database operation types (CreateInput, UpdateInput)
- NOT shared with UI/API (they don't have DB access)
- DB serialization types (e.g., bigint → string)

**`src/utils/`** - Service-specific utility functions
- ERC-20 contract readers (requires viem and RPC access)
- APR calculation utilities (requires position history data)
- Request scheduling and rate limiting (for external APIs)
- Note: Core utilities (address validation, math) are in `@midcurve/shared`

---

## Technology Stack (Services-Specific)

### Core
- **TypeScript 5.3+** - Strict mode, ESM modules
- **Node.js 18+** - Server-side runtime
- **Prisma 6.17.1** - ORM and schema management
- **PostgreSQL** - Primary database with JSON columns

### Services-Specific Libraries
- **viem 2.38+** - Ethereum utilities, EIP-55 checksumming, contract reading
- **vitest 3.2+** - Fast test framework with native ESM support
- **vitest-mock-extended 3.1+** - Type-safe Prisma mocking

For complete technology stack across all packages, see:
**[Technology Stack](../CLAUDE.md#technology-stack)**

---

## Service Layer Architecture

### TokenService (Base Service)

Generic token management service that handles any token type (ERC-20, Solana SPL, etc.).

**Key Features:**
- Generic `create()` method accepting `CreateAnyTokenInput`
- Returns `AnyToken` with full type information
- Dependency injection for testability
- Prisma client management

**Usage:**
```typescript
import { TokenService } from '@midcurve/services';

const service = new TokenService({ prisma });

const token = await service.create({
  tokenType: 'evm-erc20',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  config: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    chainId: 1
  }
});
```

### Erc20TokenService (Specialized Service)

ERC-20 specific service with address validation, normalization, and duplicate prevention.

**Key Features:**
- **Address Validation**: Validates format (0x + 40 hex characters)
- **Address Normalization**: Converts to EIP-55 checksum format
- **Duplicate Prevention**: Checks for existing token by address + chainId
- **Type Safeguards**: Ensures only ERC-20 tokens in all operations

**Full CRUD Operations:**

```typescript
import { Erc20TokenService } from '@midcurve/services';

const service = new Erc20TokenService({ prisma });

// CREATE - Returns existing if duplicate found
const usdc = await service.create({
  tokenType: 'evm-erc20',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  config: {
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // any case
    chainId: 1
  }
});
// Address automatically normalized to: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

// READ by address and chain
const token = await service.findByAddressAndChain(
  '0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', // any case works
  1
);

// READ by ID
const tokenById = await service.findById('token_123');

// UPDATE
const updated = await service.update('token_123', {
  logoUrl: 'https://example.com/usdc.png',
  marketCap: 28000000000
});

// DELETE
await service.delete('token_123');
```

**How Duplicate Prevention Works:**
```typescript
// First call creates the token
const token1 = await service.create({
  tokenType: 'evm-erc20',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  config: { address: '0xa0b8...', chainId: 1 }
});

// Second call with same address+chainId returns existing token
const token2 = await service.create({
  tokenType: 'evm-erc20',
  name: 'USD Coin (duplicate)', // Different name
  symbol: 'USDC',
  decimals: 6,
  config: { address: '0xA0B8...', chainId: 1 } // Same address (any case)
});

// token1.id === token2.id (same token returned)
```

### Service Type Separation

**Why separate service types from shared types?**

Service layer types (`CreateTokenInput`, `UpdateTokenInput`) are **not shared** with UI/API because:
1. UI/API don't have direct database access
2. They receive fully populated objects (with id, timestamps)
3. Clear architectural boundaries

**Service Types:**
```typescript
// src/services/types/token/token-input.ts

// For creating tokens (omits DB-generated fields)
type CreateTokenInput<TConfig> = Omit<
  Token<TConfig>,
  'id' | 'createdAt' | 'updatedAt'
>;

// For updating tokens (partial, omits immutable fields)
type UpdateTokenInput<TConfig> = Partial<
  Omit<Token<TConfig>, 'id' | 'tokenType' | 'createdAt' | 'updatedAt'>
>;

// Platform-specific aliases
type CreateErc20TokenInput = CreateTokenInput<Erc20TokenConfig>;
type UpdateErc20TokenInput = UpdateTokenInput<Erc20TokenConfig>;
```

**Shared Types:**
```typescript
// src/shared/types/token.ts

// Full token interface (consumed by UI/API/Workers)
interface Token<TConfig> {
  id: string;              // Present in shared types
  createdAt: Date;         // Present in shared types
  updatedAt: Date;         // Present in shared types
  tokenType: TokenType;
  name: string;
  symbol: string;
  // ... other fields
}
```
## EVM Utilities

### Address Operations (`src/utils/evm.ts`)

Essential utilities for working with Ethereum addresses.

#### `isValidAddress(address: string): boolean`

Validates Ethereum address format using regex.

```typescript
import { isValidAddress } from '@midcurve/services';

isValidAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'); // true
isValidAddress('0x123'); // false (too short)
isValidAddress('invalid'); // false (no 0x prefix)
```

**Validation Rules:**
- Must start with `0x`
- Exactly 40 hexadecimal characters after `0x`
- Case-insensitive check

#### `normalizeAddress(address: string): string`

Converts address to EIP-55 checksum format using viem's `getAddress()`.

```typescript
import { normalizeAddress } from '@midcurve/services';

const normalized = normalizeAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
// Returns: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

// Throws error for invalid addresses
normalizeAddress('invalid'); // Error: Invalid Ethereum address
```

**Why Normalization Matters:**
- Prevents duplicate database entries (lowercase vs mixed case)
- Ensures consistent address format
- EIP-55 checksumming detects typos
- Required for efficient database queries

#### `compareAddresses(addressA: string, addressB: string): number`

Deterministic ordering of addresses using BigInt comparison.

```typescript
import { compareAddresses } from '@midcurve/services';

const addr1 = '0x0000000000000000000000000000000000000001';
const addr2 = '0x0000000000000000000000000000000000000002';

compareAddresses(addr1, addr2); // -1 (addr1 < addr2)
compareAddresses(addr2, addr1); // 1 (addr2 > addr1)
compareAddresses(addr1, addr1); // 0 (equal)

// Case-insensitive (normalizes before comparing)
const lower = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const upper = '0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48';
compareAddresses(lower, upper); // 0 (same address)
```

**Use Cases:**
- Sorting token lists
- Ensuring canonical token ordering (token0 < token1)
- Binary search algorithms

### Why viem?

We use `viem` for EIP-55 checksumming instead of web3.js or ethers.js because:
- ✅ **Lightweight**: Only imports what you need (tree-shakeable)
- ✅ **Modern**: Native TypeScript, ESM-first
- ✅ **Fast**: Optimized for performance
- ✅ **Type-safe**: Excellent TypeScript support
- ✅ **Maintained**: Active development and community

## Testing Infrastructure

### Testing Strategy

**Philosophy:**
- **Unit tests** for business logic
- **Mock external dependencies** (Prisma, network calls)
- **Fast feedback loop** (no database required)
- **Type-safe mocks** using vitest-mock-extended

**Tools:**
- **Vitest** - Fast, modern test framework with native ESM support
- **vitest-mock-extended** - Type-safe mocking for Prisma and other dependencies
- **Node environment** - No jsdom/browser emulation needed

### Test Coverage

**Current Status:**
- ✅ **121 tests passing**
- ✅ **Execution time**: ~350ms
- ✅ **Coverage**:
  - EVM utilities: 25 tests (100% coverage)
  - EVM configuration: 23 tests (100% coverage)
  - ERC-20 reader: 22 tests (100% coverage)
  - TokenService: 36 tests (100% coverage of create method)
  - Erc20TokenService: 15 tests (100% coverage of discoverToken method)

**Test Distribution:**
```
src/utils/evm.test.ts                        25 tests    7ms
src/utils/erc20-reader.test.ts               22 tests    6ms
src/config/evm.test.ts                       23 tests    7ms
src/services/token/token-service.test.ts     36 tests   13ms
src/services/token/erc20-token-service.test.ts 15 tests   9ms
```

### Test Fixtures Pattern

Reusable test data library for consistent, realistic testing.

**Fixture Structure:**
```typescript
// src/services/token/test-fixtures.ts

interface TokenFixture {
  input: CreateAnyTokenInput;   // For service.create()
  dbResult: {                   // For mock return value
    id: string;
    createdAt: Date;
    updatedAt: Date;
    // ... all token fields
  };
}

export const USDC_ETHEREUM: TokenFixture = {
  input: {
    tokenType: 'evm-erc20',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    config: {
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      chainId: 1
    }
  },
  dbResult: {
    id: 'token_usdc_eth_001',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    // ... matches input with DB fields
  }
};
```

**Available Fixtures:**
- **ERC-20**: USDC (Ethereum, Arbitrum, Base), WETH, DAI
- **Solana**: Wrapped SOL, USDC (with programId)
- **Edge Cases**: Minimal token, special characters, zero/high decimals, zero marketCap

**Usage in Tests:**
```typescript
import { USDC_ETHEREUM } from './test-fixtures';

it('should create USDC on Ethereum', async () => {
  prismaMock.token.create.mockResolvedValue(USDC_ETHEREUM.dbResult);

  const result = await tokenService.create(USDC_ETHEREUM.input);

  expect(result.symbol).toBe('USDC');
});
```

**Helper for Custom Fixtures:**
```typescript
import { createTokenFixture } from './test-fixtures';

const customToken = createTokenFixture({
  symbol: 'CUSTOM',
  config: { address: '0x...', chainId: 999 }
});
```

### Running Tests

```bash
# Watch mode (interactive)
npm test

# Single run (CI/CD)
npm run test:run

# With coverage report
npm run test:coverage
```

### Writing Tests

**Test Structure (Arrange-Act-Assert):**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import { PrismaClient } from '@prisma/client';

describe('TokenService', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let tokenService: TokenService;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    tokenService = new TokenService({ prisma: prismaMock });
  });

  it('should create token successfully', async () => {
    // Arrange
    const input = { tokenType: 'evm-erc20', /* ... */ };
    prismaMock.token.create.mockResolvedValue(mockDbResult);

    // Act
    const result = await tokenService.create(input);

    // Assert
    expect(result.symbol).toBe('USDC');
    expect(prismaMock.token.create).toHaveBeenCalledTimes(1);
  });
});
```

**Benefits:**
- ✅ Fast execution (no database I/O)
- ✅ Isolated tests (no side effects)
- ✅ Deterministic results (mocked data)
- ✅ Type-safe mocks
- ✅ Clear test organization


## Architecture Decisions (Services-Specific)

For overall architectural decisions (PostgreSQL caching rationale, type hierarchy, etc.), see:
**[Architecture Principles](../CLAUDE.md#architecture-principles)**

### Services-Layer Specific Decisions

#### Why Dependency Injection?

**Pattern:**
```typescript
class Erc20TokenService {
  constructor(dependencies: { prisma?: PrismaClient } = {}) {
    this.prisma = dependencies.prisma ?? new PrismaClient();
  }
}
```

**Benefits:**
- ✅ **Testability**: Inject mock Prisma client in tests
- ✅ **Flexibility**: Use different Prisma instances (read replicas, etc.)
- ✅ **Control**: Explicit dependency management
- ✅ **Optional**: Defaults provided for convenience

#### Why Specialized Services?

Instead of one monolithic service, we have:
- **Base service** (`TokenService`) - Generic operations, all token types
- **Specialized services** (`Erc20TokenService`) - Platform-specific logic

**Benefits:**
- ✅ **Separation of concerns**: ERC-20 logic separate from Solana logic
- ✅ **Type safety**: Specialized services enforce correct types
- ✅ **DRY principle**: Base service provides common functionality
- ✅ **Extensibility**: Easy to add new platform services

#### Why Address Normalization?

Without normalization, these would be treated as different tokens:
```typescript
'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
'0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48'
```

With normalization (EIP-55):
```typescript
// All normalized to same format
normalizeAddress('0xa0b8...') // 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
normalizeAddress('0xA0B8...') // 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

// Database queries work regardless of case
service.findByAddressAndChain('0xA0B8...', 1); // ✅ Found
```

**Benefits:**
- ✅ Prevents duplicate entries
- ✅ Consistent storage format
- ✅ Efficient queries
- ✅ EIP-55 checksum validation

#### Why Separate Service Types?

**Architecture:**
```
UI/API (consumers)
    ↓
    Uses: Token<TConfig> (with id, timestamps)

Service Layer
    ↓
    Uses: CreateTokenInput (without id, timestamps)
    ↓
Database (Prisma)
```

**Rationale:**
- UI/API receive **complete objects** (with id, timestamps)
- Service layer creates **incomplete objects** (omits DB-generated fields)
- Clear boundary between layers
- Type safety at compile time

---

## Distributed Caching Architecture

### Overview

Midcurve Services implements a **PostgreSQL-based distributed cache** that enables cache sharing across:
- Multiple Vitest test workers (parallel test execution)
- Multiple API instances (horizontal scaling on Vercel)
- Multiple background workers (Node.js processes)
- Multiple serverless functions (Vercel Functions)
- Development and production environments

### Cache Service

The `CacheService` provides a generic, type-safe caching layer using PostgreSQL as the backend.

**Key Features:**
- TTL-based expiration (configurable per cache entry)
- Automatic expired entry cleanup
- Graceful error handling (cache failures don't break the application)
- Type-safe value storage and retrieval
- Pattern-based cache clearing
- Singleton pattern with dependency injection

**Database Schema:**
```prisma
model Cache {
  key       String   @id
  value     Json
  expiresAt DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([expiresAt])
}
```

**Cache Operations:**
```typescript
import { CacheService } from '@midcurve/services';

const cache = CacheService.getInstance();

// Set with TTL
await cache.set('my-key', { data: 'value' }, 3600); // 1 hour

// Get (returns null if not found or expired)
const data = await cache.get<MyType>('my-key');

// Delete
await cache.delete('my-key');

// Clear pattern (e.g., all CoinGecko cache)
await cache.clear('coingecko:');

// Cleanup expired entries (run periodically)
const deleted = await cache.cleanup();

// Get statistics
const stats = await cache.getStats();
// { totalEntries: 100, expiredEntries: 15, activeEntries: 85 }
```

### CoinGecko Client Caching

The `CoinGeckoClient` uses `CacheService` to dramatically reduce API calls and avoid rate limiting.

**Cache Keys:**
- `coingecko:tokens:all` - Full token list (1-hour TTL)
- `coingecko:coin:{coinId}` - Individual coin details (1-hour TTL)

**Benefits:**
- 80-90% reduction in CoinGecko API calls
- No rate limiting issues in production
- Faster response times (3ms cache vs 200-500ms API)
- Cache shared across all workers/processes
- Cache persists across deployments

**Usage:**
```typescript
import { CoinGeckoClient } from '@midcurve/services';

const client = CoinGeckoClient.getInstance();

// First call: Fetches from API, stores in PostgreSQL cache
const tokens1 = await client.getAllTokens(); // ~500ms

// Second call (from any worker/process): Returns from cache
const tokens2 = await client.getAllTokens(); // ~3ms

// Even after redeploying the app, cache persists
// No need to warm cache after deployments
```

### Integration Testing with Shared Cache

Integration tests demonstrate the cache working across multiple test files:

**Before (In-Memory Cache):**
```
Test File 1 (Worker 1)     Test File 2 (Worker 2)
     ↓                           ↓
CoinGeckoClient               CoinGeckoClient
Instance #1                   Instance #2
Memory Cache #1               Memory Cache #2
     ↓                           ↓
API Call #1                   API Call #2  ← Rate limit!
API Call #3                   API Call #4  ← Rate limit!
```

**After (PostgreSQL Cache):**
```
Test File 1 (Worker 1)     Test File 2 (Worker 2)
     ↓                           ↓
CoinGeckoClient               CoinGeckoClient
Instance #1                   Instance #2
     ↓                           ↓
     └─────────┬─────────────────┘
               ↓
        PostgreSQL Cache
               ↓
        API Call #1 only!
      (All others use cache)
```

**Test Results:**
- 29/29 tests pass
- Minimal rate limiting warnings
- Tests share cached data across workers
- Much faster test execution

### Cache Management in Production

**Automatic Expiration:**
- Expired entries automatically excluded from reads
- Lazy deletion on next access
- Optional periodic cleanup job

**Manual Cache Clearing:**
```typescript
// Clear all CoinGecko cache
await client.clearCache();

// Clear specific patterns via CacheService
const cache = CacheService.getInstance();
await cache.clear('coingecko:coin:'); // Clear only coin details
```

**Monitoring:**
```typescript
const cache = CacheService.getInstance();
const stats = await cache.getStats();

console.log(`
  Total cache entries: ${stats.totalEntries}
  Active entries: ${stats.activeEntries}
  Expired entries: ${stats.expiredEntries}
`);
```

**Periodic Cleanup (Optional):**
```typescript
// In a cron job or scheduled task
import { CacheService } from '@midcurve/services';

const cache = CacheService.getInstance();
const deleted = await cache.cleanup();
console.log(`Cleaned up ${deleted} expired cache entries`);
```

### Production Deployment Considerations

**Vercel Serverless:**
- Each serverless function connects to same PostgreSQL database
- Cache automatically shared across all function invocations
- No Redis infrastructure needed
- Cache persists between cold starts

**Traditional Node.js (PM2, Docker, etc.):**
- Multiple Node processes share cache via PostgreSQL
- Connection pooling handled by Prisma
- Horizontal scaling works out of the box

**Database Considerations:**
- Cache table grows over time (plan for cleanup or TTL cleanup job)
- PostgreSQL JSONB indexing makes queries fast
- Consider partitioning Cache table if it exceeds millions of entries

### Future Enhancements

**Cache Warming (Optional):**
```typescript
// Warm cache on application startup
import { CoinGeckoClient } from '@midcurve/services';

async function warmCache() {
  const client = CoinGeckoClient.getInstance();
  await client.getAllTokens(); // Warm token list cache
}
```

**Cache Statistics API (Optional):**
```typescript
// Expose cache statistics via API endpoint
app.get('/api/admin/cache/stats', async (req, res) => {
  const cache = CacheService.getInstance();
  const stats = await cache.getStats();
  res.json(stats);
});
```

**Cache Invalidation API (Optional):**
```typescript
// Manually invalidate cache via admin endpoint
app.post('/api/admin/cache/clear', async (req, res) => {
  const cache = CacheService.getInstance();
  const deleted = await cache.clear('coingecko:');
  res.json({ deleted });
});
```

## EVM Configuration

### Overview

Midcurve Services includes a centralized EVM configuration system (`EvmConfig`) that manages RPC endpoints, public clients, and chain metadata for all supported EVM chains.

This system enables:
- **Token Discovery**: Automatically read token metadata from contracts
- **On-Chain Queries**: Fetch pool state, position data, and more
- **Multi-Chain Support**: Seamlessly work with Ethereum, Arbitrum, Base, BSC, Polygon, and Optimism
- **Environment-Based Config**: Configure RPC endpoints via environment variables

### Environment Configuration

**IMPORTANT:** RPC URL environment variables are **REQUIRED**. The application will throw an error at runtime if you attempt to use a chain without its RPC URL configured.

Create a `.env` file in your project root (use `.env.example` as a template):

```bash
# Ethereum Mainnet (Chain ID: 1) - REQUIRED
RPC_URL_ETHEREUM=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Arbitrum One (Chain ID: 42161) - REQUIRED
RPC_URL_ARBITRUM=https://arb-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Base (Chain ID: 8453) - REQUIRED
RPC_URL_BASE=https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# BNB Smart Chain (Chain ID: 56) - REQUIRED
RPC_URL_BSC=https://bsc-dataseed1.binance.org

# Polygon (Chain ID: 137) - REQUIRED
RPC_URL_POLYGON=https://polygon-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Optimism (Chain ID: 10) - REQUIRED
RPC_URL_OPTIMISM=https://opt-mainnet.g.alchemy.com/v2/YOUR_API_KEY
```

**Note:** You only need to configure RPC URLs for chains you plan to use. If you attempt to access an unconfigured chain, you'll receive a comprehensive error message with setup instructions.

### Supported Chains

| Chain | Chain ID | Environment Variable |
|-------|----------|---------------------|
| Ethereum | 1 | `RPC_URL_ETHEREUM` |
| Arbitrum One | 42161 | `RPC_URL_ARBITRUM` |
| Base | 8453 | `RPC_URL_BASE` |
| BNB Smart Chain | 56 | `RPC_URL_BSC` |
| Polygon | 137 | `RPC_URL_POLYGON` |
| Optimism | 10 | `RPC_URL_OPTIMISM` |

### Usage

#### Basic Configuration Access

```typescript
import { EvmConfig, SupportedChainId } from '@midcurve/services';

// Get singleton instance
const config = EvmConfig.getInstance();

// Check if chain is supported
if (config.isChainSupported(SupportedChainId.ETHEREUM)) {
  console.log('Ethereum is supported!');
}

// Get chain configuration
const ethConfig = config.getChainConfig(SupportedChainId.ETHEREUM);
console.log(ethConfig);
// {
//   chainId: 1,
//   name: 'Ethereum',
//   rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/...',
//   blockExplorer: 'https://etherscan.io',
//   viemChain: {...}
// }

// Get all supported chain IDs
const chains = config.getSupportedChainIds();
// [1, 42161, 8453, 56, 137, 10]
```

#### Using Public Clients

```typescript
import { EvmConfig } from '@midcurve/services';

const config = EvmConfig.getInstance();

// Get viem PublicClient for Ethereum
const client = config.getPublicClient(1);

// Use client for on-chain queries
const blockNumber = await client.getBlockNumber();
console.log(`Latest block: ${blockNumber}`);

// Read from a contract
const balance = await client.readContract({
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: ['0x...'],
});
```

**Note:** Public clients are **cached per chain** for performance. Subsequent calls to `getPublicClient(chainId)` return the same instance.

### Token Discovery

The `Erc20TokenService.discoverToken()` method uses `EvmConfig` to automatically discover and save tokens from on-chain contract data.

#### How It Works

1. **Check Database**: First checks if token already exists (avoids RPC call)
2. **Validate Chain**: Ensures the chain ID is supported
3. **Read Contract**: Uses multicall to efficiently read `name()`, `symbol()`, `decimals()`
4. **Save to Database**: Creates token entry with discovered metadata
5. **Return Token**: Returns the fully populated `Erc20Token`

#### Example Usage

```typescript
import { Erc20TokenService } from '@midcurve/services';

const service = new Erc20TokenService();

// Discover USDC on Ethereum
const usdc = await service.discoverToken(
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  1
);

console.log(usdc);
// {
//   id: 'token_...',
//   tokenType: 'evm-erc20',
//   name: 'USD Coin',
//   symbol: 'USDC',
//   decimals: 6,
//   config: {
//     address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
//     chainId: 1
//   },
//   createdAt: Date,
//   updatedAt: Date
// }

// Discover token on Arbitrum
const arbUsdc = await service.discoverToken(
  '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  42161
);
```

#### Idempotent Discovery

`discoverToken()` is **idempotent** - calling it multiple times with the same address/chain returns the existing token without making RPC calls:

```typescript
// First call: Reads from contract, saves to DB
const token1 = await service.discoverToken('0xA0b8...', 1);

// Second call: Returns existing token from DB (no RPC call)
const token2 = await service.discoverToken('0xA0b8...', 1);

// Same token
assert(token1.id === token2.id);
```

#### Error Handling

```typescript
try {
  await service.discoverToken('0x...', 1);
} catch (error) {
  if (error instanceof TokenMetadataError) {
    // Contract doesn't implement ERC-20 metadata
    console.error('Not a valid ERC-20 token');
  } else if (error.message.includes('Chain')) {
    // Unsupported chain
    console.error('Chain not configured');
  } else {
    // Other errors (network, etc.)
    console.error('Discovery failed:', error);
  }
}
```

### Dependency Injection

For testing, you can inject a custom `EvmConfig` instance:

```typescript
import { Erc20TokenService, EvmConfig } from '@midcurve/services';

// Custom config (e.g., for testing)
const customConfig = new EvmConfig();

const service = new Erc20TokenService({
  evmConfig: customConfig,
});
```

### Architecture Benefits

1. **Single Source of Truth**: All RPC configuration in one place
2. **Environment-Based**: Different RPC endpoints per environment (dev/staging/prod)
3. **Efficient Caching**: Public clients reused across the application
4. **Type-Safe**: Leverages viem's typed clients and ABIs
5. **Testable**: Easy to mock in unit tests
6. **Extensible**: Add new chains without breaking existing code

---

## Development Setup

### Prerequisites
1. **Node.js 18+** installed
2. **PostgreSQL** database running
3. **@midcurve/shared** package built (`cd ../midcurve-shared && npm run build`)

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with DATABASE_URL and RPC URLs

# Generate Prisma client
npm run prisma:generate

# Build the project
npm run build
```

For complete development setup across the monorepo, see:
**[Development Setup](../CLAUDE.md#development-setup)**

### Development Commands

```bash
# Development
npm run dev          # Watch mode with auto-rebuild

# Type checking
npm run type-check   # Check types without build

# Building
npm run build        # Production build

# Testing
npm test             # Watch mode (121+ tests)
npm run test:run     # Single run
npm run test:coverage # With coverage

# Prisma
npm run prisma:generate  # Generate Prisma client
npm run prisma:studio    # Open Prisma Studio

# Yalc (for API/workers consumption)
npm run yalc:publish  # Build + publish to yalc store
npm run yalc:push     # Build + push to all consumers
```

---

## Environment Variables (Services-Specific)

### Required

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/midcurve"
NODE_ENV="development"
```

### Optional (EVM Configuration)

```bash
# Configure only chains you plan to use
RPC_URL_ETHEREUM="https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
RPC_URL_ARBITRUM="https://arb-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
RPC_URL_BASE="https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
RPC_URL_BSC="https://bsc-dataseed1.binance.org"
RPC_URL_POLYGON="https://polygon-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
RPC_URL_OPTIMISM="https://opt-mainnet.g.alchemy.com/v2/YOUR_API_KEY"

# Token enrichment
COINGECKO_API_KEY="your-coingecko-key"
```

For complete environment setup, see:
**[Development Setup](../CLAUDE.md#development-setup)**

---

## Integration Example

### In API/UI/Workers Projects (Using @midcurve/shared)

```typescript
// Import shared types and utilities from @midcurve/shared
import {
  Token,
  Erc20Token,
  AnyToken,
  Erc20TokenConfig,
  normalizeAddress,
  sqrtPriceX96ToPrice,
} from '@midcurve/shared';

// Use the shared types
function processToken(token: AnyToken) {
  console.log(`Processing ${token.symbol}`);

  // Type narrowing with discriminated unions
  if (token.tokenType === 'evm-erc20') {
    console.log(`ERC-20 on chain ${token.config.chainId}`);
  } else {
    console.log(`SPL token: ${token.config.mint}`);
  }
}

// Type-safe platform-specific handling
function getExplorerUrl(token: Erc20Token): string {
  const baseUrls: Record<number, string> = {
    1: 'https://etherscan.io',
    42161: 'https://arbiscan.io',
    8453: 'https://basescan.org',
  };

  const baseUrl = baseUrls[token.config.chainId];
  return `${baseUrl}/token/${token.config.address}`;
}
```

### In Service Layer (Server-Side Only - Using @midcurve/services)

```typescript
// Import shared types and utilities from @midcurve/shared
import {
  Token,
  Erc20Token,
  normalizeAddress,
  isValidAddress,
} from '@midcurve/shared';

// Import services from @midcurve/services
import {
  TokenService,
  Erc20TokenService,
  type CreateErc20TokenInput,
} from '@midcurve/services';

// Use services
const erc20Service = new Erc20TokenService({ prisma });

const usdc = await erc20Service.create({
  tokenType: 'evm-erc20',
  name: 'USD Coin',
  symbol: 'USDC',
  decimals: 6,
  config: {
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    chainId: 1,
  },
});

// Use utilities
if (isValidAddress(userInputAddress)) {
  const normalized = normalizeAddress(userInputAddress);
  // Store normalized address in database
}
```

---

**Midcurve Finance** - Professional risk management for concentrated liquidity providers

---

## UniswapV3 Position Ledger Architecture

### Incremental Event Syncing

The UniswapV3 Position Ledger Service implements an **incremental event syncing strategy** with finalized block boundaries to efficiently track position events while avoiding blockchain reorganization issues.

#### Key Design Principles

1. **Finalized Blocks Only** - Never sync beyond the last finalized block to avoid reorg issues
2. **Incremental Updates** - Only fetch new events since the last sync (not full history every time)
3. **Delete and Re-Fetch** - When syncing from a block, delete events >= that block first (ensures clean state)
4. **State Reconstruction** - Each event builds upon the previous event's financial state
5. **Stateless Helpers** - All calculation logic extracted to independently testable helper functions

#### How `syncLedgerEvents()` Works

The `syncLedgerEvents()` function is the main orchestrator for event discovery and processing:

**Step 1: Get Finalized Block**
```typescript
const finalizedBlock = await evmBlockService.getLastFinalizedBlockNumber(chainId);
```
- Queries the chain for the last finalized block number
- Finalized blocks are confirmed and won't be reorganized
- Ethereum: ~15 minutes behind head (~64 blocks)
- Arbitrum/Optimism: ~5-10 minutes

**Step 2: Determine `fromBlock`**

For **incremental sync** (`forceFullResync: false`):
```typescript
const lastEvent = await getLastLedgerEvent(positionId);
const lastEventBlock = lastEvent?.config.blockNumber ?? null;
const nfpmBlock = getNfpmDeploymentBlock(chainId);

// MIN(lastEventBlock || nfpmBlock, finalizedBlock)
const startBlock = lastEventBlock !== null ? lastEventBlock : nfpmBlock;
fromBlock = startBlock < finalizedBlock ? startBlock : finalizedBlock;
```

Logic:
- If position has events: Start from last event's block number
- If position has no events: Start from NFPM deployment block
- Never go beyond finalized block (avoid reorg issues)

For **full resync** (`forceFullResync: true`):
```typescript
fromBlock = getNfpmDeploymentBlock(chainId);
```

Logic:
- Always start from NFPM deployment block
- Used for `discover()` (new positions) and `reset()` (rebuild from scratch)

**Step 3: Delete Events >= `fromBlock`**
```typescript
await deleteEventsFromBlock(positionId, fromBlock, prisma, logger);
```

Why delete and re-fetch?
- Ensures clean state (no duplicate or partial events)
- Handles blockchain reorgs (if they occurred before finalization)
- Simpler than checking for duplicates or partial state

**Step 4: Fetch New Events**
```typescript
const rawEvents = await etherscanClient.fetchPositionEvents(chainId, nftId, {
  fromBlock: fromBlock.toString(),
  toBlock: finalizedBlock.toString(),
});
```

- Queries Etherscan/block explorer for position events in block range
- Returns raw events: INCREASE_LIQUIDITY, DECREASE_LIQUIDITY, COLLECT
- Events include block number, transaction hash, amounts, liquidity changes

**Step 5: Process and Save Events**
```typescript
const eventsAdded = await processAndSaveEvents(positionId, rawEvents, deps);
```

For each event:
1. Fetch pool metadata (tokens, decimals, quote designation)
2. Get last event's state (cost basis, PnL, liquidity, uncollected principal)
3. Sort events chronologically (block → tx → log index)
4. For each event:
   - Discover historic pool price at event block
   - Calculate pool price value in quote token
   - Build event input using event processor helpers
   - Save to database
   - Update state for next event

**Step 6: Refresh APR Periods**
```typescript
await aprService.refresh(positionId);
```

- Recalculates APR periods based on updated ledger events
- Updates position's APR/fee metrics

#### Event Processing Pipeline

The `processAndSaveEvents()` function implements the complete event processing pipeline:

```typescript
async function processAndSaveEvents(
  positionId: string,
  rawEvents: RawPositionEvent[],
  deps: LedgerSyncDependencies
): Promise<number>
```

**Pipeline Steps:**

1. **Fetch Position & Pool Metadata**
   ```typescript
   const position = await prisma.position.findUnique({ where: { id: positionId } });
   const poolMetadata = await fetchPoolWithTokens(poolId, prisma, logger);
   ```
   - Gets poolId from position
   - Fetches pool with token0/token1 (decimals, quote designation)

2. **Initialize State**
   ```typescript
   const existingEvents = await ledgerService.findAllItems(positionId);
   const lastEvent = existingEvents[0]; // Newest first
   let previousState = buildInitialState(lastEvent);
   let previousEventId = extractPreviousEventId(lastEvent);
   ```
   - Fetches last event to determine starting state
   - If no events: state = zeros (new position)
   - If events exist: state = last event's "after" values

3. **Sort Events Chronologically**
   ```typescript
   const sortedEvents = sortRawEventsByBlockchain(rawEvents);
   ```
   - Sorts by block number → transaction index → log index
   - Ensures correct chronological order for state reconstruction

4. **Process Each Event Sequentially**
   ```typescript
   for (const rawEvent of sortedEvents) {
     // 4a. Get historic pool price at event block
     const historicPrice = await getHistoricPoolPrice(
       poolId,
       rawEvent.blockNumber,
       poolPriceService,
       logger
     );

     // 4b. Calculate pool price value in quote token
     const poolPriceValue = calculatePoolPriceInQuoteToken(
       historicPrice.sqrtPriceX96,
       poolMetadata.token0IsQuote,
       poolMetadata.token0Decimals,
       poolMetadata.token1Decimals
     );

     // 4c. Build event input with all financial calculations
     const eventInput = buildEventInput({
       rawEvent,
       previousState,
       poolMetadata,
       sqrtPriceX96: historicPrice.sqrtPriceX96,
       previousEventId,
       positionId,
       poolPrice: poolPriceValue,
     });

     // 4d. Save to database
     const updatedEvents = await ledgerService.addItem(positionId, eventInput);

     // 4e. Update state for next iteration
     const justAddedEvent = updatedEvents[0];
     previousEventId = justAddedEvent.id;
     previousState = extractStateFromEventInput(eventInput);
   }
   ```

#### Helper Organization

All calculation and processing logic is extracted to modular helper files for testability and maintainability:

**Location:** `src/services/position-ledger/helpers/uniswapv3/`

**Directory Structure:**
```
helpers/uniswapv3/
├── ledger-sync.ts                     # Main orchestrator (syncLedgerEvents)
├── position-metadata.ts               # Fetch position from DB, validate protocol
├── pool-metadata.ts                   # Fetch pool + tokens, determine quote token
├── pool-price-fetcher.ts              # Discover historic pool prices
├── event-builder.ts                   # Build complete event input (orchestrates processors)
├── event-sorting.ts                   # Sort events by blockchain order
├── state-builder.ts                   # Build initial state, extract previous event ID
├── event-processors/                  # Event type-specific financial logic
│   ├── increase-liquidity.ts          # Process INCREASE_LIQUIDITY events
│   ├── decrease-liquidity.ts          # Process DECREASE_LIQUIDITY events
│   └── collect.ts                     # Process COLLECT events
└── index.ts                           # Barrel exports
```

**When to Use Which Helper:**

| Helper | Purpose | Used By | Testability |
|--------|---------|---------|-------------|
| `ledger-sync.ts` | Orchestrates full sync flow | Position service (`discover`, `refresh`, `reset`) | Integration tests |
| `position-metadata.ts` | Validates position, extracts config | `processAndSaveEvents` | Unit tests (mock Prisma) |
| `pool-metadata.ts` | Fetches pool + tokens, determines quote | `processAndSaveEvents` | Unit tests (mock Prisma) |
| `pool-price-fetcher.ts` | Gets historic price at block | `processAndSaveEvents` | Unit tests (mock pool price service) |
| `event-builder.ts` | Orchestrates event processors | `processAndSaveEvents` | Unit tests (mock processors) |
| `event-sorting.ts` | Sorts events chronologically | `processAndSaveEvents` | Unit tests (pure function) |
| `state-builder.ts` | Builds initial state from last event | `processAndSaveEvents` | Unit tests (pure function) |
| `increase-liquidity.ts` | Calculates cost basis increase | `event-builder.ts` | Unit tests (pure function) |
| `decrease-liquidity.ts` | Realizes PnL, adds uncollected principal | `event-builder.ts` | Unit tests (pure function) |
| `collect.ts` | Separates fees from principal | `event-builder.ts` | Unit tests (pure function) |

**Dependency Injection Pattern:**

All helpers accept dependencies as parameters (not singletons):

```typescript
// ✅ Correct - Dependencies injected
export async function syncLedgerEvents(
  params: SyncLedgerEventsParams,
  deps: LedgerSyncDependencies
): Promise<SyncLedgerEventsResult> {
  const { prisma, etherscanClient, evmBlockService, aprService, logger } = deps;
  // Use dependencies
}

// ❌ Wrong - Singleton dependencies
const prisma = new PrismaClient(); // Global singleton
export async function syncLedgerEvents(params: SyncLedgerEventsParams) {
  // Uses global prisma
}
```

Benefits:
- Testable with mocks
- No global state
- Multiple instances possible
- Clear dependency tree

---

### 15-Second Refresh Cache

The UniswapV3 Position Service implements a **15-second refresh cache** to avoid redundant on-chain calls when position data is recently updated.

#### How It Works

When `refresh()` is called, the service checks the position's `updatedAt` timestamp:

```typescript
// Check if position was updated recently (< 15 seconds ago)
const now = new Date();
const positionAge = now.getTime() - position.updatedAt.getTime();
const CACHE_DURATION_MS = 15_000; // 15 seconds

if (positionAge < CACHE_DURATION_MS) {
  logger.info(
    { positionId, positionAge, cacheDuration: CACHE_DURATION_MS },
    'Position updated recently, returning cached data'
  );
  return position; // Return cached position without on-chain call
}
```

#### When Cache is Bypassed

The 15-second cache is bypassed in these scenarios:

1. **Position older than 15 seconds** - Fresh data needed
2. **State change detected** - On-chain state differs from database
3. **Manual refresh requested** - User explicitly requests fresh data
4. **First time accessing position** - No cached data exists

#### Why 15 Seconds?

The 15-second cache duration balances **freshness vs. cost**:

**Freshness:**
- Most users don't need sub-15-second position updates
- On-chain state changes infrequently (liquidity add/remove, fee collection)
- 15 seconds is fresh enough for dashboard displays

**Cost:**
- Avoids redundant RPC calls to Ethereum nodes
- Reduces Etherscan API usage (rate limited)
- Lowers database query load
- Improves response time (cache hit = instant, RPC call = 200-500ms)

**Alternative Durations Considered:**
- 5 seconds: Too frequent, high RPC cost, minimal freshness benefit
- 30 seconds: Too stale for active traders
- 60 seconds: Too long, users expect near-real-time data

#### Implementation

The cache is implemented using Prisma's `updatedAt` field:

```typescript
model Position {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt  // Automatically updated by Prisma
  // ... other fields
}
```

Benefits:
- ✅ No external cache infrastructure needed (Redis)
- ✅ Automatic timestamp management by Prisma
- ✅ Survives server restarts (persisted in database)
- ✅ Works across multiple workers/processes
- ✅ Simple to reason about

#### Cache Invalidation

The cache is **automatically invalidated** when:

1. **`refresh()` detects state change** - Updates position, resets `updatedAt`
2. **`discover()` creates position** - Sets initial `updatedAt`
3. **`reset()` rebuilds position** - Updates `updatedAt` after rebuild
4. **Manual update** - Any service that calls `position.update()` invalidates cache

No manual cache invalidation needed!

---

### State Change Detection

The UniswapV3 Position Service implements **on-chain state change detection** to determine when ledger events need to be re-synced.

#### Monitored Fields

The service monitors these on-chain fields to detect state changes:

1. **`liquidity`** - Current liquidity in position
2. **`tokensOwed0` / `tokensOwed1`** - Unclaimed fees/principal
3. **`feeGrowthInside0LastX128` / `feeGrowthInside1LastX128`** - Fee growth checkpoints

```typescript
// Read current on-chain state
const onChainState = await nfpmContract.read.positions([nftId]);

// Compare with database state
const stateChanged =
  onChainState.liquidity !== position.state.liquidity ||
  onChainState.tokensOwed0 !== position.state.tokensOwed0 ||
  onChainState.tokensOwed1 !== position.state.tokensOwed1 ||
  onChainState.feeGrowthInside0LastX128 !== position.state.feeGrowthInside0LastX128 ||
  onChainState.feeGrowthInside1LastX128 !== position.state.feeGrowthInside1LastX128;
```

#### Why These Fields?

These fields indicate that **a new event has occurred**:

| Field | Indicates Event Type | Example |
|-------|---------------------|---------|
| `liquidity` changed | INCREASE_LIQUIDITY or DECREASE_LIQUIDITY | User added/removed liquidity |
| `tokensOwed0/1` changed | DECREASE_LIQUIDITY or COLLECT | User removed liquidity (increases tokensOwed) or collected fees (decreases tokensOwed) |
| `feeGrowthInside*` changed | COLLECT | User collected fees, fee growth checkpoints updated |

#### How It Triggers Incremental Sync

When a state change is detected:

```typescript
if (stateChanged) {
  logger.info(
    { positionId, onChainState, databaseState: position.state },
    'State change detected, syncing ledger events'
  );

  // Trigger incremental sync (NOT full resync)
  await syncLedgerEvents({
    positionId: position.id,
    chainId: position.config.chainId,
    nftId: position.config.nftId,
    forceFullResync: false, // Incremental sync
  }, deps);
}
```

**Incremental Sync Flow:**
1. Get last finalized block
2. Get last ledger event's block number
3. Delete events >= last event block (clean state)
4. Fetch new events from last event block → finalized block
5. Process and save new events
6. Refresh APR periods

#### Benefits

- ✅ **Automatic sync** - No manual intervention needed
- ✅ **Efficient** - Only sync when state actually changed
- ✅ **Incremental** - Don't refetch entire history
- ✅ **Reliable** - Uses finalized blocks to avoid reorgs

#### Edge Cases Handled

1. **No state change** - Skip sync, return cached position
2. **State change but no new finalized blocks** - Skip sync (no new events to fetch)
3. **Multiple rapid state changes** - 15-second cache prevents redundant syncs
4. **Blockchain reorg** - Finalized block boundary ensures no reorg issues

---

### Ledger Sync Flow Diagram

This diagram shows the complete flow for `refresh()` method with incremental syncing:

```
User calls refresh(positionId)
  │
  ├─→ Check position.updatedAt
  │     │
  │     ├─→ < 15 seconds ago?
  │     │     └─→ YES: Return cached position ✅
  │     │
  │     └─→ NO: Continue to state check
  │
  ├─→ Read on-chain state from NFPM contract
  │     │
  │     └─→ Compare with database state
  │           │
  │           ├─→ State unchanged?
  │           │     │
  │           │     └─→ YES: Recalculate common fields → Update position → Return ✅
  │           │
  │           └─→ NO: State changed → Continue to sync
  │
  ├─→ syncLedgerEvents() [INCREMENTAL]
  │     │
  │     ├─→ 1. Get last finalized block
  │     │     │
  │     │     └─→ evmBlockService.getLastFinalizedBlockNumber(chainId)
  │     │
  │     ├─→ 2. Determine fromBlock
  │     │     │
  │     │     ├─→ Get last ledger event block number
  │     │     │
  │     │     └─→ fromBlock = MIN(lastEventBlock ?? nfpmBlock, finalizedBlock)
  │     │
  │     ├─→ 3. Delete events >= fromBlock
  │     │     │
  │     │     └─→ deleteEventsFromBlock(positionId, fromBlock)
  │     │
  │     ├─→ 4. Fetch new events from Etherscan
  │     │     │
  │     │     └─→ etherscanClient.fetchPositionEvents(chainId, nftId, {
  │     │           fromBlock, toBlock: finalizedBlock
  │     │         })
  │     │
  │     ├─→ 5. Process and save events sequentially
  │     │     │
  │     │     └─→ processAndSaveEvents(positionId, rawEvents, deps)
  │     │           │
  │     │           ├─→ Fetch pool metadata (tokens, decimals)
  │     │           │
  │     │           ├─→ Get last event for state initialization
  │     │           │
  │     │           ├─→ Sort events chronologically
  │     │           │
  │     │           └─→ For each event:
  │     │                 │
  │     │                 ├─→ Get historic pool price at event block
  │     │                 │
  │     │                 ├─→ Calculate pool price value in quote token
  │     │                 │
  │     │                 ├─→ Build event input using processor helpers
  │     │                 │     │
  │     │                 │     ├─→ INCREASE_LIQUIDITY → increase-liquidity.ts
  │     │                 │     ├─→ DECREASE_LIQUIDITY → decrease-liquidity.ts
  │     │                 │     └─→ COLLECT → collect.ts
  │     │                 │
  │     │                 ├─→ Save event to database
  │     │                 │
  │     │                 └─→ Update state for next event
  │     │
  │     └─→ 6. Refresh APR periods
  │           │
  │           └─→ aprService.refresh(positionId)
  │
  ├─→ Recalculate common fields
  │     │
  │     ├─→ Get ledger summary (cost basis, PnL, collected fees)
  │     ├─→ Calculate unclaimed fees (on-chain tick data)
  │     ├─→ Calculate current position value
  │     └─→ Calculate price range (tick bounds)
  │
  └─→ Update position in database → Return updated position ✅
```

**Key Decision Points:**

1. **Cache Check** - Avoids redundant work if position recently updated
2. **State Check** - Only sync if on-chain state changed
3. **Incremental vs Full** - `refresh()` uses incremental, `discover()`/`reset()` use full
4. **Finalized Block** - Never go beyond finalized block to avoid reorgs

---

## Roadmap

For the complete project roadmap across all packages, see:
**[Project Roadmap](../CLAUDE.md#project-roadmap)**

### Services-Specific Upcoming Work

**Phase 2: Service Layer Implementation** (Current)
- Position tracking and monitoring
- Risk calculation algorithms
- Automated rebalancing strategies
- Fee collection optimization
- Impermanent loss tracking

**Phase 3: Multi-Platform Support**
- Arbitrum, Polygon, Optimism (Uniswap V3 forks)
- Solana DEXs (Orca, Raydium)
- Cross-chain position management

---

## Related Documentation

### Monorepo Documentation
- **[Central CLAUDE.md](../CLAUDE.md)** - Architecture, philosophy, ecosystem overview
- **[API CLAUDE.md](../midcurve-api/CLAUDE.md)** - REST endpoints implementation
- **[Shared README.md](../midcurve-shared/README.md)** - Type definitions and utilities

### External Documentation
- **[Prisma Documentation](https://www.prisma.io/docs)** - ORM and schema management
- **[Viem Documentation](https://viem.sh)** - Ethereum utilities
- **[Vitest Documentation](https://vitest.dev)** - Testing framework

---

## Contributing

For contributing guidelines, git workflow, and commit message format, see:
**[Contributing Section](../CLAUDE.md#contributing)**

---

**Midcurve Finance** - Professional risk management for concentrated liquidity providers
