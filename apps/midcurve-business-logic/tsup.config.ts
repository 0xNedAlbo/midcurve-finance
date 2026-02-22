import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [
    '@midcurve/shared',
    '@midcurve/services',
    '@midcurve/database',
    '@midcurve/api-shared',
  ],
  // Prisma's generated client uses CJS globals (require, __dirname, __filename) — shim them for ESM
  banner: {
    js: [
      "import { createRequire as __bundled_createRequire__ } from 'module';",
      "import { fileURLToPath as __bundled_fileURLToPath__ } from 'url';",
      "import { dirname as __bundled_dirname__ } from 'path';",
      "const require = __bundled_createRequire__(import.meta.url);",
      "const __filename = __bundled_fileURLToPath__(import.meta.url);",
      "const __dirname = __bundled_dirname__(__filename);",
    ].join(' '),
  },
});
