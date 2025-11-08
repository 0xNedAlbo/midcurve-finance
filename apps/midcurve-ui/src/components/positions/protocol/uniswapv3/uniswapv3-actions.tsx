/**
 * UniswapV3Actions - Action buttons for Uniswap V3 positions
 *
 * Protocol-specific component for position management actions.
 */

import { useState } from "react";
import { Plus, Minus, DollarSign } from "lucide-react";
import type { ListPositionData } from "@midcurve/api-shared";
import { IncreaseDepositModal } from "@/components/positions/increase-deposit-modal";
import { WithdrawPositionModal } from "@/components/positions/withdraw-position-modal";
import { CollectFeesModal } from "@/components/positions/collect-fees-modal";

interface UniswapV3ActionsProps {
  position: ListPositionData;
  isInRange: boolean; // Future: May be used for range-specific actions
}

export function UniswapV3Actions({ position }: UniswapV3ActionsProps) {
  const [showIncreaseModal, setShowIncreaseModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showCollectFeesModal, setShowCollectFeesModal] = useState(false);
  const hasUnclaimedFees = BigInt(position.unClaimedFees) > 0n;

  return (
    <>
      <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-700/50">
        <button
          onClick={() => setShowIncreaseModal(true)}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer ${
            position.isActive
              ? "text-green-300 bg-green-900/20 hover:bg-green-800/30 border-green-600/50"
              : "text-slate-500 bg-slate-800/30 border-slate-600/30 cursor-not-allowed"
          }`}
          disabled={!position.isActive}
        >
          <Plus className="w-3 h-3" />
          Increase Deposit
        </button>

        <button
          onClick={() => setShowWithdrawModal(true)}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer ${
            position.isActive
              ? "text-green-300 bg-green-900/20 hover:bg-green-800/30 border-green-600/50"
              : "text-slate-500 bg-slate-800/30 border-slate-600/30 cursor-not-allowed"
          }`}
          disabled={!position.isActive}
        >
          <Minus className="w-3 h-3" />
          Withdraw
        </button>

        <button
          onClick={() => setShowCollectFeesModal(true)}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors ${
            hasUnclaimedFees
              ? "text-amber-300 bg-amber-900/20 hover:bg-amber-800/30 border-amber-600/50 cursor-pointer"
              : "text-slate-500 bg-slate-800/30 border-slate-600/30 cursor-not-allowed"
          }`}
          disabled={!hasUnclaimedFees}
        >
          <DollarSign className="w-3 h-3" />
          Collect Fees
        </button>
      </div>

      {/* Increase Deposit Modal */}
      <IncreaseDepositModal
        isOpen={showIncreaseModal}
        onClose={() => setShowIncreaseModal(false)}
        position={position}
        onIncreaseSuccess={() => {
          // Don't auto-close - user will click Finish button
          // Cache invalidation is handled by useUpdatePositionWithEvents
        }}
      />

      {/* Withdraw Modal */}
      <WithdrawPositionModal
        isOpen={showWithdrawModal}
        onClose={() => setShowWithdrawModal(false)}
        position={position}
        onWithdrawSuccess={() => {
          // Don't auto-close - user will click Finish button
          // Cache invalidation is handled by useUpdatePositionWithEvents
        }}
      />

      {/* Collect Fees Modal */}
      <CollectFeesModal
        isOpen={showCollectFeesModal}
        onClose={() => setShowCollectFeesModal(false)}
        position={position}
        onCollectSuccess={() => {
          // Don't auto-close - user will click Finish button
          // Cache invalidation is handled by useUpdatePositionWithEvents
        }}
      />
    </>
  );
}
