/**
 * Gas Readiness Service
 *
 * Answers one question, per chain: can this environment's automation actually
 * pay to execute a close order here, and if not, what is missing?
 *
 * Close-order execution is paid for by a single operator EOA per environment,
 * out of its native balance on whichever chain the order lives. Nothing tops
 * that balance up automatically. Without a registered MidcurveTreasury the fee
 * recipient resolves to the zero address, so no fees accrue either, and the
 * whole accrue -> treasury -> refuel loop stays dark. An order registered
 * against such a chain sits on chain looking active and fails when it triggers.
 *
 * This service is what the close-order flows consult before registering, so
 * the user is offered the missing steps at the point they matter.
 *
 * Platform-agnostic on purpose: nothing here is UniswapV3-specific. Gas is
 * paid by the same operator on the same chains regardless of what is being
 * closed.
 */

import { encodeFunctionData } from 'viem';
import type { Address, Hex, PublicClient } from 'viem';
import {
  MIDCURVE_TREASURY_ABI,
  MIDCURVE_TREASURY_FACTORY_ABI,
  SharedContractNameEnum,
  compareAddresses,
  getChainEntry,
  getGasReadinessConfig,
  hasGasReadinessConfig,
  isSupportedChainId,
  isValidAddress,
  normalizeAddress,
} from '@midcurve/shared';
import { SystemConfigService } from '../system-config/system-config-service.js';
import { SharedContractService } from './shared-contract-service.js';
import { getEvmConfig } from '../../config/evm.js';
import { createServiceLogger, log } from '../../logging/index.js';
import type { ServiceLogger } from '../../logging/index.js';

// ============================================================================
// System config keys
// ============================================================================

const OPERATOR_ADDRESS_KEY = 'operator.address';
const ADMIN_ADDRESS_KEY = 'admin_wallet_address';

// ============================================================================
// Types
// ============================================================================

export type GasReadinessStatus =
  /** Treasury registered and operator funded — the flow is unchanged */
  | 'ready'
  /** No treasury on this chain: deploy, register, and fund */
  | 'needs-kickstart'
  /** Treasury registered, operator below the readiness threshold: fund */
  | 'needs-topup'
  /** This chain cannot host gas infrastructure at all — see unavailableReason */
  | 'unavailable';

export type GasReadinessUnavailableReason =
  /** No gas readiness numbers, or the chain is not in the registry */
  | 'unsupported-chain'
  /** The chain registry has no wrapped native currency for this chain */
  | 'no-wrapped-native-currency'
  /** system_config['operator.address'] is unset — the signer has never run */
  | 'no-operator-address'
  /** system_config['admin_wallet_address'] is unset — setup wizard incomplete */
  | 'no-admin-address'
  /** No MidcurveSwapRouter registered, so a treasury cannot be constructed */
  | 'no-swap-router'
  /** No MidcurveTreasuryFactory registered, so a treasury cannot be deployed */
  | 'no-treasury-factory';

/** A createTreasury() call on the chain's factory, sendable as-is. */
export interface TreasuryDeployTransaction {
  /** The chain's registered MidcurveTreasuryFactory */
  to: string;
  /** Encoded createTreasury(admin, operator) */
  data: Hex;
  /** Always "0" — createTreasury is not payable */
  value: string;
}

/** A plain native-value transfer the caller can send as-is. */
export interface OperatorFundingTransaction {
  to: string;
  value: string;
}

export interface GasReadinessTreasuryInfo {
  /** Address from shared_contracts, or null if none is registered */
  registeredAddress: string | null;
  /**
   * The operator address the registered treasury actually pays out to.
   *
   * Null when nothing is registered. Read live rather than assumed: a treasury
   * bound to a stale operator would refuel a dead key, which is exactly the
   * invisible failure this gate exists to prevent.
   */
  boundOperator: string | null;
  /**
   * True when a treasury is registered but pays out to an address other than
   * this environment's operator. Automation still executes — execution is paid
   * by the operator EOA directly — but the refuel loop, once it runs, would
   * send ETH somewhere useless.
   */
  operatorBindingMismatch: boolean;
  /** The admin address the registered treasury actually answers to. */
  boundAdmin: string | null;
  /**
   * True when a registered treasury answers to an admin other than this
   * environment's configured one.
   *
   * Checked on every readiness read, not only at registration, and the heavier
   * of the two drifts. A stale operator misdirects a refuel while leaving the
   * balance where the admin can still sweep it. A stale admin means nobody here
   * can empty the treasury at all, while fees keep accruing into it. Neither
   * announces itself; both are recorded and logged here because nothing else
   * asks.
   */
  adminBindingMismatch: boolean;
  /**
   * Where createTreasury() would put this environment's instance.
   *
   * Present whenever a factory is registered. This is the address the deploy
   * step registers, so nothing has to read it back out of a receipt.
   */
  expectedAddress: string | null;
  /**
   * An instance that exists on chain but has no shared_contracts row.
   *
   * Set when a kickstart deployed a treasury and never recorded it — a browser
   * that died between the two, or a database restored from before the row
   * existed. The flow then offers registration alone; there is nothing to
   * deploy, and deploying anyway would strand the first instance.
   */
  unregisteredAddress: string | null;
}

