# Midcurve Finance

> **Professional risk management platform for concentrated liquidity providers**

Midcurve Finance enables liquidity providers to monitor, analyze, and optimize their concentrated liquidity positions across multiple DEX protocols and blockchain ecosystems.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Turborepo](https://img.shields.io/badge/built%20with-Turborepo-blueviolet.svg)](https://turbo.build/)

## Features

- 📊 **Real-time Position Monitoring** - Track concentrated liquidity positions across multiple chains
- 💰 **PnL Analytics** - Quote-token-denominated profit/loss tracking with fee income analysis
- 🎯 **Risk Management** - Visual PnL curves and range status indicators
- 🔄 **Multi-Protocol Support** - Uniswap V3 with more protocols coming soon
- ⛓️ **Multi-Chain** - Ethereum, Arbitrum, Base, BSC, Polygon, Optimism
- 🔐 **SIWE Authentication** - Sign-in with Ethereum (EIP-4361)

## Quick Start

### Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org/))
- **PostgreSQL** 14+ ([download](https://www.postgresql.org/download/))
- **pnpm** 8+ (`npm install -g pnpm`)

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

## Project Structure

This is a **Turborepo monorepo** with separate UI and API applications:

```
midcurve-finance/
├── apps/
│   ├── midcurve-api/         # Next.js API server (REST endpoints)
│   └── midcurve-ui/          # Vite + React SPA (frontend)
├── packages/
│   ├── midcurve-shared/      # Domain types & utilities
│   ├── midcurve-services/    # Business logic & database
│   ├── midcurve-database/    # Prisma schema & migrations
│   └── midcurve-api-shared/  # API types & schemas
├── turbo.json                # Turborepo configuration
├── package.json              # Workspace configuration
└── README.md                 # This file
```

### Applications

| App | Description | Port | Tech Stack |
|-----|-------------|------|------------|
| **midcurve-api** | REST API server with session-based authentication | 3001 | Next.js 15, Prisma |
| **midcurve-ui** | Frontend SPA with wallet connection | 3000 | Vite, React 19, React Router |

### Packages

| Package | Description | Documentation |
|---------|-------------|---------------|
| **@midcurve/shared** | Framework-agnostic types and utilities | [packages/midcurve-shared/README.md](packages/midcurve-shared/README.md) |
| **@midcurve/services** | Business logic, database services, and external clients | [packages/midcurve-services/CLAUDE.md](packages/midcurve-services/CLAUDE.md) |
| **@midcurve/database** | Prisma schema and database migrations | - |
| **@midcurve/api-shared** | API types, validation schemas, and type-safe contracts | [packages/midcurve-api-shared/README.md](packages/midcurve-api-shared/README.md) |

## Development

### Available Scripts

```bash
# Development
pnpm run dev             # Start all apps in development mode
pnpm run build           # Build all packages and apps
pnpm run typecheck       # Type check all packages

# Testing
pnpm run test            # Run all tests across packages

# Individual apps
cd apps/midcurve-api && pnpm run dev    # Start API only
cd apps/midcurve-ui && pnpm run dev     # Start UI only
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
```

#### UI Application (`apps/midcurve-ui/.env`)

```bash
# API URL (leave empty in dev to use Vite proxy)
VITE_API_URL=

# WalletConnect - Required
VITE_WALLETCONNECT_PROJECT_ID="your-walletconnect-id"
```

See `.env.example` files in each app for complete configuration options.

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

## Architecture

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

## Tech Stack

### API Server
- **Framework**: [Next.js 15](https://nextjs.org/) (API Routes)
- **Database**: [Prisma 6](https://www.prisma.io/), [PostgreSQL](https://www.postgresql.org/)
- **Authentication**: Custom session-based auth with SIWE

### UI Application
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Framework**: [React 19](https://react.dev/), [React Router 7](https://reactrouter.com/)
- **Styling**: [TailwindCSS 4.0](https://tailwindcss.com/)
- **Web3**: [Wagmi](https://wagmi.sh/), [Viem](https://viem.sh/), [RainbowKit](https://www.rainbowkit.com/)

### Shared
- **Monorepo**: [Turborepo](https://turbo.build/)
- **Testing**: [Vitest](https://vitest.dev/)
- **Type Safety**: [TypeScript 5.3+](https://www.typescriptlang.org/), [Zod](https://zod.dev/)

## Documentation

- **[CLAUDE.md](CLAUDE.md)** - Complete architecture and implementation guide
- **[packages/midcurve-services/CLAUDE.md](packages/midcurve-services/CLAUDE.md)** - Services layer documentation
- **[packages/midcurve-api-shared/README.md](packages/midcurve-api-shared/README.md)** - API types documentation

## Contributing

We welcome contributions! Please see our contribution guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes and add tests
4. Commit your changes (`git commit -m 'feat: add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

### Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Test additions or changes
- `chore:` - Maintenance tasks

## Deployment

### Production Architecture

For production, deploy the API and UI separately:

1. **API Server**: Deploy `apps/midcurve-api` to Vercel, Railway, or similar
2. **UI Application**: Deploy `apps/midcurve-ui` to Vercel, Netlify, or any static host
3. Configure CORS and cookie domain for cross-origin communication

### Database Migrations

Run migrations in production:
```bash
cd packages/midcurve-database
npx prisma migrate deploy
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Links

- **GitHub**: https://github.com/0xNedAlbo/midcurve-finance
- **Issues**: https://github.com/0xNedAlbo/midcurve-finance/issues

## Acknowledgments

Built with:
- [Turborepo](https://turbo.build/) - High-performance build system
- [Next.js](https://nextjs.org/) - React framework (API)
- [Vite](https://vitejs.dev/) - Frontend build tool
- [Prisma](https://www.prisma.io/) - Next-generation ORM
- [Uniswap](https://uniswap.org/) - Decentralized exchange protocol

---

**Midcurve Finance** - Professional risk management for concentrated liquidity providers
