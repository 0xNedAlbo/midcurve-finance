# Midcurve EVM

Embedded EVM for automated strategy execution using the durable await pattern.

## Purpose & Role

midcurve-evm is the **execution engine for automated liquidity strategies**. It provides:

1. **Bulletproof Sandbox** - User-provided strategy code runs in EVM bytecode, completely isolated from host
2. **Native State Persistence** - Strategy state lives in contract storage, no serialize/deserialize needed
3. **Free Freeze/Thaw** - Stopping a strategy = stop calling `step()`, state remains in contract
4. **Deterministic Execution** - Same inputs always produce same outputs (auditable, replayable)

### Role in Midcurve Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Midcurve Finance                                   │
│                                                                              │
│  ┌─────────────────┐     ┌──────────────────────┐     ┌──────────────────┐ │
│  │   midcurve-ui   │────▶│  midcurve-services   │────▶│   midcurve-evm   │ │
│  │                 │     │                      │     │                  │ │
│  │ - User dashboard│     │ - Strategy registry  │     │ - Geth node      │ │
│  │ - Strategy UI   │     │ - Position ledger    │     │ - Core orchestr. │ │
│  │ - Analytics     │     │ - Deployment service │     │ - Strategies     │ │
│  └─────────────────┘     └──────────────────────┘     └──────────────────┘ │
│          │                         │                           │            │
│          │                         │                           ▼            │
│          │                         │                  ┌──────────────────┐  │
│          ▼                         ▼                  │  External DEXes  │  │
│     PostgreSQL              RabbitMQ                  │  (Uniswap, etc.) │  │
│                                                       └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Data Flow:**
1. User creates strategy via UI → stored in services DB
2. Services calls Core API → deploys contract to private EVM
3. Core orchestrates strategy via `step()` → executes effects on external DEXes
4. Position changes recorded in services → displayed in UI

---

## Why EVM for User-Provided Code

The main reason for using smart contracts on a local EVM is that **user-provided code can be safely executed** because it is contained in the EVM sandbox.

### The Sandbox Problem

Running untrusted user code is dangerous. Common approaches have significant drawbacks:

| Approach | Sandbox Quality | State Persistence | Freeze/Thaw Cost | Drawbacks |
|----------|----------------|-------------------|------------------|-----------|
| **Deno Isolates** | Weak (jail-breakable) | Manual serialize/deserialize | Cheap | Security vulnerabilities discovered regularly |
| **Node.js in Docker** | Good | Volume mounts or DB | Very expensive | Container startup = seconds, state = complex |
| **WASM** | Good | Manual serialize/deserialize | Medium | No persistent state, limited stdlib |
| **Firecracker microVMs** | Excellent | Snapshot/restore | Expensive (~100ms) | Heavy infrastructure |
| **EVM (Solidity)** | **Bulletproof** | **Native (contract storage)** | **Free** | Learning curve, gas metering |

### Why EVM Wins

1. **Bulletproof Sandbox:**
   - EVM bytecode cannot access filesystem, network, or syscalls
   - 15+ years of adversarial testing (billions of dollars at stake)
   - No "jail break" vulnerabilities - the sandbox IS the execution model

2. **Native State Persistence:**
   - Strategy state lives in contract storage mappings
   - No serialize/deserialize code needed
   - State survives node restarts, redeployments

3. **Free Freeze/Thaw:**
   - Stopping a strategy = stop calling `step()`
   - State remains exactly where it was in contract storage
   - Resume = call `step()` again
   - No snapshots, no serialization, no container orchestration

4. **Deterministic & Auditable:**
   - Same inputs → same outputs (reproducible)
   - Full transaction history on chain
   - Simulation before commit (eth_call)

### The Trade-offs

- **Learning curve:** Users must write Solidity (mitigated by templates/mixins)
- **Gas metering:** Computation is metered (actually a feature - prevents infinite loops)
- **No network access:** Effects must be explicit (the durable await pattern)

---

## Why Private Chain (Not Public L2)

midcurve-evm uses a **private Geth node** rather than deploying to a public L2. Here's why:

