'use client';

import { useEffect, useState } from 'react';
import type { EvmChainSlug } from '@/config/chains';

// Dynamic import to avoid SSR issues
let CowSwapWidgetReact: any = null;

interface CowSwapWidgetProps {
  buyToken?: {
    address: string;
    symbol: string;
    decimals: number;
    amount: string; // Human readable amount (e.g., "1500.5")
  };
  sellToken?: {
    address: string;
    symbol: string;
    decimals: number;
  };
  chain?: EvmChainSlug;
}

/**
 * Map our chain types to CowSwap chain IDs
 *
 * Note: CowSwap only supports Ethereum, Arbitrum, and Base.
 * Other chains will fall back to Ethereum.
 */
function getChainIdForCowSwap(chain?: EvmChainSlug): number {
  switch (chain) {
    case 'ethereum':
      return 1;
    case 'arbitrum':
      return 42161;
    case 'base':
      return 8453;
    default:
      return 1; // Default to Ethereum mainnet
  }
}

/**
 * CowSwap Widget Component
 *
 * Embeds the CowSwap trading widget for token swaps.
 * Used in the position wizard to allow users to top up insufficient token balances.
 *
 * Features:
 * - Dynamic import to prevent SSR issues
 * - Dark theme to match UI
 * - Pre-fills buy/sell tokens
 * - Connects to user's wallet automatically
 *
 * @param buyToken - Token to buy (pre-fills the widget)
 * @param sellToken - Token to sell from (optional pre-fill)
 * @param chain - Blockchain to use (ethereum, arbitrum, base)
 */
export function CowSwapWidget({
  buyToken,
  sellToken,
  chain,
}: CowSwapWidgetProps) {
  const [widgetLoaded, setWidgetLoaded] = useState(false);

  useEffect(() => {
    // Dynamic import to avoid SSR issues
    const loadWidget = async () => {
      if (!CowSwapWidgetReact) {
        try {
          const widgetLib = await import('@cowprotocol/widget-react');
          CowSwapWidgetReact = widgetLib.CowSwapWidget;
          setWidgetLoaded(true);
        } catch (error) {
          console.error('Failed to load CowSwap widget library:', error);
        }
      } else {
        setWidgetLoaded(true);
      }
    };

    loadWidget();
  }, []);

  if (!widgetLoaded) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-slate-400">Loading CowSwap widget...</div>
      </div>
    );
  }

  if (!CowSwapWidgetReact) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-slate-400">Failed to load widget</div>
      </div>
    );
  }

  // Prepare widget parameters
  const params: any = {
    appCode: 'MIDCURVE_LIQUIDITY_MANAGER',
    chainId: getChainIdForCowSwap(chain),
    theme: 'dark',
    width: '100%',
    height: '600px',
    standaloneMode: false,
    tradeType: 'swap',
  };

  // Pre-fill buy token if provided
  if (buyToken) {
    console.log(
      'Setting buy token in CowSwap widget:',
      buyToken.symbol,
      buyToken.amount
    );
    params.buy = {
      asset: buyToken.address,
      amount: buyToken.amount,
    };
  }

  // Pre-fill sell token if provided
  if (sellToken) {
    params.sell = {
      asset: sellToken.address,
    };
  }

  return (
    <div className="w-full">
      <CowSwapWidgetReact
        params={params}
        provider={(window as any)?.ethereum}
      />
    </div>
  );
}
