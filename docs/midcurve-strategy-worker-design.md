# Midcurve Strategy Worker - Design Document

## 1. Overview

The Strategy Worker is a long-running backend process (e.g. ECS Fargate task) that:

- Subscribes to **market data** (1m OHLC from Hyperliquid).
- Listens to **on-chain position/pool events**.
- Processes **user actions** (e.g. increase position, close, collect).
- Coordinates **effects** (swaps, liquidity changes, hedges) via an Effect Executor.
- Executes **strategy logic** for many strategies in parallel while keeping **strict ordering per strategy**.

Core idea:
> *Each strategy is an autonomous state machine with its own wallet, local state and event stream.*

## 2. Monorepo Integration

- `packages/midcurve-services`
  - Contains domain logic, types and runtime components:
    - `StrategyImplementation`, `StrategyEvent`, `StrategyRuntimeApi`
    - `StrategyRuntime` (per-strategy mailbox, event processing)
    - Marketdata adapters (HyperliquidCandleFeed), effect types, etc.

- `apps/midcurve-worker`
  - Deployable app (Fargate service).
  - Wires:
    - Hyperliquid WS client
    - On-chain event listener(s)
    - Funding / user action ingress
    - StrategyRuntime
    - Effect Executor integration
  - Provides optional HTTP health endpoint for ECS.

The worker is the **orchestrator**; `midcurve-services` contains the **business logic**.

## 3. Strategy Model

### 3.1 Strategy Wallet

- Each strategy owns exactly one **EVM wallet**.
- Private key is held in **KMS/HSM**, never leaves the secure store.
- All on-chain positions related to this strategy use that wallet as `owner`.

```ts
interface StrategyRecord {
  strategyId: string;
  strategyType: StrategyType;

  userId: string;
  strategyWalletKeyId: string;

  strategyIntentSignature: string;
  strategyIntentPayload: {
    config: unknown;
    allowedCurrencies: string[];
    allowedEffects: string[];
  };

  strategyState: 'active' | 'closed';
  localStateJson: unknown;
}
```

### 3.2 Local vs External State

- **Local state**: mutated by strategy logic.
- **External state**: read-only metadata like pool state, OHLC, funding.

```ts
interface StrategyContext<TConfig, TLocalState, TExternalState> {
  strategyId: string;
  strategyType: StrategyType;
  userId: string;

  config: TConfig;
  localState: TLocalState;
  externalState: TExternalState;

  event: StrategyEvent;
  api: StrategyRuntimeApi;
}
```

## 4. Events

### 4.1 Types

```ts
type StrategyEventType =
  | 'ohlc'
  | 'funding'
  | 'position'
  | 'effect'
  | 'action';
```

### 4.2 OHLC Events

```ts
interface OhlcStrategyEvent {
  eventType: 'ohlc';
  strategyId: string;
  ts: number;
  symbol: string;
  timeframe: '1m';
  ohlc: { open:number; high:number; low:number; close:number; volume:number; };
}
```

### 4.3 Funding Events

```ts
interface FundingStrategyEvent {
  eventType: 'funding';
  strategyId: string;
  ts: number;
  fundingEventType: 'deposit' | 'withdraw';
  amount: string;
  asset: string;
  txId: string;
}
```

### 4.4 Position Events

```ts
interface PositionStrategyEvent {
  eventType: 'position';
  strategyId: string;
  ts: number;
  positionEventType: 'increaseLiquidity' | 'decreaseLiquidity' | 'collect';
  positionId: string;
  payload: unknown;
}
```

### 4.5 Effect Events

```ts
interface EffectStrategyEvent {
  eventType: 'effect';
  strategyId: string;
  ts: number;
  effectEventType: 'success' | 'error' | 'timeout';
  effectId: string;
  result?: unknown;
  error?: unknown;
}
```

### 4.6 Action Events

```ts
type StrategyActionType =
  | 'deposit'
  | 'withdraw'
  | 'increasePosition'
  | 'decreasePosition'
  | 'closePosition'
  | 'collect'
  | 'compound'
  | 'rebalance';

interface ActionStrategyEvent {
  eventType: 'action';
  strategyId: string;
  ts: number;
  actionId: string;
  actionType: StrategyActionType;
  payload: unknown;
}
```

## 5. User Actions

### 5.1 Database

```ts
type StrategyActionStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'executing'
  | 'finished'
  | 'errored';

interface StrategyActionRecord {
  actionId: string;
  strategyId: string;
  userId: string;

  actionType: StrategyActionType;
  payload: unknown;

  actionIntentSignature: string;
  actionIntentPayload: unknown;

  status: StrategyActionStatus;
  createdAt: number;
  updatedAt: number;
}
```

### 5.2 Action Flow

- User submits -> API validates -> record stored.
- Worker turns ActionRecord into `ActionStrategyEvent`.
- Strategy consumes event in `run()`.
- Strategy may call `startEffect()`, track effectId in localState.
- On effect result, strategy updates state accordingly.

## 6. Strategy Runtime & API

### 6.1 StrategyImplementation

```ts
interface StrategyImplementation<TConfig, TLocalState, TExternalState> {
  strategyType: StrategyType;

  run(args:{
    strategyId:string;
    strategyType:StrategyType;
    userId:string;

    config:TConfig;
    localState:TLocalState;
    externalState:TExternalState;

    event:StrategyEvent;
    api:StrategyRuntimeApi;
  }): Promise<TLocalState>;
}
```

