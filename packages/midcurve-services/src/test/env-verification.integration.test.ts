/**
 * Environment variable verification tests
 * Ensures .env.test is properly loaded via --env-file flag
 */

import { describe, expect, it } from 'vitest';

describe('Environment Variables - Integration Tests', () => {
  describe('Database Configuration', () => {
    it('should load DATABASE_URL from .env.test', () => {
      expect(process.env.DATABASE_URL).toBeDefined();
      expect(process.env.DATABASE_URL).toContain('midcurve_test');
      expect(process.env.DATABASE_URL).toContain('localhost:5433');
    });
  });

  describe('RPC URL Configuration', () => {
    it('should load RPC_URL_ETHEREUM from .env.test', () => {
      expect(process.env.RPC_URL_ETHEREUM).toBeDefined();
      expect(process.env.RPC_URL_ETHEREUM).toMatch(/^https?:\/\//);
    });

    it('should load RPC_URL_ARBITRUM from .env.test', () => {
      expect(process.env.RPC_URL_ARBITRUM).toBeDefined();
      expect(process.env.RPC_URL_ARBITRUM).toMatch(/^https?:\/\//);
    });

    it('should load RPC_URL_BASE from .env.test', () => {
      expect(process.env.RPC_URL_BASE).toBeDefined();
      expect(process.env.RPC_URL_BASE).toMatch(/^https?:\/\//);
    });

    it('should load RPC_URL_BSC from .env.test', () => {
      expect(process.env.RPC_URL_BSC).toBeDefined();
      expect(process.env.RPC_URL_BSC).toMatch(/^https?:\/\//);
    });

    it('should load RPC_URL_POLYGON from .env.test', () => {
      expect(process.env.RPC_URL_POLYGON).toBeDefined();
      expect(process.env.RPC_URL_POLYGON).toMatch(/^https?:\/\//);
    });

    it('should load RPC_URL_OPTIMISM from .env.test', () => {
      expect(process.env.RPC_URL_OPTIMISM).toBeDefined();
      expect(process.env.RPC_URL_OPTIMISM).toMatch(/^https?:\/\//);
    });
  });

  describe('Application Configuration', () => {
    it('should set NODE_ENV to test', () => {
      expect(process.env.NODE_ENV).toBe('test');
    });

    it('should set LOG_LEVEL to silent', () => {
      expect(process.env.LOG_LEVEL).toBe('silent');
    });
  });

  describe('Environment Loading Mechanism', () => {
    it('should verify --env-file flag is working', () => {
      // If these env vars are loaded, --env-file is working
      const requiredVars = [
        'DATABASE_URL',
        'RPC_URL_ETHEREUM',
        'NODE_ENV',
        'LOG_LEVEL',
      ];

      const missingVars = requiredVars.filter((varName) => !process.env[varName]);

      expect(missingVars).toEqual([]);
    });

    it('should log available RPC URLs for debugging', () => {
      const rpcVars = Object.keys(process.env)
        .filter((key) => key.startsWith('RPC_URL_'))
        .sort();

      console.log('\n📡 Available RPC URLs:');
      rpcVars.forEach((key) => {
        const value = process.env[key];
        const masked = value ? `${value.substring(0, 30)}...` : 'undefined';
        console.log(`  ${key}: ${masked}`);
      });

      expect(rpcVars.length).toBeGreaterThanOrEqual(6);
    });
  });
});
