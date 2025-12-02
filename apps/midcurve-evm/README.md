# @midcurve/evm

Local EVM development node using Geth in Docker for testing and development.

## Prerequisites

- Docker and Docker Compose installed
- Port 8545 (HTTP RPC) and 8546 (WebSocket) available

## Quick Start

```bash
# Start the node
npm run up

# Check status
npm run status

# View logs
npm run logs

# Stop the node
npm run down
```

## Available Scripts

### Development (Ephemeral - No Persistence)

| Script | Description |
|--------|-------------|
| `npm run up` | Start the Geth dev node (data lost on restart) |
| `npm run down` | Stop and remove the container |
| `npm run stop` | Stop the container |
| `npm run start` | Start a stopped container |
| `npm run restart` | Restart the container |
| `npm run logs` | Follow container logs |
| `npm run status` | Show container status |
| `npm run reset` | Restart fresh |
| `npm run health` | Check if the RPC endpoint is responding |

### Production (Persistent Storage)

| Script | Description |
|--------|-------------|
| `npm run up:prod` | Start with persistent volume |
| `npm run down:prod` | Stop (data preserved in volume) |
| `npm run reset:prod` | Remove volume data and restart fresh |

## Endpoints

- **HTTP RPC:** `http://localhost:8545`
- **WebSocket:** `ws://localhost:8546`

## Configuration

The Geth node runs in `--dev` mode which:
- Pre-funds a developer account with ETH
- Mines blocks on demand (when transactions are sent)
- Enables all development APIs

### Enabled APIs

- `eth` - Ethereum protocol
- `net` - Network info
- `web3` - Web3 utilities
- `personal` - Account management
- `txpool` - Transaction pool inspection

## Usage with viem

```typescript
import { createPublicClient, http } from 'viem';

const client = createPublicClient({
  transport: http('http://localhost:8545'),
});

const blockNumber = await client.getBlockNumber();
```

## Data Persistence

**Development mode** (`npm run up`): Data is ephemeral - chain state is lost when the container stops. This is ideal for testing where you want a fresh state each time.

**Production mode** (`npm run up:prod`): Data is persisted in a Docker named volume (`geth-dev-data`). Chain state survives container restarts.

To reset production data:
```bash
npm run reset:prod
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
# Reload systemd
sudo systemctl daemon-reload

# Enable on boot
sudo systemctl enable midcurve-geth

# Start the service
sudo systemctl start midcurve-geth

# Check status
sudo systemctl status midcurve-geth
```

### 3. Service Management

```bash
# Start
sudo systemctl start midcurve-geth

# Stop
sudo systemctl stop midcurve-geth

# Restart
sudo systemctl restart midcurve-geth

# View status
sudo systemctl status midcurve-geth

# View logs (systemd)
sudo journalctl -u midcurve-geth -f

# View logs (docker)
docker logs -f midcurve-geth-dev
```

### 4. Log Rotation

Docker handles log rotation automatically. Configure in `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  }
}
```

Restart Docker after changes:
```bash
sudo systemctl restart docker
```

Alternatively, configure per-container in `docker-compose.prod.yml`:

```yaml
services:
  geth-dev:
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "5"
```

### 5. Logrotate for External Log Files (Optional)

If you redirect logs to files, create `/etc/logrotate.d/midcurve-geth`:

```
/var/log/midcurve/geth/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root adm
    sharedscripts
    postrotate
        docker kill --signal=USR1 midcurve-geth-dev 2>/dev/null || true
    endscript
}
```

### 6. Firewall Configuration (UFW)

```bash
# Allow RPC access (localhost only - recommended)
# No firewall rules needed, Docker binds to localhost by default

# Allow RPC access from specific IP (if needed)
sudo ufw allow from 192.168.1.0/24 to any port 8545

# Allow WebSocket access from specific IP (if needed)
sudo ufw allow from 192.168.1.0/24 to any port 8546
```

### 7. Health Check Script

Create `/opt/midcurve/scripts/geth-healthcheck.sh`:

```bash
#!/bin/bash
RESPONSE=$(curl -s -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  --max-time 5)

if echo "$RESPONSE" | grep -q "result"; then
  echo "OK: Geth is responding"
  exit 0
else
  echo "FAIL: Geth not responding"
  exit 1
fi
```

```bash
chmod +x /opt/midcurve/scripts/geth-healthcheck.sh
```

### 8. Cron Health Monitoring (Optional)

Add to root crontab (`sudo crontab -e`):

```cron
*/5 * * * * /opt/midcurve/scripts/geth-healthcheck.sh || systemctl restart midcurve-geth
```
