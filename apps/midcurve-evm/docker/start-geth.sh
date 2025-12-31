#!/bin/sh
#
# Start Geth with custom genesis (Clique PoA mode)
#
# This script:
# 1. Initializes the chain from genesis.json if needed
# 2. Imports the signer key for Clique block signing
# 3. Starts Geth with mining enabled

set -e

DATADIR="/data"
GENESIS="/genesis.json"
KEYSTORE_DIR="$DATADIR/keystore"
PASSWORD_FILE="$DATADIR/.password"

# Signer account (Foundry default #0)
# This is both the Clique block signer and the Core admin account
SIGNER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
SIGNER_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

# Check if genesis needs to be initialized
if [ ! -d "$DATADIR/geth" ]; then
    echo "Initializing genesis block..."
    geth --datadir "$DATADIR" init "$GENESIS"
    echo "Genesis initialized"
fi

# Create password file (empty password for dev)
if [ ! -f "$PASSWORD_FILE" ]; then
    echo "" > "$PASSWORD_FILE"
fi

# Import signer key if not already present
if [ ! -d "$KEYSTORE_DIR" ] || [ -z "$(ls -A $KEYSTORE_DIR 2>/dev/null)" ]; then
    echo "Importing signer key..."
    # Create a temp file with the private key (without 0x prefix)
    TEMP_KEY=$(mktemp)
    echo "${SIGNER_KEY#0x}" > "$TEMP_KEY"

    geth --datadir "$DATADIR" account import --password "$PASSWORD_FILE" "$TEMP_KEY"
    rm "$TEMP_KEY"
    echo "Signer key imported"
fi

echo "Starting Geth (Clique PoA mode)..."
echo "Signer address: $SIGNER_ADDRESS"

# Start Geth with Clique mining
exec geth \
    --datadir "$DATADIR" \
    --networkid 31337 \
    --mine \
    --miner.etherbase "$SIGNER_ADDRESS" \
    --unlock "$SIGNER_ADDRESS" \
    --password "$PASSWORD_FILE" \
    --http \
    --http.addr "0.0.0.0" \
    --http.port 8545 \
    --http.api "eth,net,web3,personal,debug,clique" \
    --http.corsdomain "*" \
    --http.vhosts "*" \
    --ws \
    --ws.addr "0.0.0.0" \
    --ws.port 8546 \
    --ws.api "eth,net,web3" \
    --ws.origins "*" \
    --allow-insecure-unlock \
    --nodiscover \
    --maxpeers 0
