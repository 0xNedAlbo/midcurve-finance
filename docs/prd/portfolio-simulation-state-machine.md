# Portfolio Simulation State Machine

## Product Requirements Document · Midcurve Finance

**Version 1.0 | March 2026**
**Status: DRAFT | Classification: Internal**

---

## 1. Problem Statement

The position detail page includes an interactive PnL curve and price slider that let users explore how their position value changes at different prices. This simulation is **stateless**: each price point is evaluated independently via `simulatePnLAtPrice(price)`.

The existing `CloseOrderSimulationOverlay` ([close-order-simulation-overlay.ts](packages/midcurve-shared/src/types/position/close-order-simulation/close-order-simulation-overlay.ts)) improves on the raw curve by showing post-trigger behavior — when the simulated price is below the stop-loss, it shows the post-SL value; when above take-profit, it shows the post-TP value. However, it has no **path memory**:

- A user drags the slider below the stop-loss price. The curve shows the position is closed (flat line). The user then drags back above the stop-loss price. The curve snaps back to the original CL shape — as if the stop-loss never fired.
- In reality, a stop-loss closes the position irreversibly. The simulation should reflect this: once a trigger fires, the portfolio state changes permanently until the user explicitly resets.

The stateless overlay also cannot model **sequential trigger interactions**: if a price path crosses both SL and TP, the first trigger firing may invalidate the second (a full close at SL means there is nothing left for TP to close).

## 2. Solution

A **simulation engine** with persistent state that models the lifecycle of a portfolio as price changes. The engine:

1. Tracks the current portfolio state (what components hold value)
2. Detects when instruments (SL, TP) trigger on the price path
3. Applies triggered instruments in order, transforming the state
4. Produces PnL curve data from the transformed state
5. Supports reset to restore the original state

### 2.1 Design Principles

- **Build on existing code.** The new engine delegates to `UniswapV3Position.simulatePnLAtPrice()` for LP math and reuses the `resolveExposure()` logic from `CloseOrderSimulationOverlay`. No existing math is reimplemented.
- **Persistent path memory.** Once a trigger fires, it stays fired. The user must click "Reset" to restore the original state.
- **Pure + stateful API split.** `simulate(targetPrice)` is stateful (fires triggers). `generateCurvePoints()` is pure (reads current state without mutation).
- **All bigint.** On-chain values remain `bigint` throughout the pipeline per project conventions.
- **Shared package.** The engine lives in `@midcurve/shared` so it can be used by all layers (UI, API, services).

### 2.2 Relationship to Existing Code

| Component | Status | Rationale |
|-----------|--------|-----------|
| `CloseOrderSimulationOverlay` | **Unchanged** | Still used by the wizard's `InteractivePnLCurve` for order configuration. The wizard doesn't need path memory — users are configuring triggers, not simulating price paths. |
| `UniswapV3Position.simulatePnLAtPrice()` | **Unchanged** | Core math. The new `UniswapV3LPComponent` delegates to it. |
| `UniswapV3MiniPnLCurve` | **Unchanged** | Card preview uses the overlay. No path memory needed for a static card. |
| `UniswapV3PositionSimulator` | **Replaced** | Position detail page simulator is replaced by a new `PortfolioSimulator` component that uses the `SimulationEngine`. |

---

## 3. Data Model

All types live in `packages/midcurve-shared/src/types/simulation/`.

### 3.1 SimulationComponent

An object that holds value at a given price. The interface mirrors the fields the UI needs for display.

```typescript
// simulation-component.ts

interface SimulationComponent {
  /** Unique identifier for this component */
  readonly id: string;
  /** Discriminator: 'uniswapv3_lp' | 'spot' */
  readonly type: string;
  /** Total value of this component at a given price (quote token units) */
  getValueAtPrice(price: bigint): bigint;
  /** Base token amount at a given price (smallest units) */
  getBaseAmountAtPrice(price: bigint): bigint;
  /** Quote token amount at a given price (smallest units) */
  getQuoteAmountAtPrice(price: bigint): bigint;
}
```

**UniswapV3LPComponent** — wraps an existing `UniswapV3Position`:

