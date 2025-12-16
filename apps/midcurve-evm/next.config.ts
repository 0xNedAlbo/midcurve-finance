import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable experimental features needed for API routes
  experimental: {
    // Allow importing from outside the app directory (for core/ modules)
    externalDir: true,
  },
  // Transpile local packages
  transpilePackages: ['@midcurve/database', '@midcurve/shared'],
};

export default nextConfig;
