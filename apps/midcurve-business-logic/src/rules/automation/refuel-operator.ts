/**
 * RefuelOperatorRule
 *
 * Scheduled rule that monitors the operator wallet's ETH balance on each chain where a
 * MidcurveTreasury is registered. When the balance drops below the chain's trigger, it
 * calls refuelOperator() on the treasury to unwrap WETH → ETH → operator.
 *
 * ## Registered, scheduled, and firing are three different things
 *
 * This rule used to look up treasuries once in onStartup() and skip registerSchedule()
 * entirely when there were none — so a treasury registered at runtime, which is what the
 * gas readiness gate does, left the rule with no cron behind it until the service
 * restarted. Fee accrual picked the treasury up immediately (resolveFeeRecipient reads per
 * execution), so fees accumulated in a treasury nothing drew from, and the startup log
 * said nothing was wrong because on that boot nothing was.
 *
 * The schedule is therefore registered unconditionally and the lookup happens per run.
 * There is no cached deployment state, and no path where the rule is registered but has no
 * cron.
 *
 * ## What each run reports
 *
 * Every run emits one structured summary — see RefuelCheckSummary — because "the rule is
 * registered" and "the loop is working" are not the same claim, and only the second one is
 * worth anything. Nothing here logs success for a chain it did not actually check.
 *
 * Schedule: every 2 hours, plus once at startup.
 */

import {
  MIDCURVE_TREASURY_ABI,
  SharedContractNameEnum,
  compareAddresses,
  getChainEntry,
  getGasReadinessConfig,
  normalizeAddress,
} from '@midcurve/shared';
import { SharedContractService, SystemConfigService, getEvmConfig } from '@midcurve/services';
import type { Address } from 'viem';
import { BusinessRule } from '../base';
import { ruleLog } from '../../lib/logger';
import { getSignerClient } from '../../clients/signer-client';

// =============================================================================
// Constants
// =============================================================================

/**
 * How far above the readiness gate the refuel trigger sits.
 *
 * The gate offers the user a top-up when the operator falls below
 * `readinessThresholdWei`. The refuel should fire before that, so the treasury's own funds
 * get first chance and the user is never asked for money the environment could have
 * supplied itself. Hence a multiple rather than the gate threshold itself.
 *
 * The invariant that matters is `refuelTrigger > readinessThreshold` on every configured
 * chain, which is what the tests pin — not this number.
 */
const REFUEL_TRIGGER_MULTIPLE = 2n;

/**
 * How many times over the transaction's own cost the treasury must hold before refuelling
 * is worth doing.
 *
 * Without a floor, one wei of WETH is enough to send a full transaction that delivers one
 * wei. Expressed against gas rather than as a fixed amount so it calibrates itself across
 * L1 and L2 instead of needing another per-chain constant.
 */
const MIN_REFUEL_GAS_MULTIPLE = 10n;

/** Conservative gas limit for refuelOperator (WETH unwrap + ETH transfer) */
const REFUEL_GAS_LIMIT = 150_000n;

/** Minimal ERC-20 ABI for balanceOf */
const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

// =============================================================================
// Types
// =============================================================================

interface TreasuryDeployment {
  chainId: number;
  treasuryAddress: string;
}

/**
 * Why a chain was not refuelled on a given run.
 *
 * `operator-binding-mismatch` is the one that is not routine: the treasury pays out to an
 * address this environment does not hold the key for, so refuelOperator would revert
 * NotAdminOrOperator rather than misdirect funds — see checkAndRefuelChain.
 */
export type RefuelSkipReason =
  | 'balance-above-trigger'
  | 'treasury-empty'
  | 'below-gas-floor'
  | 'operator-binding-mismatch'
  | 'no-wrapped-native-currency';

/** Per-chain outcome, one per treasury looked at. */
export interface RefuelChainOutcome {
  chainId: number;
  treasuryAddress: string;
  /** True when the treasury's operator() matches the key this environment signs with */
  operatorBindingOk: boolean;
  /** True when the treasury's admin() matches the configured admin. Reported, never acted on. */
  adminBindingOk: boolean | null;
  refuelled: boolean;
  skipReason: RefuelSkipReason | null;
  /** Present when the chain failed outright and was not assessed */
  error: string | null;
}

/**
 * One run's result, emitted as a single structured log line.
 *
 * Deliberately shaped for a future alert rule to consume without parsing prose: counts are
 * counts, and `chains` carries the per-chain detail. This is the artifact that answers "is
 * the refuel loop working" — the individual warnings are secondary to it.
 */
