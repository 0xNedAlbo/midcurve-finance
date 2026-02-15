// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {MockUSD} from "../contracts/MockUSD.sol";
import {MockAugustus} from "../contracts/mocks/MockAugustus.sol";
import {MockAugustusRegistry} from "../contracts/mocks/MockAugustusRegistry.sol";

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

/**
 * @title DeployLocalScript
 * @notice Deploys mock infrastructure and PositionCloser Diamond for local Anvil fork testing
 * @dev Usage:
 *   pnpm local:deploy (or via pnpm local:setup)
 *
 * This uses the Foundry default account #0 which is pre-funded with ETH.
 * The MockAugustus contract is used instead of real Paraswap since Paraswap API
 * cannot price custom tokens like mockUSD.
 */
contract DeployLocalScript is Script {
    // Mainnet NFPM address (available in fork)
    address constant NFPM = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;

    // Foundry test account #0 (pre-funded in Anvil)
    address constant FOUNDRY_SENDER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;

    // Interface version: 100 = v1.0
    uint32 constant INTERFACE_VERSION = 100;

    // Max operator fee: 1% (100 basis points)
    uint16 constant MAX_FEE_BPS = 100;

    function run() public {
        console.log("=== Local Fork Deployment (Automation) ===");
        console.log("Chain ID:", block.chainid);
        console.log("NFPM (forked):", NFPM);
        console.log("");

        vm.startBroadcast();

        // ========================================
        // 1. Deploy Mock Infrastructure
        // ========================================
        console.log("--- Deploying Mock Infrastructure ---");

        // Deploy MockUSD token
        MockUSD mockUSD = new MockUSD();
        console.log("MockUSD deployed at:", address(mockUSD));

        // Deploy MockAugustus (for local swap execution)
        MockAugustus mockAugustus = new MockAugustus();
        console.log("MockAugustus deployed at:", address(mockAugustus));

        // Deploy MockAugustusRegistry and register MockAugustus
        MockAugustusRegistry mockRegistry = new MockAugustusRegistry();
        mockRegistry.setValidAugustus(address(mockAugustus), true);
        console.log("MockAugustusRegistry deployed at:", address(mockRegistry));

        // ========================================
        // 2. Deploy PositionCloser Diamond
        // ========================================
        console.log("");
        console.log("--- Deploying PositionCloser Diamond ---");

        // Deploy all facets
        DiamondCutFacet diamondCutFacet = new DiamondCutFacet();
        DiamondLoupeFacet diamondLoupeFacet = new DiamondLoupeFacet();
        OwnershipFacet ownershipFacet = new OwnershipFacet();
        VersionFacet versionFacet = new VersionFacet();
        RegistrationFacet registrationFacet = new RegistrationFacet();
        ExecutionFacet executionFacet = new ExecutionFacet();
        OwnerUpdateFacet ownerUpdateFacet = new OwnerUpdateFacet();
        ViewFacet viewFacet = new ViewFacet();
        MulticallFacet multicallFacet = new MulticallFacet();

        // Deploy init contract
        DiamondInit diamondInit = new DiamondInit();

        // Build FacetCut array
        IDiamondCut.FacetCut[] memory facetCuts = new IDiamondCut.FacetCut[](9);

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

        facetCuts[8] = IDiamondCut.FacetCut({
            facetAddress: address(multicallFacet),
            action: IDiamondCut.FacetCutAction.Add,
            functionSelectors: getMulticallSelectors()
        });

        // Build init calldata
        bytes memory initCalldata = abi.encodeWithSelector(
            DiamondInit.init.selector,
            NFPM,
            address(mockRegistry),
            INTERFACE_VERSION,
            MAX_FEE_BPS
        );

        // Deploy Diamond
        Diamond.DiamondArgs memory args = Diamond.DiamondArgs({
            owner: FOUNDRY_SENDER,
            init: address(diamondInit),
            initCalldata: initCalldata
        });

        Diamond positionCloserDiamond = new Diamond(facetCuts, args);
        console.log("PositionCloser deployed at:", address(positionCloserDiamond));

        vm.stopBroadcast();

        console.log("");
        console.log("========================================");
        console.log("=== Deployment Summary ===");
        console.log("========================================");
        console.log("");
        console.log("MockUSD:", address(mockUSD));
        console.log("MockAugustus:", address(mockAugustus));
        console.log("MockAugustusRegistry:", address(mockRegistry));
        console.log("PositionCloser:", address(positionCloserDiamond));
        console.log("Interface Version:", INTERFACE_VERSION);
        console.log("");
        console.log("========================================");
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