```typescript
// uniswapv3/uniswapv3-lp-component.ts

class UniswapV3LPComponent implements SimulationComponent {
  readonly type = 'uniswapv3_lp';

  constructor(
    readonly id: string,
    private readonly position: UniswapV3Position,
  ) {}

  getValueAtPrice(price: bigint): bigint {
    return this.position.simulatePnLAtPrice(price).positionValue;
  }

  getBaseAmountAtPrice(price: bigint): bigint {
    return this.position.simulatePnLAtPrice(price).baseTokenAmount;
  }

  getQuoteAmountAtPrice(price: bigint): bigint {
    return this.position.simulatePnLAtPrice(price).quoteTokenAmount;
  }
}
```

This delegates all math to the existing `simulatePnLAtPrice()` in [uniswapv3-position.ts](packages/midcurve-shared/src/types/position/uniswapv3/uniswapv3-position.ts), which uses `priceToSqrtRatioX96()`, `calculatePositionValue()`, and `getTokenAmountsFromLiquidity_X96()`.

**SpotComponent** — fixed token amounts (post-trigger state):

```typescript
// components/spot-component.ts

class SpotComponent implements SimulationComponent {
  readonly type = 'spot';

  constructor(
    readonly id: string,
    private readonly baseAmount: bigint,
    private readonly quoteAmount: bigint,
    private readonly baseDecimals: number,
  ) {}

  getValueAtPrice(price: bigint): bigint {
    // value = baseAmount * price / 10^baseDecimals + quoteAmount
    const baseDivisor = 10n ** BigInt(this.baseDecimals);
    return (this.baseAmount * price) / baseDivisor + this.quoteAmount;
  }

  getBaseAmountAtPrice(_price: bigint): bigint {
    return this.baseAmount;  // Price-independent
  }

  getQuoteAmountAtPrice(_price: bigint): bigint {
    return this.quoteAmount;  // Price-independent
  }
}
```

This covers all three post-trigger exposure types from the existing `CloseOrderSimulationOverlay`:

| PostTriggerExposure | SpotComponent arguments | Curve shape |
|---|---|---|
| `ALL_QUOTE` | `baseAmount=0n, quoteAmount=totalValue` | Flat horizontal line |
| `ALL_BASE` | `baseAmount=totalBase, quoteAmount=0n` | Linear (proportional to price) |
| `HOLD_MIXED` | `baseAmount=frozenBase, quoteAmount=frozenQuote` | Linear with offset |

### 3.2 SimulationInstrument

Transforms the portfolio state when a price threshold is crossed.

```typescript
// simulation-instrument.ts

type TriggerDirection = 'above' | 'below';

interface SimulationInstrument {
  /** Unique identifier */
  readonly id: string;
  /** Which component this instrument acts on */
  readonly targetComponentId: string;
  /** Price threshold that activates this instrument */
  readonly triggerPrice: bigint;
  /** Direction: 'below' means triggers when price crosses downward */
  readonly triggerDirection: TriggerDirection;
  /** Transform state when triggered. Returns new state. */
  apply(state: SimulationState, triggerPrice: bigint): SimulationState;
}
```

**ClosePositionInstrument** — full close (SL or TP):

```typescript
// instruments/close-position-instrument.ts

class ClosePositionInstrument implements SimulationInstrument {
  constructor(
    readonly id: string,
    readonly targetComponentId: string,
    readonly triggerPrice: bigint,
    readonly triggerDirection: TriggerDirection,
    private readonly postTriggerExposure: PostTriggerExposure,
    private readonly baseDecimals: number,
  ) {}

  apply(state: SimulationState, triggerPrice: bigint): SimulationState {
    // 1. Find target component and evaluate at trigger price
    const target = state.components.find(c => c.id === this.targetComponentId);
    const baseAmount = target.getBaseAmountAtPrice(triggerPrice);
    const quoteAmount = target.getQuoteAmountAtPrice(triggerPrice);
    const totalValue = target.getValueAtPrice(triggerPrice);

    // 2. Build replacement SpotComponent based on exposure
    let replacement: SpotComponent;
    switch (this.postTriggerExposure) {
      case 'ALL_QUOTE':
        replacement = new SpotComponent(target.id, 0n, totalValue, this.baseDecimals);
        break;
      case 'ALL_BASE':
        // totalBase = totalValue * 10^decimals / price
        const baseDivisor = 10n ** BigInt(this.baseDecimals);
        const totalBase = (totalValue * baseDivisor) / triggerPrice;
        replacement = new SpotComponent(target.id, totalBase, 0n, this.baseDecimals);
        break;
      case 'HOLD_MIXED':
        replacement = new SpotComponent(target.id, baseAmount, quoteAmount, this.baseDecimals);
        break;
    }

    // 3. Replace component, remove ALL instruments targeting this component
    return {
      ...state,
      components: state.components.map(c => c.id === this.targetComponentId ? replacement : c),
      activeInstruments: state.activeInstruments.filter(
        i => i.targetComponentId !== this.targetComponentId
      ),
    };
  }
}
```

