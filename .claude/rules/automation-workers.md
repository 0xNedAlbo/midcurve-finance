# .claude/rules/automation-workers.md

---

## path: apps/midcurve-automation/**

## Automation Worker Pattern — Domain Event–Driven Subscription Lifecycle

Automation workers (RangeMonitor, CloseOrderMonitor) follow this pattern.
New workers that monitor on-chain data must follow it too.

### No Polling

- Never use `setInterval` / polling timers for subscription discovery
- Subscribe to domain events for immediate sync when entities change
- Domain events are the only trigger for `syncSubscriptions()` (besides startup)

### Startup Sequence

```
1. cleanupOrphanedSubscriptions()   // Remove stale DB subscriptions
2. subscribeToEntityEvents()        // Bind to domain events exchange
3. syncSubscriptions()              // Catch up on anything missed while down
```

### Shutdown Sequence

```
1. Cancel domain event consumer tag
2. Shutdown all RabbitMQ subscribers (Promise.all)
3. Clear in-memory maps
```

### Per-Entity DB Subscriptions

- 1 `OnchainDataSubscribers` row per entity (position, order), not per pool
- Subscription ID format: `auto:{consumer}:{entityId}`
  - `auto:range-monitor:{positionId}`
  - `auto:close-order:{orderId}`
- Use `AutomationSubscriptionService` for all DB subscription CRUD
  - `ensurePositionSubscription()` / `removePositionSubscription()`
  - `ensureOrderSubscription()` / `removeOrderSubscription()`

### Domain Event Subscription

- Queue naming: `automation.{worker-name}.{entity}-events` (durable, not exclusive)
- Exchange: `DOMAIN_EVENTS_EXCHANGE` from `@midcurve/services`
- Dead-letter exchange: `DOMAIN_EVENTS_DLX` from `@midcurve/services`
- Routing patterns: use `ROUTING_PATTERNS.*` constants, never hardcode strings
  - `ROUTING_PATTERNS.ALL_POSITION_EVENTS` for position lifecycle
  - `ROUTING_PATTERNS.ALL_ORDER_EVENTS` for order lifecycle
- RabbitMQ connection: `getRabbitMQConnection()` from `../mq/connection-manager`
- Store consumer tag for cleanup in `stop()`

### Event Handler

- On domain event message: call `syncSubscriptions()`, then ack
- On error: nack (no requeue), message goes to DLX
