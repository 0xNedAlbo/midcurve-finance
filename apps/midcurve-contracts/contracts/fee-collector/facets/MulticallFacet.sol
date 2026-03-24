// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Modifiers} from "../storage/AppStorage.sol";

/// @title MulticallFacet
/// @notice Facet for batching multiple calls in a single transaction
/// @dev Uses delegatecall to self pattern. Functions with nonReentrant
///      guards will correctly revert if called via multicall.
///      Primary use case: Batching CollectOwnerUpdateFacet calls.
contract MulticallFacet is Modifiers {
    error MulticallFailed(uint256 index, bytes returnData);

    function multicall(bytes[] calldata data)
        external
        whenInitialized
        returns (bytes[] memory results)
    {
        results = new bytes[](data.length);

        for (uint256 i = 0; i < data.length; i++) {
            (bool success, bytes memory result) = address(this).delegatecall(data[i]);

            if (!success) {
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
