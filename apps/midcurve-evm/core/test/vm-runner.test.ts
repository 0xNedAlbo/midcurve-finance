import { describe, it, expect, beforeAll } from 'vitest';
import { VmRunner } from '../src/vm/vm-runner.js';

describe('VmRunner', () => {
  let vmRunner: VmRunner;

  beforeAll(async () => {
    vmRunner = new VmRunner({
      rpcUrl: 'http://localhost:8545',
      wsUrl: 'ws://localhost:8546',
    });
  });

  it('should connect to Geth and load store addresses', async () => {
    // Initialize should connect to Geth and verify stores are deployed
    await vmRunner.initialize();

    // Get store addresses
    const stores = vmRunner.getStoreAddresses();

    // Verify all store addresses are set
    expect(stores.poolStore).toBeDefined();
    expect(stores.poolStore).not.toBe('0x0000000000000000000000000000000000000000');

    expect(stores.positionStore).toBeDefined();
    expect(stores.positionStore).not.toBe('0x0000000000000000000000000000000000000000');

    expect(stores.balanceStore).toBeDefined();
    expect(stores.balanceStore).not.toBe('0x0000000000000000000000000000000000000000');

    console.log('Store addresses:', stores);
  });

  it('should be able to read contract state', async () => {
    await vmRunner.initialize();

    // Get the system registry code to verify it's deployed
    const stores = vmRunner.getStoreAddresses();
    const poolStoreCode = await vmRunner.getCode(stores.poolStore);

    expect(poolStoreCode).toBeDefined();
    expect(poolStoreCode).not.toBe('0x');
  });
});
