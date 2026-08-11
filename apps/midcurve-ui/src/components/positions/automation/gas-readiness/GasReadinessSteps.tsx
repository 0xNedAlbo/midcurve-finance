/**
 * Gas Readiness Steps
 *
 * The gas readiness gate: the work rows shown in the final step of a
 * close-order flow when that chain's automation cannot pay for execution.
 *
 * Renders zero, one, or three rows:
 *
 *   ready          nothing
 *   needs-topup    fund
 *   needs-kickstart deploy -> register -> fund (fund only when the operator
 *                  cannot already pay)
 *   unavailable    one short, non-actionable line
 *
 * THE REGISTRATION ROW MUST NEVER DEPEND ON THIS COMPONENT. Declining is
 * permitted: the user presses Execute on the registration row and leaves these
 * rows untouched. There is no decline button and no decline state, because
 * doing nothing already is the decline. An order registered that way sits on
 * chain looking active and fails when it triggers — accepted, deliberately,
 * and not marked anywhere.
 *
 * ---------------------------------------------------------------------------
 * ONE SHARED COMPONENT, THREE INSERTION SITES
 *
 * Close orders can be created from four places, but only three of them
 * register:
 *
 *   1. create-position wizard  -> steps/TransactionStep.tsx
 *   2. risk-triggers wizard    -> uniswapv3/steps/TransactionStep.tsx
 *   3. risk-triggers wizard    -> uniswapv3-vault/steps/TransactionStep.tsx
 *
 * The SL/TP buttons on the position card and the "Edit SL/TP Orders" link on
 * the Automation tab navigate to (2) or (3) rather than registering inline.
 *
 * That is what makes "no entry point without the gate" hold — and it is one
 * refactor away from silently false. If a button or panel is ever changed to
 * register an order directly instead of navigating, it needs this component
 * too. See the note in StopLossButton.tsx and its three siblings.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { GasReadinessData } from '@midcurve/api-shared';
import { formatCompactValue, getChainEntry } from '@midcurve/shared';
import { useEvmTransactionPrompt } from '@/components/common/EvmTransactionPrompt';
import {
  useDeployTreasury,
  useRegisterTreasury,
  useFundOperator,
} from '@/hooks/automation/useGasReadinessTransactions';
import { GasReadinessExplainer } from './GasReadinessExplainer';

export interface GasReadinessStepsProps {
  chainId: number;
  /** Readiness for this chain, or null while loading or after a failed read */
  readiness: GasReadinessData | null;
  /**
   * Whether the surrounding flow is about to register a new order.
   *
   * False for cancels and edits: an order being cancelled needs no gas, and an
   * order whose trigger price is being moved was already gated when it was
   * created.
   */
  isRegisteringNewOrder: boolean;
}

export interface GasReadinessStepsResult {
  /** The rendered rows, or null when there is nothing to show */
  element: React.ReactNode;
  /** True once every offered step has completed */
  isComplete: boolean;
}

/** Human-readable line for a chain that cannot host gas infrastructure. */
function unavailableMessage(readiness: GasReadinessData): string {
  switch (readiness.unavailableReason) {
    case 'no-swap-router':
      return 'Automated closing cannot be funded on this chain: no swap router is deployed here.';
    case 'no-admin-address':
    case 'no-operator-address':
      return 'Automated closing cannot be funded: this instance is missing its automation configuration.';
    case 'unsupported-chain':
    case 'no-wrapped-native-currency':
      return 'Automated closing cannot be funded on this chain.';
    default:
      return 'Automated closing cannot be funded on this chain.';
  }
}

