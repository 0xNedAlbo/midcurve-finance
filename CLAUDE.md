# Midcurve Finance Monorepo

## Project Overview

**Midcurve Finance** is a comprehensive risk management platform for concentrated liquidity (CL) provisioning across multiple blockchain ecosystems, including Ethereum, BSC, and Solana.

The platform enables liquidity providers to:
- **Monitor** concentrated liquidity positions in real-time
- **Analyze** risk exposure and PnL across multiple DEX protocols
- **Automate** rebalancing strategies to maximize returns
- **Track** impermanent loss and fee collection
- **Optimize** gas costs and execution strategies

## Monorepo Architecture

```
┌──────────────────────────────────────────────────────┐
│            Midcurve Finance Ecosystem                │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │   Unified Next.js Application (port 3000)   │    │
│  │   ┌─────────────────┐   ┌────────────────┐  │    │
│  │   │  UI/Frontend    │   │  API Routes    │  │    │
│  │   │  (React/Next)   │   │  /api/v1/*     │  │    │
│  │   └─────────────────┘   └────────────────┘  │    │
│  │   (Single NextAuth instance - shared auth)  │    │
│  └──────────────────────┬───────────────────────┘    │
│                         │                            │
│                ┌────────▼─────────┐                  │
│                │ @midcurve/shared │                  │
│                │ Types + Utils    │                  │
│                └────────┬─────────┘                  │
│                         │                            │
│                ┌────────▼──────────┐                 │
│                │@midcurve/services │                 │
│                │  Business Logic   │                 │
│                └────────┬──────────┘                 │
│                         │                            │
│                ┌────────▼─────────┐                  │
│                │    PostgreSQL     │                  │
│                │   (Prisma ORM)    │                  │
│                └──────────────────┘                  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## Repository Structure

```
midcurve-finance/
├── apps/
│   └── midcurve-ui/          # Unified Next.js app (UI + API)
├── packages/
│   ├── midcurve-shared/      # @midcurve/shared - Domain types & utilities
│   ├── midcurve-services/    # @midcurve/services - Business logic
│   └── midcurve-api-shared/  # @midcurve/api-shared - API types & schemas
├── turbo.json                # Turborepo configuration
├── package.json              # Workspace configuration
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

### @midcurve/ui - Unified Next.js Application

**Location:** `apps/midcurve-ui/`

**Purpose:** Unified full-stack Next.js application containing both frontend UI and backend API routes.

**Contains:**

- **Frontend (UI):**
  - React 19 components with TypeScript
  - TailwindCSS styling with Tailwind 4.0
  - RainbowKit wallet connection
  - React Query for server state management
  - Dashboard, position management, analytics

- **Backend (API Routes):**
  - Health check endpoint (`GET /api/health`)
  - Authentication endpoints (`/api/v1/auth/*` - SIWE + API keys)
  - User management endpoints (`/api/v1/user/*`)
  - Token endpoints (`/api/v1/tokens/erc20/*`)
  - Pool endpoints (`/api/v1/pools/uniswapv3/*`)
  - Position endpoints (`/api/v1/positions/*`)

- **Infrastructure:**
  - Single NextAuth instance (shared between UI and API)
  - `withAuth` middleware - Dual authentication (session + API keys)
  - Prisma client for database access
  - Logging with structured logger
  - E2E testing with Playwright
  - API E2E testing with Vitest

**Key Characteristics:**
- ✅ **Co-located architecture** - UI and API in same app (same origin)
- ✅ **Unified authentication** - Session cookies work automatically
- ✅ **Type safety** - Imports types from @midcurve/api-shared
- ✅ **Thin API layer** - Delegates to services, no business logic duplication
- ✅ **Zod validation** - Runtime type checking with automatic type inference
- ✅ **Serverless-friendly** - Each request independent, stateless design

**Directory Structure:**
```
midcurve-ui/
├── src/
│   ├── app/
│   │   ├── api/              # API routes (co-located with UI)
│   │   │   ├── v1/           # Versioned REST API
│   │   │   │   ├── auth/     # Authentication endpoints
│   │   │   │   ├── user/     # User management
│   │   │   │   ├── tokens/   # Token discovery
│   │   │   │   ├── pools/    # Pool data
│   │   │   │   └── positions/ # Position management
│   │   │   └── health/       # Health check
│   │   ├── dashboard/        # Dashboard page
│   │   └── ...               # Other UI pages
│   ├── components/           # React components
│   ├── hooks/                # React Query hooks
│   ├── lib/                  # Utilities (auth, api-client, logger, prisma)
│   ├── middleware/           # API middleware (withAuth)
│   └── utils/                # Helper functions
├── tests/                    # Playwright E2E tests
├── prisma/                   # Prisma schema (synced from services)
└── vitest.config.ts          # Vitest config for API tests
```