| Concern | Private Chain | Public L2 |
|---------|--------------|-----------|
| **Transaction costs** | Free (self-hosted) | Gas fees per transaction |
| **Latency** | ~0ms (instant mining) | 100ms-2s (block time) |
| **Privacy** | Strategy logic hidden | Bytecode public |
| **Control** | Full control over consensus | Subject to L2 rules |
| **Finality** | Instant (single signer) | Depends on L2 mechanism |

**Key Insight:** Strategies don't need public verifiability - they need fast, cheap, private execution. The results (position changes) are committed to public chains via effects.

### Clique PoA Configuration

- **period=0:** Instant block mining (no waiting)
- **Single signer:** Midcurve controls the signer key
- **No gas costs:** Signer has unlimited ETH
- **Instant finality:** No reorgs possible

---

## Overview

midcurve-evm provides:
- **Geth node** with Clique PoA consensus (instant mining, period=0)
- **Strategy contracts** implementing durable await execution
- **Core orchestrator** with RabbitMQ-based event routing
- **Effect executors** for parallel off-chain effect processing

This package is part of the Midcurve Finance monorepo and imports `@midcurve/services` for database operations (position ledger, strategy registry).

## Architecture

### Durable Await Pattern

Strategies use a simulation-replay execution model that enables async/await-like behavior in Solidity:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Durable Await Flow                            │
│                                                                      │
│   1. Core calls step(event) via eth_call (simulation)               │
│   2. Strategy needs external data → reverts with EffectNeeded       │
│   3. Core catches revert, extracts effect request                   │
│   4. Effect executor fulfills effect off-chain                      │
│   5. Core calls submitEffectResult() to persist result              │
│   6. Core re-simulates step() - effect result now available         │
│   7. Repeat until simulation completes without reverting            │
│   8. Core sends step() as real TX to commit state                   │
│   9. Epoch increments, ready for next event                         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Insight:** The `EffectNeeded` error is NOT an event - it's returned via REVERT during `eth_call` simulation. This allows strategies to "pause" execution, request external work, and resume exactly where they left off.

### Account Roles

| Role | Purpose | Key Management |
|------|---------|----------------|
| **Signer** | Clique PoA block signing | Hardcoded in genesis extradata |
| **Operator** | Per-strategy automation wallet. Signs `step()`, `submitEffectResult()` | midcurve-signer KMS (1 per strategy) |
| **Core** | Midcurve administrative account. Signs `gcEpoch()`, fee collection | Environment variable or KMS |

**Important:** Signer and Core may be the same address in development (Foundry account 0), but Operator wallets are unique per strategy.

### Epoch-Based State Management

Each strategy maintains an `epoch` counter:
- Increments after each successful committed `step()`
- Effect results are namespaced by epoch
- Old epochs can be garbage collected via `gcEpoch()`

```solidity
// Effect results stored by epoch
mapping(uint64 => mapping(bytes32 => EffectResult)) internal _results;

// epoch=5, key=keccak256("ohlc_ETH_5m") → EffectResult{status, data}
```

---

## Solidity Contracts

### Contract Hierarchy

```
IStrategy (interface)
    └── BaseStrategy (abstract)
            ├── LoggingMixin (abstract)
            ├── OhlcMixin (abstract)
            └── ActionMixin (abstract)
                    └── LifecycleMixin (abstract)
                            └── ConcreteStrategy (user implements)
```

### IStrategy Interface

```solidity
interface IStrategy {
  // Signal that external work is needed (revert during simulation)
  error EffectNeeded(
    uint64 epoch,
    bytes32 idempotencyKey,
    bytes32 effectType,
    bytes payload
  );

  // Advance strategy state
  function step(bytes calldata input) external;

  // Persist effect result
  function submitEffectResult(
    uint64 epoch,
    bytes32 idempotencyKey,
    bool ok,
    bytes calldata data
  ) external;

  // Current epoch
  function epoch() external view returns (uint64);

  // Garbage collect old epoch data
  function gcEpoch(uint64 epochToSweep, uint256 maxItems)
    external returns (uint256 swept, bool done);
}
```

### BaseStrategy

Core implementation providing:
- **Auth:** `operator` and `core` addresses with modifiers
- **Effect storage:** `_results` mapping for durable effect data
- **`_awaitEffect()`:** The primitive that reverts with `EffectNeeded` if result missing
- **StepEvent decoding:** `eventType`, `eventVersion`, `payload` envelope

