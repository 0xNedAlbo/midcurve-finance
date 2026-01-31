import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  type ReactNode,
} from 'react';
import type { PoolSearchResultItem, PoolSearchTokenInfo } from '@midcurve/api-shared';
import type { WizardStep } from '@/components/layout/wizard';

// ----- Types -----

export type InvestmentMode = 'tokenA' | 'tokenB' | 'matched' | 'independent';
export type PoolSelectionTab = 'favorites' | 'search' | 'direct';

export interface TransactionRecord {
  hash: string;
  type: 'approval' | 'mint' | 'autowallet' | 'register-sl' | 'register-tp';
  label: string;
  status: 'pending' | 'confirming' | 'confirmed' | 'failed';
}

export interface CreatePositionWizardState {
  // Current step
  currentStepIndex: number;

  // Pool Selection (Step A)
  poolSelectionTab: PoolSelectionTab;
  selectedPool: PoolSearchResultItem | null;
  baseToken: PoolSearchTokenInfo | null;
  quoteToken: PoolSearchTokenInfo | null;

  // Investment (Step B)
  investmentMode: InvestmentMode;
  tokenAAmount: string;
  tokenBAmount: string;
  tokenAIsMax: boolean;
  tokenBIsMax: boolean;

  // Range (Step C)
  tickLower: number;
  tickUpper: number;
  liquidity: string;

  // Automation (Step D)
  automationEnabled: boolean;
  stopLossEnabled: boolean;
  stopLossTick: number | null;
  takeProfitEnabled: boolean;
  takeProfitTick: number | null;

  // Conditional step flags
  needsSwap: boolean;
  needsAutowallet: boolean;

  // Transactions (Steps F-I)
  transactions: TransactionRecord[];
  positionId: string | null;
  nftId: string | null;

  // Validation
  stepValidation: Record<string, boolean>;
}

// ----- Actions -----

type WizardAction =
  | { type: 'GO_TO_STEP'; stepIndex: number }
  | { type: 'GO_NEXT' }
  | { type: 'GO_BACK' }
  | { type: 'SET_POOL_TAB'; tab: PoolSelectionTab }
  | { type: 'SELECT_POOL'; pool: PoolSearchResultItem }
  | { type: 'CLEAR_POOL' }
  | { type: 'SET_INVESTMENT_MODE'; mode: InvestmentMode }
  | { type: 'SET_TOKEN_A_AMOUNT'; amount: string; isMax: boolean }
  | { type: 'SET_TOKEN_B_AMOUNT'; amount: string; isMax: boolean }
  | { type: 'SET_TICK_RANGE'; tickLower: number; tickUpper: number }
  | { type: 'SET_LIQUIDITY'; liquidity: string }
  | { type: 'SWAP_QUOTE_BASE' }
  | { type: 'SET_AUTOMATION_ENABLED'; enabled: boolean }
  | { type: 'SET_STOP_LOSS'; enabled: boolean; tick: number | null }
  | { type: 'SET_TAKE_PROFIT'; enabled: boolean; tick: number | null }
  | { type: 'SET_NEEDS_SWAP'; needsSwap: boolean }
  | { type: 'SET_NEEDS_AUTOWALLET'; needsAutowallet: boolean }
  | { type: 'ADD_TRANSACTION'; tx: TransactionRecord }
  | { type: 'UPDATE_TRANSACTION'; hash: string; status: TransactionRecord['status'] }
  | { type: 'SET_POSITION_CREATED'; positionId: string; nftId: string }
  | { type: 'SET_STEP_VALID'; stepId: string; valid: boolean }
  | { type: 'RESET' };

// ----- Initial State -----

const initialState: CreatePositionWizardState = {
  currentStepIndex: 0,
  poolSelectionTab: 'search',
  selectedPool: null,
  baseToken: null,
  quoteToken: null,
  investmentMode: 'matched',
  tokenAAmount: '',
  tokenBAmount: '',
  tokenAIsMax: false,
  tokenBIsMax: false,
  tickLower: 0,
  tickUpper: 0,
  liquidity: '0',
  automationEnabled: false,
  stopLossEnabled: false,
  stopLossTick: null,
  takeProfitEnabled: false,
  takeProfitTick: null,
  needsSwap: false,
  needsAutowallet: false,
  transactions: [],
  positionId: null,
  nftId: null,
  stepValidation: {},
};

