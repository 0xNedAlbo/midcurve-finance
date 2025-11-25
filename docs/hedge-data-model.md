# Hedge Data Model

The Hedge Data Model provides a type-safe, protocol-agnostic architecture for tracking hedging instruments linked to concentrated liquidity positions. Currently supports Hyperliquid perpetual shorts, extensible to options, spot shorts, and other derivatives.

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Hedge Data Model                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    Position (CL Position)                       │ │
│  │   - userId                                                      │ │
│  │   - poolId                                                      │ │
│  │   - protocol: 'uniswapv3'                                      │ │
│  │   - config: UniswapV3Config                                    │ │
│  │   - state: UniswapV3State                                      │ │
│  └───────────────────────┬────────────────────────────────────────┘ │
│                          │ 1:n                                       │
│                          ▼                                           │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                         Hedge                                   │ │
│  │   - positionId (FK)                                            │ │
│  │   - hedgeType: 'hyperliquid-perp'                              │ │
│  │   - protocol: 'hyperliquid'                                    │ │
│  │   - config: HyperliquidPerpHedgeConfig (JSON)                  │ │
│  │   - state: HyperliquidPerpHedgeState (JSON)                    │ │
│  └───────────────────────┬────────────────────────────────────────┘ │
│                          │ 1:n                                       │
│                          ▼                                           │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    HedgeLedgerEvent                             │ │
│  │   - hedgeId (FK)                                               │ │
│  │   - eventType: 'OPEN' | 'INCREASE' | 'DECREASE' | ...          │ │
│  │   - deltaNotional, deltaCostBasis, deltaRealizedPnl            │ │
│  │   - config: HyperliquidHedgeLedgerEventConfig (JSON)           │ │
│  │   - state: HyperliquidHedgeLedgerEventState (JSON)             │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                     HedgeSyncState (1:1)                        │ │
│  │   - hedgeId (FK, unique)                                       │ │
│  │   - lastSyncAt                                                 │ │
│  │   - state: Protocol-specific sync metadata (JSON)              │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Database Schema (Prisma)

### Hedge Model

```prisma
model Hedge {
    id        String   @id @default(cuid())
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt

    // Ownership
    userId String
    user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

    // Required position reference (1 Position -> n Hedges)
    positionId String
    position   Position @relation(fields: [positionId], references: [id], onDelete: Cascade)

    // Classification
    hedgeType String // 'hyperliquid-perp', future: 'option', 'spot-short'
    protocol  String // 'hyperliquid', future: 'deribit', 'binance'

    // Financial data (stored as string for bigint precision)
    notionalValue String // current hedge notional in quote units
    costBasis     String
    realizedPnl   String
    unrealizedPnl String
    currentApr    Float  // positive or negative APR, 0 if unavailable

    // Lifecycle
    isActive Boolean   @default(true)
    openedAt DateTime
    closedAt DateTime?

    // Protocol-specific data (JSON)
    config Json // immutable: HyperliquidPerpHedgeConfig
    state  Json // mutable: HyperliquidPerpHedgeState

    // Relations
    ledgerEvents HedgeLedgerEvent[]
    syncState    HedgeSyncState?

    @@index([userId])
    @@index([positionId])
    @@index([protocol])
    @@index([hedgeType])
    @@index([isActive])
    @@map("hedges")
}
```

### HedgeLedgerEvent Model

```prisma
model HedgeLedgerEvent {
    id        String   @id @default(cuid())
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt

    // Hedge reference
    hedgeId String
    hedge   Hedge  @relation(fields: [hedgeId], references: [id], onDelete: Cascade)

    // Event identification
    timestamp DateTime
    eventType String   // 'OPEN', 'INCREASE', 'DECREASE', 'CLOSE', 'FUNDING', 'FEE', 'LIQUIDATION'
    inputHash String   @unique // deduplication hash

    // Financial deltas (stored as string for bigint precision)
    deltaNotional    String
    deltaCostBasis   String
    deltaRealizedPnl String
    deltaMargin      String?

    // Token changes and protocol-specific data
    tokenAmounts Json // array of { tokenId, tokenAmount, tokenValue }
    config       Json // protocol-specific config (tx, block, etc.)
    state        Json // raw event payload

    @@index([hedgeId, timestamp])
    @@index([eventType])
    @@index([inputHash])
    @@map("hedge_ledger_events")
}
```

### HedgeSyncState Model

```prisma
model HedgeSyncState {
    id        String   @id @default(cuid())
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt

    // Hedge reference (1:1)
    hedgeId String @unique
    hedge   Hedge  @relation(fields: [hedgeId], references: [id], onDelete: Cascade)

    // Sync tracking
    lastSyncAt DateTime?
    lastSyncBy String?   // 'user-refresh', 'auto-refresh'

    // Protocol-specific sync state (JSON)
    state Json

    @@index([lastSyncAt])
    @@map("hedge_sync_states")
}
```

