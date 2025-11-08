# @midcurve/ui - Architecture Documentation

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Architecture Patterns](#architecture-patterns)
5. [State Management](#state-management)
6. [Styling System](#styling-system)
7. [Web3 Integration](#web3-integration)
8. [Authentication](#authentication)
9. [Data Fetching](#data-fetching)
10. [Monorepo Integration](#monorepo-integration)
11. [Development Workflow](#development-workflow)
12. [Adding New Features](#adding-new-features)
13. [Best Practices](#best-practices)

---

## Overview

**@midcurve/ui** is the frontend application for Midcurve Finance, built with Next.js 15 and React 19. It provides a modern, type-safe interface for monitoring and managing concentrated liquidity positions across multiple DEX protocols.

**Key Design Decisions:**
- **English-only** (no i18n complexity)
- **No global state store** (no Zustand - uses TanStack Query + React Context)
- **Server-first architecture** (leverages Next.js App Router and server components)
- **Type-safe** (strict TypeScript with full coverage)
- **Glassmorphism design** (modern UI with backdrop blur effects)
- **OKLCH colors** (perceptually uniform color space)

---

## Technology Stack

### Framework & Runtime

**Next.js 15.5.2**
- App Router (file-based routing)
- Server components by default
- API routes for backend proxying
- Automatic code splitting
- Image optimization

**React 19.1.0**
- Server components
- Automatic batching
- Transitions API
- Latest hooks and features

**TypeScript 5.x**
- Strict mode enabled
- Path aliases (`@/*` → `./src/*`)
- Full type coverage

### Styling

**Tailwind CSS 4**
- Utility-first CSS framework
- PostCSS plugin architecture
- JIT (Just-In-Time) compilation
- Dark mode support via `class` strategy

**Additional Styling Tools:**
- `class-variance-authority` - Type-safe component variants
- `clsx` - Conditional class names
- `tailwind-merge` - Merge Tailwind classes without conflicts
- `tw-animate-css` - Additional animation utilities

**Color System:**
- OKLCH color space (perceptually uniform)
- CSS custom properties for theming
- Light and dark mode themes

### Web3 Stack

**Wagmi 2.16.9**
- React hooks for Ethereum
- Multi-chain support
- Type-safe contract interactions
- SSR compatibility

**Viem 2.37.3**
- Modern Ethereum JavaScript client
- Type-safe ABI interactions
- EIP-55 address checksumming
- Lightweight alternative to ethers.js

**RainbowKit 2.2.8**
- Beautiful wallet connection UI
- Support for 100+ wallets
- Dark mode compatible
- Customizable theming

**Uniswap V3 SDK 3.25.2**
- Position management utilities
- Price and liquidity calculations
- Tick math helpers

**SIWE 3.0.0**
- Sign-In with Ethereum (EIP-4361)
- Wallet-based authentication
- Message signing and verification

### State Management

**TanStack Query 5.87.1**
- Server state management
- Automatic caching and background refetching
- Optimistic updates
- Query invalidation and prefetching
- DevTools for debugging

**React Context API**
- Auth session state (NextAuth)
- Minimal client-side state

**NO Zustand** (Deliberately excluded)
- Simplified architecture
- Server-driven state preferred
- No global store complexity

### UI Libraries

**Recharts 3.1.2**
- Data visualization library
- PnL curve charts
- Analytics dashboards
- React-native rendering

**Lucide React 0.542.0**
- Modern icon library
- Tree-shakeable
- Consistent design
- 1000+ icons

### Authentication

Authentication is handled entirely by the **@midcurve/api** backend:
- API provides SIWE (Sign-In with Ethereum) endpoints
- API creates and validates JWT session tokens
- UI stores token and includes in API requests
- No NextAuth in UI (pure frontend architecture)

### Logging

**Pino 9.9.5**
- Structured logging
- High-performance JSON logger
- Pretty printing in development

---

## Project Structure

```
midcurve-ui/
├── src/
│   ├── app/                      # Next.js App Router
│   │   ├── layout.tsx            # Root layout with providers
│   │   ├── page.tsx              # Landing page
│   │   ├── globals.css           # Global styles & theme variables
│   │   ├── dashboard/            # Dashboard pages (future)
│   │   ├── positions/            # Position management (future)
│   │   ├── api-keys/             # API key management (future)
│   │   └── api/                  # API routes (proxies to @midcurve/api)
│   │
│   ├── components/               # React components
│   │   ├── ui/                   # Base UI components
│   │   │   ├── button.tsx        # Button variants (future)
│   │   │   ├── input.tsx         # Form inputs (future)
│   │   │   └── card.tsx          # Card container (future)
│   │   ├── charts/               # Data visualization
│   │   │   ├── pnl-curve.tsx     # PnL curve chart (future)
│   │   │   └── fee-chart.tsx     # Fee analytics (future)
│   │   ├── positions/            # Position components
│   │   │   ├── position-card.tsx # Position display (future)
│   │   │   └── position-list.tsx # Position list (future)
│   │   └── layout/               # Layout components
│   │       ├── header.tsx        # Main header (future)
│   │       ├── sidebar.tsx       # Navigation sidebar (future)
│   │       └── footer.tsx        # Footer (future)
│   │
│   ├── hooks/                    # Custom React hooks
│   │   ├── use-positions.ts      # Position data hooks (future)
│   │   ├── use-pools.ts          # Pool data hooks (future)
│   │   └── use-tokens.ts         # Token data hooks (future)
│   │
│   ├── providers/                # React context providers
│   │   ├── web3-provider.tsx     # Wagmi + RainbowKit setup
│   │   └── query-provider.tsx    # TanStack Query setup
│   │
│   ├── lib/                      # Utilities and configurations
│   │   ├── wagmi.ts              # Wagmi configuration
│   │   ├── api-client/           # API client (future)
│   │   │   ├── index.ts          # HTTP client wrapper
│   │   │   └── errors.ts         # Error handling
│   │   └── utils.ts              # Helper functions
│   │
│   ├── config/                   # Application configuration
│   │   └── chains.ts             # Chain configurations (future)
│   │
│   └── types/                    # TypeScript type definitions
│       └── global.d.ts           # Global type declarations (future)
│
├── public/                       # Static assets
│   ├── favicon.ico
│   └── images/                   # Image assets
│
├── scripts/                      # Build and utility scripts
│   └── sync-prisma-schema.js     # Sync Prisma schema from services
│
├── .env.example                  # Environment variables template
├── .gitignore                    # Git ignore rules
├── next.config.ts                # Next.js configuration
├── postcss.config.mjs            # PostCSS configuration
├── tailwind.config.ts            # Tailwind CSS configuration
├── tsconfig.json                 # TypeScript configuration
├── package.json                  # Dependencies and scripts
├── README.md                     # User-facing documentation
└── CLAUDE.md                     # This file (architecture docs)
```

### Directory Conventions

**`app/` - Next.js App Router**
- File-based routing
- `layout.tsx` - Shared layouts
- `page.tsx` - Route pages
- `loading.tsx` - Loading states
- `error.tsx` - Error boundaries
- Server components by default (add `'use client'` for client components)

**`components/` - React Components**
- Organized by feature domain
- Shared UI components in `ui/`
- Feature-specific in named directories

**`hooks/` - Custom React Hooks**
- Reusable stateful logic
- API data fetching hooks (wrapping TanStack Query)
- Form state management

**`providers/` - Context Providers**
- Global state providers
- Authentication, Web3, Query client setup
- Minimal - only what's needed at app root

**`lib/` - Utilities**
- Helper functions
- Configuration
- API clients
- Shared utilities

---

## Architecture Patterns

### 1. Provider Tree Pattern

The application uses a nested provider tree to supply global context:

```tsx
<QueryProvider>        // TanStack Query client
  <Web3Provider>       // Wagmi + RainbowKit
    {children}
  </Web3Provider>
</QueryProvider>
```

**Simple hierarchy:**
1. Query first (manages all server state and API communication)
2. Web3 second (wallet connection, uses query for balance fetching)

### 2. Server Component First

**Default:** Server components (no 'use client' directive)

**Benefits:**
- Automatic code splitting
- Zero JavaScript to client for static content
- Better performance
- SEO-friendly

**When to use client components:**
- Interactive elements (buttons, forms)
- Browser APIs (localStorage, window)
- React hooks (useState, useEffect)
- Event handlers

**Example:**
```tsx
// app/dashboard/page.tsx (Server Component)
export default async function DashboardPage() {
  // Can fetch data directly (no hooks needed)
  const positions = await fetchPositions();

  return <PositionList positions={positions} />; // Client component
}

// components/positions/position-list.tsx (Client Component)
'use client';
export function PositionList({ positions }: Props) {
  const [filter, setFilter] = useState('');
  // Interactive UI logic here
}
```

### 3. Data Fetching Patterns

**Server Components** (Preferred for initial data):
```tsx
// app/positions/page.tsx
export default async function PositionsPage() {
  const positions = await fetch('/api/positions').then(r => r.json());
  return <PositionList positions={positions} />;
}
```

**TanStack Query** (For client-side data):
```tsx
// hooks/use-positions.ts
export function usePositions() {
  return useQuery({
    queryKey: ['positions'],
    queryFn: async () => {
      const res = await fetch('/api/positions');
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });
}

// components/positions/position-list.tsx
'use client';
export function PositionList() {
  const { data, isLoading, error } = usePositions();
  // Render with loading/error states
}
```

### 4. Type Safety Pattern

**Import types from @midcurve/shared:**
```tsx
import type { Position, Pool, Token } from '@midcurve/shared';
import type { GetPositionsResponse } from '@midcurve/api-shared';
```

**Never use Prisma types in UI:**
```tsx
❌ import { Position } from '@prisma/client';
✅ import type { Position } from '@midcurve/shared';
```

---

## State Management

### Server State (TanStack Query)

**Use for:**
- API data (positions, pools, tokens)
- User data (profile, settings)
- Any data from backend

**Configuration:**
```tsx
// providers/query-provider.tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,  // 5 minutes
      retry: 3,
      refetchOnWindowFocus: true,
    },
  },
});
```

**Example hook:**
```tsx
// hooks/use-positions.ts
export function usePositions(userId?: string) {
  return useQuery({
    queryKey: ['positions', userId],
    queryFn: async () => {
      const url = userId
        ? `/api/positions?userId=${userId}`
        : '/api/positions';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch positions');
      return res.json() as Promise<Position[]>;
    },
    enabled: !!userId, // Only run if userId provided
  });
}
```

**Mutations:**
```tsx
export function useCreatePosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreatePositionData) => {
      const res = await fetch('/api/positions', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create');
      return res.json();
    },
    onSuccess: () => {
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ['positions'] });
    },
  });
}
```

### Client State (React Context)

**Use for:**
- Dark mode toggle
- UI preferences (minimal)
- Transient UI state

**Example:**
```tsx
// No global store needed for dark mode - use CSS class
// Just toggle class on <html> element
function toggleDarkMode() {
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'light' : 'dark');
}
```

### Auth State (API-based)

Authentication is managed by the API backend. The UI stores JWT tokens and includes them in requests:

```tsx
'use client';

// Future: Custom auth hook
export function useAuth() {
  const [token, setToken] = useState<string | null>(
    typeof window !== 'undefined' ? localStorage.getItem('authToken') : null
  );

  const signIn = async (message: string, signature: string) => {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/siwe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, signature }),
    });
    const { token } = await res.json();
    localStorage.setItem('authToken', token);
    setToken(token);
  };

  const signOut = () => {
    localStorage.removeItem('authToken');
    setToken(null);
  };

  return { token, signIn, signOut, isAuthenticated: !!token };
}
```

### Web3 State (Wagmi)

```tsx
'use client';
import { useAccount, useBalance } from 'wagmi';

export function WalletInfo() {
  const { address, isConnected } = useAccount();
  const { data: balance } = useBalance({ address });

  if (!isConnected) return <ConnectButton />;

  return <div>{address} has {balance?.formatted} ETH</div>;
}
```

---

## Styling System

### Tailwind CSS 4 Configuration

**Theme Structure** ([tailwind.config.ts](tailwind.config.ts)):

```ts
theme: {
  extend: {
    colors: {
      // All colors use OKLCH via CSS custom properties
      background: 'oklch(var(--background))',
      foreground: 'oklch(var(--foreground))',
      primary: {
        DEFAULT: 'oklch(var(--primary))',
        foreground: 'oklch(var(--primary-foreground))',
      },
      // ... more colors
    },
  },
}
```

### OKLCH Color System

**Why OKLCH?**
- Perceptually uniform (equal visual difference for equal numeric difference)
- Better interpolation than RGB/HSL
- Future-proof (CSS Color Level 4)
- Wide gamut support

**Format:** `oklch(Lightness Chroma Hue)`
- **Lightness:** 0-100% (0 = black, 100 = white)
- **Chroma:** 0-0.4+ (saturation)
- **Hue:** 0-360 degrees

**CSS Variables** ([globals.css](src/app/globals.css)):

```css
:root {
  --background: 100% 0 0;        /* White */
  --foreground: 20% 0 0;         /* Near black */
  --primary: 64% 0.16 271;       /* Blue */
}

.dark {
  --background: 20% 0 0;         /* Dark gray */
  --foreground: 98% 0 0;         /* Near white */
  --primary: 64% 0.16 271;       /* Same blue (stays consistent!) */
}
```

### Component Styling Patterns

**1. Utility Classes (Preferred):**
```tsx
<div className="flex items-center gap-4 p-6 rounded-lg bg-card">
  <h2 className="text-2xl font-semibold">Title</h2>
</div>
```

**2. Custom Utilities (globals.css):**
```css
@layer utilities {
  .glass {
    @apply bg-background/80 backdrop-blur-md border border-border/50;
  }
}
```

Usage:
```tsx
<div className="glass-card p-8">Glassmorphism effect</div>
```

**3. Component Variants (CVA):**
```tsx
// components/ui/button.tsx
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-input bg-background hover:bg-accent',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-10 px-4',
        lg: 'h-11 px-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

type ButtonProps = VariantProps<typeof buttonVariants> & {
  children: React.ReactNode;
};

export function Button({ variant, size, children }: ButtonProps) {
  return (
    <button className={buttonVariants({ variant, size })}>
      {children}
    </button>
  );
}
```

Usage:
```tsx
<Button variant="outline" size="lg">Click me</Button>
```

### Dark Mode

**Strategy:** `class` toggle on `<html>` element

**Implementation:**
```tsx
// Future: components/theme-toggle.tsx
'use client';
export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldBeDark = stored === 'dark' || (!stored && prefersDark);

    setIsDark(shouldBeDark);
    document.documentElement.classList.toggle('dark', shouldBeDark);
  }, []);

  const toggle = () => {
    const newDark = !isDark;
    setIsDark(newDark);
    document.documentElement.classList.toggle('dark', newDark);
    localStorage.setItem('theme', newDark ? 'dark' : 'light');
  };

  return <button onClick={toggle}>{isDark ? '🌞' : '🌙'}</button>;
}
```

---

## Web3 Integration

### Wagmi Configuration

**Setup** ([lib/wagmi.ts](src/lib/wagmi.ts)):

```ts
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { mainnet, arbitrum, base, bsc, polygon, optimism } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'Midcurve Finance',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
  chains: [mainnet, arbitrum, base, bsc, polygon, optimism],
  ssr: true, // IMPORTANT for Next.js
});
```

### Provider Setup

**Web3Provider** ([providers/web3-provider.tsx](src/providers/web3-provider.tsx)):

```tsx
'use client';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { config } from '@/lib/wagmi';

export function Web3Provider({ children }: Props) {
  return (
    <WagmiProvider config={config}>
      <RainbowKitProvider>{children}</RainbowKitProvider>
    </WagmiProvider>
  );
}
```

### Using Wagmi Hooks

**Wallet Connection:**
```tsx
'use client';
import { useAccount, useConnect, useDisconnect } from 'wagmi';

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) {
    return (
      <div>
        <p>{address}</p>
        <button onClick={() => disconnect()}>Disconnect</button>
      </div>
    );
  }

  return (
    <div>
      {connectors.map(connector => (
        <button key={connector.id} onClick={() => connect({ connector })}>
          {connector.name}
        </button>
      ))}
    </div>
  );
}
```

**Reading Contracts:**
```tsx
import { useReadContract } from 'wagmi';
import { erc20Abi } from 'viem';

export function TokenBalance({ tokenAddress, userAddress }: Props) {
  const { data: balance } = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [userAddress],
  });

  return <div>Balance: {balance?.toString()}</div>;
}
```

**Writing to Contracts:**
```tsx
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';

export function ApproveButton({ tokenAddress, spender, amount }: Props) {
  const { writeContract, data: hash } = useWriteContract();
  const { isLoading, isSuccess } = useWaitForTransactionReceipt({ hash });

  const approve = () => {
    writeContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, amount],
    });
  };

  return (
    <button onClick={approve} disabled={isLoading}>
      {isLoading ? 'Approving...' : isSuccess ? 'Approved!' : 'Approve'}
    </button>
  );
}
```

### RainbowKit Customization

**ConnectButton:**
```tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';

// Default
<ConnectButton />

// Custom
<ConnectButton.Custom>
  {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => (
    <div>
      {!mounted || !account || !chain ? (
        <button onClick={openConnectModal}>Connect Wallet</button>
      ) : (
        <div>
          <button onClick={openChainModal}>{chain.name}</button>
          <button onClick={openAccountModal}>{account.displayName}</button>
        </div>
      )}
    </div>
  )}
</ConnectButton.Custom>
```

---

## Authentication

### Architecture

Authentication is **fully handled by the @midcurve/api backend**. The UI is a pure frontend that:

1. Connects user's wallet (via RainbowKit/Wagmi)
2. Signs SIWE message with wallet
3. Sends signed message to API's `/api/auth/siwe` endpoint
4. Receives JWT token from API
5. Stores token (localStorage or httpOnly cookie)
6. Includes token in all subsequent API requests

### Future Implementation

**Sign-In Flow (to be implemented):**

```tsx
'use client';
import { useAccount, useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';

export function SignInButton() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const handleSignIn = async () => {
    if (!address) return;

    // 1. Get nonce from API
    const nonceRes = await fetch(`${API_URL}/api/auth/nonce`);
    const { nonce } = await nonceRes.json();

    // 2. Create SIWE message
    const message = new SiweMessage({
      domain: window.location.host,
      address,
      statement: 'Sign in to Midcurve Finance',
      uri: window.location.origin,
      version: '1',
      chainId: 1,
      nonce,
    });

    // 3. Sign message with wallet
    const signature = await signMessageAsync({
      message: message.prepareMessage(),
    });

    // 4. Send to API for verification
    const authRes = await fetch(`${API_URL}/api/auth/siwe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message.prepareMessage(),
        signature,
      }),
    });

    const { token } = await authRes.json();

    // 5. Store token
    localStorage.setItem('authToken', token);
  };

  return <button onClick={handleSignIn}>Sign In</button>;
}
```

**Authenticated API Requests:**

```tsx
// Include token in all API requests
const token = localStorage.getItem('authToken');

const response = await fetch(`${API_URL}/api/positions`, {
  headers: {
    'Authorization': `Bearer ${token}`,
  },
});
```

---

## Data Fetching

### API Client Pattern

**Future implementation** - type-safe API client:

```ts
// lib/api-client/index.ts
import type { GetPositionsResponse, GetPoolsResponse } from '@midcurve/api-shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

class ApiClient {
  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!res.ok) {
      throw new Error(`API error: ${res.statusText}`);
    }

    return res.json();
  }

  // Positions
  async getPositions() {
    return this.request<GetPositionsResponse>('/api/positions');
  }

  async getPosition(id: string) {
    return this.request<Position>(`/api/positions/${id}`);
  }

  // Pools
  async getPools() {
    return this.request<GetPoolsResponse>('/api/pools');
  }

  // ... more methods
}

export const apiClient = new ApiClient();
```

**Usage with TanStack Query:**
```tsx
// hooks/use-positions.ts
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export function usePositions() {
  return useQuery({
    queryKey: ['positions'],
    queryFn: () => apiClient.getPositions(),
  });
}
```

---

## Monorepo Integration

### Package Dependencies

**@midcurve/shared** (file: reference)
- Location: `../midcurve-shared`
- Linked via: `"@midcurve/shared": "file:../midcurve-shared"`
- Auto-updates when you rebuild shared package

**@midcurve/api-shared** (yalc)
- Published from: `midcurve-api-shared`
- Linked via: `npm run yalc:link:api-shared`
- Update: `npm run yalc:update`

**@midcurve/services** (yalc)
- Published from: `midcurve-services`
- Linked via: `npm run yalc:link:services`
- Used for: Prisma schema sync only
- Update: `npm run yalc:update`

### Prisma Schema Sync

**How it works:**

1. Services package maintains the schema
2. Postinstall hook runs `scripts/sync-prisma-schema.js`
3. Script copies schema from services to local `prisma/` directory
4. Prisma client generates locally

**Manual sync:**
```bash
node scripts/sync-prisma-schema.js
npm run prisma:generate
```

### Development Workflow

**When services or api-shared changes:**

```bash
# In services or api-shared repo
npm run build
npm run yalc:push

# In midcurve-ui
npm run yalc:update  # Fetches latest versions
npm install          # Triggers prisma sync if services changed
```

**If using yalc watch:**
```bash
# In services repo
npx yalc publish --watch

# Changes automatically propagate to consumers
```

---

## Development Workflow

### Initial Setup

```bash
# 1. Install dependencies
cd midcurve-ui
npm install

# 2. Link yalc packages
npm run yalc:link:api-shared
npm run yalc:link:services

# 3. Set up environment
cp .env.example .env
# Edit .env with your values

# 4. Generate Prisma client
npm run prisma:generate

# 5. Start development server
npm run dev
```

### Daily Development

```bash
# Start dev server with pretty logs
npm run dev:pretty

# In another terminal, run type checking on save
npm run typecheck -- --watch
```

### Before Committing

```bash
# Type check
npm run typecheck

# Lint
npm run lint

# Build check
npm run build
```

---

## Adding New Features

### Adding a New Page

1. **Create page file:**
   ```tsx
   // app/dashboard/page.tsx
   export default function DashboardPage() {
     return <div>Dashboard</div>;
   }
   ```

2. **Add layout (optional):**
   ```tsx
   // app/dashboard/layout.tsx
   export default function DashboardLayout({ children }) {
     return (
       <div className="dashboard-layout">
         <Sidebar />
         <main>{children}</main>
       </div>
     );
   }
   ```

### Adding a New Component

1. **Create component file:**
   ```tsx
   // components/positions/position-card.tsx
   import type { Position } from '@midcurve/shared';

   interface PositionCardProps {
     position: Position;
   }

   export function PositionCard({ position }: PositionCardProps) {
     return (
       <div className="glass-card p-6">
         <h3>{position.id}</h3>
         {/* ... */}
       </div>
     );
   }
   ```

2. **Use CVA for variants:**
   ```tsx
   import { cva } from 'class-variance-authority';

   const cardVariants = cva('glass-card', {
     variants: {
       size: {
         sm: 'p-4',
         md: 'p-6',
         lg: 'p-8',
       },
     },
   });

   export function PositionCard({ position, size = 'md' }: Props) {
     return <div className={cardVariants({ size })}>...</div>;
   }
   ```

### Adding a New API Hook

```tsx
// hooks/use-pools.ts
import { useQuery } from '@tanstack/react-query';
import type { Pool } from '@midcurve/shared';

export function usePools(chainId?: number) {
  return useQuery({
    queryKey: ['pools', chainId],
    queryFn: async () => {
      const url = chainId
        ? `/api/pools?chainId=${chainId}`
        : '/api/pools';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch pools');
      return res.json() as Promise<Pool[]>;
    },
    enabled: chainId !== undefined,
  });
}
```

---

## Best Practices

### TypeScript

✅ **DO:**
- Use strict mode
- Import types from @midcurve/shared
- Define explicit prop interfaces
- Use discriminated unions

❌ **DON'T:**
- Use `any` type
- Import Prisma types in UI
- Skip type definitions

### React

✅ **DO:**
- Prefer server components
- Use 'use client' only when needed
- Memoize expensive computations
- Use React 19 features (transitions, etc.)

❌ **DON'T:**
- Add 'use client' everywhere
- Use useEffect for data fetching (use TanStack Query)
- Prop drill more than 2 levels (use context)

### Styling

✅ **DO:**
- Use Tailwind utilities first
- Create custom utilities for repeated patterns
- Use CVA for component variants
- Follow dark mode color variables

❌ **DON'T:**
- Write custom CSS unless necessary
- Hardcode colors (use theme variables)
- Use inline styles
- Mix styling approaches

### State Management

✅ **DO:**
- Use TanStack Query for server state
- Use React Context sparingly
- Keep client state minimal
- Leverage server components

❌ **DON'T:**
- Add Zustand or other global stores
- Duplicate server state in client state
- Use useState for API data

### Performance

✅ **DO:**
- Use Next.js Image component
- Lazy load heavy components
- Implement proper loading states
- Use React Suspense

❌ **DON'T:**
- Import entire icon libraries
- Skip image optimization
- Block UI during data fetching

---

## Troubleshooting

### Common Issues

**Issue: "Module not found: @midcurve/shared"**
- **Solution:** Check that `file:../midcurve-shared` path is correct in package.json
- Run `npm install` to re-link

**Issue: "Multiple Prisma clients detected"**
- **Solution:** Delete `node_modules` and `package-lock.json`, then `npm install`

**Issue: "Prisma schema not found"**
- **Solution:** Run `node scripts/sync-prisma-schema.js && npm run prisma:generate`

**Issue: "Hydration mismatch"**
- **Solution:** Check for client-only code in server components. Add 'use client' directive.

**Issue: "WalletConnect errors"**
- **Solution:** Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` in .env

---

## Future Enhancements

### Planned Features

- [ ] Position dashboard with real-time updates
- [ ] PnL curve visualization (Recharts)
- [ ] Risk metrics and analytics
- [ ] Position rebalancing tools
- [ ] Multi-protocol support
- [ ] API key management UI
- [ ] Dark mode toggle component
- [ ] Notification system
- [ ] Mobile responsiveness improvements

### Architecture Improvements

- [ ] API client with full type safety
- [ ] Optimistic updates for mutations
- [ ] Error boundary components
- [ ] Loading skeleton components
- [ ] Storybook for component development
- [ ] E2E tests with Playwright
- [ ] Performance monitoring
- [ ] SEO optimization

---

## Summary

**@midcurve/ui** is a modern, type-safe frontend application built with:
- **Next.js 15 + React 19** for cutting-edge performance
- **TanStack Query** for intelligent server state management
- **Wagmi + RainbowKit** for best-in-class Web3 integration
- **Tailwind CSS 4** with OKLCH colors for beautiful, maintainable styling
- **NO global state store** for simplified architecture
- **TypeScript strict mode** for bulletproof type safety

The architecture prioritizes developer experience, performance, and maintainability while staying flexible for future growth.
