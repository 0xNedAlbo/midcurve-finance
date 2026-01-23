#!/usr/bin/env bash
# =============================================================================
# Production Deployment Script - Diamond Factory and Facets
# =============================================================================
#
# Deploys all contracts to Ethereum, Arbitrum, and Base mainnet chains.
#
# Prerequisites:
#   - Foundry installed (forge, cast)
#   - RPC URLs configured in foundry.toml or environment
#   - Either DEPLOYER_PRIVATE_KEY set or Ledger connected
#
# Usage:
#   With private key:
#     DEPLOYER_PRIVATE_KEY=0x... ./script/deploy-production.sh
#
#   With Ledger:
#     USE_LEDGER=true ./script/deploy-production.sh
#
#   Deploy to specific chain only:
#     CHAINS="arbitrum" ./script/deploy-production.sh
#     CHAINS="ethereum,base" ./script/deploy-production.sh
#
#   Dry run (simulation only):
#     DRY_RUN=true ./script/deploy-production.sh
#
#   Verify contracts after deployment:
#     VERIFY=true ETHERSCAN_API_KEY=xxx ./script/deploy-production.sh
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

# Change to project directory
cd "$PROJECT_DIR"

# =============================================================================
# Configuration
# =============================================================================

# Default chains to deploy (can be overridden with CHAINS env var)
DEFAULT_CHAINS="ethereum,arbitrum,base"
CHAINS="${CHAINS:-$DEFAULT_CHAINS}"

# Deployment results storage
RESULTS_FILE="$PROJECT_DIR/deployments/production-$(date +%Y%m%d-%H%M%S).json"

# =============================================================================
# Chain Configuration Functions (portable alternative to associative arrays)
# =============================================================================

get_chain_id() {
    case "$1" in
        ethereum) echo "1" ;;
        arbitrum) echo "42161" ;;
        base) echo "8453" ;;
        optimism) echo "10" ;;
        polygon) echo "137" ;;
        *) echo "" ;;
    esac
}

get_rpc_url() {
    case "$1" in
        ethereum) echo "$RPC_URL_ETHEREUM" ;;
        arbitrum) echo "$RPC_URL_ARBITRUM" ;;
        base) echo "$RPC_URL_BASE" ;;
        optimism) echo "$RPC_URL_OPTIMISM" ;;
        polygon) echo "$RPC_URL_POLYGON" ;;
        *) echo "" ;;
    esac
}

get_explorer_url() {
    case "$1" in
        ethereum) echo "https://etherscan.io" ;;
        arbitrum) echo "https://arbiscan.io" ;;
        base) echo "https://basescan.org" ;;
        optimism) echo "https://optimistic.etherscan.io" ;;
        polygon) echo "https://polygonscan.com" ;;
        *) echo "" ;;
    esac
}

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

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check forge is installed
    if ! command -v forge &> /dev/null; then
        log_error "forge not found. Please install Foundry: https://getfoundry.sh"
        exit 1
    fi

    # Check cast is installed
    if ! command -v cast &> /dev/null; then
        log_error "cast not found. Please install Foundry: https://getfoundry.sh"
        exit 1
    fi

    # Check authentication method
    if [ "$USE_LEDGER" != "true" ] && [ -z "$DEPLOYER_PRIVATE_KEY" ]; then
        log_error "No authentication method configured."
        log_error "Set DEPLOYER_PRIVATE_KEY or USE_LEDGER=true"
        exit 1
    fi

    # Check RPC URLs
    IFS=',' read -ra CHAIN_ARRAY <<< "$CHAINS"
    for chain in "${CHAIN_ARRAY[@]}"; do
        chain=$(echo "$chain" | xargs) # trim whitespace
        local rpc_url
        rpc_url=$(get_rpc_url "$chain")
        if [ -z "$rpc_url" ]; then
            log_error "RPC URL not configured for $chain"
            local upper_chain
            upper_chain=$(echo "$chain" | tr '[:lower:]' '[:upper:]')
            log_error "Set RPC_URL_${upper_chain} environment variable"
            exit 1
        fi
    done

    log_success "Prerequisites check passed"
}

