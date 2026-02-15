// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";

// Diamond interfaces
import {IDiamondCut} from "../contracts/position-closer/diamond/interfaces/IDiamondCut.sol";
import {IDiamondLoupe} from "../contracts/position-closer/diamond/interfaces/IDiamondLoupe.sol";

// Upgradeable facets
import {VersionFacet} from "../contracts/position-closer/facets/VersionFacet.sol";
import {RegistrationFacet} from "../contracts/position-closer/facets/RegistrationFacet.sol";
import {ExecutionFacet} from "../contracts/position-closer/facets/ExecutionFacet.sol";
import {OwnerUpdateFacet} from "../contracts/position-closer/facets/OwnerUpdateFacet.sol";
import {ViewFacet} from "../contracts/position-closer/facets/ViewFacet.sol";

/// @title UpgradeFacets
/// @notice Upgrade application facets on an existing UniswapV3PositionCloser Diamond
/// @dev Infrastructure facets (DiamondCut, DiamondLoupe, Ownership) are excluded for safety.
///
/// Usage:
///   # Upgrade a single facet (e.g., ExecutionFacet):
///   DIAMOND=0x543e... forge script script/UpgradeFacets.s.sol \
///     --sig "upgradeExecution()" --rpc-url arbitrum --broadcast --verify -vvvv
///
///   # Upgrade all application facets:
///   DIAMOND=0x543e... forge script script/UpgradeFacets.s.sol \
///     --sig "runAll()" --rpc-url arbitrum --broadcast --verify -vvvv
///
/// Environment variables:
///   DIAMOND - The deployed diamond proxy address (required)
contract UpgradeFacets is Script {
    // ========================================
    // UPGRADE: ALL APPLICATION FACETS
    // ========================================

    /// @notice Upgrade all 5 application facets in a single diamondCut transaction
    function runAll() public {
        address diamond = vm.envAddress("DIAMOND");

        console.log("=== Upgrading ALL Application Facets ===");
        console.log("Diamond:", diamond);
        console.log("");

        vm.startBroadcast();

        // 1. Deploy all new facet implementations
        console.log("--- Deploying New Facets ---");

        VersionFacet newVersionFacet = new VersionFacet();
        console.log("New VersionFacet:", address(newVersionFacet));

        RegistrationFacet newRegistrationFacet = new RegistrationFacet();
        console.log("New RegistrationFacet:", address(newRegistrationFacet));

        ExecutionFacet newExecutionFacet = new ExecutionFacet();
        console.log("New ExecutionFacet:", address(newExecutionFacet));

        OwnerUpdateFacet newOwnerUpdateFacet = new OwnerUpdateFacet();
        console.log("New OwnerUpdateFacet:", address(newOwnerUpdateFacet));

        ViewFacet newViewFacet = new ViewFacet();
        console.log("New ViewFacet:", address(newViewFacet));

        // 2. Build FacetCut array (Replace all selectors)
        console.log("");
        console.log("--- Building FacetCuts (Replace) ---");

        IDiamondCut.FacetCut[] memory cuts = new IDiamondCut.FacetCut[](5);

        cuts[0] = IDiamondCut.FacetCut({
            facetAddress: address(newVersionFacet),
            action: IDiamondCut.FacetCutAction.Replace,
            functionSelectors: getVersionSelectors()
        });

        cuts[1] = IDiamondCut.FacetCut({
            facetAddress: address(newRegistrationFacet),
            action: IDiamondCut.FacetCutAction.Replace,
            functionSelectors: getRegistrationSelectors()
        });

        cuts[2] = IDiamondCut.FacetCut({
            facetAddress: address(newExecutionFacet),
            action: IDiamondCut.FacetCutAction.Replace,
            functionSelectors: getExecutionSelectors()
        });

        cuts[3] = IDiamondCut.FacetCut({
            facetAddress: address(newOwnerUpdateFacet),
            action: IDiamondCut.FacetCutAction.Replace,
            functionSelectors: getOwnerUpdateSelectors()
        });

        cuts[4] = IDiamondCut.FacetCut({
            facetAddress: address(newViewFacet),
            action: IDiamondCut.FacetCutAction.Replace,
            functionSelectors: getViewSelectors()
        });

        // 3. Execute diamond cut
        console.log("");
        console.log("--- Executing DiamondCut ---");
        IDiamondCut(diamond).diamondCut(cuts, address(0), "");

        vm.stopBroadcast();

        // 4. Verify
        _verifyUpgrade(diamond, "VersionFacet", address(newVersionFacet), getVersionSelectors());
        _verifyUpgrade(diamond, "RegistrationFacet", address(newRegistrationFacet), getRegistrationSelectors());
        _verifyUpgrade(diamond, "ExecutionFacet", address(newExecutionFacet), getExecutionSelectors());
        _verifyUpgrade(diamond, "OwnerUpdateFacet", address(newOwnerUpdateFacet), getOwnerUpdateSelectors());
        _verifyUpgrade(diamond, "ViewFacet", address(newViewFacet), getViewSelectors());

        console.log("");
        console.log("=== All Facets Upgraded Successfully ===");
    }

    // ========================================
    // UPGRADE: INDIVIDUAL FACETS
    // ========================================

    /// @notice Upgrade only the ExecutionFacet
    function upgradeExecution() public {
        address diamond = vm.envAddress("DIAMOND");
        console.log("=== Upgrading ExecutionFacet ===");
        console.log("Diamond:", diamond);

        vm.startBroadcast();

        ExecutionFacet newFacet = new ExecutionFacet();
        console.log("New ExecutionFacet:", address(newFacet));

        IDiamondCut.FacetCut[] memory cuts = new IDiamondCut.FacetCut[](1);
        cuts[0] = IDiamondCut.FacetCut({
            facetAddress: address(newFacet),
            action: IDiamondCut.FacetCutAction.Replace,
            functionSelectors: getExecutionSelectors()
        });

        IDiamondCut(diamond).diamondCut(cuts, address(0), "");
        vm.stopBroadcast();

        _verifyUpgrade(diamond, "ExecutionFacet", address(newFacet), getExecutionSelectors());
        console.log("=== ExecutionFacet Upgraded ===");
    }

    /// @notice Upgrade only the RegistrationFacet
    function upgradeRegistration() public {
        address diamond = vm.envAddress("DIAMOND");
        console.log("=== Upgrading RegistrationFacet ===");
        console.log("Diamond:", diamond);

        vm.startBroadcast();

        RegistrationFacet newFacet = new RegistrationFacet();
        console.log("New RegistrationFacet:", address(newFacet));

        IDiamondCut.FacetCut[] memory cuts = new IDiamondCut.FacetCut[](1);
        cuts[0] = IDiamondCut.FacetCut({
            facetAddress: address(newFacet),
            action: IDiamondCut.FacetCutAction.Replace,
            functionSelectors: getRegistrationSelectors()
        });

        IDiamondCut(diamond).diamondCut(cuts, address(0), "");
        vm.stopBroadcast();

        _verifyUpgrade(diamond, "RegistrationFacet", address(newFacet), getRegistrationSelectors());
        console.log("=== RegistrationFacet Upgraded ===");
    }

    /// @notice Upgrade only the ViewFacet
    function upgradeView() public {
        address diamond = vm.envAddress("DIAMOND");
        console.log("=== Upgrading ViewFacet ===");
        console.log("Diamond:", diamond);

        vm.startBroadcast();

        ViewFacet newFacet = new ViewFacet();
        console.log("New ViewFacet:", address(newFacet));

        IDiamondCut.FacetCut[] memory cuts = new IDiamondCut.FacetCut[](1);
        cuts[0] = IDiamondCut.FacetCut({
            facetAddress: address(newFacet),
            action: IDiamondCut.FacetCutAction.Replace,
            functionSelectors: getViewSelectors()
        });

        IDiamondCut(diamond).diamondCut(cuts, address(0), "");
        vm.stopBroadcast();

        _verifyUpgrade(diamond, "ViewFacet", address(newFacet), getViewSelectors());
        console.log("=== ViewFacet Upgraded ===");
    }

    /// @notice Upgrade only the OwnerUpdateFacet
    function upgradeOwnerUpdate() public {
        address diamond = vm.envAddress("DIAMOND");
        console.log("=== Upgrading OwnerUpdateFacet ===");
        console.log("Diamond:", diamond);

        vm.startBroadcast();

        OwnerUpdateFacet newFacet = new OwnerUpdateFacet();
        console.log("New OwnerUpdateFacet:", address(newFacet));

        IDiamondCut.FacetCut[] memory cuts = new IDiamondCut.FacetCut[](1);
        cuts[0] = IDiamondCut.FacetCut({
            facetAddress: address(newFacet),
            action: IDiamondCut.FacetCutAction.Replace,
            functionSelectors: getOwnerUpdateSelectors()
        });

        IDiamondCut(diamond).diamondCut(cuts, address(0), "");
        vm.stopBroadcast();

        _verifyUpgrade(diamond, "OwnerUpdateFacet", address(newFacet), getOwnerUpdateSelectors());
        console.log("=== OwnerUpdateFacet Upgraded ===");
    }

    /// @notice Upgrade only the VersionFacet
    function upgradeVersion() public {
        address diamond = vm.envAddress("DIAMOND");
        console.log("=== Upgrading VersionFacet ===");
        console.log("Diamond:", diamond);

        vm.startBroadcast();

        VersionFacet newFacet = new VersionFacet();
        console.log("New VersionFacet:", address(newFacet));

        IDiamondCut.FacetCut[] memory cuts = new IDiamondCut.FacetCut[](1);
        cuts[0] = IDiamondCut.FacetCut({
            facetAddress: address(newFacet),
            action: IDiamondCut.FacetCutAction.Replace,
            functionSelectors: getVersionSelectors()
        });

        IDiamondCut(diamond).diamondCut(cuts, address(0), "");
        vm.stopBroadcast();

        _verifyUpgrade(diamond, "VersionFacet", address(newFacet), getVersionSelectors());
        console.log("=== VersionFacet Upgraded ===");
    }

    // ========================================
    // HYBRID UPGRADE (Replace + Add)
    // ========================================
    //
    // When a facet upgrade introduces NEW function selectors not present on
    // the current diamond, you need both Replace and Add entries in a single
    // diamondCut call. LibDiamond reverts with FunctionAlreadyExists if you
    // Add an existing selector, and fails to remove from address(0) if you
    // Replace a selector that doesn't exist yet.
    //
    // Example: If ViewFacet adds a new getOrderCount() function:
    //
    //   IDiamondCut.FacetCut[] memory cuts = new IDiamondCut.FacetCut[](2);
    //
    //   // Replace existing selectors
    //   cuts[0] = IDiamondCut.FacetCut({
    //       facetAddress: address(newViewFacet),
    //       action: IDiamondCut.FacetCutAction.Replace,
    //       functionSelectors: getViewSelectors()  // existing 7 selectors
    //   });
    //
    //   // Add new selectors (same facet address)
    //   bytes4[] memory newSelectors = new bytes4[](1);
    //   newSelectors[0] = ViewFacet.getOrderCount.selector;
    //   cuts[1] = IDiamondCut.FacetCut({
    //       facetAddress: address(newViewFacet),
    //       action: IDiamondCut.FacetCutAction.Add,
    //       functionSelectors: newSelectors
    //   });
    //
    //   IDiamondCut(diamond).diamondCut(cuts, address(0), "");
    //
    // After upgrading, update the corresponding getXxxSelectors() function
    // to include the new selectors for future upgrades.

    // ========================================
    // VERIFICATION
    // ========================================

    /// @dev Verify all selectors now point to the expected new facet address
    function _verifyUpgrade(
        address diamond,
        string memory facetName,
        address expectedFacet,
        bytes4[] memory selectors
    ) internal view {
        console.log("");
        console.log("--- Verifying", facetName, "---");

        IDiamondLoupe loupe = IDiamondLoupe(diamond);
        bool allCorrect = true;

        for (uint256 i = 0; i < selectors.length; i++) {
            address actual = loupe.facetAddress(selectors[i]);
            if (actual != expectedFacet) {
                console.log("  MISMATCH selector", uint256(uint32(selectors[i])));
                console.log("    expected:", expectedFacet);
                console.log("    actual:  ", actual);
                allCorrect = false;
            }
        }

        if (allCorrect) {
            console.log("  All", selectors.length, "selectors verified ->", expectedFacet);
        }
    }

    // ========================================
    // SELECTOR HELPERS
    // (Mirrored from DeployPositionCloserDiamond.s.sol)
    // ========================================

    function getVersionSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = VersionFacet.interfaceVersion.selector;
        selectors[1] = VersionFacet.version.selector;
        return selectors;
    }

    function getRegistrationSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = RegistrationFacet.registerOrder.selector;
        selectors[1] = RegistrationFacet.cancelOrder.selector;
        return selectors;
    }

    function getExecutionSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = ExecutionFacet.executeOrder.selector;
        selectors[1] = ExecutionFacet.uniswapV3SwapCallback.selector;
        return selectors;
    }

    function getOwnerUpdateSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = OwnerUpdateFacet.setOperator.selector;
        selectors[1] = OwnerUpdateFacet.setPayout.selector;
        selectors[2] = OwnerUpdateFacet.setTriggerTick.selector;
        selectors[3] = OwnerUpdateFacet.setValidUntil.selector;
        selectors[4] = OwnerUpdateFacet.setSlippage.selector;
        selectors[5] = OwnerUpdateFacet.setSwapIntent.selector;
        return selectors;
    }

    function getViewSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = ViewFacet.getOrder.selector;
        selectors[1] = ViewFacet.hasOrder.selector;
        selectors[2] = ViewFacet.canExecuteOrder.selector;
        selectors[3] = ViewFacet.getCurrentTick.selector;
        selectors[4] = ViewFacet.positionManager.selector;
        selectors[5] = ViewFacet.augustusRegistry.selector;
        selectors[6] = ViewFacet.maxFeeBps.selector;
        return selectors;
    }
}
