#!/bin/bash
#
# Check the deployment status of Store contracts
#
# Usage:
#   ./scripts/check-deployment.sh [RPC_URL]
#
# Arguments:
#   RPC_URL - Optional. Defaults to http://localhost:8545
#

set -e

RPC_URL="${1:-http://localhost:8545}"

SYSTEM_REGISTRY="0x0000000000000000000000000000000000001000"

echo "=== Checking Store Contract Deployment ==="
echo "RPC URL: $RPC_URL"
echo ""

# Check if node is running
echo "Checking node connectivity..."
BLOCK_NUM=$(curl -s -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | \
    grep -o '"result":"[^"]*"' | sed 's/"result":"//;s/"$//')

if [ -z "$BLOCK_NUM" ]; then
    echo "ERROR: Cannot connect to $RPC_URL"
    exit 1
fi
echo "Current block: $BLOCK_NUM"
echo ""

# Check SystemRegistry code
echo "Checking SystemRegistry at $SYSTEM_REGISTRY..."
CODE=$(cast code "$SYSTEM_REGISTRY" --rpc-url "$RPC_URL" 2>/dev/null || echo "0x")

if [ "$CODE" == "0x" ] || [ -z "$CODE" ]; then
    echo "  Status: NOT DEPLOYED"
    echo ""
    echo "SystemRegistry is not deployed. Genesis may not be configured correctly."
    exit 1
fi

echo "  Status: DEPLOYED"
echo "  Code size: $((${#CODE}/2 - 1)) bytes"
echo ""

# Check store addresses
echo "Checking registered stores..."

POOL_STORE=$(cast call "$SYSTEM_REGISTRY" "poolStore()(address)" --rpc-url "$RPC_URL" 2>/dev/null || echo "0x0")
POSITION_STORE=$(cast call "$SYSTEM_REGISTRY" "positionStore()(address)" --rpc-url "$RPC_URL" 2>/dev/null || echo "0x0")
BALANCE_STORE=$(cast call "$SYSTEM_REGISTRY" "balanceStore()(address)" --rpc-url "$RPC_URL" 2>/dev/null || echo "0x0")
OHLC_STORE=$(cast call "$SYSTEM_REGISTRY" "ohlcStore()(address)" --rpc-url "$RPC_URL" 2>/dev/null || echo "0x0")

echo "  PoolStore:     $POOL_STORE"
echo "  PositionStore: $POSITION_STORE"
echo "  BalanceStore:  $BALANCE_STORE"
echo "  OhlcStore:     $OHLC_STORE"
echo ""

# Check if stores are deployed
ZERO_ADDR="0x0000000000000000000000000000000000000000"

if [ "$POOL_STORE" == "$ZERO_ADDR" ]; then
    echo "=== Status: STORES NOT DEPLOYED ==="
    echo "Run 'npm run deploy:stores' or 'docker-compose up deploy-stores' to deploy"
    exit 1
fi

echo "=== Status: ALL STORES DEPLOYED ==="
echo ""
echo "Well-known addresses:"
echo "  Core:           0x0000000000000000000000000000000000000001"
echo "  SystemRegistry: $SYSTEM_REGISTRY"
echo ""
echo "Store addresses (registered in SystemRegistry):"
echo "  PoolStore:      $POOL_STORE"
echo "  PositionStore:  $POSITION_STORE"
echo "  BalanceStore:   $BALANCE_STORE"
echo "  OhlcStore:      $OHLC_STORE"
