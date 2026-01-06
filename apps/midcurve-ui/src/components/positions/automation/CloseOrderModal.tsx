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
import {
  useCreateCloseOrder,
  useOperatorApproval,
  useAutowallet,
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
   * Position manager (NFPM) address on this chain
   */
  positionManager: Address;

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
}

type WizardStep = 'configure' | 'review' | 'processing' | 'success';

export interface CloseOrderFormData {
  triggerMode: TriggerMode;
  sqrtPriceX96Lower: string;
  sqrtPriceX96Upper: string;
  priceLowerDisplay: string;
  priceUpperDisplay: string;
  slippageBps: number;
  validUntilDays: number;
}

export function CloseOrderModal({
  isOpen,
  onClose,
  positionId,
  poolAddress,
  chainId,
  contractAddress,
  positionManager,
  nftId,
  positionOwner,
  baseToken,
  quoteToken,
  currentSqrtPriceX96,
  currentPriceDisplay,
  isToken0Quote,
  onSuccess,
}: CloseOrderModalProps) {
  const { address: userAddress, isConnected, chainId: connectedChainId } = useAccount();
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<WizardStep>('configure');
  const [formData, setFormData] = useState<CloseOrderFormData>({
    triggerMode: 'LOWER',
    sqrtPriceX96Lower: '',
    sqrtPriceX96Upper: '',
    priceLowerDisplay: '',
    priceUpperDisplay: '',
    slippageBps: 100, // 1%
    validUntilDays: 30,
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

  // Create order hook (Wagmi-based)
  const {
    registerOrder,
    isRegistering,
    isWaitingForConfirmation,
    isSuccess,
    result,
    error: hookError,
    reset: resetHook,
  } = useCreateCloseOrder();

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
        triggerMode: 'LOWER',
        sqrtPriceX96Lower: '',
        sqrtPriceX96Upper: '',
        priceLowerDisplay: '',
        priceUpperDisplay: '',
        slippageBps: 100,
        validUntilDays: 30,
      });
      setCreatedOrder(null);
      setLocalError(null);
      resetHook();
      resetApproval();
    }
  }, [isOpen, resetHook, resetApproval]);

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

    // Calculate valid until timestamp
    const validUntilDate = new Date();
    validUntilDate.setDate(validUntilDate.getDate() + formData.validUntilDays);
    const validUntil = BigInt(Math.floor(validUntilDate.getTime() / 1000));

    // Parse price values as bigint
    const sqrtPriceX96Lower =
      formData.triggerMode === 'LOWER' || formData.triggerMode === 'BOTH'
        ? BigInt(formData.sqrtPriceX96Lower || '0')
        : 0n;
    const sqrtPriceX96Upper =
      formData.triggerMode === 'UPPER' || formData.triggerMode === 'BOTH'
        ? BigInt(formData.sqrtPriceX96Upper || '0')
        : BigInt('0xffffffffffffffffffffffffffffffffffffffff'); // Max sqrtPriceX96

    // Call the hook's registerOrder function
    // NOTE: isToken0Quote is passed so the hook can transform the trigger mode
    // and sqrtPriceX96 values for correct contract behavior
    registerOrder({
      contractAddress,
      positionManager,
      chainId,
      nftId,
      sqrtPriceX96Lower,
      sqrtPriceX96Upper,
      payoutAddress: userAddress,
      operatorAddress,
      validUntil,
      slippageBps: formData.slippageBps,
      triggerMode: formData.triggerMode,
      positionId,
      poolAddress: poolAddress as Address,
      positionOwner,
      isToken0Quote,
    });
  }, [
    userAddress,
    operatorAddress,
    formData,
    contractAddress,
    positionManager,
    chainId,
    nftId,
    positionId,
    poolAddress,
    positionOwner,
    isToken0Quote,
    registerOrder,
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

  if (!isOpen || !mounted) return null;

  // Check if form is valid for proceeding
  const isFormValid =
    (formData.triggerMode === 'LOWER' && formData.sqrtPriceX96Lower) ||
    (formData.triggerMode === 'UPPER' && formData.sqrtPriceX96Upper) ||
    (formData.triggerMode === 'BOTH' && formData.sqrtPriceX96Lower && formData.sqrtPriceX96Upper);

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
              <h2 className="text-lg font-semibold text-white">Set Close Order</h2>
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
