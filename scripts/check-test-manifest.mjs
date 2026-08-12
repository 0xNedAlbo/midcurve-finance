#!/usr/bin/env node
/**
 * Fail the build when the workspace and test-manifest.json disagree.
 *
 * Why this exists (#91): `pnpm -r test:run` makes CI membership follow the
 * code, which is an improvement on naming six packages by hand in the
 * workflow — but it replaces a silently drifting enumeration with a silently
 * drifting absence. A package with no `test:run` is skipped exactly as
 * quietly as an unlisted one was. This does not remove the human judgement
 * about whether a package needs tests; it removes the silence, by turning
 * drift into a red build.
 *
 * Four independent checks:
 *
 *   A  package set     workspace packages must match the manifest exactly
 *   B  runner          the declared runner must match the package's scripts
 *   C  orphan tests    a "none" package must not contain test files
 *   D  .next guard     a vitest package that emits .next must declare an
 *                      explicit `include` that does not start at `**`
 *
 * C is the one that catches a package with tests and no script — the case
 * `pnpm -r test:run` can never see, because it keys on scripts and C keys on
 * files. D is the one that catches a suite in a Next.js app collecting out of
 * .next/standalone. Both are drawn from real instances; see the issue.
 *
 * What these checks do NOT cover, so the guarantee is not read as wider than
 * it is:
 *
 *   - C only inspects packages declared "none". Test files inside a *vitest*
 *     package that its own `include` happens to exclude are invisible here —
 *     the same failure one step over. No package declares an `include` today,
 *     so that gap is latent rather than live.
 *   - D checks that an `include` is declared and does not begin at `**`. It
 *     does not evaluate the globs, so a sufficiently creative pattern can
 *     still reach .next/. Presence and shape are checked; genuine
 *     boundedness is not. Deliberate — evaluating a vitest config here would
 *     cost more than the failure it prevents.
 *
 * Zero dependencies on purpose: a checker that needs the toolchain in order
 * to tell you the toolchain is misconfigured is not much use. It runs
 * directly after `pnpm install` and before the build, so it reports early and
 * needs nothing built.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST_PATH = join(ROOT, 'test-manifest.json');

/**
 * Directories never descended into when looking for test files.
 *
 * `.next` is load-bearing, not tidiness. Next.js apps here build with
 * `output: 'standalone'` and `outputFileTracingRoot` at the monorepo root, so
 * `.next/standalone/` contains copies of *other* packages' source trees,
 * test files included. Without this prune, check C reports phantom orphan
 * tests in every Next.js app as soon as a build has run. (The same gap in
 * vitest's own default `exclude` — which covers `dist` but not `.next` — is
 * what check D exists to guard.)
 */
const PRUNED_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'out',
  'build',
  'coverage',
  '.git',
  'lib', // Foundry vendored dependencies (forge-std, openzeppelin)
]);

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|mts|cts|js|jsx)$/;
const SOL_TEST_RE = /\.t\.sol$/;

/**
 * Where a package's Playwright specs live, from its own playwright.config.*.
 *
 * Returns { hasConfig, testDir }. `testDir` is null when there is no config,
 * or when a config exists but declares no testDir — in which case `problem`
 * is called and the caller skips the orphan scan, since files it cannot
 * classify would otherwise be reported twice for one cause.
 *
 * Check C asks "are there test files here that run nowhere?". Playwright
 * specs are not nowhere — they run under `test:e2e`, which this job
 * deliberately does not run (they need a live stack). Reading `testDir` keeps
 * that exemption tied to the package's own configuration rather than to a
 * path hardcoded here; move the specs and the exemption moves with them.
 */
