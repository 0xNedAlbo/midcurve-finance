# @midcurve/evm

Local EVM development node with SEMSEE Store contracts pre-deployed.

## Overview

This package provides a private Ethereum network running in Docker with:
- **SystemRegistry** pre-deployed at `0x0000000000000000000000000000000000001000`
- **Store contracts** (PoolStore, PositionStore, BalanceStore) automatically deployed on startup
- **Foundry** for contract development and testing

## Prerequisites

- Docker and Docker Compose installed
- [Foundry](https://getfoundry.sh/) installed (for contract development)
- Port 8545 (HTTP RPC) and 8546 (WebSocket) available

## Quick Start

```bash
# Start the node (builds contracts, generates genesis, deploys stores)
npm run up

# Check deployment status
npm run check:deployment

# View logs
npm run logs

# Stop the node
npm run down
```

## Well-Known Addresses

| Contract | Address | Description |
|----------|---------|-------------|
| Core | `0x0000...0001` | Caller identity for Core operations |
| SystemRegistry | `0x0000...1000` | Central registry (pre-deployed via genesis) |
| PoolStore | Dynamic | Registered in SystemRegistry |
| PositionStore | Dynamic | Registered in SystemRegistry |
| BalanceStore | Dynamic | Registered in SystemRegistry |

## Available Scripts

### Contract Development

| Script | Description |
|--------|-------------|
| `npm run build:contracts` | Build Solidity contracts with Foundry |
| `npm run test:contracts` | Run contract tests |
| `npm run generate:genesis` | Generate genesis.json with SystemRegistry bytecode |

### Development (Ephemeral)

| Script | Description |
|--------|-------------|
| `npm run up` | Start node with fresh deployment |
| `npm run down` | Stop and remove containers |
| `npm run logs` | Follow Geth logs |
| `npm run logs:deploy` | View deployment logs |
| `npm run status` | Show container status |
| `npm run reset` | Restart with fresh state |
| `npm run health` | Check RPC endpoint |
| `npm run deploy:stores` | Manually deploy stores |
| `npm run check:deployment` | Verify contract deployment |

### Production (Persistent)

| Script | Description |
|--------|-------------|
| `npm run up:prod` | Start with persistent storage |
| `npm run down:prod` | Stop (data preserved) |
| `npm run reset:prod` | Remove data and restart fresh |

## Endpoints

- **HTTP RPC:** `http://localhost:8545`
- **WebSocket:** `ws://localhost:8546`
- **Chain ID:** `31337`

## Architecture

### How It Works

1. **Genesis Generation** (`npm run generate:genesis`)
   - Builds contracts with Foundry
   - Extracts SystemRegistry runtime bytecode
   - Generates `genesis.json` with SystemRegistry pre-deployed at `0x1000`

2. **Node Startup** (`docker-compose up`)
   - Builds custom Geth image with genesis initialization
   - Starts private PoA network (Clique consensus)
   - Pre-funds Core (`0x1`) and signer accounts

3. **Store Deployment** (automatic)
   - Waits for Geth to be healthy
   - Deploys PoolStore, PositionStore, BalanceStore
   - Registers store addresses in SystemRegistry (as Core)

### Contract Structure

```
contracts/
├── src/
│   ├── libraries/
│   │   └── CoreControlled.sol      # onlyCore modifier
│   ├── interfaces/
│   │   ├── ISystemRegistry.sol
│   │   ├── IPoolStore.sol
│   │   ├── IPositionStore.sol
│   │   └── IBalanceStore.sol
│   └── stores/
│       ├── SystemRegistry.sol
│       ├── PoolStore.sol
│       ├── PositionStore.sol
│       └── BalanceStore.sol
├── script/
│   └── DeployStores.s.sol
└── test/
    └── stores/                      # Unit tests
```

## Usage with viem

```typescript
import { createPublicClient, http, getContract } from 'viem';
import { localhost } from 'viem/chains';

// Create client
const client = createPublicClient({
  chain: { ...localhost, id: 31337 },
  transport: http('http://localhost:8545'),
});

// Read from SystemRegistry
const SYSTEM_REGISTRY = '0x0000000000000000000000000000000000001000';

const poolStoreAddress = await client.readContract({
  address: SYSTEM_REGISTRY,
  abi: [{ name: 'poolStore', type: 'function', inputs: [], outputs: [{ type: 'address' }] }],
  functionName: 'poolStore',
});

console.log('PoolStore:', poolStoreAddress);
```

## Data Persistence

**Development mode** (`npm run up`): Data is ephemeral - chain state and contracts are reset on each restart. Ideal for testing.

**Production mode** (`npm run up:prod`): Data persists in Docker volume. Stores are only deployed once (deployment script is idempotent).

## Verification

Check deployment status:

```bash
# Using npm script
npm run check:deployment

# Using cast (Foundry)
cast code 0x0000000000000000000000000000000000001000 --rpc-url http://localhost:8545
cast call 0x1000 "poolStore()(address)" --rpc-url http://localhost:8545
```

## Troubleshooting

### "SystemRegistry not deployed"

Genesis may not be configured correctly. Regenerate:

```bash
npm run generate:genesis
npm run reset
```

### "Stores not registered"

Deployment may have failed. Check logs and redeploy:

```bash
npm run logs:deploy
npm run deploy:stores
```

### Container won't start

Check Docker logs:

```bash
docker logs midcurve-geth-dev
```

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

### 3. Service Management

```bash
sudo systemctl start midcurve-geth
sudo systemctl stop midcurve-geth
sudo systemctl restart midcurve-geth
sudo journalctl -u midcurve-geth -f
```
