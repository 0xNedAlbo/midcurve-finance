# Testing Guide

How the tests in `@midcurve/services` actually run.

This document was rewritten in #91. The version it replaces described a
unit/integration split built on Vitest workspaces, `*.integration.test.ts`
files, a `src/test/setup-integration.ts` harness and five `--project`
scripts. **None of that existed.** There is no vitest config in this
package, no test file matching `*.integration.test.ts`, no `src/test/`
directory, and the scripts errored with `No projects matched the filter
"unit"`. It also carried worked GitHub Actions and GitLab CI examples for
that split, which is how a document describing nothing in particular
survives review. What follows describes only what is in the repository.

## What exists

One flat suite of unit tests, `src/**/*.test.ts`, 14 files and 239 tests at
the time of writing. Every external dependency is mocked — Prisma via
`vitest-mock-extended`, RPC and HTTP clients by hand. No test needs a
database, a network, or an environment variable.

There is **no `vitest.config.ts`**. `vitest run` collects via its own
default `include`, and its default `exclude` covers `node_modules` and
`dist`, which is sufficient here because this package emits neither `.next`
nor any other tree containing foreign sources. That is a real constraint,
not an accident: see check D in [`scripts/check-test-manifest.mjs`](../../scripts/check-test-manifest.mjs)
for what has to stay true, and #91 for the failure it prevents.

## Running them

```bash
pnpm test         # watch mode
pnpm test:run     # single run — this is what CI runs
```

CI runs them through `pnpm -r test:run` from the repository root, together
with every other workspace suite. This package is not named in
`.github/workflows/pr-tests.yml`; membership follows the `test:run` script,
and [`test-manifest.json`](../../test-manifest.json) fails the build if a
package gains or loses a suite without being recorded.

`pnpm test:coverage` produces a coverage report. It is not run in CI.

It used to pass `--env-file=.env.test` against a git-ignored file, so it
failed on any clone but its author's. #91 removed that: no test in this
package reads an environment variable, so the flag was a leftover of the
integration split described below rather than something the script needed.
The same change added `@vitest/coverage-v8`, which nothing in the workspace
had ever declared — the script had two independent reasons not to run.

## Writing one

Arrange–act–assert, with dependencies injected rather than imported:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

describe('TokenService', () => {
  let prismaMock: DeepMockProxy<PrismaClient>;
  let service: TokenService;

  beforeEach(() => {
    prismaMock = mockDeep<PrismaClient>();
    service = new TokenService({ prisma: prismaMock });
  });

  it('creates a token', async () => {
    prismaMock.token.create.mockResolvedValue(dbResult);

    const result = await service.create(input);

    expect(result.symbol).toBe('USDC');
  });
});
```

Every service in this package takes its dependencies through the
constructor for exactly this reason.

## The test database

`docker-compose.test.yml` and the `db:test:up` / `db:test:down` /
`db:test:reset` scripts are still here and still work. Nothing currently
uses them — they were the substrate for the integration split that never
existed. They are left in place deliberately; compose-file ownership is
#118's subject.

If you want integration tests against a real database, that is a design
decision to take deliberately — configure vitest projects, decide how
`.env.test` reaches CI, and record the package's new shape in
`test-manifest.json`. Do not assume the removed scripts were a working
setup that merely rotted; they never ran.
