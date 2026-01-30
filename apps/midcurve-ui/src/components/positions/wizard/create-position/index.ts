// Main wizard component
export { CreatePositionWizard } from './CreatePositionWizard';

// Context
export {
  CreatePositionWizardProvider,
  useCreatePositionWizard,
  getVisibleSteps,
  type MockToken,
  type MockPool,
  type TransactionRecord,
  type CreatePositionWizardState,
  type InvestmentMode,
  type PoolSelectionTab,
} from './context/CreatePositionWizardContext';

// Steps (for direct access if needed)
export { PoolSelectionStep } from './steps/PoolSelectionStep';
export { InvestmentStep } from './steps/InvestmentStep';
export { RangeStep } from './steps/RangeStep';
export { AutomationStep } from './steps/AutomationStep';
export { SwapStep } from './steps/SwapStep';
export { ApprovalsStep } from './steps/ApprovalsStep';
export { MintStep } from './steps/MintStep';
export { AutowalletStep } from './steps/AutowalletStep';
export { RegisterOrdersStep } from './steps/RegisterOrdersStep';
export { SummaryStep } from './steps/SummaryStep';

// Shared components
export { WizardSummaryPanel } from './shared/WizardSummaryPanel';
export { StepNavigationButtons } from './shared/StepNavigationButtons';
export { PoolTable } from './shared/PoolTable';
