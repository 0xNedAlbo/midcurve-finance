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
  type: 'withdraw';
  label: string;
  status: 'pending' | 'confirming' | 'confirmed' | 'failed';
}

export interface WithdrawWizardState {
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

  // Withdrawal configuration
  withdrawPercent: number; // 0-100 slider value
  burnAfterWithdraw: boolean; // true = burn NFT after full withdrawal
  refreshedSqrtPriceX96: string | null; // refreshed pool price (null = use pool state)

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
  | { type: 'SET_WITHDRAW_PERCENT'; percent: number }
  | { type: 'SET_BURN_AFTER_WITHDRAW'; burn: boolean }
  | { type: 'SET_REFRESHED_SQRT_PRICE'; sqrtPriceX96: string | null }
  | { type: 'ADD_TRANSACTION'; tx: TransactionRecord }
  | { type: 'UPDATE_TRANSACTION'; hash: string; status: TransactionRecord['status'] }
  | { type: 'SET_STEP_VALID'; stepId: string; valid: boolean }
  | { type: 'SET_INTERACTIVE_ZOOM'; zoom: number }
  | { type: 'SET_SUMMARY_ZOOM'; zoom: number }
  | { type: 'RESET' };

// ----- Steps -----

const WITHDRAW_STEPS: WizardStep[] = [
  { id: 'configure', label: 'Configure Withdrawal' },
  { id: 'transaction', label: 'Execute' },
];

// ----- Initial State -----

const initialState: WithdrawWizardState = {
  currentStepIndex: 0,
  position: null,
  isLoadingPosition: true,
  positionError: null,
  discoveredPool: null,
  activeCloseOrders: [],
  withdrawPercent: 0,
  burnAfterWithdraw: true,
  refreshedSqrtPriceX96: null,
  transactions: [],
  stepValidation: {},
  interactiveZoom: 1.0,
  summaryZoom: 1.0,
};

// ----- Reducer -----

function wizardReducer(
  state: WithdrawWizardState,
  action: WizardAction
): WithdrawWizardState {
  switch (action.type) {
    case 'GO_TO_STEP':
      return { ...state, currentStepIndex: action.stepIndex };

    case 'GO_NEXT':
      return {
        ...state,
        currentStepIndex: Math.min(
          state.currentStepIndex + 1,
          WITHDRAW_STEPS.length - 1
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

    case 'SET_WITHDRAW_PERCENT': {
      const burnAfterWithdraw = action.percent >= 100;
      return { ...state, withdrawPercent: action.percent, burnAfterWithdraw };
    }

    case 'SET_BURN_AFTER_WITHDRAW':
      return { ...state, burnAfterWithdraw: action.burn };

    case 'SET_REFRESHED_SQRT_PRICE':
      return { ...state, refreshedSqrtPriceX96: action.sqrtPriceX96 };

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

interface WithdrawWizardContextValue {
  state: WithdrawWizardState;
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

  // Withdrawal input
  setWithdrawPercent: (percent: number) => void;
  setBurnAfterWithdraw: (burn: boolean) => void;
  setRefreshedSqrtPrice: (sqrtPriceX96: string | null) => void;

  // Transactions
  addTransaction: (tx: TransactionRecord) => void;
  updateTransaction: (hash: string, status: TransactionRecord['status']) => void;

  // Validation
  setStepValid: (stepId: string, valid: boolean) => void;
  isStepValid: (stepId: string) => boolean;

  // Zoom
  setInteractiveZoom: (zoom: number) => void;
  setSummaryZoom: (zoom: number) => void;
}

const WithdrawWizardContext = createContext<WithdrawWizardContextValue | null>(null);

// ----- Provider -----

export function WithdrawWizardProvider({ children }: { children: ReactNode }) {
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
    (position: ListPositionData) => dispatch({ type: 'SET_POSITION', position }),
    []
  );
  const setPositionLoading = useCallback(
    (isLoading: boolean) => dispatch({ type: 'SET_POSITION_LOADING', isLoading }),
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

  // Withdrawal input
  const setWithdrawPercent = useCallback(
    (percent: number) => dispatch({ type: 'SET_WITHDRAW_PERCENT', percent }),
    []
  );
  const setBurnAfterWithdraw = useCallback(
    (burn: boolean) => dispatch({ type: 'SET_BURN_AFTER_WITHDRAW', burn }),
    []
  );
  const setRefreshedSqrtPrice = useCallback(
    (sqrtPriceX96: string | null) =>
      dispatch({ type: 'SET_REFRESHED_SQRT_PRICE', sqrtPriceX96 }),
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

  const currentStep = WITHDRAW_STEPS[state.currentStepIndex] ?? WITHDRAW_STEPS[0];
  const canGoNext = state.currentStepIndex < WITHDRAW_STEPS.length - 1;
  const canGoBack = state.currentStepIndex > 0;

  const value: WithdrawWizardContextValue = {
    state,
    steps: WITHDRAW_STEPS,
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
    setWithdrawPercent,
    setBurnAfterWithdraw,
    setRefreshedSqrtPrice,
    addTransaction,
    updateTransaction,
    setStepValid,
    isStepValid,
    setInteractiveZoom,
    setSummaryZoom,
  };

  return (
    <WithdrawWizardContext.Provider value={value}>
      {children}
    </WithdrawWizardContext.Provider>
  );
}

// ----- Hook -----

export function useWithdrawWizard() {
  const context = useContext(WithdrawWizardContext);
  if (!context) {
    throw new Error(
      'useWithdrawWizard must be used within WithdrawWizardProvider'
    );
  }
  return context;
}
