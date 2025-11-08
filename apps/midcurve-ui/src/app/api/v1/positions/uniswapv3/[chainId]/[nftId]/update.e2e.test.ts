/**
 * Position Update Endpoint E2E Tests
 *
 * Tests the PATCH /api/v1/positions/uniswapv3/:chainId/:nftId endpoint end-to-end.
 *
 * Prerequisites:
 * - Position must already exist in database (created via PUT endpoint)
 * - Events must come AFTER existing events in blockchain order
 *
 * Note: This endpoint makes minimal on-chain calls:
 * - Historic pool price at each event's blockNumber
 *
 * Test strategy:
 * 1. Create position using PUT endpoint
 * 2. Add new events using PATCH endpoint
 * 3. Verify position state updated correctly
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  authenticatedPatch,
  unauthenticatedPatch,
  authenticatedPut,
  parseJsonResponse,
} from '@/test/helpers';
import type {
  CreateUniswapV3PositionResponse,
  UpdateUniswapV3PositionResponse,
} from '@midcurve/api-shared';

/**
 * Test position: USDC/WETH position on Arbitrum
 *
 * Pool: 0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443 (USDC/WETH 0.05% on Arbitrum)
 * This is a real pool that exists on Arbitrum
 */
const TEST_CHAIN_ID = 42161; // Arbitrum
const TEST_NFT_ID = 888888; // Hypothetical NFT ID for update tests

const INITIAL_POSITION_REQUEST = {
  poolAddress: '0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443', // Real USDC/WETH pool on Arbitrum
  tickUpper: 201120,
  tickLower: 199120,
  ownerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0', // Test wallet address
  quoteTokenAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
  increaseEvent: {
    timestamp: '2024-01-15T10:30:00Z',
    blockNumber: '175000000',
    transactionIndex: 42,
    logIndex: 5,
    transactionHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
    liquidity: '1000000000000000000',
    amount0: '500000000', // 500 USDC (6 decimals)
    amount1: '250000000000000000', // 0.25 WETH (18 decimals)
  },
};

