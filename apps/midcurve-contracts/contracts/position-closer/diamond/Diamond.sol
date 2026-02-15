// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LibDiamond} from "./LibDiamond.sol";
import {IDiamondCut} from "./interfaces/IDiamondCut.sol";
import {IDiamondLoupe} from "./interfaces/IDiamondLoupe.sol";
import {IERC165} from "./interfaces/IERC165.sol";
import {IERC173} from "./interfaces/IERC173.sol";

/// @title Diamond
/// @notice Main diamond proxy contract (EIP-2535)
/// @author Nick Mudge <nick@perfectabstractions.com>
/// @dev Adapted for Solidity 0.8.x
///
/// This contract receives all calls and delegates them to the appropriate facet.
/// Facets are added/replaced/removed using the diamondCut function.
contract Diamond {
    /// @notice Arguments struct to avoid stack too deep
    struct DiamondArgs {
        address owner;
        address init;      // Contract to delegatecall for initialization
        bytes initCalldata; // Calldata to pass to init
    }

    /// @notice Error when function selector is not found
    error FunctionNotFound(bytes4 selector);

    /// @notice Construct a new diamond
    /// @param _diamondCut Initial facet cuts to add
    /// @param _args Diamond initialization arguments
    constructor(IDiamondCut.FacetCut[] memory _diamondCut, DiamondArgs memory _args) payable {
        // Set owner
        LibDiamond.setContractOwner(_args.owner);

        // Execute diamond cuts
        LibDiamond.diamondCut(_diamondCut, _args.init, _args.initCalldata);

        // Add ERC165 interface support
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        ds.supportedInterfaces[type(IERC165).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondCut).interfaceId] = true;
        ds.supportedInterfaces[type(IDiamondLoupe).interfaceId] = true;
        ds.supportedInterfaces[type(IERC173).interfaceId] = true;
    }

    /// @notice Fallback function that routes calls to the appropriate facet
    /// @dev Find facet for function that is called and execute the function if found
    fallback() external payable {
        LibDiamond.DiamondStorage storage ds;
        bytes32 position = LibDiamond.DIAMOND_STORAGE_POSITION;
        // get diamond storage
        assembly {
            ds.slot := position
        }
        // get facet from function selector
        address facet = ds.selectorToFacetAndPosition[msg.sig].facetAddress;
        if (facet == address(0)) {
            revert FunctionNotFound(msg.sig);
        }
        // Execute external function from facet using delegatecall and return any value
        assembly {
            // copy function selector and any arguments
            calldatacopy(0, 0, calldatasize())
            // execute function call using the facet
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            // get any return value
            returndatacopy(0, 0, returndatasize())
            // return any return value or error back to the caller
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }

    /// @notice Receive function to accept ETH
    receive() external payable {}
}
