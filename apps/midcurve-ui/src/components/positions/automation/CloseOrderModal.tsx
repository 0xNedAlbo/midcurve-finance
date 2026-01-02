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
import type { SerializedCloseOrder, TriggerMode } from '@midcurve/api-shared';
import { useCreateCloseOrder, type CreateCloseOrderResult } from '@/hooks/automation';
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
  poolAddress: _poolAddress, // Reserved for future use (pool subscription)
  chainId: _chainId, // Reserved for future use (chain-specific logic)
  baseToken,
  quoteToken,
  currentSqrtPriceX96,
  currentPriceDisplay,
  onSuccess,
}: CloseOrderModalProps) {
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
  const [error, setError] = useState<string | null>(null);

  // Create order mutation
  const createOrderMutation = useCreateCloseOrder();

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
      setError(null);
    }
  }, [isOpen]);

  // Handle form data updates
  const handleFormChange = useCallback((updates: Partial<CloseOrderFormData>) => {
    setFormData((prev) => ({ ...prev, ...updates }));
  }, []);

  // Handle step progression
  const handleContinue = useCallback(() => {
    if (step === 'configure') {
      setStep('review');
    } else if (step === 'review') {
      setStep('processing');
      submitOrder();
    }
  }, [step]);

  const handleBack = useCallback(() => {
    if (step === 'review') {
      setStep('configure');
    }
  }, [step]);

  // Submit the order
  const submitOrder = useCallback(async () => {
    setError(null);

    // Calculate valid until date
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + formData.validUntilDays);

    try {
      const result: CreateCloseOrderResult = await createOrderMutation.mutateAsync({
        orderType: 'uniswapv3',
        positionId,
        triggerMode: formData.triggerMode,
        sqrtPriceX96Lower:
          formData.triggerMode === 'LOWER' || formData.triggerMode === 'BOTH'
            ? formData.sqrtPriceX96Lower
            : undefined,
        sqrtPriceX96Upper:
          formData.triggerMode === 'UPPER' || formData.triggerMode === 'BOTH'
            ? formData.sqrtPriceX96Upper
            : undefined,
        slippageBps: formData.slippageBps,
        validUntil: validUntil.toISOString(),
      });

      setCreatedOrder(result.order);
      setStep('success');
      onSuccess?.(result.order);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create close order');
      setStep('review'); // Go back to review on error
    }
  }, [formData, positionId, createOrderMutation, onSuccess]);

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
                error={error}
              />
            )}

            {step === 'processing' && (
              <CloseOrderProcessingStep />
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
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2"
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
