# Staking Vault — Mental Model

> Reference document capturing the conceptual frame of the Uniswap V3
> Staking Vault, agreed before SPEC-0003a implementation. The vault is
> a wrapper around a UV3 position that converts its yield-farming
> semantics into staking semantics. This document fixes _what we are
> building and why_, so implementation issues can be reviewed against
> intent.

## Core points

**What goes in comes out.**
- The owner deposits an inventory `(B base, Q quote)` — and gets exactly that inventory back at the end.
- The position internally "does something" (tick-crossings, rebalancing, fee accrual), but from the outside this state is opaque and irrelevant.
- Like a fixed-term deposit: principal in, identical principal out, plus interest.

**Yield target as a termination condition — not as a yield number.**
- `T` is not "the return I'd like", it is the **definition of the end state**.
- Without `T` there would be no well-defined condition under which an executor could meaningfully act.
- Once the position reaches `Deposit + T`, the goal is met — full stop. Whatever market value exists beyond that goes to the executor.

**Owner outcome is deterministic and known in advance.**
- On regular settlement, the owner receives exactly `(B, Q + T)`. To the wei.
- No surprises to the upside (the upside tail is given up), no surprises to the downside (except under market stress that forces a `flashClose` at spot).
- The owner knows _before staking_ what will happen at the end.

**Permissionless execution.**
- Nobody needs to be online. Nobody is commissioned. Nobody is trusted.
- Solvers, MEV bots, keepers compete for the trigger and close the position precisely when it is profitable for them — which structurally coincides with the moment the owner's target is reached.
- No allowlist, no relayer, no third party with rights over the vault.

**Four discrete events replace continuous yield-farming.**
- The owner sees: `Stake` → `Swap` → `Unstake` → `ClaimRewards`.
- Instead of thousands of tick-crossings, a single point of realisation.
- Clean accounting view: deposit, contract settlement, payout. Whatever happened inside the contract is the internal matter of one contracting party.

**Structural precondition for a clear holding period.**
- The vault does not deliver "better tax treatment" — it delivers the **structural precondition under which a holding-period view becomes defensible at all**.
- Between `Stake` and `Swap` there is no token movement to the owner's account.
- Whether a specific tax authority recognises this is jurisdiction-dependent — what is _our_ responsibility is the structural cleanliness of the view.

**Trade-off: upside tail in exchange for determinism.**
- The owner gives up the market upside above `T` — it goes to the executor.
- In return: permissionless automation, deterministic outcome, semantic cleanliness.
- This is _not_ a yield optimiser. Anyone seeking maximum return holds the position directly and closes it manually.

**Emergency exit via `flashClose`.**
- If the market never delivers the target, or the owner wants out earlier: `flashClose(bps)` closes the position (fully or partially) at the spot price, financed via a flash loan.
- Cost: flash-loan fee plus possibly forgone yield.
- Preserves owner optionality without undermining the regular mechanism.

**Top-up and partial unstake extend the model — they do not break it.**
- **Top-up**: more stake in the same construct, with the implicit yield rate held constant (`T` scales proportionally to `Q`).
- **Partial unstake**: realises only a fraction at the next executor trigger; the remainder runs on with an unchanged risk/return profile.
- Both preserve determinism per closed fraction; they are levers _within_ the model, not outside of it.

**Outcome disciplinarian, not yield optimiser.**
- This is the single sentence that holds everything else together.
- The vault converts an open, continuous market exposure into a closed, terminable one — with a clear beginning, a clear termination condition, and a clear payout amount.
- Whoever wants this conversion is the target audience. Whoever does not should stick with the bare UV3 position.
