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
import { Circle, Check, Loader2, ExternalLink, AlertCircle, Copy } from 'lucide-react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { compareAddresses, UniswapV3Pool, UniswapV3Position, type PoolJSON, tickToPrice, tickToSqrtRatioX96, formatCompactValue } from '@midcurve/shared';
import { useCreatePositionWizard } from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';
import { AllocatedCapitalSection } from '../shared/AllocatedCapitalSection';
import { PositionRangeSection } from '../shared/PositionRangeSection';
import { RiskTriggersSection } from '../shared/RiskTriggersSection';
import { usePriceAdjustment } from '../hooks/usePriceAdjustment';
import { getNonfungiblePositionManagerAddress } from '@/config/contracts/nonfungible-position-manager';
import { useMintPosition, type MintPositionParams } from '@/hooks/positions/uniswapv3/wizard/useMintPosition';
import { useCreatePositionAPI, extractLiquidityFromReceipt } from '@/hooks/positions/uniswapv3/wizard/useCreatePositionAPI';
import { useOperatorApproval } from '@/hooks/automation/useOperatorApproval';
import { useRegisterCloseOrder } from '@/hooks/automation/useRegisterCloseOrder';
import { useAutowallet } from '@/hooks/automation/useAutowallet';
import { useDiscoverPool } from '@/hooks/pools/useDiscoverPool';
import { TriggerMode, SwapDirection, DEFAULT_CLOSE_ORDER_SLIPPAGE } from '@/config/automation-contracts';
import { useChainSharedContract } from '@/hooks/automation/useChainSharedContract';
import { buildTxUrl, truncateTxHash } from '@/lib/explorer-utils';
import { getChainSlugByChainId } from '@/config/chains';
import { AddToPortfolioSection } from '../shared/AddToPortfolioSection';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';
import { useErc20TokenApprovalPrompt } from '@/components/common/Erc20TokenApprovalPrompt';
import { useEvmTransactionPrompt } from '@/components/common/EvmTransactionPrompt';
import { automationApi } from '@/lib/api-client';

// Transaction item status
type TxStatus = 'pending' | 'waiting' | 'confirming' | 'success' | 'error' | 'skipped';

interface TransactionItem {
  id: string;
  label: string;
  status: TxStatus;
  txHash?: string;
  error?: string;
  hidden?: boolean;
}

// Transaction IDs
const TX_IDS = {
  PRICE_ADJUST: 'price-adjust',
  APPROVE_BASE: 'approve-base',
  APPROVE_QUOTE: 'approve-quote',
  REFRESH_POOL: 'refresh-pool',
  MINT_POSITION: 'mint-position',
  APPROVE_NFT: 'approve-nft',
  REGISTER_SL: 'register-sl',
  REGISTER_TP: 'register-tp',
} as const;

