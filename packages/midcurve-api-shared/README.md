# @midcurve/api-shared

> Shared API types and utilities for Midcurve Finance

This package contains all TypeScript types, Zod validation schemas, and utilities used across the Midcurve API ecosystem, including the REST API, frontend application, and background workers.

## Features

- **Type-safe API contracts** - TypeScript types for all request/response shapes
- **Runtime validation** - Zod schemas for request validation
- **Protocol-agnostic design** - Support for multiple DEX protocols (Uniswap V3, Orca, Raydium, etc.)
- **Framework-agnostic** - Works in Node.js, browsers, and edge runtimes
- **ESM + CJS support** - Both module formats included
- **Zero runtime dependencies** - Only peer dependencies (@midcurve/shared, zod)

## Installation

### Using Yalc (Development)

```bash
# In api-shared repository
npm run yalc:publish

# In consuming project
yalc link @midcurve/api-shared
npm install
```

### Using npm (Production)

```bash
npm install @midcurve/api-shared
```

## Usage

### Basic Import

```typescript
// Import everything from main entry point
import { ApiResponse, ApiErrorCode, CreateErc20TokenRequest } from '@midcurve/api-shared';

// Or import from specific modules (tree-shaking friendly)
import { ApiResponse, ApiErrorCode } from '@midcurve/api-shared/types/common';
import { CreateErc20TokenRequest } from '@midcurve/api-shared/types/tokens';
```

### Common Types

```typescript
import {
  ApiResponse,
  ApiError,
  ApiErrorCode,
  PaginatedResponse,
  BigIntToString,
  createSuccessResponse,
  createErrorResponse,
} from '@midcurve/api-shared';

// Create success response
const response: ApiResponse<{ name: string }> = createSuccessResponse(
  { name: 'ETH' },
  { timestamp: new Date().toISOString() }
);

// Create error response
const error: ApiResponse<never> = createErrorResponse(
  ApiErrorCode.NOT_FOUND,
  'Token not found',
  { tokenId: '123' }
);

// Paginated response
const paginated: PaginatedResponse<{ id: string }> = {
  success: true,
  data: [{ id: '1' }, { id: '2' }],
  pagination: {
    total: 100,
    limit: 20,
    offset: 0,
    hasMore: true,
  },
  timestamp: new Date().toISOString(),
};
```

### Authentication Types

```typescript
import {
  NonceSchema,
  CreateApiKeyRequestSchema,
  LinkWalletRequest,
  AuthenticatedUser,
} from '@midcurve/api-shared';

// Validate API key creation request
const result = CreateApiKeyRequestSchema.safeParse({
  name: 'My API Key',
});

if (result.success) {
  const validated = result.data; // Type-safe!
}

// Use authenticated user type in middleware
function withAuth(user: AuthenticatedUser) {
  console.log(user.id); // Always present
  console.log(user.wallets); // Optional array of wallet addresses
}
```

### Token Types

```typescript
import {
  CreateErc20TokenRequest,
  CreateErc20TokenResponse,
  SearchErc20TokensQuery,
  CreateErc20TokenRequestSchema,
} from '@midcurve/api-shared';

// Type-safe request
const request: CreateErc20TokenRequest = {
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  chainId: 1,
};

// Validate with Zod
const validated = CreateErc20TokenRequestSchema.parse(request);
```

### Pool Types

```typescript
import {
  GetUniswapV3PoolQuery,
  DiscoverUniswapV3PoolsQuery,
  GetUniswapV3PoolQuerySchema,
} from '@midcurve/api-shared';

// Pool lookup with optional metrics
const query: GetUniswapV3PoolQuery = {
  chainId: 1,
  metrics: true,
  fees: true,
};
```

### Position Types (Protocol-Agnostic)

```typescript
import {
  ListPositionsParams,
  ListPositionsResponse,
  LedgerEventData,
  AprPeriodData,
  PositionStatus,
  PositionSortBy,
} from '@midcurve/api-shared';

// List positions across all protocols
const params: ListPositionsParams = {
  protocols: ['uniswapv3', 'orca'],
  status: 'active',
  sortBy: 'currentValue',
  sortDirection: 'desc',
  limit: 20,
  offset: 0,
};
```

### Position Types (Uniswap V3 Specific)

```typescript
import {
  CreateUniswapV3PositionRequest,
  UpdateUniswapV3PositionRequest,
  CreateUniswapV3PositionRequestSchema,
  UniswapV3EventType,
} from '@midcurve/api-shared';

// Create position request
const createRequest: CreateUniswapV3PositionRequest = {
  poolAddress: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
  tickUpper: 201120,
  tickLower: 199120,
  ownerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
  increaseEvent: {
    timestamp: '2025-01-15T10:30:00Z',
    blockNumber: '12345678',
    transactionIndex: 42,
    logIndex: 5,
    transactionHash: '0x1234...',
    liquidity: '1000000000000000000',
    amount0: '500000000',
    amount1: '250000000000000000',
  },
};

// Validate request
const validated = CreateUniswapV3PositionRequestSchema.parse(createRequest);
```

