# Midcurve Finance Monorepo

Turborepo monorepo for concentrated liquidity risk management.
pnpm workspaces, TypeScript strict mode, ESM modules.

## Quick Commands
```bash
pnpm install          # Install all deps
pnpm build            # Build all packages (Turborepo)
pnpm dev              # Dev servers (UI :3000, API :3001, all backend services)
pnpm typecheck        # Type check all packages
cd apps/midcurve-contracts && forge build  # Solidity contracts
```

## Package Map
- `packages/midcurve-shared/`      → `@midcurve/shared` (pure types, zero deps)
- `packages/midcurve-services/`    → `@midcurve/services` (business logic, Prisma)
- `packages/midcurve-api-shared/`  → `@midcurve/api-shared` (API types, Zod schemas)
- `packages/midcurve-database/`    → `@midcurve/database` (Prisma schema, single source of truth)
- `apps/midcurve-ui/`              → Vite SPA (React 19, TailwindCSS 4, RainbowKit)
- `apps/midcurve-api/`             → Next.js 15 REST API
- `apps/midcurve-automation/`      → Price monitor + order executor (RabbitMQ)
- `apps/midcurve-onchain-data/`    → Real-time blockchain event subscriptions (WebSocket, RabbitMQ publisher)
- `apps/midcurve-business-logic/`  → Event-driven rules + scheduled tasks (RabbitMQ consumer, node-cron)
- `apps/midcurve-signer/`          → Transaction signing service
- `apps/midcurve-contracts/`       → Solidity smart contracts (Foundry, Diamond proxy, MidcurveSwapRouter)

## Key Conventions
- Import types from `@midcurve/shared`, NEVER from `@prisma/client` directly
- Use `viem` for all EVM interactions, never ethers.js
- Frontend uses only `VITE_API_URL` and `VITE_WALLETCONNECT_PROJECT_ID`
- Use `workspace:*` protocol for internal package references
- Prisma schema lives in `packages/midcurve-database/prisma/schema.prisma`
- English-only frontend (no i18n)

## Database Migrations
```bash
cd packages/midcurve-database
pnpm db:migrate:dev --name migration_name
pnpm db:studio  # Inspect database
```

## Architecture Docs
For detailed architecture, auth flows, and design decisions:
see [docs/architecture.md](docs/architecture.md) and package-level CLAUDE.md files.

Product philosophy and risk framework: [docs/philosophy.md](docs/philosophy.md)

## Common Gotchas
- "Multiple Prisma clients" → services uses peer dependency pattern
- Package changes not reflected → run `pnpm build` in the package

## Commit Format
Conventional commits: `feat|fix|refactor|docs|chore: short description`
