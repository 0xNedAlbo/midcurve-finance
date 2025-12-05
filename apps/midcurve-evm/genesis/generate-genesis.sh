#!/bin/bash
#
# Generate genesis.json with SystemRegistry bytecode pre-allocated
#
# This script:
# 1. Builds the contracts with Foundry
# 2. Extracts the runtime bytecode for SystemRegistry
# 3. Generates genesis.json from the template
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONTRACTS_DIR="$PROJECT_DIR/contracts"

# Default signer address (Foundry's default first account)
# Private key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
SIGNER_ADDRESS="${SIGNER_ADDRESS:-f39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"

echo "=== Generating Genesis Configuration ==="
echo "Signer address: 0x$SIGNER_ADDRESS"

# Build contracts
echo ""
echo "Building contracts..."
cd "$CONTRACTS_DIR"
forge build --force

# Extract runtime bytecode
echo ""
echo "Extracting SystemRegistry runtime bytecode..."
ARTIFACT_FILE="$CONTRACTS_DIR/out/SystemRegistry.sol/SystemRegistry.json"

if [ ! -f "$ARTIFACT_FILE" ]; then
    echo "ERROR: Artifact not found at $ARTIFACT_FILE"
    echo "Make sure 'forge build' completed successfully"
    exit 1
fi

# Extract deployedBytecode.object (runtime bytecode, not creation bytecode)
SYSTEM_REGISTRY_BYTECODE=$(cat "$ARTIFACT_FILE" | grep -o '"deployedBytecode":{"object":"[^"]*"' | sed 's/"deployedBytecode":{"object":"//;s/"$//')

if [ -z "$SYSTEM_REGISTRY_BYTECODE" ] || [ "$SYSTEM_REGISTRY_BYTECODE" == "0x" ]; then
    echo "ERROR: Failed to extract bytecode"
    exit 1
fi

echo "Bytecode extracted: ${SYSTEM_REGISTRY_BYTECODE:0:50}..."

# Generate genesis.json
echo ""
echo "Generating genesis.json..."

# Read template and substitute placeholders
# Note: Using lowercase for addresses without 0x prefix in genesis
SIGNER_LOWER=$(echo "$SIGNER_ADDRESS" | tr '[:upper:]' '[:lower:]')

# Remove comments from JSON (they're not valid JSON, just for documentation)
# and substitute placeholders
cat "$SCRIPT_DIR/genesis-template.json" | \
    grep -v '"comment"' | \
    sed "s/__SIGNER_ADDRESS__/$SIGNER_LOWER/g" | \
    sed "s/__SYSTEM_REGISTRY_BYTECODE__/$SYSTEM_REGISTRY_BYTECODE/g" \
    > "$SCRIPT_DIR/genesis.json"

echo "Genesis file created at: $SCRIPT_DIR/genesis.json"
echo ""
echo "=== Configuration Summary ==="
echo "Chain ID: 31337"
echo "Consensus: Clique PoA (instant blocks)"
echo "Pre-funded accounts:"
echo "  - Core (0x0000...0001): 1,000,000 ETH"
echo "  - Signer (0x$SIGNER_ADDRESS): 1,000,000 ETH"
echo "Pre-deployed contracts:"
echo "  - SystemRegistry: 0x0000000000000000000000000000000000001000"
echo ""
echo "Done!"
