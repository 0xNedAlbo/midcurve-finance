import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  type ReactNode,
} from 'react';
import type { ListPositionData, SerializedCloseOrder } from '@midcurve/api-shared';
import type { UniswapV3Pool } from '@midcurve/shared';
import type { WizardStep } from '@/components/layout/wizard';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { ZOOM_STORAGE_KEYS, ZOOM_DEFAULTS } from '@/lib/zoom-settings';

// ----- Types -----

export interface TransactionRecord {
  hash: string;
  type: 'approval' | 'increase';
  label: string;
  status: 'pending' | 'confirming' | 'confirmed' | 'failed';
}

export interface IncreaseDepositWizardState {
  // Current step
  currentStepIndex: number;

  // Position (loaded from API via route params)
  position: ListPositionData | null;
  isLoadingPosition: boolean;
  positionError: string | null;

  // Pool instance (from useDiscoverPool, for PnL simulation)
  discoveredPool: UniswapV3Pool | null;

  // Close orders (fetched via useCloseOrders)
  activeCloseOrders: SerializedCloseOrder[];

  // Capital input (additional amounts)
  baseInputAmount: string; // human-readable
  quoteInputAmount: string; // human-readable

  // Calculated results
  allocatedBaseAmount: string; // bigint as string
  allocatedQuoteAmount: string;
  totalQuoteValue: string;
  additionalLiquidity: string;

  // Transactions
  transactions: TransactionRecord[];

  // Validation
  stepValidation: Record<string, boolean>;

  // UI zoom settings (persist across steps)
  interactiveZoom: number;
  summaryZoom: number;
}

// ----- Actions -----

type WizardAction =
  | { type: 'GO_TO_STEP'; stepIndex: number }
  | { type: 'GO_NEXT' }
  | { type: 'GO_BACK' }
  | { type: 'SET_POSITION'; position: ListPositionData }
  | { type: 'SET_POSITION_LOADING'; isLoading: boolean }
  | { type: 'SET_POSITION_ERROR'; error: string }
  | { type: 'SET_DISCOVERED_POOL'; pool: UniswapV3Pool }
  | { type: 'SET_ACTIVE_CLOSE_ORDERS'; orders: SerializedCloseOrder[] }
  | { type: 'SET_BASE_INPUT'; amount: string }
  | { type: 'SET_QUOTE_INPUT'; amount: string }
  | {
      type: 'SET_ALLOCATED_AMOUNTS';
      base: string;
      quote: string;
      total: string;
      liquidity: string;
    }
  | { type: 'ADD_TRANSACTION'; tx: TransactionRecord }
  | {
      type: 'UPDATE_TRANSACTION';
      hash: string;
      status: TransactionRecord['status'];
    }
  | { type: 'SET_STEP_VALID'; stepId: string; valid: boolean }
  | { type: 'SET_INTERACTIVE_ZOOM'; zoom: number }
  | { type: 'SET_SUMMARY_ZOOM'; zoom: number }
  | { type: 'RESET' };

// ----- Steps -----

const INCREASE_STEPS: WizardStep[] = [
  { id: 'configure', label: 'Configure Deposit' },
  { id: 'swap', label: 'Acquire Tokens' },
  { id: 'transaction', label: 'Execute' },
];

// ----- Initial State -----

const initialState: IncreaseDepositWizardState = {
  currentStepIndex: 0,
  position: null,
  isLoadingPosition: true,
  positionError: null,
  discoveredPool: null,
  activeCloseOrders: [],
  baseInputAmount: '',
  quoteInputAmount: '',
  allocatedBaseAmount: '0',
  allocatedQuoteAmount: '0',
  totalQuoteValue: '0',
  additionalLiquidity: '0',
  transactions: [],
  stepValidation: {},
  interactiveZoom: 1.0,
  summaryZoom: 1.0,
};

// ----- Reducer -----

