#!/usr/bin/env bash
# =============================================================================
# Local Deployment Script - Diamond Factory and Facets
# =============================================================================
#
# Deploys the MidcurveHedgeVaultDiamondFactory to local Anvil fork.
#
# Prerequisites:
#   - Foundry installed (forge)
#   - Anvil running on port 8545 (pnpm local:anvil in midcurve-automation)
#   - MOCK_AUGUSTUS_ADDRESS set in root .env (deployed by midcurve-automation local:setup)
#
# Usage:
#   pnpm deploy:local
#
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MONOREPO_ROOT="$(dirname "$(dirname "$PROJECT_DIR")")"
ENV_FILE="$MONOREPO_ROOT/.env"

# Foundry test account #0 (pre-funded in Anvil)
FOUNDRY_SENDER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

# =============================================================================
# Helper Functions
# =============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Load a variable from .env file
load_env_var() {
    local key=$1
    local file=$2

    if [ ! -f "$file" ]; then
        echo ""
        return
    fi

    # Extract value, handling quotes
    local value
    value=$(grep "^${key}=" "$file" 2>/dev/null | head -1 | cut -d'=' -f2-)
    # Remove surrounding quotes if present
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    echo "$value"
}

# Update or append a variable in .env file
update_env_var() {
    local key=$1
    local value=$2
    local file=$3

    if [ ! -f "$file" ]; then
        log_error ".env file not found: $file"
        return 1
    fi

    # Check if key exists
    if grep -q "^${key}=" "$file"; then
        # Update existing key (macOS compatible sed)
        sed -i '' "s|^${key}=.*|${key}=\"${value}\"|" "$file"
    else
        # Append new key
        echo "${key}=\"${value}\"" >> "$file"
    fi
}

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check forge is installed
    if ! command -v forge &> /dev/null; then
        log_error "forge not found. Please install Foundry: https://getfoundry.sh"
        exit 1
    fi

    # Check Anvil is running
    if ! curl -s http://localhost:8545 -X POST -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' > /dev/null 2>&1; then
        log_error "Anvil not running on port 8545"
        log_error "Start it with: cd apps/midcurve-automation && pnpm local:anvil"
        exit 1
    fi

    # Check .env file exists
    if [ ! -f "$ENV_FILE" ]; then
        log_error ".env file not found at: $ENV_FILE"
        exit 1
    fi

    # Check MOCK_AUGUSTUS_ADDRESS is set
    MOCK_AUGUSTUS_ADDRESS=$(load_env_var "MOCK_AUGUSTUS_ADDRESS" "$ENV_FILE")
    if [ -z "$MOCK_AUGUSTUS_ADDRESS" ]; then
        log_error "MOCK_AUGUSTUS_ADDRESS not set in .env"
        log_error "Run 'cd apps/midcurve-automation && pnpm local:setup' first"
        exit 1
    fi

    log_success "Prerequisites check passed"
    log_info "Using MOCK_AUGUSTUS_ADDRESS: $MOCK_AUGUSTUS_ADDRESS"
}

deploy_factory() {
    log_info "Building contracts..."
    cd "$PROJECT_DIR"
    forge build
    log_success "Build complete"

    log_info "Deploying Diamond Factory to local Anvil..."

    # Run forge script and capture output
    local output
    if output=$(MOCK_AUGUSTUS_ADDRESS="$MOCK_AUGUSTUS_ADDRESS" forge script \
        script/DeployFactoryLocal.s.sol \
        --rpc-url local \
        --broadcast \
        --unlocked \
        --sender "$FOUNDRY_SENDER" 2>&1); then

        log_success "Deployment complete"

        # Extract factory address from output
        FACTORY_ADDRESS=$(echo "$output" | grep -o "MidcurveHedgeVaultDiamondFactory deployed at: 0x[a-fA-F0-9]\{40\}" | grep -o "0x[a-fA-F0-9]\{40\}" | tail -1)

        if [ -z "$FACTORY_ADDRESS" ]; then
            log_warning "Could not extract factory address from output"
            echo "$output"
            return 1
        fi

        log_success "Factory deployed at: $FACTORY_ADDRESS"
    else
        log_error "Deployment failed"
        echo "$output"
        return 1
    fi
}

update_env_file() {
    log_info "Updating .env file..."

    update_env_var "HEDGE_VAULT_FACTORY_ADDRESS_LOCAL" "$FACTORY_ADDRESS" "$ENV_FILE"
    update_env_var "VITE_HEDGE_VAULT_FACTORY_ADDRESS_LOCAL" "$FACTORY_ADDRESS" "$ENV_FILE"

    log_success "Updated .env with:"
    log_info "  HEDGE_VAULT_FACTORY_ADDRESS_LOCAL=\"$FACTORY_ADDRESS\""
    log_info "  VITE_HEDGE_VAULT_FACTORY_ADDRESS_LOCAL=\"$FACTORY_ADDRESS\""
}

# =============================================================================
# Main Execution
# =============================================================================

main() {
    echo ""
    echo "============================================================"
    echo -e "${BLUE}Midcurve Hedges - Local Diamond Factory Deployment${NC}"
    echo "============================================================"
    echo ""

    check_prerequisites
    deploy_factory
    update_env_file

    echo ""
    echo "============================================================"
    echo -e "${GREEN}Deployment Complete!${NC}"
    echo "============================================================"
    echo ""
    echo "Factory Address: $FACTORY_ADDRESS"
    echo ""
    echo "To create a new hedge vault diamond:"
    echo "  cast send $FACTORY_ADDRESS \"createDiamond(uint256,address,string,string)\" \\"
    echo "    <positionId> <operator> \"Vault Name\" \"SYMBOL\" \\"
    echo "    --rpc-url http://localhost:8545 --unlocked --from $FOUNDRY_SENDER"
    echo ""
}

main "$@"