export function useGasReadinessSteps({
  chainId,
  readiness,
  isRegisteringNewOrder,
}: GasReadinessStepsProps): GasReadinessStepsResult {
  const deploy = useDeployTreasury(chainId);
  const register = useRegisterTreasury(chainId);
  const fund = useFundOperator(chainId);

  // The address only exists after the deploy confirms. Held here so a failed
  // registration can be retried against the same deployment rather than
  // deploying a second treasury.
  const [deployedAddress, setDeployedAddress] = useState<string | null>(null);

  useEffect(() => {
    if (deploy.isSuccess && deploy.contractAddress && !deployedAddress) {
      setDeployedAddress(deploy.contractAddress);
    }
  }, [deploy.isSuccess, deploy.contractAddress, deployedAddress]);

  // Register as soon as the address is known. Leaving a deployed-but-
  // unregistered treasury behind is the one outcome worth chasing: the deploy
  // alone changes nothing, since the fee recipient stays the zero address.
  //
  // Depends on the primitive flags rather than the hook result, which is a
  // fresh object every render.
  const registerTreasury = register.register;
  const registerSettled =
    register.isSuccess || register.isRegistering || !!register.error;

  useEffect(() => {
    if (deployedAddress && !registerSettled) {
      registerTreasury(deployedAddress);
    }
  }, [deployedAddress, registerSettled, registerTreasury]);

  const needsDeploy = readiness?.needsTreasuryRegistration ?? false;
  const needsFunding = readiness?.needsOperatorFunding ?? false;

  const deployComplete = !needsDeploy || register.isSuccess;
  const fundComplete = !needsFunding || fund.isSuccess;

  const nativeSymbol = getChainEntry(chainId).nativeCurrency.symbol;

  const handleDeploy = useCallback(() => {
    if (deploy.error) deploy.reset();
    if (readiness?.deployTx) deploy.deploy(readiness.deployTx);
  }, [deploy, readiness]);

  const handleRetryRegister = useCallback(() => {
    register.reset();
    if (deployedAddress) register.register(deployedAddress);
  }, [register, deployedAddress]);

  const handleFund = useCallback(() => {
    if (fund.error) fund.reset();
    if (readiness?.fundTx) fund.fund(readiness.fundTx);
  }, [fund, readiness]);

  const deployPrompt = useEvmTransactionPrompt({
    label: 'Set up automated closing on this chain',
    buttonLabel: 'Set up',
    chainId,
    enabled: !!readiness?.deployTx,
    showActionButton: needsDeploy && !deploy.isSuccess,
    txHash: deploy.txHash,
    isSubmitting: deploy.isSubmitting,
    isWaitingForConfirmation: deploy.isWaitingForConfirmation,
    isSuccess: deploy.isSuccess,
    error: deploy.error,
    onExecute: handleDeploy,
    onReset: () => deploy.reset(),
  });

  const fundingAmountLabel = readiness?.fundingAmountWei
    ? `${formatCompactValue(BigInt(readiness.fundingAmountWei), 18)} ${nativeSymbol}`
    : null;

  const fundPrompt = useEvmTransactionPrompt({
    label: fundingAmountLabel
      ? `Contribute ${fundingAmountLabel} for order execution`
      : 'Contribute gas for order execution',
    buttonLabel: 'Contribute',
    chainId,
    enabled: !!readiness?.fundTx && !readiness.walletBalanceInsufficient,
    disabledReason: readiness?.walletBalanceInsufficient
      ? `Your wallet holds less than ${fundingAmountLabel ?? 'the required amount'} on this chain.`
      : undefined,
    // Sequenced behind the deploy, exactly as the surrounding steps sequence
    // approval behind registration.
    showActionButton: needsFunding && deployComplete && !fund.isSuccess,
    txHash: fund.txHash,
    isSubmitting: fund.isSubmitting,
    isWaitingForConfirmation: fund.isWaitingForConfirmation,
    isSuccess: fund.isSuccess,
    error: fund.error,
    onExecute: handleFund,
    onReset: () => fund.reset(),
  });

  // ---------------------------------------------------------------------
  // Nothing to render
  // ---------------------------------------------------------------------

  // Not registering anything new — cancels and edits need no gas gate.
  if (!isRegisteringNewOrder) {
    return { element: null, isComplete: true };
  }

  // Still loading, or the readiness read failed. Fail open: the registration
  // row is unaffected and the user can proceed.
  if (!readiness) {
    return { element: null, isComplete: true };
  }

  if (readiness.status === 'ready') {
    return { element: null, isComplete: true };
  }

  // ---------------------------------------------------------------------
  // Unavailable — one short line, no action
  // ---------------------------------------------------------------------

  // The user cannot act on this, which is not a reason to withhold it:
  // declining is a decision they make knowingly, whereas "automation can never
  // work here" would otherwise be a decision made for them without their
  // knowledge.
  if (readiness.status === 'unavailable') {
    return {
      element: (
        <div className="py-3 px-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
            <span className="text-sm text-amber-200">
              {unavailableMessage(readiness)}
            </span>
          </div>
        </div>
      ),
      isComplete: true,
    };
  }

  // ---------------------------------------------------------------------
  // Kickstart or top-up
  // ---------------------------------------------------------------------

  const registrationFailed = !!register.error && !register.isSuccess;

  return {
    element: (
      <div className="space-y-3">
        <GasReadinessExplainer
          fundingAmountWei={readiness.fundingAmountWei}
          nativeSymbol={nativeSymbol}
          isTopUpOnly={!needsDeploy}
        />

        {needsDeploy && deployPrompt.element}

        {/* The registration is an API call rather than a transaction, and it
            only becomes visible if it fails — a successful one is part of the
            deploy step as far as the user is concerned. */}
        {registrationFailed && (
          <div className="py-3 px-4 rounded-lg bg-red-500/10 border border-red-500/30">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <span className="text-sm text-red-300 truncate">
                  Deployed, but recording it failed. Retrying will not deploy a
                  second one.
                </span>
              </div>
              <button
                onClick={handleRetryRegister}
                className="flex-shrink-0 px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {needsFunding && fundPrompt.element}
      </div>
    ),
    isComplete: deployComplete && fundComplete,
  };
}
