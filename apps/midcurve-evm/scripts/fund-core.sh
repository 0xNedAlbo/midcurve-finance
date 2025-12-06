#!/bin/sh
# fund-core.sh - Fund CORE account from Geth's dev account
#
# This script transfers ETH from Geth's pre-funded dev account to the CORE account
# (Foundry default account 0). This is needed because Geth's dev account has a
# random address that changes on each init, while CORE has a deterministic address
# derived from a well-known private key.
#
# Note: This script uses only tools available in the Foundry image (cast, sh).

set -e

# Suppress Foundry nightly warning
export FOUNDRY_DISABLE_NIGHTLY_WARNING=1

CORE_ADDRESS="${CORE_ADDRESS:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"
# 1000 ETH in wei, pre-calculated hex: 0x3635c9adc5dea00000
FUNDING_AMOUNT_HEX="0x3635c9adc5dea00000"
RPC_URL="${RPC_URL:-http://geth:8545}"

echo "========================================"
echo "SEMSEE CORE Account Funding Script"
echo "========================================"
echo "CORE Address: $CORE_ADDRESS"
echo "RPC URL: $RPC_URL"
echo "Funding Amount: 1000 ETH"
echo ""

echo "Waiting for Geth to be ready..."
attempts=0
max_attempts=60
until cast block-number --rpc-url "$RPC_URL" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ $attempts -ge $max_attempts ]; then
        echo "ERROR: Geth did not become ready after $max_attempts attempts"
        exit 1
    fi
    echo "  Attempt $attempts/$max_attempts - Geth not ready yet..."
    sleep 1
done

echo "Geth is ready!"
echo ""

# Get Geth's dev account (first account)
# The output is like: ["0x..."] (may have newlines)
# We use tr to remove newlines, then sed to extract the address
echo "Fetching Geth dev account..."
RAW_ACCOUNTS=$(cast rpc --rpc-url "$RPC_URL" eth_accounts 2>/dev/null)
# Remove newlines and extract address between quotes
DEV_ACCOUNT=$(echo "$RAW_ACCOUNTS" | tr -d '\n\r' | sed 's/.*"\(0x[a-fA-F0-9]\{40\}\)".*/\1/')

# Validate we got a proper address (starts with 0x, 42 chars total)
if [ -z "$DEV_ACCOUNT" ] || [ "$DEV_ACCOUNT" = "null" ] || [ "${DEV_ACCOUNT#0x}" = "$DEV_ACCOUNT" ]; then
    echo "ERROR: Could not get dev account from Geth"
    echo "Raw response: $RAW_ACCOUNTS"
    echo "Parsed account: $DEV_ACCOUNT"
    exit 1
fi

echo "Dev account: $DEV_ACCOUNT"

# Check dev account balance (--ether flag gives human-readable output)
DEV_BALANCE=$(cast balance --rpc-url "$RPC_URL" "$DEV_ACCOUNT" --ether 2>/dev/null || echo "0")
echo "Dev account balance: $DEV_BALANCE ETH"

# Check if CORE already has funds
CORE_BALANCE_WEI=$(cast balance --rpc-url "$RPC_URL" "$CORE_ADDRESS" 2>/dev/null || echo "0")
CORE_BALANCE_ETH=$(cast balance --rpc-url "$RPC_URL" "$CORE_ADDRESS" --ether 2>/dev/null || echo "0")
echo "CORE account balance: $CORE_BALANCE_ETH ETH"

# Only fund if CORE balance is 0 or very small
if [ "$CORE_BALANCE_WEI" = "0" ] || [ ${#CORE_BALANCE_WEI} -lt 20 ]; then
    echo ""
    echo "Funding CORE account with 1000 ETH..."

    # In Geth dev mode, the dev account is already unlocked by default
    # Just send the transaction directly using eth_sendTransaction
    echo "  Sending transaction..."

    # Use cast send with unlocked account (Geth dev mode has accounts unlocked)
    # Note: In dev mode, accounts are auto-unlocked, no need for personal_unlockAccount
    TX_RESULT=$(cast rpc --rpc-url "$RPC_URL" eth_sendTransaction \
        "{\"from\":\"$DEV_ACCOUNT\",\"to\":\"$CORE_ADDRESS\",\"value\":\"$FUNDING_AMOUNT_HEX\"}" 2>/dev/null)

    # Extract tx hash (remove quotes)
    TX_HASH=$(echo "$TX_RESULT" | sed 's/"//g')
    echo "  Transaction hash: $TX_HASH"

    # Wait for confirmation
    echo "  Waiting for confirmation..."
    sleep 2

    # Check new balance
    NEW_BALANCE=$(cast balance --rpc-url "$RPC_URL" "$CORE_ADDRESS" --ether 2>/dev/null || echo "0")
    echo ""
    echo "CORE account new balance: $NEW_BALANCE ETH"
else
    echo ""
    echo "CORE account already has sufficient funds ($CORE_BALANCE_ETH ETH), skipping funding."
fi

echo ""
echo "========================================"
echo "Funding complete!"
echo "========================================"