The `PostTriggerExposure` type and the resolution logic (`resolveExposure()`) are reused from the existing `CloseOrderSimulationOverlay`. The `SwapConfig.direction` + `isToken0Quote` mapping is unchanged.

### 3.3 SimulationState

```typescript
// simulation-state.ts

interface SimulationState {
  /** Active components that produce portfolio value */
  components: SimulationComponent[];
  /** Instruments that have NOT yet fired */
  activeInstruments: SimulationInstrument[];
  /** Record of fired triggers (for UI display) */
  triggeredEvents: TriggeredEvent[];
  /** Original cost basis for PnL calculation (immutable) */
  costBasis: bigint;
  /** Base token decimals */
  baseDecimals: number;
  /** Quote token decimals */
  quoteDecimals: number;
}

interface TriggeredEvent {
  /** ID of the instrument that fired */
  instrumentId: string;
  /** Instrument type (for display: 'stop_loss', 'take_profit') */
  instrumentType: string;
  /** Price at which the trigger condition was met */
  triggeredAtPrice: bigint;
  /** Portfolio total value right before the trigger fired */
  preTrigerValue: bigint;
  /** Portfolio total value right after the trigger fired */
  postTriggerValue: bigint;
}
```

### 3.4 SimulationResult

```typescript
// simulation-engine.ts (result types)

interface SimulationResult {
  /** Total portfolio value at the evaluated price */
  positionValue: bigint;
  /** PnL = positionValue - costBasis */
  pnlValue: bigint;
  /** PnL as percentage of cost basis (0.0001% resolution) */
  pnlPercent: number;
  /** Base token amount held at this price */
  baseTokenAmount: bigint;
  /** Quote token amount held at this price */
  quoteTokenAmount: bigint;
  /** IDs of instruments that have been triggered so far */
  triggeredInstrumentIds: string[];
}

interface CurvePoint {
  price: bigint;
  positionValue: bigint;
  pnlValue: bigint;
  pnlPercent: number;
  baseTokenAmount: bigint;
  quoteTokenAmount: bigint;
  /** Whether a trigger fired at or before this price point */
  hasTriggeredInstruments: boolean;
}
```

The base fields (`positionValue`, `pnlValue`, `pnlPercent`) are compatible with the existing `PnLSimulationResult` type in [position.types.ts](packages/midcurve-shared/src/types/position/position.types.ts).

---

## 4. Simulation Engine

### 4.1 API

```typescript
// simulation-engine.ts

class SimulationEngine {
  private readonly _initialState: SimulationState;
  private _currentState: SimulationState;
  private _lastPrice: bigint;

  constructor(initialState: SimulationState, startPrice: bigint);

  /**
   * Move the simulation to a new price (STATEFUL).
   *
   * Detects instruments that trigger on the path from lastPrice → targetPrice.
   * Applies them in traversal order. Updates internal state.
   * Returns the portfolio evaluation at targetPrice.
   */
  simulate(targetPrice: bigint): SimulationResult;

  /**
   * Generate PnL curve points for a price range (PURE — no mutation).
   *
   * Evaluates the CURRENT state at each price point without firing
   * additional triggers. The curve reflects what the portfolio looks
   * like in its current form across all prices.
   */
  generateCurvePoints(priceMin: bigint, priceMax: bigint, numPoints: number): CurvePoint[];

  /**
   * Reset to initial state, clearing all triggered events.
   * Restores lastPrice to the original startPrice.
   */
  reset(): void;

  /** Read-only access to current state */
  getState(): Readonly<SimulationState>;

  /** List of triggered events since last reset */
  getTriggeredEvents(): readonly TriggeredEvent[];
}
```

