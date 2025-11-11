#!/bin/bash

# Fix all route files to use lazy service instantiation from @/lib/services

cd "$(dirname "$0")/.."

# Find all route files with service instantiation
FILES=$(find src/app/api -name "*.ts" -exec grep -l "new.*Service()" {} \;)

for file in $FILES; do
  echo "Processing $file..."

  # Skip if already using @/lib/services
  if grep -q "from '@/lib/services'" "$file"; then
    echo "  Already uses @/lib/services, skipping"
    continue
  fi

  # Remove service instantiation lines (const x = new XService())
  sed -i '' '/^const.*Service.*=.*new.*Service();$/d' "$file"

  # Replace service imports from @midcurve/services with @/lib/services getters
  # This requires manual review - just print what needs to be done
  echo "  Manual review needed: Replace service imports and add getters"
done

echo "Done! Review changes and update imports manually."
