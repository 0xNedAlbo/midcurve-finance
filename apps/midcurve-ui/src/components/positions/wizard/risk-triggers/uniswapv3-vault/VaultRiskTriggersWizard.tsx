import { useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { UniswapV3Pool, type PoolJSON } from '@midcurve/shared';
import type { UniswapV3VaultPositionConfigResponse } from '@midcurve/api-shared';
import { FullPageWizardLayout } from '@/components/layout/wizard';
import {
  VaultRiskTriggersWizardProvider,
  useVaultRiskTriggersWizard,
} from './context/VaultRiskTriggersWizardContext';
import { useUniswapV3VaultPosition } from '@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition';
import { useDiscoverPool } from '@/hooks/pools/useDiscoverPool';
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
  const { chain, vaultAddress, ownerAddress } = useParams<{ chain: string; vaultAddress: string; ownerAddress: string }>();
  const { steps, state } = useVaultRiskTriggersWizard();
  const returnTo =
    (location.state as { returnTo?: string })?.returnTo ||
    `/positions/uniswapv3-vault/${chain}/${vaultAddress}/${ownerAddress}`;

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
  const { chain, vaultAddress, ownerAddress } = useParams<{ chain: string; vaultAddress: string; ownerAddress: string }>();
  const returnTo =
    (location.state as { returnTo?: string })?.returnTo ||
    `/positions/uniswapv3-vault/${chain}/${vaultAddress}/${ownerAddress}`;

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
  const { chain, vaultAddress, ownerAddress } = useParams<{ chain: string; vaultAddress: string; ownerAddress: string }>();
  const returnTo =
    (location.state as { returnTo?: string })?.returnTo ||
    `/positions/uniswapv3-vault/${chain}/${vaultAddress}/${ownerAddress}`;

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

function VaultRiskTriggersDataLoader() {
  const { chain, vaultAddress, ownerAddress } = useParams<{
    chain: string;
    vaultAddress: string;
    ownerAddress: string;
  }>();

  if (!chain || !vaultAddress || !ownerAddress || !isValidChainSlug(chain)) {
    return <ErrorState message="Invalid position URL." />;
  }

  const chainId = getChainId(chain);

  return (
    <VaultRiskTriggersWizardProvider>
      <DataFetcher chainId={chainId} vaultAddress={vaultAddress} ownerAddress={ownerAddress} />
    </VaultRiskTriggersWizardProvider>
  );
}

function DataFetcher({
  chainId,
  vaultAddress,
  ownerAddress,
}: {
  chainId: number;
  vaultAddress: string;
  ownerAddress: string;
}) {
  const {
    setPosition,
    setPositionLoading,
    setPositionError,
    setDiscoveredPool,
    setVaultAddress,
    initializeFromOrders,
    hasChanges,
    state,
  } = useVaultRiskTriggersWizard();

  const positionQuery = useUniswapV3VaultPosition(chainId, vaultAddress, ownerAddress);
  const discoverPool = useDiscoverPool();

  // Set vault address in context
  const vaultAddressSet = useRef(false);
  useEffect(() => {
    if (!vaultAddressSet.current) {
      vaultAddressSet.current = true;
      setVaultAddress(vaultAddress);
    }
  }, [vaultAddress, setVaultAddress]);

  // Load position into context (no ref guard — idempotent, always use latest data)
  useEffect(() => {
    if (positionQuery.data) {
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
      const config = positionQuery.data.config as UniswapV3VaultPositionConfigResponse;
      const poolAddress = config.poolAddress;
      const posChainId = config.chainId;

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

  // Initialize trigger state from existing close orders (included in position response).
  // Re-initialize when fresh data arrives (new dataUpdatedAt), but only while the user
  // hasn't started editing (hasChanges) and is still on the configure step.
  const lastInitializedAt = useRef(0);
  useEffect(() => {
    if (
      positionQuery.data &&
      positionQuery.dataUpdatedAt !== lastInitializedAt.current &&
      !hasChanges &&
      state.currentStepIndex === 0
    ) {
      lastInitializedAt.current = positionQuery.dataUpdatedAt;
      const pos = positionQuery.data;

      const baseToken = pos.isToken0Quote ? pos.pool.token1 : pos.pool.token0;
      const quoteToken = pos.isToken0Quote ? pos.pool.token0 : pos.pool.token1;
      const baseAddress = (baseToken.config as { address: string }).address;
      const quoteAddress = (quoteToken.config as { address: string }).address;

      initializeFromOrders(
        pos.closeOrders,
        baseAddress,
        quoteAddress,
        baseToken.decimals,
        pos.isToken0Quote,
      );
    }
  }, [positionQuery.data, positionQuery.dataUpdatedAt, initializeFromOrders, hasChanges, state.currentStepIndex]);

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

  return <VaultRiskTriggersWizardContent />;
}

function VaultRiskTriggersWizardContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { chain, vaultAddress, ownerAddress } = useParams<{ chain: string; vaultAddress: string; ownerAddress: string }>();
  const returnTo =
    (location.state as { returnTo?: string })?.returnTo ||
    `/positions/uniswapv3-vault/${chain}/${vaultAddress}/${ownerAddress}`;
  const { steps, state, goBack, goToStep } = useVaultRiskTriggersWizard();
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

export function VaultRiskTriggersWizard() {
  return <VaultRiskTriggersDataLoader />;
}
