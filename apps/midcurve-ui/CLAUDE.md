# @midcurve/ui

Vite 6 SPA — React 19, TailwindCSS 4, React Router 7, TanStack Query 5.
NOT Next.js. Pure client-side rendering, served by nginx in production.

## Quick Commands
```bash
pnpm dev              # Vite dev server on :3000
pnpm build            # tsc + vite build → dist/
pnpm typecheck        # tsc --noEmit
pnpm test:e2e         # Playwright tests
```

## Directory Layout
```
src/
├── pages/            # Route components (HomePage, DashboardPage, PositionDetailPage, ...)
├── components/       # Feature-organized (positions/, automation/, swap/, ui/, common/)
├── hooks/            # React Query hooks by domain (positions/, pools/, tokens/, automation/, swap/)
├── providers/        # QueryProvider, Web3Provider, AuthProvider
├── lib/              # api-client, query-keys, format-helpers, math, position-helpers
├── config/           # chains, protocols, contract addresses, ABIs
├── styles/           # globals.css (Tailwind + OKLCH theme variables)
└── abis/             # Contract ABIs
```

## Key Patterns

**API Client** (`src/lib/api-client.ts`): Fetch wrapper with `credentials: 'include'` for cross-origin session cookies. Methods: `get<T>`, `post<T>`, `put<T>`, `patch<T>`, `delete<T>`.

**Hooks**: All server data via TanStack Query hooks in `src/hooks/`. Organized by domain (positions, pools, tokens, automation, swap). Use query key factory from `src/lib/query-keys.ts`.

**Providers**: `QueryProvider` > `AuthProvider` > `Web3Provider` > `BrowserRouter`.

**Routing**: React Router (`react-router-dom`). Routes defined in `App.tsx`. Key routes:
- `/dashboard` — position list
- `/positions/:protocol/:chain/:nftId` — position detail
- `/positions/create` — create wizard
- `/positions/triggers/:protocol/:chain/:nftId` — automation triggers

## State Management
- **Server state**: TanStack Query (staleTime: 5min, retry: 3)
- **Auth state**: Custom AuthProvider with `useAuth()` hook
- **Web3 state**: Wagmi hooks (`useAccount`, `useReadContract`, etc.)
- **NO global store** — no Zustand, no Redux. React Context only for auth/web3

## Web3 Stack
- **Wagmi + RainbowKit** for wallet connection and tx signing
- **SIWE** (Sign-In with Ethereum) for authentication
- **viem** for contract interactions (never ethers.js)

## Styling
- TailwindCSS 4 with OKLCH color variables in `globals.css`
- `class-variance-authority` (CVA) for component variants
- `clsx` + `tailwind-merge` for conditional classes
- All interactive elements need `cursor-pointer`

## Env Vars
```
VITE_API_URL                    # API base URL (empty = proxied via vite.config.ts)
VITE_WALLETCONNECT_PROJECT_ID   # Required for RainbowKit
VITE_ENABLE_LOCAL_CHAIN         # Optional: enable Anvil chain 31337
```

## Key Rules
- NO direct RPC calls from frontend — all blockchain reads go through API
- English-only, no i18n
- Import types from `@midcurve/shared` and `@midcurve/api-shared`
- Path alias: `@/` → `src/`