export interface RefuelCheckSummary {
  treasuriesFound: number;
  chainsChecked: number;
  chainsRefuelled: number;
  chainsSkipped: number;
  chainsFailed: number;
  operatorBindingMismatches: number;
  adminBindingMismatches: number;
  chains: RefuelChainOutcome[];
}

// =============================================================================
// Rule
// =============================================================================

export class RefuelOperatorRule extends BusinessRule {
  readonly ruleName = 'refuel-operator';
  readonly ruleDescription = 'Monitors operator ETH balance and refuels from treasury WETH when low';

  private readonly sharedContractService: SharedContractService;

  /**
   * Guards against a run starting while the previous one is still in flight.
   *
   * A refuel waits on a transaction receipt with no timeout, so a stuck transaction can
   * pin a run open past the next tick. Two overlapping runs would read the same balances
   * and both decide to refuel.
   */
  private runInFlight = false;

  constructor() {
    super();
    this.sharedContractService = new SharedContractService();
  }

  protected async onStartup(): Promise<void> {
    // Registered unconditionally and on purpose. Whether any treasury exists is a question
    // for each run, not for startup — see the class comment.
    this.registerSchedule(
      '0 */2 * * *',
      'Check operator ETH balance and refuel from treasury WETH',
      () => this.executeRefuelCheck(),
      { timezone: 'UTC', runOnStart: true }
    );
  }

  protected async onShutdown(): Promise<void> {
    // Schedules are automatically cleaned up by the base class
  }

  private async executeRefuelCheck(): Promise<void> {
    if (this.runInFlight) {
      this.logger.warn({
        msg: 'Refuel check still in flight from the previous tick, skipping this run',
      });
      return;
    }
    this.runInFlight = true;

    ruleLog.eventProcessing(this.logger, this.ruleName, 'scheduled-refuel-check', 'operator-balance');
    const startTime = Date.now();

    try {
      const deployments = await this.sharedContractService.findChainsByContractName(
        SharedContractNameEnum.MIDCURVE_TREASURY
      );

      const outcomes = await this.checkAllChains(
        deployments.map((d) => ({ chainId: d.chainId, treasuryAddress: d.address }))
      );

      this.logSummary(deployments.length, outcomes);
    } finally {
      this.runInFlight = false;
    }

    const durationMs = Date.now() - startTime;
    ruleLog.eventProcessed(this.logger, this.ruleName, 'scheduled-refuel-check', 'operator-balance', durationMs);
  }

