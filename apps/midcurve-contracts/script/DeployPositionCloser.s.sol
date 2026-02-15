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

// Init
import {DiamondInit} from "../contracts/position-closer/init/DiamondInit.sol";

/// @title DeployPositionCloser
/// @notice Deploys the UniswapV3PositionCloser Diamond to local Anvil fork
/// @dev Usage:
///   forge script script/DeployPositionCloser.s.sol --rpc-url local --broadcast --unlocked --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
///
/// Environment variables (optional):
///   AUGUSTUS_REGISTRY - Override the AugustusRegistry address (default: uses existing MockAugustusRegistry)
contract DeployPositionCloser is Script {
    // Mainnet NFPM address (available in fork)
    address constant NFPM = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;

    // Foundry test account #0 (pre-funded in Anvil)
    address constant FOUNDRY_SENDER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    // Default MockAugustusRegistry from local:setup
    address constant DEFAULT_AUGUSTUS_REGISTRY = 0x9A676e781A523b5d0C0e43731313A708CB607508;

    // Interface version: 100 = v1.0
    uint32 constant INTERFACE_VERSION = 100;

    // Max operator fee: 1% (100 basis points)
    uint16 constant MAX_FEE_BPS = 100;

    function run() public {
        // Allow override of AugustusRegistry via env var
        address augustusRegistry = DEFAULT_AUGUSTUS_REGISTRY;
        try vm.envAddress("AUGUSTUS_REGISTRY") returns (address envRegistry) {
            augustusRegistry = envRegistry;
        } catch {}

        console.log("=== Deploying PositionCloser Diamond ===");
        console.log("NFPM:", NFPM);
        console.log("AugustusRegistry:", augustusRegistry);
        console.log("Owner:", FOUNDRY_SENDER);
        console.log("");

        vm.startBroadcast();

        // Deploy all facets
        console.log("--- Deploying Facets ---");
        DiamondCutFacet diamondCutFacet = new DiamondCutFacet();
        DiamondLoupeFacet diamondLoupeFacet = new DiamondLoupeFacet();
        OwnershipFacet ownershipFacet = new OwnershipFacet();
        VersionFacet versionFacet = new VersionFacet();
        RegistrationFacet registrationFacet = new RegistrationFacet();
        ExecutionFacet executionFacet = new ExecutionFacet();
        OwnerUpdateFacet ownerUpdateFacet = new OwnerUpdateFacet();
        ViewFacet viewFacet = new ViewFacet();

        console.log("RegistrationFacet:", address(registrationFacet));

        // Deploy init contract
        DiamondInit diamondInit = new DiamondInit();

        // Build FacetCut array
        IDiamondCut.FacetCut[] memory facetCuts = new IDiamondCut.FacetCut[](8);

        facetCuts[0] = IDiamondCut.FacetCut({
            facetAddress: address(diamondCutFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getDiamondCutSelectors()
        });

        facetCuts[1] = IDiamondCut.FacetCut({
            facetAddress: address(diamondLoupeFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getDiamondLoupeSelectors()
        });

        facetCuts[2] = IDiamondCut.FacetCut({
            facetAddress: address(ownershipFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getOwnershipSelectors()
        });

        facetCuts[3] = IDiamondCut.FacetCut({
            facetAddress: address(versionFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getVersionSelectors()
        });

        facetCuts[4] = IDiamondCut.FacetCut({
            facetAddress: address(registrationFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getRegistrationSelectors()
        });

        facetCuts[5] = IDiamondCut.FacetCut({
            facetAddress: address(executionFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getExecutionSelectors()
        });

        facetCuts[6] = IDiamondCut.FacetCut({
            facetAddress: address(ownerUpdateFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getOwnerUpdateSelectors()
        });

        facetCuts[7] = IDiamondCut.FacetCut({
            facetAddress: address(viewFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getViewSelectors()
        });

        // Build init calldata
        bytes memory initCalldata = abi.encodeWithSelector(
            DiamondInit.init.selector,
            NFPM,
            augustusRegistry,
            INTERFACE_VERSION,
            MAX_FEE_BPS
        );

        // Deploy Diamond
        console.log("");
        console.log("--- Deploying Diamond ---");

        Diamond.DiamondArgs memory args = Diamond.DiamondArgs({
            owner: FOUNDRY_SENDER,
            init: address(diamondInit),
            initCalldata: initCalldata
        });

        Diamond positionCloserDiamond = new Diamond(facetCuts, args);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Complete ===");
        console.log("PositionCloser Diamond:", address(positionCloserDiamond));
        console.log("Interface Version:", INTERFACE_VERSION);
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
}
