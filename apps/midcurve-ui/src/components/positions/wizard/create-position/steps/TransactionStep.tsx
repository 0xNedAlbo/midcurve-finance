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
import { Circle, Check, Loader2, ExternalLink, AlertCircle } from 'lucide-react';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import { compareAddresses, UniswapV3Pool, type PoolJSON } from '@midcurve/shared';
import { useCreatePositionWizard } from '../context/CreatePositionWizardContext';
import { WizardSummaryPanel } from '../shared/WizardSummaryPanel';
import { useTokenApproval } from '@/hooks/positions/uniswapv3/wizard/useTokenApproval';
import { useMintPosition, type MintPositionParams } from '@/hooks/positions/uniswapv3/wizard/useMintPosition';
import { useOperatorApproval } from '@/hooks/automation/useOperatorApproval';
import { useRegisterCloseOrder } from '@/hooks/automation/useRegisterCloseOrder';
import { useAutowallet } from '@/hooks/automation/useAutowallet';
import { useDiscoverPool } from '@/hooks/pools/useDiscoverPool';
import { getPositionCloserAddress, TriggerMode, SwapDirection, DEFAULT_CLOSE_ORDER_SLIPPAGE } from '@/config/automation-contracts';
import { buildTxUrl, truncateTxHash } from '@/lib/explorer-utils';
import { EvmWalletConnectionPrompt } from '@/components/common/EvmWalletConnectionPrompt';

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
  APPROVE_BASE: 'approve-base',
  APPROVE_QUOTE: 'approve-quote',
  REFRESH_POOL: 'refresh-pool',
  MINT_POSITION: 'mint-position',
  APPROVE_NFT: 'approve-nft',
  REGISTER_SL: 'register-sl',
  REGISTER_TP: 'register-tp',
} as const;

