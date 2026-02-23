# Midcurve Finance - Architecture

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
│  │  │   midcurve-api          │  │   midcurve-onchain-data │       │
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
│  │  ┌─────────────────────────┐  ┌─────────────────────────┐       │
│  │  │   midcurve-business-    │  │   rabbitmq              │       │
│  │  │   logic                 │  │   Port 5672             │       │
│  │  │   Event Processing      │  │   Message broker        │       │
│  │  │   Scheduled Rules       │  │   RabbitMQ 3.13         │       │
│  │  └─────────────────────────┘  └─────────────────────────┘       │
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
- **Message queue** - RabbitMQ for on-chain events and automation
- **Event-driven** - onchain-data publishes events, business-logic and automation consume them

## Repository Structure

```
midcurve-finance/
├── apps/
│   ├── midcurve-ui/              # Vite SPA - React frontend
│   ├── midcurve-api/             # Next.js REST API backend
│   ├── midcurve-automation/      # Price monitoring & order execution
│   ├── midcurve-onchain-data/    # Real-time blockchain event subscriptions
│   ├── midcurve-business-logic/  # Event-driven rules & scheduled tasks
│   ├── midcurve-signer/          # Transaction signing service
│   └── midcurve-contracts/       # Solidity smart contracts (Foundry)
├── packages/
│   ├── midcurve-shared/          # @midcurve/shared - Domain types & utilities
│   ├── midcurve-services/        # @midcurve/services - Business logic
│   ├── midcurve-api-shared/      # @midcurve/api-shared - API types & schemas
│   └── midcurve-database/        # @midcurve/database - Prisma schema & ORM
├── infra/
│   └── Caddyfile                 # Reverse proxy configuration
├── docker-compose.yml            # Production orchestration
├── turbo.json                    # Turborepo configuration
├── package.json                  # Workspace configuration (pnpm)
└── CLAUDE.md                     # AI coding instructions
```

**Git Repository Architecture:**

This is a **Turborepo monorepo** with a **single git repository** at the root level.