### 4.2 `simulate()` Algorithm

```
function simulate(targetPrice):
  fromPrice = this._lastPrice
  movingUp = targetPrice > fromPrice

  // 1. Find instruments that trigger on this path
  candidates = this._currentState.activeInstruments.filter(inst =>
    if movingUp:
      inst.triggerDirection === 'above'
      AND inst.triggerPrice > fromPrice
      AND inst.triggerPrice <= targetPrice
    else:
      inst.triggerDirection === 'below'
      AND inst.triggerPrice < fromPrice
      AND inst.triggerPrice >= targetPrice
  )

  // 2. Sort by traversal order (first encountered on the path)
  candidates.sort((a, b) =>
    if movingUp: a.triggerPrice < b.triggerPrice ? -1 : 1
    else:        a.triggerPrice > b.triggerPrice ? -1 : 1
  )

  // 3. Apply each trigger in order
  for each inst in candidates:
    preValue = evaluatePortfolioValue(this._currentState, inst.triggerPrice)
    this._currentState = inst.apply(this._currentState, inst.triggerPrice)
    postValue = evaluatePortfolioValue(this._currentState, inst.triggerPrice)

    this._currentState.triggeredEvents.push({
      instrumentId: inst.id,
      instrumentType: inst.type,
      triggeredAtPrice: inst.triggerPrice,
      preTriggerValue: preValue,
      postTriggerValue: postValue,
    })

  // 4. Update last price
  this._lastPrice = targetPrice

  // 5. Evaluate portfolio at target price
  return evaluateAt(this._currentState, targetPrice)
```

### 4.3 `generateCurvePoints()` Algorithm

```
function generateCurvePoints(priceMin, priceMax, numPoints):
  step = (priceMax - priceMin) / numPoints

  return range(priceMin, priceMax, step).map(price =>
    value = sum(component.getValueAtPrice(price) for component in this._currentState.components)
    baseAmt = sum(component.getBaseAmountAtPrice(price) for component in this._currentState.components)
    quoteAmt = sum(component.getQuoteAmountAtPrice(price) for component in this._currentState.components)
    pnl = value - this._currentState.costBasis
    pnlPercent = costBasis > 0 ? (pnl * 1_000_000) / costBasis / 10_000 : 0

    return { price, positionValue: value, pnlValue: pnl, pnlPercent, baseTokenAmount: baseAmt, quoteTokenAmount: quoteAmt, hasTriggeredInstruments: triggeredEvents.length > 0 }
  )
```

This is a pure read of the current state. No instruments fire during curve generation.

### 4.4 `reset()` Implementation

Deep-copies the initial state (stored at construction) and restores `_lastPrice` to the original `startPrice`.

---

## 5. Factory: Position + Close Orders → SimulationEngine

A factory function bridges the existing data model to the engine.

```typescript
// uniswapv3/uniswapv3-simulation-factory.ts

interface CreateSimulationEngineParams {
  position: UniswapV3Position;
  isToken0Quote: boolean;
  currentPoolPrice: bigint;
  stopLossPrice: bigint | null;
  takeProfitPrice: bigint | null;
  stopLossSwapConfig: SwapConfig | null;
  takeProfitSwapConfig: SwapConfig | null;
}

function createUniswapV3SimulationEngine(
  params: CreateSimulationEngineParams
): SimulationEngine {
  const componentId = params.position.id;
  const baseDecimals = params.position.getBaseToken().decimals;
  const quoteDecimals = params.position.getQuoteToken().decimals;

  // Build LP component
  const lpComponent = new UniswapV3LPComponent(componentId, params.position);

  // Build instruments from close orders
  const instruments: SimulationInstrument[] = [];

  if (params.stopLossPrice !== null) {
    const exposure = resolveExposure(params.stopLossSwapConfig, params.isToken0Quote);
    instruments.push(new ClosePositionInstrument(
      'stop_loss',
      componentId,
      params.stopLossPrice,
      'below',
      exposure,
      baseDecimals,
    ));
  }

  if (params.takeProfitPrice !== null) {
    const exposure = resolveExposure(params.takeProfitSwapConfig, params.isToken0Quote);
    instruments.push(new ClosePositionInstrument(
      'take_profit',
      componentId,
      params.takeProfitPrice,
      'above',
      exposure,
      baseDecimals,
    ));
  }

  const initialState: SimulationState = {
    components: [lpComponent],
    activeInstruments: instruments,
    triggeredEvents: [],
    costBasis: params.position.currentCostBasis,
    baseDecimals,
    quoteDecimals,
  };

  return new SimulationEngine(initialState, params.currentPoolPrice);
}
```

