# Project Philosophy & Risk Management Approach

Midcurve Finance introduces a fundamentally different approach to understanding and managing risk in concentrated liquidity positions. This philosophy underpins the entire platform architecture and influences how data is modeled, calculated, and presented to users.

## Quote Token vs. Base Token Paradigm

Traditional DeFi platforms refer to tokens by their technical designations (token0, token1) or treat both tokens in a pool symmetrically. Midcurve adopts terminology from traditional finance currency pairs to provide clarity and consistency.

**Key Concepts:**

- **Quote Token** - The token in which position value is measured (the reference currency or "numeraire")
- **Base Token** - The token to which the position has risk exposure (the "asset" being priced)

**User-Defined Assignment:**

Unlike protocol-level designations (token0/token1), the quote/base assignment is **user-defined**:
- Users choose which token to use as their value reference when opening or importing a position
- This choice determines how all metrics are calculated (position value, PnL, fees, risk)
- Users can switch quote/base roles at any time to view the position from different perspectives

**Example:** In an ETH/USDC pool:
- If **USDC is quote**, you measure position value in USDC and track risk exposure to ETH price movements
- If **ETH is quote**, you measure position value in ETH and track risk exposure to USDC price movements (e.g., USD inflation/deflation risk)

**Technical Abstraction:**

The platform hides Uniswap V3's technical token0/token1 terminology from users:
- All UI, metrics, and documentation use quote/base terminology
- token0/token1 mapping happens internally in the services layer
- Users think in terms of "what am I measuring value in?" not "which token has the lower address?"

## Risk Definition: Quote-Token-Denominated Loss

**Risk** in Midcurve is defined precisely as:

> **The risk of loss in quote token value due to fluctuations in the base token's price.**

This definition is visualized through the **PnL curve** of a concentrated liquidity position, which shows three distinct regions:

**PnL Curve Regions (X-axis: Base Token Price | Y-axis: Position Value in Quote Tokens)**

1. **Left Region (Price Below Range):**
   - Position holds **only base tokens**
   - **High risk exposure** to base token price movements
   - Linear relationship: position value = base token amount x current price
   - Easy to hedge with linear short positions (perpetuals, futures)
   - Example: ETH/USDC pool with USDC as quote, price drops below range -> holding only ETH -> maximum USD value risk

2. **Middle Region (Price Within Range):**
   - Position **automatically rebalances** between base and quote tokens
   - Variable risk exposure that changes as price moves through the range
   - Curved relationship due to continuous rebalancing
   - Accumulating more base tokens as price rises (increasing risk)
   - Accumulating more quote tokens as price falls (decreasing risk)

3. **Right Region (Price Above Range):**
   - Position holds **only quote tokens**
   - **Zero risk exposure** to base token price movements
   - Flat line: position value remains constant regardless of further price increases
   - Example: ETH/USDC pool with USDC as quote, price rises above range -> holding only USDC -> no further USD value risk

**Key Insight:**

Risk is **directional** and **asymmetric**:
- When price is below range, you have maximum exposure to base token volatility
- When price is in range, you're actively trading (rebalancing) and accumulating the token moving against you
- When price is above range, you've exited your base token position and have zero price risk

This clear, visual definition of risk makes it easy to:
- Understand current risk exposure at a glance
- Plan hedging strategies (linear shorts when below range)
- Set range boundaries based on risk tolerance
- Compare risk across different positions (all in quote token terms)

## Beyond "Impermanent Loss"

Midcurve **abandons** the traditional concept of "impermanent loss" (IL) in favor of the clearer quote-token-denominated risk framework.

**Problems with Traditional IL:**

1. **Ambiguous reference point** - "Loss" relative to what?
   - Holding initial amounts?
   - Holding 50/50 split?
   - In USD value?
   - In token0 or token1 value?

2. **Misleading terminology** - "Impermanent" suggests the loss disappears if price returns, but:
   - Fees may or may not offset the loss
   - Time value of capital is ignored
   - Opportunity cost is unclear

