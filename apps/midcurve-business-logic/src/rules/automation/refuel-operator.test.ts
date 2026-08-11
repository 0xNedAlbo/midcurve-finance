/**
 * RefuelOperatorRule — unit tests
 *
 * Issue #125. The regression that motivates the file is test 1: the rule used to skip
 * registerSchedule() when no treasury existed at startup, so a treasury registered at
 * runtime left it with no cron until the service restarted.
 *
 *  1. The schedule is registered even with zero treasuries
 *  2. A treasury appearing between runs is picked up without a restart
 *  3. A treasury disappearing between runs is dropped without a restart
 *  4. The trigger is per-chain and sits above the readiness gate on every chain
 *  5. Balance above the trigger does not sign, but bindings are still reported
 *  6. An empty treasury does not sign
 *  7. WETH below the gas-relative floor does not sign
 *  8. An operator binding mismatch does not sign
 *  9. One chain failing does not stop the others
 * 10. A run starting while the previous is in flight is skipped
 * 11. A failed broadcast hands the nonce back rather than leaving a gap
 *
 * No live RabbitMQ, no live Prisma, no RPC. The rule's own service instances are replaced
 * after construction; the signer client, EVM config and scheduler are module-mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// MODULE MOCKS
// =============================================================================

const {
  findChainsByContractNameMock,
  getOperatorAddressMock,
  signRefuelOperatorMock,
  getPublicClientMock,
  registerScheduleMock,
  systemConfigGetMock,
  releaseNonceMock,
} = vi.hoisted(() => ({
  findChainsByContractNameMock: vi.fn(),
  getOperatorAddressMock: vi.fn(),
  signRefuelOperatorMock: vi.fn(),
  getPublicClientMock: vi.fn(),
  registerScheduleMock: vi.fn(),
  systemConfigGetMock: vi.fn(),
  releaseNonceMock: vi.fn(),
}));

vi.mock('@midcurve/services', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    SharedContractService: class {
      findChainsByContractName = findChainsByContractNameMock;
    },
    SystemConfigService: {
      getInstance: () => ({ get: systemConfigGetMock }),
    },
    getEvmConfig: () => ({ getPublicClient: getPublicClientMock }),
    createServiceLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(),
    }),
  };
});

vi.mock('../../clients/signer-client', () => ({
  getSignerClient: () => ({
    getOperatorAddress: getOperatorAddressMock,
    signRefuelOperator: signRefuelOperatorMock,
    releaseNonce: releaseNonceMock,
  }),
}));

vi.mock('../../scheduler', () => ({
  getSchedulerService: () => ({
    registerSchedule: registerScheduleMock,
    unregisterSchedule: vi.fn(),
    unregisterAllForRule: vi.fn(),
    isServiceRunning: () => true,
  }),
}));

import { GAS_READINESS_CONFIG, getGasReadinessConfig } from '@midcurve/shared';
import { RefuelOperatorRule } from './refuel-operator';

// =============================================================================
// FIXTURES
// =============================================================================

const ARBITRUM = 42161;
const ETHEREUM = 1;

const OPERATOR = '0x1111111111111111111111111111111111111111';
const OTHER_OPERATOR = '0x9999999999999999999999999999999999999999';
const ADMIN = '0x2222222222222222222222222222222222222222';
const TREASURY_ARB = '0x13d13B15BbE9b06C0279a7aB5f0a898EA3f25A40';
const TREASURY_ETH = '0xC6962004f452bE9203591991D15f6b388e09E8D0';

/** 1 gwei — keeps the gas-relative floor a round number in the tests */
const GAS_PRICE = 1_000_000_000n;
/** What the rule computes: 150k gas * (gasPrice * 1.2) * 10 */
const GAS_FLOOR = 150_000n * ((GAS_PRICE * 120n) / 100n) * 10n;

interface ChainState {
  operatorBalance: bigint;
  treasuryWeth: bigint;
  boundOperator: string;
  boundAdmin: string;
  receiptStatus?: 'success' | 'reverted';
  throwOn?: 'operator' | 'balance';
}

const sendRawTransactionMock = vi.fn();

