/**
 * SimulationEngine
 *
 * A stateful simulation engine with path memory. Once a trigger fires,
 * it stays fired until the user explicitly resets.
 *
 * API:
 * - simulate(targetPrice): stateful — fires triggers on the path, updates state
 * - generateCurvePoints(): pure — evaluates current state without mutation
 * - reset(): restores initial state
 */

import type { SimulationComponent } from './simulation-component.js';
import type { SimulationInstrument } from './simulation-instrument.js';
import type {
  SimulationState,
  SimulationResult,
  CurvePoint,
  TriggeredEvent,
} from './simulation-state.js';

export class SimulationEngine {
  private readonly _initialComponents: SimulationComponent[];
  private readonly _initialInstruments: SimulationInstrument[];
  private readonly _costBasis: bigint;
  private readonly _baseDecimals: number;
  private readonly _quoteDecimals: number;
  private readonly _startPrice: bigint;

  private _currentState: SimulationState;
  private _lastPrice: bigint;

  constructor(initialState: SimulationState, startPrice: bigint) {
    // Store initial values for reset (components and instruments are immutable objects)
    this._initialComponents = [...initialState.components];
    this._initialInstruments = [...initialState.activeInstruments];
    this._costBasis = initialState.costBasis;
    this._baseDecimals = initialState.baseDecimals;
    this._quoteDecimals = initialState.quoteDecimals;
    this._startPrice = startPrice;

    // Set current state
    this._currentState = {
      components: [...initialState.components],
      activeInstruments: [...initialState.activeInstruments],
      triggeredEvents: [],
      costBasis: initialState.costBasis,
      baseDecimals: initialState.baseDecimals,
      quoteDecimals: initialState.quoteDecimals,
    };
    this._lastPrice = startPrice;
  }

  /**
   * Move the simulation to a new price (STATEFUL).
   *
   * Detects instruments that trigger on the path from lastPrice → targetPrice.
   * Applies them in traversal order. Updates internal state.
   */
  simulate(targetPrice: bigint): SimulationResult {
    const fromPrice = this._lastPrice;
    const movingUp = targetPrice > fromPrice;

    // 1. Find instruments that trigger on this path
    const candidates = this._currentState.activeInstruments.filter(inst => {
      if (movingUp) {
        return (
          inst.triggerDirection === 'above' &&
          inst.triggerPrice > fromPrice &&
          inst.triggerPrice <= targetPrice
        );
      } else {
        return (
          inst.triggerDirection === 'below' &&
          inst.triggerPrice < fromPrice &&
          inst.triggerPrice >= targetPrice
        );
      }
    });

    // 2. Sort by traversal order (first encountered on the path)
    candidates.sort((a, b) => {
      if (movingUp) {
        return a.triggerPrice < b.triggerPrice ? -1 : a.triggerPrice > b.triggerPrice ? 1 : 0;
      } else {
        return a.triggerPrice > b.triggerPrice ? -1 : a.triggerPrice < b.triggerPrice ? 1 : 0;
      }
    });

    // 3. Apply each trigger in order
    for (const inst of candidates) {
      const preValue = this._evaluatePortfolioValue(inst.triggerPrice);
      this._currentState = inst.apply(this._currentState, inst.triggerPrice);
      const postValue = this._evaluatePortfolioValue(inst.triggerPrice);

      this._currentState.triggeredEvents.push({
        instrumentId: inst.id,
        instrumentType: inst.id,
        triggeredAtPrice: inst.triggerPrice,
        preTriggerValue: preValue,
        postTriggerValue: postValue,
      });
    }

    // 4. Update last price
    this._lastPrice = targetPrice;

    // 5. Evaluate portfolio at target price
    return this._evaluateAt(targetPrice);
  }

  /**
   * Generate PnL curve points for a price range (PURE — no mutation).
   *
   * Evaluates the CURRENT state at each price point without firing
   * additional triggers.
   */
  generateCurvePoints(priceMin: bigint, priceMax: bigint, numPoints: number): CurvePoint[] {
    if (numPoints <= 0 || priceMax <= priceMin) return [];

    const step = (priceMax - priceMin) / BigInt(numPoints);
    const hasTriggered = this._currentState.triggeredEvents.length > 0;
    const points: CurvePoint[] = [];

    for (let i = 0; i <= numPoints; i++) {
      const price = priceMin + step * BigInt(i);
      if (price <= 0n) continue;

      const positionValue = this._evaluatePortfolioValue(price);
      const baseTokenAmount = this._evaluateBaseAmount(price);
      const quoteTokenAmount = this._evaluateQuoteAmount(price);
      const pnlValue = positionValue - this._costBasis;
      const pnlPercent = this._costBasis > 0n
        ? Number((pnlValue * 1_000_000n) / this._costBasis) / 10_000
        : 0;

      points.push({
        price,
        positionValue,
        pnlValue,
        pnlPercent,
        baseTokenAmount,
        quoteTokenAmount,
        hasTriggeredInstruments: hasTriggered,
      });
    }

    return points;
  }

  /**
   * Reset to initial state, clearing all triggered events.
   */
  reset(): void {
    this._currentState = {
      components: [...this._initialComponents],
      activeInstruments: [...this._initialInstruments],
      triggeredEvents: [],
      costBasis: this._costBasis,
      baseDecimals: this._baseDecimals,
      quoteDecimals: this._quoteDecimals,
    };
    this._lastPrice = this._startPrice;
  }

  /** Read-only access to current state */
  getState(): Readonly<SimulationState> {
    return this._currentState;
  }

  /** List of triggered events since last reset */
  getTriggeredEvents(): readonly TriggeredEvent[] {
    return this._currentState.triggeredEvents;
  }

  /** Current simulated price (last price passed to simulate()) */
  get lastPrice(): bigint {
    return this._lastPrice;
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private _evaluatePortfolioValue(price: bigint): bigint {
    let total = 0n;
    for (const component of this._currentState.components) {
      total += component.getValueAtPrice(price);
    }
    return total;
  }

  private _evaluateBaseAmount(price: bigint): bigint {
    let total = 0n;
    for (const component of this._currentState.components) {
      total += component.getBaseAmountAtPrice(price);
    }
    return total;
  }

  private _evaluateQuoteAmount(price: bigint): bigint {
    let total = 0n;
    for (const component of this._currentState.components) {
      total += component.getQuoteAmountAtPrice(price);
    }
    return total;
  }

  private _evaluateAt(price: bigint): SimulationResult {
    const positionValue = this._evaluatePortfolioValue(price);
    const pnlValue = positionValue - this._costBasis;
    const pnlPercent = this._costBasis > 0n
      ? Number((pnlValue * 1_000_000n) / this._costBasis) / 10_000
      : 0;

    return {
      positionValue,
      pnlValue,
      pnlPercent,
      baseTokenAmount: this._evaluateBaseAmount(price),
      quoteTokenAmount: this._evaluateQuoteAmount(price),
      triggeredInstrumentIds: this._currentState.triggeredEvents.map(e => e.instrumentId),
    };
  }
}
