/**
 * RefuelOperatorRule
 *
 * Scheduled rule that monitors the operator wallet's ETH balance on each chain
 * where a MidcurveTreasury is deployed. When the balance drops below a threshold,
 * it calls refuelOperator() on the treasury to unwrap WETH → ETH → operator.
 *
 * Precondition check on startup: only activates if at least one MidcurveTreasury
 * exists in the shared_contracts table.
 *
 * Schedule: Every 2 hours
 */

import { getChainEntry, type SharedContractName } from '@midcurve/shared';
import { SharedContractService, getEvmConfig } from '@midcurve/services';
import type { Address } from 'viem';
import { BusinessRule } from '../base';
import { ruleLog } from '../../lib/logger';
import { getSignerClient } from '../../clients/signer-client';

// =============================================================================
// Constants
// =============================================================================

/** Operator ETH balance below which to trigger refuel (0.01 ETH) */
const REFUEL_THRESHOLD_WEI = 10_000_000_000_000_000n; // 0.01 ETH

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

// =============================================================================
// Rule
// =============================================================================

export class RefuelOperatorRule extends BusinessRule {
  readonly ruleName = 'refuel-operator';
  readonly ruleDescription = 'Monitors operator ETH balance and refuels from treasury WETH when low';

  private treasuryDeployments: TreasuryDeployment[] = [];
  private readonly sharedContractService: SharedContractService;

  constructor() {
    super();
    this.sharedContractService = new SharedContractService();
  }

  protected async onStartup(): Promise<void> {
    // One-time precondition check: find all chains with a MidcurveTreasury
    const deployments = await this.sharedContractService.findChainsByContractName(
      'MidcurveTreasury' as SharedContractName
    );

    if (deployments.length === 0) {
      this.logger.info({ msg: 'No MidcurveTreasury deployed on any chain, skipping schedule registration' });
      return;
    }

    this.treasuryDeployments = deployments.map((d) => ({
      chainId: d.chainId,
      treasuryAddress: d.address,
    }));

    this.logger.info({
      chains: this.treasuryDeployments.map((d) => d.chainId),
      msg: `Found MidcurveTreasury on ${this.treasuryDeployments.length} chain(s), registering refuel schedule`,
    });

    this.registerSchedule(
      '0 */2 * * *',
      'Check operator ETH balance and refuel from treasury WETH',
      () => this.executeRefuelCheck(),
      { timezone: 'UTC' }
    );
  }

  protected async onShutdown(): Promise<void> {
    // Schedules are automatically cleaned up by the base class
  }

  private async executeRefuelCheck(): Promise<void> {
    ruleLog.eventProcessing(this.logger, this.ruleName, 'scheduled-refuel-check', 'operator-balance');
    const startTime = Date.now();

    for (const deployment of this.treasuryDeployments) {
      await this.checkAndRefuelChain(deployment);
    }

    const durationMs = Date.now() - startTime;
    ruleLog.eventProcessed(this.logger, this.ruleName, 'scheduled-refuel-check', 'operator-balance', durationMs);
  }

  private async checkAndRefuelChain(deployment: TreasuryDeployment): Promise<void> {
    const { chainId, treasuryAddress } = deployment;
    const signerClient = getSignerClient();
    const evmConfig = getEvmConfig();

    const operatorAddress = await signerClient.getOperatorAddress();
    const publicClient = evmConfig.getPublicClient(chainId);

    // 1. Check operator ETH balance
    const operatorBalance = await publicClient.getBalance({ address: operatorAddress as Address });

    if (operatorBalance > REFUEL_THRESHOLD_WEI) {
      this.logger.debug({
        chainId,
        operatorBalance: operatorBalance.toString(),
        threshold: REFUEL_THRESHOLD_WEI.toString(),
        msg: 'Operator balance above threshold, skipping refuel',
      });
      return;
    }

    this.logger.info({
      chainId,
      operatorBalance: operatorBalance.toString(),
      threshold: REFUEL_THRESHOLD_WEI.toString(),
      msg: 'Operator balance below threshold, checking treasury WETH',
    });

    // 2. Get WETH address from chain registry
    const chainEntry = getChainEntry(chainId);
    if (!chainEntry.wrappedNativeCurrency) {
      this.logger.warn({ chainId, msg: 'Chain has no wrapped native currency configured, cannot refuel' });
      return;
    }
    const wethAddress = chainEntry.wrappedNativeCurrency.address as Address;

    // 3. Check treasury WETH balance
    const treasuryWethBalance = await publicClient.readContract({
      address: wethAddress,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [treasuryAddress as Address],
    });

    if (treasuryWethBalance === 0n) {
      this.logger.warn({ chainId, treasuryAddress, msg: 'Treasury has no WETH to refuel with' });
      return;
    }

    this.logger.info({
      chainId,
      treasuryAddress,
      treasuryWethBalance: treasuryWethBalance.toString(),
      msg: 'Treasury has WETH, initiating refuel',
    });

    // 4. Estimate gas and fetch nonce
    const gasPrice = await publicClient.getGasPrice().then((p) => (p * 120n) / 100n); // 20% buffer
    const nonce = await publicClient.getTransactionCount({ address: operatorAddress as Address });

    // Use a conservative gas limit for refuelOperator (WETH unwrap + ETH transfer)
    const gasLimit = 150_000n;

    // 5. Sign the refuelOperator transaction
    const signed = await signerClient.signRefuelOperator({
      chainId,
      treasuryAddress,
      tokenIn: wethAddress,
      amountIn: treasuryWethBalance.toString(),
      minEthOut: treasuryWethBalance.toString(), // 1:1 unwrap
      deadline: 0,
      hops: [], // empty — contract detects tokenIn == weth and skips swap
      gasLimit: gasLimit.toString(),
      gasPrice: gasPrice.toString(),
      nonce,
    });

    // 6. Broadcast
    const txHash = await publicClient.sendRawTransaction({
      serializedTransaction: signed.signedTransaction as `0x${string}`,
    });

    this.logger.info({
      chainId,
      txHash,
      amountWei: treasuryWethBalance.toString(),
      msg: 'Refuel transaction broadcast',
    });

    // 7. Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1 });

    if (receipt.status === 'success') {
      this.logger.info({
        chainId,
        txHash,
        gasUsed: receipt.gasUsed.toString(),
        msg: 'Operator refueled successfully',
      });
    } else {
      this.logger.error({
        chainId,
        txHash,
        msg: 'Refuel transaction reverted',
      });
    }
  }
}