build_contracts() {
    log_info "Building contracts..."
    # Note: Using regular build (not --sizes) because legacy contracts exceed 24KB.
    # The Diamond contracts being deployed are all under the limit.
    forge build
    log_success "Build complete"
}

get_deployer_address() {
    if [ "$USE_LEDGER" = "true" ]; then
        # For Ledger, we can't easily get the address without connecting
        echo "Ledger (address will be shown during deployment)"
    else
        cast wallet address "$DEPLOYER_PRIVATE_KEY"
    fi
}

# Global variables to store deployment results for each chain
RESULT_ethereum_factory=""
RESULT_ethereum_closer=""
RESULT_ethereum_diamond_cut=""
RESULT_ethereum_diamond_loupe=""
RESULT_ethereum_ownership=""
RESULT_ethereum_init=""
RESULT_ethereum_deposit_withdraw=""
RESULT_ethereum_state_transition=""
RESULT_ethereum_swap=""
RESULT_ethereum_settings=""
RESULT_ethereum_view=""
RESULT_ethereum_erc20=""

RESULT_arbitrum_factory=""
RESULT_arbitrum_closer=""
RESULT_arbitrum_diamond_cut=""
RESULT_arbitrum_diamond_loupe=""
RESULT_arbitrum_ownership=""
RESULT_arbitrum_init=""
RESULT_arbitrum_deposit_withdraw=""
RESULT_arbitrum_state_transition=""
RESULT_arbitrum_swap=""
RESULT_arbitrum_settings=""
RESULT_arbitrum_view=""
RESULT_arbitrum_erc20=""

RESULT_base_factory=""
RESULT_base_closer=""
RESULT_base_diamond_cut=""
RESULT_base_diamond_loupe=""
RESULT_base_ownership=""
RESULT_base_init=""
RESULT_base_deposit_withdraw=""
RESULT_base_state_transition=""
RESULT_base_swap=""
RESULT_base_settings=""
RESULT_base_view=""
RESULT_base_erc20=""

deploy_to_chain() {
    local chain=$1
    local chain_id
    chain_id=$(get_chain_id "$chain")
    local rpc_url
    rpc_url=$(get_rpc_url "$chain")

    local chain_upper
    chain_upper=$(echo "$chain" | tr '[:lower:]' '[:upper:]')

    echo ""
    echo "============================================================"
    echo -e "${BLUE}Deploying to ${chain_upper} (Chain ID: $chain_id)${NC}"
    echo "============================================================"
    echo ""

    # Build forge command
    local forge_cmd="forge script script/Deploy.s.sol --rpc-url $rpc_url"

    # Add authentication
    if [ "$USE_LEDGER" = "true" ]; then
        forge_cmd="$forge_cmd --ledger"
    else
        forge_cmd="$forge_cmd --private-key $DEPLOYER_PRIVATE_KEY"
    fi

    # Add broadcast flag unless dry run
    if [ "$DRY_RUN" != "true" ]; then
        forge_cmd="$forge_cmd --broadcast"
    else
        log_warning "DRY RUN MODE - Simulating deployment only"
    fi

    # Add verification if requested
    if [ "$VERIFY" = "true" ] && [ -n "$ETHERSCAN_API_KEY" ]; then
        forge_cmd="$forge_cmd --verify --etherscan-api-key $ETHERSCAN_API_KEY"
    fi

    # Execute deployment
    log_info "Running: forge script script/Deploy.s.sol --rpc-url <rpc> ..."

    local output
    if output=$(eval "$forge_cmd" 2>&1); then
        log_success "Deployment to $chain completed"

        # Extract addresses from output
        extract_addresses "$chain" "$output"
    else
        log_error "Deployment to $chain failed"
        echo "$output"
        return 1
    fi
}

