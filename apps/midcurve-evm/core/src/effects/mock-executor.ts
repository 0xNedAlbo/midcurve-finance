import { encodeAbiParameters, type Hex } from 'viem';
import { ACTION_TYPES } from '../events/types.js';
import type {
  IEffectExecutor,
  QueuedAction,
  EffectResult,
} from './types.js';

/**
 * Mock implementation of IEffectExecutor for testing.
 *
 * Simulates action execution with configurable results.
 * Useful for:
 * - Unit testing without real chain connections
 * - Integration testing the full event loop
 * - Development without spending gas
 */
export class MockEffectExecutor implements IEffectExecutor {
  /** Configured mock results by action type */
  private mockResults: Map<Hex, Partial<EffectResult>> = new Map();

  /** Simulated execution delay in milliseconds */
  private executionDelay: number;

  /** Counter for generating unique IDs */
  private nftIdCounter = 1000n;
  private positionIdCounter = 0;

  constructor(options?: { executionDelay?: number }) {
    this.executionDelay = options?.executionDelay ?? 100;
  }

  /**
   * Configure a mock result for a specific action type.
   * When an action of this type is executed, this result will be returned.
   */
  setMockResult(actionType: Hex, result: Partial<EffectResult>): void {
    this.mockResults.set(actionType, result);
  }

  /**
   * Clear all configured mock results
   */
  clearMockResults(): void {
    this.mockResults.clear();
  }

  /**
   * Execute an action with simulated delay
   */
  async execute(action: QueuedAction): Promise<EffectResult> {
    // Simulate network/execution delay
    await new Promise((resolve) => setTimeout(resolve, this.executionDelay));

    // Check if we have a configured mock result
    const mockResult = this.mockResults.get(action.actionType);
    if (mockResult) {
      return {
        effectId: action.effectId,
        success: mockResult.success ?? true,
        txHash: mockResult.txHash,
        errorMessage: mockResult.errorMessage,
        resultData: mockResult.resultData ?? ('0x' as Hex),
      };
    }

    // Generate default result based on action type
    return this.generateDefaultResult(action);
  }

  /**
   * Generate a default successful result based on action type
   */
  private generateDefaultResult(action: QueuedAction): EffectResult {
    const txHash = this.generateMockTxHash();

    switch (action.actionType) {
      case ACTION_TYPES.ADD_LIQUIDITY:
        return this.generateAddLiquidityResult(action.effectId, txHash);

      case ACTION_TYPES.REMOVE_LIQUIDITY:
        return this.generateRemoveLiquidityResult(action.effectId, txHash);

      case ACTION_TYPES.COLLECT_FEES:
        return this.generateCollectFeesResult(action.effectId, txHash);

      case ACTION_TYPES.WITHDRAW:
        return this.generateWithdrawResult(action.effectId, txHash);

      default:
        // Unknown action type - return generic success
        return {
          effectId: action.effectId,
          success: true,
          txHash,
          resultData: '0x' as Hex,
        };
    }
  }

  /**
   * Generate mock result for AddLiquidity action
   * Result: (bytes32 positionId, uint256 nftTokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
   */
  private generateAddLiquidityResult(effectId: Hex, txHash: Hex): EffectResult {
    const nftTokenId = this.nftIdCounter++;
    const positionId = this.generateMockPositionId();
    const liquidity = 1000000000000000000n; // 1e18
    const amount0 = 1000000000000000000n; // 1 ETH
    const amount1 = 1000000000n; // 1000 USDC (6 decimals)

    const resultData = encodeAbiParameters(
      [
        { name: 'positionId', type: 'bytes32' },
        { name: 'nftTokenId', type: 'uint256' },
        { name: 'liquidity', type: 'uint128' },
        { name: 'amount0', type: 'uint256' },
        { name: 'amount1', type: 'uint256' },
      ],
      [positionId, nftTokenId, liquidity, amount0, amount1]
    );

    return {
      effectId,
      success: true,
      txHash,
      resultData,
    };
  }

  /**
   * Generate mock result for RemoveLiquidity action
   * Result: (uint256 amount0, uint256 amount1)
   */
  private generateRemoveLiquidityResult(
    effectId: Hex,
    txHash: Hex
  ): EffectResult {
    const amount0 = 500000000000000000n; // 0.5 ETH
    const amount1 = 500000000n; // 500 USDC

    const resultData = encodeAbiParameters(
      [
        { name: 'amount0', type: 'uint256' },
        { name: 'amount1', type: 'uint256' },
      ],
      [amount0, amount1]
    );

    return {
      effectId,
      success: true,
      txHash,
      resultData,
    };
  }

  /**
   * Generate mock result for CollectFees action
   * Result: (uint256 amount0, uint256 amount1)
   */
  private generateCollectFeesResult(effectId: Hex, txHash: Hex): EffectResult {
    const amount0 = 10000000000000000n; // 0.01 ETH in fees
    const amount1 = 10000000n; // 10 USDC in fees

    const resultData = encodeAbiParameters(
      [
        { name: 'amount0', type: 'uint256' },
        { name: 'amount1', type: 'uint256' },
      ],
      [amount0, amount1]
    );

    return {
      effectId,
      success: true,
      txHash,
      resultData,
    };
  }

  /**
   * Generate mock result for Withdraw action
   * Result: (bytes32 txHash)
   */
  private generateWithdrawResult(effectId: Hex, txHash: Hex): EffectResult {
    const resultData = encodeAbiParameters(
      [{ name: 'txHash', type: 'bytes32' }],
      [txHash]
    );

    return {
      effectId,
      success: true,
      txHash,
      resultData,
    };
  }

  /**
   * Generate a mock transaction hash
   */
  private generateMockTxHash(): Hex {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return `0x${Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}` as Hex;
  }

  /**
   * Generate a mock position ID
   */
  private generateMockPositionId(): Hex {
    this.positionIdCounter++;
    const bytes = new Uint8Array(32);
    const view = new DataView(bytes.buffer);
    view.setBigUint64(0, BigInt(this.positionIdCounter), false);
    crypto.getRandomValues(bytes.subarray(8));
    return `0x${Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}` as Hex;
  }
}
