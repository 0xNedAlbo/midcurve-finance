'use client';

/**
 * TriggerConfigStep - Step 2 of Hedge Vault creation wizard
 *
 * Configures SIL (Stop Impermanent Loss) and TIP (Take Impermanent Profit)
 * trigger prices using a modified range slider and the HedgePnLCurve visualization.
 *
 * Defaults:
 * - If existing SL order exists: use its sqrtPriceX96Lower as SIL default
 * - If existing TP order exists: use its sqrtPriceX96Upper as TIP default
 * - Otherwise: use position's tickLower/tickUpper converted to prices
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import type { ListPositionData } from '@midcurve/api-shared';
import {
  tickToPrice,
  priceToSqrtRatioX96,
  pricePerToken0InToken1,
  pricePerToken1InToken0,
} from '@midcurve/shared';
import { formatCompactValue } from '@/lib/fraction-format';
import { HedgePnLCurve } from '../HedgePnLCurve';

interface TriggerConfigStepProps {
  position: ListPositionData;
  silSqrtPriceX96: string | null;
  tipSqrtPriceX96: string | null;
  onSilChange: (sqrtPriceX96: string) => void;
  onTipChange: (sqrtPriceX96: string) => void;
  defaultSilSqrtPriceX96?: string;
  defaultTipSqrtPriceX96?: string;
}

const DEFAULT_RANGE_PERCENT = 50;

export function TriggerConfigStep({
  position,
  silSqrtPriceX96,
  tipSqrtPriceX96,
  onSilChange,
  onTipChange,
  defaultSilSqrtPriceX96,
  defaultTipSqrtPriceX96,
}: TriggerConfigStepProps) {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState<'sil' | 'tip' | null>(null);

  // Extract pool and token data - use inline types to avoid Date/string mismatch
  const pool = position.pool;
  const poolState = position.pool.state as { sqrtPriceX96: string; currentTick: number };
  const positionConfig = position.config as { tickLower: number; tickUpper: number; nftId: number; chainId: number };
  const positionState = position.state as { liquidity: string };

  // Get base/quote tokens - use token objects directly without casting to Erc20Token
  // since API returns serialized data (createdAt as string, not Date)
  const quoteToken = position.isToken0Quote
    ? position.pool.token0
    : position.pool.token1;
  const baseToken = position.isToken0Quote
    ? position.pool.token1
    : position.pool.token0;

  const baseIsToken0 =
    BigInt(baseToken.config.address) < BigInt(quoteToken.config.address);

  // Calculate current price
  const currentPrice = useMemo(() => {
    try {
      const sqrtPrice = BigInt(poolState.sqrtPriceX96);
      const price = baseIsToken0
        ? pricePerToken0InToken1(sqrtPrice, baseToken.decimals)
        : pricePerToken1InToken0(sqrtPrice, baseToken.decimals);
      return Number(price) / Math.pow(10, quoteToken.decimals);
    } catch {
      return 0;
    }
  }, [poolState.sqrtPriceX96, baseIsToken0, baseToken.decimals, quoteToken.decimals]);

  // Calculate position range prices
  const { lowerPrice, upperPrice } = useMemo(() => {
    try {
      const priceAtTickLower = tickToPrice(
        positionConfig.tickLower,
        baseToken.config.address,
        quoteToken.config.address,
        baseToken.decimals
      );
      const priceAtTickUpper = tickToPrice(
        positionConfig.tickUpper,
        baseToken.config.address,
        quoteToken.config.address,
        baseToken.decimals
      );

      const divisor = 10n ** BigInt(quoteToken.decimals);
      const isToken0Quote = !baseIsToken0;

      return {
        lowerPrice: isToken0Quote
          ? Number(priceAtTickUpper) / Number(divisor)
          : Number(priceAtTickLower) / Number(divisor),
        upperPrice: isToken0Quote
          ? Number(priceAtTickLower) / Number(divisor)
          : Number(priceAtTickUpper) / Number(divisor),
      };
    } catch {
      return { lowerPrice: 0, upperPrice: 0 };
    }
  }, [positionConfig.tickLower, positionConfig.tickUpper, baseToken, quoteToken, baseIsToken0]);

  // Slider bounds state
  const [sliderBounds, setSliderBounds] = useState(() => ({
    min: currentPrice * (1 - DEFAULT_RANGE_PERCENT / 100),
    max: currentPrice * (1 + DEFAULT_RANGE_PERCENT / 100),
  }));

  // Convert sqrtPriceX96 to display price
  const sqrtPriceToDisplayPrice = useCallback(
    (sqrtPriceX96: string | null): number => {
      if (!sqrtPriceX96) return 0;
      try {
        const sqrtPrice = BigInt(sqrtPriceX96);
        const price = baseIsToken0
          ? pricePerToken0InToken1(sqrtPrice, baseToken.decimals)
          : pricePerToken1InToken0(sqrtPrice, baseToken.decimals);
        return Number(price) / Math.pow(10, quoteToken.decimals);
      } catch {
        return 0;
      }
    },
    [baseIsToken0, baseToken.decimals, quoteToken.decimals]
  );

  // Convert display price to sqrtPriceX96
  const displayPriceToSqrtPrice = useCallback(
    (price: number): string => {
      try {
        const priceBigInt = BigInt(Math.floor(price * Math.pow(10, quoteToken.decimals)));
        const sqrtRatio = priceToSqrtRatioX96(
          baseToken.config.address,
          quoteToken.config.address,
          baseToken.decimals,
          priceBigInt
        );
        return sqrtRatio.toString();
      } catch {
        return '0';
      }
    },
    [baseToken.config.address, quoteToken.config.address, baseToken.decimals, quoteToken.decimals]
  );

  // Current SIL/TIP display prices
  const silDisplayPrice = sqrtPriceToDisplayPrice(silSqrtPriceX96);
  const tipDisplayPrice = sqrtPriceToDisplayPrice(tipSqrtPriceX96);

  // Initialize defaults from close orders or position range
  useEffect(() => {
    // Only initialize if not already set
    if (!silSqrtPriceX96) {
      if (defaultSilSqrtPriceX96) {
        onSilChange(defaultSilSqrtPriceX96);
      } else {
        // Default to position's lower price
        const defaultSilPrice = displayPriceToSqrtPrice(lowerPrice);
        if (defaultSilPrice !== '0') {
          onSilChange(defaultSilPrice);
        }
      }
    }

    if (!tipSqrtPriceX96) {
      if (defaultTipSqrtPriceX96) {
        onTipChange(defaultTipSqrtPriceX96);
      } else {
        // Default to position's upper price
        const defaultTipPrice = displayPriceToSqrtPrice(upperPrice);
        if (defaultTipPrice !== '0') {
          onTipChange(defaultTipPrice);
        }
      }
    }
  }, [
    silSqrtPriceX96,
    tipSqrtPriceX96,
    defaultSilSqrtPriceX96,
    defaultTipSqrtPriceX96,
    lowerPrice,
    upperPrice,
    displayPriceToSqrtPrice,
    onSilChange,
    onTipChange,
  ]);

  // Calculate slider positions as percentages
  const priceToPercent = useCallback(
    (price: number) => {
      return ((price - sliderBounds.min) / (sliderBounds.max - sliderBounds.min)) * 100;
    },
    [sliderBounds]
  );

  const percentToPrice = useCallback(
    (percent: number) => {
      return sliderBounds.min + (percent / 100) * (sliderBounds.max - sliderBounds.min);
    },
    [sliderBounds]
  );

  const currentPricePercent = priceToPercent(currentPrice);
  const silPricePercent = silDisplayPrice ? priceToPercent(silDisplayPrice) : 0;
  const tipPricePercent = tipDisplayPrice ? priceToPercent(tipDisplayPrice) : 100;

  // Handle mouse events for dragging
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, handle: 'sil' | 'tip') => {
      e.preventDefault();
      setIsDragging(handle);
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !sliderRef.current) return;

      const rect = sliderRef.current.getBoundingClientRect();
      const percent = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));
      const newPrice = percentToPrice(percent);

      if (isDragging === 'sil') {
        // SIL must be below TIP
        if (newPrice < tipDisplayPrice) {
          const sqrtPrice = displayPriceToSqrtPrice(newPrice);
          if (sqrtPrice !== '0') {
            onSilChange(sqrtPrice);
          }
        }
      } else if (isDragging === 'tip') {
        // TIP must be above SIL
        if (newPrice > silDisplayPrice) {
          const sqrtPrice = displayPriceToSqrtPrice(newPrice);
          if (sqrtPrice !== '0') {
            onTipChange(sqrtPrice);
          }
        }
      }
    },
    [isDragging, tipDisplayPrice, silDisplayPrice, percentToPrice, displayPriceToSqrtPrice, onSilChange, onTipChange]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(null);
  }, []);

  // Add global mouse event listeners during drag
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Handle zoom
  const handleZoom = useCallback(
    (direction: 'in' | 'out', shiftKey = false) => {
      const zoomMultiplier = shiftKey ? 10 : 1;
      const zoomPercent = 1 * zoomMultiplier;
      const expansion = currentPrice * (zoomPercent / 100);

      if (direction === 'out') {
        let newMin = sliderBounds.min - expansion;
        if (newMin <= 0) newMin = 0.01;
        const newMax = sliderBounds.max + expansion;
        setSliderBounds({ min: newMin, max: newMax });
      } else {
        let newMin = sliderBounds.min + expansion;
        if (newMin > silDisplayPrice) newMin = silDisplayPrice;
        let newMax = sliderBounds.max - expansion;
        if (newMax < tipDisplayPrice) newMax = tipDisplayPrice;
        setSliderBounds({ min: newMin, max: newMax });
      }
    },
    [currentPrice, sliderBounds, silDisplayPrice, tipDisplayPrice]
  );

  // Format price for display
  const formatPrice = useCallback(
    (price: number) => {
      const priceBigInt = BigInt(Math.floor(price * Math.pow(10, quoteToken.decimals)));
      return formatCompactValue(priceBigInt, quoteToken.decimals);
    },
    [quoteToken.decimals]
  );

  return (
    <div className="space-y-6">
      {/* Price Display */}
      <div className="flex justify-between items-center text-sm">
        <div className="text-red-400">
          <span className="text-xs text-slate-500 block">SIL Price</span>
          <span className="font-mono">{silDisplayPrice ? formatPrice(silDisplayPrice) : '-'}</span>
          <span className="text-slate-500 ml-1">{quoteToken.symbol}</span>
        </div>
        <div className="text-center">
          <span className="text-xs text-slate-500 block">Current</span>
          <span className="font-mono text-yellow-400">{formatPrice(currentPrice)}</span>
          <span className="text-yellow-300 ml-1">{quoteToken.symbol}</span>
        </div>
        <div className="text-green-400">
          <span className="text-xs text-slate-500 block">TIP Price</span>
          <span className="font-mono">{tipDisplayPrice ? formatPrice(tipDisplayPrice) : '-'}</span>
          <span className="text-slate-500 ml-1">{quoteToken.symbol}</span>
        </div>
      </div>

      {/* Slider Container */}
      <div className="flex items-center gap-3">
        {/* Zoom In Control */}
        <button
          onClick={(e) => handleZoom('in', e.shiftKey)}
          className="p-2 bg-slate-700/80 backdrop-blur-sm border border-slate-600 rounded text-slate-300 hover:text-white hover:bg-slate-600/80 transition-colors cursor-pointer"
          title="Zoom in (Shift: 10x)"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        {/* Slider Track */}
        <div className="flex-1 relative">
          <div
            ref={sliderRef}
            className="relative h-6 bg-slate-700/50 rounded-full border border-slate-600/50 cursor-pointer"
          >
            {/* Active zone fill (between SIL and TIP) */}
            <div
              className="absolute top-0 h-full bg-violet-500/30 rounded-full border border-violet-400/50"
              style={{
                left: `${silPricePercent}%`,
                width: `${tipPricePercent - silPricePercent}%`,
              }}
            />

            {/* Current Price Indicator */}
            <div
              className="absolute top-0 w-0.5 h-full bg-yellow-400"
              style={{ left: `${currentPricePercent}%` }}
            />

            {/* SIL Handle */}
            <div
              className={`absolute w-5 h-5 bg-red-500 border-2 border-slate-800 rounded-full cursor-grab transform -translate-x-1/2 -translate-y-0.5 ${
                isDragging === 'sil' ? 'scale-110 cursor-grabbing' : 'hover:scale-105'
              } transition-transform`}
              style={{ left: `${silPricePercent}%`, top: '50%' }}
              onMouseDown={(e) => handleMouseDown(e, 'sil')}
            />

            {/* TIP Handle */}
            <div
              className={`absolute w-5 h-5 bg-green-500 border-2 border-slate-800 rounded-full cursor-grab transform -translate-x-1/2 -translate-y-0.5 ${
                isDragging === 'tip' ? 'scale-110 cursor-grabbing' : 'hover:scale-105'
              } transition-transform`}
              style={{ left: `${tipPricePercent}%`, top: '50%' }}
              onMouseDown={(e) => handleMouseDown(e, 'tip')}
            />
          </div>
        </div>

        {/* Zoom Out Control */}
        <button
          onClick={(e) => handleZoom('out', e.shiftKey)}
          className="p-2 bg-slate-700/80 backdrop-blur-sm border border-slate-600 rounded text-slate-300 hover:text-white hover:bg-slate-600/80 transition-colors cursor-pointer"
          title="Zoom out (Shift: 10x)"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
      </div>

      {/* Slider Labels */}
      <div className="flex justify-between text-xs text-slate-500" style={{ marginLeft: '56px', marginRight: '56px' }}>
        <span>{formatPrice(sliderBounds.min)}</span>
        <span>{formatPrice(sliderBounds.max)}</span>
      </div>

      {/* Hedge PnL Curve */}
      {silSqrtPriceX96 && tipSqrtPriceX96 && (
        <div className="mt-6">
          <h4 className="text-sm font-medium text-slate-300 mb-3">Hedge Vault PnL Curve</h4>
          <HedgePnLCurve
            pool={pool as any}
            baseToken={baseToken as any}
            quoteToken={quoteToken as any}
            tickLower={positionConfig.tickLower}
            tickUpper={positionConfig.tickUpper}
            silSqrtPriceX96={silSqrtPriceX96}
            tipSqrtPriceX96={tipSqrtPriceX96}
            liquidity={BigInt(positionState.liquidity)}
            costBasis={BigInt(position.currentValue)}
            sliderBounds={sliderBounds}
            height={300}
          />
        </div>
      )}

      {/* Info Box */}
      <div className="p-4 bg-slate-700/30 border border-slate-600/30 rounded-lg text-sm">
        <h4 className="font-medium text-slate-300 mb-2">How SIL/TIP Works</h4>
        <ul className="space-y-1 text-slate-400">
          <li>
            <span className="text-red-400 font-medium">SIL</span> (Stop Impermanent Loss): Position
            closes below this price, locking in value as quote tokens
          </li>
          <li>
            <span className="text-green-400 font-medium">TIP</span> (Take Impermanent Profit):
            Position closes above this price, converting to base tokens
          </li>
          <li>
            <span className="text-violet-400 font-medium">Active Zone</span>: Between SIL and TIP,
            your position rebalances normally
          </li>
        </ul>
      </div>
    </div>
  );
}
