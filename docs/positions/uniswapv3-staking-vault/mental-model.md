# Staking Vault — Mental Model

> Reference document capturing the conceptual frame of the Uniswap V3
> Staking Vault, agreed during the SPEC-0003b/c rewrite. The vault is
> a wrapper around a UV3 position that converts its yield-farming
> semantics into staking semantics. This document fixes _what we are
> building and why_, so implementation issues can be reviewed against
> intent.

## Core points

**What goes in comes out.**
- The owner deposits an inventory `(B base, Q quote)` — and gets exactly that inventory back on settlement.
- The position internally "does something" (tick-crossings, rebalancing, fee accrual), but from the outside this state is opaque and irrelevant.
- Like a fixed-term deposit: principal in, identical principal out, plus interest.
- This guarantee is **structural at `T = 0`** (the UV3 close path always preserves token-conservation against the deposit) and **market-conditional at `T > 0`** (the owner's yield claim may temporarily exceed what the position can deliver — the Underwater state).

**Yield target as a termination condition — not as a yield number.**
- `T` is not "the return I'd like", it is the **definition of the end state**.
- Without `T` there would be no well-defined condition under which a settlement actor — owner or permissionless — could meaningfully close the position.
- Once the position can deliver `(B, Q + T)` for the closed fraction, the target is met. Full stop.

**The owner-side floor is deterministic; the surplus is path-dependent.**
- Across every successful settlement, the owner is guaranteed to receive at least `(B × frac, (Q + T) × frac)` for the closed fraction `frac`. This is the protocol's contract with the owner — same in every subclass, same on every code path.
- Whether anything above that floor accrues to the owner depends on _which path_ closes the position:
  - Owner-side `swap()` / `settle()` — entire surplus stays with the owner via the reward buffer.
  - Keeper-side `executeSwap()` (Cases 2/3) — keeper takes profit on external markets; the vault's reward buffer still flows to the owner.
  - Keeper-side `executeSettle()` (Case 1 only) — surplus over `(B, Q + T)` is paid to the bounty recipient as compensation for permissionless Case-1 settlement.
- The owner knows the floor _before_ staking. The surplus is path-dependent and accepted up front by choice of subclass.

**Subclass = automation choice.**
- The vault ships as an abstract base plus concrete subclasses, each with its own settlement strategy. The subclass is fixed at deploy time.
  - `ManualStakingVault` — owner is the sole settlement actor. No permissionless surface, no callback complexity.
  - `KeeperStakingVault` — keepers settle permissionlessly via `executeSwap` (Cases 2/3) or `executeSettle` (Case 1 with surplus bounty).
  - `CowStakingVault` (deferred) — CoW Protocol solver-network integration via ERC-1271.
- Different users want different automation. The protocol does not impose one.

**Permissionless settlement is a subclass property — and always full-close.**
- Permissionless callers exist only where the chosen subclass exposes them. In `ManualStakingVault` there is no permissionless surface; the owner closes manually.
- Where permissionless paths exist: no allowlist, no relayer, no third party with rights over the vault beyond the published `execute*` functions. Keepers self-select on profit.
- Critically, **permissionless settlement is always full-close**. Partial settlement is owner-only. A permissionless partial would shrink `T` proportionally and leave the remainder exposed to further drift — the yield-target promise would break across keeper calls.

**Discrete events replace continuous yield-farming.**
- The owner-visible event chain compresses thousands of tick-crossings into a small discrete sequence: `Stake` → settlement (`Swap` for Cases 2/3, or `Settle` for Case 1) → `Unstake` (drain principal) → `ClaimRewards` (drain yield).
- Single point of economic realisation per settlement: one event fixes the four-case classification and the buffer assignments.
- Clean accounting view: deposit, contract settlement, payout. Whatever happened inside the contract is the internal matter of one contracting party.

**Structural precondition for a clear holding period.**
- The vault does not deliver "better tax treatment" — it delivers the **structural precondition under which a holding-period view becomes defensible at all**.
- Between `Stake` and the chosen settlement event there is no token movement to the owner's wallet.
- Whether a specific tax authority recognises this is jurisdiction-dependent — what is _our_ responsibility is the structural cleanliness of the view.

**Underwater is owner-caused, owner-resolvable.**
- Underwater (Case 4: `b < B × frac` AND `q < (Q + T) × frac`) is **structurally only reachable when `T > 0`**. The UV3 close path never produces both `b < B` and `q < Q` simultaneously, so `T = 0` settlement is always honourable.
- Underwater is therefore not "the market broke the vault" but "the owner's yield claim exceeds the market's current ability to deliver".
- The owner can always escape it: `setYieldTarget(0)` — or any lower value the inventory can support — collapses Case 4 back into Cases 1–3 and restores settle-ability.
- The cost of that escape is the forgone yield, not the principal. **Principal is never at risk through this escape**, because `T = 0` settlement returns `(B, Q)` by construction.
- The vault is fully oracle-free and never quotes a "spot-priced exit". It quotes only the LVR-implied rate from the close itself; the recovery mechanism is target adjustment, not market sale.

**Top-up and partial settlement extend the model — they do not break it.**
- **Top-up** (`increaseStake`): more capital into the same position, with the implicit yield rate `T / Q` held constant (so `T` scales proportionally to the new `Q`).
- **Partial settlement**: the owner closes a fraction of the position via `swap(liquidity)` or `settle(liquidity)` and harvests the proportional buffers; the remainder runs on under the same `(B, Q, T)` contract, scaled.
- Both preserve the owner-side floor `(B × frac, (Q + T) × frac)` per closed fraction. Levers _within_ the model, not outside of it.

**Outcome disciplinarian, not yield optimiser.**
- This is the single sentence that holds everything else together.
- The vault converts an open, continuous market exposure into a closed, terminable one — with a clear beginning, a clear termination condition, and a clear payout floor.
- Whoever wants this conversion is the target audience. Whoever wants to maximise return holds the position directly and closes it manually.
