# Local E2E Testing Guide

This guide walks through the full automation flow for end-to-end testing on a local Anvil chain.

## Overview

The automation system consists of:
1. **Price Monitor Worker** - Polls pool prices and detects when close order triggers are hit
2. **Order Executor Worker** - Executes close orders on-chain when triggered
3. **PositionCloser Contract** - On-chain contract that atomically closes Uniswap V3 positions

## Prerequisites

Ensure you have the following services running:

| Service | Command | Port |
|---------|---------|------|
| PostgreSQL | `docker compose up postgres -d` | 5432 |
| RabbitMQ | `docker compose up rabbitmq -d` | 5672, 15672 (management) |
| Anvil | `pnpm local:anvil` | 8545 |

## Quick Start

### 1. Start Infrastructure

```bash
# From monorepo root
docker compose up postgres rabbitmq -d
```

### 2. Start Anvil and Deploy Contracts

```bash
# Terminal 1: Start Anvil mainnet fork
cd apps/midcurve-automation
pnpm local:anvil
```

```bash
# Terminal 2: Deploy contracts and set up test environment
cd apps/midcurve-automation
pnpm local:setup
```

The setup script will:
- Deploy MockUSD token
- Deploy PositionCloser contract
- Create a WETH/MockUSD Uniswap V3 pool
- Add initial liquidity
- Fund test account with 100 WETH + 1,000,000 MockUSD
- **Automatically update** `shared-contracts.json` in both api and automation apps

### 3. Start Services

```bash
# Terminal 3: API (port 3001)
cd apps/midcurve-api
pnpm dev

# Terminal 4: Signer Service (port 3003)
cd apps/midcurve-signer
pnpm dev

# Terminal 5: Automation Workers (port 3004)
cd apps/midcurve-automation
pnpm dev

# Terminal 6: UI (port 3000)
cd apps/midcurve-ui
pnpm dev
```

## Environment Variables

### API (`apps/midcurve-api/.env`)

```bash
RPC_URL_LOCAL=http://localhost:8545
```

### Automation (`apps/midcurve-automation/.env`)

```bash
# RabbitMQ (defaults work for local dev)
RABBITMQ_HOST=localhost
RABBITMQ_PORT=5672
RABBITMQ_USER=midcurve
RABBITMQ_PASS=midcurve_dev

# Local chain RPC
RPC_URL_LOCAL=http://localhost:8545

# Signer service
SIGNER_URL=http://localhost:3003
SIGNER_INTERNAL_API_KEY=<your-signer-api-key>

# Fee configuration
EXECUTION_FEE_RECIPIENT=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
EXECUTION_FEE_BPS=50

# Database
DATABASE_URL=postgresql://devuser:devpass@localhost:5432/midcurve_dev

# Logging
LOG_LEVEL=debug
NODE_ENV=development
```

## E2E Test Flow

### Step 1: Import a Position

1. Open UI at http://localhost:3000
2. Connect wallet (use Foundry test account #0)
3. Navigate to Positions
4. Import the position created by `local:setup`

### Step 2: Create a Close Order

1. Click on the imported position
2. Go to **Automation** tab
3. Click **Create Close Order**
4. Set trigger price (above or below current)
5. Confirm the order

### Step 3: Trigger the Order

Use the price manipulation scripts to move the pool price toward your trigger:

```bash
# Check current price
MOCK_USD_WETH_POOL_ADDRESS="0x..." pnpm local:check-price

# Move price UP (buy ETH with MockUSD)
MOCK_USD_ADDRESS="0x..." MOCK_USD_WETH_POOL_ADDRESS="0x..." pnpm local:price-up

# Move price DOWN (sell ETH for MockUSD)
MOCK_USD_ADDRESS="0x..." MOCK_USD_WETH_POOL_ADDRESS="0x..." pnpm local:price-down
```

### Step 4: Monitor Execution

Watch the automation worker logs:
- Price monitor will log when it detects the trigger condition
- Order executor will log execution attempts
- Check order status in UI or database

### Step 5: Verify Results

1. Order status should change: `active` → `triggered` → `executed`
2. On-chain position should have liquidity = 0
3. Tokens should be returned to the position owner

## Troubleshooting

### "Automation is not yet available on this chain"

**Cause:** `shared-contracts.json` doesn't have an entry for chainId 31337.

**Fix:** Run `pnpm local:setup` to deploy contracts and update config.

### Workers not starting

**Cause:** RabbitMQ not running or connection refused.

**Fix:**
```bash
docker compose up rabbitmq -d
# Wait for healthcheck
docker compose ps
```

### Price monitor not detecting triggers

**Cause:** Pool subscription not created or wrong pool address.

**Fix:**
1. Check database for `PoolSubscription` entries
2. Verify pool address matches the one in your close order
3. Check automation worker logs for errors

### Order not executing

**Cause:** Signer service not running or authentication error.

**Fix:**
1. Ensure signer service is running on port 3003
2. Verify `SIGNER_INTERNAL_API_KEY` matches between services
3. Check signer logs for signing errors

## Useful Commands

```bash
# Check pool price
MOCK_USD_WETH_POOL_ADDRESS="0x..." pnpm local:check-price

# Database queries (check orders)
PGPASSWORD=devpass psql -h localhost -U devuser -d midcurve_dev \
  -c "SELECT id, status, \"closeOrderType\" FROM \"AutomationCloseOrder\";"

# RabbitMQ management
open http://localhost:15672  # user: midcurve, pass: midcurve_dev
```

## Test Accounts

Foundry provides pre-funded test accounts in Anvil:

| Account | Address | Private Key |
|---------|---------|-------------|
| #0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| #1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |

## Architecture Notes

### Message Flow

```
PriceMonitor (polls every 10s)
  ↓ detects trigger
  ↓ publishes OrderTriggerMessage
automation.triggers exchange
  ↓ routes to
orders.pending queue
  ↓ consumed by
OrderExecutor (3 consumers)
  ↓ signs via SignerClient
  ↓ broadcasts to local chain
Transaction confirmed
  ↓ updates DB
Order status: executed
```

### Important Files

- `src/workers/price-monitor.ts` - Price polling and trigger detection
- `src/workers/order-executor.ts` - Order execution logic
- `src/mq/connection-manager.ts` - RabbitMQ connection handling
- `contracts/UniswapV3PositionCloser.sol` - On-chain position closer
- `scripts/local-fork/setup.ts` - Local environment setup
