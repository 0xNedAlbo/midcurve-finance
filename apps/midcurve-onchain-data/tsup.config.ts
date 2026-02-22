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
  // Prisma's generated client uses CJS require("fs") — create a require shim for ESM
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});
