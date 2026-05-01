// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IFlashCloseCallback
/// @notice Callback contract used by `IStakingVault.flashClose()`. The vault transfers
///         its full balance to the callback target before invoking this method, and
///         requires the target to return at least `expectedBase` of base tokens and
///         `expectedQuote` of quote tokens to the vault before the call returns.
interface IFlashCloseCallback {
    /// @param expectedBase  = stakedBase (B); the vault requires this much base back.
    /// @param expectedQuote = stakedQuote + yieldTarget (Q + T); required quote back.
    /// @param data          opaque calldata forwarded from `flashClose()`.
    function flashCloseCallback(uint256 expectedBase, uint256 expectedQuote, bytes calldata data)
        external;
}
