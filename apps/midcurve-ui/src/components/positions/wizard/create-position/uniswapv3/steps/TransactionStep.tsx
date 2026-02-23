/**
 * TransactionStep - Unified transaction execution step
 *
 * Handles all blockchain transactions for creating a UniswapV3 position:
 * 1. Token approvals (if needed)
 * 2. Position minting (with pool price refresh)
 * 3. NFT approval for automation (if SL/TP enabled)
 * 4. SL/TP order registration (if enabled)
 *
 * Displays transactions as a todo-list with checkboxes, spinners, and explorer links.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Circle, Check, Loader2, AlertCircle, Copy } from 'lucide-react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { compareAddresses, UniswapV3Pool, UniswapV3Position, type PoolJSON, type Erc20Token, tickToPrice, formatCompactValue } from '@midcurve/shared';
import { useCreatePositionWizard, computeSwapDirection } from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';
import { AllocatedCapitalSection } from '../shared/AllocatedCapitalSection';
import { PositionRangeSection } from '../shared/PositionRangeSection';
import { RiskTriggersSection } from '../shared/RiskTriggersSection';
import { usePriceAdjustment } from '../hooks/usePriceAdjustment';
import { getNonfungiblePositionManagerAddress } from '@/config/contracts/nonfungible-position-manager';
import { useMintPosition, type MintPositionParams } from '@/hooks/positions/uniswapv3/wizard/useMintPosition';
import { useCreatePositionAPI, extractLiquidityFromLogs } from '@/hooks/positions/uniswapv3/wizard/useCreatePositionAPI';
import { useOperatorApproval } from '@/hooks/automation/useOperatorApproval';
import { useMulticallPositionCloser, type PositionCloserCall } from '@/hooks/automation/useMulticallPositionCloser';
import { useAutowallet } from '@/hooks/automation/useAutowallet';
import { useDiscoverPool } from '@/hooks/pools/useDiscoverPool';
import { SwapDirection } from '@/config/automation-contracts';
import { useChainSharedContract } from '@/hooks/automation/useChainSharedContract';
import { getChainSlugByChainId } from '@/config/chains';
import { AddToPortfolioSection } from '../shared/AddToPortfolioSection';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { useErc20TokenApprovalPrompt } from '@/components/common/Erc20TokenApprovalPrompt';
import { useEvmTransactionPrompt } from '@/components/common/EvmTransactionPrompt';

// Transaction IDs
const TX_IDS = {
  PRICE_ADJUST: 'price-adjust',
  APPROVE_BASE: 'approve-base',
  APPROVE_QUOTE: 'approve-quote',
  REFRESH_POOL: 'refresh-pool',
  MINT_POSITION: 'mint-position',
  APPROVE_NFT: 'approve-nft',
  REGISTER_ORDERS: 'register-orders',
} as const;

export function TransactionStep() {
  const navigate = useNavigate();
  const { address: walletAddress } = useAccount();
  const { state, setStepValid, setDiscoveredPool, setPositionCreated, addTransaction, setAdjustedAmounts, saveOriginalAmounts, setPriceAdjustmentStatus } = useCreatePositionWizard();

  // Current phase of execution
  const [currentPhase, setCurrentPhase] = useState<'idle' | 'approvals' | 'refresh' | 'mint' | 'nft-approval' | 'automation' | 'done'>('idle');
  const [, setActiveError] = useState<{ txId: string; message: string } | null>(null);

  // Track which transactions have been attempted (prevents infinite retry loops on cancel)
  const [attemptedTxs, setAttemptedTxs] = useState<Set<string>>(new Set());

  // Track minted token ID
  const [mintedTokenId, setMintedTokenId] = useState<bigint | undefined>(undefined);

  // Track if mint was successful (used to show success state on all pre-mint items after canceling subscriptions)
  const [mintSucceeded, setMintSucceeded] = useState(false);

  // Get chain ID from discovered pool
  const chainId = state.discoveredPool?.typedConfig.chainId;

  // Save original amounts when first entering this step (if not already saved)
  useEffect(() => {
    if (state.originalAllocatedBaseAmount === '0' && state.originalAllocatedQuoteAmount === '0') {
      if (state.allocatedBaseAmount !== '0' || state.allocatedQuoteAmount !== '0') {
        saveOriginalAmounts();
      }
    }
  }, [state.originalAllocatedBaseAmount, state.originalAllocatedQuoteAmount, state.allocatedBaseAmount, state.allocatedQuoteAmount, saveOriginalAmounts]);

  // Get effective tick range (use configured or defaults)
  const effectiveTickLower = state.tickLower !== 0 ? state.tickLower : state.defaultTickLower;
  const effectiveTickUpper = state.tickUpper !== 0 ? state.tickUpper : state.defaultTickUpper;

  // Get automation wallet
  const { data: autowallet } = useAutowallet();
  const autowalletAddress = autowallet?.address as Address | undefined;

  // Pool discovery hook for price refresh
  const discoverPool = useDiscoverPool();

  // Look up automation contract dynamically from DB (chain-only endpoint, no nftId needed)
  const { data: sharedContract } = useChainSharedContract(chainId);
  const positionCloserAddress = (sharedContract?.contractAddress ?? null) as Address | null;

  // Determine if automation is enabled
  const hasAutomation = state.automationEnabled && (state.stopLossEnabled || state.takeProfitEnabled);

  // Determine base/quote token addresses and amounts
  // Use adjusted amounts if available (from PriceAdjustmentStep), otherwise fall back to allocated amounts
  const baseTokenAddress = state.baseToken?.address as Address | undefined;
  const quoteTokenAddress = state.quoteToken?.address as Address | undefined;

  const baseAmount = state.adjustedBaseAmount && state.adjustedBaseAmount !== '0'
    ? BigInt(state.adjustedBaseAmount)
    : state.allocatedBaseAmount ? BigInt(state.allocatedBaseAmount) : 0n;
  const quoteAmount = state.adjustedQuoteAmount && state.adjustedQuoteAmount !== '0'
    ? BigInt(state.adjustedQuoteAmount)
    : state.allocatedQuoteAmount ? BigInt(state.allocatedQuoteAmount) : 0n;

  // Get spender address for approvals (NonfungiblePositionManager)
  const spenderAddress = chainId ? getNonfungiblePositionManagerAddress(chainId) : null;

  // Use ORIGINAL allocated amounts for approval required amount
  // This ensures approval is sufficient for any price movement (adjusted amounts are always <= original)
  const originalBaseAmount = state.originalAllocatedBaseAmount && state.originalAllocatedBaseAmount !== '0'
    ? BigInt(state.originalAllocatedBaseAmount)
    : state.allocatedBaseAmount ? BigInt(state.allocatedBaseAmount) : 0n;
  const originalQuoteAmount = state.originalAllocatedQuoteAmount && state.originalAllocatedQuoteAmount !== '0'
    ? BigInt(state.originalAllocatedQuoteAmount)
    : state.allocatedQuoteAmount ? BigInt(state.allocatedQuoteAmount) : 0n;

  // Token approval hooks using the unified approval prompt component
  const baseApprovalPrompt = useErc20TokenApprovalPrompt({
    tokenAddress: baseTokenAddress ?? null,
    tokenSymbol: state.baseToken?.symbol || 'Base Token',
    tokenDecimals: state.baseToken?.decimals ?? 18,
    requiredAmount: originalBaseAmount,
    spenderAddress: spenderAddress ?? null,
    chainId,
    enabled: !!baseTokenAddress && !!walletAddress && !!chainId && originalBaseAmount > 0n,
  });

  const quoteApprovalPrompt = useErc20TokenApprovalPrompt({
    tokenAddress: quoteTokenAddress ?? null,
    tokenSymbol: state.quoteToken?.symbol || 'Quote Token',
    tokenDecimals: state.quoteToken?.decimals ?? 18,
    requiredAmount: originalQuoteAmount,
    spenderAddress: spenderAddress ?? null,
    chainId,
    enabled: !!quoteTokenAddress && !!walletAddress && !!chainId && originalQuoteAmount > 0n,
  });

  // Combined approval status from the unified hooks
  const isBaseApproved = baseApprovalPrompt.isApproved;
  const isQuoteApproved = quoteApprovalPrompt.isApproved;

  // Helper to check if error is user rejection (not a real error)
  const isUserRejection = (error: Error | null | undefined): boolean => {
    if (!error) return false;
    const message = error.message?.toLowerCase() || '';
    return message.includes('user rejected') || message.includes('user denied');
  };

  // Determine token0/token1 based on pool ordering
  const mintParams = useMemo((): MintPositionParams | null => {
    if (!state.discoveredPool || !walletAddress || !chainId || !baseTokenAddress || !quoteTokenAddress) {
      return null;
    }

    const pool = state.discoveredPool;
    const token0Address = pool.token0.config.address as string;
    const token1Address = pool.token1.config.address as string;

    // Determine if base token is token0 or token1
    const isBaseToken0 = compareAddresses(baseTokenAddress, token0Address) === 0;

    // Map amounts to token0/token1 order
    const amount0 = isBaseToken0 ? baseAmount : quoteAmount;
    const amount1 = isBaseToken0 ? quoteAmount : baseAmount;

    return {
      token0: token0Address as Address,
      token1: token1Address as Address,
      fee: pool.typedConfig.feeBps,
      tickLower: effectiveTickLower,
      tickUpper: effectiveTickUpper,
      amount0Desired: amount0,
      amount1Desired: amount1,
      tickSpacing: pool.typedConfig.tickSpacing,
      recipient: walletAddress,
      chainId,
      slippageBps: 100, // 1% slippage tolerance
    };
  }, [state.discoveredPool, walletAddress, chainId, baseTokenAddress, quoteTokenAddress, baseAmount, quoteAmount, effectiveTickLower, effectiveTickUpper]);

  // Mint position hook
  const mint = useMintPosition(mintParams);

  // API hook for creating position in database
  const createPositionAPI = useCreatePositionAPI();

  // Check if approvals are complete (for showing mint button when approvals were already done)
  const approvalsComplete = (baseAmount === 0n || isBaseApproved) && (quoteAmount === 0n || isQuoteApproved);

  // Use the price adjustment hook to watch for price changes and recalculate amounts
  // Enable when approvals are complete so amounts are ready BEFORE user clicks mint
  const priceAdjustmentEnabled = approvalsComplete || currentPhase === 'refresh' || currentPhase === 'mint';
  const priceAdjustment = usePriceAdjustment({
    discoveredPool: state.discoveredPool,
    originalBaseAmount: state.originalAllocatedBaseAmount || state.allocatedBaseAmount,
    originalQuoteAmount: state.originalAllocatedQuoteAmount || state.allocatedQuoteAmount,
    tickLower: effectiveTickLower,
    tickUpper: effectiveTickUpper,
    baseToken: state.baseToken,
    quoteToken: state.quoteToken,
    enabled: priceAdjustmentEnabled,
    pollIntervalMs: 1000, // Poll once per second as requested
  });

  // Update context with adjusted amounts when price adjustment is ready
  useEffect(() => {
    if (priceAdjustment.status === 'ready') {
      setAdjustedAmounts(
        priceAdjustment.adjustedBaseAmount,
        priceAdjustment.adjustedQuoteAmount,
        priceAdjustment.adjustedLiquidity,
        priceAdjustment.adjustedTotalQuoteValue
      );
      setPriceAdjustmentStatus('ready');
    } else if (priceAdjustment.status === 'calculating') {
      setPriceAdjustmentStatus('calculating');
    } else if (priceAdjustment.status === 'error') {
      setPriceAdjustmentStatus('error');
    }
  }, [priceAdjustment.status, priceAdjustment.adjustedBaseAmount, priceAdjustment.adjustedQuoteAmount, priceAdjustment.adjustedLiquidity, priceAdjustment.adjustedTotalQuoteValue, setAdjustedAmounts, setPriceAdjustmentStatus]);

  // Mint transaction prompt using the unified component
  const mintPrompt = useEvmTransactionPrompt({
    label: 'Open UniswapV3 Position',
    buttonLabel: 'Open',
    chainId,
    enabled: !!mintParams,
    // Show button when in mint phase OR when idle but approvals are already complete
    showActionButton: currentPhase === 'mint' || (currentPhase === 'idle' && approvalsComplete),
    txHash: mint.mintTxHash,
    isSubmitting: mint.isMinting,
    isWaitingForConfirmation: mint.isWaitingForConfirmation,
    isSuccess: mint.isSuccess,
    error: mint.mintError,
    onExecute: () => {
      // Ensure we're in mint phase (in case we started from idle with approvals already done)
      if (currentPhase === 'idle') {
        setCurrentPhase('mint');
      }
      setAttemptedTxs(prev => new Set(prev).add(TX_IDS.MINT_POSITION));
      mint.mint();
    },
    onReset: () => {
      setAttemptedTxs(prev => {
        const next = new Set(prev);
        next.delete(TX_IDS.MINT_POSITION);
        return next;
      });
      mint.reset();
    },
  });

  // NFT operator approval hook (for automation contract)
  const nftApproval = useOperatorApproval(chainId, positionCloserAddress ?? undefined);

  // Multicall hook for registering SL/TP orders in a single transaction
  const multicallOrders = useMulticallPositionCloser(
    chainId ?? 0,
    mintedTokenId?.toString() ?? '',
    { abi: sharedContract?.abi, contractAddress: positionCloserAddress }
  );

  // NFT approval transaction prompt using the unified component
  const nftApprovalPrompt = useEvmTransactionPrompt({
    label: 'Approve Position for Automation',
    buttonLabel: 'Approve',
    chainId,
    enabled: hasAutomation && mintSucceeded,
    showActionButton: currentPhase === 'nft-approval',
    txHash: nftApproval.txHash,
    isSubmitting: nftApproval.isApproving,
    isWaitingForConfirmation: nftApproval.isWaitingForConfirmation,
    isSuccess: nftApproval.isApprovalSuccess || nftApproval.isApproved,
    error: nftApproval.error,
    onExecute: () => {
      setAttemptedTxs(prev => new Set(prev).add(TX_IDS.APPROVE_NFT));
      nftApproval.approve();
    },
    onReset: () => {
      setAttemptedTxs(prev => {
        const next = new Set(prev);
        next.delete(TX_IDS.APPROVE_NFT);
        return next;
      });
      nftApproval.reset();
    },
  });

  // Determine per-order swap directions from user-configured swap configs
  const isToken0Quote = useMemo(() => {
    if (!state.discoveredPool || !quoteTokenAddress) return false;
    const token0Address = state.discoveredPool.token0.config.address as string;
    return compareAddresses(quoteTokenAddress, token0Address) === 0;
  }, [state.discoveredPool, quoteTokenAddress]);

  // SL swap direction (for on-chain registration)
  const slSwapDirection = useMemo(() => {
    if (!state.slSwapConfig.enabled || !state.discoveredPool || !quoteTokenAddress) return SwapDirection.NONE;
    const dir = computeSwapDirection(state.slSwapConfig.swapToQuote, isToken0Quote);
    return dir === 'TOKEN0_TO_1' ? SwapDirection.TOKEN0_TO_1 : SwapDirection.TOKEN1_TO_0;
  }, [state.slSwapConfig, state.discoveredPool, quoteTokenAddress, isToken0Quote]);

  // TP swap direction (for on-chain registration)
  const tpSwapDirection = useMemo(() => {
    if (!state.tpSwapConfig.enabled || !state.discoveredPool || !quoteTokenAddress) return SwapDirection.NONE;
    const dir = computeSwapDirection(state.tpSwapConfig.swapToQuote, isToken0Quote);
    return dir === 'TOKEN0_TO_1' ? SwapDirection.TOKEN0_TO_1 : SwapDirection.TOKEN1_TO_0;
  }, [state.tpSwapConfig, state.discoveredPool, quoteTokenAddress, isToken0Quote]);

  // Build multicall calls for order registration
  const buildRegisterOrderCalls = useCallback((): PositionCloserCall[] => {
    if (!mintedTokenId || !walletAddress || !autowalletAddress) return [];

    const poolAddress = state.discoveredPool?.typedConfig.address as Address | undefined;
    if (!poolAddress) return [];

    const calls: PositionCloserCall[] = [];

    if (state.stopLossEnabled && state.stopLossTick !== null) {
      calls.push({
        functionName: 'registerOrder',
        args: [{
          nftId: mintedTokenId,
          pool: poolAddress,
          triggerMode: isToken0Quote ? 1 : 0,
          triggerTick: state.stopLossTick,
          payout: walletAddress,
          operator: autowalletAddress,
          validUntil: 0n,
          slippageBps: state.slSwapConfig.exitSlippageBps,
          swapDirection: slSwapDirection,
          swapSlippageBps: state.slSwapConfig.enabled ? state.slSwapConfig.slippageBps : 0,
        }],
      });
    }

    if (state.takeProfitEnabled && state.takeProfitTick !== null) {
      calls.push({
        functionName: 'registerOrder',
        args: [{
          nftId: mintedTokenId,
          pool: poolAddress,
          triggerMode: isToken0Quote ? 0 : 1,
          triggerTick: state.takeProfitTick,
          payout: walletAddress,
          operator: autowalletAddress,
          validUntil: 0n,
          slippageBps: state.tpSwapConfig.exitSlippageBps,
          swapDirection: tpSwapDirection,
          swapSlippageBps: state.tpSwapConfig.enabled ? state.tpSwapConfig.slippageBps : 0,
        }],
      });
    }

    return calls;
  }, [mintedTokenId, walletAddress, autowalletAddress, state.discoveredPool, state.stopLossEnabled, state.stopLossTick, state.takeProfitEnabled, state.takeProfitTick, state.slSwapConfig, state.tpSwapConfig, isToken0Quote, slSwapDirection, tpSwapDirection]);

  // Order registration label
  const registerOrdersLabel = [
    state.stopLossEnabled && 'Stop Loss',
    state.takeProfitEnabled && 'Take Profit',
  ].filter(Boolean).join(' & ');

  // Order registration transaction prompt using the unified component
  const registerOrdersPrompt = useEvmTransactionPrompt({
    label: `Register ${registerOrdersLabel}`,
    buttonLabel: 'Register',
    chainId,
    enabled: hasAutomation && !!mintedTokenId && multicallOrders.isReady,
    showActionButton: currentPhase === 'automation',
    txHash: multicallOrders.txHash,
    isSubmitting: multicallOrders.isSubmitting,
    isWaitingForConfirmation: multicallOrders.isWaitingForConfirmation,
    isSuccess: multicallOrders.isSuccess,
    error: multicallOrders.error,
    onExecute: () => {
      const calls = buildRegisterOrderCalls();
      if (calls.length > 0) {
        setAttemptedTxs(prev => new Set(prev).add(TX_IDS.REGISTER_ORDERS));
        multicallOrders.execute(calls);
      }
    },
    onReset: () => {
      setAttemptedTxs(prev => {
        const next = new Set(prev);
        next.delete(TX_IDS.REGISTER_ORDERS);
        return next;
      });
      multicallOrders.reset();
    },
  });

  // Determine correct logo based on which token is base/quote
  const getTokenLogoUrl = (tokenAddress: string | undefined) => {
    if (!tokenAddress || !state.discoveredPool) return null;
    const normalizedAddress = tokenAddress.toLowerCase();
    if ((state.discoveredPool.token0 as Erc20Token).address.toLowerCase() === normalizedAddress) {
      return state.discoveredPool.token0.logoUrl;
    }
    if ((state.discoveredPool.token1 as Erc20Token).address.toLowerCase() === normalizedAddress) {
      return state.discoveredPool.token1.logoUrl;
    }
    return null;
  };

  const actualBaseLogoUrl = getTokenLogoUrl(state.baseToken?.address);
  const actualQuoteLogoUrl = getTokenLogoUrl(state.quoteToken?.address);

  // Determine if token0 is base (for price calculations)
  const isToken0Base = useMemo(() => {
    if (!state.discoveredPool || !state.baseToken) return true;
    return compareAddresses(
      state.discoveredPool.token0.config.address as string,
      state.baseToken.address
    ) === 0;
  }, [state.discoveredPool, state.baseToken]);

  // Calculate SL/TP prices from ticks for summary panel display
  const slTpPrices = useMemo(() => {
    if (!state.discoveredPool || !state.baseToken || !state.quoteToken) {
      return { stopLossPrice: null, takeProfitPrice: null };
    }

    const baseTokenDecimals = isToken0Base
      ? state.discoveredPool.token0.decimals
      : state.discoveredPool.token1.decimals;

    let stopLossPrice: bigint | null = null;
    let takeProfitPrice: bigint | null = null;

    try {
      if (state.stopLossEnabled && state.stopLossTick !== null) {
        stopLossPrice = tickToPrice(
          state.stopLossTick,
          state.baseToken.address,
          state.quoteToken.address,
          baseTokenDecimals
        );
      }

      if (state.takeProfitEnabled && state.takeProfitTick !== null) {
        takeProfitPrice = tickToPrice(
          state.takeProfitTick,
          state.baseToken.address,
          state.quoteToken.address,
          baseTokenDecimals
        );
      }
    } catch {
      // Ignore conversion errors
    }

    return { stopLossPrice, takeProfitPrice };
  }, [state.discoveredPool, state.baseToken, state.quoteToken, state.stopLossEnabled, state.stopLossTick, state.takeProfitEnabled, state.takeProfitTick, isToken0Base]);

  // Calculate range boundary prices for summary display
  const rangeBoundaryInfo = useMemo(() => {
    if (!state.discoveredPool || !state.baseToken || !state.quoteToken) {
      return null;
    }

    try {
      const effectiveTickLower = state.tickLower !== 0 ? state.tickLower : state.defaultTickLower;
      const effectiveTickUpper = state.tickUpper !== 0 ? state.tickUpper : state.defaultTickUpper;

      if (effectiveTickLower === 0 && effectiveTickUpper === 0) {
        return null;
      }

      const baseTokenDecimals = isToken0Base
        ? state.discoveredPool.token0.decimals
        : state.discoveredPool.token1.decimals;

      const lowerPriceBigInt = tickToPrice(
        effectiveTickLower,
        state.baseToken.address,
        state.quoteToken.address,
        baseTokenDecimals
      );
      const upperPriceBigInt = tickToPrice(
        effectiveTickUpper,
        state.baseToken.address,
        state.quoteToken.address,
        baseTokenDecimals
      );

      return { lowerPriceBigInt, upperPriceBigInt };
    } catch {
      return null;
    }
  }, [state.discoveredPool, state.baseToken, state.quoteToken, state.tickLower, state.tickUpper, state.defaultTickLower, state.defaultTickUpper, isToken0Base]);

  // Create simulation position for PnL calculations
  const simulationPosition = useMemo(() => {
    // Use adjusted liquidity if available, otherwise fall back to original
    const liquidityBigInt = state.adjustedLiquidity && state.adjustedLiquidity !== '0'
      ? BigInt(state.adjustedLiquidity)
      : BigInt(state.liquidity || '0');
    if (!state.discoveredPool || liquidityBigInt === 0n) {
      return null;
    }

    try {
      const effectiveTickLower = state.tickLower !== 0 ? state.tickLower : state.defaultTickLower;
      const effectiveTickUpper = state.tickUpper !== 0 ? state.tickUpper : state.defaultTickUpper;

      if (effectiveTickLower === 0 && effectiveTickUpper === 0) {
        return null;
      }

      // Use adjusted total value if available, otherwise fall back to original
      const costBasis = state.adjustedTotalQuoteValue && state.adjustedTotalQuoteValue !== '0'
        ? BigInt(state.adjustedTotalQuoteValue)
        : BigInt(state.totalQuoteValue || '0');

      return UniswapV3Position.forSimulation({
        pool: state.discoveredPool,
        isToken0Quote: !isToken0Base,
        tickLower: effectiveTickLower,
        tickUpper: effectiveTickUpper,
        liquidity: liquidityBigInt,
        costBasis,
      });
    } catch {
      return null;
    }
  }, [state.discoveredPool, state.liquidity, state.tickLower, state.tickUpper, state.defaultTickLower, state.defaultTickUpper, state.totalQuoteValue, isToken0Base]);

  // Calculate max drawdown (loss at SL price)
  const slDrawdown = useMemo(() => {
    if (!slTpPrices.stopLossPrice || !simulationPosition) return null;
    try {
      const result = simulationPosition.simulatePnLAtPrice(slTpPrices.stopLossPrice);
      return {
        pnlValue: result.pnlValue,
        pnlPercent: result.pnlPercent,
      };
    } catch {
      return null;
    }
  }, [slTpPrices.stopLossPrice, simulationPosition]);

  // Calculate max runup (profit at TP price)
  const tpRunup = useMemo(() => {
    if (!slTpPrices.takeProfitPrice || !simulationPosition) return null;
    try {
      const result = simulationPosition.simulatePnLAtPrice(slTpPrices.takeProfitPrice);
      return {
        pnlValue: result.pnlValue,
        pnlPercent: result.pnlPercent,
      };
    } catch {
      return null;
    }
  }, [slTpPrices.takeProfitPrice, simulationPosition]);

  // Track approval completion and move to next phase
  useEffect(() => {
    if (currentPhase !== 'approvals') return;

    // Check for errors from approval hooks
    if (baseApprovalPrompt.error) {
      setActiveError({ txId: TX_IDS.APPROVE_BASE, message: baseApprovalPrompt.error });
      return;
    }
    if (quoteApprovalPrompt.error) {
      setActiveError({ txId: TX_IDS.APPROVE_QUOTE, message: quoteApprovalPrompt.error });
      return;
    }

    // Check if all approvals are complete
    const baseOk = baseAmount === 0n || isBaseApproved;
    const quoteOk = quoteAmount === 0n || isQuoteApproved;

    if (baseOk && quoteOk) {
      // Move to pool refresh phase
      setCurrentPhase('refresh');
    }
  }, [currentPhase, baseAmount, quoteAmount, isBaseApproved, isQuoteApproved, baseApprovalPrompt.error, quoteApprovalPrompt.error]);

  // Pool price refresh
  useEffect(() => {
    if (currentPhase !== 'refresh') return;
    if (!state.discoveredPool) return;

    const refreshPool = async () => {
      try {
        const result = await discoverPool.mutateAsync({
          chainId: state.discoveredPool!.typedConfig.chainId,
          address: state.discoveredPool!.typedConfig.address,
        });

        // Deserialize JSON to class instance
        const poolInstance = UniswapV3Pool.fromJSON(result.pool as unknown as PoolJSON);
        setDiscoveredPool(poolInstance);

        // Move to mint phase
        setCurrentPhase('mint');
      } catch {
        // Continue anyway - use existing pool state
        setCurrentPhase('mint');
      }
    };

    refreshPool();
  }, [currentPhase, state.discoveredPool, discoverPool, setDiscoveredPool]);

  // Trigger mint when entering mint phase
  useEffect(() => {
    if (currentPhase !== 'mint') return;
    if (mint.isMinting || mint.isWaitingForConfirmation || mint.isSuccess || mint.mintError) {
      return;
    }
    if (attemptedTxs.has(TX_IDS.MINT_POSITION)) {
      return;
    }

    setAttemptedTxs(prev => new Set(prev).add(TX_IDS.MINT_POSITION));
    mint.mint();
  }, [currentPhase, mint, attemptedTxs]);

  // Track mint completion
  useEffect(() => {
    if (currentPhase !== 'mint') return;

    // Filter user rejection errors (silently ignored)
    const mintErrorFiltered = isUserRejection(mint.mintError) ? null : mint.mintError;
    if (mintErrorFiltered) {
      setActiveError({ txId: TX_IDS.MINT_POSITION, message: mintErrorFiltered.message });
      return;
    }

    if (mint.isSuccess && mint.tokenId !== undefined) {
      setMintedTokenId(mint.tokenId);
      setMintSucceeded(true);

      // Cancel all polling subscriptions - transaction is complete, no need to keep watching
      baseApprovalPrompt.cancel();
      quoteApprovalPrompt.cancel();
      priceAdjustment.cancel();

      // Record transaction
      if (mint.mintTxHash) {
        addTransaction({
          hash: mint.mintTxHash,
          type: 'mint',
          label: 'Open Position',
          status: 'confirmed',
        });
      }

      // Call API to save position to database
      if (
        mint.logs &&
        chainId &&
        walletAddress &&
        state.discoveredPool &&
        quoteTokenAddress &&
        !createPositionAPI.isPending &&
        !createPositionAPI.isSuccess
      ) {
        const chainSlug = getChainSlugByChainId(chainId);
        if (chainSlug) {
          const liquidity = extractLiquidityFromLogs(mint.logs);
          const isToken0Quote =
            (state.discoveredPool.token0.config.address as string).toLowerCase() ===
            quoteTokenAddress.toLowerCase();

          createPositionAPI.mutate({
            chainId: chainSlug,
            nftId: mint.tokenId.toString(),
            poolAddress: state.discoveredPool.typedConfig.address as Address,
            tickLower: effectiveTickLower,
            tickUpper: effectiveTickUpper,
            ownerAddress: walletAddress,
            isToken0Quote,
            liquidity,
            mintTxHash: mint.mintTxHash,
          });
        }
      }

      // Set position created in wizard state
      setPositionCreated(`pos_${mint.tokenId.toString()}`, mint.tokenId.toString());

      if (hasAutomation) {
        // Move to NFT approval phase
        setCurrentPhase('nft-approval');
      } else {
        // No automation, we're done
        setCurrentPhase('done');
      }
    }
  }, [currentPhase, mint.isSuccess, mint.tokenId, mint.mintError, mint.mintTxHash, mint.logs, hasAutomation, setPositionCreated, addTransaction, baseApprovalPrompt, quoteApprovalPrompt, priceAdjustment, chainId, walletAddress, state.discoveredPool, quoteTokenAddress, effectiveTickLower, effectiveTickUpper, createPositionAPI]);

  // NFT approval phase - skip to automation if already approved
  useEffect(() => {
    if (currentPhase !== 'nft-approval') return;
    if (!hasAutomation) return;

    if (nftApproval.isApproved) {
      setCurrentPhase('automation');
    }
  }, [currentPhase, hasAutomation, nftApproval.isApproved]);

  // Track NFT approval completion
  useEffect(() => {
    if (currentPhase !== 'nft-approval') return;

    if (nftApproval.isApprovalSuccess) {
      setCurrentPhase('automation');
    }
  }, [currentPhase, nftApproval.isApprovalSuccess]);

  // Track SL/TP multicall completion
  useEffect(() => {
    if (currentPhase !== 'automation') return;

    // Check for errors (filter user rejections - silently ignored)
    const mcError = isUserRejection(multicallOrders.error) ? null : multicallOrders.error;
    if (mcError) {
      setActiveError({ txId: TX_IDS.REGISTER_ORDERS, message: mcError.message });
      return;
    }

    if (multicallOrders.isSuccess) {
      // Record transaction
      if (multicallOrders.txHash) {
        addTransaction({
          hash: multicallOrders.txHash,
          type: 'register-orders',
          label: 'Register SL/TP Orders',
          status: 'confirmed',
        });
      }

      setCurrentPhase('done');
    }
  }, [currentPhase, multicallOrders.isSuccess, multicallOrders.error, multicallOrders.txHash, addTransaction]);

  // Update step validation
  useEffect(() => {
    setStepValid('transactions', currentPhase === 'done');
  }, [currentPhase, setStepValid]);

  // Complete when all transactions done AND position added to portfolio
  const isComplete = currentPhase === 'done' && createPositionAPI.isSuccess;

  // Render price adjustment item (special handling for pool price confirmation)
  const renderPriceAdjustmentItem = () => {
    const hookStatus = priceAdjustment.status;
    const isEnabled = priceAdjustmentEnabled;

    // Determine display status:
    // - Mint succeeded: always show success (subscriptions are cancelled)
    // - Not enabled yet (approvals not done): pending
    // - Enabled and calculating: calculating
    // - Enabled and ready: success
    // - Error: error
    const displayStatus = mintSucceeded
      ? 'success'
      : !isEnabled
        ? 'pending'
        : hookStatus === 'calculating'
          ? 'calculating'
          : hookStatus === 'error'
            ? 'error'
            : hookStatus === 'ready'
              ? 'success'
              : 'pending';

    const isActive = displayStatus === 'calculating';
    const isError = displayStatus === 'error';
    const isSuccess = displayStatus === 'success';
    const isPending = displayStatus === 'pending';

    // Calculate current price from sqrtPriceX96
    const currentPriceText = useMemo(() => {
      if (!priceAdjustment.currentSqrtPriceX96 || !state.discoveredPool || !state.baseToken || !state.quoteToken) {
        return null;
      }

      try {
        const pool = state.discoveredPool;
        const sqrtPriceX96 = priceAdjustment.currentSqrtPriceX96;

        const isToken0Base = compareAddresses(
          pool.token0.config.address as string,
          state.baseToken.address
        ) === 0;

        // price = (sqrtPriceX96 / 2^96)^2
        const Q96 = 2n ** 96n;
        const Q192 = Q96 * Q96;
        const rawPriceNum = sqrtPriceX96 * sqrtPriceX96;

        const token0Decimals = pool.token0.decimals;
        const token1Decimals = pool.token1.decimals;
        const quoteDecimals = state.quoteToken.decimals;

        // Calculate price as bigint with quote token decimals precision
        let priceBigint: bigint;
        if (isToken0Base) {
          // Price is token1/token0 (quote per base)
          const decimalDiff = token0Decimals - token1Decimals;
          if (decimalDiff >= 0) {
            const adjustment = 10n ** BigInt(decimalDiff);
            priceBigint = (rawPriceNum * adjustment * (10n ** BigInt(quoteDecimals))) / Q192;
          } else {
            const adjustment = 10n ** BigInt(-decimalDiff);
            priceBigint = (rawPriceNum * (10n ** BigInt(quoteDecimals))) / (Q192 * adjustment);
          }
        } else {
          // Price is token0/token1 (quote per base) = 1 / (token1/token0)
          const decimalDiff = token1Decimals - token0Decimals;
          if (decimalDiff >= 0) {
            const adjustment = 10n ** BigInt(decimalDiff);
            priceBigint = (Q192 * adjustment * (10n ** BigInt(quoteDecimals))) / rawPriceNum;
          } else {
            const adjustment = 10n ** BigInt(-decimalDiff);
            priceBigint = (Q192 * (10n ** BigInt(quoteDecimals))) / (rawPriceNum * adjustment);
          }
        }

        return formatCompactValue(priceBigint, quoteDecimals);
      } catch {
        return null;
      }
    }, [priceAdjustment.currentSqrtPriceX96, state.discoveredPool, state.baseToken, state.quoteToken]);

    return (
      <div
        className={`py-3 px-4 rounded-lg transition-colors ${
          isError
            ? 'bg-red-500/10 border border-red-500/30'
            : isSuccess
            ? 'bg-green-500/10 border border-green-500/20'
            : isActive
            ? 'bg-blue-500/10 border border-blue-500/20'
            : 'bg-slate-700/30 border border-slate-600/20'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Status Icon */}
            {isPending && <Circle className="w-5 h-5 text-slate-500" />}
            {isActive && <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />}
            {isSuccess && <Check className="w-5 h-5 text-green-400" />}
            {isError && <AlertCircle className="w-5 h-5 text-red-400" />}

            {/* Label */}
            <span
              className={
                isSuccess
                  ? 'text-slate-400'
                  : isError
                  ? 'text-red-300'
                  : 'text-white'
              }
            >
              Confirm Pool Price
            </span>
          </div>

          {/* Current price display */}
          <div className="flex items-center gap-2">
            {isSuccess && currentPriceText && (
              <span className="text-sm text-slate-300">
                {currentPriceText} {state.quoteToken?.symbol}
              </span>
            )}
            {isActive && (
              <span className="text-sm text-blue-400">Calculating...</span>
            )}
          </div>
        </div>

        {/* Error message */}
        {isError && priceAdjustment.error && (
          <div className="mt-2 pl-8 flex gap-2">
            <div className="flex-1 max-h-20 overflow-y-auto text-sm text-red-400/80 bg-red-950/30 rounded p-2">
              {priceAdjustment.error}
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(priceAdjustment.error || '')}
              className="flex-shrink-0 p-1.5 text-red-400/60 hover:text-red-400 transition-colors cursor-pointer"
              title="Copy error to clipboard"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    );
  };


  const renderInteractive = () => {
    if (!walletAddress) {
      return (
        <div className="h-full flex flex-col">
          <h3 className="text-lg font-semibold text-white mb-4">Execute Transactions</h3>
          <div className="flex-1 flex items-center justify-center">
            <EvmWalletConnectionPrompt
              title="Connect Wallet"
              description="Please connect your wallet to execute transactions"
            />
          </div>
        </div>
      );
    }

    return (
      <div className="h-full flex flex-col">
        <h3 className="text-lg font-semibold text-white mb-6">Execute Transactions</h3>

        {/* Transaction List */}
        <div className="flex-1 space-y-3 overflow-auto">
          {/* Base token approval - show static success after mint, otherwise hook element */}
          {baseAmount > 0n && (mintSucceeded ? (
            <div className="py-3 px-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-3">
                <Check className="w-5 h-5 text-green-400" />
                <span className="text-slate-400">Approve {state.baseToken?.symbol}</span>
              </div>
            </div>
          ) : baseApprovalPrompt.element)}

          {/* Quote token approval - show static success after mint, otherwise hook element */}
          {quoteAmount > 0n && (mintSucceeded ? (
            <div className="py-3 px-4 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-3">
                <Check className="w-5 h-5 text-green-400" />
                <span className="text-slate-400">Approve {state.quoteToken?.symbol}</span>
              </div>
            </div>
          ) : quoteApprovalPrompt.element)}

          {/* Price adjustment (confirms current pool price) - between approvals and mint */}
          {renderPriceAdjustmentItem()}

          {/* Mint position (rendered by hook) */}
          {mintPrompt.element}

          {/* Add to Portfolio Section - Only show after mint success */}
          {mintSucceeded && mintedTokenId && (
            <AddToPortfolioSection
              isPending={createPositionAPI.isPending}
              isSuccess={createPositionAPI.isSuccess}
              isError={createPositionAPI.isError}
              error={
                createPositionAPI.error instanceof Error
                  ? createPositionAPI.error
                  : null
              }
            />
          )}

          {/* NFT approval - rendered by hook */}
          {hasAutomation && nftApprovalPrompt.element}

          {/* Order registration - rendered by hook */}
          {(state.stopLossEnabled || state.takeProfitEnabled) && registerOrdersPrompt.element}
        </div>
      </div>
    );
  };

  // Visual area is hidden - return null
  const renderVisual = () => null;

  // Determine amounts to display in summary - use adjusted if available
  const displayBaseAmount = state.adjustedBaseAmount && state.adjustedBaseAmount !== '0'
    ? state.adjustedBaseAmount
    : state.allocatedBaseAmount;
  const displayQuoteAmount = state.adjustedQuoteAmount && state.adjustedQuoteAmount !== '0'
    ? state.adjustedQuoteAmount
    : state.allocatedQuoteAmount;
  const displayTotalValue = state.adjustedTotalQuoteValue && state.adjustedTotalQuoteValue !== '0'
    ? state.adjustedTotalQuoteValue
    : state.totalQuoteValue;

  // Handle finish - navigate to dashboard
  const handleFinish = useCallback(() => {
    navigate('/dashboard');
  }, [navigate]);

  const renderSummary = () => (
    <WizardSummaryPanel
      showFinish={isComplete}
      onFinish={handleFinish}
      showCurrentPrice={false}
    >
      <AllocatedCapitalSection
        allocatedBaseAmount={displayBaseAmount}
        allocatedQuoteAmount={displayQuoteAmount}
        totalQuoteValue={displayTotalValue}
        baseToken={state.baseToken}
        quoteToken={state.quoteToken}
        baseLogoUrl={actualBaseLogoUrl}
        quoteLogoUrl={actualQuoteLogoUrl}
      />

      {/* Position Range */}
      {rangeBoundaryInfo && (
        <PositionRangeSection
          lowerPriceBigInt={rangeBoundaryInfo.lowerPriceBigInt}
          upperPriceBigInt={rangeBoundaryInfo.upperPriceBigInt}
          quoteTokenDecimals={state.quoteToken?.decimals ?? 18}
        />
      )}

      {/* SL/TP Triggers */}
      <RiskTriggersSection
        stopLossPrice={slTpPrices.stopLossPrice}
        takeProfitPrice={slTpPrices.takeProfitPrice}
        slPnlAtTrigger={slDrawdown}
        slDrawdown={slDrawdown}
        tpPnlAtTrigger={tpRunup}
        tpRunup={tpRunup}
        quoteTokenDecimals={state.quoteToken?.decimals ?? 18}
      />
    </WizardSummaryPanel>
  );

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
