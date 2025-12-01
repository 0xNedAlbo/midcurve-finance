# Midcurve Strategy Worker

Long-running background process that executes automated strategies for concentrated liquidity positions.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Midcurve Worker                          │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ActionPoller │  │ (Future)    │  │ (Future)            │ │
│  │ (DB poll)   │  │ OhlcProvider│  │ PositionProvider    │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                     │            │
│         └────────────────┼─────────────────────┘            │
│                          ▼                                  │
│              ┌───────────────────────┐                      │
│              │    RuntimeManager     │                      │
│              │  (routes events)      │                      │
│              └───────────┬───────────┘                      │
│                          │                                  │
│         ┌────────────────┼────────────────┐                 │
│         ▼                ▼                ▼                 │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐          │
│  │ Strategy   │   │ Strategy   │   │ Strategy   │          │
│  │ Runtime 1  │   │ Runtime 2  │   │ Runtime N  │          │
│  │            │   │            │   │            │          │
│  │ ┌────────┐ │   │ ┌────────┐ │   │ ┌────────┐ │          │
│  │ │Mailbox │ │   │ │Mailbox │ │   │ │Mailbox │ │          │
│  │ │(FIFO)  │ │   │ │(FIFO)  │ │   │ │(FIFO)  │ │          │
│  │ └────────┘ │   │ └────────┘ │   │ └────────┘ │          │
│  └────────────┘   └────────────┘   └────────────┘          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### RuntimeManager
Central coordinator that:
- Loads active strategies from database
- Creates StrategyRuntime instances
- Routes events to correct runtimes
- Manages strategy lifecycle (start/stop)

### StrategyRuntime
Per-strategy execution context that:
- Maintains a mailbox (FIFO event queue)
- Processes events sequentially
- Provides StrategyRuntimeApi to strategy implementations
- Persists local state to database

### ActionPoller
Polls database for pending user actions and routes them to runtimes.
Actions are submitted via the API (midcurve-ui).

## Event Types

```typescript
type StrategyEventType =
  | 'ohlc'      // Market data (1m candles)
  | 'funding'   // Deposit/withdraw events
  | 'position'  // On-chain position events
  | 'effect'    // Effect execution results
  | 'action';   // User-initiated actions
```

## Strategy Execution Flow

1. **Event arrives** (via ActionPoller, OhlcProvider, etc.)
2. **RuntimeManager routes** event to correct StrategyRuntime
3. **Mailbox enqueues** event (FIFO ordering)
4. **StrategyRuntime processes** event:
   - Builds external state (market data, position data)
   - Calls `implementation.run()` with context
   - Updates local state
   - Persists state to database
5. **Strategy may start effects** (swaps, liquidity changes)
6. **Effect results** arrive as new events (cycle continues)

## Configuration

Environment variables:
```bash
DATABASE_URL           # PostgreSQL connection
SIGNER_URL             # Signer service URL
SIGNER_INTERNAL_API_KEY # Internal API key
RPC_URL_*              # Chain RPC endpoints
ACTION_POLL_INTERVAL_MS # Action polling interval (default: 5000)
HEALTH_CHECK_PORT      # Health endpoint port (default: 8080)
LOG_LEVEL              # Logging level (default: info)
```

## Development

```bash
# Start in development mode
npm run dev

# With pretty logging
npm run dev:pretty

# Type checking
npm run typecheck

# Build
npm run build

# Run production build
npm start
```

## Health Endpoint

`GET /health` returns:
```json
{
  "healthy": true,
  "activeStrategies": 5,
  "pendingEvents": 0
}
```

## Future Extensions

- **OhlcProvider**: Hyperliquid WebSocket for market data
- **PositionProvider**: On-chain event listener for position changes
- **FundingProvider**: Deposit/withdraw event detection
- **EffectExecutor**: Execute swaps, liquidity changes, hedges
- **SNS/SQS integration**: For scaling with FIFO message groups
