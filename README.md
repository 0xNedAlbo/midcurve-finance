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
- 🔑 **API Key Management** - Programmatic access for external integrations

## Quick Start

### Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org/))
- **PostgreSQL** 14+ ([download](https://www.postgresql.org/download/))
- **npm** 9+ (comes with Node.js)

### Installation

```bash
# Clone the repository
git clone https://github.com/0xNedAlbo/midcurve-finance.git
cd midcurve-finance

# Install dependencies
npm install

# Set up environment variables
cp apps/midcurve-ui/.env.example apps/midcurve-ui/.env
# Edit apps/midcurve-ui/.env with your DATABASE_URL and RPC endpoints

# Run database migrations
cd apps/midcurve-ui
npx prisma migrate deploy
cd ../..

# Start development server
npm run dev
```

The application will be available at [http://localhost:3000](http://localhost:3000)

## Project Structure

This is a **Turborepo monorepo** with all packages managed in a single repository:

```
midcurve-finance/
├── apps/
│   └── midcurve-ui/          # Unified Next.js app (UI + API)
├── packages/
│   ├── midcurve-shared/      # Domain types & utilities
│   ├── midcurve-services/    # Business logic & database
│   └── midcurve-api-shared/  # API types & schemas
├── turbo.json                # Turborepo configuration
├── package.json              # Workspace configuration
└── README.md                 # This file
```

### Packages

| Package | Description | Documentation |
|---------|-------------|---------------|
| **midcurve-ui** | Unified Next.js application (frontend + API routes) | [apps/midcurve-ui/CLAUDE.md](apps/midcurve-ui/CLAUDE.md) |
| **@midcurve/shared** | Framework-agnostic types and utilities | [packages/midcurve-shared/README.md](packages/midcurve-shared/README.md) |
| **@midcurve/services** | Business logic, database services, and external clients | [packages/midcurve-services/CLAUDE.md](packages/midcurve-services/CLAUDE.md) |
| **@midcurve/api-shared** | API types, validation schemas, and type-safe contracts | [packages/midcurve-api-shared/README.md](packages/midcurve-api-shared/README.md) |

## Development

### Available Scripts

```bash
# Development
npm run dev              # Start all packages in development mode
npm run build            # Build all packages
npm run typecheck        # Type check all packages

# Testing
npm run test             # Run all tests across packages
npm run test:ui          # Run UI E2E tests with Playwright
npm run test:api         # Run API E2E tests with Vitest

# Linting & Formatting
npm run lint             # Lint all packages
npm run format           # Format code with Prettier
```

### Environment Variables

Required environment variables for local development:

```bash
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/midcurve"

# Authentication
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-here"  # Generate with: openssl rand -base64 32
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="your-walletconnect-id"

# RPC Endpoints (configure chains you plan to use)
RPC_URL_ETHEREUM="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"
RPC_URL_ARBITRUM="https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY"
RPC_URL_BASE="https://base-mainnet.g.alchemy.com/v2/YOUR_KEY"
# ... additional chains as needed

# Optional: External APIs
COINGECKO_API_KEY="your-coingecko-key"
```

See [apps/midcurve-ui/.env.example](apps/midcurve-ui/.env.example) for complete list.

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

For detailed architecture documentation, see [CLAUDE.md](CLAUDE.md).

## Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router, React Server Components)
- **Frontend**: [React 19](https://react.dev/), [TailwindCSS 4.0](https://tailwindcss.com/)
- **Backend**: [Prisma 6](https://www.prisma.io/), [PostgreSQL](https://www.postgresql.org/)
- **Web3**: [Wagmi](https://wagmi.sh/), [Viem](https://viem.sh/), [RainbowKit](https://www.rainbowkit.com/)
- **Authentication**: [Auth.js v5](https://authjs.dev/) (NextAuth)
- **Monorepo**: [Turborepo](https://turbo.build/)
- **Testing**: [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/)
- **Type Safety**: [TypeScript 5.3+](https://www.typescriptlang.org/), [Zod](https://zod.dev/)

## Documentation

- **[CLAUDE.md](CLAUDE.md)** - Complete architecture and implementation guide
- **[apps/midcurve-ui/CLAUDE.md](apps/midcurve-ui/CLAUDE.md)** - UI application documentation
- **[packages/midcurve-services/CLAUDE.md](packages/midcurve-services/CLAUDE.md)** - Services layer documentation
- **[apps/midcurve-ui/TESTING.md](apps/midcurve-ui/TESTING.md)** - Testing guide

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

### Vercel (Recommended)

The application is optimized for deployment on Vercel:

1. Connect your GitHub repository to Vercel
2. Configure environment variables in Vercel dashboard
3. Deploy automatically on push to `main`

See [apps/midcurve-ui/vercel.json](apps/midcurve-ui/vercel.json) for deployment configuration.

### Database Migrations

Migrations are automatically applied during Vercel deployment via `prisma migrate deploy` in the build process.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Links

- **GitHub**: https://github.com/0xNedAlbo/midcurve-finance
- **Issues**: https://github.com/0xNedAlbo/midcurve-finance/issues

## Acknowledgments

Built with:
- [Turborepo](https://turbo.build/) - High-performance build system
- [Next.js](https://nextjs.org/) - React framework
- [Prisma](https://www.prisma.io/) - Next-generation ORM
- [Uniswap](https://uniswap.org/) - Decentralized exchange protocol

---

**Midcurve Finance** - Professional risk management for concentrated liquidity providers
