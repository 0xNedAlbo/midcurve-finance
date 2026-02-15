// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IDiamondCut
/// @notice Interface for diamond cut operations (EIP-2535)
/// @author Nick Mudge <nick@perfectabstractions.com>
/// @dev Adapted for Solidity 0.8.x
interface IDiamondCut {
    enum FacetCutAction {
        Add,     // 0 - Add a new facet
        Replace, // 1 - Replace functions in an existing facet
        Remove   // 2 - Remove functions (facet address must be address(0))
    }

    struct FacetCut {
        address facetAddress;        // Facet contract address
        FacetCutAction action;       // Action to perform
        bytes4[] functionSelectors;  // Function selectors to add/replace/remove
    }

    /// @notice Add/replace/remove any number of functions and optionally execute a function with delegatecall
    /// @param _diamondCut Contains the facet addresses and function selectors
    /// @param _init The address of the contract or facet to execute _calldata
    /// @param _calldata A function call, including function selector and arguments, to execute on _init
    function diamondCut(FacetCut[] calldata _diamondCut, address _init, bytes calldata _calldata) external;

    /// @notice Emitted when diamond cut is executed
    event DiamondCut(FacetCut[] _diamondCut, address _init, bytes _calldata);
}
