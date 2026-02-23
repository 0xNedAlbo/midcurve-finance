# .claude/rules/bigint-precision.md

## On-Chain Number Precision

All on-chain values (token amounts, liquidity, sqrtPriceX96, tick values) must remain
as bigint throughout the entire pipeline. Never convert to number or float.

- Arithmetic on token amounts: use bigint operators only (\*, /, +, -, \*\*)
- Division that needs decimals: scale up first (e.g. multiply by 10n\*\*18n), divide, keep as bigint
- Database storage: Prisma String/Decimal columns, never Int or Float
- API serialization: string representation in JSON ("amount": "1000000000000000000")
- Frontend display: format to human-readable string at the very last step only
- Never use Number(), parseFloat(), or .toString() → parseFloat() on token amounts
- Never use Math.\* functions on token amounts
- Price calculations: use the sqrtPriceX96 math from @midcurve/shared, which operates in bigint