export function TransactionStep() {
  const { address: walletAddress } = useAccount();
  const { state, setStepValid, setDiscoveredPool, setPositionCreated, goNext, addTransaction } = useCreatePositionWizard();

  // Current phase of execution
  const [currentPhase, setCurrentPhase] = useState<'idle' | 'approvals' | 'refresh' | 'mint' | 'nft-approval' | 'automation' | 'done'>('idle');
  const [activeError, setActiveError] = useState<{ txId: string; message: string } | null>(null);

  // Track minted token ID
  const [mintedTokenId, setMintedTokenId] = useState<bigint | undefined>(undefined);

  // Get chain ID from discovered pool
  const chainId = state.discoveredPool?.typedConfig.chainId;

  // Get automation wallet
  const { data: autowallet } = useAutowallet();
  const autowalletAddress = autowallet?.address as Address | undefined;

  // Pool discovery hook for price refresh
  const discoverPool = useDiscoverPool();

  // Determine if automation is enabled
  const hasAutomation = state.automationEnabled && (state.stopLossEnabled || state.takeProfitEnabled);
  const positionCloserAddress = chainId ? getPositionCloserAddress(chainId) : null;

  // Determine base/quote token addresses and amounts
  const baseTokenAddress = state.baseToken?.address as Address | undefined;
  const quoteTokenAddress = state.quoteToken?.address as Address | undefined;

  const baseAmount = state.allocatedBaseAmount ? BigInt(state.allocatedBaseAmount) : 0n;
  const quoteAmount = state.allocatedQuoteAmount ? BigInt(state.allocatedQuoteAmount) : 0n;

  // Token approval hooks
  const baseApproval = useTokenApproval({
    tokenAddress: baseTokenAddress ?? null,
    ownerAddress: walletAddress ?? null,
    requiredAmount: baseAmount,
    chainId,
    enabled: !!baseTokenAddress && !!walletAddress && !!chainId && baseAmount > 0n,
  });

  const quoteApproval = useTokenApproval({
    tokenAddress: quoteTokenAddress ?? null,
    ownerAddress: walletAddress ?? null,
    requiredAmount: quoteAmount,
    chainId,
    enabled: !!quoteTokenAddress && !!walletAddress && !!chainId && quoteAmount > 0n,
  });

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
      tickLower: state.tickLower,
      tickUpper: state.tickUpper,
      amount0Desired: amount0,
      amount1Desired: amount1,
      tickSpacing: pool.typedConfig.tickSpacing,
      recipient: walletAddress,
      chainId,
    };
  }, [state.discoveredPool, walletAddress, chainId, baseTokenAddress, quoteTokenAddress, baseAmount, quoteAmount, state.tickLower, state.tickUpper]);

  // Mint position hook
  const mint = useMintPosition(mintParams);

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

  // Build transaction list
  const transactions = useMemo((): TransactionItem[] => {
    const txs: TransactionItem[] = [];

    // Base token approval
    const baseApprovalStatus = getApprovalStatus(baseApproval, currentPhase === 'approvals');
    txs.push({
      id: TX_IDS.APPROVE_BASE,
      label: `Approve ${state.baseToken?.symbol || 'Base Token'}`,
      status: baseApproval.isApproved && currentPhase === 'idle' ? 'skipped' : baseApprovalStatus,
      txHash: baseApproval.approvalTxHash,
      error: baseApproval.approvalError?.message,
      hidden: baseAmount === 0n || (baseApproval.isApproved && currentPhase === 'idle'),
    });

    // Quote token approval
    const quoteApprovalStatus = getApprovalStatus(quoteApproval, currentPhase === 'approvals');
    txs.push({
      id: TX_IDS.APPROVE_QUOTE,
      label: `Approve ${state.quoteToken?.symbol || 'Quote Token'}`,
      status: quoteApproval.isApproved && currentPhase === 'idle' ? 'skipped' : quoteApprovalStatus,
      txHash: quoteApproval.approvalTxHash,
      error: quoteApproval.approvalError?.message,
      hidden: quoteAmount === 0n || (quoteApproval.isApproved && currentPhase === 'idle'),
    });

    // Pool price refresh runs in background - not shown in list
    // (still tracked internally for state management)

    // Mint position
    txs.push({
      id: TX_IDS.MINT_POSITION,
      label: 'Open Position',
      status: getMintStatus(mint, currentPhase),
      txHash: mint.mintTxHash,
      error: mint.mintError?.message,
    });

    // NFT approval for automation
    if (hasAutomation) {
      txs.push({
        id: TX_IDS.APPROVE_NFT,
        label: 'Approve Position for Automation',
        status: getNftApprovalStatus(nftApproval, currentPhase),
        txHash: nftApproval.txHash,
        error: nftApproval.error?.message,
      });
    }

    // Register Stop Loss
    if (state.stopLossEnabled) {
      txs.push({
        id: TX_IDS.REGISTER_SL,
        label: 'Register Stop Loss',
        status: getRegisterStatus(registerSL, currentPhase),
        txHash: registerSL.txHash,
        error: registerSL.error?.message,
      });
    }

    // Register Take Profit
    if (state.takeProfitEnabled) {
      txs.push({
        id: TX_IDS.REGISTER_TP,
        label: 'Register Take Profit',
        status: getRegisterStatus(registerTP, currentPhase),
        txHash: registerTP.txHash,
        error: registerTP.error?.message,
      });
    }

    return txs;
  }, [
    state.baseToken, state.quoteToken, baseAmount, quoteAmount,
    baseApproval, quoteApproval, mint, nftApproval, registerSL, registerTP,
    currentPhase, hasAutomation, state.stopLossEnabled, state.takeProfitEnabled,
  ]);

  // Helper functions for status
  function getApprovalStatus(approval: typeof baseApproval, isActive: boolean): TxStatus {
    if (approval.approvalError) return 'error';
    if (approval.isApproved) return 'success';
    if (approval.isWaitingForConfirmation) return 'confirming';
    if (approval.isApproving) return 'waiting';
    if (isActive && approval.needsApproval) return 'pending';
    return 'pending';
  }

  function getMintStatus(m: typeof mint, phase: typeof currentPhase): TxStatus {
    if (m.mintError) return 'error';
    if (m.isSuccess) return 'success';
    if (m.isWaitingForConfirmation) return 'confirming';
    if (m.isMinting) return 'waiting';
    if (phase === 'mint') return 'pending';
    return 'pending';
  }

  function getNftApprovalStatus(approval: typeof nftApproval, phase: typeof currentPhase): TxStatus {
    if (approval.error) return 'error';
    if (approval.isApproved || approval.isApprovalSuccess) return 'success';
    if (approval.isWaitingForConfirmation) return 'confirming';
    if (approval.isApproving) return 'waiting';
    if (phase === 'nft-approval') return 'pending';
    return 'pending';
  }

  function getRegisterStatus(reg: typeof registerSL, phase: typeof currentPhase): TxStatus {
    if (reg.error) return 'error';
    if (reg.isSuccess) return 'success';
    if (reg.isWaitingForConfirmation) return 'confirming';
    if (reg.isRegistering) return 'waiting';
    if (phase === 'automation') return 'pending';
    return 'pending';
  }

  // Execute all transactions
  const executeTransactions = useCallback(async () => {
    if (!chainId || !walletAddress) return;

    setActiveError(null);

    // Phase 1: Token Approvals
    setCurrentPhase('approvals');

    // Approve base token if needed
    if (baseAmount > 0n && baseApproval.needsApproval) {
      baseApproval.approve();
    }

    // Approve quote token if needed
    if (quoteAmount > 0n && quoteApproval.needsApproval) {
      quoteApproval.approve();
    }
  }, [chainId, walletAddress, baseAmount, quoteAmount, baseApproval, quoteApproval]);

  // Track approval completion and move to next phase
  useEffect(() => {
    if (currentPhase !== 'approvals') return;

    // Check for errors
    if (baseApproval.approvalError) {
      setActiveError({ txId: TX_IDS.APPROVE_BASE, message: baseApproval.approvalError.message });
      return;
    }
    if (quoteApproval.approvalError) {
      setActiveError({ txId: TX_IDS.APPROVE_QUOTE, message: quoteApproval.approvalError.message });
      return;
    }

    // Check if all approvals are complete
    const baseOk = baseAmount === 0n || baseApproval.isApproved;
    const quoteOk = quoteAmount === 0n || quoteApproval.isApproved;

    if (baseOk && quoteOk) {
      // Move to pool refresh phase
      setCurrentPhase('refresh');
    }
  }, [currentPhase, baseAmount, quoteAmount, baseApproval.isApproved, quoteApproval.isApproved, baseApproval.approvalError, quoteApproval.approvalError]);

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
      } catch (error) {
        console.error('Failed to refresh pool:', error);
        // Continue anyway - use existing pool state
        setCurrentPhase('mint');
      }
    };

    refreshPool();
  }, [currentPhase, state.discoveredPool, discoverPool, setDiscoveredPool]);

  // Trigger mint when entering mint phase
  useEffect(() => {
    if (currentPhase !== 'mint') return;
    if (mint.isMinting || mint.isWaitingForConfirmation || mint.isSuccess) return;

    mint.mint();
  }, [currentPhase, mint]);

  // Track mint completion
  useEffect(() => {
    if (currentPhase !== 'mint') return;

    if (mint.mintError) {
      setActiveError({ txId: TX_IDS.MINT_POSITION, message: mint.mintError.message });
      return;
    }

    if (mint.isSuccess && mint.tokenId !== undefined) {
      setMintedTokenId(mint.tokenId);

      // Record transaction
      if (mint.mintTxHash) {
        addTransaction({
          hash: mint.mintTxHash,
          type: 'mint',
          label: 'Open Position',
          status: 'confirmed',
        });
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
  }, [currentPhase, mint.isSuccess, mint.tokenId, mint.mintError, mint.mintTxHash, hasAutomation, setPositionCreated, addTransaction]);

  // NFT approval phase
  useEffect(() => {
    if (currentPhase !== 'nft-approval') return;
    if (!hasAutomation) return;

    // Check if already approved
    if (nftApproval.isApproved) {
      setCurrentPhase('automation');
      return;
    }

    if (!nftApproval.isApproving && !nftApproval.isWaitingForConfirmation) {
      nftApproval.approve();
    }
  }, [currentPhase, hasAutomation, nftApproval]);

  // Track NFT approval completion
  useEffect(() => {
    if (currentPhase !== 'nft-approval') return;

    if (nftApproval.error) {
      setActiveError({ txId: TX_IDS.APPROVE_NFT, message: nftApproval.error.message });
      return;
    }

    if (nftApproval.isApprovalSuccess || nftApproval.isApproved) {
      setCurrentPhase('automation');
    }
  }, [currentPhase, nftApproval.isApprovalSuccess, nftApproval.isApproved, nftApproval.error]);

  // Register SL/TP orders phase
  useEffect(() => {
    if (currentPhase !== 'automation') return;
    if (!mintedTokenId || !walletAddress || !autowalletAddress || !chainId) return;

    const poolAddress = state.discoveredPool?.typedConfig.address as Address | undefined;
    if (!poolAddress) return;

    // Register Stop Loss
    if (state.stopLossEnabled && state.stopLossTick !== null && !registerSL.isRegistering && !registerSL.isWaitingForConfirmation && !registerSL.isSuccess && !registerSL.error) {
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
      });
    }

    // Register Take Profit
    if (state.takeProfitEnabled && state.takeProfitTick !== null && !registerTP.isRegistering && !registerTP.isWaitingForConfirmation && !registerTP.isSuccess && !registerTP.error) {
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
      });
    }
  }, [
    currentPhase, mintedTokenId, walletAddress, autowalletAddress, chainId,
    state.discoveredPool, state.stopLossEnabled, state.stopLossTick, state.takeProfitEnabled, state.takeProfitTick,
    swapDirection, registerSL, registerTP,
  ]);

  // Track SL/TP registration completion
  useEffect(() => {
    if (currentPhase !== 'automation') return;

    // Check for errors
    if (registerSL.error) {
      setActiveError({ txId: TX_IDS.REGISTER_SL, message: registerSL.error.message });
      return;
    }
    if (registerTP.error) {
      setActiveError({ txId: TX_IDS.REGISTER_TP, message: registerTP.error.message });
      return;
    }

    // Check if all registrations are complete
    const slDone = !state.stopLossEnabled || registerSL.isSuccess;
    const tpDone = !state.takeProfitEnabled || registerTP.isSuccess;

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
  }, [currentPhase, state.stopLossEnabled, state.takeProfitEnabled, registerSL, registerTP, addTransaction]);

  // Update step validation
  useEffect(() => {
    setStepValid('transactions', currentPhase === 'done');
  }, [currentPhase, setStepValid]);

  // Retry handler
  const handleRetry = useCallback(() => {
    if (!activeError) return;

    setActiveError(null);

    switch (activeError.txId) {
      case TX_IDS.APPROVE_BASE:
        baseApproval.approve();
        break;
      case TX_IDS.APPROVE_QUOTE:
        quoteApproval.approve();
        break;
      case TX_IDS.MINT_POSITION:
        mint.reset();
        mint.mint();
        break;
      case TX_IDS.APPROVE_NFT:
        nftApproval.reset();
        nftApproval.approve();
        break;
      case TX_IDS.REGISTER_SL:
        registerSL.reset();
        // Will auto-retry in effect
        break;
      case TX_IDS.REGISTER_TP:
        registerTP.reset();
        // Will auto-retry in effect
        break;
    }
  }, [activeError, baseApproval, quoteApproval, mint, nftApproval, registerSL, registerTP]);

  // Render transaction item
  const renderTransactionItem = (tx: TransactionItem) => {
    if (tx.hidden) return null;

    const isActive = tx.status === 'waiting' || tx.status === 'confirming';
    const isError = tx.status === 'error';

    return (
      <div
        key={tx.id}
        className={`flex items-center justify-between py-3 px-4 rounded-lg transition-colors ${
          isError
            ? 'bg-red-500/10 border border-red-500/30'
            : tx.status === 'success'
            ? 'bg-green-500/10 border border-green-500/20'
            : isActive
            ? 'bg-blue-500/10 border border-blue-500/20'
            : 'bg-slate-700/30 border border-slate-600/20'
        }`}
      >
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
        </div>
      </div>
    );
  };

  const isComplete = currentPhase === 'done';
  const isStarted = currentPhase !== 'idle';
  const visibleTxs = transactions.filter((tx) => !tx.hidden);

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
          {visibleTxs.map(renderTransactionItem)}
        </div>

        {/* Error Display */}
        {activeError && (
          <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-300 font-medium mb-1">Transaction Failed</p>
                <p className="text-sm text-red-400/80">{activeError.message}</p>
              </div>
            </div>
            <button
              onClick={handleRetry}
              className="mt-3 w-full py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Start Button */}
        {!isStarted && !activeError && (
          <button
            onClick={executeTransactions}
            className="mt-4 w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors cursor-pointer"
          >
            Execute Transactions
          </button>
        )}

        {/* Success Message */}
        {isComplete && (
          <div className="mt-4 p-4 bg-green-600/10 border border-green-500/30 rounded-lg">
            <div className="flex items-center gap-3">
              <Check className="w-5 h-5 text-green-400" />
              <div>
                <p className="text-white font-medium">Position Created Successfully!</p>
                {mintedTokenId && (
                  <p className="text-sm text-slate-400">NFT ID: #{mintedTokenId.toString()}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Visual area is hidden - return null
  const renderVisual = () => null;

  const renderSummary = () => (
    <WizardSummaryPanel
      nextDisabled={!isComplete}
      nextLabel="View Summary"
      onNext={goNext}
    />
  );

  return {
    interactive: renderInteractive(),
    visual: renderVisual(),
    summary: renderSummary(),
  };
}
