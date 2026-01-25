/**
 * Close Order Modal
 *
 * Multi-step modal for creating a new close order.
 * Steps:
 * 1. Configure - Select trigger mode and prices
 * 2. Review - Summary before confirmation
 * 3. Processing - Show progress during API call
 * 4. Success - Order created confirmation
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { X, ArrowLeft, ArrowRight, Shield } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useAccount } from 'wagmi';
import type { Address } from 'viem';
import type { SerializedCloseOrder, TriggerMode } from '@midcurve/api-shared';
import { sqrtPriceX96ToTick } from '@midcurve/shared';
import {
  useCreateCloseOrder,
  useOperatorApproval,
  useAutowallet,
  type OrderType,
} from '@/hooks/automation';
import { CloseOrderConfigureStep } from './steps/CloseOrderConfigureStep';
import { CloseOrderReviewStep } from './steps/CloseOrderReviewStep';
import { CloseOrderProcessingStep } from './steps/CloseOrderProcessingStep';
import { CloseOrderSuccessStep } from './steps/CloseOrderSuccessStep';

export interface CloseOrderModalProps {
  /**
   * Whether the modal is open
   */
  isOpen: boolean;

  /**
   * Close the modal
   */
  onClose: () => void;

  /**
   * Position ID to create order for
   */
  positionId: string;

  /**
   * Pool address for the position
   */
  poolAddress: string;

  /**
   * Chain ID
   */
  chainId: number;

  /**
   * Shared automation contract address on this chain
   */
  contractAddress: Address;

  /**
   * NFT ID of the position
   */
  nftId: bigint;

  /**
   * Position owner address (for pre-flight wallet ownership check)
   */
  positionOwner: Address;

  /**
   * Base token (the asset being priced)
   */
  baseToken: {
    address: string;
    symbol: string;
    decimals: number;
  };

  /**
   * Quote token (the reference currency)
   */
  quoteToken: {
    address: string;
    symbol: string;
    decimals: number;
  };

  /**
   * Current pool price (sqrtPriceX96 as string)
   */
  currentSqrtPriceX96: string;

  /**
   * Current price formatted for display
   */
  currentPriceDisplay: string;

  /**
   * Whether token0 is the quote token (affects price direction for contract calls)
   */
  isToken0Quote: boolean;

  /**
   * Callback when order is created
   */
  onSuccess?: (order: SerializedCloseOrder) => void;

  /**
   * Optional order type to lock the modal to a specific mode.
   * When provided, the trigger mode selector is hidden and the mode is hardcoded.
   * - 'stopLoss' → triggerMode 'LOWER'
   * - 'takeProfit' → triggerMode 'UPPER'
   */
  orderType?: 'stopLoss' | 'takeProfit';

  // Position data for PnL simulation
  /**
   * Position liquidity (for calculating value at trigger price)
   */
  liquidity: bigint;

  /**
   * Position lower tick
   */
  tickLower: number;

  /**
   * Position upper tick
   */
  tickUpper: number;

  /**
   * Current cost basis of the position (in quote token units, as string)
   */
  currentCostBasis: string;

  /**
   * Current unclaimed fees (in quote token units, as string)
   */
  unclaimedFees: string;
}

type WizardStep = 'configure' | 'review' | 'processing' | 'success';

/**
 * Swap direction for post-close swap
 */
export type SwapDirection = 'BASE_TO_QUOTE' | 'QUOTE_TO_BASE';

export interface CloseOrderFormData {
  triggerMode: TriggerMode;
  sqrtPriceX96Lower: string;
  sqrtPriceX96Upper: string;
  priceLowerDisplay: string;
  priceUpperDisplay: string;
  slippageBps: number;
  validUntilDays: number;
  /**
   * Validation error message if trigger prices are invalid relative to current price
   */
  priceValidationError: string | null;
  /**
   * Optional swap configuration for post-close swap
   */
  swapEnabled: boolean;
  swapDirection: SwapDirection;
  swapSlippageBps: number;
}

