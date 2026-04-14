/**
 * Vault Take Profit Button
 *
 * When no order exists: green "+" button to create via wizard.
 * When order exists: 3-zone inline control (toggle monitoring | edit | cancel).
 *
 * Vault-specific: navigates to vault risk triggers route using vaultAddress.
 */

'use client';

import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { TriggerMode, SerializedCloseOrder } from '@midcurve/api-shared';
import { getChainSlugByChainId } from '@/config/chains';
import {
  findOrderForTriggerMode,
  getOrderButtonLabel,
  getOrderButtonVisualState,
  type TokenConfig,
} from './order-button-utils';
import { VaultOrderActionButton } from './VaultOrderActionButton';

interface VaultTakeProfitButtonProps {
  chainId: number;
  vaultAddress: string;
  ownerAddress: string;
  baseToken: {
    address: string;
    symbol: string;
    decimals: number;
  };
  quoteToken: {
    address: string;
    symbol: string;
    decimals: number;
  };
  isToken0Quote: boolean;
  disabled?: boolean;
  disabledReason?: string;
  closeOrders: SerializedCloseOrder[];
}

export function VaultTakeProfitButton({
  chainId,
  vaultAddress,
  ownerAddress,
  baseToken,
  quoteToken,
  isToken0Quote,
  disabled = false,
  disabledReason,
  closeOrders,
}: VaultTakeProfitButtonProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const tokenConfig: TokenConfig = useMemo(
    () => ({
      baseTokenAddress: baseToken.address,
      quoteTokenAddress: quoteToken.address,
      baseTokenDecimals: baseToken.decimals,
      quoteTokenDecimals: quoteToken.decimals,
      baseTokenSymbol: baseToken.symbol,
      quoteTokenSymbol: quoteToken.symbol,
    }),
    [baseToken, quoteToken]
  );

  const tpTriggerMode = (isToken0Quote ? 'LOWER' : 'UPPER') as TriggerMode;
  const activeOrder = useMemo(() => {
    return findOrderForTriggerMode(closeOrders, tpTriggerMode);
  }, [closeOrders, tpTriggerMode]);

  const buttonLabel = useMemo(() => {
    if (!activeOrder) return null;
    return getOrderButtonLabel(activeOrder, 'takeProfit', tokenConfig);
  }, [activeOrder, tokenConfig]);

  const visualState = activeOrder ? getOrderButtonVisualState(activeOrder) : null;

  const handleNavigateToWizard = () => {
    const chainSlug = getChainSlugByChainId(chainId);
    if (chainSlug) {
      navigate(`/positions/triggers/uniswapv3-vault/${chainSlug}/${vaultAddress}/${ownerAddress}`, {
        state: { returnTo: location.pathname },
      });
    }
  };

  if (disabled) {
    return (
      <button
        disabled
        title={disabledReason}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg text-slate-500 bg-slate-800/30 border-slate-600/30 cursor-not-allowed"
      >
        <Plus className="w-3 h-3" />
        Take Profit
      </button>
    );
  }

  if (activeOrder && buttonLabel && visualState) {
    return (
      <VaultOrderActionButton
        order={activeOrder}
        orderType="TAKE_PROFIT"
        visualState={visualState}
        buttonLabel={buttonLabel}
        chainId={chainId}
        vaultAddress={vaultAddress}
        ownerAddress={ownerAddress}
        onNavigateToWizard={handleNavigateToWizard}
      />
    );
  }

  return (
    <button
      onClick={handleNavigateToWizard}
      className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer text-green-300 bg-green-900/20 hover:bg-green-800/30 border-green-600/50"
    >
      <Plus className="w-3 h-3" />
      Take Profit
    </button>
  );
}
