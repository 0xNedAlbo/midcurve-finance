'use client';

/**
 * CreateHedgedPositionModal - Modal wizard for creating a hedged position
 *
 * Converts an existing Uniswap V3 position into a Hedge Vault with
 * SIL (Stop Impermanent Loss) and TIP (Take Impermanent Profit) triggers.
 *
 * Wizard Steps:
 * 1. Vault Configuration - Name, symbol, advanced options
 * 2. Trigger Configuration - SIL/TIP prices with visual curve
 * 3. Deploy - Multi-transaction execution (approve NFT, deploy vault)
 */

import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Shield, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Address } from 'viem';
import type { ListPositionData } from '@midcurve/api-shared';
import { VaultConfigStep } from './steps/VaultConfigStep';
import { TriggerConfigStep } from './steps/TriggerConfigStep';
import { DeployStep } from './steps/DeployStep';
import { useCloseOrders } from '@/hooks/automation/useCloseOrders';

interface CreateHedgedPositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: ListPositionData;
}

type WizardStep = 0 | 1 | 2;

const STEP_TITLES: Record<WizardStep, string> = {
  0: 'Configure Vault',
  1: 'Set Triggers',
  2: 'Deploy',
};

export function CreateHedgedPositionModal({
  isOpen,
  onClose,
  position,
}: CreateHedgedPositionModalProps) {
  const [mounted, setMounted] = useState(false);

  // Wizard step state
  const [step, setStep] = useState<WizardStep>(0);

  // Step 1: Vault Configuration
  const [vaultName, setVaultName] = useState('');
  const [vaultSymbol, setVaultSymbol] = useState('');
  const [lossCapBps, setLossCapBps] = useState(1000); // Default 10%
  const [cooldownBlocks, setCooldownBlocks] = useState(100);

  // Step 2: Trigger Configuration
  const [silSqrtPriceX96, setSilSqrtPriceX96] = useState<string | null>(null);
  const [tipSqrtPriceX96, setTipSqrtPriceX96] = useState<string | null>(null);

  // Step 3: Deployment
  const [, setVaultAddress] = useState<Address | null>(null);
  const [, setIsComplete] = useState(false);

  // Extract token data for defaults
  const baseToken = position.isToken0Quote
    ? position.pool.token1
    : position.pool.token0;
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;

  // Fetch existing close orders for defaults
  const { data: closeOrders } = useCloseOrders({ positionId: position.id });

  // Find existing SL/TP orders for defaults
  const defaultTriggers = useMemo(() => {
    if (!closeOrders || closeOrders.length === 0) {
      return { sil: undefined, tip: undefined };
    }

    const slOrder = closeOrders.find((order) => {
      const config = order.config as { triggerMode?: string; sqrtPriceX96Lower?: string };
      return config.triggerMode === 'LOWER' && order.status === 'active';
    });

    const tpOrder = closeOrders.find((order) => {
      const config = order.config as { triggerMode?: string; sqrtPriceX96Upper?: string };
      return config.triggerMode === 'UPPER' && order.status === 'active';
    });

    return {
      sil: slOrder ? (slOrder.config as { sqrtPriceX96Lower?: string }).sqrtPriceX96Lower : undefined,
      tip: tpOrder ? (tpOrder.config as { sqrtPriceX96Upper?: string }).sqrtPriceX96Upper : undefined,
    };
  }, [closeOrders]);

  // Ensure component is mounted on client side for portal
  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep(0);
      setVaultName('');
      setVaultSymbol('');
      setLossCapBps(1000);
      setCooldownBlocks(100);
      setSilSqrtPriceX96(null);
      setTipSqrtPriceX96(null);
      setVaultAddress(null);
      setIsComplete(false);
    }
  }, [isOpen]);

  // Validation for step navigation
  const canGoToStep1 = vaultName.trim().length > 0 && vaultSymbol.trim().length > 0;
  const canGoToStep2 = silSqrtPriceX96 !== null && tipSqrtPriceX96 !== null;

  const canGoNext = step === 0 ? canGoToStep1 : step === 1 ? canGoToStep2 : false;

  const handleNext = () => {
    if (step < 2 && canGoNext) {
      setStep((prev) => (prev + 1) as WizardStep);
    }
  };

  const handleBack = () => {
    if (step > 0) {
      setStep((prev) => (prev - 1) as WizardStep);
    }
  };

  const handleVaultDeployed = (address: Address) => {
    setVaultAddress(address);
  };

  const handleComplete = () => {
    setIsComplete(true);
    onClose();
  };

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800/95 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-2xl shadow-black/40 w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-slate-700/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-violet-900/30 rounded-lg flex items-center justify-center">
                <Shield className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">
                  Create Hedged Position
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  Step {step + 1} of 3: {STEP_TITLES[step]}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Progress Bar */}
          <div className="px-6 pt-4">
            <div className="flex items-center gap-2">
              {[0, 1, 2].map((s) => (
                <div key={s} className="flex-1">
                  <div
                    className={`h-1 rounded-full transition-colors ${
                      s <= step ? 'bg-violet-500' : 'bg-slate-700'
                    }`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 p-6 overflow-y-auto">
            {step === 0 && (
              <VaultConfigStep
                vaultName={vaultName}
                vaultSymbol={vaultSymbol}
                lossCapBps={lossCapBps}
                reopenCooldownBlocks={cooldownBlocks}
                onVaultNameChange={setVaultName}
                onVaultSymbolChange={setVaultSymbol}
                onLossCapChange={setLossCapBps}
                onCooldownChange={setCooldownBlocks}
                baseTokenSymbol={baseToken.symbol}
                quoteTokenSymbol={quoteToken.symbol}
                nftId={(position.config as { nftId: number }).nftId}
              />
            )}

            {step === 1 && (
              <TriggerConfigStep
                position={position}
                silSqrtPriceX96={silSqrtPriceX96}
                tipSqrtPriceX96={tipSqrtPriceX96}
                onSilChange={setSilSqrtPriceX96}
                onTipChange={setTipSqrtPriceX96}
                defaultSilSqrtPriceX96={defaultTriggers.sil}
                defaultTipSqrtPriceX96={defaultTriggers.tip}
              />
            )}

            {step === 2 && silSqrtPriceX96 && tipSqrtPriceX96 && (
              <DeployStep
                position={position}
                vaultName={vaultName}
                vaultSymbol={vaultSymbol}
                silSqrtPriceX96={silSqrtPriceX96}
                tipSqrtPriceX96={tipSqrtPriceX96}
                lossCapBps={lossCapBps}
                reopenCooldownBlocks={cooldownBlocks}
                onVaultDeployed={handleVaultDeployed}
                onComplete={handleComplete}
              />
            )}
          </div>

          {/* Footer - Navigation buttons (only for steps 0 and 1) */}
          {step < 2 && (
            <div className="flex items-center justify-between p-6 border-t border-slate-700/50">
              <button
                onClick={handleBack}
                disabled={step === 0}
                className="flex items-center gap-2 px-4 py-2 text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>

              <button
                onClick={handleNext}
                disabled={!canGoNext}
                className="flex items-center gap-2 px-6 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-600/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors cursor-pointer"
              >
                {step === 1 ? 'Continue to Deploy' : 'Next'}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
}
