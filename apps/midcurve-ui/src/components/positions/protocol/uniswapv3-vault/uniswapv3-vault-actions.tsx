'use client';

/**
 * UniswapV3VaultActions - Action buttons for vault positions
 *
 * Protocol-specific component for vault position management actions.
 * Includes position management (increase, withdraw, collect fees) and
 * automation buttons (stop-loss, take-profit).
 */

import { useState, useMemo } from 'react';
import { Plus, Minus, DollarSign } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { UniswapV3VaultPositionData } from '@/hooks/positions/uniswapv3-vault/useUniswapV3VaultPosition';
import type {
  UniswapV3VaultPositionConfigResponse,
  UniswapV3VaultPositionStateResponse,
} from '@midcurve/api-shared';
import { getChainSlugByChainId } from '@/config/chains';
import { VaultStopLossButton } from '@/components/positions/automation/VaultStopLossButton';
import { VaultTakeProfitButton } from '@/components/positions/automation/VaultTakeProfitButton';
import { FlashingPriceLabel } from '@/components/positions/automation/FlashingPriceLabel';
import { formatTriggerPrice, type TokenConfig } from '@/components/positions/automation/order-button-utils';
import { UniswapV3VaultCollectFeesModal } from './uniswapv3-vault-collect-fees-modal';

interface UniswapV3VaultActionsProps {
  position: UniswapV3VaultPositionData;
  isInRange: boolean;
}

export function UniswapV3VaultActions({ position }: UniswapV3VaultActionsProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [showCollectFeesModal, setShowCollectFeesModal] = useState(false);

  const config = position.config as UniswapV3VaultPositionConfigResponse;
  const state = position.state as UniswapV3VaultPositionStateResponse;

  const hasShares = BigInt(state.sharesBalance) > 0n;
  const hasUnclaimedFees = BigInt(position.unclaimedYield) > 0n;

  // Get base/quote tokens
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;
  const baseToken = position.isToken0Quote
    ? position.pool.token1
    : position.pool.token0;
  const baseTokenConfig = baseToken.config as { address: string };
  const quoteTokenConfig = quoteToken.config as { address: string };

  const poolState = position.pool.state as { sqrtPriceX96: string };

  // Build token config for price display
  const tokenConfig: TokenConfig = useMemo(
    () => ({
      baseTokenAddress: baseTokenConfig.address,
      quoteTokenAddress: quoteTokenConfig.address,
      baseTokenDecimals: baseToken.decimals,
      quoteTokenDecimals: quoteToken.decimals,
      baseTokenSymbol: baseToken.symbol,
      quoteTokenSymbol: quoteToken.symbol,
    }),
    [baseTokenConfig.address, quoteTokenConfig.address, baseToken.decimals, quoteToken.decimals, baseToken.symbol, quoteToken.symbol]
  );

  // Calculate current price display
  const currentPriceDisplay = useMemo(() => {
    return formatTriggerPrice(poolState.sqrtPriceX96, tokenConfig);
  }, [poolState.sqrtPriceX96, tokenConfig]);

  // Backend already determines ownership via the authenticated session
  if (!state.isOwnedByUser) {
    return null;
  }

  return (
    <>
    <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-700/50">
      {/* Increase Deposit / Reopen Position */}
      <button
        onClick={() => {
          const chainSlug = getChainSlugByChainId(config.chainId);
          if (chainSlug) {
            navigate(`/positions/increase/uniswapv3-vault/${chainSlug}/${config.vaultAddress}/${config.ownerAddress}`, { state: { returnTo: location.pathname } });
          }
        }}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer text-green-300 bg-green-900/20 hover:bg-green-800/30 border-green-600/50"
      >
        <Plus className="w-3 h-3" />
        {!hasShares ? 'Reopen Position' : 'Increase Deposit'}
      </button>

      {/* Withdraw — only when user has shares */}
      {hasShares && (
        <button
          onClick={() => {
            const chainSlug = getChainSlugByChainId(config.chainId);
            if (chainSlug) {
              navigate(`/positions/withdraw/uniswapv3-vault/${chainSlug}/${config.vaultAddress}/${config.ownerAddress}`, { state: { returnTo: location.pathname } });
            }
          }}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors cursor-pointer text-green-300 bg-green-900/20 hover:bg-green-800/30 border-green-600/50"
        >
          <Minus className="w-3 h-3" />
          Withdraw
        </button>
      )}

      {/* Collect Fees */}
      {(hasShares || hasUnclaimedFees) && (
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
      )}

      {/* Automation Buttons */}
      <div className="w-px h-6 bg-slate-600/50 mx-1" />

      <VaultStopLossButton
        chainId={config.chainId}
        vaultAddress={config.vaultAddress}
        ownerAddress={config.ownerAddress}
        baseToken={{
          address: baseTokenConfig.address,
          symbol: baseToken.symbol,
          decimals: baseToken.decimals,
        }}
        quoteToken={{
          address: quoteTokenConfig.address,
          symbol: quoteToken.symbol,
          decimals: quoteToken.decimals,
        }}
        isToken0Quote={position.isToken0Quote}
        disabled={!hasShares}
        disabledReason={!hasShares ? 'No shares in position' : undefined}
        closeOrders={position.closeOrders ?? []}
      />

      {/* Current Price Display */}
      <FlashingPriceLabel price={currentPriceDisplay} symbol={quoteToken.symbol} />

      <VaultTakeProfitButton
        chainId={config.chainId}
        vaultAddress={config.vaultAddress}
        ownerAddress={config.ownerAddress}
        baseToken={{
          address: baseTokenConfig.address,
          symbol: baseToken.symbol,
          decimals: baseToken.decimals,
        }}
        quoteToken={{
          address: quoteTokenConfig.address,
          symbol: quoteToken.symbol,
          decimals: quoteToken.decimals,
        }}
        isToken0Quote={position.isToken0Quote}
        disabled={!hasShares}
        disabledReason={!hasShares ? 'No shares in position' : undefined}
        closeOrders={position.closeOrders ?? []}
      />
    </div>

    {/* Collect Fees Modal */}
    <UniswapV3VaultCollectFeesModal
      isOpen={showCollectFeesModal}
      onClose={() => setShowCollectFeesModal(false)}
      position={position}
    />
    </>
  );
}
