# Midcurve Finance Monorepo

Turborepo monorepo for concentrated liquidity risk management.
pnpm workspaces, TypeScript strict mode, ESM modules.

## Quick Commands
```bash
pnpm install          # Install all deps
pnpm build            # Build all packages (Turborepo)
pnpm dev              # Dev servers (UI :3000, API :3001, all backend services)
pnpm typecheck        # Type check all packages
cd apps/midcurve-contracts && forge build  # Solidity contracts
```

## Package Map
- `packages/midcurve-shared/`      → `@midcurve/shared` (pure types, zero deps)
- `packages/midcurve-services/`    → `@midcurve/services` (business logic, Prisma)
- `packages/midcurve-api-shared/`  → `@midcurve/api-shared` (API types, Zod schemas)
- `packages/midcurve-database/`    → `@midcurve/database` (Prisma schema, single source of truth)
- `apps/midcurve-ui/`              → Vite SPA (React 19, TailwindCSS 4, RainbowKit)
- `apps/midcurve-api/`             → Next.js 15 REST API
- `apps/midcurve-automation/`      → Price monitor + order executor (RabbitMQ)
- `apps/midcurve-onchain-data/`    → Real-time blockchain event subscriptions (WebSocket, RabbitMQ publisher)
- `apps/midcurve-business-logic/`  → Event-driven rules + scheduled tasks (RabbitMQ consumer, node-cron)
- `apps/midcurve-signer/`          → Transaction signing service
- `apps/midcurve-contracts/`       → Solidity smart contracts (Foundry, Diamond proxy, MidcurveSwapRouter)

## Key Conventions
- Import types from `@midcurve/shared`, NEVER from `@prisma/client` directly
- Use `viem` for all EVM interactions, never ethers.js
- Frontend uses only `VITE_API_URL` (WalletConnect project ID comes from the setup wizard via API)
- Use `workspace:*` protocol for internal package references
- Prisma schema lives in `packages/midcurve-database/prisma/schema.prisma`
- English-only frontend (no i18n)

## Database Migrations
```bash
cd packages/midcurve-database
pnpm db:migrate:dev --name migration_name
pnpm db:migrate:verify  # Does the chain reproduce schema.prisma from empty?
pnpm db:studio          # Inspect database
```

`db:migrate:verify` runs on every PR; run it locally after writing a migration
to get the answer sooner. `prisma migrate status` does not report database-only
migration rows, so a clean status is not evidence of a clean history.

**Removals are not covered by either check.** `migrate diff` reads its scope
from `schemas = [...]` in `schema.prisma`, so anything the datamodel stops
declaring also stops being diffed — dropping a schema, and any `DELETE`/`UPDATE`,
must be hand-written and hand-checked. A migration that omits them still
verifies clean.

Both facts in [docs/architecture.md](docs/architecture.md), "Verifying the
migration chain".

## Tests in CI

CI runs `pnpm -r test:run` plus the Solidity suite — it does **not** name
packages. Membership follows the `test:run` script, so a package without one
is skipped silently.

[`test-manifest.json`](test-manifest.json) is what makes that silence loud:
every workspace package is recorded as `vitest`, `forge` or `none`, and a
`none` needs a stated reason. `pnpm check:test-manifest` fails the build when
the manifest and the workspace disagree.

**Adding a package, or adding or removing a test suite, means editing that
file** — CI will stop you if you forget. Two cases it catches that the
recursive run cannot see on its own: a package holding `*.test.ts` with no
script (they run nowhere), and a Next.js package whose vitest config does not
bound `include` — `.next/standalone/` contains copies of other packages'
sources and is *not* in vitest's default `exclude`.

