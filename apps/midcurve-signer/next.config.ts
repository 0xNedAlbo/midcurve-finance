import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  /* Next.js Configuration */
  reactStrictMode: true,

  /* Output Configuration for deployment */
  output: 'standalone',

  /* Build Configuration */
  eslint: {
    // Disable ESLint during production builds (devDependencies not available)
    ignoreDuringBuilds: true,
  },
  typescript: {
    // TypeScript errors will still fail the build
    ignoreBuildErrors: false,
  },

  /* Output File Tracing */
  outputFileTracingRoot: path.join(__dirname, '../../'),
  outputFileTracingIncludes: {
    '/api/**/*': ['../../packages/midcurve-database/src/generated/prisma/**/*'],
  },

  /* Transpile Packages */
  transpilePackages: ['@midcurve/shared', '@midcurve/services', '@midcurve/api-shared', '@midcurve/database'],

  /* Webpack Configuration */
  webpack: (config, { isServer }) => {
    // Fix for ESM packages
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };

    // External packages that should not be bundled
    config.externals.push('pino-pretty', 'lokijs', 'encoding');

    // Include Prisma query engine binaries in the build
    if (isServer) {
      config.externals.push('_http_common');

      // Use Prisma monorepo workaround plugin
      const { PrismaPlugin } = require('@prisma/nextjs-monorepo-workaround-plugin');
      config.plugins = [...config.plugins, new PrismaPlugin()];
    }

    return config;
  },

  /* Experimental Features */
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },

  /* Environment Variables */
  env: {
    NEXT_PUBLIC_APP_NAME: 'Midcurve Signer',
    NEXT_PUBLIC_APP_VERSION: '0.1.0',
  },
};

export default nextConfig;
