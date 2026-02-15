// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";

// Diamond core
import {Diamond} from "../contracts/position-closer/diamond/Diamond.sol";
import {IDiamondCut} from "../contracts/position-closer/diamond/interfaces/IDiamondCut.sol";

// Facets
import {DiamondCutFacet} from "../contracts/position-closer/facets/DiamondCutFacet.sol";
import {DiamondLoupeFacet} from "../contracts/position-closer/facets/DiamondLoupeFacet.sol";
import {OwnershipFacet} from "../contracts/position-closer/facets/OwnershipFacet.sol";
import {VersionFacet} from "../contracts/position-closer/facets/VersionFacet.sol";
import {RegistrationFacet} from "../contracts/position-closer/facets/RegistrationFacet.sol";
import {ExecutionFacet} from "../contracts/position-closer/facets/ExecutionFacet.sol";
import {OwnerUpdateFacet} from "../contracts/position-closer/facets/OwnerUpdateFacet.sol";
import {ViewFacet} from "../contracts/position-closer/facets/ViewFacet.sol";
import {MulticallFacet} from "../contracts/position-closer/facets/MulticallFacet.sol";

// Init
import {DiamondInit} from "../contracts/position-closer/init/DiamondInit.sol";

/// @title DeployPositionCloserDiamond
/// @notice Deploys the UniswapV3PositionCloser as an EIP-2535 Diamond
/// @dev This script deploys all facets and the diamond proxy with initialization
contract DeployPositionCloserDiamond is Script {
    // ========================================
    // CONSTANTS
    // ========================================

    // Mainnet NFPM address (available in fork)
    address constant NFPM = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;

    // Interface version: 100 = v1.0
    uint32 constant INTERFACE_VERSION = 100;

    // Max operator fee: 1% (100 basis points)
    uint16 constant MAX_FEE_BPS = 100;

    // ========================================
    // DEPLOYMENT
    // ========================================

    /// @notice Deploy the PositionCloser Diamond
    /// @param augustusRegistry The Paraswap AugustusRegistry address
    /// @param owner The diamond owner address
    /// @return diamond The deployed diamond address
    function run(address augustusRegistry, address owner) public returns (address diamond) {
        console.log("=== Deploying PositionCloser Diamond ===");
        console.log("Augustus Registry:", augustusRegistry);
        console.log("Owner:", owner);
        console.log("Interface Version:", INTERFACE_VERSION);
        console.log("");

        vm.startBroadcast();

        // 1. Deploy all facets
        console.log("--- Deploying Facets ---");

        DiamondCutFacet diamondCutFacet = new DiamondCutFacet();
        console.log("DiamondCutFacet:", address(diamondCutFacet));

        DiamondLoupeFacet diamondLoupeFacet = new DiamondLoupeFacet();
        console.log("DiamondLoupeFacet:", address(diamondLoupeFacet));

        OwnershipFacet ownershipFacet = new OwnershipFacet();
        console.log("OwnershipFacet:", address(ownershipFacet));

        VersionFacet versionFacet = new VersionFacet();
        console.log("VersionFacet:", address(versionFacet));

        RegistrationFacet registrationFacet = new RegistrationFacet();
        console.log("RegistrationFacet:", address(registrationFacet));

        ExecutionFacet executionFacet = new ExecutionFacet();
        console.log("ExecutionFacet:", address(executionFacet));

        OwnerUpdateFacet ownerUpdateFacet = new OwnerUpdateFacet();
        console.log("OwnerUpdateFacet:", address(ownerUpdateFacet));

        ViewFacet viewFacet = new ViewFacet();
        console.log("ViewFacet:", address(viewFacet));

        MulticallFacet multicallFacet = new MulticallFacet();
        console.log("MulticallFacet:", address(multicallFacet));

        // 2. Deploy init contract
        console.log("");
        console.log("--- Deploying DiamondInit ---");
        DiamondInit diamondInit = new DiamondInit();
        console.log("DiamondInit:", address(diamondInit));

        // 3. Build FacetCut array
        console.log("");
        console.log("--- Building FacetCuts ---");

        IDiamondCut.FacetCut[] memory facetCuts = new IDiamondCut.FacetCut[](9);

        // DiamondCutFacet
        facetCuts[0] = IDiamondCut.FacetCut({
            facetAddress: address(diamondCutFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getDiamondCutSelectors()
        });

        // DiamondLoupeFacet
        facetCuts[1] = IDiamondCut.FacetCut({
            facetAddress: address(diamondLoupeFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getDiamondLoupeSelectors()
        });

        // OwnershipFacet
        facetCuts[2] = IDiamondCut.FacetCut({
            facetAddress: address(ownershipFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getOwnershipSelectors()
        });

        // VersionFacet
        facetCuts[3] = IDiamondCut.FacetCut({
            facetAddress: address(versionFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getVersionSelectors()
        });

        // RegistrationFacet
        facetCuts[4] = IDiamondCut.FacetCut({
            facetAddress: address(registrationFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getRegistrationSelectors()
        });

        // ExecutionFacet
        facetCuts[5] = IDiamondCut.FacetCut({
            facetAddress: address(executionFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getExecutionSelectors()
        });

        // OwnerUpdateFacet
        facetCuts[6] = IDiamondCut.FacetCut({
            facetAddress: address(ownerUpdateFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getOwnerUpdateSelectors()
        });

        // ViewFacet
        facetCuts[7] = IDiamondCut.FacetCut({
            facetAddress: address(viewFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getViewSelectors()
        });

        // MulticallFacet
        facetCuts[8] = IDiamondCut.FacetCut({
            facetAddress: address(multicallFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getMulticallSelectors()
        });

        // 4. Build init calldata
        bytes memory initCalldata = abi.encodeWithSelector(
            DiamondInit.init.selector,
            NFPM,
            augustusRegistry,
            INTERFACE_VERSION,
            MAX_FEE_BPS
        );

        // 5. Deploy Diamond
        console.log("");
        console.log("--- Deploying Diamond ---");

        Diamond.DiamondArgs memory args = Diamond.DiamondArgs({
            owner: owner,
            init: address(diamondInit),
            initCalldata: initCalldata
        });

        Diamond diamondContract = new Diamond(facetCuts, args);
        diamond = address(diamondContract);

        console.log("Diamond deployed at:", diamond);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Complete ===");
        console.log("PositionCloser Diamond:", diamond);
        console.log("Interface Version:", INTERFACE_VERSION);

        return diamond;
    }

    // ========================================
    // SELECTOR HELPERS
    // ========================================

    function getDiamondCutSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = IDiamondCut.diamondCut.selector;
        return selectors;
    }

    function getDiamondLoupeSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = DiamondLoupeFacet.facets.selector;
        selectors[1] = DiamondLoupeFacet.facetFunctionSelectors.selector;
        selectors[2] = DiamondLoupeFacet.facetAddresses.selector;
        selectors[3] = DiamondLoupeFacet.facetAddress.selector;
        selectors[4] = DiamondLoupeFacet.supportsInterface.selector;
        return selectors;
    }

    function getOwnershipSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = OwnershipFacet.owner.selector;
        selectors[1] = OwnershipFacet.transferOwnership.selector;
        return selectors;
    }

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

    function getMulticallSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = MulticallFacet.multicall.selector;
        return selectors;
    }
}