## TypeScript Types

### Type Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    @midcurve/shared Types                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  hedge-config.ts                                                     │
│  ├── HedgeType = keyof HedgeConfigMap                               │
│  ├── HedgeProtocol = 'hyperliquid' | ...                            │
│  └── HedgeConfigMap (mapped types for type safety)                  │
│                                                                      │
│  hedge.ts                                                            │
│  ├── Hedge<H extends HedgeType>                                     │
│  ├── HyperliquidPerpHedge = Hedge<'hyperliquid-perp'>               │
│  ├── AnyHedge = Hedge<HedgeType>                                    │
│  └── Type guards: isHyperliquidPerpHedge()                          │
│                                                                      │
│  hedge-ledger-event.ts                                               │
│  ├── HedgeEventType = 'OPEN' | 'INCREASE' | ...                     │
│  ├── HedgeTokenAmount                                               │
│  └── HedgeLedgerEvent                                               │
│                                                                      │
│  hyperliquid/                                                        │
│  ├── hedge-config.ts → HyperliquidPerpHedgeConfig                   │
│  ├── hedge-state.ts → HyperliquidPerpHedgeState                     │
│  └── hedge-ledger-event.ts → Event config/state types               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Generic Hedge Interface

```typescript
interface Hedge<H extends HedgeType> {
  // Identity
  id: string;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  positionId: string;

  // Classification
  hedgeType: H;
  protocol: string;

  // Financial data (bigint)
  notionalValue: bigint;
  costBasis: bigint;
  realizedPnl: bigint;
  unrealizedPnl: bigint;
  currentApr: number;

  // Lifecycle
  isActive: boolean;
  openedAt: Date;
  closedAt: Date | null;

  // Protocol-specific (type-safe via mapped types)
  config: HedgeConfigMap[H]['config'];
  state: HedgeConfigMap[H]['state'];
}
```

### HedgeConfigMap (Mapped Types)

```typescript
interface HedgeConfigMap {
  'hyperliquid-perp': {
    config: HyperliquidPerpHedgeConfig;
    state: HyperliquidPerpHedgeState;
    protocol: 'hyperliquid';
  };
  // Future hedge types:
  // 'deribit-option': { ... }
  // 'gmx-perp': { ... }
}

type HedgeType = keyof HedgeConfigMap;
type HedgeProtocol = 'hyperliquid'; // | 'deribit' | 'gmx';
```

## Hyperliquid Perpetual Types

### HyperliquidPerpHedgeConfig (Immutable)

Stored in `Hedge.config` JSON field. Set once at hedge creation.

```typescript
interface HyperliquidPerpHedgeConfig {
  schemaVersion: 1;
  exchange: 'hyperliquid';
  environment: 'mainnet' | 'testnet';
  dex: string; // '' for default perp DEX

  account: {
    userAddress: string;        // EVM address
    accountType: 'main' | 'subaccount' | 'apiWallet' | 'multiSig';
    subAccountName?: string;    // One per hedge
  };

  market: {
    coin: string;               // 'ETH', 'BTC'
    quote: string;              // 'USD'
    szDecimals?: number;
    maxLeverageHint?: number;
    marginTableId?: number;
  };

  hedgeParams: {
    direction: 'short';         // Always short for hedging
    marginMode: 'cross' | 'isolated';
    targetNotionalUsd: string;
    targetLeverage?: number;
    reduceOnly: boolean;
  };

  riskLimits?: {
    maxLeverage?: number;
    maxSizeUsd?: string;
    stopLossPx?: string;
    takeProfitPx?: string;
    rebalanceThresholdBps?: number;
  };

  links?: {
    positionProtocol?: 'uniswapv3';
    positionChainId?: number;
    positionPoolAddress?: string;
    positionNftId?: string;
  };
}
```

### HyperliquidPerpHedgeState (Mutable)

Stored in `Hedge.state` JSON field. Updated on each sync.

