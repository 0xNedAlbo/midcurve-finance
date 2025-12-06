import type { Address, Hex } from 'viem';
import { encodeFunctionData } from 'viem';
import type pino from 'pino';
import type { VmRunner } from '../vm/vm-runner.js';
import { GAS_LIMITS } from '../utils/addresses.js';
import {
  POOL_STORE_ABI,
  POSITION_STORE_ABI,
  BALANCE_STORE_ABI,
} from '../abi/index.js';
import type {
  PoolState,
  PositionState,
  BalanceEntry,
  ExternalEvent,
} from './types.js';

/**
 * StoreSynchronizer updates Store contracts in the embedded EVM with external data.
 *
 * Responsibilities:
 * - Update PoolStore with pool state from mainnet
 * - Update PositionStore with position state from mainnet
 * - Update BalanceStore with token balances from mainnet
 *
 * Note: OHLC data is NOT stored - it's delivered directly via callbacks.
 */
export class StoreSynchronizer {
  private poolStoreAddress: Address | null = null;
  private positionStoreAddress: Address | null = null;
  private balanceStoreAddress: Address | null = null;

  constructor(
    private vmRunner: VmRunner,
    private logger: pino.Logger
  ) {}

  /**
   * Initialize store addresses from SystemRegistry
   */
  async initialize(): Promise<void> {
    const addresses = await this.vmRunner.getStoreAddresses();
    this.poolStoreAddress = addresses.poolStore;
    this.positionStoreAddress = addresses.positionStore;
    this.balanceStoreAddress = addresses.balanceStore;

    this.logger.info(
      {
        poolStore: this.poolStoreAddress,
        positionStore: this.positionStoreAddress,
        balanceStore: this.balanceStoreAddress,
      },
      'Store addresses initialized'
    );
  }

  /**
   * Update store based on external event type.
   * OHLC events are skipped (delivered via callbacks only).
   */
  async update(event: ExternalEvent): Promise<void> {
    switch (event.type) {
      case 'pool':
        await this.updatePool(event.poolId, event.state);
        break;
      case 'position':
        await this.updatePosition(event.positionId, event.state);
        break;
      case 'balance':
        await this.updateBalance(event.entry);
        break;
      case 'ohlc':
        // OHLC data is not stored - delivered via callbacks only
        break;
    }
  }

  /**
   * Update pool state in PoolStore
   */
  async updatePool(poolId: Hex, state: PoolState): Promise<void> {
    if (!this.poolStoreAddress) {
      throw new Error('StoreSynchronizer not initialized');
    }

    const calldata = encodeFunctionData({
      abi: POOL_STORE_ABI,
      functionName: 'updatePool',
      args: [
        poolId,
        {
          chainId: state.chainId,
          poolAddress: state.poolAddress,
          token0: state.token0,
          token1: state.token1,
          fee: state.fee,
          sqrtPriceX96: state.sqrtPriceX96,
          tick: state.tick,
          liquidity: state.liquidity,
          feeGrowthGlobal0X128: state.feeGrowthGlobal0X128,
          feeGrowthGlobal1X128: state.feeGrowthGlobal1X128,
          lastUpdated: state.lastUpdated,
        },
      ],
    });

    const result = await this.vmRunner.callAsCore(
      this.poolStoreAddress,
      calldata,
      GAS_LIMITS.STORE_UPDATE
    );

    if (!result.success) {
      this.logger.error(
        { poolId, error: result.error },
        'Failed to update pool state'
      );
      throw new Error(`Failed to update pool: ${result.error}`);
    }

    this.logger.debug(
      { poolId, tick: state.tick, gasUsed: result.gasUsed.toString() },
      'Pool state updated'
    );
  }

  /**
   * Update position state in PositionStore
   */
  async updatePosition(positionId: Hex, state: PositionState): Promise<void> {
    if (!this.positionStoreAddress) {
      throw new Error('StoreSynchronizer not initialized');
    }

    const calldata = encodeFunctionData({
      abi: POSITION_STORE_ABI,
      functionName: 'updatePosition',
      args: [
        positionId,
        {
          chainId: state.chainId,
          nftTokenId: state.nftTokenId,
          poolId: state.poolId,
          owner: state.owner,
          tickLower: state.tickLower,
          tickUpper: state.tickUpper,
          liquidity: state.liquidity,
          feeGrowthInside0LastX128: state.feeGrowthInside0LastX128,
          feeGrowthInside1LastX128: state.feeGrowthInside1LastX128,
          tokensOwed0: state.tokensOwed0,
          tokensOwed1: state.tokensOwed1,
          lastUpdated: state.lastUpdated,
        },
      ],
    });

    const result = await this.vmRunner.callAsCore(
      this.positionStoreAddress,
      calldata,
      GAS_LIMITS.STORE_UPDATE
    );

    if (!result.success) {
      this.logger.error(
        { positionId, error: result.error },
        'Failed to update position state'
      );
      throw new Error(`Failed to update position: ${result.error}`);
    }

    this.logger.debug(
      {
        positionId,
        liquidity: state.liquidity.toString(),
        gasUsed: result.gasUsed.toString(),
      },
      'Position state updated'
    );
  }

  /**
   * Update balance in BalanceStore
   */
  async updateBalance(entry: BalanceEntry): Promise<void> {
    if (!this.balanceStoreAddress) {
      throw new Error('StoreSynchronizer not initialized');
    }

    const calldata = encodeFunctionData({
      abi: BALANCE_STORE_ABI,
      functionName: 'updateBalance',
      args: [entry.strategy, entry.chainId, entry.token, entry.balance],
    });

    const result = await this.vmRunner.callAsCore(
      this.balanceStoreAddress,
      calldata,
      GAS_LIMITS.STORE_UPDATE
    );

    if (!result.success) {
      this.logger.error(
        { strategy: entry.strategy, token: entry.token, error: result.error },
        'Failed to update balance'
      );
      throw new Error(`Failed to update balance: ${result.error}`);
    }

    this.logger.debug(
      {
        strategy: entry.strategy,
        token: entry.token,
        balance: entry.balance.toString(),
        gasUsed: result.gasUsed.toString(),
      },
      'Balance updated'
    );
  }

  /**
   * Get current pool state from PoolStore
   */
  async getPoolState(poolId: Hex): Promise<PoolState | null> {
    if (!this.poolStoreAddress) {
      throw new Error('StoreSynchronizer not initialized');
    }

    try {
      const result = await this.vmRunner.readContract<PoolState>(
        this.poolStoreAddress,
        POOL_STORE_ABI,
        'getPool',
        [poolId]
      );
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Get current position state from PositionStore
   */
  async getPositionState(positionId: Hex): Promise<PositionState | null> {
    if (!this.positionStoreAddress) {
      throw new Error('StoreSynchronizer not initialized');
    }

    try {
      const result = await this.vmRunner.readContract<PositionState>(
        this.positionStoreAddress,
        POSITION_STORE_ABI,
        'getPosition',
        [positionId]
      );
      return result;
    } catch {
      return null;
    }
  }
}