export interface GasReadiness {
  chainId: number;
  status: GasReadinessStatus;
  unavailableReason: GasReadinessUnavailableReason | null;

  /** Environment's operator EOA — the address that pays for executions */
  operatorAddress: string | null;
  /** Environment's configured admin — the treasury's admin, never the user */
  adminAddress: string | null;

  /** Operator native balance in wei, as a decimal string */
  operatorBalanceWei: string | null;
  /** Connected wallet's native balance, when one was supplied */
  walletBalanceWei: string | null;
  readinessThresholdWei: string | null;
  fundingAmountWei: string | null;

  treasury: GasReadinessTreasuryInfo;

  /** True when the flow should offer a deploy + register */
  needsTreasuryRegistration: boolean;
  /** True when the flow should offer a funding transfer */
  needsOperatorFunding: boolean;
  /**
   * True when the connected wallet holds less than the funding amount. The
   * flow disables the funding step with a reason rather than letting the
   * wallet fail at estimation.
   */
  walletBalanceInsufficient: boolean;

  /** Ready-to-send transactions, present only when the matching step applies */
  deployTx: TreasuryDeployTransaction | null;
  fundTx: OperatorFundingTransaction | null;
}

export interface RegisterTreasuryInput {
  chainId: number;
  /** Address of the deployed treasury, from the deploy transaction receipt */
  address: string;
}

export interface GasReadinessServiceDependencies {
  systemConfigService?: SystemConfigService;
  sharedContractService?: SharedContractService;
  /** Resolves a chain's public client. Injectable for tests. */
  getPublicClient?: (chainId: number) => PublicClient;
}

/**
 * Raised when a caller tries to register something that is not this
 * environment's treasury.
 */
export class TreasuryRegistrationRejectedError extends Error {
  constructor(
    message: string,
    readonly reason:
      | 'invalid-address'
      | 'no-code'
      | 'not-a-treasury'
      | 'not-from-factory'
      | 'wrong-admin'
      | 'wrong-operator'
      | 'wrong-weth'
      | 'wrong-swap-router',
  ) {
    super(message);
    this.name = 'TreasuryRegistrationRejectedError';
  }
}

// ============================================================================
// Service
// ============================================================================

export class GasReadinessService {
  private readonly systemConfigService: SystemConfigService;
  private readonly sharedContractService: SharedContractService;
  private readonly getPublicClient: (chainId: number) => PublicClient;
  private readonly logger: ServiceLogger;

  constructor(dependencies: GasReadinessServiceDependencies = {}) {
    this.systemConfigService =
      dependencies.systemConfigService ?? SystemConfigService.getInstance();
    this.sharedContractService =
      dependencies.sharedContractService ?? new SharedContractService();
    this.getPublicClient =
      dependencies.getPublicClient ??
      ((chainId: number) => getEvmConfig().getPublicClient(chainId));
    this.logger = createServiceLogger('GasReadinessService');
  }

  // ==========================================================================
  // READ
  // ==========================================================================