  /**
   * Check every chain, isolating failures.
   *
   * allSettled rather than a sequential loop: one chain's RPC failing must not stop the
   * others from being looked at. A run that silently examined one of three chains is the
   * same looks-fine-because-nothing-checked shape this rule exists to avoid.
   */
  private async checkAllChains(
    deployments: TreasuryDeployment[]
  ): Promise<RefuelChainOutcome[]> {
    const results = await Promise.allSettled(
      deployments.map((deployment) => this.checkAndRefuelChain(deployment))
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      const deployment = deployments[index]!;
      const error =
        result.reason instanceof Error ? result.reason.message : String(result.reason);

      this.logger.error({
        chainId: deployment.chainId,
        treasuryAddress: deployment.treasuryAddress,
        error,
        msg: 'Refuel check failed for this chain; other chains were still checked',
      });

      return {
        chainId: deployment.chainId,
        treasuryAddress: deployment.treasuryAddress,
        operatorBindingOk: false,
        adminBindingOk: null,
        refuelled: false,
        skipReason: null,
        error,
      };
    });
  }

  private async checkAndRefuelChain(
    deployment: TreasuryDeployment
  ): Promise<RefuelChainOutcome> {
    const { chainId } = deployment;
    const treasuryAddress = normalizeAddress(deployment.treasuryAddress);
    const signerClient = getSignerClient();
    const evmConfig = getEvmConfig();

    const operatorAddress = await signerClient.getOperatorAddress();
    const publicClient = evmConfig.getPublicClient(chainId);

    const outcome: RefuelChainOutcome = {
      chainId,
      treasuryAddress,
      operatorBindingOk: false,
      adminBindingOk: null,
      refuelled: false,
      skipReason: null,
      error: null,
    };

    // 1. Bindings first, and on every run rather than only when a refuel is due — this is
    //    the only periodic observer of either drift in the system. The readiness gate sees
    //    them too, but only when someone happens to be registering a close order, which
    //    for a self-hoster can be months apart.
    const [boundOperator, boundAdmin] = await Promise.all([
      publicClient.readContract({
        address: treasuryAddress as Address,
        abi: MIDCURVE_TREASURY_ABI,
        functionName: 'operator',
      }) as Promise<string>,
      publicClient.readContract({
        address: treasuryAddress as Address,
        abi: MIDCURVE_TREASURY_ABI,
        functionName: 'admin',
      }) as Promise<string>,
    ]);

    outcome.operatorBindingOk =
      compareAddresses(boundOperator, operatorAddress) === 0;
    outcome.adminBindingOk = await this.checkAdminBinding(
      chainId,
      treasuryAddress,
      boundAdmin
    );

    // A stale operator binding is not a misdirection — refuelOperator is
    // onlyAdminOrOperator, so a key that is neither reverts NotAdminOrOperator. Signing it
    // anyway would burn gas from the one address that is, by definition of getting here,
    // already low. So this blocks rather than warns.
    if (!outcome.operatorBindingOk) {
      outcome.skipReason = 'operator-binding-mismatch';
      this.logger.error({
        chainId,
        treasuryAddress,
        boundOperator: normalizeAddress(boundOperator),
        operatorAddress: normalizeAddress(operatorAddress),
        msg:
          'Treasury pays out to a different operator — refuelOperator would revert NotAdminOrOperator, so no transaction was sent. ' +
          `Repair: call setOperator(${normalizeAddress(operatorAddress)}) on the treasury as admin, from the chain's block explorer.`,
      });
      return outcome;
    }

    // 2. Operator balance against this chain's trigger
    const { readinessThresholdWei } = getGasReadinessConfig(chainId);
    const refuelTriggerWei = readinessThresholdWei * REFUEL_TRIGGER_MULTIPLE;
    const operatorBalance = await publicClient.getBalance({
      address: operatorAddress as Address,
    });

    if (operatorBalance > refuelTriggerWei) {
      outcome.skipReason = 'balance-above-trigger';
      this.logger.debug({
        chainId,
        operatorBalance: operatorBalance.toString(),
        refuelTriggerWei: refuelTriggerWei.toString(),
        msg: 'Operator balance above refuel trigger',
      });
      return outcome;
    }

    this.logger.info({
      chainId,
      operatorBalance: operatorBalance.toString(),
      refuelTriggerWei: refuelTriggerWei.toString(),
      readinessThresholdWei: readinessThresholdWei.toString(),
      msg: 'Operator balance below refuel trigger, checking treasury WETH',
    });

    // 3. WETH address from the chain registry
    const chainEntry = getChainEntry(chainId);
    if (!chainEntry.wrappedNativeCurrency) {
      outcome.skipReason = 'no-wrapped-native-currency';
      this.logger.warn({
        chainId,
        msg: 'Chain has no wrapped native currency configured, cannot refuel',
      });
      return outcome;
    }
    const wethAddress = chainEntry.wrappedNativeCurrency.address as Address;

    // 4. Treasury WETH balance, and gas price — the latter is needed to decide whether the
    //    transaction pays for itself, so it is fetched before the decision rather than after.
    const [treasuryWethBalance, gasPrice] = await Promise.all([
      publicClient.readContract({
        address: wethAddress,
        abi: ERC20_BALANCE_ABI,
        functionName: 'balanceOf',
        args: [treasuryAddress as Address],
      }),
      publicClient.getGasPrice().then((p) => (p * 120n) / 100n), // 20% buffer
    ]);

    if (treasuryWethBalance === 0n) {
      outcome.skipReason = 'treasury-empty';
      this.logger.warn({ chainId, treasuryAddress, msg: 'Treasury has no WETH to refuel with' });
      return outcome;
    }

    const estimatedGasCost = REFUEL_GAS_LIMIT * gasPrice;
    const minWorthwhileWeth = estimatedGasCost * MIN_REFUEL_GAS_MULTIPLE;

    if (treasuryWethBalance < minWorthwhileWeth) {
      outcome.skipReason = 'below-gas-floor';
      this.logger.info({
        chainId,
        treasuryAddress,
        treasuryWethBalance: treasuryWethBalance.toString(),
        minWorthwhileWeth: minWorthwhileWeth.toString(),
        estimatedGasCost: estimatedGasCost.toString(),
        msg: 'Treasury WETH below the gas-relative floor, not worth a transaction yet',
      });
      return outcome;
    }

    this.logger.info({
      chainId,
      treasuryAddress,
      treasuryWethBalance: treasuryWethBalance.toString(),
      msg: 'Treasury has WETH above the floor, initiating refuel',
    });

    // 5. Observe the nonce. This is a floor, not the value signed — the signer assigns from
    //    it, which is what keeps this from colliding with a concurrent close-order signing.
    const chainNonce = await publicClient.getTransactionCount({
      address: operatorAddress as Address,
    });

    // 6. Sign
    const signed = await signerClient.signRefuelOperator({
      chainId,
      treasuryAddress,
      tokenIn: wethAddress,
      amountIn: treasuryWethBalance.toString(),
      minEthOut: treasuryWethBalance.toString(), // 1:1 unwrap
      deadline: 0,
      hops: [], // empty — contract detects tokenIn == weth and skips swap
      gasLimit: REFUEL_GAS_LIMIT.toString(),
      gasPrice: gasPrice.toString(),
      chainNonce,
    });

    // 7. Broadcast. On failure the nonce goes back, or it leaves a gap that blocks every
    //    later transaction from this operator — close-order executions included. This is
    //    the likeliest place for that to happen, since a refuel runs precisely when the
    //    operator is low enough for a node to reject the transaction outright.
    let txHash: `0x${string}`;
    try {
      txHash = await publicClient.sendRawTransaction({
        serializedTransaction: signed.signedTransaction as `0x${string}`,
      });
    } catch (error) {
      await signerClient.releaseNonce({ chainId, nonce: signed.nonce });
      this.logger.error({
        chainId,
        nonce: signed.nonce,
        error: error instanceof Error ? error.message : String(error),
        msg: 'Refuel broadcast failed; released the nonce so it does not block later transactions',
      });
      throw error;
    }

    this.logger.info({
      chainId,
      txHash,
      nonce: signed.nonce,
      amountWei: treasuryWethBalance.toString(),
      msg: 'Refuel transaction broadcast',
    });

    // 8. Confirm
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });

    if (receipt.status === 'success') {
      outcome.refuelled = true;
      this.logger.info({
        chainId,
        txHash,
        gasUsed: receipt.gasUsed.toString(),
        msg: 'Operator refueled successfully',
      });
    } else {
      outcome.error = 'refuel transaction reverted';
      this.logger.error({
        chainId,
        txHash,
        msg: 'Refuel transaction reverted',
      });
    }

    return outcome;
  }

  /**
   * Compare the treasury's admin against the configured one.
   *
   * Reported, never acted on: the refuel path does not depend on admin, so a mismatch is
   * not a reason to withhold a transaction that would otherwise succeed. It is still worth
   * seeing — a treasury answering to an admin this environment does not control is one
   * nobody here can sweep, while fees keep accruing into it — and this job is the only
   * thing that looks periodically.
   */
  private async checkAdminBinding(
    chainId: number,
    treasuryAddress: string,
    boundAdmin: string
  ): Promise<boolean | null> {
    const adminAddress = await SystemConfigService.getInstance().get('admin_wallet_address');

    if (!adminAddress) {
      return null;
    }

    const ok = compareAddresses(boundAdmin, adminAddress) === 0;
    if (!ok) {
      this.logger.warn({
        chainId,
        treasuryAddress,
        boundAdmin: normalizeAddress(boundAdmin),
        adminAddress: normalizeAddress(adminAddress),
        msg: 'Treasury answers to a different admin — fees accrue into a contract this environment cannot sweep. Refuel is unaffected and was not withheld.',
      });
    }
    return ok;
  }

  /** Emit the run summary. One line, structured, whatever happened. */
  private logSummary(treasuriesFound: number, chains: RefuelChainOutcome[]): void {
    const summary: RefuelCheckSummary = {
      treasuriesFound,
      chainsChecked: chains.filter((c) => c.error === null).length,
      chainsRefuelled: chains.filter((c) => c.refuelled).length,
      chainsSkipped: chains.filter((c) => c.skipReason !== null).length,
      chainsFailed: chains.filter((c) => c.error !== null).length,
      operatorBindingMismatches: chains.filter(
        (c) => c.error === null && !c.operatorBindingOk
      ).length,
      adminBindingMismatches: chains.filter((c) => c.adminBindingOk === false).length,
      chains,
    };

    this.logger.info({ ...summary, msg: 'Refuel check complete' });
  }
}
