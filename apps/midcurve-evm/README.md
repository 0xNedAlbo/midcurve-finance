# Midcurve EVM

Local EVM development node for testing durable await strategy contracts.

## Architecture

This package provides:
- **Geth node** with Clique PoA consensus (instant mining)
- **Strategy contracts** implementing the durable await pattern
- **Core orchestrator** (planned: RabbitMQ-based event system)

### Durable Await Pattern

Strategies use a simulation-replay execution model:

1. Core calls `step(input)` via `eth_call` (simulation)
2. If an effect is needed, strategy reverts with `EffectNeeded(epoch, key, effectType, payload)`
3. Core executes the effect off-chain (swap, log, subscribe, etc.)
4. Core stores the result via `submitEffectResult(epoch, key, ok, data)`
5. Core re-simulates `step()` - this time the effect result exists and execution continues
6. Repeat until simulation completes without reverting
7. Core sends `step()` as a real transaction to commit state

## Quick Start

```bash
# Start the Geth node
npm run up

# Check node health
npm run health

# View logs
npm run logs

# Stop the node
npm run down

# Reset (removes all data)
npm run reset
```

## Contracts

```
contracts/src/
├── interfaces/
│   └── IStrategy.sol          # Strategy interface with EffectNeeded error
├── strategy/
│   ├── BaseStrategy.sol       # Core durable await implementation
│   └── mixins/
│       ├── ActionMixin.sol    # User action handling
│       ├── LifecycleMixin.sol # START/SHUTDOWN lifecycle
│       ├── LoggingMixin.sol   # Logging as effects
│       └── OhlcMixin.sol      # OHLC data subscription
└── examples/
    └── (example strategies)
```

### Building Contracts

```bash
npm run build:contracts
npm run test:contracts
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CORE_ADDRESS` | Foundry account 0 | Operator address (without 0x prefix) |
| `CORE_PRIVATE_KEY` | Foundry key 0 | Operator private key for signing |

### Ports

| Port | Protocol | Description |
|------|----------|-------------|
| 8555 | HTTP | JSON-RPC endpoint |
| 8556 | WebSocket | WebSocket RPC endpoint |

## Development

### Chain Configuration

- **Chain ID:** 31337
- **Consensus:** Clique PoA (period=0 for instant mining)
- **Gas Limit:** 30,000,000

### Pre-funded Accounts

| Address | Balance | Purpose |
|---------|---------|---------|
| `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | 1M ETH | Operator/Signer |
| `0x0000...0001` | 1M ETH | Burn address |

## Available Scripts

### Contract Development

| Script | Description |
|--------|-------------|
| `npm run build:contracts` | Build Solidity contracts with Foundry |
| `npm run test:contracts` | Run contract tests |
| `npm run generate:genesis` | Generate genesis.json |

### Development (Ephemeral)

| Script | Description |
|--------|-------------|
| `npm run up` | Start node with fresh deployment |
| `npm run down` | Stop and remove containers |
| `npm run logs` | Follow Geth logs |
| `npm run status` | Show container status |
| `npm run reset` | Restart with fresh state |
| `npm run health` | Check RPC endpoint |

### Production (Persistent)

| Script | Description |
|--------|-------------|
| `npm run up:prod` | Start with persistent storage |
| `npm run down:prod` | Stop (data preserved) |
| `npm run reset:prod` | Remove data and restart fresh |

## Usage with viem

```typescript
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { localhost } from 'viem/chains';

// Create clients
const chain = { ...localhost, id: 31337 };

const publicClient = createPublicClient({
  chain,
  transport: http('http://localhost:8555'),
});

const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

const walletClient = createWalletClient({
  account,
  chain,
  transport: http('http://localhost:8555'),
});

// Deploy a strategy contract...
```

## Core Orchestrator

The Core orchestrator (in `core/`) will be rebuilt with RabbitMQ for event-driven strategy execution. This is planned for future development.

## Debian/Linux Production Setup

For running the Geth node as a system service on Debian/Ubuntu.

### 1. Create Systemd Service

Create `/etc/systemd/system/midcurve-geth.service`:

```ini
[Unit]
Description=Midcurve Geth Development Node
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/midcurve/apps/midcurve-evm
ExecStart=/usr/bin/docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker-compose -f docker-compose.yml -f docker-compose.prod.yml down
ExecReload=/usr/bin/docker-compose -f docker-compose.yml -f docker-compose.prod.yml restart
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

### 2. Enable and Start Service

```bash
sudo systemctl daemon-reload
sudo systemctl enable midcurve-geth
sudo systemctl start midcurve-geth
sudo systemctl status midcurve-geth
```