  /**
   * Determine whether a chain's automation can pay for close-order execution.
   *
   * @param chainId - The EVM chain the position lives on
   * @param walletAddress - Connected wallet, so the funding step can be
   *                        disabled with a reason when it cannot afford the
   *                        transfer. Optional.
   */
  async getReadiness(
    chainId: number,
    walletAddress?: string,
  ): Promise<GasReadiness> {
    log.methodEntry(this.logger, 'getReadiness', { chainId });

    if (!isSupportedChainId(chainId) || !hasGasReadinessConfig(chainId)) {
      return this.unavailable(chainId, 'unsupported-chain');
    }

    const weth = getChainEntry(chainId).wrappedNativeCurrency;
    if (!weth) {
      return this.unavailable(chainId, 'no-wrapped-native-currency');
    }

    const settings = await this.systemConfigService.getMany([
      OPERATOR_ADDRESS_KEY,
      ADMIN_ADDRESS_KEY,
    ]);
    const operatorAddress = settings[OPERATOR_ADDRESS_KEY];
    const adminAddress = settings[ADMIN_ADDRESS_KEY];

    if (!operatorAddress) {
      return this.unavailable(chainId, 'no-operator-address');
    }
    if (!adminAddress) {
      return this.unavailable(chainId, 'no-admin-address', { operatorAddress });
    }

    const swapRouter = await this.sharedContractService.findLatestByChainAndName(
      chainId,
      SharedContractNameEnum.MIDCURVE_SWAP_ROUTER,
    );
    if (!swapRouter) {
      return this.unavailable(chainId, 'no-swap-router', {
        operatorAddress,
        adminAddress,
      });
    }

    const factory = await this.sharedContractService.findLatestByChainAndName(
      chainId,
      SharedContractNameEnum.MIDCURVE_TREASURY_FACTORY,
    );
    if (!factory) {
      return this.unavailable(chainId, 'no-treasury-factory', {
        operatorAddress,
        adminAddress,
      });
    }

    const treasury = await this.sharedContractService.findLatestByChainAndName(
      chainId,
      SharedContractNameEnum.MIDCURVE_TREASURY,
    );

    const client = this.getPublicClient(chainId);
    const { readinessThresholdWei, fundingAmountWei } =
      getGasReadinessConfig(chainId);

    const operatorBalance = await client.getBalance({
      address: normalizeAddress(operatorAddress) as Address,
    });

    const walletBalance =
      walletAddress && isValidAddress(walletAddress)
        ? await client.getBalance({
            address: normalizeAddress(walletAddress) as Address,
          })
        : null;

    const treasuryInfo = await this.describeTreasury(
      chainId,
      factory.config.address,
      treasury?.config.address ?? null,
      adminAddress,
      operatorAddress,
    );

    const isRegistered = treasuryInfo.registeredAddress !== null;
    const needsOperatorFunding = operatorBalance < readinessThresholdWei;

    const status: GasReadinessStatus = !isRegistered
      ? 'needs-kickstart'
      : needsOperatorFunding
        ? 'needs-topup'
        : 'ready';

    const readiness: GasReadiness = {
      chainId,
      status,
      unavailableReason: null,
      operatorAddress: normalizeAddress(operatorAddress),
      adminAddress: normalizeAddress(adminAddress),
      operatorBalanceWei: operatorBalance.toString(),
      walletBalanceWei: walletBalance !== null ? walletBalance.toString() : null,
      readinessThresholdWei: readinessThresholdWei.toString(),
      fundingAmountWei: fundingAmountWei.toString(),
      treasury: treasuryInfo,
      needsTreasuryRegistration: !isRegistered,
      needsOperatorFunding,
      walletBalanceInsufficient:
        walletBalance !== null && walletBalance < fundingAmountWei,
      // Nothing to deploy when a treasury is already registered, and nothing to
      // deploy when an unregistered one was found on chain either — that one
      // needs recording, not replacing.
      deployTx:
        isRegistered || treasuryInfo.unregisteredAddress
          ? null
          : {
              to: normalizeAddress(factory.config.address),
              data: encodeFunctionData({
                abi: MIDCURVE_TREASURY_FACTORY_ABI,
                functionName: 'createTreasury',
                args: [
                  normalizeAddress(adminAddress) as Address,
                  normalizeAddress(operatorAddress) as Address,
                ],
              }),
              value: '0',
            },
      fundTx: needsOperatorFunding
        ? {
            to: normalizeAddress(operatorAddress),
            value: fundingAmountWei.toString(),
          }
        : null,
    };

    log.methodExit(this.logger, 'getReadiness', {
      chainId,
      status,
      needsTreasuryRegistration: readiness.needsTreasuryRegistration,
      needsOperatorFunding,
    });

    return readiness;
  }

  // ==========================================================================
  // WRITE
  // ==========================================================================

