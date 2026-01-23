// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IMulticall.sol";

/// @title Multicall
/// @notice Base contract for executing multiple calls in a single transaction
/// @dev Useful for batching operations to prevent sandwich attacks between calls
abstract contract Multicall is IMulticall {
    /// @inheritdoc IMulticall
    function multicall(bytes[] calldata data) external override returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            (bool success, bytes memory result) = address(this).delegatecall(data[i]);
            if (!success) {
                // Bubble up the revert reason
                if (result.length > 0) {
                    assembly {
                        let returndata_size := mload(result)
                        revert(add(32, result), returndata_size)
                    }
                } else {
                    revert("Multicall: call failed");
                }
            }
            results[i] = result;
        }
    }
}
