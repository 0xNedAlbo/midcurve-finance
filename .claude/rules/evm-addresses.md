# .claude/rules/evm-addresses.md

## EVM Address Handling

All EVM addresses must be EIP-55 checksummed. Use the utilities in
packages/midcurve-shared/src/utils/evm/address.ts for all address operations:

- Normalizing: normalizeAddress() — never call viem getAddress() directly
- Comparing: compareAddresses() — never use === or toLowerCase() on addresses
- Validating: isValidAddress()
- Sorting: compareAddresses() returns -1/0/1, use as comparator