```solidity
function _awaitEffect(
  bytes32 idempotencyKey,
  bytes32 effectType,
  bytes memory payload
) internal view returns (AwaitStatus status, bytes memory data) {
  EffectResult storage r = _results[_epoch][idempotencyKey];

  if (r.status == EffectStatus.SUCCESS) return (AwaitStatus.READY_OK, r.data);
  if (r.status == EffectStatus.FAILED)  return (AwaitStatus.READY_FAILED, r.data);

  revert EffectNeeded(_epoch, idempotencyKey, effectType, payload);
}
```

### Mixins

| Mixin | Event Type | Purpose |
|-------|------------|---------|
| **ActionMixin** | `STEP_EVENT_ACTION` | User actions with nonce replay protection |
| **LifecycleMixin** | `STEP_EVENT_LIFECYCLE` | START/SHUTDOWN state machine |
| **LoggingMixin** | - | Logging as durable effects (`EFFECT_LOG`) |
| **OhlcMixin** | `STEP_EVENT_OHLC` | OHLC subscription and data handling |

---

## Strategy Lifecycle

### Overview

Every strategy follows a strict lifecycle managed by the `LifecycleMixin`. The lifecycle ensures:
- **Ordered startup:** Subscriptions are set up only after explicit START command
- **Graceful shutdown:** Resources are cleaned up before strategy stops
- **State persistence:** Lifecycle state is stored on-chain for recovery

### Lifecycle States

| State | On-Chain Value | Description |
|-------|----------------|-------------|
| **STOPPED** | 0 | Initial state after deployment. Strategy exists but is not processing events. |
| **RUNNING** | 1 | Active state. Strategy processes OHLC and other subscribed events. |
| **SHUTTING_DOWN** | 2 | Graceful shutdown in progress. Strategy is cleaning up resources. |
| **SHUTDOWN** | 3 | Final state. All resources released. Can be restarted. |

### State Machine

```
             DEPLOY
                │
                ▼
          ┌─────────┐
          │ STOPPED │◄─────────────────────────┐
          │   (0)   │                          │
          └────┬────┘                          │
               │                               │
               │ LIFECYCLE_START               │ (can restart)
               ▼                               │
          ┌─────────┐                          │
          │ RUNNING │                          │
          │   (1)   │                          │
          └────┬────┘                          │
               │                               │
               │ LIFECYCLE_SHUTDOWN            │
               ▼                               │
       ┌──────────────┐                        │
       │SHUTTING_DOWN │                        │
       │     (2)      │                        │
       └──────┬───────┘                        │
              │                                │
              │ onShutdownStep() → done=true   │
              ▼                                │
          ┌─────────┐                          │
          │SHUTDOWN │──────────────────────────┘
          │   (3)   │
          └─────────┘
```

### Lifecycle Event Type

Lifecycle commands use a dedicated event type (separate from user actions):

```solidity
bytes32 constant STEP_EVENT_LIFECYCLE = keccak256("STEP_EVENT_LIFECYCLE");
uint32 constant LIFECYCLE_EVENT_VERSION = 1;

bytes32 constant LIFECYCLE_START = keccak256("START");
bytes32 constant LIFECYCLE_SHUTDOWN = keccak256("SHUTDOWN");
```

**Payload format:** `abi.encode(lifecycleCommand)`

### Lifecycle Hooks

Strategies can override these hooks to customize behavior:

| Hook | When Called | Purpose |
|------|-------------|---------|
| `onStart()` | After START command processed | Set up subscriptions, initialize state |
| `onShutdownRequested()` | When SHUTDOWN received | Begin cleanup, set flags |
| `onShutdownStep()` | On every step while SHUTTING_DOWN | Continue cleanup, return `true` when done |
| `onShutdownComplete()` | After transition to SHUTDOWN | Final cleanup, emit events |

### Example Strategy Implementation

```solidity
contract MyStrategy is LifecycleMixin, OhlcMixin {
    bool private _cleanupDone;

    function onStart() internal override {
        // Subscribe to market data
        subscribeOhlc("ETH-USDC", 300);  // 5-minute candles
        subscribeOhlc("BTC-USDC", 300);
    }

    function onShutdownRequested() internal override {
        // Mark that we need to close positions
        _cleanupDone = false;
    }

    function onShutdownStep() internal override returns (bool done) {
        // Close any open positions (may take multiple steps)
        if (!_cleanupDone) {
            _closeAllPositions();  // May request effects
            _cleanupDone = true;
        }
        return _cleanupDone;
    }

    function onShutdownComplete() internal override {
        // Final cleanup
        _logInfo("SHUTDOWN_COMPLETE", "");
    }
}
```

