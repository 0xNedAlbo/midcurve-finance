# @midcurve/automation

Automated position management for Uniswap V3 concentrated liquidity positions.

## Overview

This service monitors Uniswap V3 pool prices and executes close orders when user-defined trigger conditions are met. It enables liquidity providers to automate position exits based on price movements.

**Core Function:** Monitor pool prices, detect trigger conditions, execute atomic position closes with slippage protection.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Automation Service Architecture                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────┐     ┌─────────────────────────────┐   │
│  │  Price Monitor Worker   │     │   Order Executor Worker     │   │
│  │  - Polls pools (10s)    │     │   - Consumes RabbitMQ       │   │
│  │  - Checks triggers      │────▶│   - Signs via signer svc    │   │
│  │  - Publishes events     │     │   - Broadcasts transactions │   │
│  └─────────────────────────┘     └─────────────────────────────┘   │
│                                              │                       │
│                                              ▼                       │
│                              ┌───────────────────────────┐          │
│                              │  UniswapV3PositionCloser  │          │
│                              │  - Atomic close           │          │
│                              │  - Slippage protection    │          │
│                              │  - Fee collection         │          │
│                              └───────────────────────────┘          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Components:**

| Component | Description |
|-----------|-------------|
| Price Monitor Worker | Polls pool prices every 10 seconds, evaluates close order triggers, publishes trigger events to RabbitMQ |
| Order Executor Worker | Consumes trigger events, coordinates transaction signing via signer service, broadcasts transactions |
| UniswapV3PositionCloser.sol | On-chain contract for atomic position closing with configurable slippage protection |
| RabbitMQ | Message broker for async, event-driven processing between workers |

## Smart Contracts

| Contract | Description |
|----------|-------------|
| `UniswapV3PositionCloser.sol` | Main automation contract deployed per chain. Handles atomic position close, liquidity removal, swap to single token, and fee collection. |
| `MockUSD.sol` | Test ERC-20 token (6 decimals) for local development and testing. |

## Local Development Setup

### Prerequisites

- Node.js 20.x
- pnpm 9.x
- Foundry (forge, anvil, cast)
- `RPC_URL_ETHEREUM` in `.env` (mainnet fork source)

### Quick Start

```bash
# Terminal 1: Start Anvil mainnet fork
pnpm local:anvil

# Terminal 2: Run full setup (deploy, create pool, add liquidity, fund)
pnpm local:setup
```

The setup script will output environment variables to export for subsequent commands:

```bash
export MOCK_USD_ADDRESS="0x..."
export POOL_ADDRESS="0x..."
```

## Local Testing Scripts

| Script | Description |
|--------|-------------|
| `pnpm local:anvil` | Start Anvil mainnet fork on port 8547 |
| `pnpm local:setup` | Deploy contracts, create pool, add liquidity, fund test account |
| `pnpm local:deploy` | Deploy MockUSD token contract |
| `pnpm local:create-pool` | Create WETH/MockUSD pool at ~$3000/ETH |
| `pnpm local:add-liquidity` | Add liquidity to the pool (tick range: $2500-$3500) |
| `pnpm local:fund` | Fund test account with WETH and MockUSD |
| `pnpm local:check-price` | Check current pool price |
| `pnpm local:price-up` | Push ETH price up (buy ETH with MockUSD) |
| `pnpm local:price-down` | Push ETH price down (sell ETH for MockUSD) |

### Price Manipulation

After setup, manipulate prices to test trigger conditions:

```bash
# Check current price
POOL_ADDRESS="0x..." pnpm local:check-price

# Push price down (sell ETH)
MOCK_USD_ADDRESS="0x..." POOL_ADDRESS="0x..." DIRECTION=down SWAP_AMOUNT=5000000000000000000 pnpm local:price-down

# Push price up (buy ETH)
MOCK_USD_ADDRESS="0x..." POOL_ADDRESS="0x..." DIRECTION=up SWAP_AMOUNT=5000000000 pnpm local:price-up
```

## Environment Variables

Create a `.env` file in the automation app directory:

```bash
# Required for local fork
RPC_URL_ETHEREUM="https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"

# Production RPC endpoints
RPC_URL_ARBITRUM="https://arb-mainnet.g.alchemy.com/v2/YOUR_KEY"
RPC_URL_BASE="https://base-mainnet.g.alchemy.com/v2/YOUR_KEY"
RPC_URL_OPTIMISM="https://opt-mainnet.g.alchemy.com/v2/YOUR_KEY"
RPC_URL_POLYGON="https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY"

# RabbitMQ (for workers)
RABBITMQ_URL="amqp://guest:guest@localhost:5672"

# Signer service
SIGNER_SERVICE_URL="http://localhost:3003"

# Fee configuration
PROTOCOL_FEE_BPS=50
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Service health check |
| `GET /api/workers/status` | Worker metrics and status |

## Development Commands

```bash
# Start dev server (port 3004)
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start

# Type checking
pnpm typecheck

# Linting
pnpm lint

# Build Solidity contracts
pnpm forge:build

# Run Foundry tests
pnpm forge:test

# Compile contracts for frontend (generates ABI JSON)
pnpm compile
```

## Contract Deployment

Deploy the automation contract to production chains:

```bash
# Arbitrum
pnpm forge:deploy:arbitrum

# Base
pnpm forge:deploy:base

# Ethereum mainnet
pnpm forge:deploy:ethereum

# Optimism
pnpm forge:deploy:optimism

# Polygon
pnpm forge:deploy:polygon
```

## Test Account

For local development, use Foundry's default test account (pre-funded in Anvil):

| Property | Value |
|----------|-------|
| Address | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| Private Key | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| Initial ETH | 10,000 ETH (Anvil default) |
| After Setup | +100 WETH, +1,000,000 MockUSD |

**Note:** Never use this account on mainnet. The private key is publicly known.

## Technical Notes

### Port Configuration

- Anvil fork runs on port **8547** to avoid conflicts with midcurve-evm's Geth node (ports 8545-8546)
- Dev server runs on port **3004**

### Price Calculation

Pool prices use Uniswap V3's `sqrtPriceX96` format. The `@midcurve/shared` package provides utilities for price conversion:

```typescript
import { priceToSqrtRatioX96 } from '@midcurve/shared';

// Convert $3000/ETH to sqrtPriceX96
const sqrtPrice = priceToSqrtRatioX96(
  WETH_ADDRESS,      // base token
  USDC_ADDRESS,      // quote token
  18,                // base decimals
  3000000000n        // price in quote decimals (6 for USDC)
);
```

### Token Order

Uniswap V3 orders tokens by address (lower address = token0). The pool creation and price scripts handle this automatically, but be aware when debugging:

- If `WETH < MockUSD`: WETH is token0, price = MockUSD/WETH
- If `MockUSD < WETH`: MockUSD is token0, price = WETH/MockUSD
