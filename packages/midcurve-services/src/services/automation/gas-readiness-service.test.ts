import { describe, it, expect, beforeEach, vi } from 'vitest';
import { encodeFunctionData } from 'viem';
import type { PublicClient } from 'viem';
import { MIDCURVE_TREASURY_FACTORY_ABI } from '@midcurve/shared';
import {
  GasReadinessService,
  TreasuryRegistrationRejectedError,
} from './gas-readiness-service.js';
import type { SystemConfigService } from '../system-config/system-config-service.js';
import type { SharedContractService } from './shared-contract-service.js';

// ============================================================================
// Fixtures
// ============================================================================

const ARBITRUM = 42161;
const ETHEREUM = 1;

const OPERATOR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const ADMIN = '0x14Cc912F4796Cf9A5B56D0Da3a5c9C0e2eE5ad01';
const SWAP_ROUTER = '0x5aE412a2105345f770FC6862Be7e8Fb90245C50a';
const FACTORY = '0x9A676e781A523b5d0C0e43731313A708CB607508';
const TREASURY = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
/** What the factory's predictTreasury() returns for (ADMIN, OPERATOR). */
const PREDICTED = '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199';
const WETH_ARBITRUM = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const OTHER_OPERATOR = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
const OTHER_ADMIN = '0x976EA74026E726554dB657fA54763abd0C3a0aa9';
const USER_WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

/** Arbitrum threshold is 0.005 ETH, funding amount 0.01 ETH. */
const ABOVE_THRESHOLD = 20_000_000_000_000_000n; // 0.02 ETH
const BELOW_THRESHOLD = 1_000_000_000_000_000n; // 0.001 ETH

interface Harness {
  service: GasReadinessService;
  systemConfig: { getMany: ReturnType<typeof vi.fn> };
  sharedContracts: {
    findLatestByChainAndName: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  client: {
    getBalance: ReturnType<typeof vi.fn>;
    getCode: ReturnType<typeof vi.fn>;
    readContract: ReturnType<typeof vi.fn>;
  };
}

interface HarnessOptions {
  operatorAddress?: string | null;
  adminAddress?: string | null;
  swapRouterAddress?: string | null;
  factoryAddress?: string | null;
  treasuryAddress?: string | null;
  operatorBalance?: bigint;
  walletBalance?: bigint;
  /** Operator the on-chain treasury actually pays out to */
  treasuryBoundOperator?: string;
  treasuryAdmin?: string;
  treasuryWeth?: string;
  treasurySwapRouter?: string;
  code?: string;
  /** Whether a treasury already sits at the factory's predicted address */
  deployedAtPredicted?: boolean;
  /** What factory.isTreasury() answers for a registration candidate */
  factoryAttests?: boolean;
  /** What factory.treasuriesOf(admin) returns */
  factoryTreasuriesOfAdmin?: string[];
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const {
    operatorAddress = OPERATOR,
    adminAddress = ADMIN,
    swapRouterAddress = SWAP_ROUTER,
    factoryAddress = FACTORY,
    treasuryAddress = null,
    operatorBalance = ABOVE_THRESHOLD,
    walletBalance = ABOVE_THRESHOLD,
    treasuryBoundOperator = OPERATOR,
    treasuryAdmin = ADMIN,
    treasuryWeth = WETH_ARBITRUM,
    treasurySwapRouter = SWAP_ROUTER,
    code = '0x6080604052',
    deployedAtPredicted = false,
    factoryAttests = true,
    factoryTreasuriesOfAdmin = [],
  } = options;

  const settings: Record<string, string> = {};
  if (operatorAddress) settings['operator.address'] = operatorAddress;
  if (adminAddress) settings['admin_wallet_address'] = adminAddress;

  const systemConfig = { getMany: vi.fn().mockResolvedValue(settings) };

  const sharedContracts = {
    findLatestByChainAndName: vi.fn(
      async (chainId: number, name: string) => {
        if (name === 'MidcurveSwapRouter') {
          return swapRouterAddress
            ? { config: { chainId, address: swapRouterAddress } }
            : null;
        }
        if (name === 'MidcurveTreasuryFactory') {
          return factoryAddress
            ? { config: { chainId, address: factoryAddress } }
            : null;
        }
        if (name === 'MidcurveTreasury') {
          return treasuryAddress
            ? { config: { chainId, address: treasuryAddress } }
            : null;
        }
        return null;
      },
    ),
    upsert: vi.fn().mockResolvedValue({ id: 'shared_1' }),
  };