- Single git repository at the root
- All packages tracked together in one repository
- Turborepo manages builds and dependencies across packages
- pnpm workspaces handle package linking (apps/*, packages/*)

**Repository:**
- GitHub: https://github.com/0xNedAlbo/midcurve-finance.git
- Branch: `main`

## Package Roles & Responsibilities

### @midcurve/shared - Pure Types & Utilities

**Location:** `packages/midcurve-shared/`

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
- Zero dependencies on databases or services
- Framework-agnostic (works in browser, Node.js, edge runtimes)
- Pure TypeScript types and functions
- Discriminated unions for type safety
- Generic interfaces for flexibility

**Documentation:** See [packages/midcurve-shared/README.md](../packages/midcurve-shared/README.md)

---

### @midcurve/services - Business Logic Layer

**Location:** `packages/midcurve-services/`

**Purpose:** Implements core business logic, database operations, and service layers.

**Consumed by:**
- API (REST endpoints)
- Workers (Background processors)

**Contains:**
- **Services:**
  - `TokenService` - Generic token CRUD operations
  - `Erc20TokenService` - ERC-20 specialized service with on-chain discovery

- **Clients:**
  - `CoinGeckoClient` - Token enrichment with distributed caching

- **Cache:**
  - `CacheService` - PostgreSQL-based distributed cache (shared across workers/serverless functions)

- **Config:**
  - `EvmConfig` - RPC endpoint management for all EVM chains
  - Chain configuration and public client creation

- **Utilities:**
  - ERC-20 contract readers (requires viem and RPC access)
  - APR calculation utilities
  - Request scheduling and rate limiting

**Key Characteristics:**
- Distributed caching via PostgreSQL (no Redis required)
- Address normalization for EVM chains (EIP-55 checksumming)
- Multi-chain support (Ethereum, Arbitrum, Base, BSC, Polygon, Optimism)

**Documentation:** See [packages/midcurve-services/CLAUDE.md](../packages/midcurve-services/CLAUDE.md)

---

### @midcurve/api-shared - API Types & Schemas

**Location:** `packages/midcurve-api-shared/`

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
  - `BigIntToString<T>` - Transform bigint -> string for JSON

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
- Type-safe API contracts - Request/response shapes for all endpoints
- Protocol-agnostic design - Supports multiple DEX protocols
- Framework-agnostic - Works in browsers, Node.js, edge runtimes
- Zero runtime dependencies - Only peer deps (zod, @midcurve/shared)
- Tree-shakeable - Granular exports for optimal bundle size

**Documentation:** See [packages/midcurve-api-shared/README.md](../packages/midcurve-api-shared/README.md)

---

### @midcurve/database - Prisma Schema & ORM

**Location:** `packages/midcurve-database/`

**Purpose:** Centralized database schema definition and Prisma client generation.

**Consumed by:**
- API (midcurve-api)
- Automation service (midcurve-automation)
- Onchain data service (midcurve-onchain-data)
- Business logic service (midcurve-business-logic)
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
- Single source of truth - All services use the same schema
- Centralized migrations - Run once, applied everywhere
- Type-safe queries - Generated TypeScript types
- PostgreSQL - JSON columns for flexible config storage

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
- Pure SPA - No server-side rendering
- Cross-origin API calls - Uses `apiClient` with `credentials: 'include'`
- Type safety - Imports types from @midcurve/api-shared
- Wallet integration - RainbowKit for connection, Wagmi for transactions
- Build-time env vars - `VITE_API_URL`, `VITE_WALLETCONNECT_PROJECT_ID`

**Directory Structure:**
```
midcurve-ui/
├── src/
│   ├── components/           # React components
│   ├── hooks/                # React Query hooks
│   ├── lib/                  # api-client, wagmi-config
│   ├── pages/                # Route components
│   ├── providers/            # React context providers
│   ├── config/               # App configuration
│   ├── abis/                 # Contract ABIs
│   ├── styles/               # Global styles
│   └── utils/                # Helper functions
├── public/                   # Static assets
├── nginx.conf                # Production server config
├── Dockerfile                # Multi-stage build
└── vite.config.ts            # Vite configuration
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
- Session-based auth - Custom session middleware with cookies
- API key support - Bearer token authentication for programmatic access
- CORS handling - Via Next.js middleware
- Structured logging - Pino with request IDs
- Standalone output - Optimized for Docker deployment

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
- Network isolated - Only accessible on backend network
- Key encryption - Never stores plaintext keys
- Audit logging - All signing operations logged

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
- **RabbitMQ** - Event-driven order processing
- **MidcurveSwapRouter** - On-chain DEX aggregator for post-close token swaps

**Components:**
- **Price Monitor Worker** - Consumes RabbitMQ pool price events, detects trigger conditions
- **Order Executor Worker** - Executes close orders via Diamond proxy contract

**Key Characteristics:**
- Event-driven - RabbitMQ for async processing
- Atomic execution - Diamond proxy contract closes position in one tx
- Slippage protection - Configurable minimum amounts
- Multi-chain - Deployed on all supported EVM chains

**Directory Structure:**
```
midcurve-automation/
├── src/
│   ├── app/api/              # Health check, worker status endpoints
│   ├── workers/              # Price monitor, order executor
│   ├── clients/              # Signer, tx broadcaster
│   ├── mq/                   # RabbitMQ connection management
│   ├── lib/                  # Utilities
│   └── types/                # TypeScript types
├── Dockerfile
└── next.config.ts
```

---

### @midcurve/onchain-data - Real-Time Blockchain Event Subscriptions

**Location:** `apps/midcurve-onchain-data/`

**Purpose:** Real-time blockchain event listener that monitors Uniswap V3 pools, position liquidity, ERC-20 approvals/balances, and close orders via WebSocket subscriptions. Publishes events to RabbitMQ for consumption by business-logic and automation services.

**Technology:**
- **Node.js 20+** - Standalone runtime (no HTTP framework)
- **viem** - EVM WebSocket subscriptions
- **RabbitMQ** - Event publisher
- **Pino** - Structured logging

**Subscribers (8 independent workers):**
1. **UniswapV3PoolPriceSubscriber** - Subscribes to Swap events for pools with active positions
2. **PositionLiquiditySubscriber** - Monitors NFPM IncreaseLiquidity/DecreaseLiquidity events
3. **NfpmTransferSubscriber** - Tracks NFT mint/burn/transfer (position lifecycle)
4. **Erc20ApprovalSubscriber** - Listens to ERC-20 Approval events
5. **Erc20BalanceSubscriber** - Listens to ERC-20 Transfer events for balance tracking
6. **EvmTxStatusSubscriber** - Polls RPC for transaction confirmations
7. **CloseOrderSubscriber** - Polls on-chain close order state changes
8. **PositionEventHandler** - Manages dynamic subscription updates when positions change

**Key Characteristics:**
- WebSocket-based - Real-time event streaming from RPC endpoints
- Batched connections - Configurable pools-per-WebSocket (default 1000)
- Dynamic subscriptions - Auto-updates when positions are created/closed
- Publishes to RabbitMQ exchanges: `pool-prices`, `position-liquidity-events`, `close-order-events`

**Directory Structure:**
```
midcurve-onchain-data/
├── src/
│   ├── index.ts              # Entry point
│   ├── workers/              # All 8 subscribers + WorkerManager
│   ├── mq/                   # RabbitMQ connection, topology, message types
│   ├── events/               # Domain event handlers
│   └── lib/                  # Logger, config, services
└── package.json
```

---

### @midcurve/business-logic - Event-Driven Rules & Scheduled Tasks

**Location:** `apps/midcurve-business-logic/`

**Purpose:** Event-driven business logic processor that consumes RabbitMQ messages and executes scheduled rules. Handles domain business logic separate from on-chain monitoring.

**Technology:**
- **Node.js 20+** - Standalone runtime (no HTTP framework)
- **RabbitMQ** - Message consumer
- **node-cron** - Scheduled task execution
- **Pino** - Structured logging

**Active Rules:**
1. **RefreshCoingeckoTokensRule** - Daily token data refresh (cron: 3:17 AM UTC)
2. **EnrichCoingeckoTokensRule** - Token enrichment every 5 minutes
3. **UpdatePositionOnLiquidityEventRule** - Processes liquidity events from RabbitMQ
4. **ProcessCloseOrderEventsRule** - Syncs close orders with on-chain state
5. **CreateAutomationWalletOnUserRegisteredRule** - Auto-creates automation wallet on registration

**Key Characteristics:**
- Rule-based architecture - Abstract `BusinessRule` base class with lifecycle hooks
- RuleRegistry - Manages rule registration, startup, shutdown
- SchedulerService - Singleton cron scheduler with execution metrics
- Consumes from RabbitMQ: `position-liquidity-events`, `close-order-events`

**Directory Structure:**
```
midcurve-business-logic/
├── src/
│   ├── index.ts              # Entry point
│   ├── workers/              # RuleManager orchestrator
│   ├── rules/                # BusinessRule implementations
│   │   ├── base.ts           # Abstract base class
│   │   ├── registry.ts       # RuleRegistry
│   │   └── uniswapv3/        # Protocol-specific rules
│   ├── scheduler/            # Cron-based task scheduler
│   ├── mq/                   # RabbitMQ connection manager
│   └── lib/                  # Logger, config
└── package.json
```

---

### @midcurve/contracts - Solidity Smart Contracts

**Location:** `apps/midcurve-contracts/`

**Purpose:** Solidity smart contracts for Uniswap V3 position management. Implements the Diamond Proxy Pattern (EIP-2535) for upgradeable position closer contracts and a DEX aggregator (MidcurveSwapRouter) for post-close token swaps.

**Technology:**
- **Solidity 0.8.28** - Smart contract language
- **Foundry** - Development framework (forge, anvil, cast)
- **OpenZeppelin** - Security-audited contract libraries
- **TypeScript** - Deployment scripts (via viem)

**Contracts:**

**Position Closer (Diamond Pattern):**
- `Diamond.sol` - EIP-2535 diamond proxy entry point
- `RegistrationFacet.sol` - Register/cancel close orders
- `ExecutionFacet.sol` - Execute close orders (delegates swaps to MidcurveSwapRouter)
- `ViewFacet.sol` - Read-only views (getOnChainOrder, getCloseOrderList)
- `OwnershipFacet.sol` - NFT ownership checks
- `VersionFacet.sol` - Contract version tracking
- `MulticallFacet.sol` - Batch call support
- `UniswapV3PositionCloserFactory.sol` - Factory for deploying position closers

**Swap Router (DEX Aggregator):**
- `MidcurveSwapRouter.sol` - Main router with `sell()` function
- `UniswapV3Adapter.sol` - Uniswap V3 venue adapter
- Extensible to additional venues (Balancer, Curve, etc.)

**Directory Structure:**
```
midcurve-contracts/
├── contracts/
│   ├── position-closer/
│   │   ├── diamond/          # Diamond proxy core
│   │   ├── facets/           # Business logic facets
│   │   ├── interfaces/       # Contract interfaces
│   │   ├── libraries/        # Math libraries (LiquidityAmounts, TickMath)
│   │   ├── storage/          # AppStorage struct
│   │   └── init/             # Initialization logic
│   └── swap-router/
│       ├── MidcurveSwapRouter.sol
│       ├── adapters/         # Venue adapters
│       └── interfaces/       # Router & adapter interfaces
├── script/                   # Foundry deployment scripts (.sol)
├── scripts/                  # TypeScript deployment helpers
├── lib/                      # forge-std, openzeppelin-contracts
├── foundry.toml              # Foundry configuration
└── package.json
```

---

## Technology Stack

### Languages & Runtimes
- **TypeScript 5** - Strict mode, ESM modules
- **Node.js 20.19.x** - Server-side runtime
- **Solidity 0.8.28** - Smart contracts

### Build Tools
- **Vite** - Frontend build tool (midcurve-ui)
- **Next.js 15** - Backend API framework (api, automation, signer)
- **Turborepo** - Monorepo build orchestration
- **pnpm 9.12.0** - Package manager
- **Foundry** - Smart contract development (midcurve-contracts)

### Frontend
- **React 19** - UI framework
- **TailwindCSS 4.0** - Utility-first CSS
- **RainbowKit** - Wallet connection UI
- **Wagmi** - React hooks for Ethereum
- **TanStack React Query** - Server state management
- **Recharts** - Data visualization

### Backend
- **Prisma 6.x** - ORM and schema management
- **viem 2.37+** - Ethereum utilities, EIP-55 checksumming
- **Zod 3.22+** - Runtime validation
- **Pino** - Structured logging
- **node-cron** - Scheduled task execution
- **nanoid** - Request ID generation

### Infrastructure
- **Docker + Docker Compose** - Container orchestration
- **Caddy** - Reverse proxy with auto SSL
- **nginx** - Static file serving (UI)
- **PostgreSQL** - Primary database (AWS RDS)
- **RabbitMQ 3.13** - Message broker for on-chain events and automation

---

## Architecture Principles

### 1. Type Hierarchy & Separation of Concerns

```
┌─────────────────────────────────────┐
│     @midcurve/shared (Types)        │  <- Pure types (no dependencies)
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
- Import types from @midcurve/shared, NOT from `@prisma/client`
- Shared types are portable - Work in browsers, Node.js, edge runtimes
- Prisma types are internal - Used only within services layer
- Services converts between shared types and Prisma types when necessary
- Cross-origin auth - Custom session middleware with CORS support

### 2. Prisma Schema Management with @midcurve/database

**Single Source of Truth:** Prisma schema AND migrations are maintained in `packages/midcurve-database/prisma/`

**Centralized Package Pattern:**
1. `@midcurve/database` package contains Prisma schema and migrations
2. Package generates Prisma client locally in `src/generated/prisma/`
3. Package exports the Prisma client instance for all consumers
4. All backend apps (api, automation, onchain-data, business-logic, signer) import from `@midcurve/database`

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

This monorepo uses **pnpm workspaces** with the `workspace:*` protocol for automatic package linking.

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

2. **pnpm install** at root creates symlinks between packages

3. **Turborepo** manages build dependencies:
   - Defined in `turbo.json` with `dependsOn` configuration
   - Ensures packages build in correct order
   - Caches builds for fast incremental updates

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

// Type aliases for convenience
type Erc20Token = Token<Erc20TokenConfig>;
```

**Database Storage:**
- `config` field stored as PostgreSQL JSON column
- Schema flexibility (add new platforms without migrations)
- Type safety at compile time (TypeScript enforces correct structure)

### 5. Distributed Caching with PostgreSQL

**Why PostgreSQL Instead of Redis?**

- External APIs (CoinGecko) have strict rate limits (~30 calls/minute)
- Multiple workers/processes need shared cache
- In-memory cache doesn't work across process boundaries
- Use existing PostgreSQL database as cache backend
- TTL-based expiration with automatic cleanup
- 3ms cache vs 200-500ms API call (good enough performance)

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

**Authentication Flow:**
```
┌─────────────────────┐        ┌─────────────────────┐
│  UI (Vite SPA)      │        │  API (Next.js)      │
│  app.midcurve.fin.  │        │  api.midcurve.fin.  │
└─────────┬───────────┘        └──────────┬──────────┘
          │                               │
          │ 1. POST /api/v1/auth/nonce    │
          │ ─────────────────────────────>│
          │<───────────────────────────── │
          │    { nonce: "..." }           │
          │                               │
          │ 2. User signs with wallet     │
          │                               │
          │ 3. POST /api/v1/auth/verify   │
          │    { message, signature }     │
          │ ─────────────────────────────>│
          │<───────────────────────────── │
          │    Set-Cookie: midcurve_session=xxx
          │    (SameSite=None; Secure)    │
          │                               │
          │ 4. GET /api/v1/positions      │
          │    Cookie: midcurve_session=xxx
          │    credentials: 'include'     │
          │ ─────────────────────────────>│
          │<───────────────────────────── │
          │    { data: [...positions] }   │
          │                               │
└─────────┴───────────────────────────────┘
```

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

### Solana (Future)

Planned support:
- Orca (concentrated liquidity pools)
- Raydium (high-performance AMM)

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

**Automation / Onchain Data:**
```bash
RABBITMQ_URL="amqp://guest:guest@localhost:5672"
```

### Development Workflow

**Working on packages (shared, services, api-shared, database):**
```bash
cd packages/midcurve-shared
# Make changes to src/
pnpm build  # Dependent packages pick up changes via workspace
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

**Solidity contracts:**
```bash
cd apps/midcurve-contracts
forge build
```

---

## Deployment

### Docker Compose (Production)

The primary deployment method is Docker Compose with a multi-service architecture.

**Service Overview:**
```
┌─────────────────────────────────────────────────────────────┐
│                    docker-compose.yml                        │
├─────────────────────────────────────────────────────────────┤
│  caddy           │ Reverse proxy, SSL termination (80/443)  │
│  ui              │ Vite SPA + nginx (3000)                  │
│  api             │ Next.js REST API (3001)                  │
│  onchain-data    │ WebSocket event listeners                │
│  automation      │ Order execution (3004)                   │
│  business-logic  │ Event processing & scheduled rules       │
│  signer          │ Transaction signing (3003)               │
│  rabbitmq        │ Message broker (5672/15672)              │
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

**Service Dependencies:**
- `api` depends on: PostgreSQL (external), signer, automation
- `automation` depends on: rabbitmq, onchain-data, signer
- `onchain-data` depends on: rabbitmq, PostgreSQL
- `business-logic` depends on: rabbitmq, signer
- `signer` depends on: (standalone)
- `ui` depends on: (standalone, calls api via Caddy)

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
