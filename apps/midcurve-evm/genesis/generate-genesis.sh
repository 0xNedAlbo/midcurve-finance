#!/bin/bash
#
# Generate genesis.json for the Midcurve EVM development node.
#
# This script generates a simple genesis with pre-funded accounts
# for the Clique PoA signer and operator.
#
# Environment Variables:
#   CORE_ADDRESS - The address of the operator (without 0x prefix)
#                  This account is used for block signing (Clique PoA)
#                  and strategy operations (deploying, calling step())
#                  Default: Foundry's default account 0

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default Core address (Foundry's default first account)
# Derived from private key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
CORE_ADDRESS="${CORE_ADDRESS:-f39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"

# For backwards compatibility
SIGNER_ADDRESS="${SIGNER_ADDRESS:-$CORE_ADDRESS}"

echo "=== Generating Genesis Configuration ==="
echo "Signer/Operator address: 0x$SIGNER_ADDRESS"

# Generate genesis.json
echo ""
echo "Generating genesis.json..."

# Read template and substitute placeholders
# Note: Using lowercase for addresses without 0x prefix in genesis
SIGNER_LOWER=$(echo "$SIGNER_ADDRESS" | tr '[:upper:]' '[:lower:]')

# Substitute placeholders in template
cat "$SCRIPT_DIR/genesis-template.json" | \
    sed "s/__SIGNER_ADDRESS__/$SIGNER_LOWER/g" \
    > "$SCRIPT_DIR/genesis.json"

echo "Genesis file created at: $SCRIPT_DIR/genesis.json"
echo ""
echo "=== Configuration Summary ==="
echo "Chain ID: 31337"
echo "Consensus: Clique PoA (instant blocks, period=0)"
echo "Pre-funded accounts:"
echo "  - Burn address (0x0000...0001): 1,000,000 ETH"
echo "  - Signer (0x$SIGNER_ADDRESS): 1,000,000 ETH"
echo ""
echo "Done!"
