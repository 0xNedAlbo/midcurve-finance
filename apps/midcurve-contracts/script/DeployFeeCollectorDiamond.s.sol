// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";

// Diamond core (reused from position-closer)
import {Diamond} from "../contracts/position-closer/diamond/Diamond.sol";
import {IDiamondCut} from "../contracts/position-closer/diamond/interfaces/IDiamondCut.sol";

// Shared diamond facets (reused from position-closer — no AppStorage dependency)
import {DiamondCutFacet} from "../contracts/position-closer/facets/DiamondCutFacet.sol";
import {DiamondLoupeFacet} from "../contracts/position-closer/facets/DiamondLoupeFacet.sol";
import {OwnershipFacet} from "../contracts/position-closer/facets/OwnershipFacet.sol";

// FeeCollector-specific facets
import {VersionFacet} from "../contracts/fee-collector/facets/VersionFacet.sol";
import {CollectRegistrationFacet} from "../contracts/fee-collector/facets/CollectRegistrationFacet.sol";
import {CollectExecutionFacet} from "../contracts/fee-collector/facets/CollectExecutionFacet.sol";
import {CollectOwnerUpdateFacet} from "../contracts/fee-collector/facets/CollectOwnerUpdateFacet.sol";
import {CollectViewFacet} from "../contracts/fee-collector/facets/CollectViewFacet.sol";
import {MulticallFacet} from "../contracts/fee-collector/facets/MulticallFacet.sol";

// Init
import {DiamondInit} from "../contracts/fee-collector/init/DiamondInit.sol";

/// @title DeployFeeCollectorDiamond
/// @notice Deploys the UniswapV3FeeCollector as an EIP-2535 Diamond
contract DeployFeeCollectorDiamond is Script {
    uint32 constant INTERFACE_VERSION = 100;
    uint16 constant MAX_FEE_BPS = 100;

    /// @notice Deploy the FeeCollector Diamond
    /// @param swapRouter The MidcurveSwapRouter address
    /// @param owner The diamond owner address
    /// @param nfpm The Uniswap V3 NonfungiblePositionManager address
    /// @return diamond The deployed diamond address
    function run(address swapRouter, address owner, address nfpm) public returns (address diamond) {
        console.log("=== Deploying FeeCollector Diamond ===");
        console.log("SwapRouter:", swapRouter);
        console.log("Owner:", owner);
        console.log("NFPM:", nfpm);
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

        CollectRegistrationFacet registrationFacet = new CollectRegistrationFacet();
        console.log("CollectRegistrationFacet:", address(registrationFacet));

        CollectExecutionFacet executionFacet = new CollectExecutionFacet();
        console.log("CollectExecutionFacet:", address(executionFacet));

        CollectOwnerUpdateFacet ownerUpdateFacet = new CollectOwnerUpdateFacet();
        console.log("CollectOwnerUpdateFacet:", address(ownerUpdateFacet));

        CollectViewFacet viewFacet = new CollectViewFacet();
        console.log("CollectViewFacet:", address(viewFacet));

        MulticallFacet multicallFacet = new MulticallFacet();
        console.log("MulticallFacet:", address(multicallFacet));

        // 2. Deploy init contract
        console.log("");
        console.log("--- Deploying DiamondInit ---");
        DiamondInit diamondInit = new DiamondInit();
        console.log("DiamondInit:", address(diamondInit));

        // 3. Build FacetCut array
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

        // 4. Build init calldata
        bytes memory initCalldata = abi.encodeWithSelector(
            DiamondInit.init.selector,
            nfpm,
            swapRouter,
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

        console.log("FeeCollector Diamond deployed at:", diamond);

        vm.stopBroadcast();

        console.log("");
        console.log("=== Deployment Complete ===");
        console.log("FeeCollector Diamond:", diamond);

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
        selectors[0] = CollectRegistrationFacet.registerCollect.selector;
        selectors[1] = CollectRegistrationFacet.cancelCollect.selector;
        return selectors;
    }

    function getExecutionSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = CollectExecutionFacet.executeCollect.selector;
        return selectors;
    }

    function getOwnerUpdateSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = CollectOwnerUpdateFacet.setCollectOperator.selector;
        selectors[1] = CollectOwnerUpdateFacet.setCollectPayout.selector;
        selectors[2] = CollectOwnerUpdateFacet.setCollectValidUntil.selector;
        selectors[3] = CollectOwnerUpdateFacet.setCollectSwapIntent.selector;
        selectors[4] = CollectOwnerUpdateFacet.setCollectMinFee.selector;
        return selectors;
    }

    function getViewSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = CollectViewFacet.getCollectOrder.selector;
        selectors[1] = CollectViewFacet.hasCollectOrder.selector;
        selectors[2] = CollectViewFacet.positionManager.selector;
        selectors[3] = CollectViewFacet.swapRouter.selector;
        selectors[4] = CollectViewFacet.maxFeeBps.selector;
        return selectors;
    }

    function getMulticallSelectors() internal pure returns (bytes4[] memory) {
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = MulticallFacet.multicall.selector;
        return selectors;
    }
}
