// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "../interfaces/IERC20.sol";

/// @title SafeERC20
/// @notice Safe wrappers around ERC-20 operations that revert on failure
/// @dev Use with `using SafeERC20 for IERC20;`
library SafeERC20 {
    error SafeERC20FailedOperation(address token);

    /// @notice Safely transfer tokens from the calling contract
    /// @param token The token to transfer
    /// @param to The recipient address
    /// @param value The amount to transfer
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeCall(token.transfer, (to, value)));
    }

    /// @notice Safely transfer tokens from one address to another
    /// @param token The token to transfer
    /// @param from The sender address
    /// @param to The recipient address
    /// @param value The amount to transfer
    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeCall(token.transferFrom, (from, to, value)));
    }

    /// @notice Safely approve tokens for spending
    /// @dev Resets to 0 first if needed (for USDT-like tokens)
    /// @param token The token to approve
    /// @param spender The spender address
    /// @param value The amount to approve
    function safeApprove(IERC20 token, address spender, uint256 value) internal {
        // Some tokens (like USDT) require approval to be 0 before setting a new value
        if (value > 0 && token.allowance(address(this), spender) > 0) {
            _callOptionalReturn(token, abi.encodeCall(token.approve, (spender, 0)));
        }
        _callOptionalReturn(token, abi.encodeCall(token.approve, (spender, value)));
    }

    /// @dev Call a token function that may or may not return a value
    function _callOptionalReturn(IERC20 token, bytes memory data) private {
        (bool success, bytes memory returndata) = address(token).call(data);

        // Check call succeeded
        if (!success) {
            if (returndata.length > 0) {
                assembly {
                    revert(add(returndata, 32), mload(returndata))
                }
            }
            revert SafeERC20FailedOperation(address(token));
        }

        // Check return value (if any) is true
        if (returndata.length > 0 && !abi.decode(returndata, (bool))) {
            revert SafeERC20FailedOperation(address(token));
        }
    }
}
