/**
 * Mock Hedge Data
 *
 * Temporary mock data for hedge UI visualization.
 * This will be replaced with real Hyperliquid API data.
 */

export interface MockHedge {
  id: string;
  coin: string;              // "ETH"
  leverage: number;          // 5
  direction: "long" | "short";
  size: number;              // 0.1 (in coin units)
  sizeFormatted: string;     // "0.1000 ETH"
  positionValueUsd: number;  // 330.29
  entryPrice: number;        // 3303.8
  markPrice: number;         // 3302.9
  pnlUsd: number;            // +0.09
  pnlPercent: number;        // +0.1
  liquidationPrice: number;  // 3885.5
  margin: number;            // 66.03
  marginMode: "isolated" | "cross";
  unrealizedFunding: number; // -0.00
  // For PnL curve and display in quote token
  currentValueQuote: number; // Value in position's quote token
  totalPnlQuote: number;     // PnL in position's quote token
  fundingApr: number;        // 21.85
}

/**
 * Two mock hedges for UI development.
 * These match the mockup design with ETH 5x short positions.
 */
export const MOCK_HEDGES: MockHedge[] = [
  {
    id: "hedge-1",
    coin: "ETH",
    leverage: 5,
    direction: "short",
    size: 0.1,
    sizeFormatted: "0.1000 ETH",
    positionValueUsd: 330.29,
    entryPrice: 3303.8,
    markPrice: 3302.9,
    pnlUsd: 0.09,
    pnlPercent: 0.1,
    liquidationPrice: 3885.5,
    margin: 66.03,
    marginMode: "isolated",
    unrealizedFunding: 0,
    currentValueQuote: 1672.46,
    totalPnlQuote: -0.612,
    fundingApr: 21.85,
  },
  {
    id: "hedge-2",
    coin: "ETH",
    leverage: 5,
    direction: "short",
    size: 0.1,
    sizeFormatted: "0.1000 ETH",
    positionValueUsd: 330.29,
    entryPrice: 3303.8,
    markPrice: 3302.9,
    pnlUsd: 0.09,
    pnlPercent: 0.1,
    liquidationPrice: 3885.5,
    margin: 66.03,
    marginMode: "isolated",
    unrealizedFunding: 0,
    currentValueQuote: 1672.46,
    totalPnlQuote: -0.612,
    fundingApr: 21.85,
  },
];
