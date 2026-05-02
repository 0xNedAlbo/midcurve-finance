// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IFlashCloseCallback
/// @notice Callback contract used by `IStakingVault.flashClose(bps, ...)`. Before invoking
///         this method the vault transfers the freed (just-closed) balance to the callback
///         target — prior unstake/reward buffers from earlier partial settlements stay in
///         the vault. The callback must return at least `expectedBase` of base tokens and
///         `expectedQuote` of quote tokens to the vault before the call returns.
interface IFlashCloseCallback {
    /// @param expectedBase  = floor(stakedBase × bps / 10000).
    /// @param expectedQuote = floor((stakedQuote + yieldTarget) × bps / 10000).
    /// @param data          opaque calldata forwarded from `flashClose()`.
    /// @dev Both expected amounts use floor (truncating) division — the same rounding the
    ///      vault applies internally. A callback that does its own bps math (e.g. sizing a
    ///      flash loan from `bps` and the staked totals) MUST use floor division to stay
    ///      consistent with these values; rounding up by even 1 wei can leave the
    ///      callback short on the actual amount it owes the vault.
    function flashCloseCallback(uint256 expectedBase, uint256 expectedQuote, bytes calldata data)
        external;
}