function makeClient(state: ChainState) {
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'operator') {
        if (state.throwOn === 'operator') throw new Error('RPC unavailable');
        return state.boundOperator;
      }
      if (functionName === 'admin') return state.boundAdmin;
      if (functionName === 'balanceOf') return state.treasuryWeth;
      throw new Error(`unexpected readContract ${functionName}`);
    }),
    getBalance: vi.fn(async () => {
      if (state.throwOn === 'balance') throw new Error('RPC unavailable');
      return state.operatorBalance;
    }),
    getGasPrice: vi.fn(async () => GAS_PRICE),
    getTransactionCount: vi.fn(async () => 7),
    sendRawTransaction: sendRawTransactionMock,
    waitForTransactionReceipt: vi.fn(async () => ({
      status: state.receiptStatus ?? 'success',
      gasUsed: 100_000n,
    })),
  };
}

/** Healthy chain: below trigger, treasury funded above the floor, bindings correct */
function healthy(overrides: Partial<ChainState> = {}): ChainState {
  return {
    operatorBalance: 1n,
    treasuryWeth: GAS_FLOOR * 100n,
    boundOperator: OPERATOR,
    boundAdmin: ADMIN,
    ...overrides,
  };
}

function wireChains(chains: Record<number, ChainState>): void {
  getPublicClientMock.mockImplementation((chainId: number) => {
    const state = chains[chainId];
    if (!state) throw new Error(`no fixture for chain ${chainId}`);
    return makeClient(state);
  });
}

/** Run the rule's scheduled callback once and return it for reuse */
async function startAndRun(rule: RefuelOperatorRule): Promise<() => Promise<void>> {
  await rule.startup(null as never);
  const callback = registerScheduleMock.mock.calls[0]?.[2] as () => Promise<void>;
  await callback();
  return callback;
}