### 6.2 StrategyRuntimeApi

```ts
interface StrategyRuntimeApi {
  startEffect(input:{
    effectType:string;
    payload:unknown;
    timeoutMs?:number;
  }): string;

  subscribeOhlc?(input:{symbol:string; timeframe:'1m'}):void;
  unsubscribeOhlc?(input:{symbol:string; timeframe:'1m'}):void;
}
```

### 6.3 Per-strategy mailbox

Each strategyId has a serial event queue guaranteeing ordering.

## 7. Effects & Executor

### 7.1 PendingEffects

```ts
interface StrategyPendingEffect {
  effectId:string;
  effectType:string;
  createdAt:number;
  timeoutAt?:number;
  status:'pending'|'finished'|'errored'|'timedOut';
}
```

### 7.2 EffectRequest

```ts
interface EffectRequest {
  effectId:string;
  strategyId:string;
  strategyWalletKeyId:string;
  effectType:string;
  payload:unknown;
}
```

### 7.3 EffectResult

```ts
interface EffectResultEvent {
  strategyId:string;
  effectId:string;
  eventType:'effect';
  effectEventType:'success'|'error'|'timeout';
  result?:unknown;
  error?:unknown;
}
```

## 8. Event Publishers

### 8.1 OHLC Provider

- Subscribes to Hyperliquid WS.
- Tracks subscriptions per strategy.
- Emits `OhlcStrategyEvent`.

### 8.2 Position Provider

- Subscribes onChain:
  - increaseLiquidity
  - decreaseLiquidity
  - collect
- Maps position -> strategy and emits `PositionStrategyEvent`.

### 8.3 Funding Provider

- Emits deposit/withdraw events.

### 8.4 Effect Executor

- Executes effects.
- Emits `EffectResultEvent`.

## 9. Deployment Model

- ECS Fargate running `apps/midcurve-worker`.
- Outbound to Hyperliquid WS, RPC endpoints.
- Uses KMS for signing.
- May use SNS/SQS for event queues.

## 10. Scaling & Future Extensions

- Start: single worker.
- Future: SNS/SQS FIFO with MessageGroupId=strategyId.
- Optional split:
  - marketdata-worker
  - strategy-worker
  - effect-executor

- Add timers, metrics, DLQs, idempotency later.

---

## 11. Data Model: Strategy-Position Relationship

Strategies are first-class citizens like positions. The relationship model:

```
User (1) ──────────────────────────────────────┐
  │                                             │
  │ userId                                      │ userId
  ▼                                             ▼
Strategy (N) ◄──── StrategyPosition ────► Position (M)
  │                 (join table)
  │ automationWalletId
  ▼
EvmAutomationWallet (1 per strategy)
```

- **User owns strategies** (user.strategies)
- **User owns positions** (position.userId) - positions always belong to user
- **Strategy manages positions** via StrategyPosition join table
- **1 strategy -> many positions** (concurrent or sequential)
- **1 position -> 1 strategy** (or none, for manually managed positions)

---

## 12. Future Outlook

### 12.1 Strategy Metrics & Ledger (Similar to Position)

Strategies will have their own financial tracking, mirroring the Position pattern:

```ts
// Future: StrategyLedgerEvent - tracks strategy-level financial events
interface StrategyLedgerEvent<S extends StrategyType> {
  id: string;
  strategyId: string;
  eventType: StrategyLedgerEventType;  // 'OPEN', 'DEPOSIT', 'WITHDRAW', 'FEE', etc.
  timestamp: Date;

  // Financial deltas (strategy-level, aggregated from positions)
  deltaCostBasis: bigint;
  deltaRealizedPnl: bigint;
  deltaFees: bigint;

  // State after event
  costBasisAfter: bigint;
  realizedPnlAfter: bigint;
  totalFeesAfter: bigint;
}

// Future: StrategyAprPeriod - APR calculations per period
interface StrategyAprPeriod {
  strategyId: string;
  periodStart: Date;
  periodEnd: Date;
  apr: number;
  // ... similar to PositionAprPeriod
}
```

### 12.2 Hedge Redesign - Hedges as Positions Within Strategies

The current hedge data model is insufficient. Future redesign direction:

- **Hedges become first-class positions** within strategies (not separate entities)
- Strategy manages multiple "sub-positions": CL positions + hedge positions
- Unified PnL/APR calculation across all sub-positions
- Example: `BasicHedgedUniswapV3Strategy` manages:
  - 1 Uniswap V3 CL position
  - 1 Hyperliquid perpetual short position (the "hedge")
  - Strategy-level metrics aggregate both

### 12.3 Generalized Intent Concept

Unify `StrategyIntentV1` and action intents into a general `Intent` framework:

```ts
// Future: Generalized intent that covers both strategy creation and actions
interface Intent<T extends IntentType> {
  id: string;
  intentType: T;  // 'strategy' | 'action' | 'withdrawal' | etc.

  // Authorization scope
  allowedCurrencies: AllowedCurrency[];
  allowedEffects: AllowedEffect[];

  // Type-specific payload
  payload: IntentPayloadMap[T];

  // Signature
  signature: string;
  signer: string;
}

// Enables: Same EIP-712 infrastructure for all user authorizations
```

This generalization will allow:
- Unified EIP-712 signing infrastructure
- Consistent permission model across all user-initiated operations
- Reusable intent verification logic
