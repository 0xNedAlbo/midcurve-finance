/**
 * Gas Readiness Explainer
 *
 * What the user needs to understand before the gate's steps, and nothing more:
 * this makes automated closing possible on this chain, it happens once, and it
 * costs a fixed amount plus gas.
 *
 * On wording. The funds go to the environment's operator wallet. They are not
 * held for the user, not attributable to them, and not recoverable — the refund
 * path was removed in March 2026 with the per-user autowallet and nothing
 * replaced it. So: a contribution to this instance's ability to execute orders,
 * never a deposit, a balance, or "your gas", and nothing may suggest it can be
 * withdrawn.
 *
 * Deliberately absent: any claim that the fees this unlocks will refuel the
 * operator on their own. RefuelOperatorRule looks for a treasury once, at
 * startup, and stays unscheduled until midcurve-business-logic restarts.
 * Promising a loop the running system does not have would be the same
 * verification theater the architecture docs warn about, pointed outward.
 */

import { Info } from 'lucide-react';
import { formatCompactValue } from '@midcurve/shared';

interface GasReadinessExplainerProps {
  /** Fixed funding amount in wei, as a decimal string */
  fundingAmountWei: string | null;
  /** Native currency symbol for the chain (e.g. "ETH") */
  nativeSymbol: string;
  /** True when the treasury exists and only the operator needs topping up */
  isTopUpOnly: boolean;
}

export function GasReadinessExplainer({
  fundingAmountWei,
  nativeSymbol,
  isTopUpOnly,
}: GasReadinessExplainerProps) {
  const amount = fundingAmountWei
    ? `${formatCompactValue(BigInt(fundingAmountWei), 18)} ${nativeSymbol}`
    : null;

  return (
    <div className="rounded-lg bg-slate-700/30 border border-slate-600/20 px-4 py-3">
      <div className="flex gap-3">
        <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-1.5 text-sm">
          <p className="text-white">
            {isTopUpOnly
              ? 'Automated closing on this chain has run out of gas.'
              : 'This makes automated closing possible on this chain.'}
          </p>
          <p className="text-slate-400">
            {isTopUpOnly
              ? 'A contribution keeps it running.'
              : 'It happens once for this chain.'}
            {amount && (
              <>
                {' '}
                It costs {amount} plus gas, contributed to this instance&apos;s
                ability to execute orders — not held for you, and not
                refundable.
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
