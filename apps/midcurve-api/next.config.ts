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

  /* Server External Packages - Exclude from webpack bundling on server side */
  serverExternalPackages: [
    '@midcurve/database',
    '@midcurve/shared',
    '@midcurve/services',
    '@midcurve/api-shared',
  ],

  /* Webpack Configuration */
  webpack: (config, { isServer }) => {
    // External packages that should not be bundled
    config.externals.push('pino-pretty', 'lokijs', 'encoding');

    // Externalize Prisma client for server-side to avoid bundling issues
    if (isServer) {
      config.externals.push('_http_common');
    }

    return config;
  },

  /* Environment Variables */
  env: {
    NEXT_PUBLIC_APP_NAME: 'Midcurve API',
    NEXT_PUBLIC_APP_VERSION: '0.1.0',
  },
};

export default nextConfig;
