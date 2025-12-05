// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FundingActionLib
 * @notice Library for funding operations (withdrawals)
 * @dev Use with `using FundingActionLib for *;` in strategies that implement IFundingActions
 */
library FundingActionLib {
    /// @notice Emitted when an action is requested
    event ActionRequested(bytes32 indexed actionType, bytes payload);

    /// @notice Action type identifier for withdrawals
    bytes32 constant ACTION_WITHDRAW = keccak256("Action:Funding:Withdraw:v1");

    /**
     * @notice Request to withdraw tokens from the automation wallet
     * @param effectId The effect ID for tracking this action (use _nextEffectId())
     * @param chainId The chain ID where the withdrawal should occur
     * @param token The address of the token to withdraw
     * @param amount The amount of tokens to withdraw
     */
    function emitWithdraw(
        bytes32 effectId,
        uint256 chainId,
        address token,
        uint256 amount
    ) internal {
        emit ActionRequested(
            ACTION_WITHDRAW,
            abi.encode(effectId, chainId, token, amount)
        );
    }
}
