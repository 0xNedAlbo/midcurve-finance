// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IFlashCloseCallback
/// @notice Callback contract used by `IStakingVault.flashClose(bps, ...)`. Before invoking
///         this method the vault transfers the freed (just-closed) balance to the callback
///         target — prior unstake/reward buffers from earlier partial settlements stay in
///         the vault. The callback must return at least `expectedBase` of base tokens and
///         `expectedQuote` of quote tokens to the vault before the call returns.
interface IFlashCloseCallback {
    /// @param expectedBase  = stakedBase × bps / 10000.
    /// @param expectedQuote = (stakedQuote + yieldTarget) × bps / 10000.
    /// @param data          opaque calldata forwarded from `flashClose()`.
    function flashCloseCallback(uint256 expectedBase, uint256 expectedQuote, bytes calldata data)
        external;
}
