// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Modifiers} from "../storage/AppStorage.sol";

/// @title MulticallFacet
/// @notice Facet for batching multiple calls in a single transaction
/// @dev Uses delegatecall to self pattern. Each sub-call routes through the
///      Diamond fallback to the appropriate facet. Functions with nonReentrant
///      guards (registerOrder, cancelOrder, executeOrder) will correctly revert
///      if called via multicall — this is intentional.
///
///      Primary use case: Batching OwnerUpdateFacet calls (setTriggerTick,
///      setSlippage, setPayout, setSwapIntent, etc.) in a single transaction.
contract MulticallFacet is Modifiers {
    /// @notice Error when a sub-call fails without revert data
    /// @param index The index of the failed call in the data array
    /// @param returnData The revert data from the failed call
    error MulticallFailed(uint256 index, bytes returnData);

    /// @notice Execute multiple calls in a single transaction
    /// @dev Each call is executed via delegatecall to address(this), which
    ///      triggers the Diamond fallback and routes to the correct facet.
    ///      All calls must succeed or the entire transaction reverts.
    /// @param data Array of ABI-encoded function calls
    /// @return results Array of ABI-encoded return values from each call
    function multicall(bytes[] calldata data)
        external
        whenInitialized
        returns (bytes[] memory results)
    {
        results = new bytes[](data.length);

        for (uint256 i = 0; i < data.length; i++) {
            (bool success, bytes memory result) = address(this).delegatecall(data[i]);

            if (!success) {
                // Bubble up the revert reason from the sub-call
                if (result.length > 0) {
                    assembly {
                        revert(add(result, 32), mload(result))
                    }
                }
                revert MulticallFailed(i, result);
            }

            results[i] = result;
        }
    }
}