extract_addresses() {
    local chain=$1
    local output=$2

    # Extract addresses using grep
    local closer factory diamond_cut diamond_loupe ownership init deposit_withdraw state_transition swap settings view erc20

    closer=$(echo "$output" | grep -o "UniswapV3PositionCloser deployed at: 0x[a-fA-F0-9]\{40\}" | grep -o "0x[a-fA-F0-9]\{40\}" | head -1)
    diamond_cut=$(echo "$output" | grep -o "DiamondCutFacet deployed at: 0x[a-fA-F0-9]\{40\}" | grep -o "0x[a-fA-F0-9]\{40\}" | head -1)
    diamond_loupe=$(echo "$output" | grep -o "DiamondLoupeFacet deployed at: 0x[a-fA-F0-9]\{40\}" | grep -o "0x[a-fA-F0-9]\{40\}" | head -1)
    ownership=$(echo "$output" | grep -o "OwnershipFacet deployed at: 0x[a-fA-F0-9]\{40\}" | grep -o "0x[a-fA-F0-9]\{40\}" | head -1)
    init=$(echo "$output" | grep -o "InitFacet deployed at: 0x[a-fA-F0-9]\{40\}" | grep -o "0x[a-fA-F0-9]\{40\}" | head -1)
    deposit_withdraw=$(echo "$output" | grep -o "DepositWithdrawFacet deployed at: 0x[a-fA-F0-9]\{40\}" | grep -o "0x[a-fA-F0-9]\{40\}" | head -1)
    state_transition=$(echo "$output" | grep -o "StateTransitionFacet deployed at: 0x[a-fA-F0-9]\{40\}" | grep -o "0x[a-fA-F0-9]\{40\}" | head -1)
    swap=$(echo "$output" | grep -o "SwapFacet deployed at: 0x[a-fA-F0-9]\{40\}" | grep -o "0x[a-fA-F0-9]\{40\}" | head -1)
    settings=$(echo "$output" | grep -o "SettingsFacet deployed at: 0x[a-fA-F0-9]\{40\}" | grep -o "0x[a-fA-F0-9]\{40\}" | head -1)
    view=$(echo "$output" | grep -o "ViewFacet deployed at: 0x[a-fA-F0-9]\{40\}" | grep -o "0x[a-fA-F0-9]\{40\}" | head -1)
    erc20=$(echo "$output" | grep -o "ERC20Facet deployed at: 0x[a-fA-F0-9]\{40\}" | grep -o "0x[a-fA-F0-9]\{40\}" | head -1)
    factory=$(echo "$output" | grep -o "MidcurveHedgeVaultDiamondFactory deployed at: 0x[a-fA-F0-9]\{40\}" | grep -o "0x[a-fA-F0-9]\{40\}" | head -1)

    # Store in global variables based on chain
    case "$chain" in
        ethereum)
            RESULT_ethereum_closer="$closer"
            RESULT_ethereum_factory="$factory"
            RESULT_ethereum_diamond_cut="$diamond_cut"
            RESULT_ethereum_diamond_loupe="$diamond_loupe"
            RESULT_ethereum_ownership="$ownership"
            RESULT_ethereum_init="$init"
            RESULT_ethereum_deposit_withdraw="$deposit_withdraw"
            RESULT_ethereum_state_transition="$state_transition"
            RESULT_ethereum_swap="$swap"
            RESULT_ethereum_settings="$settings"
            RESULT_ethereum_view="$view"
            RESULT_ethereum_erc20="$erc20"
            ;;
        arbitrum)
            RESULT_arbitrum_closer="$closer"
            RESULT_arbitrum_factory="$factory"
            RESULT_arbitrum_diamond_cut="$diamond_cut"
            RESULT_arbitrum_diamond_loupe="$diamond_loupe"
            RESULT_arbitrum_ownership="$ownership"
            RESULT_arbitrum_init="$init"
            RESULT_arbitrum_deposit_withdraw="$deposit_withdraw"
            RESULT_arbitrum_state_transition="$state_transition"
            RESULT_arbitrum_swap="$swap"
            RESULT_arbitrum_settings="$settings"
            RESULT_arbitrum_view="$view"
            RESULT_arbitrum_erc20="$erc20"
            ;;
        base)
            RESULT_base_closer="$closer"
            RESULT_base_factory="$factory"
            RESULT_base_diamond_cut="$diamond_cut"
            RESULT_base_diamond_loupe="$diamond_loupe"
            RESULT_base_ownership="$ownership"
            RESULT_base_init="$init"
            RESULT_base_deposit_withdraw="$deposit_withdraw"
            RESULT_base_state_transition="$state_transition"
            RESULT_base_swap="$swap"
            RESULT_base_settings="$settings"
            RESULT_base_view="$view"
            RESULT_base_erc20="$erc20"
            ;;
    esac
}