// ----- Reducer -----

function wizardReducer(
  state: CreatePositionWizardState,
  action: WizardAction
): CreatePositionWizardState {
  switch (action.type) {
    case 'GO_TO_STEP':
      return { ...state, currentStepIndex: action.stepIndex };

    case 'GO_NEXT':
      return { ...state, currentStepIndex: state.currentStepIndex + 1 };

    case 'GO_BACK':
      return { ...state, currentStepIndex: Math.max(0, state.currentStepIndex - 1) };

    case 'SET_POOL_TAB':
      return { ...state, poolSelectionTab: action.tab };

    case 'SELECT_POOL':
      // Default: token0 is base, token1 is quote (user can swap later)
      return {
        ...state,
        selectedPool: action.pool,
        baseToken: action.pool.token0,
        quoteToken: action.pool.token1,
        // Reset tick range (will be set when current tick is fetched)
        tickLower: 0,
        tickUpper: 0,
      };

    case 'CLEAR_POOL':
      return {
        ...state,
        selectedPool: null,
        baseToken: null,
        quoteToken: null,
      };

    case 'SET_INVESTMENT_MODE':
      return { ...state, investmentMode: action.mode };

    case 'SET_TOKEN_A_AMOUNT':
      return {
        ...state,
        tokenAAmount: action.amount,
        tokenAIsMax: action.isMax,
      };

    case 'SET_TOKEN_B_AMOUNT':
      return {
        ...state,
        tokenBAmount: action.amount,
        tokenBIsMax: action.isMax,
      };

    case 'SET_TICK_RANGE':
      return {
        ...state,
        tickLower: action.tickLower,
        tickUpper: action.tickUpper,
      };

    case 'SET_LIQUIDITY':
      return { ...state, liquidity: action.liquidity };

    case 'SWAP_QUOTE_BASE':
      return {
        ...state,
        baseToken: state.quoteToken,
        quoteToken: state.baseToken,
      };

    case 'SET_AUTOMATION_ENABLED':
      return {
        ...state,
        automationEnabled: action.enabled,
        // Reset SL/TP when automation disabled
        stopLossEnabled: action.enabled ? state.stopLossEnabled : false,
        takeProfitEnabled: action.enabled ? state.takeProfitEnabled : false,
      };

    case 'SET_STOP_LOSS':
      return {
        ...state,
        stopLossEnabled: action.enabled,
        stopLossTick: action.tick,
      };

    case 'SET_TAKE_PROFIT':
      return {
        ...state,
        takeProfitEnabled: action.enabled,
        takeProfitTick: action.tick,
      };

    case 'SET_NEEDS_SWAP':
      return { ...state, needsSwap: action.needsSwap };

    case 'SET_NEEDS_AUTOWALLET':
      return { ...state, needsAutowallet: action.needsAutowallet };

    case 'ADD_TRANSACTION':
      return {
        ...state,
        transactions: [...state.transactions, action.tx],
      };

    case 'UPDATE_TRANSACTION':
      return {
        ...state,
        transactions: state.transactions.map((tx) =>
          tx.hash === action.hash ? { ...tx, status: action.status } : tx
        ),
      };

    case 'SET_POSITION_CREATED':
      return {
        ...state,
        positionId: action.positionId,
        nftId: action.nftId,
      };

    case 'SET_STEP_VALID':
      return {
        ...state,
        stepValidation: {
          ...state.stepValidation,
          [action.stepId]: action.valid,
        },
      };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

// ----- Step Definitions -----

const BASE_STEPS: WizardStep[] = [
  { id: 'pool', label: 'Select Pool' },
  { id: 'investment', label: 'Investment' },
  { id: 'range', label: 'Set Range' },
  { id: 'automation', label: 'Automation' },
];

export function getVisibleSteps(state: CreatePositionWizardState): WizardStep[] {
  const steps = [...BASE_STEPS];

  // Conditional: Swap step
  if (state.needsSwap) {
    steps.push({ id: 'swap', label: 'Swap Tokens' });
  }

  // Always: Approvals
  steps.push({ id: 'approvals', label: 'Approve Tokens' });

  // Always: Mint
  steps.push({ id: 'mint', label: 'Open Position' });

  // Conditional: Autowallet
  if (state.automationEnabled && state.needsAutowallet) {
    steps.push({ id: 'autowallet', label: 'Setup Automation' });
  }

  // Conditional: Register orders
  if (state.automationEnabled && (state.stopLossEnabled || state.takeProfitEnabled)) {
    steps.push({ id: 'register', label: 'Register Orders' });
  }

  // Always: Summary
  steps.push({ id: 'summary', label: 'Summary' });

  return steps;
}

// ----- Context -----

interface CreatePositionWizardContextValue {
  state: CreatePositionWizardState;
  steps: WizardStep[];
  currentStep: WizardStep;

  // Navigation
  goToStep: (stepIndex: number) => void;
  goNext: () => void;
  goBack: () => void;
  canGoNext: boolean;
  canGoBack: boolean;

  // Pool selection
  setPoolTab: (tab: PoolSelectionTab) => void;
  selectPool: (pool: PoolSearchResultItem) => void;
  clearPool: () => void;

  // Investment
  setInvestmentMode: (mode: InvestmentMode) => void;
  setTokenAAmount: (amount: string, isMax: boolean) => void;
  setTokenBAmount: (amount: string, isMax: boolean) => void;

  // Range
  setTickRange: (tickLower: number, tickUpper: number) => void;
  setLiquidity: (liquidity: string) => void;
  swapQuoteBase: () => void;

  // Automation
  setAutomationEnabled: (enabled: boolean) => void;
  setStopLoss: (enabled: boolean, tick: number | null) => void;
  setTakeProfit: (enabled: boolean, tick: number | null) => void;

  // Conditional flags
  setNeedsSwap: (needsSwap: boolean) => void;
  setNeedsAutowallet: (needsAutowallet: boolean) => void;

  // Transactions
  addTransaction: (tx: TransactionRecord) => void;
  updateTransaction: (hash: string, status: TransactionRecord['status']) => void;
  setPositionCreated: (positionId: string, nftId: string) => void;

  // Validation
  setStepValid: (stepId: string, valid: boolean) => void;
  isStepValid: (stepId: string) => boolean;

  // Reset
  reset: () => void;
}

const CreatePositionWizardContext = createContext<CreatePositionWizardContextValue | undefined>(
  undefined
);

// ----- Provider -----

interface CreatePositionWizardProviderProps {
  children: ReactNode;
}

export function CreatePositionWizardProvider({ children }: CreatePositionWizardProviderProps) {
  const [state, dispatch] = useReducer(wizardReducer, initialState);

  const steps = getVisibleSteps(state);
  const currentStep = steps[state.currentStepIndex] || steps[0];

  // Navigation
  const goToStep = useCallback((stepIndex: number) => {
    dispatch({ type: 'GO_TO_STEP', stepIndex });
  }, []);

  const goNext = useCallback(() => {
    dispatch({ type: 'GO_NEXT' });
  }, []);

  const goBack = useCallback(() => {
    dispatch({ type: 'GO_BACK' });
  }, []);

  const canGoNext = state.currentStepIndex < steps.length - 1;
  const canGoBack = state.currentStepIndex > 0;

  // Pool selection
  const setPoolTab = useCallback((tab: PoolSelectionTab) => {
    dispatch({ type: 'SET_POOL_TAB', tab });
  }, []);

  const selectPool = useCallback(
    (pool: PoolSearchResultItem) => {
      dispatch({ type: 'SELECT_POOL', pool });
    },
    []
  );

  const clearPool = useCallback(() => {
    dispatch({ type: 'CLEAR_POOL' });
  }, []);

  // Investment
  const setInvestmentMode = useCallback((mode: InvestmentMode) => {
    dispatch({ type: 'SET_INVESTMENT_MODE', mode });
  }, []);

  const setTokenAAmount = useCallback((amount: string, isMax: boolean) => {
    dispatch({ type: 'SET_TOKEN_A_AMOUNT', amount, isMax });
  }, []);

  const setTokenBAmount = useCallback((amount: string, isMax: boolean) => {
    dispatch({ type: 'SET_TOKEN_B_AMOUNT', amount, isMax });
  }, []);

  // Range
  const setTickRange = useCallback((tickLower: number, tickUpper: number) => {
    dispatch({ type: 'SET_TICK_RANGE', tickLower, tickUpper });
  }, []);

  const setLiquidity = useCallback((liquidity: string) => {
    dispatch({ type: 'SET_LIQUIDITY', liquidity });
  }, []);

  const swapQuoteBase = useCallback(() => {
    dispatch({ type: 'SWAP_QUOTE_BASE' });
  }, []);

  // Automation
  const setAutomationEnabled = useCallback((enabled: boolean) => {
    dispatch({ type: 'SET_AUTOMATION_ENABLED', enabled });
  }, []);

  const setStopLoss = useCallback((enabled: boolean, tick: number | null) => {
    dispatch({ type: 'SET_STOP_LOSS', enabled, tick });
  }, []);

  const setTakeProfit = useCallback((enabled: boolean, tick: number | null) => {
    dispatch({ type: 'SET_TAKE_PROFIT', enabled, tick });
  }, []);

  // Conditional flags
  const setNeedsSwap = useCallback((needsSwap: boolean) => {
    dispatch({ type: 'SET_NEEDS_SWAP', needsSwap });
  }, []);

  const setNeedsAutowallet = useCallback((needsAutowallet: boolean) => {
    dispatch({ type: 'SET_NEEDS_AUTOWALLET', needsAutowallet });
  }, []);

  // Transactions
  const addTransaction = useCallback((tx: TransactionRecord) => {
    dispatch({ type: 'ADD_TRANSACTION', tx });
  }, []);

  const updateTransaction = useCallback(
    (hash: string, status: TransactionRecord['status']) => {
      dispatch({ type: 'UPDATE_TRANSACTION', hash, status });
    },
    []
  );

  const setPositionCreated = useCallback((positionId: string, nftId: string) => {
    dispatch({ type: 'SET_POSITION_CREATED', positionId, nftId });
  }, []);

  // Validation
  const setStepValid = useCallback((stepId: string, valid: boolean) => {
    dispatch({ type: 'SET_STEP_VALID', stepId, valid });
  }, []);

  const isStepValid = useCallback(
    (stepId: string) => {
      return state.stepValidation[stepId] ?? false;
    },
    [state.stepValidation]
  );

  // Reset
  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const value: CreatePositionWizardContextValue = {
    state,
    steps,
    currentStep,
    goToStep,
    goNext,
    goBack,
    canGoNext,
    canGoBack,
    setPoolTab,
    selectPool,
    clearPool,
    setInvestmentMode,
    setTokenAAmount,
    setTokenBAmount,
    setTickRange,
    setLiquidity,
    swapQuoteBase,
    setAutomationEnabled,
    setStopLoss,
    setTakeProfit,
    setNeedsSwap,
    setNeedsAutowallet,
    addTransaction,
    updateTransaction,
    setPositionCreated,
    setStepValid,
    isStepValid,
    reset,
  };

  return (
    <CreatePositionWizardContext.Provider value={value}>
      {children}
    </CreatePositionWizardContext.Provider>
  );
}

// ----- Hook -----

export function useCreatePositionWizard() {
  const context = useContext(CreatePositionWizardContext);
  if (context === undefined) {
    throw new Error('useCreatePositionWizard must be used within a CreatePositionWizardProvider');
  }
  return context;
}
