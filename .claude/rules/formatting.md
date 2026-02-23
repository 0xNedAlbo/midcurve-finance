# .claude/rules/formatting.md

## Display Formatting

Formatting utilities live in packages/midcurve-shared/src/utils/format/ — use them,
don't write custom formatters.

- Token amounts: use formatCompactValue() from fraction-format.ts
  Never use toLocaleString(), Intl.NumberFormat, or viem formatUnits()
- Prices and date/time formatting utils are also in that directory
- Formatting is the very last step — keep values as bigint/raw until display
