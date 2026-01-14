#!/bin/bash
# =============================================================================
# Midcurve Finance - Stop Services
# =============================================================================
#
# Stops all Midcurve Finance services.
#
# Usage:
#   ./scripts/stop.sh
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

# Export env vars if .env exists (needed for docker compose to parse compose file)
if [ -f ".env" ]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
        export "$line"
    done < ".env"
fi

log_info "Stopping Midcurve Finance services..."
docker compose down

log_info "Services stopped!"