Rationale and the failures behind each check: [#91](https://github.com/0xNedAlbo/midcurve-finance/issues/91).

## Lint in CI

CI runs `pnpm lint` (`turbo run lint`). Enrolment is self-serving: a package
with an ESLint config and a `lint` script is picked up automatically, one
without is skipped. **`@midcurve/ui` is the only enrolled package today.**

**Most packages have no ESLint config, and that is deliberate — not an
oversight.** They are covered by `turbo run typecheck`, which catches the
class of defect that actually matters here; adding configs is what generates
a large first-run backlog, and nobody has asked for lint on those packages.
Whoever wants it for a package adds a config and a script.

The exceptions, so the gap is on the record rather than implied away:
**`@midcurve/contracts` and `@midcurve/database` declare no `typecheck`
script either**, so their hand-written TypeScript — the deploy and ops
scripts under `apps/midcurve-contracts/scripts/` and the Prisma seed and
backfill scripts — is covered by neither lint nor typecheck.

There is no lint manifest, and one would add a mechanism without adding a
guarantee. `test-manifest.json` exists because `pnpm -r test:run` cannot see
a package that has tests and no script — absence is invisible there. Lint has
no equivalent blind spot, and the `Show which packages lint covers` step
prints the enrolled set on every run. That step is not decoration either:
turbo's own output reads `Running lint in 12 packages` while linting one,
because it counts packages in scope rather than packages with the task.

**The gate covers errors. Warnings are not a gate, they are a reading, and
they do not fail CI.** No `--max-warnings 0`: a warning ceiling over a backlog
nobody intends to clear, or a ratchet at today's count that drifts the moment
anyone edits the file, is decoration rather than enforcement.

### Rules demoted to `warn`, and the line that stops there

Recorded in one table so the total is visible in one place and falsifiable
later, rather than as four sentences nobody adds up. All in `@midcurve/ui`.

| rule | count | as of |
|---|---|---|
| `react-hooks/set-state-in-effect` | 48 | 2026-08-12 |
| `react-hooks/exhaustive-deps` | 36 | 2026-08-12 (plugin default, not demoted by us) |
| `@typescript-eslint/no-explicit-any` | 25 | 2026-08-12 |
| `react-hooks/purity` | 3 | 2026-08-12 |

Each was deferred because fixing it is design or UI-behaviour work that
deserves its own review, not because it is unimportant. The compound effect
is that **the gate fails on nothing currently in the tree**, which is worth
saying out loud. Two things stop that being decoration:

**It is not empty.** **78 rules stay at `error`** with zero current
violations, and gate from the first run — `no-dupe-else-if`,
`no-constant-binary-expression`, `no-async-promise-executor`,
`@typescript-eslint/no-unsafe-declaration-merging`,
`@typescript-eslint/no-misused-new`, and 73 others. "Catches nothing on
today's tree" is true; "catches nothing" is false, and the difference is the
whole value.

Note what is *not* in that 78: typescript-eslint's `eslint-recommended`
turns **off** the base rules tsc already enforces, so `no-dupe-keys`,
`no-const-assign` and their kin read as severity 0 in the resolved config.
That is deliberate deduplication, not a gap — those failures surface from
`pnpm typecheck` instead. Check with
`pnpm exec eslint --print-config <file>` before assuming a rule is live.

**No further demotions.** This is the line. If a rule fires in future, fix
the finding, or remove the rule with a stated reason. Do not lower its
severity. A config that reaches green by demoting rules until nothing errors
is the same artifact as a check that passes because it looked at three
files, and [#91](https://github.com/0xNedAlbo/midcurve-finance/issues/91)
and #92 were both spent removing those.

Two hazards worth knowing before enrolling a package. ESLint's flat config
does **not** read `.gitignore`, so build output must be listed in `ignores`
explicitly or lint findings get attributed to generated code — for
`@midcurve/ui` that was `dist/`, 162 of the 503 files it would otherwise
have walked. In a Next.js package the same trap is `.next/standalone/`,
which holds copies of *other* packages' sources; that is the lint-side twin
of check D in the test manifest.

Rationale and the state it was in beforehand: [#92](https://github.com/0xNedAlbo/midcurve-finance/issues/92).

## Architecture Docs
For detailed architecture, auth flows, and design decisions:
see [docs/architecture.md](docs/architecture.md) and package-level CLAUDE.md files.

Product philosophy and risk framework: [docs/philosophy.md](docs/philosophy.md)

## Common Gotchas
- "Multiple Prisma clients" → services uses peer dependency pattern
- Package changes not reflected → run `pnpm build` in the package

## Commit Format
Conventional commits: `feat|fix|refactor|docs|chore: short description`
