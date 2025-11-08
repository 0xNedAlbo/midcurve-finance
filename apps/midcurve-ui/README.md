# @midcurve/ui

Frontend application for Midcurve Finance - Professional risk management for concentrated liquidity providers.

## Overview

Modern Next.js 15 application built with React 19, TypeScript, and Tailwind CSS 4. Provides a beautiful, performant interface for monitoring and managing concentrated liquidity positions across multiple DEX protocols.

## Technology Stack

### Core Framework
- **Next.js 15.5.2** - App Router with server-side rendering
- **React 19.1.0** - Latest React with server components
- **TypeScript 5.x** - Strict mode for type safety

### Styling
- **Tailwind CSS 4** - Utility-first CSS framework
- **PostCSS** - CSS processing
- **OKLCH Colors** - Modern color system with dark mode
- **Glassmorphism** - Backdrop blur effects

### Web3 Integration
- **Wagmi 2.16.9** - React hooks for Ethereum
- **Viem 2.37.3** - Ethereum JavaScript client
- **RainbowKit 2.2.8** - Wallet connection UI
- **Uniswap V3 SDK 3.25.2** - Position management
- **SIWE 3.0.0** - Sign-In with Ethereum

### State Management
- **TanStack Query 5.87.1** - Server state management and caching
- **React Context** - Auth session state
- **NO Zustand** - Simplified architecture (no global store)

### UI Components
- **Recharts 3.1.2** - Data visualization and charts
- **Lucide React 0.542.0** - Icon library
- **Class Variance Authority** - Type-safe component variants

### Authentication
- Authentication handled by **@midcurve/api** backend (SIWE)

## Project Structure

```
midcurve-ui/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── layout.tsx         # Root layout with providers
│   │   ├── page.tsx           # Landing page
│   │   └── globals.css        # Global styles & theme
│   ├── components/            # React components
│   │   ├── ui/               # Base UI components
│   │   ├── charts/           # PnL curves, analytics
│   │   ├── positions/        # Position management
│   │   └── layout/           # Header, sidebar, footer
│   ├── hooks/                # Custom React hooks
│   ├── providers/            # React context providers
│   │   ├── web3-provider.tsx  # Wagmi + RainbowKit
│   │   └── query-provider.tsx # TanStack Query
│   ├── lib/                  # Utilities
│   │   ├── wagmi.ts          # Web3 configuration
│   │   └── utils.ts          # Helper functions
│   ├── config/               # App configuration
│   └── types/                # TypeScript types
├── public/                   # Static assets
├── next.config.ts            # Next.js configuration
├── tailwind.config.ts        # Tailwind CSS configuration
├── tsconfig.json             # TypeScript configuration
└── package.json              # Dependencies
```

## Getting Started

### Prerequisites