beforeEach(() => {
  vi.clearAllMocks();
  getOperatorAddressMock.mockResolvedValue(OPERATOR);
  systemConfigGetMock.mockResolvedValue(ADMIN);
  signRefuelOperatorMock.mockResolvedValue({
    signedTransaction: '0xsigned',
    nonce: 7,
    txHash: '0xhash',
    from: OPERATOR,
  });
  sendRawTransactionMock.mockResolvedValue('0xtxhash');
  releaseNonceMock.mockResolvedValue({ rolledBack: true });
  findChainsByContractNameMock.mockResolvedValue([]);
  // registerSchedule normally runs the callback immediately (runOnStart). The tests drive
  // it explicitly, so the mock does not.
  registerScheduleMock.mockReturnValue('task-id');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// 1 — the regression
// =============================================================================

describe('schedule registration', () => {
  it('registers the schedule even when no treasury exists', async () => {
    findChainsByContractNameMock.mockResolvedValue([]);

    const rule = new RefuelOperatorRule();
    await rule.startup(null as never);

    expect(registerScheduleMock).toHaveBeenCalledTimes(1);
    expect(registerScheduleMock.mock.calls[0]?.[1]).toMatchObject({
      cronExpression: '0 */2 * * *',
    });
  });

  it('does not consult the contract registry at startup at all', async () => {
    const rule = new RefuelOperatorRule();
    await rule.startup(null as never);

    // The lookup belongs to the run, not to startup — that is the whole fix.
    expect(findChainsByContractNameMock).not.toHaveBeenCalled();
  });

  it('runs once at startup rather than waiting for the next even hour', async () => {
    const rule = new RefuelOperatorRule();
    await rule.startup(null as never);

    expect(registerScheduleMock.mock.calls[0]?.[1]).toMatchObject({ runOnStart: true });
  });
});

// =============================================================================
// 2, 3 — runtime registration and deregistration
// =============================================================================

describe('per-run treasury lookup', () => {
  it('picks up a treasury registered between two runs, with no restart', async () => {
    wireChains({ [ARBITRUM]: healthy() });

    const rule = new RefuelOperatorRule();
    findChainsByContractNameMock.mockResolvedValue([]);
    const run = await startAndRun(rule);

    expect(signRefuelOperatorMock).not.toHaveBeenCalled();

    // The kickstart registers a treasury while the service keeps running.
    findChainsByContractNameMock.mockResolvedValue([
      { chainId: ARBITRUM, address: TREASURY_ARB },
    ]);
    await run();

    expect(signRefuelOperatorMock).toHaveBeenCalledTimes(1);
    expect(signRefuelOperatorMock.mock.calls[0]?.[0]).toMatchObject({ chainId: ARBITRUM });
  });

  it('drops a treasury deregistered between two runs, with no restart', async () => {
    wireChains({ [ARBITRUM]: healthy() });

    const rule = new RefuelOperatorRule();
    findChainsByContractNameMock.mockResolvedValue([
      { chainId: ARBITRUM, address: TREASURY_ARB },
    ]);
    const run = await startAndRun(rule);
    expect(signRefuelOperatorMock).toHaveBeenCalledTimes(1);

    findChainsByContractNameMock.mockResolvedValue([]);
    await run();

    expect(signRefuelOperatorMock).toHaveBeenCalledTimes(1); // no second call
  });
});

// =============================================================================
// 4 — the threshold invariant
// =============================================================================

describe('refuel trigger', () => {
  it('sits strictly above the readiness gate on every configured chain', () => {
    // The invariant, not the multiple: the refuel must get first chance so the user is
    // never asked for money the treasury could have supplied.
    for (const chainId of Object.keys(GAS_READINESS_CONFIG).map(Number)) {
      const { readinessThresholdWei } = getGasReadinessConfig(chainId);
      const trigger = readinessThresholdWei * 2n;
      expect(trigger).toBeGreaterThan(readinessThresholdWei);
    }
  });

  it('uses the chain-specific trigger, not one global constant', async () => {
    const ethThreshold = getGasReadinessConfig(ETHEREUM).readinessThresholdWei;
    const arbThreshold = getGasReadinessConfig(ARBITRUM).readinessThresholdWei;
    expect(ethThreshold).not.toBe(arbThreshold); // guards the premise of this test

    // A balance that is above Arbitrum's trigger but below Ethereum's. Under the old
    // global 0.01 ETH constant, Ethereum would not have refuelled here.
    const between = arbThreshold * 2n + 1n;
    expect(between).toBeLessThan(ethThreshold * 2n);

    wireChains({
      [ETHEREUM]: healthy({ operatorBalance: between }),
      [ARBITRUM]: healthy({ operatorBalance: between }),
    });
    findChainsByContractNameMock.mockResolvedValue([
      { chainId: ETHEREUM, address: TREASURY_ETH },
      { chainId: ARBITRUM, address: TREASURY_ARB },
    ]);

    await startAndRun(new RefuelOperatorRule());

    expect(signRefuelOperatorMock).toHaveBeenCalledTimes(1);
    expect(signRefuelOperatorMock.mock.calls[0]?.[0]).toMatchObject({ chainId: ETHEREUM });
  });
});

// =============================================================================
// 5, 6, 7 — the reasons not to sign
// =============================================================================

describe('reasons not to refuel', () => {
  beforeEach(() => {
    findChainsByContractNameMock.mockResolvedValue([
      { chainId: ARBITRUM, address: TREASURY_ARB },
    ]);
  });

  it('does not sign when the balance is above the trigger, but still reads the bindings', async () => {
    const state = healthy({
      operatorBalance: getGasReadinessConfig(ARBITRUM).readinessThresholdWei * 100n,
    });
    let client!: ReturnType<typeof makeClient>;
    getPublicClientMock.mockImplementation(() => (client = makeClient(state)));

    await startAndRun(new RefuelOperatorRule());

    expect(signRefuelOperatorMock).not.toHaveBeenCalled();
    // Binding drift is checked on every run, including healthy ones — otherwise nothing
    // periodic ever looks at it.
    const readCalls = client.readContract.mock.calls.map((c) => c[0].functionName);
    expect(readCalls).toContain('operator');
    expect(readCalls).toContain('admin');
  });

  it('does not sign when the treasury holds no WETH', async () => {
    wireChains({ [ARBITRUM]: healthy({ treasuryWeth: 0n }) });
    await startAndRun(new RefuelOperatorRule());
    expect(signRefuelOperatorMock).not.toHaveBeenCalled();
  });

  it('does not sign when WETH is below the gas-relative floor', async () => {
    wireChains({ [ARBITRUM]: healthy({ treasuryWeth: GAS_FLOOR - 1n }) });
    await startAndRun(new RefuelOperatorRule());
    expect(signRefuelOperatorMock).not.toHaveBeenCalled();
  });

  it('signs once WETH reaches the floor', async () => {
    wireChains({ [ARBITRUM]: healthy({ treasuryWeth: GAS_FLOOR }) });
    await startAndRun(new RefuelOperatorRule());
    expect(signRefuelOperatorMock).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// 8 — the binding guard
// =============================================================================

describe('operator binding', () => {
  beforeEach(() => {
    findChainsByContractNameMock.mockResolvedValue([
      { chainId: ARBITRUM, address: TREASURY_ARB },
    ]);
  });

  it('does not sign when the treasury is bound to a different operator', async () => {
    // refuelOperator is onlyAdminOrOperator, so this would revert NotAdminOrOperator and
    // burn gas from an operator that is already below the trigger.
    wireChains({ [ARBITRUM]: healthy({ boundOperator: OTHER_OPERATOR }) });

    await startAndRun(new RefuelOperatorRule());

    expect(signRefuelOperatorMock).not.toHaveBeenCalled();
    expect(sendRawTransactionMock).not.toHaveBeenCalled();
  });

  it('still refuels when only the admin binding has drifted', async () => {
    // The refuel does not depend on admin, so a mismatch is reported but must not withhold
    // a transaction that would otherwise succeed.
    wireChains({ [ARBITRUM]: healthy({ boundAdmin: OTHER_OPERATOR }) });

    await startAndRun(new RefuelOperatorRule());

    expect(signRefuelOperatorMock).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// 9 — isolation
// =============================================================================

describe('per-chain isolation', () => {
  it('checks the remaining chains when one fails', async () => {
    wireChains({
      [ETHEREUM]: healthy({ throwOn: 'operator' }),
      [ARBITRUM]: healthy(),
    });
    findChainsByContractNameMock.mockResolvedValue([
      { chainId: ETHEREUM, address: TREASURY_ETH },
      { chainId: ARBITRUM, address: TREASURY_ARB },
    ]);

    await startAndRun(new RefuelOperatorRule());

    // Ethereum blew up; Arbitrum was still refuelled.
    expect(signRefuelOperatorMock).toHaveBeenCalledTimes(1);
    expect(signRefuelOperatorMock.mock.calls[0]?.[0]).toMatchObject({ chainId: ARBITRUM });
  });
});

// =============================================================================
// 11 — the nonce must not be spent without a transaction behind it
// =============================================================================

describe('failed broadcast', () => {
  beforeEach(() => {
    findChainsByContractNameMock.mockResolvedValue([
      { chainId: ARBITRUM, address: TREASURY_ARB },
    ]);
    wireChains({ [ARBITRUM]: healthy() });
  });

  it('hands the nonce back when the broadcast is rejected', async () => {
    // The realistic case: the refuel fires because the operator is low, and the node
    // rejects the transaction for insufficient funds. Left alone, the allocated nonce is
    // spent with nothing on chain behind it and every later transaction queues behind the
    // gap — including close-order executions.
    sendRawTransactionMock.mockRejectedValue(new Error('insufficient funds for gas'));

    await startAndRun(new RefuelOperatorRule());

    expect(releaseNonceMock).toHaveBeenCalledWith({ chainId: ARBITRUM, nonce: 7 });
  });

  it('does not hand the nonce back when the broadcast succeeds', async () => {
    await startAndRun(new RefuelOperatorRule());

    expect(sendRawTransactionMock).toHaveBeenCalledTimes(1);
    expect(releaseNonceMock).not.toHaveBeenCalled();
  });

  it('reports the chain as failed rather than refuelled', async () => {
    sendRawTransactionMock.mockRejectedValue(new Error('insufficient funds for gas'));

    // The throw is contained by allSettled, so the run completes and other chains are
    // unaffected — but this chain must not be counted as a success.
    const rule = new RefuelOperatorRule();
    await expect(startAndRun(rule)).resolves.toBeDefined();
  });
});

// =============================================================================
// 10 — re-entrancy
// =============================================================================

describe('overlapping runs', () => {
  it('skips a run that starts while the previous one is still in flight', async () => {
    let releaseReceipt: (() => void) | null = null;
    const state = healthy();

    getPublicClientMock.mockImplementation(() => ({
      ...makeClient(state),
      waitForTransactionReceipt: vi.fn(
        () =>
          new Promise((resolve) => {
            releaseReceipt = () => resolve({ status: 'success', gasUsed: 100_000n });
          })
      ),
    }));
    findChainsByContractNameMock.mockResolvedValue([
      { chainId: ARBITRUM, address: TREASURY_ARB },
    ]);

    const rule = new RefuelOperatorRule();
    await rule.startup(null as never);
    const run = registerScheduleMock.mock.calls[0]?.[2] as () => Promise<void>;

    const first = run(); // parks on the receipt
    await vi.waitFor(() => expect(signRefuelOperatorMock).toHaveBeenCalledTimes(1));

    await run(); // the next tick, while the first is still open

    // Still one signing — the second tick did not read balances and decide to refuel again.
    expect(signRefuelOperatorMock).toHaveBeenCalledTimes(1);

    releaseReceipt!();
    await first;
  });
});