get_result() {
    local chain=$1
    local contract=$2
    local var_name="RESULT_${chain}_${contract}"
    eval echo "\$$var_name"
}

save_deployment_results() {
    # Create deployments directory if it doesn't exist
    mkdir -p "$PROJECT_DIR/deployments"

    log_info "Saving deployment results to $RESULTS_FILE"

    # Build JSON output
    cat > "$RESULTS_FILE" << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployer": "$(get_deployer_address)",
  "dryRun": ${DRY_RUN:-false},
  "chains": {
EOF

    local first=true
    IFS=',' read -ra CHAIN_ARRAY <<< "$CHAINS"
    for chain in "${CHAIN_ARRAY[@]}"; do
        chain=$(echo "$chain" | xargs)
        local chain_id
        chain_id=$(get_chain_id "$chain")
        local explorer
        explorer=$(get_explorer_url "$chain")

        if [ "$first" = true ]; then
            first=false
        else
            echo "    }," >> "$RESULTS_FILE"
        fi

        cat >> "$RESULTS_FILE" << EOF
    "$chain": {
      "chainId": $chain_id,
      "explorer": "$explorer",
      "contracts": {
        "UniswapV3PositionCloser": "$(get_result "$chain" "closer")",
        "DiamondCutFacet": "$(get_result "$chain" "diamond_cut")",
        "DiamondLoupeFacet": "$(get_result "$chain" "diamond_loupe")",
        "OwnershipFacet": "$(get_result "$chain" "ownership")",
        "InitFacet": "$(get_result "$chain" "init")",
        "DepositWithdrawFacet": "$(get_result "$chain" "deposit_withdraw")",
        "StateTransitionFacet": "$(get_result "$chain" "state_transition")",
        "SwapFacet": "$(get_result "$chain" "swap")",
        "SettingsFacet": "$(get_result "$chain" "settings")",
        "ViewFacet": "$(get_result "$chain" "view")",
        "ERC20Facet": "$(get_result "$chain" "erc20")",
        "MidcurveHedgeVaultDiamondFactory": "$(get_result "$chain" "factory")"
      }
EOF
    done

    cat >> "$RESULTS_FILE" << EOF
    }
  }
}
EOF

    log_success "Results saved to $RESULTS_FILE"
}

