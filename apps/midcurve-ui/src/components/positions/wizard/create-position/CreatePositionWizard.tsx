import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FullPageWizardLayout } from '@/components/layout/wizard';
import {
  CreatePositionWizardProvider,
  useCreatePositionWizard,
} from './context/CreatePositionWizardContext';

// Steps
import { PoolSelectionStep } from './steps/PoolSelectionStep';
import { PositionConfigStep } from './steps/PositionConfigStep';
import { SwapStep } from './steps/SwapStep';
import { ApprovalsStep } from './steps/ApprovalsStep';
import { MintStep } from './steps/MintStep';
import { AutowalletStep } from './steps/AutowalletStep';
import { RegisterOrdersStep } from './steps/RegisterOrdersStep';
import { SummaryStep } from './steps/SummaryStep';

// Individual step wrapper components - each one properly handles its own hooks
function PoolStepRenderer() {
  const content = PoolSelectionStep();
  return <StepRenderer content={content} />;
}

function PositionConfigStepRenderer() {
  const content = PositionConfigStep();
  return <StepRenderer content={content} />;
}

function SwapStepRenderer() {
  const content = SwapStep();
  return <StepRenderer content={content} />;
}

function ApprovalsStepRenderer() {
  const content = ApprovalsStep();
  return <StepRenderer content={content} />;
}

function MintStepRenderer() {
  const content = MintStep();
  return <StepRenderer content={content} />;
}

function AutowalletStepRenderer() {
  const content = AutowalletStep();
  return <StepRenderer content={content} />;
}

function RegisterOrdersStepRenderer() {
  const content = RegisterOrdersStep();
  return <StepRenderer content={content} />;
}

function SummaryStepRenderer() {
  const content = SummaryStep();
  return <StepRenderer content={content} />;
}

// Helper component to render the step content into the layout
interface StepContent {
  interactive: React.ReactNode;
  visual: React.ReactNode;
  summary: React.ReactNode;
}

function StepRenderer({ content }: { content: StepContent }) {
  const navigate = useNavigate();
  const { steps, state } = useCreatePositionWizard();

  const handleClose = () => {
    navigate('/dashboard');
  };

  return (
    <FullPageWizardLayout
      title="Create Uniswap V3 Position"
      steps={steps}
      currentStep={state.currentStepIndex}
      onClose={handleClose}
      interactiveContent={content.interactive}
      visualContent={content.visual}
      summaryContent={content.summary}
      interactiveZoom={state.interactiveZoom}
      summaryZoom={state.summaryZoom}
    />
  );
}

// Main content component that conditionally renders the current step
function CreatePositionWizardContent() {
  const navigate = useNavigate();
  const { steps, state, goBack, goToStep } = useCreatePositionWizard();
  const currentStepId = steps[state.currentStepIndex]?.id;

  // Track whether we're handling a popstate event to prevent pushing duplicate history
  const isPopstateRef = useRef(false);
  // Track the previous step index to detect forward navigation
  const prevStepIndexRef = useRef(state.currentStepIndex);

  // Push history entry when navigating forward to a new step (via UI buttons)
  useEffect(() => {
    // Skip if this change was triggered by popstate (back/forward button)
    if (isPopstateRef.current) {
      isPopstateRef.current = false;
      prevStepIndexRef.current = state.currentStepIndex;
      return;
    }

    // Only push history when moving forward (not on initial mount at step 0)
    if (state.currentStepIndex > prevStepIndexRef.current) {
      window.history.pushState(
        { wizardStep: state.currentStepIndex },
        '',
        window.location.href
      );
    }

    prevStepIndexRef.current = state.currentStepIndex;
  }, [state.currentStepIndex]);

  // Listen for browser back/forward buttons (popstate)
  useEffect(() => {
    const handlePopstate = (event: PopStateEvent) => {
      const historyStep = event.state?.wizardStep;

      // Forward navigation: history has a step index we should go to
      if (typeof historyStep === 'number' && historyStep !== state.currentStepIndex) {
        isPopstateRef.current = true;
        goToStep(historyStep);
        return;
      }

      // Back navigation: no wizard state means we went back before step 1
      if (historyStep === undefined) {
        if (state.currentStepIndex > 0) {
          isPopstateRef.current = true;
          goBack();
        } else {
          // On first step with no history, exit wizard
          navigate('/dashboard', { replace: true });
        }
      }
    };

    window.addEventListener('popstate', handlePopstate);
    return () => window.removeEventListener('popstate', handlePopstate);
  }, [state.currentStepIndex, goBack, goToStep, navigate]);

  // Render only the current step component - each step is its own component
  // with its own isolated hooks
  switch (currentStepId) {
    case 'pool':
      return <PoolStepRenderer />;
    case 'configure':
      return <PositionConfigStepRenderer />;
    case 'swap':
      return <SwapStepRenderer />;
    case 'approvals':
      return <ApprovalsStepRenderer />;
    case 'mint':
      return <MintStepRenderer />;
    case 'autowallet':
      return <AutowalletStepRenderer />;
    case 'register':
      return <RegisterOrdersStepRenderer />;
    case 'summary':
      return <SummaryStepRenderer />;
    default:
      return <PoolStepRenderer />;
  }
}

export function CreatePositionWizard() {
  return (
    <CreatePositionWizardProvider>
      <CreatePositionWizardContent />
    </CreatePositionWizardProvider>
  );
}
