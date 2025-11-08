/**
 * Tests for EVM Configuration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EvmConfig,
  getEvmConfig,
  SupportedChainId,
  type ChainConfig,
} from './evm.js';

describe('EvmConfig', () => {
  // Store original env
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset singleton before each test
    EvmConfig.resetInstance();
    // Clone env to avoid side effects
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
    // Reset singleton
    EvmConfig.resetInstance();
  });

  describe('constructor and initialization', () => {
    it('should mark RPC URLs as invalid when env vars not set', () => {
      // Explicitly remove RPC URL env vars
      delete process.env['RPC_URL_ETHEREUM'];
      delete process.env['RPC_URL_ARBITRUM'];
      delete process.env['RPC_URL_BASE'];
      delete process.env['RPC_URL_BSC'];
      delete process.env['RPC_URL_POLYGON'];
      delete process.env['RPC_URL_OPTIMISM'];

      const config = new EvmConfig();

      // Should not throw during construction
      expect(config).toBeInstanceOf(EvmConfig);

      // But should throw when trying to get config
      expect(() => config.getChainConfig(SupportedChainId.ETHEREUM)).toThrow(
        'RPC URL not configured'
      );
    });

    it('should use environment variables when provided', () => {
      process.env['RPC_URL_ETHEREUM'] = 'https://custom-eth-rpc.com';
      process.env['RPC_URL_ARBITRUM'] = 'https://custom-arb-rpc.com';

      const config = new EvmConfig();

      expect(config.getChainConfig(SupportedChainId.ETHEREUM).rpcUrl).toBe(
        'https://custom-eth-rpc.com'
      );
      expect(config.getChainConfig(SupportedChainId.ARBITRUM).rpcUrl).toBe(
        'https://custom-arb-rpc.com'
      );
    });

    it('should initialize all supported chains', () => {
      const config = new EvmConfig();

      const supportedChains = config.getSupportedChainIds();
      expect(supportedChains).toContain(SupportedChainId.ETHEREUM);
      expect(supportedChains).toContain(SupportedChainId.ARBITRUM);
      expect(supportedChains).toContain(SupportedChainId.BASE);
      expect(supportedChains).toContain(SupportedChainId.BSC);
      expect(supportedChains).toContain(SupportedChainId.POLYGON);
      expect(supportedChains).toContain(SupportedChainId.OPTIMISM);
      expect(supportedChains).toHaveLength(6);
    });
  });

  describe('getChainConfig', () => {
    it('should return config for Ethereum', () => {
      process.env['RPC_URL_ETHEREUM'] = 'https://test-eth-rpc.com';
      const config = new EvmConfig();
      const ethConfig = config.getChainConfig(SupportedChainId.ETHEREUM);

      expect(ethConfig).toMatchObject({
        chainId: 1,
        name: 'Ethereum',
        blockExplorer: 'https://etherscan.io',
      });
      expect(ethConfig.viemChain).toBeDefined();
    });

    it('should return config for Arbitrum', () => {
      process.env['RPC_URL_ARBITRUM'] = 'https://test-arb-rpc.com';
      const config = new EvmConfig();
      const arbConfig = config.getChainConfig(SupportedChainId.ARBITRUM);

      expect(arbConfig).toMatchObject({
        chainId: 42161,
        name: 'Arbitrum One',
        blockExplorer: 'https://arbiscan.io',
      });
    });

    it('should return config for Base', () => {
      process.env['RPC_URL_BASE'] = 'https://test-base-rpc.com';
      const config = new EvmConfig();
      const baseConfig = config.getChainConfig(SupportedChainId.BASE);

      expect(baseConfig).toMatchObject({
        chainId: 8453,
        name: 'Base',
        blockExplorer: 'https://basescan.org',
      });
    });

    it('should return config for BSC', () => {
      process.env['RPC_URL_BSC'] = 'https://test-bsc-rpc.com';
      const config = new EvmConfig();
      const bscConfig = config.getChainConfig(SupportedChainId.BSC);

      expect(bscConfig).toMatchObject({
        chainId: 56,
        name: 'BNB Smart Chain',
        blockExplorer: 'https://bscscan.com',
      });
    });

    it('should return config for Polygon', () => {
      process.env['RPC_URL_POLYGON'] = 'https://test-polygon-rpc.com';
      const config = new EvmConfig();
      const polygonConfig = config.getChainConfig(SupportedChainId.POLYGON);

      expect(polygonConfig).toMatchObject({
        chainId: 137,
        name: 'Polygon',
        blockExplorer: 'https://polygonscan.com',
      });
    });

    it('should return config for Optimism', () => {
      process.env['RPC_URL_OPTIMISM'] = 'https://test-optimism-rpc.com';
      const config = new EvmConfig();
      const opConfig = config.getChainConfig(SupportedChainId.OPTIMISM);

      expect(opConfig).toMatchObject({
        chainId: 10,
        name: 'Optimism',
        blockExplorer: 'https://optimistic.etherscan.io',
      });
    });

    it('should throw error for unsupported chain ID', () => {
      const config = new EvmConfig();

      expect(() => config.getChainConfig(999999)).toThrow(
        'Chain 999999 is not configured'
      );
      expect(() => config.getChainConfig(999999)).toThrow(
        'Supported chains:'
      );
    });
  });

  describe('getPublicClient', () => {
    it('should create and return PublicClient for Ethereum', () => {
      process.env['RPC_URL_ETHEREUM'] = 'https://test-eth-rpc.com';
      const config = new EvmConfig();
      const client = config.getPublicClient(SupportedChainId.ETHEREUM);

      expect(client).toBeDefined();
      expect(client.chain?.id).toBe(1);
    });

    it('should cache and reuse client instances', () => {
      process.env['RPC_URL_ETHEREUM'] = 'https://test-eth-rpc.com';
      const config = new EvmConfig();

      const client1 = config.getPublicClient(SupportedChainId.ETHEREUM);
      const client2 = config.getPublicClient(SupportedChainId.ETHEREUM);

      // Should be same instance (cached)
      expect(client1).toBe(client2);
    });

    it('should create different clients for different chains', () => {
      process.env['RPC_URL_ETHEREUM'] = 'https://test-eth-rpc.com';
      process.env['RPC_URL_ARBITRUM'] = 'https://test-arb-rpc.com';
      const config = new EvmConfig();

      const ethClient = config.getPublicClient(SupportedChainId.ETHEREUM);
      const arbClient = config.getPublicClient(SupportedChainId.ARBITRUM);

      expect(ethClient).not.toBe(arbClient);
      expect(ethClient.chain?.id).toBe(1);
      expect(arbClient.chain?.id).toBe(42161);
    });

    it('should throw error for unsupported chain ID', () => {
      const config = new EvmConfig();

      expect(() => config.getPublicClient(999999)).toThrow(
        'Chain 999999 is not configured'
      );
    });
  });

  describe('isChainSupported', () => {
    it('should return true for supported chains', () => {
      const config = new EvmConfig();

      expect(config.isChainSupported(SupportedChainId.ETHEREUM)).toBe(true);
      expect(config.isChainSupported(SupportedChainId.ARBITRUM)).toBe(true);
      expect(config.isChainSupported(SupportedChainId.BASE)).toBe(true);
      expect(config.isChainSupported(SupportedChainId.BSC)).toBe(true);
      expect(config.isChainSupported(SupportedChainId.POLYGON)).toBe(true);
      expect(config.isChainSupported(SupportedChainId.OPTIMISM)).toBe(true);
    });

    it('should return false for unsupported chains', () => {
      const config = new EvmConfig();

      expect(config.isChainSupported(999999)).toBe(false);
      expect(config.isChainSupported(0)).toBe(false);
      expect(config.isChainSupported(-1)).toBe(false);
    });
  });

  describe('getSupportedChainIds', () => {
    it('should return array of all supported chain IDs', () => {
      const config = new EvmConfig();
      const chainIds = config.getSupportedChainIds();

      expect(chainIds).toEqual(
        expect.arrayContaining([1, 42161, 8453, 56, 137, 10])
      );
      expect(chainIds).toHaveLength(6);
    });
  });

  describe('singleton pattern', () => {
    it('should return same instance from getInstance', () => {
      const instance1 = EvmConfig.getInstance();
      const instance2 = EvmConfig.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should return same instance from getEvmConfig helper', () => {
      const instance1 = getEvmConfig();
      const instance2 = getEvmConfig();

      expect(instance1).toBe(instance2);
    });

    it('should create new instance after resetInstance', () => {
      const instance1 = EvmConfig.getInstance();
      EvmConfig.resetInstance();
      const instance2 = EvmConfig.getInstance();

      expect(instance1).not.toBe(instance2);
    });

    it('should respect new env vars after reset', () => {
      // Delete RPC URL env var for first instance
      delete process.env['RPC_URL_ETHEREUM'];

      // First instance without env var should throw
      const instance1 = EvmConfig.getInstance();
      expect(() => instance1.getChainConfig(SupportedChainId.ETHEREUM)).toThrow(
        'RPC URL not configured'
      );

      // Reset and set env var
      EvmConfig.resetInstance();
      process.env['RPC_URL_ETHEREUM'] = 'https://new-custom-rpc.com';

      const instance2 = EvmConfig.getInstance();
      const ethRpc2 = instance2.getChainConfig(SupportedChainId.ETHEREUM).rpcUrl;

      // Second instance should succeed with new env var
      expect(ethRpc2).toBe('https://new-custom-rpc.com');
    });
  });

  describe('environment variable precedence', () => {
    it('should prefer env vars over defaults for all chains', () => {
      process.env['RPC_URL_ETHEREUM'] = 'https://custom-eth.com';
      process.env['RPC_URL_ARBITRUM'] = 'https://custom-arb.com';
      process.env['RPC_URL_BASE'] = 'https://custom-base.com';
      process.env['RPC_URL_BSC'] = 'https://custom-bsc.com';
      process.env['RPC_URL_POLYGON'] = 'https://custom-polygon.com';
      process.env['RPC_URL_OPTIMISM'] = 'https://custom-optimism.com';

      const config = new EvmConfig();

      expect(config.getChainConfig(SupportedChainId.ETHEREUM).rpcUrl).toBe(
        'https://custom-eth.com'
      );
      expect(config.getChainConfig(SupportedChainId.ARBITRUM).rpcUrl).toBe(
        'https://custom-arb.com'
      );
      expect(config.getChainConfig(SupportedChainId.BASE).rpcUrl).toBe(
        'https://custom-base.com'
      );
      expect(config.getChainConfig(SupportedChainId.BSC).rpcUrl).toBe(
        'https://custom-bsc.com'
      );
      expect(config.getChainConfig(SupportedChainId.POLYGON).rpcUrl).toBe(
        'https://custom-polygon.com'
      );
      expect(config.getChainConfig(SupportedChainId.OPTIMISM).rpcUrl).toBe(
        'https://custom-optimism.com'
      );
    });

    it('should mix configured and unconfigured chains', () => {
      process.env['RPC_URL_ETHEREUM'] = 'https://custom-eth.com';
      // Leave ARBITRUM unconfigured
      delete process.env['RPC_URL_ARBITRUM'];

      const config = new EvmConfig();

      expect(config.getChainConfig(SupportedChainId.ETHEREUM).rpcUrl).toBe(
        'https://custom-eth.com'
      );
      // Arbitrum should throw error when accessed
      expect(() => config.getChainConfig(SupportedChainId.ARBITRUM)).toThrow(
        'RPC URL not configured'
      );
    });
  });

  describe('RPC URL validation', () => {
    it('should throw comprehensive error when RPC URL is missing', () => {
      // No env vars set - explicitly delete
      delete process.env['RPC_URL_ETHEREUM'];
      delete process.env['RPC_URL_ARBITRUM'];
      delete process.env['RPC_URL_BASE'];
      delete process.env['RPC_URL_BSC'];
      delete process.env['RPC_URL_POLYGON'];
      delete process.env['RPC_URL_OPTIMISM'];

      const config = new EvmConfig();

      expect(() => config.getChainConfig(SupportedChainId.ETHEREUM)).toThrow(
        'RPC URL not configured for Ethereum'
      );
      expect(() => config.getChainConfig(SupportedChainId.ETHEREUM)).toThrow(
        'RPC_URL_ETHEREUM'
      );
      expect(() => config.getChainConfig(SupportedChainId.ETHEREUM)).toThrow(
        'Copy .env.example'
      );
      expect(() => config.getChainConfig(SupportedChainId.ETHEREUM)).toThrow(
        'Chain ID: 1'
      );
    });

    it('should succeed when RPC URL is configured', () => {
      process.env['RPC_URL_ETHEREUM'] = 'https://custom-eth-rpc.com';
      const config = new EvmConfig();

      const ethConfig = config.getChainConfig(SupportedChainId.ETHEREUM);
      expect(ethConfig.rpcUrl).toBe('https://custom-eth-rpc.com');
      expect(ethConfig.chainId).toBe(1);
      expect(ethConfig.name).toBe('Ethereum');
    });

    it('should throw with correct env var name for each chain', () => {
      // Delete all RPC URL env vars
      delete process.env['RPC_URL_ETHEREUM'];
      delete process.env['RPC_URL_ARBITRUM'];
      delete process.env['RPC_URL_BASE'];
      delete process.env['RPC_URL_BSC'];
      delete process.env['RPC_URL_POLYGON'];
      delete process.env['RPC_URL_OPTIMISM'];

      const config = new EvmConfig();

      expect(() => config.getChainConfig(SupportedChainId.ETHEREUM)).toThrow(
        'RPC_URL_ETHEREUM'
      );
      expect(() => config.getChainConfig(SupportedChainId.ARBITRUM)).toThrow(
        'RPC_URL_ARBITRUM'
      );
      expect(() => config.getChainConfig(SupportedChainId.BASE)).toThrow(
        'RPC_URL_BASE'
      );
      expect(() => config.getChainConfig(SupportedChainId.BSC)).toThrow(
        'RPC_URL_BSC'
      );
      expect(() => config.getChainConfig(SupportedChainId.POLYGON)).toThrow(
        'RPC_URL_POLYGON'
      );
      expect(() => config.getChainConfig(SupportedChainId.OPTIMISM)).toThrow(
        'RPC_URL_OPTIMISM'
      );
    });

    it('should include chain name and ID in error message', () => {
      // Delete all RPC URL env vars
      delete process.env['RPC_URL_ETHEREUM'];
      delete process.env['RPC_URL_ARBITRUM'];
      delete process.env['RPC_URL_BASE'];
      delete process.env['RPC_URL_BSC'];
      delete process.env['RPC_URL_POLYGON'];
      delete process.env['RPC_URL_OPTIMISM'];

      const config = new EvmConfig();

      expect(() => config.getChainConfig(SupportedChainId.ARBITRUM)).toThrow(
        'Arbitrum One'
      );
      expect(() => config.getChainConfig(SupportedChainId.ARBITRUM)).toThrow(
        'Chain ID: 42161'
      );

      expect(() => config.getChainConfig(SupportedChainId.BASE)).toThrow(
        'Base'
      );
      expect(() => config.getChainConfig(SupportedChainId.BASE)).toThrow(
        'Chain ID: 8453'
      );
    });

    it('should include setup instructions in error message', () => {
      // Delete all RPC URL env vars
      delete process.env['RPC_URL_ETHEREUM'];
      delete process.env['RPC_URL_ARBITRUM'];
      delete process.env['RPC_URL_BASE'];
      delete process.env['RPC_URL_BSC'];
      delete process.env['RPC_URL_POLYGON'];
      delete process.env['RPC_URL_OPTIMISM'];

      const config = new EvmConfig();

      expect(() => config.getChainConfig(SupportedChainId.ETHEREUM)).toThrow(
        'To fix this:'
      );
      expect(() => config.getChainConfig(SupportedChainId.ETHEREUM)).toThrow(
        'Example providers'
      );
      expect(() => config.getChainConfig(SupportedChainId.ETHEREUM)).toThrow(
        'Environment variables must be set before starting the application'
      );
    });

    it('should not throw during construction even when all env vars are missing', () => {
      // Construction should succeed - errors only on usage
      expect(() => new EvmConfig()).not.toThrow();
    });

    it('should allow access to configured chains while blocking unconfigured ones', () => {
      // Delete all first
      delete process.env['RPC_URL_ETHEREUM'];
      delete process.env['RPC_URL_ARBITRUM'];
      delete process.env['RPC_URL_BASE'];
      delete process.env['RPC_URL_BSC'];
      delete process.env['RPC_URL_POLYGON'];
      delete process.env['RPC_URL_OPTIMISM'];

      // Set only specific ones
      process.env['RPC_URL_ETHEREUM'] = 'https://eth-rpc.com';
      process.env['RPC_URL_BASE'] = 'https://base-rpc.com';

      const config = new EvmConfig();

      // Configured chains should work
      expect(config.getChainConfig(SupportedChainId.ETHEREUM).rpcUrl).toBe(
        'https://eth-rpc.com'
      );
      expect(config.getChainConfig(SupportedChainId.BASE).rpcUrl).toBe(
        'https://base-rpc.com'
      );

      // Unconfigured chains should throw
      expect(() => config.getChainConfig(SupportedChainId.ARBITRUM)).toThrow(
        'RPC URL not configured'
      );
      expect(() => config.getChainConfig(SupportedChainId.POLYGON)).toThrow(
        'RPC URL not configured'
      );
    });
  });
});
