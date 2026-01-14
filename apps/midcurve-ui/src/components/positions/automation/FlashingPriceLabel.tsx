'use client';

/**
 * FlashingPriceLabel - Displays current price with flash animation on change
 *
 * Shows the current price with an Activity icon. When the price value changes,
 * the component briefly flashes green (price up) or red (price down).
 */

import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";

interface FlashingPriceLabelProps {
  price: string;
  symbol: string;
}

type FlashDirection = 'up' | 'down' | null;

function parsePrice(priceStr: string): number {
  // Remove commas and parse as float
  return parseFloat(priceStr.replace(/,/g, ''));
}

export function FlashingPriceLabel({ price, symbol }: FlashingPriceLabelProps) {
  const [flashKey, setFlashKey] = useState(0);
  const [direction, setDirection] = useState<FlashDirection>(null);
  const prevPriceRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevPriceRef.current !== null && prevPriceRef.current !== price) {
      const prevValue = parsePrice(prevPriceRef.current);
      const newValue = parsePrice(price);
      setDirection(newValue > prevValue ? 'up' : 'down');
      setFlashKey((k) => k + 1);
    }
    prevPriceRef.current = price;
  }, [price]);

  const animationName = direction === 'up' ? 'price-flash-up' : 'price-flash-down';

  return (
    <span
      key={flashKey}
      className="flex items-center gap-1 text-xs text-slate-400 px-2 rounded"
      style={flashKey > 0 ? {
        animation: `${animationName} 0.5s ease-out`,
      } : undefined}
    >
      <Activity className="w-3 h-3" />
      {price} {symbol}
    </span>
  );
}