  const client = {
    getBalance: vi.fn(async ({ address }: { address: string }) =>
      address.toLowerCase() === OPERATOR.toLowerCase()
        ? operatorBalance
        : walletBalance,
    ),
    // The predicted address is empty unless the test says a kickstart already
    // deployed there; every other address answers as a deployed contract.
    getCode: vi.fn(async ({ address }: { address: string }) =>
      address.toLowerCase() === PREDICTED.toLowerCase() && !deployedAtPredicted
        ? '0x'
        : code,
    ),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case 'operator':
          return treasuryBoundOperator;
        case 'admin':
          return treasuryAdmin;
        case 'weth':
          return treasuryWeth;
        case 'swapRouter':
          return treasurySwapRouter;
        case 'predictTreasury':
          return PREDICTED;
        case 'isTreasury':
          return factoryAttests;
        case 'treasuriesOf':
          return factoryTreasuriesOfAdmin;
        default:
          throw new Error(`unexpected read: ${functionName}`);
      }
    }),
  };

  const service = new GasReadinessService({
    systemConfigService: systemConfig as unknown as SystemConfigService,
    sharedContractService: sharedContracts as unknown as SharedContractService,
    getPublicClient: () => client as unknown as PublicClient,
  });

  return { service, systemConfig, sharedContracts, client };
}

// ============================================================================
// getReadiness
// ============================================================================