- Node.js 18+ installed
- WalletConnect project ID (get from https://cloud.walletconnect.com)
- Running @midcurve/api backend (for data)

### Installation

1. **Install dependencies:**
   ```bash
   cd midcurve-ui
   npm install
   ```

2. **Link monorepo packages:**
   ```bash
   # Link @midcurve/api-shared (from yalc)
   npm run yalc:link:api-shared
   ```

   Note: `@midcurve/shared` is already linked via `file:` reference in package.json

3. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

   Required variables:
   - `NEXT_PUBLIC_API_URL` - URL of the @midcurve/api backend (default: http://localhost:3001)
   - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` - WalletConnect project ID

### Development

Start the development server:

```bash
npm run dev
# or with pretty logs
npm run dev:pretty
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Available Scripts

```bash
npm run dev          # Start development server
npm run dev:pretty   # Start dev server with pretty logs
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run typecheck    # Run TypeScript type checking

# Yalc (local package management)
npm run yalc:link:api-shared   # Link @midcurve/api-shared
npm run yalc:update            # Update all yalc packages
```

## Monorepo Integration

### Dependencies

**@midcurve/shared** (via `file:` reference)
- Core domain types (Token, Pool, Position, User)
- EVM address utilities
- Uniswap V3 math functions

**@midcurve/api-shared** (via yalc)
- API types and schemas
- Zod validation
- Request/response types

**@midcurve/api** (HTTP connection)
- REST API backend (all database access goes through the API)
- Authentication endpoints
- Data fetching endpoints

### Architecture Principle: Pure Frontend

The UI is a **pure frontend application** that:
- ✅ Communicates with backend via HTTP (to @midcurve/api)
- ✅ Uses wallet provider RPCs for blockchain interactions (no direct RPC URLs needed)
- ❌ Does NOT access the database directly (no DATABASE_URL needed)
- ❌ Does NOT require RPC URLs (wallet providers handle this)

This keeps the frontend lightweight, portable, and secure.

### Updating Local Packages

When api-shared changes:

```bash
# In api-shared repo
npm run build
npm run yalc:push

# In midcurve-ui (auto-updates if yalc watch running)
# Or manually:
npm run yalc:update
```

## Features

### Current Features

- ✅ Wallet connection (RainbowKit)
- ✅ Multi-chain support (Ethereum, Arbitrum, Base, BSC, Polygon, Optimism)
- ✅ Dark mode with OKLCH colors
- ✅ Responsive glassmorphism design
- ✅ Type-safe with TypeScript strict mode

### Planned Features

- [ ] Position monitoring dashboard
- [ ] PnL curves and analytics charts
- [ ] Risk exposure visualization
- [ ] Fee income tracking
- [ ] Position rebalancing tools
- [ ] Multi-protocol support (Uniswap V3, PancakeSwap V3)
- [ ] API key management
- [ ] User authentication (SIWE)

## Architecture

### Provider Tree

```tsx
<AuthProvider>           // NextAuth session
  <QueryProvider>        // TanStack Query
    <Web3Provider>       // Wagmi + RainbowKit
      {children}
    </Web3Provider>
  </QueryProvider>
</AuthProvider>
```

### State Management Strategy

**Server State** (TanStack Query)
- API data fetching & caching
- Position, pool, token data
- Background refetching
- Optimistic updates

**Client State** (React Context)
- Auth session (NextAuth)
- Dark mode toggle
- Wallet connection (Wagmi)

**No Global Store**
- Most state is server-driven
- User preferences minimal (dark mode only)
- Simplified architecture without Zustand

### Styling Approach

**Tailwind CSS 4** with custom theme:
- OKLCH color system for perceptual uniformity
- CSS custom properties for theming
- Dark mode via `class` strategy
- Glassmorphism utilities (`.glass`, `.glass-card`)
- Custom scrollbar styles

**Component Variants** (CVA):
- Type-safe variant API
- Consistent component styling
- Easy to maintain and extend

## Configuration

### Supported Chains

| Chain | Chain ID | RPC Env Var |
|-------|----------|-------------|
| Ethereum | 1 | `NEXT_PUBLIC_RPC_URL_ETHEREUM` |
| Arbitrum | 42161 | `NEXT_PUBLIC_RPC_URL_ARBITRUM` |
| Base | 8453 | `NEXT_PUBLIC_RPC_URL_BASE` |
| BSC | 56 | `NEXT_PUBLIC_RPC_URL_BSC` |
| Polygon | 137 | `NEXT_PUBLIC_RPC_URL_POLYGON` |
| Optimism | 10 | `NEXT_PUBLIC_RPC_URL_OPTIMISM` |

### Image Domains

Configured in [next.config.ts](next.config.ts#L12-L30):
- CoinGecko (token logos)
- GitHub raw (token lists)
- 1inch (token logos)
- Ethereum Optimism (OP token list)

## Deployment

### Vercel (Recommended)

1. Connect GitHub repository to Vercel
2. Configure environment variables in Vercel dashboard
3. Deploy from `main` branch

**Environment variables for production:**
- All variables from `.env.example`
- `NEXTAUTH_URL` set to production URL
- New `NEXTAUTH_SECRET` for production

### Build Command

```bash
npm run build
```

The build process:
1. Syncs Prisma schema from services
2. Generates Prisma client
3. Builds Next.js application

## Troubleshooting

### "Multiple Prisma clients detected"

**Solution:** Ensure services uses peer dependency pattern. Delete `node_modules` and reinstall.

### "Prisma schema out of sync"

**Solution:** Run `npm run prisma:generate`

### "Yalc package not updating"

**Solution:**
```bash
# In services/api-shared repo
npm run yalc:push

# In midcurve-ui
npm run yalc:update
```

### "WalletConnect errors"

**Solution:** Ensure `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set. Get ID from https://cloud.walletconnect.com

## Contributing

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation and development guidelines.

## License

MIT License - Midcurve Finance
