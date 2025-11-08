'use client';

import type { ReactNode } from 'react';

interface EvmAccountSwitchPromptProps {
  title?: string;
  children: ReactNode;
}

/**
 * EVM Account Switch Prompt Component
 *
 * Displays a prompt when the connected wallet doesn't match the expected address.
 * Useful for position management where the user must be the position owner.
 *
 * Usage:
 * - Display when connected address doesn't match position owner
 * - Informs user of the required account via children
 * - User must switch accounts in their wallet directly
 *
 * @example
 * <EvmAccountSwitchPrompt title="Wrong Account">
 *   <p className="text-sm text-slate-400">
 *     Position Owner: {abbreviateAddress(ownerAddress)}
 *   </p>
 * </EvmAccountSwitchPrompt>
 */
export function EvmAccountSwitchPrompt({
  title = 'Wrong Account',
  children,
}: EvmAccountSwitchPromptProps) {
  return (
    <div className="bg-slate-800/50 backdrop-blur-md border border-slate-700/50 rounded-lg p-4">
      <div>
        <h3 className="text-lg font-semibold text-white mb-1">{title}</h3>
        {children}
      </div>
    </div>
  );
}
