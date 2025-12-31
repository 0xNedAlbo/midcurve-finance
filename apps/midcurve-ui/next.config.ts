import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  /* Next.js Configuration */
  reactStrictMode: true,

  /* Output Configuration for AWS Amplify */
  output: 'standalone',

  /* Build Configuration */
  eslint: {
    // Disable ESLint during production builds (devDependencies not available)
    ignoreDuringBuilds: true,
  },
  typescript: {
    // TypeScript errors will still fail the build, but give more helpful error messages
    ignoreBuildErrors: false,
  },

  /* Output File Tracing */
  outputFileTracingRoot: path.join(__dirname, '../../'),
  outputFileTracingIncludes: {
    '/api/**/*': ['../../packages/midcurve-database/src/generated/prisma/**/*'],
  },

  /* Server External Packages - Exclude from webpack bundling on server side */
  /* These packages are pre-bundled with tsup and should not be re-processed */
  serverExternalPackages: [
    '@midcurve/database',
    '@midcurve/shared',
    '@midcurve/services',
    '@midcurve/api-shared',
  ],

  /* Image Configuration */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'assets.coingecko.com',
        pathname: '/coins/images/**',
      },
      {
        protocol: 'https',
        hostname: 'coin-images.coingecko.com',
        pathname: '/coins/images/**',
      },
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'tokens.1inch.io',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'ethereum-optimism.github.io',
        pathname: '/**',
      },
    ],
  },

  /* Webpack Configuration */
  webpack: (config, { isServer }) => {
    // Fix for RainbowKit and other ESM packages
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };

    // External packages that should not be bundled
    config.externals.push('pino-pretty', 'lokijs', 'encoding');

    // Ignore MetaMask SDK's React Native dependencies (web environment)
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
    };

    // Externalize Prisma client for server-side to avoid bundling issues
    if (isServer) {
      config.externals.push('_http_common');
    }

    return config;
  },

  /* Experimental Features */
  experimental: {
    // Enable server actions if needed
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },

  /* Environment Variables */
  env: {
    NEXT_PUBLIC_APP_NAME: 'Midcurve Finance',
    NEXT_PUBLIC_APP_VERSION: '0.1.0',
  },
};

export default nextConfig;
