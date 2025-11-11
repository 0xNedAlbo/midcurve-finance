#!/usr/bin/env python3
"""
Update all Prisma imports from @prisma/client to @midcurve/database.

This script:
1. Finds all files importing from '@prisma/client'
2. Replaces imports with @midcurve/database imports
3. Removes require('@prisma/client').PrismaClient patterns
4. Adds prisma import from @midcurve/database where needed
"""

import re
import os
from pathlib import Path

def fix_file(filepath):
    """Fix a single file."""
    content = filepath.read_text()
    original = content

    # Skip if already using @midcurve/database
    if "from '@midcurve/database'" in content or 'from "@midcurve/database"' in content:
        print(f"  Skipping {filepath.name} (already uses @midcurve/database)")
        return False

    print(f"  Processing {filepath}...")

    # Pattern 1: Type-only imports
    # from '@prisma/client' -> from '@midcurve/database'
    content = re.sub(
        r"from ['\"]@prisma/client['\"]",
        "from '@midcurve/database'",
        content
    )

    # Pattern 2: require('@prisma/client').PrismaClient
    # Replace with prisma singleton from @midcurve/database
    if "require('@prisma/client').PrismaClient" in content or 'require("@prisma/client").PrismaClient' in content:
        # Add import if not present
        if "import { prisma" not in content:
            # Find where to insert (after other imports)
            lines = content.split('\n')
            insert_idx = 0
            for i, line in enumerate(lines):
                if line.startswith('import '):
                    insert_idx = i + 1

            lines.insert(insert_idx, "import { prisma } from '@midcurve/database';")
            content = '\n'.join(lines)

        # Replace the require pattern
        content = re.sub(
            r"new \(require\(['\"]@prisma/client['\"]\)\.PrismaClient\)\(\) as PrismaClient",
            "prisma",
            content
        )

    # Clean up extra blank lines
    content = re.sub(r'\n\n\n+', '\n\n', content)

    if content != original:
        filepath.write_text(content)
        print(f"    ✓ Fixed")
        return True
    else:
        print(f"    No changes made")
        return False

def main():
    # Change to services directory
    script_dir = Path(__file__).parent
    services_dir = script_dir.parent
    os.chdir(services_dir)

    # Find all files with @prisma/client imports
    src_dir = Path('src')
    files = []
    for ts_file in src_dir.rglob('*.ts'):
        content = ts_file.read_text()
        if '@prisma/client' in content:
            files.append(ts_file)

    print(f"Found {len(files)} files to update\n")

    fixed_count = 0
    for filepath in files:
        if fix_file(filepath):
            fixed_count += 1

    print(f"\nFixed {fixed_count}/{len(files)} files")

if __name__ == '__main__':
    main()