### BigInt Serialization

```typescript
import { BigIntToString } from '@midcurve/api-shared';
import type { UniswapV3Position } from '@midcurve/shared';

// Convert domain types (with bigint) to API types (with string)
type PositionResponse = BigIntToString<UniswapV3Position>;

// All bigint fields are now strings
// All Date fields are now ISO 8601 strings
// Arrays and nested objects are recursively transformed
```

## Package Structure

```
@midcurve/api-shared
├── types/
│   ├── common/              # Base types and utilities
│   │   ├── api-response.ts  # ApiResponse, ApiError, error codes
│   │   ├── pagination.ts    # Pagination helpers
│   │   └── serialization.ts # BigIntToString transformer
│   │
│   ├── auth/                # Authentication types
│   │   ├── nonce.ts         # SIWE nonce generation
│   │   ├── user.ts          # User profile types
│   │   ├── api-key.ts       # API key management
│   │   ├── link-wallet.ts   # Wallet linking
│   │   └── authenticated-user.ts  # Middleware user type
│   │
│   ├── health/              # Health check types
│   │   └── health.ts
│   │
│   ├── tokens/              # Token endpoint types
│   │   └── erc20.ts         # ERC-20 tokens
│   │
│   ├── pools/               # Pool endpoint types
│   │   ├── uniswapv3.ts            # Pool lookup
│   │   └── uniswapv3-discovery.ts  # Pool discovery
│   │
│   └── positions/           # Position endpoint types
│       ├── common/          # Protocol-agnostic
│       │   ├── list.ts      # List/filter/sort
│       │   ├── ledger.ts    # Ledger events
│       │   └── apr.ts       # APR calculation
│       │
│       └── uniswapv3/       # Uniswap V3 specific
│           ├── create.ts
│           ├── get.ts
│           ├── update.ts
│           ├── delete.ts
│           └── import.ts
```

## Type Organization Philosophy

### Protocol-Agnostic vs Protocol-Specific

**Protocol-agnostic types** (`positions/common/`) work across ALL DEX protocols:
- List positions - Works for Uniswap V3, Orca, Raydium, etc.
- Ledger events - Generic event structure with `protocol` discriminator
- APR periods - Pure financial calculations

**Protocol-specific types** (`positions/uniswapv3/`) are tied to implementation details:
- Create, Get, Update, Delete, Import operations
- Different parameters per protocol (e.g., NFT IDs for Uniswap V3 vs account addresses for Orca)

This organization makes it easy to add new protocols without refactoring:
```typescript
// Future: positions/orca/
// Future: positions/raydium/
```

## API Error Codes

All error codes are available in the `ApiErrorCode` enum:

```typescript
export enum ApiErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  EXTERNAL_API_ERROR = 'EXTERNAL_API_ERROR',

  // Token-specific
  TOKEN_NOT_FOUND = 'TOKEN_NOT_FOUND',
  TOKEN_ALREADY_EXISTS = 'TOKEN_ALREADY_EXISTS',

  // Pool-specific
  POOL_NOT_FOUND = 'POOL_NOT_FOUND',

  // Position-specific
  POSITION_NOT_FOUND = 'POSITION_NOT_FOUND',
  POSITION_ALREADY_EXISTS = 'POSITION_ALREADY_EXISTS',

  // Auth-specific
  INVALID_NONCE = 'INVALID_NONCE',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  WALLET_ALREADY_LINKED = 'WALLET_ALREADY_LINKED',
  WALLET_ALREADY_REGISTERED = 'WALLET_ALREADY_REGISTERED',
  // ... and more
}
```

## Development

### Building

```bash
npm run build        # Build with tsup (ESM + CJS + types)
npm run dev          # Watch mode
npm run clean        # Clean dist/
npm run type-check   # TypeScript check only
```

### Testing

```bash
npm test             # Run tests (not yet implemented)
```

### Publishing

```bash
# Local development with yalc
npm run yalc:publish  # Build and publish to yalc store
npm run yalc:push     # Build and push to linked projects

# Production (future)
npm publish
```

## Dependencies

**Peer Dependencies** (required by consumers):
- `@midcurve/shared` ^0.1.0 - Domain types (Token, Pool, Position, etc.)
- `zod` ^3.22.0 - Runtime validation

**Dev Dependencies**:
- `typescript` ^5.3.3
- `tsup` ^8.5.0 - Build tool
- `vitest` ^3.2.4 - Testing framework
- `yalc` ^1.0.0-pre.53 - Local package management

## Migration Guide

### From Local Types to @midcurve/api-shared

If you're migrating from local `src/types/` imports:

```typescript
// Before
import { ApiResponse } from '@/types/common';
import { CreateErc20TokenRequest } from '@/types/tokens';
import { CreateUniswapV3PositionRequest } from '@/types/positions';

// After
import {
  ApiResponse,
  CreateErc20TokenRequest,
  CreateUniswapV3PositionRequest,
} from '@midcurve/api-shared';
```

All types are now exported from the main entry point for convenience.

## License

MIT

## Author

Midcurve Finance
