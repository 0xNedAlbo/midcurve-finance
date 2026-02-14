import { useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { UniswapV3Pool, type PoolJSON } from '@midcurve/shared';
import { FullPageWizardLayout } from '@/components/layout/wizard';
import {
  RiskTriggersWizardProvider,
  useRiskTriggersWizard,
} from './context/RiskTriggersWizardContext';
import { useUniswapV3Position } from '@/hooks/positions/uniswapv3/useUniswapV3Position';
import { useDiscoverPool } from '@/hooks/pools/useDiscoverPool';
import { useCloseOrders } from '@/hooks/automation/useCloseOrders';
import { getChainId, isValidChainSlug } from '@/config/chains';

// Steps
import { ConfigureStep } from './steps/ConfigureStep';
import { TransactionStep } from './steps/TransactionStep';

// Step content interface
interface StepContent {
  interactive: React.ReactNode;
  visual: React.ReactNode;
  summary: React.ReactNode;
}

function ConfigureStepRenderer() {
  const content = ConfigureStep();
  return <StepRenderer content={content} />;
}

function TransactionStepRenderer() {
  const content = TransactionStep();
  return <StepRenderer content={content} />;
}

function StepRenderer({ content }: { content: StepContent }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { steps, state } = useRiskTriggersWizard();
  const returnTo =
    (location.state as { returnTo?: string })?.returnTo || '/dashboard';

  const handleClose = () => {
    navigate(returnTo);
  };

  return (
    <FullPageWizardLayout
      title="Risk Triggers"
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

function LoadingState() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo =
    (location.state as { returnTo?: string })?.returnTo || '/dashboard';

  return (
    <FullPageWizardLayout
      title="Risk Triggers"
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

function ErrorState({ message }: { message: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo =
    (location.state as { returnTo?: string })?.returnTo || '/dashboard';

  return (
    <FullPageWizardLayout
      title="Risk Triggers"
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

function RiskTriggersDataLoader() {
  const { chain, nftId } = useParams<{
    protocol: string;
    chain: string;
    nftId: string;
  }>();

  if (!chain || !nftId || !isValidChainSlug(chain)) {
    return <ErrorState message="Invalid position URL." />;
  }

  const chainId = getChainId(chain);

  return (
    <RiskTriggersWizardProvider>
      <DataFetcher chainId={chainId} nftId={nftId} />
    </RiskTriggersWizardProvider>
  );
}

function DataFetcher({
  chainId,
  nftId,
}: {
  chainId: number;
  nftId: string;
}) {
  const {
    setPosition,
    setPositionLoading,
    setPositionError,
    setDiscoveredPool,
    initializeFromOrders,
  } = useRiskTriggersWizard();

  const positionQuery = useUniswapV3Position(chainId, nftId);
  const discoverPool = useDiscoverPool();
  const closeOrdersQuery = useCloseOrders({
    chainId,
    nftId,
    status: 'active',
  });

  // Load position into context
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
  }, [
    positionQuery.data,
    positionQuery.isLoading,
    positionQuery.error,
    setPosition,
    setPositionLoading,
    setPositionError,
  ]);

  // Discover pool for PnL simulation
  const poolDiscovered = useRef(false);
  useEffect(() => {
    if (positionQuery.data && !poolDiscovered.current) {
      poolDiscovered.current = true;
      const poolAddress = positionQuery.data.config.poolAddress;
      const posChainId = positionQuery.data.config.chainId;

      discoverPool
        .mutateAsync({ chainId: posChainId, address: poolAddress })
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

  // Initialize trigger state from existing close orders
  const ordersInitialized = useRef(false);
  useEffect(() => {
    if (
      closeOrdersQuery.data &&
      positionQuery.data &&
      !ordersInitialized.current
    ) {
      ordersInitialized.current = true;
      const pos = positionQuery.data;
      const baseToken = pos.isToken0Quote ? pos.pool.token1 : pos.pool.token0;
      const quoteToken = pos.isToken0Quote ? pos.pool.token0 : pos.pool.token1;
      const baseAddress = (baseToken.config as { address: string }).address;
      const quoteAddress = (quoteToken.config as { address: string }).address;

      initializeFromOrders(
        closeOrdersQuery.data,
        baseAddress,
        quoteAddress,
        baseToken.decimals,
        pos.isToken0Quote,
      );
    }
  }, [closeOrdersQuery.data, positionQuery.data, initializeFromOrders]);

  if (positionQuery.isLoading || !positionQuery.data) {
    return <LoadingState />;
  }

  if (positionQuery.error) {
    return (
      <ErrorState
        message={`Failed to load position: ${positionQuery.error.message}`}
      />
    );
  }

  return <RiskTriggersWizardContent />;
}

function RiskTriggersWizardContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo =
    (location.state as { returnTo?: string })?.returnTo || '/dashboard';
  const { steps, state, goBack, goToStep } = useRiskTriggersWizard();
  const currentStepId = steps[state.currentStepIndex]?.id;

  const isPopstateRef = useRef(false);
  const prevStepIndexRef = useRef(state.currentStepIndex);

  // Push history entry when navigating forward
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

  // Listen for browser back/forward buttons
  useEffect(() => {
    const handlePopstate = (event: PopStateEvent) => {
      const historyStep = event.state?.wizardStep;

      if (
        typeof historyStep === 'number' &&
        historyStep !== state.currentStepIndex
      ) {
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

  switch (currentStepId) {
    case 'configure':
      return <ConfigureStepRenderer />;
    case 'transaction':
      return <TransactionStepRenderer />;
    default:
      return <ConfigureStepRenderer />;
  }
}

export function RiskTriggersWizard() {
  return <RiskTriggersDataLoader />;
}