### Why Lifecycle is Separate from Actions

| Lifecycle Events | Custom Actions |
|------------------|----------------|
| Mandatory for all strategies | Optional, user-defined |
| Core-initiated (via API) | User-initiated (via UI/API) |
| Fixed set: START, SHUTDOWN | Extensible: COMPOUND_FEES, REBALANCE, etc. |
| State machine with strict transitions | Nonce-based replay protection |
| `STEP_EVENT_LIFECYCLE` | `STEP_EVENT_CUSTOM_ACTION` (future) |

### Core Enforcement

After SHUTDOWN command is sent, Core:
1. Stops routing market events (OHLC) to the strategy
2. Forcefully removes any remaining RabbitMQ bindings
3. Tears down strategy queues
4. Marks strategy as SHUTDOWN in its registry

This ensures resources are fully released even if the strategy fails to clean up properly.

### API Integration

The lifecycle is managed via the Core API:

| Endpoint | Effect |
|----------|--------|
| `PUT /api/strategy` | Deploys contract, status = STOPPED |
| `POST /api/strategy/:addr/start` | Sends LIFECYCLE_START, status → RUNNING |
| `POST /api/strategy/:addr/shutdown` | Sends LIFECYCLE_SHUTDOWN, status → SHUTDOWN |

All endpoints are non-blocking (return 202) and pollable until completion (return 200).

---

## Core Orchestrator

### Overview

The Core orchestrator is a TypeScript service that:
1. Manages per-strategy event loops
2. Executes simulations and handles `EffectNeeded` reverts
3. Coordinates effect execution via RabbitMQ
4. Commits successful transactions
5. Collects fees from operator wallets

### Per-Strategy Loop

Each strategy has its own event loop with two queues:
- **Results queue** (priority): Effect results from executors
- **Events queue**: External events (OHLC, actions)

```typescript
async function strategyLoop(strategyAddr: string) {
  let pendingEffects = 0;

  while (true) {
    // Priority: drain results first
    const result = await tryConsume(resultsQueue, { timeout: 0 });

    if (result) {
      await collectFee(strategyAddr, result.feeWei);
      await submitEffectResult(strategyAddr, result);
      pendingEffects--;

      const sim = await simulate(strategyAddr);
      if (sim.effectNeeded) {
        await publishEffect(sim.effect);
        pendingEffects++;
      } else {
        await commit(strategyAddr, sim.tx);
      }
      continue;
    }

    // Only process events if no pending effects
    if (pendingEffects === 0) {
      const event = await consume(eventsQueue);
      // ... simulate, handle effects or commit
    }
  }
}
```

**Critical:** Events are only processed when `pendingEffects == 0`. This ensures all effects from the current event are resolved before processing the next event.

### State Machine

```
      ┌─────────────────────────────────────────┐
      │                                         │
      ▼                                         │
┌──────────┐     event      ┌──────────────┐   │
│   IDLE   │───────────────▶│  SIMULATING  │   │
└──────────┘                └──────┬───────┘   │
      ▲                            │           │
      │                   ┌────────┴────────┐  │
      │                   ▼                 ▼  │
      │            ┌───────────┐    ┌─────────┴───┐
      │            │  COMMIT   │    │   AWAITING  │
      │            │  (clean)  │    │   EFFECTS   │
      │            └─────┬─────┘    └──────┬──────┘
      │                  │                 │
      │                  │          result │
      │                  │                 ▼
      │                  │         ┌──────────────┐
      └──────────────────┴─────────│ RE-SIMULATE  │
                                   └──────────────┘
```

---

## RabbitMQ Architecture

### Exchanges and Queues