```typescript
interface HyperliquidPerpHedgeState {
  schemaVersion: 1;
  lastSyncAt: string;           // ISO timestamp
  lastSource: 'info.webData2' | 'info.clearinghouseState' | 'ws.webData2';
  positionStatus: 'none' | 'open' | 'closing' | 'closed' | 'liquidated';

  position?: {
    coin: string;
    szi: string;                // Signed size (Hyperliquid format)
    side: 'long' | 'short';
    absSize: string;
    entryPx: string;
    markPx?: string;
    indexPx?: string;
    liquidationPx?: string;

    value: {
      positionValue: string;
      unrealizedPnl: string;
      realizedPnl: string;
      returnOnEquity?: string;
    };

    leverage: {
      mode: 'cross' | 'isolated';
      value: number;
      maxLeverage?: number;
      marginUsed: string;
    };

    funding: {
      cumFundingAllTime: string;
      cumFundingSinceOpen: string;
      cumFundingSinceChange: string;
      currentFundingRate?: string;
    };

    lastChangeTime?: number;    // Milliseconds
  };

  orders: {
    open: HyperliquidOrder[];
    lastOrderCloid?: string;
  };

  accountSnapshot?: {
    accountValue: string;
    totalNtlPos: string;
    totalMarginUsed: string;
    withdrawable: string;
  };

  raw?: {
    lastWebData2?: unknown;
    lastClearinghouseState?: unknown;
  };
}
```

## Ledger Event Types

### Generic HedgeLedgerEvent

```typescript
interface HedgeLedgerEvent {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  hedgeId: string;
  timestamp: Date;

  eventType: 'OPEN' | 'INCREASE' | 'DECREASE' | 'CLOSE' | 'FUNDING' | 'FEE' | 'LIQUIDATION';
  inputHash: string;            // Deduplication

  // Financial deltas (bigint)
  deltaNotional: bigint;
  deltaCostBasis: bigint;
  deltaRealizedPnl: bigint;
  deltaMargin: bigint | null;

  // Token changes
  tokenAmounts: {
    tokenId: string;
    tokenAmount: string;
    tokenValue: string;
  }[];

  // Protocol-specific
  config: unknown;              // HyperliquidHedgeLedgerEventConfig
  state: unknown;               // HyperliquidHedgeLedgerEventState
}
```

### Hyperliquid Event Config

```typescript
interface HyperliquidHedgeLedgerEventConfig {
  market: string;
  fillId?: string;              // Trade fill ID
  orderId?: number;
  cloid?: string;
  txHash?: string;
  apiTimestamp?: number;
}
```

### Hyperliquid Event State (Discriminated Union)

```typescript
type HyperliquidHedgeLedgerEventState =
  | HyperliquidTradeEvent
  | HyperliquidFundingEvent
  | HyperliquidLiquidationEvent;

interface HyperliquidTradeEvent {
  eventType: 'TRADE';
  executionPx: string;
  size: string;
  fee: string;
  positionSizeAfter: string;
  side: 'buy' | 'sell';
  isLiquidation: boolean;
}

interface HyperliquidFundingEvent {
  eventType: 'FUNDING';
  fundingRate: string;
  fundingPayment: string;       // Positive = received, negative = paid
  positionSize: string;
  positionNotional: string;
}

interface HyperliquidLiquidationEvent {
  eventType: 'LIQUIDATION';
  liquidationPx: string;
  sizeLiquidated: string;
  liquidationLoss: string;
  insuranceFundContribution?: string;
}
```

## Type Guards

```typescript
import {
  isHyperliquidPerpHedge,
  assertHyperliquidPerpHedge,
  narrowHedgeType,
  isHyperliquidTradeEvent,
  isHyperliquidFundingEvent,
  isHyperliquidLiquidationEvent,
} from '@midcurve/shared';

// Check hedge type
if (isHyperliquidPerpHedge(hedge)) {
  // TypeScript knows hedge.config is HyperliquidPerpHedgeConfig
  console.log(hedge.config.market.coin);
}

// Assert hedge type (throws if wrong)
assertHyperliquidPerpHedge(hedge);

// Narrow to specific type
const hlHedge = narrowHedgeType(hedge, 'hyperliquid-perp');

// Check event type
if (isHyperliquidTradeEvent(eventState)) {
  console.log(eventState.executionPx);
}
```

## Relationships

```
User
 └── Hedge[] (1:n)
      ├── HedgeLedgerEvent[] (1:n)
      └── HedgeSyncState (1:1)

Position
 └── Hedge[] (1:n)
      └── positionId FK references Position.id
```

**Key Relationships:**
- **User → Hedge**: One user can have multiple hedges
- **Position → Hedge**: One position can have multiple hedges (e.g., different protocols)
- **Hedge → HedgeLedgerEvent**: One hedge has many events
- **Hedge → HedgeSyncState**: One-to-one for sync tracking

## Usage Examples

### Creating a Hedge