describe('GasReadinessService.getReadiness', () => {
  it('reports ready when a treasury is registered and the operator is funded', async () => {
    const { service } = makeHarness({
      treasuryAddress: TREASURY,
      operatorBalance: ABOVE_THRESHOLD,
    });

    const readiness = await service.getReadiness(ARBITRUM);

    expect(readiness.status).toBe('ready');
    expect(readiness.needsTreasuryRegistration).toBe(false);
    expect(readiness.needsOperatorFunding).toBe(false);
    expect(readiness.deployTx).toBeNull();
    expect(readiness.fundTx).toBeNull();
  });

  it('reports needs-kickstart when no treasury is registered', async () => {
    const { service } = makeHarness({ treasuryAddress: null });

    const readiness = await service.getReadiness(ARBITRUM);

    expect(readiness.status).toBe('needs-kickstart');
    expect(readiness.needsTreasuryRegistration).toBe(true);
    expect(readiness.treasury.registeredAddress).toBeNull();
    expect(readiness.deployTx).not.toBeNull();
    expect(readiness.deployTx?.to).toBe(FACTORY);
    expect(readiness.deployTx?.value).toBe('0');
    expect(readiness.deployTx?.data).toMatch(/^0x[0-9a-f]+$/i);
  });

  it('sends the deploy to the factory as createTreasury(admin, operator)', async () => {
    const { service } = makeHarness({ treasuryAddress: null });

    const readiness = await service.getReadiness(ARBITRUM);
    const data = readiness.deployTx?.data ?? '';

    // createTreasury(address,address) — selector plus two padded addresses.
    expect(data).toBe(
      encodeFunctionData({
        abi: MIDCURVE_TREASURY_FACTORY_ABI,
        functionName: 'createTreasury',
        args: [ADMIN, OPERATOR],
      }),
    );
  });

  it('reports the address the deploy will produce, so nothing reads it back from a receipt', async () => {
    const { service } = makeHarness({ treasuryAddress: null });

    const readiness = await service.getReadiness(ARBITRUM);

    expect(readiness.treasury.expectedAddress).toBe(PREDICTED);
  });

  it('reports needs-topup when the treasury is registered but the operator is short', async () => {
    const { service } = makeHarness({
      treasuryAddress: TREASURY,
      operatorBalance: BELOW_THRESHOLD,
    });

    const readiness = await service.getReadiness(ARBITRUM);

    expect(readiness.status).toBe('needs-topup');
    expect(readiness.needsTreasuryRegistration).toBe(false);
    expect(readiness.needsOperatorFunding).toBe(true);
    expect(readiness.deployTx).toBeNull();
    expect(readiness.fundTx).toEqual({
      to: OPERATOR,
      value: '10000000000000000',
    });
  });

  it('offers both a deploy and a funding transfer when the chain is empty and the operator is broke', async () => {
    const { service } = makeHarness({
      treasuryAddress: null,
      operatorBalance: 0n,
    });

    const readiness = await service.getReadiness(ARBITRUM);

    expect(readiness.status).toBe('needs-kickstart');
    expect(readiness.deployTx).not.toBeNull();
    expect(readiness.fundTx).not.toBeNull();
  });

  it('skips the funding step during kickstart when the operator is already funded', async () => {
    // The kickstart is described as three steps, but transferring to an
    // operator that can already pay is a transfer for nothing.
    const { service } = makeHarness({
      treasuryAddress: null,
      operatorBalance: ABOVE_THRESHOLD,
    });

    const readiness = await service.getReadiness(ARBITRUM);

    expect(readiness.needsTreasuryRegistration).toBe(true);
    expect(readiness.needsOperatorFunding).toBe(false);
    expect(readiness.fundTx).toBeNull();
  });

  it('applies ONE threshold to both the kickstart skip and the top-up trigger', async () => {
    // Two constants meaning "can pay" would drift, and the drift would show up
    // as a kickstart that completes below the threshold the top-up path then
    // immediately re-flags. Pin them to the same boundary from both sides.
    const threshold = 5_000_000_000_000_000n; // Arbitrum

    const kickstartAtThreshold = await makeHarness({
      treasuryAddress: null,
      operatorBalance: threshold,
    }).service.getReadiness(ARBITRUM);

    const kickstartBelow = await makeHarness({
      treasuryAddress: null,
      operatorBalance: threshold - 1n,
    }).service.getReadiness(ARBITRUM);

    const topUpAtThreshold = await makeHarness({
      treasuryAddress: TREASURY,
      operatorBalance: threshold,
    }).service.getReadiness(ARBITRUM);

    const topUpBelow = await makeHarness({
      treasuryAddress: TREASURY,
      operatorBalance: threshold - 1n,
    }).service.getReadiness(ARBITRUM);

    // Same balance, same verdict on funding, whether or not a treasury exists.
    expect(kickstartAtThreshold.needsOperatorFunding).toBe(false);
    expect(topUpAtThreshold.needsOperatorFunding).toBe(false);
    expect(kickstartBelow.needsOperatorFunding).toBe(true);
    expect(topUpBelow.needsOperatorFunding).toBe(true);

    // And the threshold reported to the caller is the one being applied.
    expect(kickstartAtThreshold.readinessThresholdWei).toBe(threshold.toString());
    expect(topUpAtThreshold.readinessThresholdWei).toBe(threshold.toString());
  });

  it('does not leave a completed kickstart below the top-up threshold', async () => {
    // The end state of a kickstart whose funding step was skipped must be
    // 'ready', not a 'needs-topup' the user is immediately shown again.
    const afterKickstart = await makeHarness({
      treasuryAddress: TREASURY, // registration completed
      operatorBalance: 5_000_000_000_000_000n, // funding was skipped at exactly the threshold
    }).service.getReadiness(ARBITRUM);

    expect(afterKickstart.status).toBe('ready');
  });

  it('treats a balance exactly at the threshold as ready', async () => {
    const { service } = makeHarness({
      treasuryAddress: TREASURY,
      operatorBalance: 5_000_000_000_000_000n, // exactly the Arbitrum threshold
    });

    expect((await service.getReadiness(ARBITRUM)).status).toBe('ready');
  });

  it('returns balances as decimal strings, never numbers', async () => {
    const { service } = makeHarness({
      treasuryAddress: TREASURY,
      operatorBalance: 123_456_789_012_345_678n,
    });

    const readiness = await service.getReadiness(ARBITRUM);

    expect(readiness.operatorBalanceWei).toBe('123456789012345678');
    expect(typeof readiness.operatorBalanceWei).toBe('string');
    expect(typeof readiness.readinessThresholdWei).toBe('string');
  });

  it('uses per-chain numbers — Ethereum is not priced like an L2', async () => {
    const { service } = makeHarness({ treasuryAddress: TREASURY });

    const arbitrum = await service.getReadiness(ARBITRUM);
    const ethereum = await service.getReadiness(ETHEREUM);

    expect(arbitrum.readinessThresholdWei).toBe('5000000000000000');
    expect(ethereum.readinessThresholdWei).toBe('50000000000000000');
  });

  describe('unavailable', () => {
    it('when no MidcurveSwapRouter is registered — a treasury cannot be constructed', async () => {
      const { service } = makeHarness({ swapRouterAddress: null });

      const readiness = await service.getReadiness(ARBITRUM);

      expect(readiness.status).toBe('unavailable');
      expect(readiness.unavailableReason).toBe('no-swap-router');
      expect(readiness.deployTx).toBeNull();
      expect(readiness.needsTreasuryRegistration).toBe(false);
    });

    it('when no MidcurveTreasuryFactory is registered — a treasury cannot be deployed', async () => {
      const { service } = makeHarness({ factoryAddress: null });

      const readiness = await service.getReadiness(ARBITRUM);

      expect(readiness.status).toBe('unavailable');
      expect(readiness.unavailableReason).toBe('no-treasury-factory');
      expect(readiness.deployTx).toBeNull();
      expect(readiness.needsTreasuryRegistration).toBe(false);
    });

    it('when the admin address was never configured', async () => {
      const { service } = makeHarness({ adminAddress: null });

      const readiness = await service.getReadiness(ARBITRUM);

      expect(readiness.status).toBe('unavailable');
      expect(readiness.unavailableReason).toBe('no-admin-address');
    });

    it('when the operator key has never been created', async () => {
      const { service } = makeHarness({ operatorAddress: null });

      const readiness = await service.getReadiness(ARBITRUM);

      expect(readiness.status).toBe('unavailable');
      expect(readiness.unavailableReason).toBe('no-operator-address');
    });

    it('when the chain has no gas readiness numbers', async () => {
      const { service } = makeHarness();

      const readiness = await service.getReadiness(999999);

      expect(readiness.status).toBe('unavailable');
      expect(readiness.unavailableReason).toBe('unsupported-chain');
    });

    it('does no chain reads at all when unavailable', async () => {
      const { service, client } = makeHarness({ swapRouterAddress: null });

      await service.getReadiness(ARBITRUM);

      expect(client.getBalance).not.toHaveBeenCalled();
    });
  });

  describe('operator binding', () => {
    it('flags a treasury bound to a different operator', async () => {
      const { service } = makeHarness({
        treasuryAddress: TREASURY,
        treasuryBoundOperator: OTHER_OPERATOR,
      });

      const readiness = await service.getReadiness(ARBITRUM);

      expect(readiness.treasury.operatorBindingMismatch).toBe(true);
      expect(readiness.treasury.boundOperator).toBe(OTHER_OPERATOR);
    });

    it('does not change the status — execution is paid by the operator EOA directly', async () => {
      const { service } = makeHarness({
        treasuryAddress: TREASURY,
        treasuryBoundOperator: OTHER_OPERATOR,
        operatorBalance: ABOVE_THRESHOLD,
      });

      expect((await service.getReadiness(ARBITRUM)).status).toBe('ready');
    });

    it('is false for a correctly bound treasury', async () => {
      const { service } = makeHarness({ treasuryAddress: TREASURY });

      const readiness = await service.getReadiness(ARBITRUM);

      expect(readiness.treasury.operatorBindingMismatch).toBe(false);
    });
  });

  describe('admin binding', () => {
    // The heavier of the two drifts: a treasury whose admin is not this
    // environment's is one nobody here can sweep, while fees keep accruing
    // into it. Until this check existed the condition was visible only to
    // somebody attempting a re-registration.
    it('flags a treasury answering to a different admin', async () => {
      const { service } = makeHarness({
        treasuryAddress: TREASURY,
        treasuryAdmin: OTHER_ADMIN,
      });

      const readiness = await service.getReadiness(ARBITRUM);

      expect(readiness.treasury.adminBindingMismatch).toBe(true);
      expect(readiness.treasury.boundAdmin).toBe(OTHER_ADMIN);
    });

    it('does not change the status — executions and fee accrual are unaffected', async () => {
      const { service } = makeHarness({
        treasuryAddress: TREASURY,
        treasuryAdmin: OTHER_ADMIN,
        operatorBalance: ABOVE_THRESHOLD,
      });

      expect((await service.getReadiness(ARBITRUM)).status).toBe('ready');
    });

    it('is false for a correctly bound treasury', async () => {
      const { service } = makeHarness({ treasuryAddress: TREASURY });

      const readiness = await service.getReadiness(ARBITRUM);

      expect(readiness.treasury.adminBindingMismatch).toBe(false);
      expect(readiness.treasury.boundAdmin).toBe(ADMIN);
    });

    it('reports both drifts independently', async () => {
      const { service } = makeHarness({
        treasuryAddress: TREASURY,
        treasuryAdmin: OTHER_ADMIN,
        treasuryBoundOperator: OTHER_OPERATOR,
      });

      const readiness = await service.getReadiness(ARBITRUM);

      expect(readiness.treasury.adminBindingMismatch).toBe(true);
      expect(readiness.treasury.operatorBindingMismatch).toBe(true);
    });
  });

  describe('deployed but unregistered', () => {
    it('offers registration alone when a treasury already sits at the expected address', async () => {
      const { service } = makeHarness({
        treasuryAddress: null,
        deployedAtPredicted: true,
      });

      const readiness = await service.getReadiness(ARBITRUM);

      expect(readiness.needsTreasuryRegistration).toBe(true);
      expect(readiness.treasury.unregisteredAddress).toBe(PREDICTED);
      expect(readiness.deployTx).toBeNull();
    });

    // The salt is keyed on the operator, so once setOperator() has run the live
    // instance no longer sits at the predicted address. Discovery has to reach
    // it anyway, or a restored database deploys a second treasury and strands
    // the first.
    it('finds the instance through the factory admin index after an operator rotation', async () => {
      const { service } = makeHarness({
        treasuryAddress: null,
        deployedAtPredicted: false,
        factoryTreasuriesOfAdmin: [TREASURY],
      });

      const readiness = await service.getReadiness(ARBITRUM);

      expect(readiness.treasury.unregisteredAddress).toBe(TREASURY);
      expect(readiness.deployTx).toBeNull();
    });

    it('ignores an indexed instance bound to a different operator', async () => {
      const { service } = makeHarness({
        treasuryAddress: null,
        deployedAtPredicted: false,
        factoryTreasuriesOfAdmin: [TREASURY],
        treasuryBoundOperator: OTHER_OPERATOR,
      });

      const readiness = await service.getReadiness(ARBITRUM);

      expect(readiness.treasury.unregisteredAddress).toBeNull();
      expect(readiness.deployTx).not.toBeNull();
    });

    it('offers a deploy when the factory has never created one for this admin', async () => {
      const { service } = makeHarness({
        treasuryAddress: null,
        factoryTreasuriesOfAdmin: [],
      });

      const readiness = await service.getReadiness(ARBITRUM);

      expect(readiness.treasury.unregisteredAddress).toBeNull();
      expect(readiness.deployTx).not.toBeNull();
    });
  });

  describe('connected wallet balance', () => {
    it('flags a wallet that cannot afford the funding amount', async () => {
      const { service } = makeHarness({
        treasuryAddress: TREASURY,
        operatorBalance: BELOW_THRESHOLD,
        walletBalance: 1_000_000_000_000_000n, // 0.001 ETH, below the 0.01 amount
      });

      const readiness = await service.getReadiness(ARBITRUM, USER_WALLET);

      expect(readiness.walletBalanceInsufficient).toBe(true);
      expect(readiness.walletBalanceWei).toBe('1000000000000000');
    });

    it('does not flag a wallet that can afford it', async () => {
      const { service } = makeHarness({
        treasuryAddress: TREASURY,
        operatorBalance: BELOW_THRESHOLD,
        walletBalance: 500_000_000_000_000_000n,
      });

      const readiness = await service.getReadiness(ARBITRUM, USER_WALLET);

      expect(readiness.walletBalanceInsufficient).toBe(false);
    });

    it('reports null and never flags when no wallet was supplied', async () => {
      const { service } = makeHarness({ treasuryAddress: TREASURY });

      const readiness = await service.getReadiness(ARBITRUM);

      expect(readiness.walletBalanceWei).toBeNull();
      expect(readiness.walletBalanceInsufficient).toBe(false);
    });
  });
});

