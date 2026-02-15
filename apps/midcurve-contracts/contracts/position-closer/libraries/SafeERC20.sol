// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20Minimal} from "../interfaces/IERC20Minimal.sol";

/// @title SafeERC20
/// @notice Safe ERC20 transfer functions that work with non-standard tokens
library SafeERC20 {
    error TransferFailed();
    error ApproveFailed();

    /// @notice Safe transfer that handles tokens not returning a bool
    /// @param token The token to transfer
    /// @param to The recipient
    /// @param amount The amount to transfer
    function safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amount)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }

    /// @notice Safe approve that handles tokens not returning a bool
    /// @param token The token to approve
    /// @param spender The spender
    /// @param amount The amount to approve
    function safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.approve.selector, spender, amount)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert ApproveFailed();
        }
    }
}