```typescript
import type { HyperliquidPerpHedge, HyperliquidPerpHedgeConfig } from '@midcurve/shared';

const config: HyperliquidPerpHedgeConfig = {
  schemaVersion: 1,
  exchange: 'hyperliquid',
  environment: 'mainnet',
  dex: '',
  account: {
    userAddress: '0x1234...',
    accountType: 'subaccount',
    subAccountName: 'hedge-eth-usdc-001',
  },
  market: {
    coin: 'ETH',
    quote: 'USD',
    szDecimals: 4,
  },
  hedgeParams: {
    direction: 'short',
    marginMode: 'cross',
    targetNotionalUsd: '10000',
    targetLeverage: 5,
    reduceOnly: false,
  },
  riskLimits: {
    maxLeverage: 10,
    rebalanceThresholdBps: 500, // 5%
  },
  links: {
    positionProtocol: 'uniswapv3',
    positionChainId: 1,
    positionPoolAddress: '0xABCD...',
    positionNftId: '12345',
  },
};
```

### Reading Hedge State

```typescript
import { isHyperliquidPerpHedge } from '@midcurve/shared';

function displayHedgeStatus(hedge: AnyHedge) {
  if (!isHyperliquidPerpHedge(hedge)) return;

  const { state } = hedge;

  console.log(`Status: ${state.positionStatus}`);

  if (state.position) {
    console.log(`Size: ${state.position.absSize} ${state.position.coin}`);
    console.log(`Entry: $${state.position.entryPx}`);
    console.log(`Mark: $${state.position.markPx}`);
    console.log(`PnL: $${state.position.value.unrealizedPnl}`);
    console.log(`Funding: $${state.position.funding.cumFundingSinceOpen}`);
  }
}
```

### Processing Ledger Events

```typescript
import {
  isHyperliquidTradeEvent,
  isHyperliquidFundingEvent,
} from '@midcurve/shared';

function processEvent(event: HedgeLedgerEvent) {
  const state = event.state as HyperliquidHedgeLedgerEventState;

  if (isHyperliquidTradeEvent(state)) {
    console.log(`Trade: ${state.side} ${state.size} @ ${state.executionPx}`);
    console.log(`Fee: $${state.fee}`);
  } else if (isHyperliquidFundingEvent(state)) {
    console.log(`Funding: $${state.fundingPayment}`);
    console.log(`Rate: ${state.fundingRate}`);
  }
}
```

## Extending for New Protocols

### 1. Add Protocol Types

```typescript
// packages/midcurve-shared/src/types/deribit/hedge-config.ts
export interface DeribitOptionHedgeConfig {
  schemaVersion: 1;
  exchange: 'deribit';
  instrument: string;           // 'ETH-PERPETUAL', 'BTC-28JUN24-50000-C'
  // ... protocol-specific fields
}

// packages/midcurve-shared/src/types/deribit/hedge-state.ts
export interface DeribitOptionHedgeState {
  schemaVersion: 1;
  // ... protocol-specific fields
}
```

### 2. Update HedgeConfigMap

```typescript
// packages/midcurve-shared/src/types/hedge-config.ts
export interface HedgeConfigMap {
  'hyperliquid-perp': {
    config: HyperliquidPerpHedgeConfig;
    state: HyperliquidPerpHedgeState;
    protocol: 'hyperliquid';
  };
  'deribit-option': {
    config: DeribitOptionHedgeConfig;
    state: DeribitOptionHedgeState;
    protocol: 'deribit';
  };
}

export type HedgeProtocol = 'hyperliquid' | 'deribit';
```

### 3. Add Type Alias and Guard

```typescript
// packages/midcurve-shared/src/types/hedge.ts
export type DeribitOptionHedge = Hedge<'deribit-option'>;

export function isDeribitOptionHedge(
  hedge: AnyHedge
): hedge is DeribitOptionHedge {
  return hedge.hedgeType === 'deribit-option';
}
```

## Design Decisions

### Why JSON for Protocol-Specific Data?

1. **Flexibility**: Add new protocols without database migrations
2. **Type Safety**: TypeScript interfaces enforce structure at compile time
3. **Schema Versioning**: `schemaVersion` field enables runtime migrations
4. **Query Support**: PostgreSQL JSON operators for efficient queries

### Why Separate Config and State?

1. **Config** = Immutable, set at creation (account, market, parameters)
2. **State** = Mutable, updated on sync (position, orders, prices)
3. **Clear Boundaries**: Know what can change and what can't
4. **Audit Trail**: Config never changes, state changes are tracked via ledger events

### Why Delta-Based Ledger Events?

1. **Append-Only**: Events are never modified, only added
2. **Audit Trail**: Complete history of all financial changes
3. **Deduplication**: `inputHash` prevents duplicate events
4. **Reconstruction**: Can rebuild current state from events

### Why Link Hedges to Positions?

1. **Context**: Every hedge exists to offset risk from a specific position
2. **Correlation**: Track combined PnL of position + hedge
3. **Lifecycle**: When position closes, hedges can be evaluated/closed
4. **Reporting**: Unified view of hedged vs. unhedged positions
