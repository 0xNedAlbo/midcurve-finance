import { useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { UniswapV3Pool, type PoolJSON } from '@midcurve/shared';
import { FullPageWizardLayout } from '@/components/layout/wizard';
import {
  IncreaseDepositWizardProvider,
  useIncreaseDepositWizard,
} from './context/IncreaseDepositWizardContext';
import { useUniswapV3Position } from '@/hooks/positions/uniswapv3/useUniswapV3Position';
import { useDiscoverPool } from '@/hooks/pools/useDiscoverPool';
import { useCloseOrders } from '@/hooks/automation/useCloseOrders';
import { getChainId, isValidChainSlug } from '@/config/chains';

// Steps (lazy-loaded via wrapper components)
import { ConfigureStep } from './steps/ConfigureStep';
import { SwapStep } from './steps/SwapStep';
import { TransactionStep } from './steps/TransactionStep';

// Step content interface
interface StepContent {
  interactive: React.ReactNode;
  visual: React.ReactNode;
  summary: React.ReactNode;
}

// Individual step wrapper components - each one properly handles its own hooks
function ConfigureStepRenderer() {
  const content = ConfigureStep();
  return <StepRenderer content={content} />;
}

function SwapStepRenderer() {
  const content = SwapStep();
  return <StepRenderer content={content} />;
}

function TransactionStepRenderer() {
  const content = TransactionStep();
  return <StepRenderer content={content} />;
}

// Helper component to render the step content into the layout
function StepRenderer({ content }: { content: StepContent }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { steps, state } = useIncreaseDepositWizard();
  const returnTo = (location.state as { returnTo?: string })?.returnTo || '/dashboard';

  const handleClose = () => {
    navigate(returnTo);
  };

  return (
    <FullPageWizardLayout
      title="Increase Deposit"
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

// Loading component shown while position data is being fetched
function LoadingState() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string })?.returnTo || '/dashboard';

  return (
    <FullPageWizardLayout
      title="Increase Deposit"
      steps={[]}
      currentStep={0}
      onClose={() => navigate(returnTo)}
      interactiveContent={
        <div className="flex items-center justify-center h-full min-h-[400px]">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-400">Loading position data...</p>
          </div>
        </div>
      }
      visualContent={null}
      summaryContent={null}
      interactiveZoom={1}
      summaryZoom={1}
    />
  );
}

// Error component
function ErrorState({ message }: { message: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string })?.returnTo || '/dashboard';

  return (
    <FullPageWizardLayout
      title="Increase Deposit"
      steps={[]}
      currentStep={0}
      onClose={() => navigate(returnTo)}
      interactiveContent={
        <div className="flex items-center justify-center h-full min-h-[400px]">
          <div className="text-center">
            <p className="text-red-400 mb-4">{message}</p>
            <button
              onClick={() => navigate(returnTo)}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors cursor-pointer"
            >
              Go Back
            </button>
          </div>
        </div>
      }
      visualContent={null}
      summaryContent={null}
      interactiveZoom={1}
      summaryZoom={1}
    />
  );
}

// Data loader component - fetches position, pool, and close orders
function IncreaseDepositDataLoader() {
  const { chain, nftId } = useParams<{
    protocol: string;
    chain: string;
    nftId: string;
  }>();
  // Validate route params
  if (!chain || !nftId || !isValidChainSlug(chain)) {
    return <ErrorState message="Invalid position URL." />;
  }

  const chainId = getChainId(chain);

  return (
    <IncreaseDepositWizardProvider>
      <DataFetcher chainId={chainId} nftId={nftId} />
    </IncreaseDepositWizardProvider>
  );
}

