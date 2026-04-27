# .claude/rules/wire-types.md

## Wire Types vs Domain Classes

Domain classes (with methods, bigints, Date objects) survive their JSON serialization
only as plain objects with strings. Type the receiving side accordingly with a
dedicated `*Wire` type, not the original class.

- If a domain class crosses a JSON boundary (HTTP response, MCP tool result,
  worker queue message, cache value), the receiver gets a `*Wire`-shaped object,
  not the class — methods are gone, bigints are strings, Dates are ISO strings.
- Define wire types in `@midcurve/api-shared` next to the domain type, suffixed
  `*Wire` (e.g. `UniswapV3PoolWire`, `Erc20TokenWire`).
- Compose wire types from existing typed JSON pieces where possible
  (`UniswapV3PoolConfigJSON`, `UniswapV3PoolStateJSON` etc. from `@midcurve/shared`).
- Source of truth for the wire shape: the serializer that produces it
  (e.g. `serializeUniswapV3Pool`), not guesswork.
- Trigger: if you reach for `as unknown as <ClassName>` to make a type fit
  what's actually on the wire, stop — that's the moment to introduce or use a
  wire type instead.
- Apply scoped, not prophylactically: only types that actually cross a boundary
  AND cause friction need a wire variant. Flat data (strings, numbers, ISO
  timestamps) without methods or bigints needs no special treatment.
- See also: `bigint-precision.md` for the matching serialization rule on the
  field level.