The `resolveExposure()` function is extracted from `CloseOrderSimulationOverlay.resolveExposure()` as a standalone utility so both the overlay and the factory can use it.

---

## 6. UI Integration

### 6.1 What Changes

**`UniswapV3PositionSimulator`** (position detail page) is replaced by a new **`PortfolioSimulator`** component:

```
apps/midcurve-ui/src/components/positions/portfolio-simulator.tsx
```

The new component:
- Creates a `SimulationEngine` via `useMemo` from position data + active close orders
- On slider change: calls `engine.simulate(sliderPrice)` to get the path-aware result
- Renders the PnL curve via `engine.generateCurvePoints()` — the curve updates when state changes
- Displays triggered instrument badges (e.g., "SL triggered at 1,766.41 USDC")
- Has a **Reset** button that calls `engine.reset()` and re-renders

```typescript
// Simplified usage in the component
const engine = useMemo(() =>
  createUniswapV3SimulationEngine({
    position: simulationPosition,
    isToken0Quote: position.isToken0Quote,
    currentPoolPrice,
    stopLossPrice: closeOrderData.stopLossPrice,
    takeProfitPrice: closeOrderData.takeProfitPrice,
    stopLossSwapConfig: closeOrderData.slSwapConfig,
    takeProfitSwapConfig: closeOrderData.tpSwapConfig,
  }),
  [simulationPosition, closeOrderData, currentPoolPrice]
);

// On slider change
const result = engine.simulate(sliderPrice);
const curvePoints = engine.generateCurvePoints(minPrice, maxPrice, 60);
```

### 6.2 What Stays Unchanged

| Component | File | Reason |
|---|---|---|
| `UniswapV3MiniPnLCurve` | [uniswapv3-mini-pnl-curve.tsx](apps/midcurve-ui/src/components/positions/protocol/uniswapv3/uniswapv3-mini-pnl-curve.tsx) | Static card preview — no interactive path simulation needed |
| `InteractivePnLCurve` | [interactive-pnl-curve.tsx](apps/midcurve-ui/src/components/positions/pnl-curve/uniswapv3/interactive-pnl-curve.tsx) | Wizard for configuring orders — users need the stateless overlay to see how different SL/TP prices affect the curve |
| `CloseOrderSimulationOverlay` | [close-order-simulation-overlay.ts](packages/midcurve-shared/src/types/position/close-order-simulation/close-order-simulation-overlay.ts) | Used by the two components above. Not removed. |

### 6.3 Visual Indicators

- **Trigger price lines**: Vertical dashed lines on the curve at each active instrument's `triggerPrice`
- **Fired trigger badges**: When a trigger fires, show a badge above the curve (e.g., "SL triggered at 1,766.41")
- **Curve color shift**: After a trigger fires, the curve could shift to a muted color to indicate a state change
- **Reset button**: Visible when `triggeredEvents.length > 0`

---

## 7. File Structure

```
packages/midcurve-shared/src/types/simulation/
  index.ts                                 # Barrel exports
  simulation-component.ts                  # SimulationComponent interface
  simulation-instrument.ts                 # SimulationInstrument interface, TriggerDirection
  simulation-state.ts                      # SimulationState, TriggeredEvent, SimulationResult, CurvePoint
  simulation-engine.ts                     # SimulationEngine class
  components/
    index.ts
    spot-component.ts                      # SpotComponent
  instruments/
    index.ts
    close-position-instrument.ts           # ClosePositionInstrument (SL/TP full close)
  uniswapv3/
    index.ts
    uniswapv3-lp-component.ts             # UniswapV3LPComponent (wraps UniswapV3Position)
    uniswapv3-simulation-factory.ts        # createUniswapV3SimulationEngine()

apps/midcurve-ui/src/components/positions/
  portfolio-simulator.tsx                  # New component replacing UniswapV3PositionSimulator
```