```
┌─────────────────────────────────────────────────────────────────────┐
│                           RabbitMQ                                   │
│                                                                      │
│  Exchange: midcurve.events (topic)                                  │
│  ├── Binding: ohlc.ETH-USDC.5m → strategy.0x1234.events            │
│  ├── Binding: ohlc.BTC-USDC.1h → strategy.0x1234.events            │
│  └── Binding: action.0x1234   → strategy.0x1234.events             │
│                                                                      │
│  Exchange: midcurve.effects (direct)                                │
│  └── Routing: * → effects.pending                                   │
│                                                                      │
│  Queues:                                                             │
│  ├── effects.pending       (competing consumers - N executors)      │
│  ├── strategy.0x1234.results (single consumer - strategy loop)      │
│  └── strategy.0x1234.events  (single consumer - strategy loop)      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Queue Purposes

| Queue | Purpose | Consumers |
|-------|---------|-----------|
| `effects.pending` | Work queue for effect execution | N executors (competing) |
| `strategy.X.results` | Effect results for strategy X | 1 (strategy loop) |
| `strategy.X.events` | External events for strategy X | 1 (strategy loop) |

### Subscription Management

Subscriptions are managed via RabbitMQ bindings:
- `OHLC_SUBSCRIBE` effect → creates binding from `ohlc.{pair}.{tf}` to strategy queue
- `OHLC_UNSUBSCRIBE` effect → removes binding
- Bindings ARE the subscription state (no separate DB table)

### Message TTL

Stale data auto-expires via per-message TTL:
```typescript
channel.publish('midcurve.events', 'ohlc.ETH-USDC.5m', payload, {
  expiration: '300000'  // 5 minutes in ms
});
```

---

## Effect Executors

### Architecture

Effect executors are stateless workers that:
1. Consume from `effects.pending` (competing consumers)
2. Execute the effect (HTTP call, RPC read, subscription management)
3. Publish result to `strategy.X.results`
4. Calculate fee for the effect

```typescript
async function executeEffect(msg: EffectRequest): Promise<EffectResult> {
  const fee = calculateFee(msg.effectType, msg.payload);

  switch (msg.effectType) {
    case 'OHLC_SUBSCRIBE':
      await createOhlcBinding(msg.strategyAddress, msg.payload);
      return { success: true, data: '0x', feeWei: fee };

    case 'POSITION_OPEN':
      const positionId = await openPosition(msg.payload);
      await ledgerService.recordEvent({ type: 'OPEN', positionId, ... });
      return { success: true, data: encodePositionId(positionId), feeWei: fee };

    // ... other effects
  }
}
```

### Effect Types

| Effect Type | Description | Fee Category |
|-------------|-------------|--------------|
| `OHLC_SUBSCRIBE` | Create OHLC data subscription | Subscription (recurring) |
| `OHLC_UNSUBSCRIBE` | Remove subscription | Free |
| `POSITION_OPEN` | Open LP position on external DEX | One-time |
| `POSITION_CLOSE` | Close LP position | One-time |
| `POSITION_COLLECT_FEES` | Collect fees from position | One-time |
| `EFFECT_LOG` | Emit log for debugging | Free |
| `HTTP_GET` | Fetch external data | One-time |
| `RPC_CALL` | Read from external chain | One-time |

### Position Ledger Integration

Position-related effects write to the position ledger via `@midcurve/services`:

```typescript
import { PositionLedgerService } from '@midcurve/services';

// In executor
await ledgerService.recordEvent({
  strategyId: msg.strategyId,
  positionId,
  eventType: 'OPEN',
  timestamp: new Date(),
  data: params,
});
```

---

## Fee Collection

### Mechanism

Operators pay for resource-heavy effects (especially subscriptions):

1. Effect executor calculates fee based on effect type
2. Core transfers ETH from operator wallet → Core address BEFORE committing result
3. If transfer fails (insufficient funds), result is not committed
4. Strategy remains blocked at `EffectNeeded` until operator is funded

```typescript
// In strategy loop, before submitEffectResult()
async function collectFee(strategyAddr: string, feeWei: bigint) {
  const operator = await getOperatorWallet(strategyAddr);
  await transferEth(operator, CORE_ADDRESS, feeWei);
}
```

### Fee Schedule

| Effect Category | Fee Structure |
|-----------------|---------------|
| Subscription effects | Per-period fee (while active) |
| Position operations | One-time fee |
| Read operations | Per-call fee |
| Logging | Free |

---

## Strategy Deployment

### Flow

```
┌────────────┐     ┌──────────────────────┐     ┌─────────────────────┐
│     UI     │────▶│  midcurve-services   │────▶│   midcurve-evm      │
│            │     │  StrategyDeployment  │     │      (Core)         │
│ - Template │     │       Service        │     │                     │
│ - Params   │     │                      │     │ - Deploy contract   │
│ - Submit   │     │ - Validate params    │     │ - Create RMQ queues │
└────────────┘     │ - Create DB record   │     │ - Fund operator     │
                   │ - Call Core API      │     │ - Start loop        │
                   └──────────────────────┘     └─────────────────────┘
