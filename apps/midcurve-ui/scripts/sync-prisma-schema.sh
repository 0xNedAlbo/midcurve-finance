#!/bin/bash
# Sync Prisma schema and migrations from @midcurve/services package

SERVICES_SCHEMA="node_modules/@midcurve/services/prisma/schema.prisma"
SERVICES_MIGRATIONS="node_modules/@midcurve/services/prisma/migrations"
LOCAL_SCHEMA="prisma/schema.prisma"
LOCAL_MIGRATIONS="prisma/migrations"

# Create prisma directory if it doesn't exist
mkdir -p prisma

# Check if schema exists in node_modules
if [ ! -f "$SERVICES_SCHEMA" ]; then
  echo "❌ ERROR: Schema not found at $SERVICES_SCHEMA"
  echo "Run 'npm install' first to install @midcurve/services"
  exit 1
fi

# Copy schema from installed package
cp "$SERVICES_SCHEMA" "$LOCAL_SCHEMA"

# Copy migrations if they exist in the installed package
if [ -d "$SERVICES_MIGRATIONS" ]; then
  rm -rf "$LOCAL_MIGRATIONS"
  cp -r "$SERVICES_MIGRATIONS" "$LOCAL_MIGRATIONS"
  echo "✓ Synced Prisma schema and migrations from @midcurve/services package"
else
  echo "✓ Synced Prisma schema from @midcurve/services package (no migrations found)"
fi

# Modify generator output to use local node_modules
# This works on both macOS (BSD sed) and Linux (GNU sed)
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS
  sed -i '' 's/generator client {/generator client {\n  output = "..\/node_modules\/.prisma\/client"/' "$LOCAL_SCHEMA"
else
  # Linux
  sed -i 's/generator client {/generator client {\n  output = "..\/node_modules\/.prisma\/client"/' "$LOCAL_SCHEMA"
fi
