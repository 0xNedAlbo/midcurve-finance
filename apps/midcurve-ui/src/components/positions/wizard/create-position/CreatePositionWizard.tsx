import { useNavigate } from 'react-router-dom';
import { FullPageWizardLayout } from '@/components/layout/wizard';
import {
  CreatePositionWizardProvider,
  useCreatePositionWizard,
} from './context/CreatePositionWizardContext';

// Steps
import { PoolSelectionStep } from './steps/PoolSelectionStep';
import { CapitalAllocationStep } from './steps/CapitalAllocationStep';
import { RangeStep } from './steps/RangeStep';
import { AutomationStep } from './steps/AutomationStep';
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

function CapitalAllocationStepRenderer() {
  const content = CapitalAllocationStep();
  return <StepRenderer content={content} />;
}

function RangeStepRenderer() {
  const content = RangeStep();
  return <StepRenderer content={content} />;
}

function AutomationStepRenderer() {
  const content = AutomationStep();
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
    />
  );
}

// Main content component that conditionally renders the current step
function CreatePositionWizardContent() {
  const { steps, state } = useCreatePositionWizard();
  const currentStepId = steps[state.currentStepIndex]?.id;

  // Render only the current step component - each step is its own component
  // with its own isolated hooks
  switch (currentStepId) {
    case 'pool':
      return <PoolStepRenderer />;
    case 'investment':
      return <CapitalAllocationStepRenderer />;
    case 'range':
      return <RangeStepRenderer />;
    case 'automation':
      return <AutomationStepRenderer />;
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