```

### Core REST API

```typescript
// POST /api/strategies/deploy
interface DeployRequest {
  strategyId: string;        // DB record ID
  bytecode: string;          // 0x...
  abi: AbiItem[];
  constructorParams: unknown[];
}

interface DeployResponse {
  strategyAddress: string;   // Deployed contract
  operatorAddress: string;   // New operator wallet
  txHash: string;
}
```

### Deployment Steps (Core)

1. Create operator wallet via midcurve-signer KMS
2. Fund operator wallet from Core
3. Deploy contract (signed by operator)
4. Create RabbitMQ queues (`strategy.X.results`, `strategy.X.events`)
5. Start strategy loop
6. Return deployment info

---

## Infrastructure

### Geth Node

- **Consensus:** Clique PoA (period=0 for instant mining)
- **Chain ID:** 31337
- **Gas Limit:** 30,000,000
- **Pre-funded:** Signer address with UINT256_MAX wei

### Genesis Configuration

```json
{
  "config": {
    "chainId": 31337,
    "clique": { "period": 0, "epoch": 30000 }
  },
  "alloc": {
    "f39fd6e51aad88f6f4ce6ab8827279cfffb92266": {
      "balance": "115792089237316195423570985008687907853269984665640564039457584007913129639935"
    }
  }
}
```

### Docker Services

| Service | Purpose | Ports |
|---------|---------|-------|
| `geth` | EVM node | 8545 (HTTP), 8546 (WS) |
| `rabbitmq` | Message broker | 5672 (AMQP), 15672 (Management) |
| `core` | Orchestrator | Internal |

---

## Directory Structure

```
apps/midcurve-evm/
├── contracts/
│   ├── src/
│   │   ├── interfaces/
│   │   │   └── IStrategy.sol
│   │   ├── strategy/
│   │   │   ├── BaseStrategy.sol
│   │   │   └── mixins/
│   │   │       ├── ActionMixin.sol
│   │   │       ├── LifecycleMixin.sol
│   │   │       ├── LoggingMixin.sol
│   │   │       └── OhlcMixin.sol
│   │   └── examples/
│   ├── test/
│   ├── lib/                    # Foundry deps
│   └── foundry.toml
├── core/                       # TypeScript orchestrator
│   └── src/
│       ├── orchestrator/       # Strategy loops
│       ├── executors/          # Effect executors
│       ├── rabbitmq/           # Queue management
│       └── api/                # REST API (deployment, etc.)
├── docker/
│   └── start-geth.sh
├── genesis/
│   ├── genesis-template.json
│   ├── genesis.json
│   └── generate-genesis.sh
├── scripts/
│   └── fund-core.sh
├── docker-compose.yml
├── docker-compose.prod.yml
├── Dockerfile.geth
├── package.json
├── CLAUDE.md                   # This file
└── README.md
```

---

## Development

### Quick Start

```bash
# Start Geth node
npm run up

# Build contracts
npm run build:contracts

# Run contract tests
npm run test:contracts

# View logs
npm run logs