describe('PATCH /api/v1/positions/uniswapv3/:chainId/:nftId', () => {
  // ============================================================================
  // AUTHENTICATION TESTS
  // ============================================================================

  describe('authentication', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const response = await unauthenticatedPatch(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        {
          events: [
            {
              eventType: 'COLLECT',
              timestamp: '2024-01-16T10:30:00Z',
              blockNumber: '175100000',
              transactionIndex: 10,
              logIndex: 2,
              transactionHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
              amount0: '1000000', // 1 USDC collected
              amount1: '500000000000000', // 0.0005 WETH collected
              recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
            },
          ],
        }
      );

      const data = await parseJsonResponse(response);

      // Debug output
      if (response.status === 500) {
        console.error('Unexpected 500 error:', data);
      }

      expect(response.status).toBe(401);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
    }, 5000);
  });

  // ============================================================================
  // VALIDATION TESTS - PATH PARAMETERS
  // ============================================================================

  describe('path parameter validation', () => {
    it('should reject invalid chainId with 400', async () => {
      const response = await authenticatedPatch(
        `/api/v1/positions/uniswapv3/invalid/${TEST_NFT_ID}`,
        {
          events: [
            {
              eventType: 'COLLECT',
              timestamp: '2024-01-16T10:30:00Z',
              blockNumber: '175100000',
              transactionIndex: 10,
              logIndex: 2,
              transactionHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
              amount0: '1000000',
              amount1: '500000000000000',
              recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
            },
          ],
        }
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject invalid nftId with 400', async () => {
      const response = await authenticatedPatch(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/invalid`,
        {
          events: [
            {
              eventType: 'COLLECT',
              timestamp: '2024-01-16T10:30:00Z',
              blockNumber: '175100000',
              transactionIndex: 10,
              logIndex: 2,
              transactionHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
              amount0: '1000000',
              amount1: '500000000000000',
              recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
            },
          ],
        }
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);
  });

  // ============================================================================
  // VALIDATION TESTS - REQUEST BODY
  // ============================================================================

  describe('request body validation', () => {
    it('should reject empty events array with 400', async () => {
      const response = await authenticatedPatch(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        { events: [] }
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject event with invalid eventType with 400', async () => {
      const response = await authenticatedPatch(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        {
          events: [
            {
              eventType: 'INVALID_TYPE',
              timestamp: '2024-01-16T10:30:00Z',
              blockNumber: '175100000',
              transactionIndex: 10,
              logIndex: 2,
              transactionHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
              amount0: '1000000',
              amount1: '500000000000000',
            },
          ],
        }
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject INCREASE_LIQUIDITY event without liquidity field with 400', async () => {
      const response = await authenticatedPatch(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        {
          events: [
            {
              eventType: 'INCREASE_LIQUIDITY',
              timestamp: '2024-01-16T10:30:00Z',
              blockNumber: '175100000',
              transactionIndex: 10,
              logIndex: 2,
              transactionHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
              // Missing liquidity field
              amount0: '100000000',
              amount1: '50000000000000000',
            },
          ],
        }
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject COLLECT event without recipient field with 400', async () => {
      const response = await authenticatedPatch(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        {
          events: [
            {
              eventType: 'COLLECT',
              timestamp: '2024-01-16T10:30:00Z',
              blockNumber: '175100000',
              transactionIndex: 10,
              logIndex: 2,
              transactionHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
              amount0: '1000000',
              amount1: '500000000000000',
              // Missing recipient field
            },
          ],
        }
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject event with invalid timestamp format with 400', async () => {
      const response = await authenticatedPatch(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        {
          events: [
            {
              eventType: 'COLLECT',
              timestamp: 'not-a-valid-timestamp',
              blockNumber: '175100000',
              transactionIndex: 10,
              logIndex: 2,
              transactionHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
              amount0: '1000000',
              amount1: '500000000000000',
              recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
            },
          ],
        }
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);

    it('should reject event with invalid address format with 400', async () => {
      const response = await authenticatedPatch(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        {
          events: [
            {
              eventType: 'COLLECT',
              timestamp: '2024-01-16T10:30:00Z',
              blockNumber: '175100000',
              transactionIndex: 10,
              logIndex: 2,
              transactionHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
              amount0: '1000000',
              amount1: '500000000000000',
              recipient: 'not-a-valid-address',
            },
          ],
        }
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data.error).toHaveProperty('code', 'VALIDATION_ERROR');
    }, 5000);
  });

  // ============================================================================
  // NOT FOUND TESTS
  // ============================================================================

  describe('position not found', () => {
    it('should return 404 for non-existent position', async () => {
      const response = await authenticatedPatch(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/777777`, // Non-existent NFT ID
        {
          events: [
            {
              eventType: 'COLLECT',
              timestamp: '2024-01-16T10:30:00Z',
              blockNumber: '175100000',
              transactionIndex: 10,
              logIndex: 2,
              transactionHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
              amount0: '1000000',
              amount1: '500000000000000',
              recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
            },
          ],
        }
      );

      expect(response.status).toBe(404);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data.error).toHaveProperty('code', 'NOT_FOUND');
    }, 5000);
  });

  // ============================================================================
  // EVENT ORDERING TESTS
  // ============================================================================

  describe('event ordering validation', () => {
    let positionCreated = false;

    // Create initial position before running ordering tests
    beforeAll(async () => {
      const response = await authenticatedPut(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        INITIAL_POSITION_REQUEST
      );

      positionCreated = response.status === 200;

      if (!positionCreated) {
        console.warn(
          `⚠️  Position creation failed with status ${response.status}. ` +
          'Event ordering tests will be skipped. This is expected if RPC endpoints are not configured.'
        );
      }
    }, 15000);

    it.skipIf(() => !positionCreated)('should reject event with blockNumber before existing events with 400', async () => {
      const response = await authenticatedPatch(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        {
          events: [
            {
              eventType: 'COLLECT',
              timestamp: '2024-01-14T10:30:00Z', // Before initial position
              blockNumber: '174000000', // Before initial position blockNumber (175000000)
              transactionIndex: 10,
              logIndex: 2,
              transactionHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
              amount0: '1000000',
              amount1: '500000000000000',
              recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
            },
          ],
        }
      );

      expect(response.status).toBe(400);

      const data = await parseJsonResponse(response);
      expect(data).toHaveProperty('success', false);
      expect(data.error).toHaveProperty('code', 'BAD_REQUEST');
      expect(data.error.message).toContain('ordering');
    }, 5000);
  });

  // ============================================================================
  // SUCCESS TESTS
  // ============================================================================

  describe('successful updates', () => {
    let positionCreated = false;

    // Create initial position before running success tests
    beforeAll(async () => {
      const response = await authenticatedPut(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        INITIAL_POSITION_REQUEST
      );

      positionCreated = response.status === 200;

      if (!positionCreated) {
        console.warn(
          `⚠️  Position creation failed with status ${response.status}. ` +
          'Success tests will be skipped. This is expected if RPC endpoints are not configured.'
        );
      }
    }, 15000); // Longer timeout for position creation with on-chain calls

    it.skipIf(() => !positionCreated)('should successfully add COLLECT event to position', async () => {
      const response = await authenticatedPatch(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        {
          events: [
            {
              eventType: 'COLLECT',
              timestamp: '2024-01-16T10:30:00Z',
              blockNumber: '175100000',
              transactionIndex: 10,
              logIndex: 2,
              transactionHash: '0x4444444444444444444444444444444444444444444444444444444444444444',
              amount0: '1000000', // 1 USDC collected
              amount1: '500000000000000', // 0.0005 WETH collected
              recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
            },
          ],
        }
      );

      expect(response.status).toBe(200);

      const data = (await parseJsonResponse(response)) as UpdateUniswapV3PositionResponse;
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('id');
      expect(data.data).toHaveProperty('protocol', 'uniswapv3');
      expect(data.data).toHaveProperty('config');
      expect(data.data.config).toHaveProperty('chainId', TEST_CHAIN_ID);
      expect(data.data.config).toHaveProperty('nftId', TEST_NFT_ID);
    }, 10000);

    it.skipIf(() => !positionCreated)('should successfully add INCREASE_LIQUIDITY event to position', async () => {
      const response = await authenticatedPatch(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        {
          events: [
            {
              eventType: 'INCREASE_LIQUIDITY',
              timestamp: '2024-01-17T10:30:00Z',
              blockNumber: '175200000',
              transactionIndex: 15,
              logIndex: 3,
              transactionHash: '0x5555555555555555555555555555555555555555555555555555555555555555',
              liquidity: '500000000000000000', // Add 0.5 ETH worth of liquidity
              amount0: '250000000', // 250 USDC
              amount1: '125000000000000000', // 0.125 WETH
            },
          ],
        }
      );

      expect(response.status).toBe(200);

      const data = (await parseJsonResponse(response)) as UpdateUniswapV3PositionResponse;
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('id');
      expect(data.data.state.liquidity).toBeTruthy(); // Should have updated liquidity
    }, 10000);

    it.skipIf(() => !positionCreated)('should successfully add DECREASE_LIQUIDITY event to position', async () => {
      const response = await authenticatedPatch(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        {
          events: [
            {
              eventType: 'DECREASE_LIQUIDITY',
              timestamp: '2024-01-18T10:30:00Z',
              blockNumber: '175300000',
              transactionIndex: 20,
              logIndex: 4,
              transactionHash: '0x6666666666666666666666666666666666666666666666666666666666666666',
              liquidity: '250000000000000000', // Remove 0.25 ETH worth of liquidity
              amount0: '125000000', // 125 USDC
              amount1: '62500000000000000', // 0.0625 WETH
            },
          ],
        }
      );

      expect(response.status).toBe(200);

      const data = (await parseJsonResponse(response)) as UpdateUniswapV3PositionResponse;
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('id');
    }, 10000);

    it.skipIf(() => !positionCreated)('should successfully add multiple events in single request', async () => {
      const response = await authenticatedPatch(
        `/api/v1/positions/uniswapv3/${TEST_CHAIN_ID}/${TEST_NFT_ID}`,
        {
          events: [
            {
              eventType: 'COLLECT',
              timestamp: '2024-01-19T10:30:00Z',
              blockNumber: '175400000',
              transactionIndex: 25,
              logIndex: 5,
              transactionHash: '0x7777777777777777777777777777777777777777777777777777777777777777',
              amount0: '500000', // 0.5 USDC collected
              amount1: '250000000000000', // 0.00025 WETH collected
              recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
            },
            {
              eventType: 'COLLECT',
              timestamp: '2024-01-19T11:30:00Z',
              blockNumber: '175400001',
              transactionIndex: 30,
              logIndex: 6,
              transactionHash: '0x8888888888888888888888888888888888888888888888888888888888888888',
              amount0: '300000', // 0.3 USDC collected
              amount1: '150000000000000', // 0.00015 WETH collected
              recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
            },
          ],
        }
      );

      expect(response.status).toBe(200);

      const data = (await parseJsonResponse(response)) as UpdateUniswapV3PositionResponse;
      expect(data).toHaveProperty('success', true);
      expect(data).toHaveProperty('data');
      expect(data.data).toHaveProperty('id');
    }, 15000); // Longer timeout for multiple events
  });
});