3. **No clear risk metric** - IL doesn't tell you:
   - Your current position value
   - Your risk exposure going forward
   - How to hedge effectively

**Midcurve's Approach:**

Instead of comparing to hodling strategies, Midcurve provides **one clear metric**:

> **Current position value in quote token units**

This single number tells you:
- What your position is worth right now (in your reference currency)
- How much quote-denominated value you have at risk
- Whether fee income is adding to or subtracting from your quote token wealth

**No Hodling Comparisons:**

The platform does **not** show:
- "Loss vs. hodling initial deposit"
- "Loss vs. hodling 50/50"
- "Impermanent loss percentage"

**Why?** Because these metrics conflate two fundamentally different investment strategies:
1. **Hodling** = Betting on asset value appreciation
2. **CL Provisioning** = Generating cash flow from trading activity

Mixing these creates confusion. Midcurve keeps them separate.

## Cash Flow Measurement

All fee income and rewards are measured in **quote token units** to provide consistent, comparable cash flow tracking.

**Conversion Rules:**

- **Quote token fees** - Already in the correct unit, no conversion needed
- **Base token fees** - Converted to quote token value **at the time of collection** (claiming)
- **Rewards** - Converted to quote token value at collection time

**Collection Time Pricing:**

Using the price at collection time (not current price, not position open price) provides:
- Accurate realized cash flow (what you actually received in quote terms)
- No retroactive adjustments (cash flow is locked in when claimed)
- Clear accounting (sum of all collections = total quote-denominated cash flow)

**Example (ETH/USDC pool, USDC as quote):**

1. Position earns 0.1 ETH + 100 USDC in fees
2. User claims fees when ETH = $2,000
3. Recorded cash flow: **$300 USDC equivalent**
   - 0.1 ETH x $2,000 = $200
   - 100 USDC = $100
   - Total = $300

If ETH later rises to $3,000, the cash flow record stays $300 (not adjusted). The user received that amount in quote-equivalent value at claim time.

## Investment Philosophy: Yield vs. Value Appreciation

Midcurve draws a clear distinction between two fundamentally different investment strategies:

**Strategy 1: Hodling (Value Appreciation)**
- Investment thesis: Base token will appreciate in quote token terms
- Return source: Capital gains from price movement
- Risk: Base token depreciates relative to quote token
- Time horizon: Typically longer-term
- Management: Passive (no rebalancing)

**Strategy 2: CL Provisioning (Cash Flow Generation)**
- Investment thesis: Trading volume will generate fees exceeding risk-adjusted losses
- Return source: Fee income from providing liquidity
- Risk: Base token exposure offsets fee income (measured in quote tokens)
- Time horizon: Can be short or long-term
- Management: Active (continuous rebalancing by AMM)

**Key Insight:**

These strategies are **not comparable** - they have different objectives, risk profiles, and return sources. Comparing CL returns to "hodling" is like comparing:
- A rental property (cash flow) to a growth stock (appreciation)
- Running a market-making business to buying and holding inventory

**Midcurve's Position:**

The platform treats CL provisioning as a **cash flow generation strategy** with measurable risk exposure:

1. **Position value** (in quote tokens) - Your current capital base
2. **Fee income** (in quote tokens) - Your cumulative cash flow
3. **Risk exposure** - Your current base token holdings and price sensitivity

Success is measured by:
- **Total cash flow generated** (in quote tokens)
- **Risk-adjusted returns** (cash flow relative to risk exposure)
- **Capital efficiency** (returns relative to capital deployed)

Not by:
- Performance vs. hodling
- "Making up" for impermanent loss
- Predicting future base token prices

This framework allows users to:
- Make informed decisions about range selection (risk tolerance)
- Evaluate CL positions as a business (yield on capital)
- Understand exactly what they're exposed to (base token price risk)
- Separate yield farming from directional trading strategies