**Documentation:** Project is self-contained; see inline documentation in code

---

## Technology Stack

### Languages & Runtimes
- **TypeScript 5.3+** - Strict mode, ESM modules
- **Node.js 18+** - Server-side runtime

### Frameworks
- **Next.js 15+** - Full-stack framework (App Router, React Server Components)
- **React 19** - UI framework
- **Prisma 6.17.1** - ORM and schema management

### Testing
- **Vitest 3.2+** - API E2E test framework
- **Playwright 1.56+** - UI E2E test framework with visual debugging
- **vitest-mock-extended** - Type-safe mocking for Prisma (services package)

### Frontend Libraries
- **TailwindCSS 4.0** - Utility-first CSS framework
- **RainbowKit** - Wallet connection UI
- **Wagmi** - React hooks for Ethereum
- **TanStack React Query** - Server state management
- **Recharts** - Data visualization

### Backend Libraries
- **viem 2.38+** - Ethereum utilities, EIP-55 checksumming
- **Zod 3.22+** - Runtime validation and type inference
- **Auth.js v5** - Authentication framework (NextAuth)
- **nanoid** - Request ID generation

### Infrastructure
- **PostgreSQL** - Primary database with JSON columns for flexibility
- **Vercel** - Serverless deployment platform
- **npm workspaces** - Monorepo package linking

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
- ✅ **UI and API share auth** - Single NextAuth instance, session cookies work automatically

### 2. Prisma Schema Management & Peer Dependencies

**Single Source of Truth:** Prisma schema AND migrations are maintained ONLY in `midcurve-services/prisma/`

**Consumer Pattern:**
1. Services declares `@prisma/client` as **peer dependency**
2. Consuming projects (UI app) install `@prisma/client` directly
3. Consuming projects **copy schema and migrations** locally via postinstall hook
4. Services uses the consumer's Prisma client instance

**Benefits:**
- ✅ Single Prisma client instance (no duplication)
- ✅ Schema AND migration changes propagate to all consumers
- ✅ No database duplication or version conflicts
- ✅ Migrations automatically applied during deployment

**Workflow:**
```bash
# From monorepo root: Update schema and create migration
cd packages/midcurve-services
# Edit prisma/schema.prisma
npx prisma migrate dev --name your_migration_name

# Changes automatically available to all packages via npm workspaces
# UI app postinstall hook syncs schema + migrations + generates client
cd ../../apps/midcurve-ui
npm install  # Triggers postinstall → schema + migrations sync → prisma generate

# During Vercel deployment: Migrations automatically applied
# Vercel runs: npm install → npm run build
#              → prisma migrate deploy → next build
```

**Migration Application:**
- **Development:** Migrations applied manually in services package with `prisma migrate dev`
- **Production/Vercel:** Migrations applied automatically during build via `prisma migrate deploy`
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

### 6. Unified Authentication Architecture

**Why Unified Architecture?**
- UI and API routes run in same Next.js app (same origin)
- Session cookies automatically included in API requests
- No JWT passing or auth bridges needed
- Single NextAuth instance shared between UI and API

**Dual Authentication Strategy:**
1. **Session-based (JWT)** - For UI users (automatically works via cookies)
2. **API keys** - For programmatic access (external clients)

**Sign-In with Ethereum (SIWE):**
- EIP-4361 standard for wallet-based authentication
- Auth.js v5 with custom CredentialsProvider
- Nonce generation and signature verification (prevents replay attacks)
- Primary + secondary wallet linking
- JWT session tokens (30-day expiration)
- Prisma adapter for session storage in PostgreSQL

**API Key Management:**
- SHA-256 hashed keys (stored securely)
- User-scoped keys (one user → many keys)
- Last used tracking
- Revocation support via API endpoints

**Middleware (`withAuth`):**
- Single middleware handles both auth methods
- **Step 1:** Checks for API key in `Authorization: Bearer mc_xxx` header
- **Step 2:** Checks for session cookie (automatically sent by browser)
- Returns 401 if both fail
- Injects authenticated user object into route handler

**Flow:**
```
User → SIWE Sign-In → NextAuth creates session cookie
     → UI calls /api/v1/* → Cookie automatically included
     → withAuth() calls auth() → Validates session
     → ✅ Authenticated
```

---

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

**🌐 [midcurve-ui](apps/midcurve-ui/CLAUDE.md)** - Unified Next.js Application (UI + API)
- Project structure and routing (Next.js App Router)
- Adding new endpoints (step-by-step guide)
- Authentication (SIWE + API keys)
- Deployment to Vercel

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

