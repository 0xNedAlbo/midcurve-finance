/**
 * Close Order Processing Step
 *
 * Step 3: Show progress while order is being created
 * Handles multi-step flow: Deploy → Approve → Register
 */

import { Loader2, CheckCircle, Circle } from 'lucide-react';

interface CloseOrderProcessingStepProps {
  // Deployment state
  needsDeploy: boolean;
  isFetchingBytecode: boolean;
  isDeploying: boolean;
  isWaitingForDeployConfirmation: boolean;
  deployComplete: boolean;

  // Approval state
  needsApproval: boolean;
  isApproving: boolean;
  isWaitingForApprovalConfirmation: boolean;
  approvalComplete: boolean;

  // Registration state
  isRegistering: boolean;
  isWaitingForConfirmation: boolean;
}

type StepState = 'pending' | 'active' | 'complete';

interface ProcessingStepItemProps {
  state: StepState;
  label: string;
}

function ProcessingStepItem({ state, label }: ProcessingStepItemProps) {
  return (
    <div className="flex items-center gap-3 text-sm">
      {state === 'complete' ? (
        <CheckCircle className="w-4 h-4 text-green-400" />
      ) : state === 'active' ? (
        <div className="w-4 h-4 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
      ) : (
        <Circle className="w-4 h-4 text-slate-600" />
      )}
      <span
        className={
          state === 'complete'
            ? 'text-green-400'
            : state === 'active'
              ? 'text-slate-300'
              : 'text-slate-500'
        }
      >
        {label}
      </span>
    </div>
  );
}

export function CloseOrderProcessingStep({
  // Deploy
  needsDeploy,
  isFetchingBytecode,
  isDeploying,
  isWaitingForDeployConfirmation,
  deployComplete,
  // Approval
  needsApproval,
  isApproving,
  isWaitingForApprovalConfirmation,
  approvalComplete,
  // Register
  isRegistering,
  isWaitingForConfirmation,
}: CloseOrderProcessingStepProps) {
  // Determine current phase for title/subtitle
  const getCurrentPhase = (): { title: string; subtitle: string } => {
    // Deploy phase
    if (needsDeploy && !deployComplete) {
      if (isFetchingBytecode) {
        return {
          title: 'Preparing Contract Deployment',
          subtitle: 'Fetching contract bytecode...',
        };
      }
      if (isDeploying) {
        return {
          title: 'Deploy Automation Contract',
          subtitle: 'Please sign the deployment transaction in your wallet...',
        };
      }
      if (isWaitingForDeployConfirmation) {
        return {
          title: 'Deploying Contract',
          subtitle: 'Waiting for on-chain confirmation...',
        };
      }
    }

    // Approval phase
    if (needsApproval && !approvalComplete) {
      if (isApproving) {
        return {
          title: 'Approve Operator',
          subtitle: 'Please sign the approval transaction in your wallet...',
        };
      }
      if (isWaitingForApprovalConfirmation) {
        return {
          title: 'Setting Operator Approval',
          subtitle: 'Waiting for on-chain confirmation...',
        };
      }
    }

    // Registration phase
    if (isRegistering && !isWaitingForConfirmation) {
      return {
        title: 'Register Close Order',
        subtitle: 'Please sign the transaction in your wallet...',
      };
    }
    if (isWaitingForConfirmation) {
      return {
        title: 'Confirming Registration',
        subtitle: 'Waiting for on-chain confirmation...',
      };
    }

    // Default
    return {
      title: 'Creating Your Order',
      subtitle: 'Please wait while we set up your close order...',
    };
  };

  // Calculate step states
  const getDeployStepState = (): StepState => {
    if (deployComplete) return 'complete';
    if (isFetchingBytecode || isDeploying || isWaitingForDeployConfirmation) return 'active';
    return 'pending';
  };

  const getApprovalStepState = (): StepState => {
    if (approvalComplete) return 'complete';
    if (deployComplete && (isApproving || isWaitingForApprovalConfirmation)) return 'active';
    return 'pending';
  };

  const getRegisterStepState = (): StepState => {
    if (isWaitingForConfirmation && !isRegistering) return 'complete';
    if (
      (needsDeploy ? deployComplete : true) &&
      (needsApproval ? approvalComplete : true) &&
      (isRegistering || isWaitingForConfirmation)
    ) {
      return 'active';
    }
    return 'pending';
  };

  const { title, subtitle } = getCurrentPhase();

  return (
    <div className="py-12 text-center">
      <div className="flex justify-center mb-6">
        <div className="relative">
          <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
          </div>
          <div className="absolute inset-0 w-16 h-16 rounded-full border-2 border-blue-500/20 animate-ping" />
        </div>
      </div>

      <h3 className="text-lg font-semibold text-slate-200 mb-2">{title}</h3>
      <p className="text-sm text-slate-400">{subtitle}</p>

      <div className="mt-6 space-y-2 max-w-xs mx-auto">
        {/* Deploy step - only shown if needed */}
        {needsDeploy && (
          <ProcessingStepItem state={getDeployStepState()} label="Deploy automation contract" />
        )}

        {/* Approval step - only shown if needed */}
        {needsApproval && (
          <ProcessingStepItem state={getApprovalStepState()} label="Approve operator permissions" />
        )}

        {/* Register step - always shown */}
        <ProcessingStepItem state={getRegisterStepState()} label="Register close order" />

        {/* Confirmation step */}
        <ProcessingStepItem
          state={isWaitingForConfirmation ? 'active' : 'pending'}
          label="Wait for confirmation"
        />

        {/* Order activated - final step */}
        <ProcessingStepItem state="pending" label="Order activated" />
      </div>
    </div>
  );
}