function playwrightTestDir(dir, problem) {
  const config = ['ts', 'mts', 'js', 'mjs']
    .map((ext) => join(dir, `playwright.config.${ext}`))
    .find((p) => existsSync(p));
  if (!config) return { hasConfig: false, testDir: null };

  const match = readFileSync(config, 'utf8').match(/testDir\s*:\s*['"`]([^'"`]+)['"`]/);
  if (!match) {
    problem(
      `has ${posix(relative(ROOT, config))} but it declares no testDir, so this check ` +
        'cannot tell which test files Playwright owns. Set testDir explicitly.'
    );
    return { hasConfig: true, testDir: null };
  }
  return { hasConfig: true, testDir: join(dir, match[1]) };
}

const errors = [];
const fail = (check, pkg, message) =>
  errors.push({ check, pkg, message });

// ---------------------------------------------------------------------------
// Workspace discovery
// ---------------------------------------------------------------------------

/**
 * Read the workspace globs from pnpm-workspace.yaml without a YAML parser.
 * Only the shapes this repo actually uses are supported (`- "apps/*"`); a
 * glob we cannot understand is an error rather than a silent skip.
 */
function readWorkspaceGlobs() {
  const raw = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
  const globs = [];
  let inPackages = false;

  for (const line of raw.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const item = line.match(/^\s*-\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/);
      if (item) {
        globs.push(item[1]);
        continue;
      }
      if (line.trim() !== '' && !line.startsWith(' ')) break;
    }
  }

  if (globs.length === 0) {
    throw new Error(
      'Could not read any package globs from pnpm-workspace.yaml. ' +
        'If its format changed, update readWorkspaceGlobs() — do not let ' +
        'this check pass by finding nothing.'
    );
  }
  return globs;
}

function discoverPackages() {
  const found = new Map(); // name -> { dir, pkgJson }

  for (const glob of readWorkspaceGlobs()) {
    const [prefix, star] = glob.split('/');
    if (star !== '*') {
      throw new Error(
        `Unsupported workspace glob "${glob}" — only "<dir>/*" is handled. ` +
          'Teach discoverPackages() the new shape rather than ignoring it.'
      );
    }
    const parent = join(ROOT, prefix);
    if (!existsSync(parent)) continue;

    for (const entry of readdirSync(parent)) {
      const dir = join(parent, entry);
      const manifest = join(dir, 'package.json');
      if (!statSync(dir).isDirectory() || !existsSync(manifest)) continue;

      const pkgJson = JSON.parse(readFileSync(manifest, 'utf8'));
      if (!pkgJson.name) continue;
      found.set(pkgJson.name, { dir, pkgJson });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function findFiles(dir, matches, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (PRUNED_DIRS.has(entry.name)) continue;
      findFiles(join(dir, entry.name), matches, acc);
    } else if (matches(entry.name)) {
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

const posix = (p) => p.split(sep).join('/');

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const declared = manifest.packages ?? {};
const packages = discoverPackages();

// --- A: package set ---------------------------------------------------------

for (const name of packages.keys()) {
  if (!(name in declared)) {
    fail(
      'A',
      name,
      `is a workspace package but has no entry in test-manifest.json.\n` +
        `      Add one: {"runner": "vitest" | "forge" | "none", "reason": "..."}.\n` +
        `      "reason" is required for "none" — say why it has no tests.`
    );
  }
}
for (const name of Object.keys(declared)) {
  if (!packages.has(name)) {
    fail(
      'A',
      name,
      'is listed in test-manifest.json but is not a workspace package. ' +
        'Remove the entry, or fix the name.'
    );
  }
}

// --- B, C, D: per package ---------------------------------------------------

for (const [name, entry] of Object.entries(declared)) {
  const pkg = packages.get(name);
  if (!pkg) continue; // already reported by A

  const { dir, pkgJson } = pkg;
  const scripts = pkgJson.scripts ?? {};
  const runner = entry.runner;
  const where = posix(relative(ROOT, dir));

  if (!['vitest', 'forge', 'none'].includes(runner)) {
    fail('B', name, `has an unknown runner ${JSON.stringify(runner)}. Use "vitest", "forge" or "none".`);
    continue;
  }

  if (runner === 'none' && !entry.reason) {
    fail(
      'A',
      name,
      'is recorded as having no tests but gives no reason. ' +
        'An absence has to be a decision someone wrote down, not a blank.'
    );
  }

  // --- B: the declared runner must match the scripts -----------------------

  if (runner === 'vitest' && !scripts['test:run']) {
    fail(
      'B',
      name,
      `is declared runner "vitest" but ${where}/package.json has no "test:run" script, ` +
        'so `pnpm -r test:run` will skip it silently.'
    );
  }
  if (runner === 'none' && scripts['test:run']) {
    fail(
      'B',
      name,
      `is declared as having no tests but declares a "test:run" script. ` +
        'Either record it as "vitest", or delete the script.'
    );
  }
  if (runner === 'forge') {
    if (!scripts['forge:test']) {
      fail('B', name, `is declared runner "forge" but has no "forge:test" script.`);
    }
    const testDir = join(dir, 'test');
    const solTests = existsSync(testDir) ? findFiles(testDir, (f) => SOL_TEST_RE.test(f)) : [];
    if (solTests.length === 0) {
      fail('B', name, `is declared runner "forge" but has no *.t.sol files under ${where}/test/.`);
    }
  }

  // --- C: a "none" package must not contain test files ---------------------

  if (runner === 'none') {
    const { hasConfig, testDir: e2eDir } = playwrightTestDir(dir, (message) =>
      fail('C', name, message)
    );
    if (hasConfig && !scripts['test:e2e']) {
      fail(
        'C',
        name,
        'has a playwright.config but no "test:e2e" script, so its specs run nowhere at all.'
      );
    }
    // A config we could not read testDir out of has already been reported;
    // scanning for orphans now would report the same files a second time.
    const scannable = !hasConfig || e2eDir !== null;
    const orphans = scannable
      ? findFiles(dir, (f) => TEST_FILE_RE.test(f)).filter(
          (f) => !e2eDir || !f.startsWith(e2eDir + sep)
        )
      : [];
    if (orphans.length > 0) {
      const list = orphans.map((f) => `        ${posix(relative(ROOT, f))}`).join('\n');
      fail(
        'C',
        name,
        `is recorded as having no tests, but contains ${orphans.length} test file(s):\n` +
          `${list}\n` +
          `      These run nowhere. Either give the package a "test:run" script and\n` +
          `      record it as "vitest", or delete the files.`
      );
    }
  }

  // --- D: a vitest package that emits .next must bound `include` -----------

  const deps = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };
  if (runner === 'vitest' && 'next' in deps) {
    const config = ['ts', 'mts', 'js', 'mjs']
      .map((ext) => join(dir, `vitest.config.${ext}`))
      .find((p) => existsSync(p));

    if (!config) {
      fail(
        'D',
        name,
        'runs vitest and builds with Next.js, but has no vitest.config.*.\n' +
          "      vitest's default `exclude` covers dist/ but NOT .next/, and this app's\n" +
          '      standalone output contains copies of other packages\' sources. Without an\n' +
          '      explicit `include` the suite will collect them. See #91.'
      );
    } else {
      const source = readFileSync(config, 'utf8');
      const where = posix(relative(ROOT, config));
      const declaration = source.match(/\binclude\s*:\s*\[([^\]]*)\]/);

      if (!/\binclude\s*:/.test(source)) {
        fail(
          'D',
          name,
          `has ${where} but it does not set \`include\`.\n` +
            '      A Next.js package must declare collection explicitly — .next/standalone/\n' +
            "      is not in vitest's default `exclude`. See #91."
        );
      } else if (declaration) {
        // Not a glob evaluator, and deliberately not: a pattern that starts at
        // `**` walks the whole package, which is the realistic way this goes
        // wrong. Anything subtler than that is out of scope — see the header.
        const unrooted = [...declaration[1].matchAll(/['"`]([^'"`]+)['"`]/g)]
          .map((m) => m[1])
          .filter((pattern) => pattern.startsWith('**'));

        if (unrooted.length > 0) {
          fail(
            'D',
            name,
            `has ${where}, but its \`include\` starts at the package root: ` +
              `${unrooted.map((p) => JSON.stringify(p)).join(', ')}.\n` +
              '      That walks .next/standalone/ too, which holds copies of other\n' +
              "      packages' sources. Root the pattern at the source directory\n" +
              '      instead, e.g. "src/**/*.test.ts". See #91.'
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const CHECK_NAMES = {
  A: 'package set',
  B: 'runner vs scripts',
  C: 'orphan test files',
  D: 'include guard',
};

if (errors.length > 0) {
  console.error('\ntest-manifest.json disagrees with the workspace:\n');
  for (const { check, pkg, message } of errors) {
    console.error(`  [${check}: ${CHECK_NAMES[check]}] ${pkg} ${message}`);
    console.error('');
  }
  console.error(
    `${errors.length} problem(s). Update test-manifest.json, or the packages, so they agree.\n`
  );
  process.exit(1);
}

const counts = Object.values(declared).reduce((acc, e) => {
  acc[e.runner] = (acc[e.runner] ?? 0) + 1;
  return acc;
}, {});

console.log(
  `test-manifest.json agrees with the workspace: ${packages.size} packages ` +
    `(${counts.vitest ?? 0} vitest, ${counts.forge ?? 0} forge, ${counts.none ?? 0} without tests).`
);
