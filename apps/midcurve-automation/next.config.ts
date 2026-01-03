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

  /* Webpack Configuration */
  webpack: (config) => {
    // Fix for ESM packages
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };

    // External packages that should not be bundled
    config.externals.push('pino-pretty', 'lokijs', 'encoding');

    return config;
  },

  /* Environment Variables */
  env: {
    NEXT_PUBLIC_APP_NAME: 'Midcurve Automation',
    NEXT_PUBLIC_APP_VERSION: '0.1.0',
  },
};

export default nextConfig;
