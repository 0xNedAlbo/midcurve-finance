#!/usr/bin/env python3
"""
Automatically fix all route files to use lazy service initialization.

This script:
1. Finds all route files with service instantiation
2. Removes service instantiation lines (const x = new XService())
3. Replaces service calls (serviceVar.method()) with getter calls (getServiceName().method())
4. Adds import for getters from @/lib/services
5. Removes old service imports from @midcurve/services
"""

import re
import os
from pathlib import Path

# Mapping from service class names to getter function names
SERVICE_GETTERS = {
    'AuthUserService': 'getAuthUserService',
    'AuthNonceService': 'getAuthNonceService',
    'AuthApiKeyService': 'getAuthApiKeyService',
    'Erc20TokenService': 'getErc20TokenService',
    'UserTokenBalanceService': 'getUserTokenBalanceService',
    'UniswapV3PoolService': 'getUniswapV3PoolService',
    'UniswapV3PoolDiscoveryService': 'getUniswapV3PoolDiscoveryService',
    'UniswapV3PositionService': 'getUniswapV3PositionService',
    'UniswapV3PositionLedgerService': 'getUniswapV3PositionLedgerService',
    'PositionListService': 'getPositionListService',
    'PositionAprService': 'getPositionAprService',
}

def find_route_files():
    """Find all route files with service instantiation."""
    api_dir = Path('src/app/api')
    files = []
    for ts_file in api_dir.rglob('*.ts'):
        content = ts_file.read_text()
        if 'new' in content and 'Service()' in content:
            files.append(ts_file)
    return files

def fix_file(filepath):
    """Fix a single route file."""
    content = filepath.read_text()
    original = content

    # Skip if already using @/lib/services
    if "from '@/lib/services'" in content:
        print(f"  Skipping {filepath.name} (already uses @/lib/services)")
        return False

    # Track which services are used in this file
    used_getters = set()
    var_to_service = {}  # Maps variable name to service class name

    # Step 1: Find service instantiations and extract variable names
    inst_pattern = r'const\s+(\w+)\s*=\s*new\s+(\w+Service)\(\);?'
    for match in re.finditer(inst_pattern, content):
        var_name = match.group(1)
        service_class = match.group(2)
        if service_class in SERVICE_GETTERS:
            var_to_service[var_name] = service_class
            used_getters.add(SERVICE_GETTERS[service_class])

    if not var_to_service:
        print(f"  Skipping {filepath.name} (no service instantiation found)")
        return False

    print(f"  Processing {filepath.name}...")
    print(f"    Services: {list(var_to_service.keys())}")

    # Step 2: Replace service calls (varName.method() -> getServiceName().method())
    for var_name, service_class in var_to_service.items():
        getter = SERVICE_GETTERS[service_class]
        # Match service.method() calls
        pattern = rf'\b{re.escape(var_name)}\.(\w+)'
        replacement = rf'{getter}().\1'
        content = re.sub(pattern, replacement, content)

    # Step 3: Remove service instantiation lines
    content = re.sub(inst_pattern, '', content)

    # Step 4: Remove service imports from @midcurve/services
    # Find the services that were imported
    services_to_remove = set(var_to_service.values())

    # Handle multi-line imports
    import_pattern = r"import\s*\{([^}]+)\}\s*from\s*'@midcurve/services';"
    def remove_services(match):
        imports = match.group(1)
        import_list = [imp.strip() for imp in imports.split(',')]
        # Remove service imports
        remaining = [imp for imp in import_list if imp not in services_to_remove]
        if not remaining:
            return ''  # Remove entire import line
        return f"import {{ {', '.join(remaining)} }} from '@midcurve/services';"

    content = re.sub(import_pattern, remove_services, content)

    # Step 5: Add getter imports from @/lib/services
    if used_getters:
        getter_import = f"import {{ {', '.join(sorted(used_getters))} }} from '@/lib/services';\n"

        # Find where to insert (after other imports)
        lines = content.split('\n')
        insert_idx = 0
        for i, line in enumerate(lines):
            if line.startswith('import '):
                insert_idx = i + 1

        lines.insert(insert_idx, getter_import.rstrip())
        content = '\n'.join(lines)

    # Step 6: Clean up extra blank lines
    content = re.sub(r'\n\n\n+', '\n\n', content)

    if content != original:
        filepath.write_text(content)
        print(f"    ✓ Fixed")
        return True
    else:
        print(f"    No changes made")
        return False

def main():
    os.chdir(Path(__file__).parent.parent)

    files = find_route_files()
    print(f"Found {len(files)} route files to check\n")

    fixed_count = 0
    for filepath in files:
        if fix_file(filepath):
            fixed_count += 1

    print(f"\nFixed {fixed_count}/{len(files)} files")

if __name__ == '__main__':
    main()