  /**
   * Register a freshly deployed treasury in the shared contract registry.
   *
   * The address comes from the caller, so everything that makes it *this
   * environment's* treasury is verified on chain before the row is written: the
   * chain's factory must attest that it created the address, and its admin,
   * operator, WETH and swap router must match what this environment would have
   * deployed. A caller cannot register an address of their choosing.
   *
   * Provenance is `factory.isTreasury()` rather than re-deriving the address
   * from (admin, operator). Those two are not interchangeable. The salt is
   * keyed on the operator, so the derived address moves the moment
   * `setOperator()` is called — and that call is the repair for a stale
   * operator binding. A check built on re-derivation would reject every
   * repaired treasury, permanently, and would do it to exactly the instances
   * that had needed fixing.
   *
   * Idempotent: registering the same address twice updates the same row.
   */
  async registerTreasury(
    input: RegisterTreasuryInput,
  ): Promise<{ chainId: number; address: string }> {
    const { chainId } = input;
    log.methodEntry(this.logger, 'registerTreasury', { chainId });

    if (!isValidAddress(input.address)) {
      throw new TreasuryRegistrationRejectedError(
        `Not a valid EVM address: ${input.address}`,
        'invalid-address',
      );
    }
    const address = normalizeAddress(input.address);

    const expected = await this.expectedTreasuryParameters(chainId);
    const client = this.getPublicClient(chainId);

    const code = await client.getCode({ address: address as Address });
    if (!code || code === '0x') {
      throw new TreasuryRegistrationRejectedError(
        `No contract code at ${address} on chain ${chainId}`,
        'no-code',
      );
    }

    const factoryAddress = await this.requireFactoryAddress(chainId);
    const attested = (await client.readContract({
      address: factoryAddress as Address,
      abi: MIDCURVE_TREASURY_FACTORY_ABI,
      functionName: 'isTreasury',
      args: [address as Address],
    })) as boolean;

    if (!attested) {
      throw new TreasuryRegistrationRejectedError(
        `MidcurveTreasuryFactory at ${factoryAddress} did not create ${address} on chain ${chainId}`,
        'not-from-factory',
      );
    }

    const onChain = await this.readTreasuryParameters(chainId, address);
    if (!onChain) {
      throw new TreasuryRegistrationRejectedError(
        `Contract at ${address} on chain ${chainId} does not answer the MidcurveTreasury interface`,
        'not-a-treasury',
      );
    }

    this.assertMatches(onChain.admin, expected.admin, 'wrong-admin', address);
    this.assertMatches(
      onChain.operator,
      expected.operator,
      'wrong-operator',
      address,
    );
    this.assertMatches(onChain.weth, expected.weth, 'wrong-weth', address);
    this.assertMatches(
      onChain.swapRouter,
      expected.swapRouter,
      'wrong-swap-router',
      address,
    );

    await this.sharedContractService.upsert({
      sharedContractType: 'evm-smart-contract',
      sharedContractName: SharedContractNameEnum.MIDCURVE_TREASURY,
      interfaceVersionMajor: 1,
      interfaceVersionMinor: 0,
      chainId,
      address,
      isActive: true,
    });

    this.logger.info(
      { chainId, address },
      'MidcurveTreasury registered — executions on this chain now accrue fees',
    );

    log.methodExit(this.logger, 'registerTreasury', { chainId, address });
    return { chainId, address };
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * The four constructor values this environment would deploy a treasury with.
   *
   * Shared by the deploy transaction and the registration check, so the two can
   * never disagree about what a valid treasury looks like.
   */
  private async expectedTreasuryParameters(chainId: number): Promise<{
    admin: string;
    operator: string;
    weth: string;
    swapRouter: string;
  }> {
    const weth = getChainEntry(chainId).wrappedNativeCurrency;
    if (!weth) {
      throw new Error(
        `Chain ${chainId} has no wrapped native currency configured`,
      );
    }

    const settings = await this.systemConfigService.getMany([
      OPERATOR_ADDRESS_KEY,
      ADMIN_ADDRESS_KEY,
    ]);
    const operator = settings[OPERATOR_ADDRESS_KEY];
    const admin = settings[ADMIN_ADDRESS_KEY];

    if (!operator) {
      throw new Error(
        `system_config['${OPERATOR_ADDRESS_KEY}'] is unset — cannot verify a treasury`,
      );
    }
    if (!admin) {
      throw new Error(
        `system_config['${ADMIN_ADDRESS_KEY}'] is unset — cannot verify a treasury`,
      );
    }

    const swapRouter = await this.sharedContractService.findLatestByChainAndName(
      chainId,
      SharedContractNameEnum.MIDCURVE_SWAP_ROUTER,
    );
    if (!swapRouter) {
      throw new Error(
        `No MidcurveSwapRouter registered on chain ${chainId} — cannot verify a treasury`,
      );
    }

    return {
      admin: normalizeAddress(admin),
      operator: normalizeAddress(operator),
      weth: normalizeAddress(weth.address),
      swapRouter: normalizeAddress(swapRouter.config.address),
    };
  }

  /** Read admin/operator/weth/swapRouter off a candidate treasury. */
  private async readTreasuryParameters(
    chainId: number,
    address: string,
  ): Promise<{
    admin: string;
    operator: string;
    weth: string;
    swapRouter: string;
  } | null> {
    const client = this.getPublicClient(chainId);
    const target = { address: address as Address, abi: MIDCURVE_TREASURY_ABI };

    const [admin, operator, weth, swapRouter] = await Promise.all([
      client.readContract({ ...target, functionName: 'admin' }),
      client.readContract({ ...target, functionName: 'operator' }),
      client.readContract({ ...target, functionName: 'weth' }),
      client.readContract({ ...target, functionName: 'swapRouter' }),
    ]);

    return {
      admin: normalizeAddress(admin as string),
      operator: normalizeAddress(operator as string),
      weth: normalizeAddress(weth as string),
      swapRouter: normalizeAddress(swapRouter as string),
    };
  }

  private assertMatches(
    actual: string,
    expected: string,
    reason: TreasuryRegistrationRejectedError['reason'],
    address: string,
  ): void {
    if (compareAddresses(actual, expected) !== 0) {
      throw new TreasuryRegistrationRejectedError(
        `Treasury at ${address} has ${reason.replace('wrong-', '')} ${actual}, expected ${expected}`,
        reason,
      );
    }
  }

  /**
   * Describe the treasury situation on a chain: which one is registered, who it
   * answers to, and — when none is registered — whether one exists anyway.
   *
   * Both bindings are compared on every read, not only at registration. Neither
   * drift announces itself, and the flows that would notice run rarely:
   *
   * - A stale *operator* means accrued fees would refuel an address nobody
   *   signs with. Executions still run, and the balance stays where the admin
   *   can sweep it.
   * - A stale *admin* means nobody in this environment can empty the treasury
   *   at all, while fees keep accruing into it. Heavier, and until now visible
   *   only to someone attempting a re-registration.
   *
   * Both are recorded and logged, and deliberately not surfaced to the user,
   * who has no action available for either.
   */
  private async describeTreasury(
    chainId: number,
    factoryAddress: string,
    registeredAddress: string | null,
    adminAddress: string,
    operatorAddress: string,
  ): Promise<GasReadinessTreasuryInfo> {
    const expectedAddress = await this.predictTreasuryAddress(
      chainId,
      factoryAddress,
      adminAddress,
      operatorAddress,
    );

    if (!registeredAddress) {
      const unregisteredAddress = await this.findUnregisteredTreasury(
        chainId,
        factoryAddress,
        expectedAddress,
        adminAddress,
        operatorAddress,
      );

      return {
        registeredAddress: null,
        boundOperator: null,
        operatorBindingMismatch: false,
        boundAdmin: null,
        adminBindingMismatch: false,
        expectedAddress,
        unregisteredAddress,
      };
    }

    const address = normalizeAddress(registeredAddress);
    const bound = await this.readTreasuryParameters(chainId, address);
    if (!bound) {
      throw new Error(
        `Registered treasury at ${address} on chain ${chainId} does not answer the MidcurveTreasury interface`,
      );
    }

    const operatorBindingMismatch =
      compareAddresses(bound.operator, operatorAddress) !== 0;
    const adminBindingMismatch =
      compareAddresses(bound.admin, adminAddress) !== 0;

    if (operatorBindingMismatch) {
      this.logger.warn(
        {
          chainId,
          treasuryAddress: address,
          boundOperator: bound.operator,
          operatorAddress,
        },
        'Registered treasury pays out to a different operator — refuel would fund an address this environment does not sign with',
      );
    }

    if (adminBindingMismatch) {
      this.logger.warn(
        {
          chainId,
          treasuryAddress: address,
          boundAdmin: bound.admin,
          adminAddress,
        },
        'Registered treasury answers to a different admin — fees accrue into a contract this environment cannot sweep',
      );
    }

    return {
      registeredAddress: address,
      boundOperator: bound.operator,
      operatorBindingMismatch,
      boundAdmin: bound.admin,
      adminBindingMismatch,
      expectedAddress,
      unregisteredAddress: null,
    };
  }

  /** Where the chain's factory would place this environment's instance. */
  private async predictTreasuryAddress(
    chainId: number,
    factoryAddress: string,
    adminAddress: string,
    operatorAddress: string,
  ): Promise<string> {
    const predicted = (await this.getPublicClient(chainId).readContract({
      address: normalizeAddress(factoryAddress) as Address,
      abi: MIDCURVE_TREASURY_FACTORY_ABI,
      functionName: 'predictTreasury',
      args: [
        normalizeAddress(adminAddress) as Address,
        normalizeAddress(operatorAddress) as Address,
      ],
    })) as string;

    return normalizeAddress(predicted);
  }

  /**
   * Find a treasury that exists on chain but was never recorded.
   *
   * Two sources, because the cheap one is not sufficient:
   *
   * 1. The predicted address. Covers the common case — a kickstart whose
   *    browser died between the deploy confirming and the registration call.
   * 2. `factory.treasuriesOf(admin)`. Covers the case the prediction cannot:
   *    the salt is keyed on the operator, so once `setOperator()` has been
   *    called the live instance no longer sits at the predicted address. Were
   *    discovery to stop at step 1, a restored database would deploy a second
   *    treasury and strand the first — in precisely the recovery scenario this
   *    exists to serve.
   */
  private async findUnregisteredTreasury(
    chainId: number,
    factoryAddress: string,
    expectedAddress: string,
    adminAddress: string,
    operatorAddress: string,
  ): Promise<string | null> {
    const client = this.getPublicClient(chainId);

    const codeAtExpected = await client.getCode({
      address: expectedAddress as Address,
    });
    if (codeAtExpected && codeAtExpected !== '0x') {
      this.logger.info(
        { chainId, treasuryAddress: expectedAddress },
        'Found a deployed but unregistered treasury at the expected address',
      );
      return expectedAddress;
    }

    const candidates = (await client.readContract({
      address: normalizeAddress(factoryAddress) as Address,
      abi: MIDCURVE_TREASURY_FACTORY_ABI,
      functionName: 'treasuriesOf',
      args: [normalizeAddress(adminAddress) as Address],
    })) as readonly string[];

    for (const candidate of candidates) {
      const address = normalizeAddress(candidate);
      const bound = await this.readTreasuryParameters(chainId, address);
      if (bound && compareAddresses(bound.operator, operatorAddress) === 0) {
        this.logger.info(
          { chainId, treasuryAddress: address, expectedAddress },
          'Found a deployed but unregistered treasury via the factory admin index — its operator has changed since it was deployed',
        );
        return address;
      }
    }

    return null;
  }

  /** The chain's registered factory address, or a throw naming what is missing. */
  private async requireFactoryAddress(chainId: number): Promise<string> {
    const factory = await this.sharedContractService.findLatestByChainAndName(
      chainId,
      SharedContractNameEnum.MIDCURVE_TREASURY_FACTORY,
    );
    if (!factory) {
      throw new Error(
        `No MidcurveTreasuryFactory registered on chain ${chainId} — cannot verify a treasury`,
      );
    }
    return normalizeAddress(factory.config.address);
  }

  private unavailable(
    chainId: number,
    reason: GasReadinessUnavailableReason,
    known: { operatorAddress?: string; adminAddress?: string } = {},
  ): GasReadiness {
    this.logger.debug(
      { chainId, reason },
      'Chain cannot host gas infrastructure',
    );

    return {
      chainId,
      status: 'unavailable',
      unavailableReason: reason,
      operatorAddress: known.operatorAddress
        ? normalizeAddress(known.operatorAddress)
        : null,
      adminAddress: known.adminAddress
        ? normalizeAddress(known.adminAddress)
        : null,
      operatorBalanceWei: null,
      walletBalanceWei: null,
      readinessThresholdWei: null,
      fundingAmountWei: null,
      treasury: {
        registeredAddress: null,
        boundOperator: null,
        operatorBindingMismatch: false,
        boundAdmin: null,
        adminBindingMismatch: false,
        expectedAddress: null,
        unregisteredAddress: null,
      },
      needsTreasuryRegistration: false,
      needsOperatorFunding: false,
      walletBalanceInsufficient: false,
      deployTx: null,
      fundTx: null,
    };
  }
}
