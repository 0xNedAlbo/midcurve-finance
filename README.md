# Midcurve Finance

> **Professional risk management platform for concentrated liquidity providers**

Midcurve Finance enables liquidity providers to monitor, analyze, and optimize their concentrated liquidity positions across multiple DEX protocols and blockchain ecosystems.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Turborepo](https://img.shields.io/badge/built%20with-Turborepo-blueviolet.svg)](https://turbo.build/)

## Features

- **Real-time Position Monitoring** - Track concentrated liquidity positions across multiple chains
- **PnL Analytics** - Quote-token-denominated profit/loss tracking with fee income analysis
- **Risk Management** - Visual PnL curves and range status indicators
- **Multi-Protocol Support** - Uniswap V3 with more protocols coming soon
- **Multi-Chain** - Ethereum, Arbitrum, Base, BSC, Polygon, Optimism
- **SIWE Authentication** - Sign-in with Ethereum (EIP-4361)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│           Docker Compose Production Stack               │
├─────────────────────────────────────────────────────────┤
│  Caddy (reverse proxy, auto SSL) - ports 80/443        │
│  ├── app.midcurve.finance → ui:3000                    │
│  └── api.midcurve.finance → api:3001                   │
├─────────────────────────────────────────────────────────┤
│  Frontend: midcurve-ui (nginx + Vite SPA) - port 3000  │
├─────────────────────────────────────────────────────────┤
│  Backend Services:                                      │
│  ├── midcurve-api (Next.js REST API) - port 3001       │
│  ├── midcurve-evm (Strategy orchestrator) - port 3002  │
│  ├── midcurve-automation (Price monitoring) - port 3004│
│  ├── midcurve-signer (Signing service) - port 3003     │
│  ├── geth (Private EVM node) - port 8545               │
│  └── rabbitmq (Message broker) - port 5672             │
├─────────────────────────────────────────────────────────┤
│  External: PostgreSQL (AWS RDS or local)               │
└─────────────────────────────────────────────────────────┘
```

### Risk Management Approach

Midcurve Finance uses a **quote-token-denominated** approach to risk management:

- **Quote Token**: The token in which position value is measured (your reference currency)
- **Base Token**: The token to which the position has risk exposure
- **PnL Curves**: Visual representation of position value across price ranges
- **Cash Flow Tracking**: All fees converted to quote token value at collection time

This framework provides clear, consistent risk metrics across all positions regardless of the underlying protocol or chain.

### Authentication

The platform uses **Sign-In with Ethereum (SIWE)** for authentication:
- Users sign a message with their wallet to authenticate
- Server-side sessions stored in PostgreSQL
- Session ID stored in httpOnly cookies for security
- Cross-origin support via CORS for separate UI/API deployment

For detailed architecture documentation, see [CLAUDE.md](CLAUDE.md).

## Project Structure

This is a **Turborepo monorepo** with separate services deployed via Docker Compose:

```
midcurve-finance/
├── apps/
│   ├── midcurve-ui/          # Vite SPA (React frontend)
│   ├── midcurve-api/         # Next.js REST API backend
│   ├── midcurve-evm/         # EVM strategy engine + Geth node
│   ├── midcurve-automation/  # Price monitoring & order execution
│   └── midcurve-signer/      # Transaction signing service
├── packages/
│   ├── midcurve-shared/      # Domain types & utilities
│   ├── midcurve-services/    # Business logic layer
│   ├── midcurve-api-shared/  # API types & Zod schemas
│   └── midcurve-database/    # Prisma schema & ORM client
├── infra/
│   └── Caddyfile             # Reverse proxy configuration
├── scripts/
│   └── deploy.sh             # Production deployment script
├── docker-compose.yml        # Service orchestration
├── turbo.json                # Turborepo configuration
└── README.md                 # This file
```

### Applications

| App | Description | Port | Tech Stack |
|-----|-------------|------|------------|
| **midcurve-ui** | Frontend SPA with wallet connection | 3000 | Vite, React 19, React Router, nginx |
| **midcurve-api** | REST API server with session-based authentication | 3001 | Next.js 15, Prisma |
| **midcurve-evm** | EVM strategy orchestrator with private Geth node | 3002 | Next.js 15, RabbitMQ, Geth |
| **midcurve-automation** | Price monitoring & close order execution | 3004 | Next.js 15, RabbitMQ, Foundry |
| **midcurve-signer** | Transaction signing service | 3003 | Next.js 15 |

### Packages

| Package | Description | Documentation |
|---------|-------------|---------------|
| **@midcurve/shared** | Framework-agnostic types and utilities | [packages/midcurve-shared/README.md](packages/midcurve-shared/README.md) |
| **@midcurve/services** | Business logic, database services, and external clients | [packages/midcurve-services/CLAUDE.md](packages/midcurve-services/CLAUDE.md) |
| **@midcurve/database** | Prisma schema and database migrations | - |
| **@midcurve/api-shared** | API types, validation schemas, and type-safe contracts | [packages/midcurve-api-shared/README.md](packages/midcurve-api-shared/README.md) |

## Development Setup

### Prerequisites

- **Node.js** 20.19.x ([download](https://nodejs.org/))
- **PostgreSQL** 14+ ([download](https://www.postgresql.org/download/))
- **pnpm** 9.12.0 (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)

### Installation

```bash
# Clone the repository
git clone https://github.com/0xNedAlbo/midcurve-finance.git
cd midcurve-finance

# Install dependencies
pnpm install

# Set up environment variables for both apps
cp apps/midcurve-api/.env.example apps/midcurve-api/.env
cp apps/midcurve-ui/.env.example apps/midcurve-ui/.env
# Edit both .env files with your configuration

# Run database migrations
cd packages/midcurve-database
npx prisma migrate deploy
cd ../..

# Build packages
pnpm run build

# Start development servers
pnpm run dev
```

The applications will be available at:
- **UI**: [http://localhost:3000](http://localhost:3000)
- **API**: [http://localhost:3001](http://localhost:3001)

### Available Scripts

```bash
# Development
pnpm run dev             # Start both UI and API in parallel
pnpm run dev:ui          # Start UI only (port 3000)
pnpm run dev:api         # Start API only (port 3001)

# Build
pnpm run build           # Build all packages and apps
pnpm run build:ui        # Build UI only
pnpm run build:api       # Build API only

# Type checking
pnpm run typecheck       # Type check all packages

# Testing
pnpm run test            # Run all tests across packages
```

### Environment Variables

#### API Server (`apps/midcurve-api/.env`)

```bash
# Database - Required
DATABASE_URL="postgresql://user:password@localhost:5432/midcurve"

# CORS - Required for UI communication
ALLOWED_ORIGINS="http://localhost:3000"

# Cookie domain (production only)
COOKIE_DOMAIN=".midcurve.finance"

# RPC Endpoints - Required for blockchain operations
RPC_URL_ETHEREUM="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
RPC_URL_ARBITRUM="https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY"
RPC_URL_BASE="https://base-mainnet.g.alchemy.com/v2/YOUR_KEY"
# ... additional chains as needed

# Optional: External APIs
COINGECKO_API_KEY="your-coingecko-key"
ETHERSCAN_API_KEY="your-etherscan-key"
THE_GRAPH_API_KEY="your-graph-key"
```

#### UI Application (`apps/midcurve-ui/.env`)

```bash
# API URL (leave empty in dev to use Vite proxy)
VITE_API_URL=

# WalletConnect - Required
VITE_WALLETCONNECT_PROJECT_ID="your-walletconnect-id"
```

See `.env.example` files in each app for complete configuration options.

## Deployment

### Prerequisites

- **Docker** and **Docker Compose** installed
- **PostgreSQL** database (AWS RDS recommended for production)
- **DNS records** pointing to your server (for production with SSL)
- **Ports 80 and 443** open for HTTP/HTTPS traffic

### Production Deployment

```bash
# Clone and configure
git clone https://github.com/0xNedAlbo/midcurve-finance.git
cd midcurve-finance

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Deploy all services
./scripts/deploy.sh
```

### Deployment Options

```bash
./scripts/deploy.sh              # Full deployment (build + migrate + start)
./scripts/deploy.sh --no-build   # Deploy without rebuilding images
./scripts/deploy.sh --migrate    # Run database migrations only
./scripts/deploy.sh --skip-pull  # Skip git pull
```

### Key Environment Variables (Production)

```bash
# Database
DATABASE_URL="postgresql://user:password@rds-host:5432/midcurve"

# Frontend (build-time)
VITE_API_URL="https://api.midcurve.finance"
VITE_WALLETCONNECT_PROJECT_ID="your-project-id"

# API CORS
ALLOWED_ORIGINS="https://app.midcurve.finance"
COOKIE_DOMAIN=".midcurve.finance"

# RPC Endpoints
RPC_URL_ETHEREUM="https://..."
RPC_URL_ARBITRUM="https://..."
# ... additional chains

# Signer Service
SIGNER_INTERNAL_API_KEY="your-internal-key"
SIGNER_USE_LOCAL_KEYS="true"

# RabbitMQ
RABBITMQ_USER="midcurve"
RABBITMQ_PASS="your-password"

# External APIs
ETHERSCAN_API_KEY="your-key"
THE_GRAPH_API_KEY="your-key"
```

### SSL/HTTPS

Caddy automatically handles SSL certificate provisioning via Let's Encrypt. Ensure:
- DNS A records point to your server IP
- Ports 80 and 443 are accessible
- Domain names are configured in `infra/Caddyfile`

## Supported Platforms

### Blockchains

- **Ethereum** (Mainnet)
- **Arbitrum One**
- **Base**
- **BNB Smart Chain**
- **Polygon**
- **Optimism**

### DEX Protocols

- **Uniswap V3** (Ethereum, Arbitrum, Base, Polygon, Optimism)
- More protocols coming soon

## Tech Stack

### Frontend (midcurve-ui)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Framework**: [React 19](https://react.dev/), [React Router 7](https://reactrouter.com/)
- **Styling**: [TailwindCSS 4.0](https://tailwindcss.com/)
- **Web3**: [Wagmi](https://wagmi.sh/), [Viem](https://viem.sh/), [RainbowKit](https://www.rainbowkit.com/)

### Backend (midcurve-api)
- **Framework**: [Next.js 15](https://nextjs.org/) (API Routes)
- **Database**: [Prisma 6](https://www.prisma.io/), [PostgreSQL](https://www.postgresql.org/)
- **Authentication**: Custom session-based auth with SIWE

### Infrastructure
- **Orchestration**: [Docker Compose](https://docs.docker.com/compose/)
- **Reverse Proxy**: [Caddy](https://caddyserver.com/) (auto SSL)
- **Message Broker**: [RabbitMQ](https://www.rabbitmq.com/)
- **Private Node**: [Geth](https://geth.ethereum.org/)

### Shared
- **Monorepo**: [Turborepo](https://turbo.build/)
- **Testing**: [Vitest](https://vitest.dev/)
- **Type Safety**: [TypeScript 5.3+](https://www.typescriptlang.org/), [Zod](https://zod.dev/)

## Documentation

- **[CLAUDE.md](CLAUDE.md)** - Complete architecture and implementation guide
- **[packages/midcurve-services/CLAUDE.md](packages/midcurve-services/CLAUDE.md)** - Services layer documentation
- **[packages/midcurve-api-shared/README.md](packages/midcurve-api-shared/README.md)** - API types documentation

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Links

- **GitHub**: https://github.com/0xNedAlbo/midcurve-finance
- **Issues**: https://github.com/0xNedAlbo/midcurve-finance/issues

---

**Midcurve Finance** - Professional risk management for concentrated liquidity providers
