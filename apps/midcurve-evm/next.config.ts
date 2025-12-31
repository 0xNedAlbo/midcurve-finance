import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Output standalone build for Docker deployment
  output: 'standalone',

  // Enable experimental features needed for API routes
  experimental: {
    // Allow importing from outside the app directory (for core/ modules)
    externalDir: true,
  },

  // Transpile local packages
  transpilePackages: ['@midcurve/database', '@midcurve/shared'],

  // Output file tracing for monorepo
  outputFileTracingRoot: path.join(__dirname, '../../'),
  outputFileTracingIncludes: {
    '/api/**/*': ['../../packages/midcurve-database/src/generated/prisma/**/*'],
  },

  // Disable ESLint during production builds
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
