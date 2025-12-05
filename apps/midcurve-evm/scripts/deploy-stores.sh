#!/bin/bash
#
# Deploy Store contracts to a running Geth node
#
# Usage:
#   ./scripts/deploy-stores.sh [RPC_URL]
#
# Arguments:
#   RPC_URL - Optional. Defaults to http://localhost:8545
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONTRACTS_DIR="$PROJECT_DIR/contracts"

RPC_URL="${1:-http://localhost:8545}"

# Core private key (address 0x1 has this trivial private key)
CORE_PRIVATE_KEY="0x0000000000000000000000000000000000000000000000000000000000000001"

echo "=== Deploying Store Contracts ==="
echo "RPC URL: $RPC_URL"
echo ""

# Check if node is running
echo "Checking node connectivity..."
if ! curl -s -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' > /dev/null; then
    echo "ERROR: Cannot connect to $RPC_URL"
    echo "Make sure the Geth node is running"
    exit 1
fi
echo "Node is running!"

# Run deployment script
echo ""
echo "Running deployment script..."
cd "$CONTRACTS_DIR"

forge script script/DeployStores.s.sol \
    --rpc-url "$RPC_URL" \
    --private-key "$CORE_PRIVATE_KEY" \
    --broadcast \
    -vvvv

echo ""
echo "=== Deployment Complete ==="
