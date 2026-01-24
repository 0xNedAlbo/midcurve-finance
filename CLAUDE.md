# Midcurve Finance Monorepo

## Project Overview

**Midcurve Finance** is a comprehensive risk management platform for concentrated liquidity (CL) provisioning across multiple blockchain ecosystems, including Ethereum, BSC, and Solana.

The platform enables liquidity providers to:
- **Monitor** concentrated liquidity positions in real-time
- **Analyze** risk exposure and PnL across multiple DEX protocols
- **Automate** rebalancing strategies to maximize returns
- **Track** impermanent loss and fee collection
- **Optimize** gas costs and execution strategies

## Production Architecture

The platform runs as a **multi-service Docker Compose stack** with separate frontend and backend applications:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Midcurve Finance - Production Stack               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  INTERNET                                                            │
│     │                                                                │
│     ▼                                                                │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Caddy (Reverse Proxy)                      │   │
│  │                    Ports 80/443 - Auto SSL                    │   │
│  │  ┌─────────────────────────┐  ┌────────────────────────────┐ │   │
│  │  │ app.midcurve.finance    │  │ api.midcurve.finance       │ │   │
│  │  │         ↓               │  │         ↓                  │ │   │
│  │  │     ui:3000             │  │     api:3001               │ │   │
│  │  └─────────────────────────┘  └────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  FRONTEND NETWORK ──────────────────────────────────────────────    │
│  │                                                                   │
│  │  ┌─────────────────────────┐                                     │
│  │  │   midcurve-ui           │  Vite SPA + nginx                   │
│  │  │   Port 3000             │  React 19, TailwindCSS              │
│  │  └─────────────────────────┘  RainbowKit, Wagmi                  │
│  │                                                                   │
│  BACKEND NETWORK (internal, isolated) ──────────────────────────    │
│  │                                                                   │
│  │  ┌─────────────────────────┐  ┌─────────────────────────┐       │
│  │  │   midcurve-api          │  │   midcurve-pool-prices  │       │
│  │  │   Port 3001             │  │   (no HTTP port)        │       │
│  │  │   Next.js REST API      │  │   WebSocket Subscriber  │       │
│  │  │   SIWE Auth, Sessions   │  │   RabbitMQ Publisher    │       │
│  │  └───────────┬─────────────┘  └───────────┬─────────────┘       │
│  │              │                            │                       │
│  │  ┌───────────▼─────────────┐  ┌───────────▼─────────────┐       │
│  │  │   midcurve-automation   │  │   midcurve-signer       │       │
│  │  │   Port 3004             │  │   Port 3003             │       │
│  │  │   Price Monitoring      │  │   Transaction Signing   │       │
│  │  │   Order Execution       │  │   Key Management        │       │
│  │  └─────────────────────────┘  └─────────────────────────┘       │
│  │                                                                   │
│  │  ┌─────────────────────────┐                                     │
│  │  │   rabbitmq              │                                     │
│  │  │   Port 5672             │                                     │
│  │  │   Message broker        │                                     │
│  │  │   RabbitMQ 3.13         │                                     │
│  │  └─────────────────────────┘                                     │
│  │                                                                   │
│  EXTERNAL ──────────────────────────────────────────────────────    │
│  │                                                                   │
│  │  ┌─────────────────────────┐                                     │
│  │  │   PostgreSQL (AWS RDS)  │  Shared database                    │
│  │  │   @midcurve/database    │  Prisma ORM                         │
│  │  └─────────────────────────┘                                     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Architecture Decisions:**
- **Separate UI and API** - Cross-origin architecture with CORS
- **Network isolation** - Backend services not exposed to internet
- **Auto SSL** - Caddy handles Let's Encrypt certificates
- **Message queue** - RabbitMQ for pool price events and automation

## Repository Structure

```
midcurve-finance/
├── apps/
│   ├── midcurve-ui/          # Vite SPA - React frontend
│   ├── midcurve-api/         # Next.js REST API backend
│   ├── midcurve-automation/  # Price monitoring & order execution
│   ├── midcurve-pool-prices/ # Real-time pool price subscriptions
│   └── midcurve-signer/      # Transaction signing service
├── packages/
│   ├── midcurve-shared/      # @midcurve/shared - Domain types & utilities
│   ├── midcurve-services/    # @midcurve/services - Business logic
│   ├── midcurve-api-shared/  # @midcurve/api-shared - API types & schemas
│   └── midcurve-database/    # @midcurve/database - Prisma schema & ORM
├── infra/
│   └── Caddyfile             # Reverse proxy configuration
├── docker-compose.yml        # Production orchestration
├── turbo.json                # Turborepo configuration
├── package.json              # Workspace configuration (pnpm)
└── CLAUDE.md                 # This file
```

**⚠️ IMPORTANT - Git Repository Architecture:**

This is a **Turborepo monorepo** with a **single git repository** at the root level.