export function TransactionStep() {
  const navigate = useNavigate();
  const { address: walletAddress } = useAccount();
  const { state, setStepValid, setDiscoveredPool, setPositionCreated, addTransaction, setAdjustedAmounts, saveOriginalAmounts, setPriceAdjustmentStatus } = useCreatePositionWizard();

  // Current phase of execution
  const [currentPhase, setCurrentPhase] = useState<'idle' | 'approvals' | 'refresh' | 'mint' | 'nft-approval' | 'automation' | 'done'>('idle');
  const [activeError, setActiveError] = useState<{ txId: string; message: string } | null>(null);

  // Track which transactions have been attempted (prevents infinite retry loops on cancel)
  const [attemptedTxs, setAttemptedTxs] = useState<Set<string>>(new Set());

  // Track minted token ID
  const [mintedTokenId, setMintedTokenId] = useState<bigint | undefined>(undefined);

  // Track if mint was successful (used to show success state on all pre-mint items after canceling subscriptions)
  const [mintSucceeded, setMintSucceeded] = useState(false);

  // Track API notification status for SL/TP orders
  const [slApiDone, setSlApiDone] = useState(false);
  const [tpApiDone, setTpApiDone] = useState(false);

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

  // Close order registration hooks
  const registerSL = useRegisterCloseOrder();
  const registerTP = useRegisterCloseOrder();

  // Determine swap direction for close orders (always swap to quote token)
  const swapDirection = useMemo(() => {
    if (!state.discoveredPool || !quoteTokenAddress) return SwapDirection.NONE;

    const token0Address = state.discoveredPool.token0.config.address as string;
    const isQuoteToken0 = compareAddresses(quoteTokenAddress, token0Address) === 0;

    // If quote is token0, swap token1 → token0
    // If quote is token1, swap token0 → token1
    return isQuoteToken0 ? SwapDirection.TOKEN1_TO_0 : SwapDirection.TOKEN0_TO_1;
  }, [state.discoveredPool, quoteTokenAddress]);

  // Map numeric swap direction to API swap config
  const apiSwapConfig = useMemo(() => {
    if (swapDirection === SwapDirection.NONE) return undefined;
    const directionMap: Record<number, 'TOKEN0_TO_1' | 'TOKEN1_TO_0'> = {
      [SwapDirection.TOKEN0_TO_1]: 'TOKEN0_TO_1',
      [SwapDirection.TOKEN1_TO_0]: 'TOKEN1_TO_0',
    };
    return {
      enabled: true,
      direction: directionMap[swapDirection],
      slippageBps: DEFAULT_CLOSE_ORDER_SLIPPAGE.swapBps,
    };
  }, [swapDirection]);

  // Determine correct logo based on which token is base/quote
  const getTokenLogoUrl = (tokenAddress: string | undefined) => {
    if (!tokenAddress || !state.discoveredPool) return null;
    const normalizedAddress = tokenAddress.toLowerCase();
    if (state.discoveredPool.token0.address.toLowerCase() === normalizedAddress) {
      return state.discoveredPool.token0.logoUrl;
    }
    if (state.discoveredPool.token1.address.toLowerCase() === normalizedAddress) {
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

  // Build transaction list
  const transactions = useMemo((): TransactionItem[] => {
    const txs: TransactionItem[] = [];

    // Price adjustment (first item - confirms current pool price)
    txs.push({
      id: TX_IDS.PRICE_ADJUST,
      label: 'Confirm Pool Price',
      status: getPriceAdjustStatus(priceAdjustment.status, currentPhase),
      error: priceAdjustment.error || undefined,
    });

    // Token approvals are rendered separately via useErc20TokenApprovalPrompt hooks
    // Pool price refresh runs in background - not shown in list

    // Mint position
    const mintErrorFiltered = isUserRejection(mint.mintError) ? null : mint.mintError;
    txs.push({
      id: TX_IDS.MINT_POSITION,
      label: 'Open UniswapV3 Position',
      status: getMintStatus(mint, currentPhase),
      txHash: mint.mintTxHash,
      error: mintErrorFiltered?.message,
    });

    // NFT approval for automation
    if (hasAutomation) {
      const nftErrorFiltered = isUserRejection(nftApproval.error) ? null : nftApproval.error;
      txs.push({
        id: TX_IDS.APPROVE_NFT,
        label: 'Approve Position for Automation',
        status: getNftApprovalStatus(nftApproval, currentPhase),
        txHash: nftApproval.txHash,
        error: nftErrorFiltered?.message,
      });
    }

    // Register Stop Loss
    if (state.stopLossEnabled) {
      const slErrorFiltered = isUserRejection(registerSL.error) ? null : registerSL.error;
      txs.push({
        id: TX_IDS.REGISTER_SL,
        label: 'Register Stop Loss',
        status: getRegisterStatus(registerSL, currentPhase),
        txHash: registerSL.txHash,
        error: slErrorFiltered?.message,
      });
    }

    // Register Take Profit
    if (state.takeProfitEnabled) {
      const tpErrorFiltered = isUserRejection(registerTP.error) ? null : registerTP.error;
      txs.push({
        id: TX_IDS.REGISTER_TP,
        label: 'Register Take Profit',
        status: getRegisterStatus(registerTP, currentPhase),
        txHash: registerTP.txHash,
        error: tpErrorFiltered?.message,
      });
    }

    return txs;
  }, [
    priceAdjustment.status, priceAdjustment.error,
    mint, nftApproval, registerSL, registerTP,
    currentPhase, hasAutomation, state.stopLossEnabled, state.takeProfitEnabled,
    isUserRejection,
  ]);

  // Helper functions for status

  function getPriceAdjustStatus(status: typeof priceAdjustment.status, phase: typeof currentPhase): TxStatus {
    if (status === 'error') return 'error';
    if (status === 'ready') return 'success';
    if (status === 'calculating') return 'confirming';
    // Show as pending until we're in refresh/mint phase where price adjustment is active
    if (phase === 'refresh' || phase === 'mint') return 'waiting';
    return 'pending';
  }

  function getMintStatus(m: typeof mint, phase: typeof currentPhase): TxStatus {
    // Filter user rejection errors
    const mintErrorFiltered = isUserRejection(m.mintError) ? null : m.mintError;
    if (mintErrorFiltered) return 'error';
    if (m.isSuccess) return 'success';
    if (m.isWaitingForConfirmation) return 'confirming';
    if (m.isMinting) return 'waiting';
    if (phase === 'mint') return 'pending';
    return 'pending';
  }

  function getNftApprovalStatus(approval: typeof nftApproval, phase: typeof currentPhase): TxStatus {
    // Filter user rejection errors
    const nftErrorFiltered = isUserRejection(approval.error) ? null : approval.error;
    if (nftErrorFiltered) return 'error';
    if (approval.isApproved || approval.isApprovalSuccess) return 'success';
    if (approval.isWaitingForConfirmation) return 'confirming';
    if (approval.isApproving) return 'waiting';
    if (phase === 'nft-approval') return 'pending';
    return 'pending';
  }

  function getRegisterStatus(reg: typeof registerSL, phase: typeof currentPhase): TxStatus {
    // Filter user rejection errors
    const regErrorFiltered = isUserRejection(reg.error) ? null : reg.error;
    if (regErrorFiltered) return 'error';
    if (reg.isSuccess) return 'success';
    if (reg.isWaitingForConfirmation) return 'confirming';
    if (reg.isRegistering) return 'waiting';
    if (phase === 'automation') return 'pending';
    return 'pending';
  }

  // Execute all transactions - approvals are handled by the hook components
  const executeTransactions = useCallback(async () => {
    if (!chainId || !walletAddress) return;

    setActiveError(null);
    setCurrentPhase('approvals');
  }, [chainId, walletAddress]);

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
        mint.receipt &&
        chainId &&
        walletAddress &&
        state.discoveredPool &&
        quoteTokenAddress &&
        !createPositionAPI.isPending &&
        !createPositionAPI.isSuccess
      ) {
        const chainSlug = getChainSlugByChainId(chainId);
        if (chainSlug) {
          const liquidity = extractLiquidityFromReceipt(mint.receipt);
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
  }, [currentPhase, mint.isSuccess, mint.tokenId, mint.mintError, mint.mintTxHash, mint.receipt, hasAutomation, setPositionCreated, addTransaction, baseApprovalPrompt, quoteApprovalPrompt, priceAdjustment, chainId, walletAddress, state.discoveredPool, quoteTokenAddress, effectiveTickLower, effectiveTickUpper, createPositionAPI]);

  // NFT approval phase
  useEffect(() => {
    if (currentPhase !== 'nft-approval') return;
    if (!hasAutomation) return;

    // Check if already approved
    if (nftApproval.isApproved) {
      setCurrentPhase('automation');
      return;
    }

    if (!nftApproval.isApproving && !nftApproval.isWaitingForConfirmation && !nftApproval.error) {
      if (attemptedTxs.has(TX_IDS.APPROVE_NFT)) return;

      setAttemptedTxs(prev => new Set(prev).add(TX_IDS.APPROVE_NFT));
      nftApproval.approve();
    }
  }, [currentPhase, hasAutomation, nftApproval, attemptedTxs]);

  // Track NFT approval completion
  useEffect(() => {
    if (currentPhase !== 'nft-approval') return;

    // Filter user rejection errors (silently ignored)
    const nftErrorFiltered = isUserRejection(nftApproval.error) ? null : nftApproval.error;
    if (nftErrorFiltered) {
      setActiveError({ txId: TX_IDS.APPROVE_NFT, message: nftErrorFiltered.message });
      return;
    }

    if (nftApproval.isApprovalSuccess || nftApproval.isApproved) {
      setCurrentPhase('automation');
    }
  }, [currentPhase, nftApproval.isApprovalSuccess, nftApproval.isApproved, nftApproval.error]);

  // Register SL/TP orders phase
  useEffect(() => {
    if (currentPhase !== 'automation') return;
    if (!mintedTokenId || !walletAddress || !autowalletAddress || !chainId || !positionCloserAddress) return;

    const poolAddress = state.discoveredPool?.typedConfig.address as Address | undefined;
    if (!poolAddress) return;

    // Register Stop Loss
    if (state.stopLossEnabled && state.stopLossTick !== null && !registerSL.isRegistering && !registerSL.isWaitingForConfirmation && !registerSL.isSuccess && !registerSL.error && !attemptedTxs.has(TX_IDS.REGISTER_SL)) {
      setAttemptedTxs(prev => new Set(prev).add(TX_IDS.REGISTER_SL));
      registerSL.register({
        nftId: mintedTokenId,
        poolAddress,
        triggerMode: TriggerMode.LOWER,
        triggerTick: state.stopLossTick,
        payoutAddress: walletAddress,
        operatorAddress: autowalletAddress,
        swapDirection,
        slippageBps: DEFAULT_CLOSE_ORDER_SLIPPAGE.liquidityBps,
        swapSlippageBps: DEFAULT_CLOSE_ORDER_SLIPPAGE.swapBps,
        chainId,
        contractAddress: positionCloserAddress,
      });
    }

    // Register Take Profit
    if (state.takeProfitEnabled && state.takeProfitTick !== null && !registerTP.isRegistering && !registerTP.isWaitingForConfirmation && !registerTP.isSuccess && !registerTP.error && !attemptedTxs.has(TX_IDS.REGISTER_TP)) {
      setAttemptedTxs(prev => new Set(prev).add(TX_IDS.REGISTER_TP));
      registerTP.register({
        nftId: mintedTokenId,
        poolAddress,
        triggerMode: TriggerMode.UPPER,
        triggerTick: state.takeProfitTick,
        payoutAddress: walletAddress,
        operatorAddress: autowalletAddress,
        swapDirection,
        slippageBps: DEFAULT_CLOSE_ORDER_SLIPPAGE.liquidityBps,
        swapSlippageBps: DEFAULT_CLOSE_ORDER_SLIPPAGE.swapBps,
        chainId,
        contractAddress: positionCloserAddress,
      });
    }
  }, [
    currentPhase, mintedTokenId, walletAddress, autowalletAddress, chainId, positionCloserAddress,
    state.discoveredPool, state.stopLossEnabled, state.stopLossTick, state.takeProfitEnabled, state.takeProfitTick,
    swapDirection, registerSL, registerTP, attemptedTxs,
  ]);

  // Notify API after SL on-chain registration succeeds
  useEffect(() => {
    if (!registerSL.isSuccess || !registerSL.txHash || slApiDone) return;
    if (!mintedTokenId || !chainId || !walletAddress || !autowalletAddress) return;
    if (state.stopLossTick === null) return;

    const poolAddress = state.discoveredPool?.typedConfig.address as string | undefined;
    const nfpmAddress = getNonfungiblePositionManagerAddress(chainId);
    if (!poolAddress || !nfpmAddress) return;

    const closeOrderHash = `sl@${state.stopLossTick}`;
    const sqrtPriceX96 = tickToSqrtRatioX96(state.stopLossTick).toString();

    automationApi.positionCloseOrders.create(
      chainId,
      mintedTokenId.toString(),
      closeOrderHash,
      {
        poolAddress,
        operatorAddress: autowalletAddress,
        positionManager: nfpmAddress,
        triggerMode: 'LOWER',
        sqrtPriceX96,
        payoutAddress: walletAddress,
        validUntil: new Date(0).toISOString(), // 0 = no expiry
        slippageBps: DEFAULT_CLOSE_ORDER_SLIPPAGE.liquidityBps,
        registrationTxHash: registerSL.txHash,
        swapConfig: apiSwapConfig,
      }
    ).then(() => {
      setSlApiDone(true);
    }).catch((err) => {
      console.error('Failed to notify API of SL order:', err);
      // Don't block wizard — order is registered on-chain regardless
      setSlApiDone(true);
    });
  }, [registerSL.isSuccess, registerSL.txHash, slApiDone, mintedTokenId, chainId, walletAddress, autowalletAddress, state.stopLossTick, state.discoveredPool, apiSwapConfig]);

  // Notify API after TP on-chain registration succeeds
  useEffect(() => {
    if (!registerTP.isSuccess || !registerTP.txHash || tpApiDone) return;
    if (!mintedTokenId || !chainId || !walletAddress || !autowalletAddress) return;
    if (state.takeProfitTick === null) return;

    const poolAddress = state.discoveredPool?.typedConfig.address as string | undefined;
    const nfpmAddress = getNonfungiblePositionManagerAddress(chainId);
    if (!poolAddress || !nfpmAddress) return;

    const closeOrderHash = `tp@${state.takeProfitTick}`;
    const sqrtPriceX96 = tickToSqrtRatioX96(state.takeProfitTick).toString();

    automationApi.positionCloseOrders.create(
      chainId,
      mintedTokenId.toString(),
      closeOrderHash,
      {
        poolAddress,
        operatorAddress: autowalletAddress,
        positionManager: nfpmAddress,
        triggerMode: 'UPPER',
        sqrtPriceX96,
        payoutAddress: walletAddress,
        validUntil: new Date(0).toISOString(), // 0 = no expiry
        slippageBps: DEFAULT_CLOSE_ORDER_SLIPPAGE.liquidityBps,
        registrationTxHash: registerTP.txHash,
        swapConfig: apiSwapConfig,
      }
    ).then(() => {
      setTpApiDone(true);
    }).catch((err) => {
      console.error('Failed to notify API of TP order:', err);
      // Don't block wizard — order is registered on-chain regardless
      setTpApiDone(true);
    });
  }, [registerTP.isSuccess, registerTP.txHash, tpApiDone, mintedTokenId, chainId, walletAddress, autowalletAddress, state.takeProfitTick, state.discoveredPool, apiSwapConfig]);

  // Track SL/TP registration + API notification completion
  useEffect(() => {
    if (currentPhase !== 'automation') return;

    // Check for errors (filter user rejections - silently ignored)
    const slErrorFiltered = isUserRejection(registerSL.error) ? null : registerSL.error;
    const tpErrorFiltered = isUserRejection(registerTP.error) ? null : registerTP.error;
    if (slErrorFiltered) {
      setActiveError({ txId: TX_IDS.REGISTER_SL, message: slErrorFiltered.message });
      return;
    }
    if (tpErrorFiltered) {
      setActiveError({ txId: TX_IDS.REGISTER_TP, message: tpErrorFiltered.message });
      return;
    }

    // Check if all registrations AND API notifications are complete
    const slDone = !state.stopLossEnabled || (registerSL.isSuccess && slApiDone);
    const tpDone = !state.takeProfitEnabled || (registerTP.isSuccess && tpApiDone);

    if (slDone && tpDone) {
      // Record transactions
      if (registerSL.isSuccess && registerSL.txHash) {
        addTransaction({
          hash: registerSL.txHash,
          type: 'register-sl',
          label: 'Register Stop Loss',
          status: 'confirmed',
        });
      }
      if (registerTP.isSuccess && registerTP.txHash) {
        addTransaction({
          hash: registerTP.txHash,
          type: 'register-tp',
          label: 'Register Take Profit',
          status: 'confirmed',
        });
      }

      setCurrentPhase('done');
    }
  }, [currentPhase, state.stopLossEnabled, state.takeProfitEnabled, registerSL, registerTP, slApiDone, tpApiDone, addTransaction]);

  // Update step validation
  useEffect(() => {
    setStepValid('transactions', currentPhase === 'done');
  }, [currentPhase, setStepValid]);

  // Complete when all transactions done AND position added to portfolio
  const isComplete = currentPhase === 'done' && createPositionAPI.isSuccess;
  const visibleTxs = transactions.filter((tx) => !tx.hidden);

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

  // Render transaction item (for non-approval transactions)
  const renderTransactionItem = (tx: TransactionItem) => {
    if (tx.hidden) return null;

    const isActive = tx.status === 'waiting' || tx.status === 'confirming';
    const isError = tx.status === 'error';

    // Determine if this transaction is ready to be executed based on the current phase
    // Each transaction should only be actionable when it's that step's turn
    const isReadyForAction = (() => {
      if (tx.id === TX_IDS.MINT_POSITION) {
        // Mint is ready when we're in mint phase (approvals are done)
        return currentPhase === 'mint';
      }
      if (tx.id === TX_IDS.APPROVE_NFT) {
        // NFT approval is ready when we're in nft-approval phase (mint is done)
        return currentPhase === 'nft-approval';
      }
      if (tx.id === TX_IDS.REGISTER_SL || tx.id === TX_IDS.REGISTER_TP) {
        // SL/TP registration is ready when we're in automation phase (NFT approval is done)
        return currentPhase === 'automation';
      }
      return false;
    })();

    const showActionButtons = !activeError && tx.status === 'pending' && isReadyForAction;

    // Handler for non-approval transaction retry
    const handleRetry = () => {
      setActiveError(null);
      setAttemptedTxs(prev => {
        const next = new Set(prev);
        next.delete(tx.id);
        return next;
      });
      if (tx.id === TX_IDS.MINT_POSITION) {
        mint.reset();
        mint.mint();
      } else if (tx.id === TX_IDS.APPROVE_NFT) {
        nftApproval.reset();
        nftApproval.approve();
      } else if (tx.id === TX_IDS.REGISTER_SL) {
        registerSL.reset();
      } else if (tx.id === TX_IDS.REGISTER_TP) {
        registerTP.reset();
      }
    };

    // Show buttons when pending and ready OR when there's an error (for retry) and it's the current phase
    const showButtons = (showActionButtons || (isError && isReadyForAction)) && !isActive;

    return (
      <div
        key={tx.id}
        className={`py-3 px-4 rounded-lg transition-colors ${
          isError
            ? 'bg-red-500/10 border border-red-500/30'
            : tx.status === 'success'
            ? 'bg-green-500/10 border border-green-500/20'
            : isActive
            ? 'bg-blue-500/10 border border-blue-500/20'
            : 'bg-slate-700/30 border border-slate-600/20'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Status Icon */}
            {tx.status === 'pending' && <Circle className="w-5 h-5 text-slate-500" />}
            {tx.status === 'waiting' && <Circle className="w-5 h-5 text-blue-400" />}
            {tx.status === 'confirming' && <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />}
            {tx.status === 'success' && <Check className="w-5 h-5 text-green-400" />}
            {tx.status === 'error' && <AlertCircle className="w-5 h-5 text-red-400" />}
            {tx.status === 'skipped' && <Check className="w-5 h-5 text-slate-500" />}

            {/* Label */}
            <span
              className={
                tx.status === 'success'
                  ? 'text-slate-400'
                  : tx.status === 'skipped'
                  ? 'text-slate-500'
                  : tx.status === 'error'
                  ? 'text-red-300'
                  : 'text-white'
              }
            >
              {tx.label}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {tx.txHash && chainId && (
              <a
                href={buildTxUrl(chainId, tx.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
              >
                {truncateTxHash(tx.txHash)}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {showButtons && (
              <button
                onClick={isError ? handleRetry : executeTransactions}
                className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer"
              >
                {isError ? 'Retry' : 'Start'}
              </button>
            )}
          </div>
        </div>

        {/* Error message */}
        {isError && tx.error && (
          <div className="mt-2 pl-8 flex gap-2">
            <div className="flex-1 max-h-20 overflow-y-auto text-sm text-red-400/80 bg-red-950/30 rounded p-2">
              {tx.error}
            </div>
            <button
              onClick={() => navigator.clipboard.writeText(tx.error || '')}
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

          {/* Other transactions (NFT approval, SL/TP registration) */}
          {visibleTxs
            .filter((tx) => tx.id !== TX_IDS.MINT_POSITION && tx.id !== TX_IDS.PRICE_ADJUST)
            .map((tx) => renderTransactionItem(tx))}
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
        slDrawdown={slDrawdown}
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