// Separated data fetcher that can use context hooks
function DataFetcher({ chainId, nftId }: { chainId: number; nftId: string }) {
  const {
    setPosition,
    setPositionLoading,
    setPositionError,
    setDiscoveredPool,
    setActiveCloseOrders,
  } = useIncreaseDepositWizard();

  // Fetch position data
  const positionQuery = useUniswapV3Position(chainId, nftId);
  const discoverPool = useDiscoverPool();

  // Fetch close orders (all non-deleted orders for this position)
  const closeOrdersQuery = useCloseOrders({
    chainId,
    nftId,
  });

  // Load position into context when fetched
  const positionLoaded = useRef(false);
  useEffect(() => {
    if (positionQuery.data && !positionLoaded.current) {
      positionLoaded.current = true;
      setPosition(positionQuery.data);
    }
    if (positionQuery.isLoading) {
      setPositionLoading(true);
    }
    if (positionQuery.error) {
      setPositionError(positionQuery.error.message);
    }
  }, [positionQuery.data, positionQuery.isLoading, positionQuery.error, setPosition, setPositionLoading, setPositionError]);

  // Discover pool for simulation when position is loaded
  const poolDiscovered = useRef(false);
  useEffect(() => {
    if (positionQuery.data && !poolDiscovered.current) {
      poolDiscovered.current = true;
      const poolAddress = positionQuery.data.config.poolAddress;
      const posChainId = positionQuery.data.config.chainId;

      discoverPool.mutateAsync({ chainId: posChainId, address: poolAddress })
        .then((result) => {
          const poolInstance = UniswapV3Pool.fromJSON(
            result.pool as unknown as PoolJSON
          );
          setDiscoveredPool(poolInstance);
        })
        .catch((error) => {
          console.error('Failed to discover pool:', error);
        });
    }
  }, [positionQuery.data, discoverPool, setDiscoveredPool]);

  // Load close orders into context
  const closeOrdersLoaded = useRef(false);
  useEffect(() => {
    if (closeOrdersQuery.data && !closeOrdersLoaded.current) {
      closeOrdersLoaded.current = true;
      setActiveCloseOrders(closeOrdersQuery.data);
    }
  }, [closeOrdersQuery.data, setActiveCloseOrders]);

  // Show loading while position is being fetched
  if (positionQuery.isLoading || !positionQuery.data) {
    return <LoadingState />;
  }

  // Show error if position fetch failed
  if (positionQuery.error) {
    return <ErrorState message={`Failed to load position: ${positionQuery.error.message}`} />;
  }

  return <IncreaseDepositWizardContent />;
}

// Main content component that conditionally renders the current step
function IncreaseDepositWizardContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string })?.returnTo || '/dashboard';
  const { steps, state, goBack, goToStep } = useIncreaseDepositWizard();
  const currentStepId = steps[state.currentStepIndex]?.id;

  // Track whether we're handling a popstate event to prevent pushing duplicate history
  const isPopstateRef = useRef(false);
  // Track the previous step index to detect forward navigation
  const prevStepIndexRef = useRef(state.currentStepIndex);

  // Push history entry when navigating forward to a new step (via UI buttons)
  useEffect(() => {
    if (isPopstateRef.current) {
      isPopstateRef.current = false;
      prevStepIndexRef.current = state.currentStepIndex;
      return;
    }

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

      if (typeof historyStep === 'number' && historyStep !== state.currentStepIndex) {
        isPopstateRef.current = true;
        goToStep(historyStep);
        return;
      }

      if (historyStep === undefined) {
        if (state.currentStepIndex > 0) {
          isPopstateRef.current = true;
          goBack();
        } else {
          navigate(returnTo, { replace: true });
        }
      }
    };

    window.addEventListener('popstate', handlePopstate);
    return () => window.removeEventListener('popstate', handlePopstate);
  }, [state.currentStepIndex, goBack, goToStep, navigate, returnTo]);

  // Render only the current step component
  switch (currentStepId) {
    case 'configure':
      return <ConfigureStepRenderer />;
    case 'swap':
      return <SwapStepRenderer />;
    case 'transaction':
      return <TransactionStepRenderer />;
    default:
      return <ConfigureStepRenderer />;
  }
}

export function IncreaseDepositWizard() {
  return <IncreaseDepositDataLoader />;
}
