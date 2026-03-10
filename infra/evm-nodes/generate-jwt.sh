#!/usr/bin/env bash
# Generates a 32-byte hex JWT secret for Engine API authentication
# between Reth (execution) and Lighthouse (consensus).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JWT_FILE="${SCRIPT_DIR}/jwt.hex"

if [ -f "$JWT_FILE" ]; then
  echo "JWT secret already exists at $JWT_FILE — skipping."
  echo "Delete the file and re-run to regenerate."
  exit 0
fi

openssl rand -hex 32 > "$JWT_FILE"
chmod 600 "$JWT_FILE"
echo "JWT secret generated at $JWT_FILE"