Exported from `packages/midcurve-shared/src/types/index.ts` alongside existing type exports.

---

## 8. Implementation Sequence

### Phase 1: Core Types and Interfaces

New files in `packages/midcurve-shared/src/types/simulation/`:

1. `simulation-component.ts` — `SimulationComponent` interface
2. `simulation-instrument.ts` — `SimulationInstrument` interface, `TriggerDirection` type
3. `simulation-state.ts` — `SimulationState`, `TriggeredEvent`, `SimulationResult`, `CurvePoint`
4. `components/spot-component.ts` — `SpotComponent` class
5. `instruments/close-position-instrument.ts` — `ClosePositionInstrument` class
6. `simulation-engine.ts` — `SimulationEngine` class
7. Barrel exports: `index.ts` files, update `types/index.ts`

### Phase 2: UniswapV3 Integration

8. `uniswapv3/uniswapv3-lp-component.ts` — wrapping `UniswapV3Position`
9. `uniswapv3/uniswapv3-simulation-factory.ts` — factory function
10. Extract `resolveExposure()` from `CloseOrderSimulationOverlay` into a shared utility so both the overlay and the factory can use it

### Phase 3: Tests

11. `SpotComponent` value calculations (ALL_QUOTE flat, ALL_BASE linear, HOLD_MIXED)
12. `UniswapV3LPComponent` delegation to `simulatePnLAtPrice()`
13. `ClosePositionInstrument.apply()` state transformation
14. `SimulationEngine.simulate()` — single trigger, path memory retained
15. `SimulationEngine.simulate()` — SL fires, TP becomes inactive (same `targetComponentId`)
16. `SimulationEngine.generateCurvePoints()` — pure, no state mutation
17. `SimulationEngine.reset()` — restores initial state
18. Edge case: both SL and TP on path (SL fires first, invalidates TP)
19. Edge case: slider moves back past trigger (no re-trigger)

### Phase 4: UI Integration

20. Create `PortfolioSimulator` component using `SimulationEngine`
21. Replace `UniswapV3PositionSimulator` usage in the position detail overview tab
22. Add Reset button and triggered-instrument badges

---

## 9. Scope

### In Scope (v1)

- `SimulationComponent` abstraction (`SpotComponent`, `UniswapV3LPComponent`)
- `SimulationInstrument` interface with `apply()`
- `ClosePositionInstrument` for stop-loss and take-profit (full close)
- `SimulationEngine` with persistent state, `simulate()`, `generateCurvePoints()`, `reset()`
- All valuations in the position's quote asset
- Factory function: position + close orders → engine
- Position detail page UI replacement

### Out of Scope (future versions)

- Partial close instruments (PartialCloseInstrument that reduces liquidity by a ratio)
- DCA / rebalance instruments
- Multi-position portfolios (multiple LP components across different pools)
- Cross-asset portfolios with unified valuation currency
- Complex price paths (A → B → C multi-segment)
- Fee accumulation during simulation
- Time-dependent instruments
- Swap slippage modeling in post-trigger value calculations

---

## 10. Open Questions

1. **Swap slippage modeling.** Should the post-trigger value account for swap costs? Currently `CloseOrderSimulationOverlay` assumes perfect conversion. The close order's `swapSlippageBps` is available — we could apply it as a haircut to the converted value. Trade-off: more realistic vs. more complex, and slippage is a worst-case bound, not the expected outcome.

2. **Engine reactivity.** When the pool price updates in real-time (via WebSocket subscription), should the engine automatically update its `startPrice`? Or should the engine be constructed once and only reset on user action?

3. **Curve generation starting point.** Should `generateCurvePoints()` show the curve relative to a "what-if from current pool price" perspective (radiating outward from pool price) or simply evaluate current state at each price? The current design uses the simpler approach (evaluate state at each price), which matches the PRD intent. The radial approach could be a future enhancement.