export function CloseOrderModal({
  isOpen,
  onClose,
  positionId,
  poolAddress,
  chainId,
  contractAddress,
  nftId,
  positionOwner,
  baseToken,
  quoteToken,
  currentSqrtPriceX96,
  currentPriceDisplay,
  isToken0Quote,
  onSuccess,
  orderType,
  // Position data for PnL simulation
  liquidity,
  tickLower,
  tickUpper,
  currentCostBasis,
  unclaimedFees,
}: CloseOrderModalProps) {
  // Determine initial trigger mode based on orderType prop
  const initialTriggerMode: TriggerMode = orderType === 'takeProfit' ? 'UPPER' : 'LOWER';

  // Determine modal title based on orderType
  const modalTitle = orderType === 'stopLoss'
    ? 'Set Stop-Loss Order'
    : orderType === 'takeProfit'
      ? 'Set Take-Profit Order'
      : 'Set Close Order';
  const { address: userAddress, isConnected, chainId: connectedChainId } = useAccount();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<WizardStep>('configure');
  const [formData, setFormData] = useState<CloseOrderFormData>({
    triggerMode: initialTriggerMode,
    sqrtPriceX96Lower: '',
    sqrtPriceX96Upper: '',
    priceLowerDisplay: '',
    priceUpperDisplay: '',
    slippageBps: 100, // 1%
    validUntilDays: 30,
    priceValidationError: null,
    // Swap config (disabled by default)
    swapEnabled: false,
    swapDirection: 'BASE_TO_QUOTE',
    swapSlippageBps: 100, // 1%
  });
  const [createdOrder, setCreatedOrder] = useState<SerializedCloseOrder | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  // Get user's autowallet (operator address for executing close orders)
  const { data: autowalletData } = useAutowallet();
  const operatorAddress = autowalletData?.address as Address | undefined;

  // Operator approval hook (NFPM setApprovalForAll)
  const {
    isApproved,
    isChecking: isCheckingApproval,
    approve,
    isApproving,
    isWaitingForConfirmation: isWaitingForApprovalConfirmation,
    isApprovalSuccess,
    error: approveError,
    reset: resetApproval,
  } = useOperatorApproval(chainId, contractAddress);

  // Create order hook (Wagmi-based) - fetches ABI internally
  const {
    registerOrder,
    isRegistering,
    isWaitingForConfirmation,
    isSuccess,
    result,
    error: hookError,
    apiError,
    reset: resetHook,
    isReady: isHookReady,
  } = useCreateCloseOrder(chainId, nftId.toString());

  // Detect if approval is needed (shared contract is always deployed)
  const needsApproval = !isApproved && !isCheckingApproval;

  // Check if connected to wrong network
  const isWrongNetwork = !!(
    isConnected &&
    connectedChainId !== chainId
  );

  // Check if connected wallet is not the position owner
  const isWrongAccount = !!(
    isConnected &&
    userAddress &&
    positionOwner &&
    userAddress.toLowerCase() !== positionOwner.toLowerCase()
  );

  // Mount check for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('configure');
      setFormData({
        triggerMode: initialTriggerMode,
        sqrtPriceX96Lower: '',
        sqrtPriceX96Upper: '',
        priceLowerDisplay: '',
        priceUpperDisplay: '',
        slippageBps: 100,
        validUntilDays: 30,
        priceValidationError: null,
        // Swap config (disabled by default)
        swapEnabled: false,
        swapDirection: 'BASE_TO_QUOTE',
        swapSlippageBps: 100,
      });
      setCreatedOrder(null);
      setLocalError(null);
      resetHook();
      resetApproval();
    }
  }, [isOpen, resetHook, resetApproval, initialTriggerMode]);

  // Track hook success/error state
  useEffect(() => {
    if (isSuccess && result) {
      // Order was successfully registered
      if (result.order) {
        setCreatedOrder(result.order);
        onSuccess?.(result.order);
      }
      setStep('success');
    }
  }, [isSuccess, result, onSuccess]);

  useEffect(() => {
    if (hookError) {
      setLocalError(hookError.message);
      setStep('review'); // Go back to review on error
    }
  }, [hookError]);

  // Handle API notification error (tx succeeded but API failed)
  useEffect(() => {
    if (apiError) {
      setLocalError(`Transaction succeeded but order monitoring failed: ${apiError.message}`);
      setStep('review'); // Go back to review to show error
    }
  }, [apiError]);

  // Clear wallet-related errors when wallet connects
  useEffect(() => {
    if (isConnected && localError === 'Wallet not connected') {
      setLocalError(null);
    }
  }, [isConnected, localError]);

  // Handle approval error
  useEffect(() => {
    if (approveError) {
      setLocalError(approveError.message);
      setStep('review');
    }
  }, [approveError]);

  // Handle form data updates
  const handleFormChange = useCallback((updates: Partial<CloseOrderFormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  }, []);

  const handleBack = useCallback(() => {
    if (step === 'review') {
      setStep('configure');
    }
  }, [step]);

  // Execute the actual order registration (final step)
  const executeRegistration = useCallback(() => {
    if (!userAddress) {
      setLocalError('Wallet not connected');
      setStep('review');
      return;
    }

    if (!operatorAddress) {
      setLocalError('Autowallet not available. Please try again.');
      setStep('review');
      return;
    }

    if (!isHookReady) {
      setLocalError('Contract not ready. Please wait and try again.');
      setStep('review');
      return;
    }

    // Calculate valid until timestamp
    const validUntilDate = new Date();
    validUntilDate.setDate(validUntilDate.getDate() + formData.validUntilDays);
    const validUntil = BigInt(Math.floor(validUntilDate.getTime() / 1000));

    // Map triggerMode to orderType (V1.0 tick-based interface)
    // LOWER -> STOP_LOSS (triggers when price drops below)
    // UPPER -> TAKE_PROFIT (triggers when price rises above)
    const orderTypeFromTriggerMode: Record<TriggerMode, OrderType> = {
      'LOWER': 'STOP_LOSS',
      'UPPER': 'TAKE_PROFIT',
      'BOTH': 'STOP_LOSS', // Default to STOP_LOSS for BOTH (shouldn't happen in practice)
    };
    const orderTypeValue: OrderType = orderTypeFromTriggerMode[formData.triggerMode];

    // Convert sqrtPriceX96 to triggerTick
    // For STOP_LOSS (LOWER), use sqrtPriceX96Lower
    // For TAKE_PROFIT (UPPER), use sqrtPriceX96Upper
    const sqrtPriceX96 = formData.triggerMode === 'LOWER' || formData.triggerMode === 'BOTH'
      ? formData.sqrtPriceX96Lower
      : formData.sqrtPriceX96Upper;

    if (!sqrtPriceX96) {
      setLocalError('Trigger price not set');
      setStep('review');
      return;
    }

    const triggerTick = sqrtPriceX96ToTick(sqrtPriceX96);

    // Call the hook's registerOrder function (V1.0 tick-based interface)
    registerOrder({
      poolAddress: poolAddress as Address,
      orderType: orderTypeValue,
      triggerTick,
      payoutAddress: userAddress,
      operatorAddress,
      validUntil,
      slippageBps: formData.slippageBps,
      positionId,
      positionOwner,
      // Optional swap config
      swapConfig: formData.swapEnabled
        ? {
            enabled: true,
            direction: formData.swapDirection,
            slippageBps: formData.swapSlippageBps,
            quoteToken: quoteToken.address,
          }
        : undefined,
    });
  }, [
    userAddress,
    operatorAddress,
    formData,
    positionId,
    poolAddress,
    positionOwner,
    quoteToken.address,
    registerOrder,
    isHookReady,
  ]);

  // Handle approval success - continue to registration
  useEffect(() => {
    if (isApprovalSuccess && step === 'processing') {
      // Approval complete, now register the order
      executeRegistration();
    }
  }, [isApprovalSuccess, step, executeRegistration]);

  // Submit the order - orchestrates approve → register flow
  const submitOrder = useCallback(() => {
    if (!userAddress) {
      setLocalError('Wallet not connected');
      setStep('review');
      return;
    }

    if (!operatorAddress) {
      setLocalError('Autowallet not available. Please try again.');
      setStep('review');
      return;
    }

    setLocalError(null);

    // Step 1: Approve if needed
    if (needsApproval) {
      approve();
      return;
    }

    // Step 2: Register the order
    executeRegistration();
  }, [userAddress, operatorAddress, needsApproval, approve, executeRegistration]);

  // Handle step progression
  const handleContinue = useCallback(() => {
    if (step === 'configure') {
      setStep('review');
    } else if (step === 'review') {
      setStep('processing');
      submitOrder();
    }
  }, [step, submitOrder]);

  // Handle close
  const handleClose = useCallback(() => {
    if (step === 'processing') {
      return; // Don't allow close during processing
    }
    onClose();
  }, [step, onClose]);

  if (!isOpen || !mounted) {
    return null;
  }

  // Check if form is valid for proceeding
  // Requires: prices filled for selected trigger mode AND no price validation error
  const hasPricesForMode =
    (formData.triggerMode === 'LOWER' && formData.sqrtPriceX96Lower) ||
    (formData.triggerMode === 'UPPER' && formData.sqrtPriceX96Upper) ||
    (formData.triggerMode === 'BOTH' && formData.sqrtPriceX96Lower && formData.sqrtPriceX96Upper);
  const isFormValid = hasPricesForMode && !formData.priceValidationError;

  const modalContent = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={step !== 'processing' ? handleClose : undefined}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800/90 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-xl shadow-black/20 w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
            <div className="flex items-center gap-3">
              <div className="p-2 border rounded-lg bg-blue-500/10 border-blue-500/20">
                <Shield className="w-5 h-5 text-blue-400" />
              </div>
              <h2 className="text-lg font-semibold text-white">{modalTitle}</h2>
            </div>
            <button
              onClick={handleClose}
              disabled={step === 'processing'}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {step === 'configure' && (
              <CloseOrderConfigureStep
                formData={formData}
                onChange={handleFormChange}
                baseToken={baseToken}
                quoteToken={quoteToken}
                currentSqrtPriceX96={currentSqrtPriceX96}
                currentPriceDisplay={currentPriceDisplay}
                isToken0Quote={isToken0Quote}
                chainId={chainId}
                orderType={orderType}
                // Position data for PnL simulation
                liquidity={liquidity}
                tickLower={tickLower}
                tickUpper={tickUpper}
                currentCostBasis={currentCostBasis}
                unclaimedFees={unclaimedFees}
              />
            )}

            {step === 'review' && (
              <CloseOrderReviewStep
                formData={formData}
                baseToken={baseToken}
                quoteToken={quoteToken}
                error={localError}
                needsApproval={needsApproval}
                isConnected={isConnected}
                connectedChainId={connectedChainId}
                positionChainId={chainId}
                connectedAddress={userAddress}
                positionOwner={positionOwner}
                hasAutowallet={!!operatorAddress}
              />
            )}

            {step === 'processing' && (
              <CloseOrderProcessingStep
                // Approval state
                needsApproval={needsApproval}
                isApproving={isApproving}
                isWaitingForApprovalConfirmation={isWaitingForApprovalConfirmation}
                approvalComplete={isApprovalSuccess || isApproved}
                // Registration state
                isRegistering={isRegistering}
                isWaitingForConfirmation={isWaitingForConfirmation}
              />
            )}

            {step === 'success' && createdOrder && (
              <CloseOrderSuccessStep
                order={createdOrder}
                quoteTokenSymbol={quoteToken.symbol}
              />
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-slate-700/50">
            {step === 'configure' && (
              <div className="flex gap-3">
                <button
                  onClick={handleClose}
                  className="flex-1 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white border border-slate-600 hover:border-slate-500 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleContinue}
                  disabled={!isFormValid}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {step === 'review' && (
              <div className="flex gap-3">
                <button
                  onClick={handleBack}
                  className="flex-1 px-4 py-2 text-sm font-medium text-slate-300 hover:text-white border border-slate-600 hover:border-slate-500 rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
                <button
                  onClick={handleContinue}
                  disabled={!isConnected || isWrongNetwork || isWrongAccount || !operatorAddress}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm
                </button>
              </div>
            )}

            {step === 'processing' && (
              <div className="text-center text-sm text-slate-400">
                Please wait while your order is being created...
              </div>
            )}

            {step === 'success' && (
              <button
                onClick={handleClose}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
}