function wizardReducer(
  state: IncreaseDepositWizardState,
  action: WizardAction
): IncreaseDepositWizardState {
  switch (action.type) {
    case 'GO_TO_STEP':
      return { ...state, currentStepIndex: action.stepIndex };

    case 'GO_NEXT':
      return {
        ...state,
        currentStepIndex: Math.min(
          state.currentStepIndex + 1,
          INCREASE_STEPS.length - 1
        ),
      };

    case 'GO_BACK':
      return {
        ...state,
        currentStepIndex: Math.max(0, state.currentStepIndex - 1),
      };

    case 'SET_POSITION':
      return {
        ...state,
        position: action.position,
        isLoadingPosition: false,
        positionError: null,
      };

    case 'SET_POSITION_LOADING':
      return { ...state, isLoadingPosition: action.isLoading };

    case 'SET_POSITION_ERROR':
      return {
        ...state,
        isLoadingPosition: false,
        positionError: action.error,
      };

    case 'SET_DISCOVERED_POOL':
      return { ...state, discoveredPool: action.pool };

    case 'SET_ACTIVE_CLOSE_ORDERS':
      return { ...state, activeCloseOrders: action.orders };

    case 'SET_BASE_INPUT':
      return { ...state, baseInputAmount: action.amount };

    case 'SET_QUOTE_INPUT':
      return { ...state, quoteInputAmount: action.amount };

    case 'SET_ALLOCATED_AMOUNTS':
      return {
        ...state,
        allocatedBaseAmount: action.base,
        allocatedQuoteAmount: action.quote,
        totalQuoteValue: action.total,
        additionalLiquidity: action.liquidity,
      };

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

    case 'SET_STEP_VALID':
      return {
        ...state,
        stepValidation: {
          ...state.stepValidation,
          [action.stepId]: action.valid,
        },
      };

    case 'SET_INTERACTIVE_ZOOM':
      return { ...state, interactiveZoom: action.zoom };

    case 'SET_SUMMARY_ZOOM':
      return { ...state, summaryZoom: action.zoom };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

// ----- Context -----

interface IncreaseDepositWizardContextValue {
  state: IncreaseDepositWizardState;
  steps: WizardStep[];
  currentStep: WizardStep;

  // Navigation
  goNext: () => void;
  goBack: () => void;
  goToStep: (stepIndex: number) => void;
  canGoNext: boolean;
  canGoBack: boolean;

  // Data loading
  setPosition: (position: ListPositionData) => void;
  setPositionLoading: (isLoading: boolean) => void;
  setPositionError: (error: string) => void;
  setDiscoveredPool: (pool: UniswapV3Pool) => void;
  setActiveCloseOrders: (orders: SerializedCloseOrder[]) => void;

  // Capital input
  setBaseInput: (amount: string) => void;
  setQuoteInput: (amount: string) => void;
  setAllocatedAmounts: (
    base: string,
    quote: string,
    total: string,
    liquidity: string
  ) => void;

  // Transactions
  addTransaction: (tx: TransactionRecord) => void;
  updateTransaction: (
    hash: string,
    status: TransactionRecord['status']
  ) => void;

  // Validation
  setStepValid: (stepId: string, valid: boolean) => void;
  isStepValid: (stepId: string) => boolean;

  // Zoom
  setInteractiveZoom: (zoom: number) => void;
  setSummaryZoom: (zoom: number) => void;
}

const IncreaseDepositWizardContext =
  createContext<IncreaseDepositWizardContextValue | null>(null);

// ----- Provider -----

export function IncreaseDepositWizardProvider({
  children,
}: {
  children: ReactNode;
}) {
  // Load persisted zoom settings
  const [storedInteractiveZoom] = useLocalStorage(
    ZOOM_STORAGE_KEYS.interactive,
    ZOOM_DEFAULTS.interactive
  );
  const [storedSummaryZoom] = useLocalStorage(
    ZOOM_STORAGE_KEYS.summary,
    ZOOM_DEFAULTS.summary
  );

  const [state, dispatch] = useReducer(wizardReducer, {
    ...initialState,
    interactiveZoom: storedInteractiveZoom,
    summaryZoom: storedSummaryZoom,
  });

  // Persist zoom settings
  const [, setStoredInteractiveZoom] = useLocalStorage(
    ZOOM_STORAGE_KEYS.interactive,
    ZOOM_DEFAULTS.interactive
  );
  const [, setStoredSummaryZoom] = useLocalStorage(
    ZOOM_STORAGE_KEYS.summary,
    ZOOM_DEFAULTS.summary
  );

  // Navigation
  const goNext = useCallback(() => dispatch({ type: 'GO_NEXT' }), []);
  const goBack = useCallback(() => dispatch({ type: 'GO_BACK' }), []);
  const goToStep = useCallback(
    (stepIndex: number) => dispatch({ type: 'GO_TO_STEP', stepIndex }),
    []
  );

  // Data loading
  const setPosition = useCallback(
    (position: ListPositionData) =>
      dispatch({ type: 'SET_POSITION', position }),
    []
  );
  const setPositionLoading = useCallback(
    (isLoading: boolean) =>
      dispatch({ type: 'SET_POSITION_LOADING', isLoading }),
    []
  );
  const setPositionError = useCallback(
    (error: string) => dispatch({ type: 'SET_POSITION_ERROR', error }),
    []
  );
  const setDiscoveredPool = useCallback(
    (pool: UniswapV3Pool) => dispatch({ type: 'SET_DISCOVERED_POOL', pool }),
    []
  );
  const setActiveCloseOrders = useCallback(
    (orders: SerializedCloseOrder[]) =>
      dispatch({ type: 'SET_ACTIVE_CLOSE_ORDERS', orders }),
    []
  );

  // Capital input
  const setBaseInput = useCallback(
    (amount: string) => dispatch({ type: 'SET_BASE_INPUT', amount }),
    []
  );
  const setQuoteInput = useCallback(
    (amount: string) => dispatch({ type: 'SET_QUOTE_INPUT', amount }),
    []
  );
  const setAllocatedAmounts = useCallback(
    (base: string, quote: string, total: string, liquidity: string) =>
      dispatch({ type: 'SET_ALLOCATED_AMOUNTS', base, quote, total, liquidity }),
    []
  );

  // Transactions
  const addTransaction = useCallback(
    (tx: TransactionRecord) => dispatch({ type: 'ADD_TRANSACTION', tx }),
    []
  );
  const updateTransaction = useCallback(
    (hash: string, status: TransactionRecord['status']) =>
      dispatch({ type: 'UPDATE_TRANSACTION', hash, status }),
    []
  );

  // Validation
  const setStepValid = useCallback(
    (stepId: string, valid: boolean) =>
      dispatch({ type: 'SET_STEP_VALID', stepId, valid }),
    []
  );
  const isStepValid = useCallback(
    (stepId: string) => state.stepValidation[stepId] ?? false,
    [state.stepValidation]
  );

  // Zoom (with persistence)
  const setInteractiveZoom = useCallback(
    (zoom: number) => {
      dispatch({ type: 'SET_INTERACTIVE_ZOOM', zoom });
      setStoredInteractiveZoom(zoom);
    },
    [setStoredInteractiveZoom]
  );
  const setSummaryZoom = useCallback(
    (zoom: number) => {
      dispatch({ type: 'SET_SUMMARY_ZOOM', zoom });
      setStoredSummaryZoom(zoom);
    },
    [setStoredSummaryZoom]
  );

  const currentStep = INCREASE_STEPS[state.currentStepIndex] ?? INCREASE_STEPS[0];
  const canGoNext = state.currentStepIndex < INCREASE_STEPS.length - 1;
  const canGoBack = state.currentStepIndex > 0;

  const value: IncreaseDepositWizardContextValue = {
    state,
    steps: INCREASE_STEPS,
    currentStep,
    goNext,
    goBack,
    goToStep,
    canGoNext,
    canGoBack,
    setPosition,
    setPositionLoading,
    setPositionError,
    setDiscoveredPool,
    setActiveCloseOrders,
    setBaseInput,
    setQuoteInput,
    setAllocatedAmounts,
    addTransaction,
    updateTransaction,
    setStepValid,
    isStepValid,
    setInteractiveZoom,
    setSummaryZoom,
  };

  return (
    <IncreaseDepositWizardContext.Provider value={value}>
      {children}
    </IncreaseDepositWizardContext.Provider>
  );
}

// ----- Hook -----

export function useIncreaseDepositWizard() {
  const context = useContext(IncreaseDepositWizardContext);
  if (!context) {
    throw new Error(
      'useIncreaseDepositWizard must be used within IncreaseDepositWizardProvider'
    );
  }
  return context;
}
