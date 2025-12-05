// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IFundingActions
 * @notice Interface for strategies that perform funding operations (withdrawals)
 * @dev Implement this interface to receive withdrawal completion callbacks
 */
interface IFundingActions {
    /**
     * @notice Called when a withdrawal action completes
     * @param effectId The effect ID that was returned when the action was requested
     * @param chainId The chain ID where the withdrawal occurred
     * @param token The address of the token that was withdrawn
     * @param requestedAmount The amount that was requested to withdraw
     * @param executedAmount The actual amount that was withdrawn
     * @param txHash The transaction hash of the withdrawal (on the target chain)
     * @param success Whether the action succeeded
     * @param errorMessage Error message if the action failed
     */
    function onWithdrawComplete(
        bytes32 effectId,
        uint256 chainId,
        address token,
        uint256 requestedAmount,
        uint256 executedAmount,
        bytes32 txHash,
        bool success,
        string calldata errorMessage
    ) external;
}