// ============================================================================
// registerTreasury
// ============================================================================

describe('GasReadinessService.registerTreasury', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness({ treasuryAddress: null });
  });

  it('writes the shared_contracts row for a treasury matching this environment', async () => {
    const result = await harness.service.registerTreasury({
      chainId: ARBITRUM,
      address: TREASURY,
    });

    expect(result).toEqual({ chainId: ARBITRUM, address: TREASURY });
    expect(harness.sharedContracts.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sharedContractName: 'MidcurveTreasury',
        chainId: ARBITRUM,
        address: TREASURY,
        isActive: true,
      }),
    );
  });

  it('normalizes a lowercase address before storing it', async () => {
    await harness.service.registerTreasury({
      chainId: ARBITRUM,
      address: TREASURY.toLowerCase(),
    });

    expect(harness.sharedContracts.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ address: TREASURY }),
    );
  });

  it('rejects an address the factory did not create', async () => {
    const h = makeHarness({ treasuryAddress: null, factoryAttests: false });

    await expect(
      h.service.registerTreasury({ chainId: ARBITRUM, address: TREASURY }),
    ).rejects.toMatchObject({ reason: 'not-from-factory' });
    expect(h.sharedContracts.upsert).not.toHaveBeenCalled();
  });

  it('refuses to verify when no factory is registered', async () => {
    const h = makeHarness({ treasuryAddress: null, factoryAddress: null });

    await expect(
      h.service.registerTreasury({ chainId: ARBITRUM, address: TREASURY }),
    ).rejects.toThrow(/No MidcurveTreasuryFactory registered/);
  });

  // Provenance must not be re-derived from (admin, operator): setOperator() is
  // the repair for a stale operator binding, and it moves the predicted
  // address. A treasury that has been repaired is still ours, and must still be
  // registrable — otherwise the fix breaks the thing it fixed.
  it('accepts a repaired treasury whose operator no longer matches its original salt', async () => {
    const h = makeHarness({
      treasuryAddress: null,
      factoryAttests: true,
      // Not at the predicted address any more — the operator changed after deploy.
      deployedAtPredicted: false,
    });

    const result = await h.service.registerTreasury({
      chainId: ARBITRUM,
      address: TREASURY,
    });

    expect(result.address).toBe(TREASURY);
    expect(h.sharedContracts.upsert).toHaveBeenCalled();
  });

  it('rejects an address with no contract code', async () => {
    const h = makeHarness({ code: '0x' });

    await expect(
      h.service.registerTreasury({ chainId: ARBITRUM, address: TREASURY }),
    ).rejects.toThrow(TreasuryRegistrationRejectedError);
    expect(h.sharedContracts.upsert).not.toHaveBeenCalled();
  });

  it('rejects a malformed address', async () => {
    await expect(
      harness.service.registerTreasury({ chainId: ARBITRUM, address: '0xdead' }),
    ).rejects.toThrow(/valid EVM address/);
    expect(harness.sharedContracts.upsert).not.toHaveBeenCalled();
  });

  it('rejects a treasury bound to somebody else as admin', async () => {
    // The whole point of taking an address from the client: a caller must not
    // be able to register a contract they control.
    const h = makeHarness({ treasuryAdmin: OTHER_OPERATOR });

    await expect(
      h.service.registerTreasury({ chainId: ARBITRUM, address: TREASURY }),
    ).rejects.toMatchObject({ reason: 'wrong-admin' });
    expect(h.sharedContracts.upsert).not.toHaveBeenCalled();
  });

  it('rejects a treasury paying out to a different operator', async () => {
    const h = makeHarness({ treasuryBoundOperator: OTHER_OPERATOR });

    await expect(
      h.service.registerTreasury({ chainId: ARBITRUM, address: TREASURY }),
    ).rejects.toMatchObject({ reason: 'wrong-operator' });
  });

  it('rejects a treasury pointed at the wrong WETH', async () => {
    const h = makeHarness({ treasuryWeth: OTHER_OPERATOR });

    await expect(
      h.service.registerTreasury({ chainId: ARBITRUM, address: TREASURY }),
    ).rejects.toMatchObject({ reason: 'wrong-weth' });
  });

  it('rejects a treasury pointed at the wrong swap router', async () => {
    const h = makeHarness({ treasurySwapRouter: OTHER_OPERATOR });

    await expect(
      h.service.registerTreasury({ chainId: ARBITRUM, address: TREASURY }),
    ).rejects.toMatchObject({ reason: 'wrong-swap-router' });
  });

  it('is idempotent — registering the same address twice upserts the same row', async () => {
    await harness.service.registerTreasury({ chainId: ARBITRUM, address: TREASURY });
    await harness.service.registerTreasury({ chainId: ARBITRUM, address: TREASURY });

    expect(harness.sharedContracts.upsert).toHaveBeenCalledTimes(2);
    const [first, second] = harness.sharedContracts.upsert.mock.calls;
    expect(first[0]).toEqual(second[0]);
  });

  it('refuses to verify when no swap router is registered', async () => {
    const h = makeHarness({ swapRouterAddress: null });

    await expect(
      h.service.registerTreasury({ chainId: ARBITRUM, address: TREASURY }),
    ).rejects.toThrow(/No MidcurveSwapRouter registered/);
  });
});
