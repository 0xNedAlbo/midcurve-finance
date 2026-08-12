import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * ESLint for a Vite + React 19 + TypeScript SPA.
 *
 * This replaces a config that extended `next/core-web-vitals` through the
 * `@eslint/eslintrc` compat layer. It had not loaded since at least ESLint 9:
 * `eslint-config-next@16` ships *flat* configs, so routing one through the
 * eslintrc validator made it throw inside its own error formatter on a
 * circular `plugins.react` reference. The crash printed a stack trace rather
 * than a lint result, which is why it read as a broken toolchain and went
 * unnoticed — nothing in CI ran it either. See #92.
 *
 * It is rewritten rather than repaired because the app has not been Next.js
 * for some time. Under the old ruleset the single largest output was 35 hits
 * of `@next/next/no-img-element`, advising a `next/image` component that does
 * not exist here.
 *
 * Deliberately minimal: three recommended presets and one severity override.
 * A rule that needs an argument to justify it does not belong in the config
 * that turns linting on.
 */
export default [
  {
    ignores: [
      // Build output. ESLint's flat config does NOT read .gitignore, so
      // without this the run covers dist/ — 162 files of the 503 it would
      // otherwise enumerate, a third of the surface, all generated. This is
      // the `.next/standalone` hazard from #91 one package over: same cause,
      // different directory.
      'dist/**',
      // Playwright specs. They run under `test:e2e` against a live stack, not
      // in the PR job, and linting them would mean wiring up
      // @playwright/test globals for no benefit anyone has asked for.
      'tests/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat['recommended-latest'],

  {
    rules: {
      /*
       * Honour the `_` prefix, because the typechecker already does.
       *
       * tsconfig.json sets `noUnusedLocals` and `noUnusedParameters`, and tsc
       * exempts identifiers starting with `_`. The codebase has been written
       * against that convention throughout — all 16 findings this rule
       * produced at its default setting were already `_`-prefixed, every one.
       * Left as-is the rule would contradict the typechecker and the fix
       * would be to un-mark deliberately unused bindings, which is backwards.
       */
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],

      /*
       * 48 hits when this gate was introduced (2026-08-12), across 318 source
       * files. Left unfixed on purpose: 48 findings over one codebase is far
       * more likely to be one repeated pattern than 48 distinct defects, no
       * symptom has been reported, and deciding whether they are real is UI
       * behaviour work that would have dominated review of the change that
       * merely turned linting on.
       *
       * `warn` rather than `off` because switching it off would hide the
       * finding in order to keep a number green. Warnings do not fail CI —
       * they are a reading, not a gate. See CLAUDE.md, "Lint".
       */
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
];