- ✅ **Single git repository** at `/Users/job/Documents/Programmieren/midcurve-finance/`
- ✅ **All packages tracked together** in one repository
- ✅ **Turborepo manages builds** and dependencies across packages
- ✅ **npm workspaces** handle package linking (apps/*, packages/*)

**Rationale:**
- Simplified dependency management with Turborepo
- Atomic commits across multiple packages
- Shared tooling and CI/CD configuration
- Easier local development with automatic package linking
- Single source of truth for the entire codebase

**Repository:**
- GitHub: https://github.com/0xNedAlbo/midcurve-finance.git
- Branch: `main`

## Package Roles & Responsibilities

### @midcurve/shared - Pure Types & Utilities

**Location:** `midcurve-shared/`

**Purpose:** Framework-agnostic types and utilities shared across ALL Midcurve projects.

**Consumed by:**
- API (REST endpoints)
- UI (Frontend application)
- Services (Business logic)
- Workers (Background processors)

**Contains:**
- **Core Types:**
  - Token types (`Token`, `Erc20Token`, `SolanaToken`)
  - Pool types (`Pool`, `UniswapV3Pool`)
  - Position types (`Position`, `UniswapV3Position`)
  - User types (`User`, `AuthWalletAddress`)
  - Pool price types (`PoolPrice`)
  - Ledger event types (`PositionLedgerEvent`)

- **Utilities:**
  - EVM address utilities (validation, normalization, comparison)
  - UniswapV3 math functions (price conversions, liquidity calculations)
  - Mathematical helpers for DeFi calculations

**Key Characteristics:**
- ✅ **Zero dependencies** on databases or services
- ✅ **Framework-agnostic** (works in browser, Node.js, edge runtimes)
- ✅ **Pure TypeScript** types and functions
- ✅ **Independently versioned** and published to npm
- ✅ **Discriminated unions** for type safety
- ✅ **Generic interfaces** for flexibility

**Documentation:** See [packages/midcurve-shared/README.md](packages/midcurve-shared/README.md)

---

### @midcurve/services - Business Logic Layer

**Location:** `midcurve-services/`

**Purpose:** Implements core business logic, database operations, and service layers.

**Consumed by:**
- API (REST endpoints)
- Workers (Background processors)

**Contains:**
- **Services:**
  - `TokenService` - Generic token CRUD operations
  - `Erc20TokenService` - ERC-20 specialized service with on-chain discovery
  - Future: Pool service, Position service, Risk calculation service

- **Clients:**
  - `CoinGeckoClient` - Token enrichment with distributed caching
  - Future: Etherscan, Subgraph clients

- **Cache:**
  - `CacheService` - PostgreSQL-based distributed cache (shared across workers/serverless functions)

- **Config:**
  - `EvmConfig` - RPC endpoint management for all EVM chains
  - Chain configuration and public client creation

- **Utilities:**
  - ERC-20 contract readers (requires viem and RPC access)
  - APR calculation utilities
  - Request scheduling and rate limiting

- **Database Schema:**
  - Prisma schema definition (single source of truth)
  - PostgreSQL models and migrations

**Key Characteristics:**
- ✅ **Prisma client generation** in consumer projects (peer dependency pattern)
- ✅ **Distributed caching** via PostgreSQL (no Redis required)
- ✅ **Address normalization** for EVM chains (EIP-55 checksumming)
- ✅ **Dependency injection** for testability
- ✅ **Comprehensive testing** (121+ tests with 100% coverage)
- ✅ **Multi-chain support** (Ethereum, Arbitrum, Base, BSC, Polygon, Optimism)

**Documentation:** See [packages/midcurve-services/CLAUDE.md](packages/midcurve-services/CLAUDE.md)

---

### @midcurve/api-shared - API Types & Schemas

**Location:** `midcurve-api-shared/`

**Purpose:** Shared API types, validation schemas, and utilities for all API consumers.

**Consumed by:**
- API (REST endpoints)
- UI (Frontend application)
- Workers (Background processors)
- External clients (3rd party integrations)

**Contains:**
- **Common Types:**
  - `ApiResponse<T>` - Standard response wrapper
  - `ApiError` - Error response structure
  - `ApiErrorCode` - 22 standardized error codes
  - `PaginatedResponse<T>` - Pagination wrapper
  - `BigIntToString<T>` - Transform bigint → string for JSON

- **Authentication Types:**
  - Nonce generation (SIWE)
  - User profile types
  - API key management types
  - Wallet linking types
  - Authenticated user type (middleware)

- **Feature Types:**
  - Health check types
  - Token endpoint types (ERC-20)
  - Pool endpoint types (Uniswap V3)
  - Position endpoint types (common + protocol-specific)

- **Validation Schemas:**
  - Zod schemas for all request types
  - Runtime validation with automatic type inference

**Key Characteristics:**
- ✅ **Type-safe API contracts** - Request/response shapes for all endpoints
- ✅ **Protocol-agnostic design** - Supports multiple DEX protocols
- ✅ **Framework-agnostic** - Works in browsers, Node.js, edge runtimes
- ✅ **ESM + CJS support** - Both module formats included
- ✅ **Zero runtime dependencies** - Only peer deps (zod, @midcurve/shared)
- ✅ **Tree-shakeable** - Granular exports for optimal bundle size

**Documentation:** See [packages/midcurve-api-shared/README.md](packages/midcurve-api-shared/README.md)

---

### @midcurve/database - Prisma Schema & ORM

**Location:** `packages/midcurve-database/`

**Purpose:** Centralized database schema definition and Prisma client generation.

**Consumed by:**
- API (midcurve-api)
- Automation service (midcurve-automation)
- Pool prices service (midcurve-pool-prices)
- Signer service (midcurve-signer)

**Contains:**
- **Prisma Schema:**
  - `prisma/schema.prisma` - Single source of truth for database models
  - All migrations in `prisma/migrations/`

- **Generated Client:**
  - `@midcurve/database` exports the generated Prisma client
  - Type-safe database queries

- **Models:**
  - User, Session, AuthWalletAddress
  - Token, Pool, Position
  - AutomationWallet, CloseOrder, AutomationContract
  - PositionLedgerEvent, AprPeriod
  - Cache (for distributed caching)

**Key Characteristics:**
- ✅ **Single source of truth** - All services use the same schema
- ✅ **Centralized migrations** - Run once, applied everywhere
- ✅ **Type-safe queries** - Generated TypeScript types
- ✅ **PostgreSQL** - JSON columns for flexible config storage

**Usage:**
```typescript
import { prisma } from '@midcurve/database';

const user = await prisma.user.findUnique({
  where: { id: userId }
});
```

---

## Applications

### @midcurve/ui - React Frontend (Vite SPA)

**Location:** `apps/midcurve-ui/`

**Purpose:** Static React single-page application served by nginx. Pure client-side rendering with no server-side code.

**Technology:**
- **Vite** - Build tool and dev server
- **React 19** - UI framework
- **TailwindCSS 4.0** - Styling
- **RainbowKit + Wagmi** - Wallet connection
- **TanStack React Query** - Server state management
- **nginx** - Static file serving in production

**Contains:**
- Dashboard with position overview
- Position management (import, view, analyze)
- SIWE authentication flow
- Close order automation (SIL/TIP triggers)
- Risk analytics visualizations

**Key Characteristics:**
- ✅ **Pure SPA** - No server-side rendering
- ✅ **Cross-origin API calls** - Uses `apiClient` with `credentials: 'include'`
- ✅ **Type safety** - Imports types from @midcurve/api-shared
- ✅ **Wallet integration** - RainbowKit for connection, Wagmi for transactions
- ✅ **Build-time env vars** - `VITE_API_URL`, `VITE_WALLETCONNECT_PROJECT_ID`

**Directory Structure:**
```
midcurve-ui/
├── src/
│   ├── components/           # React components
│   ├── hooks/                # React Query hooks
│   ├── lib/                  # api-client, wagmi-config
│   ├── pages/                # Route components
│   └── utils/                # Helper functions
├── public/                   # Static assets
├── nginx.conf                # Production server config
├── Dockerfile                # Multi-stage build
└── vite.config.ts            # Vite configuration
```

**Build & Serve:**
```bash
# Development
npm run dev           # Vite dev server on port 5173

# Production (Docker)
docker build -t midcurve-ui .
# Builds with Vite, serves with nginx on port 3000
```

---

### @midcurve/api - REST API Backend

**Location:** `apps/midcurve-api/`

**Purpose:** Next.js REST API providing all backend endpoints. Handles authentication, data fetching, and business logic orchestration.

**Technology:**
- **Next.js 15** - App Router with standalone output
- **Prisma** - Database access via @midcurve/database
- **viem** - EVM interactions
- **Zod** - Request validation

**API Routes:**
- `GET /api/health` - Health check
- `/api/v1/auth/*` - SIWE authentication (nonce, verify, logout)
- `/api/v1/user/*` - User profile, wallets, API keys
- `/api/v1/tokens/erc20/*` - Token discovery and enrichment
- `/api/v1/pools/uniswapv3/*` - Pool data and pricing
- `/api/v1/positions/*` - Position CRUD, history, APR
- `/api/v1/automation/*` - Close orders and position automation

**Key Characteristics:**
- ✅ **Session-based auth** - Custom session middleware with cookies
- ✅ **API key support** - Bearer token authentication for programmatic access
- ✅ **CORS handling** - Via Next.js middleware
- ✅ **Structured logging** - Pino with request IDs
- ✅ **Standalone output** - Optimized for Docker deployment

**Directory Structure:**
```
midcurve-api/
├── src/
│   ├── app/api/              # Next.js API routes
│   │   ├── v1/
│   │   │   ├── auth/
│   │   │   ├── positions/
│   │   │   ├── automation/
│   │   │   └── ...
│   │   └── health/
│   ├── lib/                  # Utilities (cors, logger, session)
│   └── middleware/           # Auth middleware (withAuth, withSessionAuth)
├── middleware.ts             # Next.js edge middleware for CORS
├── Dockerfile                # Multi-stage build
└── next.config.ts            # Next.js configuration
```

---

### @midcurve/signer - Transaction Signing Service

**Location:** `apps/midcurve-signer/`

**Purpose:** Secure transaction signing service. Manages private keys and signs transactions for automated position management.

**Key Features:**
- **Local encrypted keys** - For development
- **AWS KMS integration** - For production
- **Internal API key auth** - Only accessible from backend network

**Key Characteristics:**
- ✅ **Network isolated** - Only accessible on backend network
- ✅ **Key encryption** - Never stores plaintext keys
- ✅ **Audit logging** - All signing operations logged

**Directory Structure:**
```
midcurve-signer/
├── src/
│   ├── app/api/              # Signing endpoints
│   └── lib/                  # Key management
├── Dockerfile
└── next.config.ts
```

---

### @midcurve/automation - Price Monitoring & Order Execution

**Location:** `apps/midcurve-automation/`

**Purpose:** Automated position management for Uniswap V3 positions. Monitors pool prices and executes close orders when user-defined trigger conditions are met.

**Technology:**
- **Next.js 15** - API server with standalone output
- **Foundry** - Smart contract development (Solidity 0.8.20)
- **RabbitMQ** - Event-driven order processing
- **Paraswap** - DEX aggregator for token swaps

**Components:**
- **Price Monitor Worker** - Polls pools (10s default), detects trigger conditions
- **Order Executor Worker** - Consumes RabbitMQ messages, executes close orders
- **UniswapV3PositionCloser.sol** - Smart contract for atomic position closing

**Key Characteristics:**
- ✅ **Event-driven** - RabbitMQ for async processing
- ✅ **Atomic execution** - Smart contract closes position in one tx
- ✅ **Slippage protection** - Configurable minimum amounts
- ✅ **Multi-chain** - Deployed on all supported EVM chains

**Directory Structure:**
```
midcurve-automation/
├── src/
│   ├── app/api/              # Health check, worker status endpoints
│   ├── workers/              # Price monitor, order executor
│   ├── clients/              # Paraswap, signer, tx broadcaster
│   └── mq/                   # RabbitMQ connection management
├── contracts/                # Solidity contracts
│   └── UniswapV3PositionCloser.sol
├── Dockerfile
└── foundry.toml              # Foundry configuration
```

---

## Technology Stack

### Languages & Runtimes
- **TypeScript 5.3+** - Strict mode, ESM modules
- **Node.js 20.19.x** - Server-side runtime
- **Solidity 0.8.20** - Smart contracts (position closer, hedge vaults)

### Build Tools
- **Vite** - Frontend build tool (midcurve-ui)
- **Next.js 15** - Backend API framework (api, automation, signer)
- **Turborepo** - Monorepo build orchestration
- **pnpm 9.12.0** - Package manager
- **Foundry** - Smart contract development (midcurve-automation, midcurve-hedges)

### Frontend
- **React 19** - UI framework
- **TailwindCSS 4.0** - Utility-first CSS
- **RainbowKit** - Wallet connection UI
- **Wagmi** - React hooks for Ethereum
- **TanStack React Query** - Server state management
- **Recharts** - Data visualization

### Backend
- **Prisma 6.x** - ORM and schema management
- **viem 2.38+** - Ethereum utilities, EIP-55 checksumming
- **Zod 3.22+** - Runtime validation
- **Pino** - Structured logging
- **nanoid** - Request ID generation

### Infrastructure
- **Docker + Docker Compose** - Container orchestration
- **Caddy** - Reverse proxy with auto SSL
- **nginx** - Static file serving (UI)
- **PostgreSQL** - Primary database (AWS RDS)
- **RabbitMQ 3.13** - Message broker for pool price events and automation

### Testing
- **Vitest 3.2+** - Unit and API testing
- **Playwright 1.56+** - UI E2E testing
- **vitest-mock-extended** - Type-safe Prisma mocking

---

## Architecture Principles

### 1. Type Hierarchy & Separation of Concerns

```
┌─────────────────────────────────────┐
│     @midcurve/shared (Types)        │  ← Pure types (no dependencies)
│  - Token, Pool, Position            │
│  - AuthWalletAddress, User          │
│  - Utilities (address, math)        │
└─────────────────────────────────────┘
           ↑ imports          ↑ imports
           │                  │
┌──────────┴────────┐  ┌──────┴─────────────┐
│  @midcurve/ui     │  │ @midcurve/services │
│  (UI + API)       │  │ (Business logic)   │
│  - React UI       │  └────────────────────┘
│  - API routes     │            ↓ uses
└───────────────────┘  ┌─────────────────────┐
                       │  @prisma/client     │
                       │  (Database layer)   │
                       └─────────────────────┘
```

**Key Rules:**
- ✅ **Import types from @midcurve/shared**, NOT from `@prisma/client`
- ✅ **Shared types are portable** - Work in browsers, Node.js, edge runtimes
- ✅ **Prisma types are internal** - Used only within services layer
- ✅ **Services converts** between shared types and Prisma types when necessary
- ✅ **Cross-origin auth** - Custom session middleware with CORS support

### 2. Prisma Schema Management with @midcurve/database

**Single Source of Truth:** Prisma schema AND migrations are maintained in `packages/midcurve-database/prisma/`

**Centralized Package Pattern:**
1. `@midcurve/database` package contains Prisma schema and migrations
2. Package generates Prisma client locally in `src/generated/prisma/`
3. Package exports the Prisma client instance for all consumers
4. All backend apps (api, evm, signer) import from `@midcurve/database`

**Benefits:**
- ✅ Single Prisma client instance across all services
- ✅ Schema changes propagate via workspace linking
- ✅ Migrations centralized in one location
- ✅ Type safety with generated TypeScript types

**Workflow:**
```bash
# From monorepo root: Update schema and create migration
cd packages/midcurve-database
# Edit prisma/schema.prisma
pnpm db:migrate:dev --name your_migration_name

# Changes immediately available via workspace linking
# All apps automatically use the updated client

# Run Prisma Studio to inspect database
pnpm db:studio
```

**Docker Deployment:**
```bash
# In Dockerfile - run migrations before starting app
RUN pnpm --filter @midcurve/database db:migrate:deploy

# Or in entrypoint script:
npx prisma migrate deploy --schema=./packages/midcurve-database/prisma/schema.prisma
```

**Migration Application:**
- **Development:** `pnpm db:migrate:dev` in midcurve-database package
- **Production/Docker:** `prisma migrate deploy` in Dockerfile or entrypoint
- **Safety:** `prisma migrate deploy` is idempotent (safe to run on every deployment)

### 3. Workspace Protocol for Package Linking

**Why npm Workspaces?**

This monorepo uses **npm workspaces** with the `workspace:*` protocol for automatic package linking.

**Benefits:**
- ✅ **Automatic linking** - Packages reference each other without manual steps
- ✅ **Type safety** - TypeScript resolves types across packages instantly
- ✅ **Build orchestration** - Turborepo ensures correct build order
- ✅ **Single Prisma instance** - Peer dependency pattern works correctly
- ✅ **Fast iteration** - Changes in one package immediately available to others
- ✅ **No external tools** - Native npm/pnpm/yarn feature

**Package References:**

All internal packages use the `workspace:*` protocol in their `package.json`:

```json
{
  "dependencies": {
    "@midcurve/shared": "workspace:*",
    "@midcurve/services": "workspace:*",
    "@midcurve/api-shared": "workspace:*"
  }
}
```

**How It Works:**

1. **Root package.json** declares workspaces:
   ```json
   {
     "workspaces": [
       "apps/*",
       "packages/*"
     ]
   }
   ```

2. **npm install** at root creates symlinks:
   - `apps/midcurve-ui/node_modules/@midcurve/shared` → `../../packages/midcurve-shared`
   - `apps/midcurve-ui/node_modules/@midcurve/services` → `../../packages/midcurve-services`

3. **Turborepo** manages build dependencies:
   - Defined in `turbo.json` with `dependsOn` configuration
   - Ensures packages build in correct order
   - Caches builds for fast incremental updates

**Development Workflow:**

```bash
# Install all dependencies (from monorepo root)
npm install

# Build all packages in dependency order
npm run build

# Build specific package
cd packages/midcurve-services
npm run build

# Changes immediately available to dependent packages
# No manual push/pull/link commands needed
```

**Why This Is Better Than External Tools:**

- **No yalc needed** - Workspaces handle linking natively
- **No manual steps** - Just `npm install` and everything works
- **No sync issues** - Changes propagate automatically
- **Standard tooling** - Works with npm, pnpm, and yarn
- **Better IDE support** - TypeScript resolves paths correctly

### 4. Abstraction Strategy for Multi-Platform Support

**Problem:** Different blockchains have fundamentally different architectures:
- **EVM chains** (Ethereum, BSC): Contract addresses, ERC-20 tokens, gas fees
- **Solana**: Program IDs, SPL tokens, accounts, rent-exempt balances

**Solution:** Abstract interface pattern with platform-specific `config` fields

**Pattern:**
```typescript
// Generic interface
interface Token<TConfig> {
  id: string;              // Database-generated
  tokenType: TokenType;    // Discriminator ('evm-erc20', 'solana-spl')
  name: string;            // Universal fields
  symbol: string;
  decimals: number;
  config: TConfig;         // Platform-specific (type-safe!)
  createdAt: Date;
  updatedAt: Date;
}

// Platform-specific configs
interface Erc20TokenConfig {
  address: string;         // 0x... (EIP-55 checksummed)
  chainId: number;         // 1 (Ethereum), 56 (BSC), etc.
}

interface SolanaTokenConfig {
  mint: string;            // Base58 pubkey
  programId?: string;
}

// Type aliases for convenience
type Erc20Token = Token<Erc20TokenConfig>;
type SolanaToken = Token<SolanaTokenConfig>;
type AnyToken = Erc20Token | SolanaToken;
```

**Database Storage:**
- `config` field stored as **PostgreSQL JSON column**
- ✅ Schema flexibility (add new platforms without migrations)
- ✅ Type safety at compile time (TypeScript enforces correct structure)
- ✅ Query capability (PostgreSQL JSON operators allow efficient queries)

**Benefits:**
- ✅ Add new EVM chains instantly (just change `chainId`)
- ✅ Add new platforms (Cosmos, etc.) without breaking changes
- ✅ Type narrowing with discriminated unions
- ✅ Future-proof and extensible

### 5. Distributed Caching with PostgreSQL

**Why PostgreSQL Instead of Redis?**

**The Problem:**
- External APIs (CoinGecko) have strict rate limits (~30 calls/minute)
- Multiple workers/processes/serverless functions need shared cache
- In-memory cache doesn't work across process boundaries

**The Solution:**
- Use existing PostgreSQL database as cache backend
- Cache shared across ALL workers, processes, and serverless functions
- TTL-based expiration with automatic cleanup

**Benefits:**
✅ **Already available** - PostgreSQL runs in all environments
✅ **No new infrastructure** - No Redis hosting fees or management
✅ **Persistent cache** - Survives restarts, deployments, server reboots
✅ **Good enough performance** - 3ms cache vs 200-500ms API call
✅ **Type-safe with Prisma** - Leverage existing Prisma client
✅ **ACID guarantees** - Transactions and consistency built-in

**When Would Redis Be Better?**
- Cache reads > 10,000/second (not our use case)
- Sub-millisecond latency critical (it's not for API caching)
- Ephemeral cache desired (we want persistent)

### 6. Cross-Origin Authentication Architecture

**Why Cross-Origin Architecture?**
- UI (app.midcurve.finance) and API (api.midcurve.finance) are separate applications
- Cross-origin requests require explicit CORS configuration
- Session cookies sent with `credentials: 'include'`
- Cookie `SameSite=None; Secure` for cross-origin cookie sharing

**Authentication Stack:**
1. **Custom Session Middleware** - PostgreSQL-backed session validation
2. **Session Cookies** - HTTPOnly, Secure, SameSite=None (for cross-origin)
3. **CORS Headers** - Via Caddy reverse proxy + Next.js middleware

**Sign-In with Ethereum (SIWE):**
- EIP-4361 standard for wallet-based authentication
- Custom implementation (no NextAuth)
- Nonce generation and signature verification (prevents replay attacks)
- Primary + secondary wallet linking
- Session tokens stored in PostgreSQL with expiration

**Session Management:**
- Sessions stored in PostgreSQL (`Session` table)
- Session cookie: `midcurve_session`
- Cookie attributes: `HTTPOnly`, `Secure`, `SameSite=None`
- Validated on each API request via `withSessionAuth` middleware

**CORS Configuration (Cross-Origin):**

Caddy handles CORS preflight at the edge:
```
# infra/Caddyfile - OPTIONS handled by Caddy
@options method OPTIONS
handle @options {
    header Access-Control-Allow-Origin "https://app.midcurve.finance"
    header Access-Control-Allow-Credentials "true"
    respond 204
}
```

API adds CORS headers to all responses:
```typescript
// apps/midcurve-api/src/lib/cors.ts
{
  'Access-Control-Allow-Origin': 'https://app.midcurve.finance',
  'Access-Control-Allow-Credentials': 'true', // Required for cookies
}
```

**Middleware (`withSessionAuth`):**
- Extracts session cookie from request
- Validates session against PostgreSQL
- Fetches user with linked wallets
- Injects `AuthenticatedUser` into route handler
- Adds CORS headers to response

**Authentication Flow:**
```
┌─────────────────────┐        ┌─────────────────────┐
│  UI (Vite SPA)      │        │  API (Next.js)      │
│  app.midcurve.fin.  │        │  api.midcurve.fin.  │
└─────────┬───────────┘        └──────────┬──────────┘
          │                               │
          │ 1. POST /api/v1/auth/nonce    │
          │ ─────────────────────────────▶│
          │◀───────────────────────────── │
          │    { nonce: "..." }           │
          │                               │
          │ 2. User signs with wallet     │
          │                               │
          │ 3. POST /api/v1/auth/verify   │
          │    { message, signature }     │
          │ ─────────────────────────────▶│
          │◀───────────────────────────── │
          │    Set-Cookie: midcurve_session=xxx
          │    (SameSite=None; Secure)    │
          │                               │
          │ 4. GET /api/v1/positions      │
          │    Cookie: midcurve_session=xxx
          │    credentials: 'include'     │
          │ ─────────────────────────────▶│
          │◀───────────────────────────── │
          │    { data: [...positions] }   │
          │                               │
└─────────┴───────────────────────────────┘
```

## Project Philosophy & Risk Management Approach

Midcurve Finance introduces a fundamentally different approach to understanding and managing risk in concentrated liquidity positions. This philosophy underpins the entire platform architecture and influences how data is modeled, calculated, and presented to users.

### Quote Token vs. Base Token Paradigm

Traditional DeFi platforms refer to tokens by their technical designations (token0, token1) or treat both tokens in a pool symmetrically. Midcurve adopts terminology from traditional finance currency pairs to provide clarity and consistency.

**Key Concepts:**

- **Quote Token** - The token in which position value is measured (the reference currency or "numeraire")
- **Base Token** - The token to which the position has risk exposure (the "asset" being priced)

**User-Defined Assignment:**

Unlike protocol-level designations (token0/token1), the quote/base assignment is **user-defined**:
- Users choose which token to use as their value reference when opening or importing a position
- This choice determines how all metrics are calculated (position value, PnL, fees, risk)
- Users can switch quote/base roles at any time to view the position from different perspectives

**Example:** In an ETH/USDC pool:
- If **USDC is quote**, you measure position value in USDC and track risk exposure to ETH price movements
- If **ETH is quote**, you measure position value in ETH and track risk exposure to USDC price movements (e.g., USD inflation/deflation risk)

**Technical Abstraction:**

The platform hides Uniswap V3's technical token0/token1 terminology from users:
- All UI, metrics, and documentation use quote/base terminology
- token0/token1 mapping happens internally in the services layer
- Users think in terms of "what am I measuring value in?" not "which token has the lower address?"

### Risk Definition: Quote-Token-Denominated Loss

**Risk** in Midcurve is defined precisely as:

> **The risk of loss in quote token value due to fluctuations in the base token's price.**

This definition is visualized through the **PnL curve** of a concentrated liquidity position, which shows three distinct regions:

**PnL Curve Regions (X-axis: Base Token Price | Y-axis: Position Value in Quote Tokens)**

1. **Left Region (Price Below Range):**
   - Position holds **only base tokens**
   - **High risk exposure** to base token price movements
   - Linear relationship: position value = base token amount × current price
   - Easy to hedge with linear short positions (perpetuals, futures)
   - Example: ETH/USDC pool with USDC as quote, price drops below range → holding only ETH → maximum USD value risk

2. **Middle Region (Price Within Range):**
   - Position **automatically rebalances** between base and quote tokens
   - Variable risk exposure that changes as price moves through the range
   - Curved relationship due to continuous rebalancing
   - Accumulating more base tokens as price rises (increasing risk)
   - Accumulating more quote tokens as price falls (decreasing risk)

3. **Right Region (Price Above Range):**
   - Position holds **only quote tokens**
   - **Zero risk exposure** to base token price movements
   - Flat line: position value remains constant regardless of further price increases
   - Example: ETH/USDC pool with USDC as quote, price rises above range → holding only USDC → no further USD value risk

**Key Insight:**

Risk is **directional** and **asymmetric**:
- When price is below range, you have maximum exposure to base token volatility
- When price is in range, you're actively trading (rebalancing) and accumulating the token moving against you
- When price is above range, you've exited your base token position and have zero price risk

This clear, visual definition of risk makes it easy to:
- Understand current risk exposure at a glance
- Plan hedging strategies (linear shorts when below range)
- Set range boundaries based on risk tolerance
- Compare risk across different positions (all in quote token terms)

### Beyond "Impermanent Loss"

Midcurve **abandons** the traditional concept of "impermanent loss" (IL) in favor of the clearer quote-token-denominated risk framework.

**Problems with Traditional IL:**

1. **Ambiguous reference point** - "Loss" relative to what?
   - Holding initial amounts?
   - Holding 50/50 split?
   - In USD value?
   - In token0 or token1 value?

2. **Misleading terminology** - "Impermanent" suggests the loss disappears if price returns, but:
   - Fees may or may not offset the loss
   - Time value of capital is ignored
   - Opportunity cost is unclear

3. **No clear risk metric** - IL doesn't tell you:
   - Your current position value
   - Your risk exposure going forward
   - How to hedge effectively

**Midcurve's Approach:**

Instead of comparing to hodling strategies, Midcurve provides **one clear metric**:

> **Current position value in quote token units**

This single number tells you:
- ✅ What your position is worth right now (in your reference currency)
- ✅ How much quote-denominated value you have at risk
- ✅ Whether fee income is adding to or subtracting from your quote token wealth

**No Hodling Comparisons:**

The platform does **not** show:
- ❌ "Loss vs. hodling initial deposit"
- ❌ "Loss vs. hodling 50/50"
- ❌ "Impermanent loss percentage"

**Why?** Because these metrics conflate two fundamentally different investment strategies:
1. **Hodling** = Betting on asset value appreciation
2. **CL Provisioning** = Generating cash flow from trading activity

Mixing these creates confusion. Midcurve keeps them separate.

### Cash Flow Measurement

All fee income and rewards are measured in **quote token units** to provide consistent, comparable cash flow tracking.

**Conversion Rules:**

- **Quote token fees** - Already in the correct unit, no conversion needed
- **Base token fees** - Converted to quote token value **at the time of collection** (claiming)
- **Rewards** - Converted to quote token value at collection time

**Collection Time Pricing:**

Using the price at collection time (not current price, not position open price) provides:
- ✅ Accurate realized cash flow (what you actually received in quote terms)
- ✅ No retroactive adjustments (cash flow is locked in when claimed)
- ✅ Clear accounting (sum of all collections = total quote-denominated cash flow)

**Example (ETH/USDC pool, USDC as quote):**

1. Position earns 0.1 ETH + 100 USDC in fees
2. User claims fees when ETH = $2,000
3. Recorded cash flow: **$300 USDC equivalent**
   - 0.1 ETH × $2,000 = $200
   - 100 USDC = $100
   - Total = $300

If ETH later rises to $3,000, the cash flow record stays $300 (not adjusted). The user received that amount in quote-equivalent value at claim time.

### Investment Philosophy: Yield vs. Value Appreciation

Midcurve draws a clear distinction between two fundamentally different investment strategies:

**Strategy 1: Hodling (Value Appreciation)**
- Investment thesis: Base token will appreciate in quote token terms
- Return source: Capital gains from price movement
- Risk: Base token depreciates relative to quote token
- Time horizon: Typically longer-term
- Management: Passive (no rebalancing)

**Strategy 2: CL Provisioning (Cash Flow Generation)**
- Investment thesis: Trading volume will generate fees exceeding risk-adjusted losses
- Return source: Fee income from providing liquidity
- Risk: Base token exposure offsets fee income (measured in quote tokens)
- Time horizon: Can be short or long-term
- Management: Active (continuous rebalancing by AMM)

**Key Insight:**

These strategies are **not comparable** - they have different objectives, risk profiles, and return sources. Comparing CL returns to "hodling" is like comparing:
- A rental property (cash flow) to a growth stock (appreciation)
- Running a market-making business to buying and holding inventory

**Midcurve's Position:**

The platform treats CL provisioning as a **cash flow generation strategy** with measurable risk exposure:

1. **Position value** (in quote tokens) - Your current capital base
2. **Fee income** (in quote tokens) - Your cumulative cash flow
3. **Risk exposure** - Your current base token holdings and price sensitivity

Success is measured by:
- ✅ **Total cash flow generated** (in quote tokens)
- ✅ **Risk-adjusted returns** (cash flow relative to risk exposure)
- ✅ **Capital efficiency** (returns relative to capital deployed)

Not by:
- ❌ Performance vs. hodling
- ❌ "Making up" for impermanent loss
- ❌ Predicting future base token prices

This framework allows users to:
- Make informed decisions about range selection (risk tolerance)
- Evaluate CL positions as a business (yield on capital)
- Understand exactly what they're exposed to (base token price risk)
- Separate yield farming from directional trading strategies

---

## For Developers

### Working on Specific Packages?

Jump to package-specific implementation documentation:

**📦 [@midcurve/shared](packages/midcurve-shared/README.md)** - Domain Types & Utilities
- Core type definitions (Token, Pool, Position, User)
- EVM address utilities
- UniswapV3 math functions
- Framework-agnostic, zero dependencies

**🔧 [@midcurve/services](packages/midcurve-services/CLAUDE.md)** - Business Logic Implementation
- Service layer APIs (TokenService, Erc20TokenService)
- Testing patterns and fixtures (121+ tests)
- EVM utilities and on-chain data reading
- Distributed caching implementation (PostgreSQL)
- Database schema (Prisma)

**📋 [@midcurve/api-shared](packages/midcurve-api-shared/README.md)** - API Types & Schemas
- Request/response types for all endpoints
- Zod validation schemas
- Protocol-agnostic vs protocol-specific organization
- BigInt serialization utilities
- Framework-agnostic, works in browsers and Node.js

**🌐 [midcurve-ui](apps/midcurve-ui/CLAUDE.md)** - Vite SPA Frontend
- React 19 + TailwindCSS 4.0
- RainbowKit wallet connection
- React Query for server state
- Docker deployment with nginx

---

## Supported Platforms

### Ethereum Virtual Machine (EVM)

Currently supported chains:

| Chain | Chain ID | RPC Env Var | Block Explorer |
|-------|----------|-------------|----------------|
| **Ethereum** | 1 | `RPC_URL_ETHEREUM` | etherscan.io |
| **Arbitrum One** | 42161 | `RPC_URL_ARBITRUM` | arbiscan.io |
| **Base** | 8453 | `RPC_URL_BASE` | basescan.org |
| **BNB Smart Chain** | 56 | `RPC_URL_BSC` | bscscan.com |
| **Polygon** | 137 | `RPC_URL_POLYGON` | polygonscan.com |
| **Optimism** | 10 | `RPC_URL_OPTIMISM` | optimistic.etherscan.io |

**Supported DEX Protocols:**
- Uniswap V3 (Ethereum, Arbitrum, Base, Polygon, Optimism)
- PancakeSwap V3 (BSC)
- Future: QuickSwap, Velodrome

### Solana (Future)

Planned support:
- Orca (concentrated liquidity pools)
- Raydium (high-performance AMM)

### Non-EVM Chains (Future)

Extensible to:
- Cosmos ecosystem
- Other non-EVM L1s

---

## Development Setup

### Prerequisites

1. **Node.js 20+** installed
2. **pnpm 9+** installed (`corepack enable && corepack prepare pnpm@9 --activate`)
3. **PostgreSQL 15+** database running
4. **Docker & Docker Compose** (for production-like local development)
5. **Git** for version control

### Initial Setup

```bash
# Clone the monorepo
git clone https://github.com/0xNedAlbo/midcurve-finance.git
cd midcurve-finance

# Install all dependencies at once (from root)
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with DATABASE_URL, RPC URLs, and other config

# Generate Prisma client
pnpm --filter @midcurve/database db:generate

# Build all packages in dependency order
pnpm build

# Start development servers
pnpm dev  # Runs all services in parallel
```

**What Happens During `pnpm install`:**
1. Installs dependencies for all packages (apps/*, packages/*)
2. Creates workspace symlinks (automatic package linking)
3. Turborepo sets up build cache
4. Prisma client generated via prepare script

### Environment Variables

**Required (all services):**
```bash
DATABASE_URL="postgresql://devuser:devpass@localhost:5432/midcurve_dev"
NODE_ENV="development"
```

**UI (Vite - build-time variables):**
```bash
VITE_API_URL="http://localhost:3001"
VITE_WALLETCONNECT_PROJECT_ID="your-walletconnect-project-id"
```

**API (Next.js - runtime variables):**
```bash
SESSION_SECRET="your-32-char-secret"  # openssl rand -base64 32
ALLOWED_ORIGINS="http://localhost:3000,http://localhost:5173"
RPC_URL_ETHEREUM="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
RPC_URL_ARBITRUM="https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY"
ETHERSCAN_API_KEY="your-etherscan-key"
THE_GRAPH_API_KEY="your-graph-key"
COINGECKO_API_KEY="your-coingecko-key"
```

**Signer Service:**
```bash
SIGNER_INTERNAL_API_KEY="your-internal-key"
SIGNER_USE_LOCAL_KEYS="true"
SIGNER_KEY_ENCRYPTION_PASSWORD="your-encryption-password"
```

**EVM Orchestrator:**
```bash
CORE_PRIVATE_KEY="your-deployer-private-key"
CORE_ADDRESS="your-deployer-address"
GETH_HTTP_URL="http://localhost:8555"
GETH_WS_URL="ws://localhost:8556"
RABBITMQ_URL="amqp://guest:guest@localhost:5672"
```

### Development Workflow

**Working on packages (shared, services, api-shared, database):**
```bash
cd packages/midcurve-shared
# Make changes to src/
pnpm build  # Dependent packages pick up changes via workspace
pnpm test   # Run tests
```

**Working on UI (Vite SPA):**
```bash
cd apps/midcurve-ui
pnpm dev  # Vite dev server on http://localhost:3000
# Hot module replacement enabled
```

**Working on API:**
```bash
cd apps/midcurve-api
pnpm dev  # Next.js dev server on http://localhost:3001
```

**Database migrations:**
```bash
cd packages/midcurve-database
# Edit prisma/schema.prisma
pnpm db:migrate:dev --name your_migration_name

# Schema changes immediately available via workspace linking
```

**Building All Packages:**
```bash
# From monorepo root - builds in dependency order
pnpm build

# Turborepo parallelizes where possible and caches builds
# Only rebuilds changed packages
```

### Testing

**Packages:**
```bash
# From any package directory
pnpm test              # Watch mode
pnpm test:run          # Single run
pnpm test:coverage     # With coverage
```

**Run All Tests:**
```bash
# From monorepo root - runs tests in parallel
pnpm test
```

---

## Deployment

### Docker Compose (Production)

The primary deployment method is Docker Compose with a multi-service architecture.

**Prerequisites:**
- Docker & Docker Compose v2
- External PostgreSQL database (AWS RDS recommended)
- Domain names configured (app.midcurve.finance, api.midcurve.finance)
- Environment variables in `.env`

**Service Overview:**
```
┌─────────────────────────────────────────────────────────────┐
│                    docker-compose.yml                        │
├─────────────────────────────────────────────────────────────┤
│  caddy         │ Reverse proxy, SSL termination (80/443)    │
│  ui            │ Vite SPA + nginx (3000)                    │
│  api           │ Next.js REST API (3001)                    │
│  pool-prices   │ WebSocket pool price subscriptions         │
│  automation    │ Order execution (3004)                     │
│  signer        │ Transaction signing (3003)                 │
│  rabbitmq      │ Message broker (5672/15672)                │
└─────────────────────────────────────────────────────────────┘
```

**Deployment Steps:**

```bash
# 1. Clone repository
git clone https://github.com/0xNedAlbo/midcurve-finance.git
cd midcurve-finance

# 2. Create environment file
cp .env.example .env
# Edit .env with all required values

# 3. Build and start services
docker compose up -d --build

# 4. Apply database migrations
docker compose exec api npx prisma migrate deploy

# 5. Verify health
curl https://api.midcurve.finance/api/health
```

**Environment Variables (.env):**

```bash
# Database (AWS RDS)
DATABASE_URL="postgresql://user:pass@your-rds.amazonaws.com:5432/midcurve"

# UI (build-time - passed as ARG in docker-compose)
VITE_API_URL="https://api.midcurve.finance"
VITE_WALLETCONNECT_PROJECT_ID="your-project-id"

# API
SESSION_SECRET="your-production-secret"
ALLOWED_ORIGINS="https://app.midcurve.finance"
RPC_URL_ETHEREUM="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
RPC_URL_ARBITRUM="https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY"
ETHERSCAN_API_KEY="your-etherscan-key"
THE_GRAPH_API_KEY="your-graph-key"
COINGECKO_API_KEY="your-coingecko-key"

# Signer (internal service)
SIGNER_INTERNAL_API_KEY="your-32-char-hex-key"
SIGNER_USE_LOCAL_KEYS="true"
SIGNER_LOCAL_ENCRYPTION_KEY="your-encryption-key"

# RabbitMQ
RABBITMQ_USER="midcurve"
RABBITMQ_PASS="your-rabbitmq-password"
```

**Caddy Configuration (infra/Caddyfile):**

```
# Auto-HTTPS with Let's Encrypt
app.midcurve.finance {
    reverse_proxy ui:3000
}

api.midcurve.finance {
    # CORS preflight
    @options method OPTIONS
    handle @options {
        header Access-Control-Allow-Origin "https://app.midcurve.finance"
        header Access-Control-Allow-Credentials "true"
        respond 204
    }

    reverse_proxy api:3001
}
```

**Service Dependencies:**
- `api` depends on: PostgreSQL (external), signer, automation
- `automation` depends on: rabbitmq, pool-prices, signer
- `pool-prices` depends on: rabbitmq, PostgreSQL
- `signer` depends on: (standalone)
- `ui` depends on: (standalone, calls api via Caddy)

**Useful Commands:**

```bash
# View logs
docker compose logs -f api
docker compose logs -f automation

# Restart a service
docker compose restart api

# Rebuild and restart
docker compose up -d --build api

# Apply migrations
docker compose exec api npx prisma migrate deploy

# Access Prisma Studio
docker compose exec api npx prisma studio

# Shell into container
docker compose exec api sh
```

### PostgreSQL (Database)

**Production Recommendations:**
- Managed PostgreSQL (AWS RDS recommended)
- Connection pooling via RDS Proxy or PgBouncer
- Automated backups enabled
- Monitoring (CloudWatch for RDS)

**Cache Table Maintenance:**
- Cache table grows over time
- Run periodic cleanup: `CacheService.getInstance().cleanup()`
- Consider scheduled Lambda or cron job

### Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| 502 Bad Gateway | Next.js binding to localhost | Add `HOSTNAME=0.0.0.0` to service |
| CORS errors | Preflight not handled | Check Caddyfile OPTIONS handler |
| 500 on API calls | Missing env var | Check `docker compose logs api` |
| Session not persisting | SameSite cookie issue | Ensure HTTPS and `Secure` cookie |
| Migrations fail | DB connection | Verify DATABASE_URL is correct |

---

## Project Roadmap

### ✅ Phase 1: Foundation (Completed)

**@midcurve/shared:**
- ✅ Core type system with discriminated unions
- ✅ EVM address utilities
- ✅ UniswapV3 math utilities
- ✅ 107 tests with 100% coverage

**@midcurve/services:**
- ✅ Token service with CRUD operations
- ✅ ERC-20 token discovery from on-chain data
- ✅ PostgreSQL-based distributed cache
- ✅ CoinGecko client with caching
- ✅ EVM configuration for 6 chains
- ✅ 121+ tests with 100% coverage
- ✅ Peer dependency pattern for Prisma

**@midcurve/api-shared:**
- ✅ Extracted all API types from midcurve-api
- ✅ 37 type files with 100+ exports
- ✅ Protocol-agnostic position types (common/)
- ✅ Protocol-specific position types (uniswapv3/)
- ✅ Zod validation schemas for all endpoints
- ✅ ESM + CJS builds with tsup
- ✅ Comprehensive documentation (README.md)
- ✅ Workspace-based local development

**@midcurve/ui:**
- ✅ Next.js 15 + App Router setup
- ✅ Unified frontend + backend architecture
- ✅ Health check endpoint
- ✅ SIWE authentication (Auth.js v5)
- ✅ API key management
- ✅ Dual authentication middleware
- ✅ User management endpoints (8 endpoints total)
- ✅ Token, Pool, Position endpoints
- ✅ NFT import functionality
- ✅ Position list UI with wallet integration
- ✅ Migrated to use @midcurve/api-shared
- ✅ Docker Compose deployment configuration
- ✅ pnpm workspaces integration
- ✅ Playwright E2E tests (33 tests)
- ✅ Vitest API E2E tests

### 🔄 Phase 2: Core Features (In Progress)

**API Endpoints:**
- Token endpoints (search, create, enrich)
- Pool endpoints (discover, get pool data, pricing)
- Position endpoints (list, discover, import)

**Services:**
- Pool service (discovery, state management)
- Position service (tracking, PnL, APR calculations)
- Risk calculation algorithms

**Infrastructure:**
- Logging middleware (Pino)
- Rate limiting (Redis or PostgreSQL)
- Error tracking (Sentry)

### 🔮 Phase 3: Advanced Features (Future)

**Position Management:**
- Automated rebalancing execution
- Fee collection optimization
- Impermanent loss tracking
- Gas optimization strategies

**Analytics:**
- Historical performance analytics
- Risk metrics and dashboards
- APR/APY calculations
- Portfolio aggregation

**Multi-Platform:**
- Solana DEX support (Orca, Raydium)
- Additional EVM chains
- Cross-chain position management

### 🔮 Phase 4: Advanced UI Features (Future)

**UI Enhancements:**
- Position detail views with charts
- Risk analytics visualizations
- Portfolio dashboard with aggregated metrics
- Advanced rebalancing strategies UI
- Gas optimization settings
- Historical performance analytics

**Backend Enhancements:**
- Real-time position tracking with WebSockets
- Advanced risk calculation algorithms
- Automated rebalancing execution
- Fee optimization strategies

---

## Code Style & Best Practices

### TypeScript
- ✅ **Strict mode** enabled in all projects
- ✅ **ESM modules** (import/export, no require)
- ✅ **Explicit types** (no implicit `any`)
- ✅ **Discriminated unions** for type narrowing
- ✅ **Async/await** (no callbacks)

### Testing
- ✅ **Vitest** for all testing
- ✅ **Arrange-Act-Assert** pattern
- ✅ **Mock external dependencies** (Prisma, network calls)
- ✅ **Test fixtures** for reusable test data
- ✅ **Type-safe mocks** with vitest-mock-extended

### Error Handling
- ✅ **Try/catch** for async operations
- ✅ **Standardized error codes** across API
- ✅ **Clear error messages** for users
- ✅ **Error details** for debugging

### Documentation
- ✅ **CLAUDE.md** in each repo (architecture + implementation details)
- ✅ **README.md** for user-facing docs
- ✅ **JSDoc comments** for public APIs
- ✅ **Self-documenting code** with clear types

---

## Key Design Decisions

### 1. Why PostgreSQL for Caching (Not Redis)?

**Rationale:**
- PostgreSQL already running in all environments
- No additional infrastructure or costs
- Persistent cache survives restarts
- 3ms vs 1ms lookup negligible compared to 200-500ms API calls
- ACID guarantees and type safety with Prisma

### 2. Why Peer Dependencies for Prisma?

**Rationale:**
- Ensures single Prisma client instance (no duplication)
- Consumer controls Prisma version
- Services layer is portable across multiple consumers
- Prevents "multiple Prisma clients" errors

### 3. Why npm Workspaces (Not npm link)?

**Rationale:**
- Native npm feature (no external tools needed)
- Automatic symlink creation (no manual linking)
- Works reliably with peer dependencies (single Prisma instance)
- Turborepo handles build orchestration and caching
- Standard tooling across npm, pnpm, and yarn
- Better IDE support and TypeScript resolution

### 4. Why Import Types from @midcurve/shared (Not Prisma)?

**Rationale:**
- Shared types are portable (work in browsers, Node.js, edge)
- No Prisma dependency coupling
- Framework-agnostic
- Single source of truth for all consumers
- Future-proof for type extraction to `@midcurve/api-types`

### 5. Why Extract API Types to @midcurve/api-shared?

**Rationale:**
- UI and workers can import exact API types (type-safe client code)
- Zod schemas available for client-side form validation
- Independent versioning and publishing
- Protocol-agnostic design supports multiple DEX protocols
- Clear separation: domain types (@midcurve/shared) vs API contracts (@midcurve/api-shared)
- Tree-shakeable exports for optimal bundle size

### 6. Why Protocol-Agnostic vs Protocol-Specific Organization?

**Rationale:**
- Protocol-agnostic types (positions/common/) work across ALL DEX protocols
- Protocol-specific types (positions/uniswapv3/) tied to implementation details
- Easy to add Orca, Raydium without refactoring existing code
- Clear boundaries between generic and specialized functionality
- Future-proof architecture for multi-protocol support

### 7. Why Separate UI and API (Multi-Service Architecture)?

**Problem:** A unified Next.js app combining UI and API became difficult to scale and deploy independently. Different concerns (static assets vs dynamic API) benefited from different technologies.

**Current Architecture:**
- **UI** - Vite SPA served by nginx (fast static hosting)
- **API** - Next.js standalone server (serverless-friendly, but deployed as container)
- **Cross-origin** - UI at `app.midcurve.finance`, API at `api.midcurve.finance`

**Rationale:**
- **Independent scaling** - UI and API have different resource needs
- **Technology fit** - Vite for fast builds, Next.js for API routing
- **Deployment flexibility** - Static CDN for UI, container for API
- **Clear boundaries** - Frontend team vs backend team (future)
- **Better caching** - Static assets cached at edge (nginx/CDN)

**Cross-Origin Authentication Solution:**
```
┌──────────────────┐        ┌──────────────────┐
│  app.midcurve.   │        │  api.midcurve.   │
│  (Vite SPA)      │        │  (Next.js API)   │
└────────┬─────────┘        └────────┬─────────┘
         │                           │
         │  1. Request with          │
         │     credentials: 'include'│
         ├──────────────────────────▶│
         │                           │
         │  2. Response with:        │
         │     Set-Cookie (SameSite=None; Secure)
         │     Access-Control-Allow-Credentials: true
         │◀──────────────────────────┤
         │                           │
```

**Key Requirements for Cross-Origin Cookies:**
- ✅ HTTPS required (cookies with `Secure` flag)
- ✅ `SameSite=None` on cookies (allows cross-origin)
- ✅ `credentials: 'include'` in fetch requests
- ✅ `Access-Control-Allow-Credentials: true` header
- ✅ Explicit `Access-Control-Allow-Origin` (not `*`)
- ✅ Caddy handles CORS preflight (OPTIONS) at edge

---

## UI Migration Guidelines

When migrating features from the legacy `midcurve-finance-legacy` project to the new `midcurve-ui` frontend, follow these architectural principles:

### 1. English-Only Frontend (No i18n)

**Rule:** The new UI is English-only with no internationalization support.

**Migration Pattern:**
- ❌ **Remove** all `next-intl` dependencies and `useTranslations()` hooks
- ❌ **Remove** settings stores for locale management
- ✅ **Hardcode** English text directly in components
- ✅ **Extract** strings from legacy `messages/en.json` and inline them

**Example Transformation:**
```typescript
// Legacy (with i18n)
import { useTranslations } from "@/app-shared/i18n/client";

function Component() {
  const t = useTranslations();
  return <h1>{t("dashboard.title")}</h1>;
}

// New UI (English only)
function Component() {
  return <h1>Your Positions</h1>;
}
```

**Rationale:**
- Simplifies frontend architecture
- Reduces bundle size and dependencies
- Faster development iteration
- English is sufficient for initial launch
- i18n can be added later if needed with a proper i18n service

---

### 2. Backend-First Architecture (No RPC URLs in Frontend)

**Rule:** Frontend code never accesses RPC endpoints or external APIs directly. All blockchain data flows through the backend API routes.

**Architecture:**
```
┌──────────────────────┐         ┌───────────────────────┐
│   midcurve-ui        │         │   midcurve-api        │
│   (Vite SPA)         │         │   (Next.js API)       │
│   app.midcurve.fin.  │         │   api.midcurve.fin.   │
│                      │ HTTPS   │                       │
│ ❌ No RPC URLs       │────────▶│ ✅ Has RPC URLs       │───▶ Blockchain
│ ❌ No API Keys       │ cross-  │ ✅ Has API Keys       │     (Ethereum)
│ ✅ VITE_API_URL      │ origin  │ ✅ Database access    │
└──────────────────────┘         └───────────────────────┘
```

**Migration Pattern:**

**Frontend Code (src/components, src/hooks, src/pages):**
- ❌ **No** chain RPC configuration
- ❌ **No** direct viem/wagmi reads from blockchain
- ❌ **No** `RPC_URL_*` environment variables in frontend code
- ✅ **Only** HTTP calls via `apiClient` to API (cross-origin)
- ✅ **Only** `VITE_API_URL` environment variable (build-time)
- ✅ **Wagmi/RainbowKit** for wallet connection and transaction signing only

**Backend Code (midcurve-api/src/app/api):**
- ✅ **Has** all RPC URLs and API keys
- ✅ **Handles** all blockchain reads
- ✅ **Exposes** data via REST endpoints

**Environment Variables:**

```bash
# UI (.env) - Build-time only
VITE_API_URL=https://api.midcurve.finance
VITE_WALLETCONNECT_PROJECT_ID=...

# API (.env) - Runtime secrets
DATABASE_URL=postgresql://...
RPC_URL_ETHEREUM=https://...
RPC_URL_ARBITRUM=https://...
COINGECKO_API_KEY=...
SESSION_SECRET=...
```

**Read vs Write Operations:**

| Operation | Where It Happens | Example |
|-----------|------------------|---------|
| **Read** (Position data, pool info, token prices) | Backend API routes → Frontend displays | `GET /api/v1/positions/list` |
| **Write** (Sign tx, approve tokens, open position) | User wallet → Frontend submits | User signs with MetaMask |

**Configuration Files:**

```typescript
// ❌ Legacy: Frontend had full chain config with RPC URLs
export const CHAIN_CONFIGS = {
  ethereum: {
    rpcUrl: process.env.RPC_URL_ETHEREUM, // ❌ NO!
    explorer: 'https://etherscan.io',
  }
}

// ✅ New: Frontend has minimal metadata (no secrets)
export const CHAIN_METADATA = {
  ethereum: {
    name: 'Ethereum',
    chainId: 1,
    explorer: 'https://etherscan.io', // Public URL, safe to expose
  }
}
```

**Benefits:**
- ✅ **Security** - No RPC URLs or API keys exposed in frontend bundle
- ✅ **Rate limiting** - Backend controls API usage across all users
- ✅ **Caching** - Backend can cache RPC responses efficiently
- ✅ **Cost control** - Single point for managing external API costs
- ✅ **Simpler frontend** - No RPC provider management, just HTTP calls
- ✅ **Better errors** - Backend can normalize errors from different RPC providers

**What Frontend Still Needs Wagmi For:**
- Wallet connection (RainbowKit UI)
- SIWE authentication (signing messages)
- Transaction submission (user must sign with their private key)
- Token approvals (ERC-20 approve calls)

---

### 3. UI/UX Coding Standards

**Cursor Pointer Rule:**

All interactive elements must include `cursor-pointer` class for proper UX feedback.

**Apply to:**
- ✅ Buttons (even with `<button>` tag)
- ✅ Clickable `<span>` or `<div>` elements
- ✅ Menu items (dropdown, navigation)
- ✅ Cards or tiles that are clickable
- ✅ Links styled as buttons
- ✅ Any element with `onClick` handler

**Example:**
```tsx
// ✅ Correct - has cursor-pointer
<button className="px-4 py-2 bg-blue-600 rounded cursor-pointer">
  Click me
</button>

<span
  onClick={handleClick}
  className="text-blue-400 hover:text-blue-300 cursor-pointer"
>
  Clickable text
</span>

// ❌ Wrong - missing cursor-pointer
<button className="px-4 py-2 bg-blue-600 rounded">
  Click me
</button>
```

**Rationale:**
- Provides clear visual feedback that element is interactive
- Improves user experience and accessibility
- Consistent behavior across all interactive elements
- Native `<button>` elements get pointer cursor by default, but styled divs/spans don't

---

## Getting Help

### Documentation
- **Architecture:** This file (CLAUDE.md at monorepo root)
- **Services:** [midcurve-services/CLAUDE.md](midcurve-services/CLAUDE.md)
- **API Shared:** [midcurve-api-shared/README.md](midcurve-api-shared/README.md)
- **Shared:** [midcurve-shared/README.md](midcurve-shared/README.md)
- **UI Testing:** [midcurve-ui/tests/README.md](midcurve-ui/tests/README.md)

### Common Issues

**Issue:** "Multiple Prisma clients detected"
**Solution:** Ensure services uses peer dependency, UI installs `@prisma/client` directly

**Issue:** "Schema out of sync after services update"
**Solution:** Run `npm install` in UI app to trigger postinstall (syncs schema + generates client)

**Issue:** "Package changes not reflected"
**Solution:** Build the package (`npm run build`) - workspace symlinks make changes immediately available

**Issue:** "RPC URL not configured"
**Solution:** Add `RPC_URL_<CHAIN>` to `.env` file in UI repo

**Issue:** "Authentication failed when calling API"
**Solution:** UI and API are unified in same app, ensure session cookies are working

**Issue:** "CoinGecko rate limit"
**Solution:** Cache service should prevent this; check cache table for issues

---

## Contributing

### Git Repository Management

**✅ Single Turborepo Monorepo**

This project uses a **single git repository** at the root level with Turborepo for build orchestration.

- ✅ **Root directory HAS a git repository** (`/Users/job/Documents/Programmieren/midcurve-finance/.git`)
- ✅ **All packages tracked in one repository** (apps/*, packages/*)
- ✅ **Atomic commits across multiple packages** possible
- ✅ **Shared tooling and CI/CD** configuration

**Repository:**
- GitHub: https://github.com/0xNedAlbo/midcurve-finance.git
- Branch: `main`

**Why Single Repo?**
- Simplified dependency management with Turborepo
- Atomic commits across multiple packages
- Shared tooling and CI/CD configuration
- Easier local development with automatic package linking
- Single source of truth for the entire codebase

### Git Workflow
1. **Work from the root directory** (`/Users/job/Documents/Programmieren/midcurve-finance/`)
2. Create feature branch from `main`
3. Make changes in appropriate package(s) (apps/* or packages/*)
4. Write tests for new functionality
5. Run type checks and tests
6. Commit with clear, descriptive messages (affects all modified packages)
7. Push and create pull request

### Commit Message Format
```
feat: implement SIWE authentication

- Add Auth.js v5 configuration
- Create 8 authentication endpoints
- Implement dual auth middleware
- Add wallet linking support

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Pull Request Checklist
- [ ] All tests pass
- [ ] Type checking passes
- [ ] Documentation updated (if needed)
- [ ] CLAUDE.md updated (if architecture changed)
- [ ] No secrets committed (.env in .gitignore)

---

## License

MIT License - Midcurve Finance

---

**Midcurve Finance** - Professional risk management for concentrated liquidity providers