print_summary() {
    echo ""
    echo "============================================================"
    echo -e "${GREEN}DEPLOYMENT SUMMARY${NC}"
    echo "============================================================"
    echo ""

    IFS=',' read -ra CHAIN_ARRAY <<< "$CHAINS"
    for chain in "${CHAIN_ARRAY[@]}"; do
        chain=$(echo "$chain" | xargs)
        local chain_id
        chain_id=$(get_chain_id "$chain")
        local explorer
        explorer=$(get_explorer_url "$chain")

        echo -e "${BLUE}$chain (Chain ID: $chain_id)${NC}"
        echo "----------------------------------------"

        local factory closer
        factory=$(get_result "$chain" "factory")
        closer=$(get_result "$chain" "closer")

        if [ -n "$factory" ]; then
            echo "Factory:         $factory"
            echo "                 $explorer/address/$factory"
            echo ""
            echo "PositionCloser:  $closer"
            echo ""
            echo "Facets:"
            echo "  DiamondCut:      $(get_result "$chain" "diamond_cut")"
            echo "  DiamondLoupe:    $(get_result "$chain" "diamond_loupe")"
            echo "  Ownership:       $(get_result "$chain" "ownership")"
            echo "  Init:            $(get_result "$chain" "init")"
            echo "  DepositWithdraw: $(get_result "$chain" "deposit_withdraw")"
            echo "  StateTransition: $(get_result "$chain" "state_transition")"
            echo "  Swap:            $(get_result "$chain" "swap")"
            echo "  Settings:        $(get_result "$chain" "settings")"
            echo "  View:            $(get_result "$chain" "view")"
            echo "  ERC20:           $(get_result "$chain" "erc20")"
        else
            echo "  (No addresses extracted - check deployment logs)"
        fi
        echo ""
    done

    echo "============================================================"
    echo "NEXT STEPS"
    echo "============================================================"
    echo ""
    echo "1. Update UI config with factory addresses:"
    echo "   apps/midcurve-ui/src/config/contracts/hedge-vault-diamond-factory.ts"
    echo ""
    echo "2. Verify contracts on block explorers (if not already done):"
    IFS=',' read -ra CHAIN_ARRAY <<< "$CHAINS"
    for chain in "${CHAIN_ARRAY[@]}"; do
        chain=$(echo "$chain" | xargs)
        local chain_id
        chain_id=$(get_chain_id "$chain")
        echo "   forge verify-contract --chain-id $chain_id <address> <Contract>"
    done
    echo ""
    echo "3. Test factory by creating a diamond:"
    echo "   cast send <factory> \"createDiamond(uint256,address,string,string)\" \\"
    echo "     <positionId> <operator> \"Vault Name\" \"SYMBOL\" \\"
    echo "     --rpc-url <chain> --private-key \$DEPLOYER_PRIVATE_KEY"
    echo ""
    echo "============================================================"
}

# =============================================================================
# Main Execution
# =============================================================================

main() {
    echo ""
    echo "============================================================"
    echo -e "${BLUE}Midcurve Finance - Production Deployment${NC}"
    echo "============================================================"
    echo ""
    echo "Deploying: Diamond Factory + 10 Facets + PositionCloser"
    echo "Chains:    $CHAINS"
    echo "Mode:      $([ "$DRY_RUN" = "true" ] && echo "DRY RUN (simulation)" || echo "LIVE DEPLOYMENT")"
    echo "Auth:      $([ "$USE_LEDGER" = "true" ] && echo "Ledger" || echo "Private Key")"
    echo "Verify:    $([ "$VERIFY" = "true" ] && echo "Yes" || echo "No")"
    echo ""

    # Confirm before proceeding
    if [ "$DRY_RUN" != "true" ]; then
        echo -e "${YELLOW}WARNING: This will deploy contracts to PRODUCTION chains!${NC}"
        echo ""
        read -p "Continue? (yes/no): " confirm
        if [ "$confirm" != "yes" ]; then
            log_info "Deployment cancelled"
            exit 0
        fi
    fi

    # Run checks and build
    check_prerequisites
    build_contracts

    # Deploy to each chain
    local failed_chains=""
    IFS=',' read -ra CHAIN_ARRAY <<< "$CHAINS"
    for chain in "${CHAIN_ARRAY[@]}"; do
        chain=$(echo "$chain" | xargs) # trim whitespace
        if ! deploy_to_chain "$chain"; then
            failed_chains="$failed_chains $chain"
        fi
    done

    # Save results
    save_deployment_results

    # Print summary
    print_summary

    # Report failures
    if [ -n "$failed_chains" ]; then
        echo ""
        log_error "Deployment failed for:$failed_chains"
        exit 1
    fi

    log_success "All deployments completed successfully!"
}

# Run main function
main "$@"