# Stop
npm run down
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CORE_ADDRESS` | Foundry #0 | Core administrative address |
| `CORE_PRIVATE_KEY` | Foundry #0 | Core signing key |
| `RABBITMQ_URL` | amqp://localhost | RabbitMQ connection |
| `DATABASE_URL` | - | PostgreSQL for services |

### Testing Strategies

1. Deploy strategy contract
2. Create RabbitMQ queues manually
3. Publish test events to `strategy.X.events`
4. Observe simulation logs
5. Verify effect requests and results
6. Check committed state on-chain

---

## Key Design Decisions

### Why Revert for Effects (Not Events)?

- **Atomic:** Simulation either completes or reverts - no partial state
- **Debuggable:** Revert data contains full effect request
- **Composable:** Multiple `_awaitEffect()` calls in sequence
- **Gas efficient:** No event emission during simulation

### Why Separate Results and Events Queues?

- **Priority:** Results must be processed before new events
- **Correctness:** Processing an event while effects pending would corrupt state
- **Simplicity:** Clear consumption order, no complex priority logic

### Why RabbitMQ Bindings for Subscriptions?

- **Single source of truth:** Binding exists = subscription active
- **No DB sync:** No subscription table to keep in sync
- **Automatic routing:** Messages flow to subscribed strategies automatically
- **Easy cleanup:** Remove binding = unsubscribe

### Why Per-Strategy Operator Wallets?

- **Isolation:** One strategy's debt doesn't block others
- **Accounting:** Clear fee attribution per strategy
- **Security:** Compromise of one key affects only one strategy
- **User ownership:** Each user's strategy has its own funding

---

## Strategy Development Guidelines

### Non-Deterministic Inputs (Critical)

**The durable await pattern requires idempotent execution.** Each simulation run must produce the same result given the same inputs. This breaks if strategies use non-deterministic data for branching decisions.

#### Forbidden Patterns

**DO NOT** use these as conditions for execution branches:

| Input | Why It Breaks | Example |
|-------|---------------|---------|
| `block.timestamp` | Changes between simulation and commit | `if (block.timestamp % 60 == 0)` |
| `block.number` | Changes between simulation and commit | `if (block.number > lastBlock + 10)` |
| `block.prevrandao` | Different on each block | `if (block.prevrandao % 2 == 0)` |
| `gasleft()` | Varies with execution context | `if (gasleft() > 100000)` |
| `tx.gasprice` | Can change between runs | `if (tx.gasprice < 50 gwei)` |
| `block.basefee` | Changes per block | `if (block.basefee < threshold)` |

#### Why This Matters

The simulation-replay loop works like this:

```
Simulation 1: block.timestamp = 1000 → takes branch A → needs effect X
Effect X fulfilled
Simulation 2: block.timestamp = 1005 → takes branch B → DIFFERENT PATH!
```

If simulation 2 takes a different branch, the effect result from X may be:
- **Unused** (wasted work, wasted fees)
- **Applied to wrong context** (corrupted state)
- **Cause infinite loop** (keeps requesting different effects)

#### Safe Patterns

**DO** use these for decision making:

| Input | Why It's Safe | Example |
|-------|---------------|---------|
| Event payload data | Immutable, passed via `step(input)` | `ohlcData.close > threshold` |
| Contract storage | Same between simulation runs | `if (_state == State.RUNNING)` |
| Effect results | Persisted before re-simulation | `if (priceResult.ok)` |
| Constructor params | Immutable | `if (_targetApr > minApr)` |
| Hardcoded constants | Immutable | `if (amount > MIN_POSITION)` |

#### Correct Time Handling

If you need time-based logic, use timestamps from **event payloads**, not `block.timestamp`:

```solidity
// ❌ WRONG - non-deterministic
function _onOhlc(OhlcData memory ohlc) internal {
    if (block.timestamp > _lastRebalance + 1 hours) {
        _rebalance();
    }
}

// ✅ CORRECT - deterministic
function _onOhlc(OhlcData memory ohlc) internal {
    if (ohlc.timestamp > _lastRebalance + 1 hours) {
        _rebalance();
        _lastRebalance = ohlc.timestamp;
    }
}
```

#### Correct Randomness Handling

If you need randomness, request it as an **effect**:

```solidity
// ❌ WRONG - non-deterministic
function _makeDecision() internal view returns (bool) {
    return block.prevrandao % 2 == 0;
}

// ✅ CORRECT - deterministic (randomness from effect)
function _makeDecision() internal returns (bool) {
    (AwaitStatus status, bytes memory data) = _awaitEffect(
        keccak256("random_decision"),
        EFFECT_RANDOM,
        abi.encode(1, 100)  // min, max
    );
    require(status == AwaitStatus.READY_OK, "Random failed");
    uint256 value = abi.decode(data, (uint256));
    return value > 50;
}
```

### State Machine Best Practices

1. **Always check state** before taking actions
2. **Store timestamps from events**, not from blocks
3. **Use effect results** for external data (prices, balances)
4. **Test with multiple simulation runs** to verify idempotency
