#!/bin/bash
# =============================================================================
# Midcurve Finance - Production Deployment Script
# =============================================================================
#
# This script deploys the Midcurve Finance stack to a production server.
#
# Prerequisites:
#   - Docker and Docker Compose installed
#   - .env file configured (copy from .env.example)
#   - DNS records pointing to this server
#   - Ports 80 and 443 open
#
# Usage:
#   ./scripts/deploy.sh              # Full deployment
#   ./scripts/deploy.sh --no-build   # Deploy without rebuilding images
#   ./scripts/deploy.sh --migrate    # Run database migrations only
#
# =============================================================================

set -e  # Exit on error
set -u  # Exit on undefined variable

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Change to project directory
cd "$PROJECT_DIR"

# =============================================================================
# Helper Functions
# =============================================================================

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_env_file() {
    if [ ! -f ".env" ]; then
        log_error "No .env file found!"
        log_error "Copy .env.example to .env and configure it."
        exit 1
    fi

    log_info "Using environment file: .env"

    # Export variables to suppress Docker Compose warnings
    # Filter out comments and empty lines, then export each variable
    # shellcheck disable=SC1090
    while IFS= read -r line || [[ -n "$line" ]]; do
        # Skip empty lines and comments
        [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
        # Export the variable
        export "$line"
    done < ".env"
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed!"
        exit 1
    fi

    if ! command -v docker compose &> /dev/null; then
        log_error "Docker Compose is not installed!"
        exit 1
    fi

    log_info "Docker and Docker Compose are available"
}

# =============================================================================
# Deployment Commands
# =============================================================================

pull_latest() {
    log_info "Pulling latest code from git..."
    git pull origin main
}

build_images() {
    log_info "Building Docker images..."
    docker compose build
}

start_services() {
    log_info "Starting services..."
    docker compose up -d
}

run_migrations() {
    log_info "Running database migrations..."
    docker compose exec -T api prisma migrate deploy --schema ./packages/midcurve-database/prisma/schema.prisma
}

health_check() {
    log_info "Waiting for services to become healthy..."
    sleep 10

    # Check API health
    API_URL="${API_URL:-https://api.midcurve.finance}"
    if curl -sf "$API_URL/api/health" > /dev/null 2>&1; then
        log_info "API is healthy!"
    else
        log_warn "API health check failed (may still be starting)"
    fi

    # Show running containers
    log_info "Running containers:"
    docker compose ps
}

show_logs() {
    log_info "Showing recent logs..."
    docker compose logs --tail=50
}

# =============================================================================
# Command Line Parsing
# =============================================================================

NO_BUILD=false
MIGRATE_ONLY=false
SKIP_PULL=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --no-build)
            NO_BUILD=true
            shift
            ;;
        --migrate)
            MIGRATE_ONLY=true
            shift
            ;;
        --skip-pull)
            SKIP_PULL=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --no-build    Deploy without rebuilding images"
            echo "  --migrate     Run database migrations only"
            echo "  --skip-pull   Skip git pull"
            echo "  -h, --help    Show this help message"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# =============================================================================
# Main Execution
# =============================================================================

echo ""
echo "=========================================="
echo "  Midcurve Finance Deployment"
echo "=========================================="
echo ""

# Check prerequisites
check_docker
check_env_file

# Migration only mode
if [ "$MIGRATE_ONLY" = true ]; then
    run_migrations
    log_info "Migrations complete!"
    exit 0
fi

# Pull latest code
if [ "$SKIP_PULL" = false ]; then
    pull_latest
fi

# Build images
if [ "$NO_BUILD" = false ]; then
    build_images
fi

# Start services
start_services

# Run migrations
run_migrations

# Health check
health_check

echo ""
echo "=========================================="
echo "  Deployment Complete!"
echo "=========================================="
echo ""
log_info "UI:  ${APP_URL:-https://app.midcurve.finance}"
log_info "API: ${API_URL:-https://api.midcurve.finance}"
echo ""
log_info "To view logs:  docker compose logs -f"
log_info "To stop:       docker compose down"
echo ""
