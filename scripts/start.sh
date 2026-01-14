#!/bin/bash
# =============================================================================
# Midcurve Finance - Start Services
# =============================================================================
#
# Starts all Midcurve Finance services.
#
# Usage:
#   ./scripts/start.sh
#
# =============================================================================

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check for .env file
if [ ! -f ".env" ]; then
    log_error "No .env file found!"
    log_error "Copy .env.example to .env and configure it."
    exit 1
fi

# Export env vars
while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    export "$line"
done < ".env"

log_info "Starting Midcurve Finance services..."
docker compose up -d

log_info "Services started!"
docker compose ps