1. **Node.js 18+** installed
2. **PostgreSQL** database running
3. **Git** for version control
4. **npm** or **pnpm** or **yarn**

### Initial Setup

```bash
# Clone the monorepo
git clone https://github.com/0xNedAlbo/midcurve-finance.git
cd midcurve-finance

# Install all dependencies at once (from root)
npm install

# Set up environment variables for UI app
cd apps/midcurve-ui
cp .env.example .env
# Edit .env with DATABASE_URL, RPC URLs, and other config

# Build all packages in dependency order
cd ../..
npm run build

# Start development server
cd apps/midcurve-ui
npm run dev  # Runs unified app on port 3000
```

**What Happens During `npm install`:**
1. Installs dependencies for all packages (apps/*, packages/*)
2. Creates workspace symlinks (automatic package linking)
3. Turborepo sets up build cache
4. UI postinstall hook syncs Prisma schema and generates client

### Environment Variables

**Required (all projects):**
```bash
DATABASE_URL="postgresql://user:password@localhost:5432/midcurve"
NODE_ENV="development"
```

**Required (UI only):**
```bash
NEXT_PUBLIC_API_URL="http://localhost:3000"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-here"  # Generate with: openssl rand -base64 32
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="your-walletconnect-project-id"
```

**Optional (services + UI):**
```bash
# EVM Chain RPCs (configure chains you plan to use)
RPC_URL_ETHEREUM="https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
RPC_URL_ARBITRUM="https://arb-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
RPC_URL_BASE="https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
RPC_URL_BSC="https://bsc-dataseed1.binance.org"
RPC_URL_POLYGON="https://polygon-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
RPC_URL_OPTIMISM="https://opt-mainnet.g.alchemy.com/v2/YOUR_API_KEY"

# Token Enrichment
COINGECKO_API_KEY="your-coingecko-key"  # Optional, but recommended
```

### Development Workflow

**Working on shared types/utilities:**
```bash
cd packages/midcurve-shared
# Make changes to src/
npm run build  # Dependent packages pick up changes via workspace
npm test       # Run tests
```

**Working on services:**
```bash
cd packages/midcurve-services
# Make changes to src/
npm run build  # UI automatically uses latest via workspace
npm test       # Run 121+ tests
```

**Working on api-shared (API types):**
```bash
cd packages/midcurve-api-shared
# Make changes to src/types/
npm run build  # UI automatically uses latest via workspace
npm test       # Run tests (when implemented)
```

**Working on UI (contains frontend + API):**
```bash
cd apps/midcurve-ui
npm run dev  # Start dev server
# UI + API run at http://localhost:3000
# Changes to packages/* automatically available via workspace symlinks
```

**Database migrations:**
```bash
cd packages/midcurve-services
# Edit prisma/schema.prisma
npx prisma migrate dev --name your_migration_name

# Schema changes automatically available via workspace
# Run postinstall in UI to sync schema + generate client
cd ../../apps/midcurve-ui
npm install
```

**Building All Packages:**
```bash
# From monorepo root - builds in dependency order
npm run build

# Turborepo parallelizes where possible and caches builds
# Only rebuilds changed packages
```

### Testing

**Shared:**
```bash
cd packages/midcurve-shared
npm test              # Watch mode
npm run test:run      # Single run
npm run test:coverage # With coverage
```

**Services:**
```bash
cd packages/midcurve-services
npm test              # Watch mode (121+ tests)
npm run test:run      # Single run
npm run test:coverage # With coverage
```

**API-Shared:**
```bash
cd packages/midcurve-api-shared
npm test              # Watch mode (when implemented)
npm run test:run      # Single run (when implemented)
npm run type-check    # Type checking only
```

**UI (Frontend + API):**
```bash
cd apps/midcurve-ui
npm run typecheck     # Type checking
npm run test:api      # API E2E tests (vitest)
npm run test:e2e      # UI E2E tests (playwright)
npm run test:e2e:ui   # Interactive UI test mode
```

**Run Tests for All Packages:**
```bash
# From monorepo root - runs tests in parallel
npm test
```

---

## Deployment

### Vercel (Unified App)

**Automatic Deployment:**
1. Connect GitHub repository to Vercel
2. Configure environment variables in Vercel dashboard
3. Push to `main` branch → automatic deploy

**Deployment Process:**
```
1. npm install (triggers postinstall)
   → Syncs schema + migrations from services
   → Generates Prisma client

2. npm run build
   → Runs prisma migrate deploy (applies pending migrations)
   → Runs next build (builds application)
```

**Environment Variables (Vercel):**
```
DATABASE_URL          (PostgreSQL connection string)
NEXTAUTH_URL          (Production URL, e.g., https://app.midcurve.finance)
NEXTAUTH_SECRET       (Generate new for production)
NEXT_PUBLIC_API_URL   (Same as NEXTAUTH_URL for same-origin)
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID  (WalletConnect project ID)
RPC_URL_*             (All required RPC endpoints)
COINGECKO_API_KEY     (Optional)
ETHERSCAN_API_KEY     (Optional)
THE_GRAPH_API_KEY     (Optional)
```

**Serverless Configuration:**
- Region: `iad1` (US East)
- Max Duration: 10 seconds
- Memory: 1024 MB
- See `midcurve-ui/vercel.json`

**Migration Troubleshooting:**

| Issue | Cause | Solution |
|-------|-------|----------|
| Build fails: "No migration files found" | Migrations not synced to UI | Run `npm install` locally to verify sync script works |
| Build fails: "Migration already applied" | Migration history out of sync | Check `_prisma_migrations` table in database |
| Build fails: "Cannot find module '@prisma/client'" | Prisma client not generated | Check postinstall script runs successfully |
| Runtime error: "Table does not exist" | Migrations not applied in production | Check Vercel build logs for migration errors |

**Safety Features:**
- ✅ `prisma migrate deploy` is idempotent (safe to run multiple times)
- ✅ Migration lock prevents concurrent migrations
- ✅ Failed migrations cause deployment to fail (prevents incomplete deploys)
- ✅ Vercel automatically rolls back on build failure

### PostgreSQL (Database)

**Production Recommendations:**
- Managed PostgreSQL (AWS RDS, Google Cloud SQL, Neon, Supabase)
- Connection pooling (PgBouncer or Prisma Data Proxy)
- Regular backups
- Monitoring (disk space, connections, slow queries)

**Cache Table Growth:**
- Cache table grows over time
- Run periodic cleanup: `CacheService.getInstance().cleanup()`
- Or set up automatic cleanup cron job

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
- ✅ Vercel deployment configuration
- ✅ npm workspaces integration
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
- Rate limiting (Vercel KV)
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

### 7. Why Merge API into UI (Unified Architecture)?

**Problem:** Originally separate `midcurve-api` and `midcurve-ui` repos with different NextAuth instances caused authentication failures.

**Rationale:**
- **Single NextAuth instance** - Session cookies work seamlessly (same origin)
- **No JWT bridging** - Eliminated complex token passing between apps
- **Simpler deployment** - One Vercel project instead of two
- **Better DX** - Single dev server, no CORS issues, easier debugging
- **Type safety** - UI imports API types directly, guaranteed compatibility
- **Faster iteration** - Change API and UI in same commit
- **Session sharing** - No need to sync sessions between separate apps

**Before (Broken):**
```
UI (port 3000) → API (port 3001)
❌ Different NextAuth instances
❌ Session cookies don't work cross-origin
❌ JWT passing required (complex, error-prone)
```

**After (Working):**
```
UI + API (port 3000, unified app)
✅ Single NextAuth instance
✅ Session cookies work (same origin)
✅ No JWT bridging needed
```

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
┌─────────────────────────────────────────────────────────┐
│              midcurve-ui (Unified Next.js App)           │
│                                                          │
│  ┌────────────────┐                ┌──────────────────┐ │
│  │   Frontend     │   Same-Origin  │   API Routes     │ │
│  │   (React)      │───────────────▶│   (/api/v1/*)    │ │────▶ Blockchain
│  │                │   Session      │                  │ │      (Ethereum)
│  │ ❌ No RPC URLs │   Cookies      │ ✅ Has RPC URLs  │ │
│  │ ❌ No API Keys │                │ ✅ Has API Keys  │ │
│  └────────────────┘                └──────────────────┘ │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Migration Pattern:**

**Frontend Code (src/app, src/components, src/hooks):**
- ❌ **No** chain RPC configuration
- ❌ **No** direct viem/wagmi reads from blockchain
- ❌ **No** `RPC_URL_*` environment variables in frontend code
- ✅ **Only** HTTP calls to `/api/v1/*` routes (same origin)
- ✅ **Only** `NEXT_PUBLIC_API_URL` environment variable
- ✅ **Wagmi/RainbowKit** for wallet connection and transaction signing only

**Backend Code (src/app/api):**
- ✅ **Has** all RPC URLs and API keys
- ✅ **Handles** all blockchain reads
- ✅ **Exposes** data via REST endpoints

**Environment Variables:**

```bash
# Unified .env - Backend secrets + frontend public vars
NEXT_PUBLIC_API_URL=http://localhost:3000  # Same origin
DATABASE_URL=postgresql://...
RPC_URL_ETHEREUM=https://...
RPC_URL_ARBITRUM=https://...
COINGECKO_API_KEY=...
NEXTAUTH_SECRET=...
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
