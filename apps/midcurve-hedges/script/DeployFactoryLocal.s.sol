// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";

// Diamond facets
import {DiamondCutFacet} from "../contracts/facets/DiamondCutFacet.sol";
import {DiamondLoupeFacet} from "../contracts/facets/DiamondLoupeFacet.sol";
import {OwnershipFacet} from "../contracts/facets/OwnershipFacet.sol";
import {InitFacet} from "../contracts/facets/InitFacet.sol";
import {DepositWithdrawFacet} from "../contracts/facets/DepositWithdrawFacet.sol";
import {StateTransitionFacet} from "../contracts/facets/StateTransitionFacet.sol";
import {SwapFacet} from "../contracts/facets/SwapFacet.sol";
import {SettingsFacet} from "../contracts/facets/SettingsFacet.sol";
import {ViewFacet} from "../contracts/facets/ViewFacet.sol";
import {ERC20Facet} from "../contracts/facets/ERC20Facet.sol";
import {MidcurveHedgeVaultDiamondFactory} from "../contracts/MidcurveHedgeVaultDiamondFactory.sol";

/**
 * @title DeployFactoryLocalScript
 * @notice Deploys the Diamond factory and facets to local Anvil fork
 * @dev Usage:
 *   pnpm deploy:local
 *
 * Prerequisites:
 *   - Anvil running on port 8545 (pnpm local:anvil in midcurve-automation)
 *   - MOCK_AUGUSTUS_ADDRESS set in root .env (deployed by midcurve-automation local:setup)
 *
 * This script deploys ONLY the Diamond factory infrastructure:
 *   - 10 Diamond facets (shared implementations)
 *   - MidcurveHedgeVaultDiamondFactory
 *
 * It does NOT deploy mock infrastructure (MockUSD, MockAugustus, etc.) -
 * those are deployed by midcurve-automation's local:setup script.
 */
contract DeployFactoryLocalScript is Script {
    // Mainnet NFPM address (available in Anvil fork)
    address constant NFPM = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;

    function run() public {
        // Read Augustus address from environment
        address augustus = vm.envAddress("MOCK_AUGUSTUS_ADDRESS");

        console.log("========================================");
        console.log("=== Local Diamond Factory Deployment ===");
        console.log("========================================");
        console.log("Chain ID:", block.chainid);
        console.log("NFPM (forked):", NFPM);
        console.log("Augustus:", augustus);
        console.log("");

        vm.startBroadcast();

        // ========================================
        // 1. Deploy Diamond Facets
        // ========================================
        console.log("--- Deploying Diamond Facets ---");

        DiamondCutFacet diamondCutFacet = new DiamondCutFacet();
        console.log("DiamondCutFacet deployed at:", address(diamondCutFacet));

        DiamondLoupeFacet diamondLoupeFacet = new DiamondLoupeFacet();
        console.log("DiamondLoupeFacet deployed at:", address(diamondLoupeFacet));

        OwnershipFacet ownershipFacet = new OwnershipFacet();
        console.log("OwnershipFacet deployed at:", address(ownershipFacet));

        InitFacet initFacet = new InitFacet();
        console.log("InitFacet deployed at:", address(initFacet));

        DepositWithdrawFacet depositWithdrawFacet = new DepositWithdrawFacet();
        console.log("DepositWithdrawFacet deployed at:", address(depositWithdrawFacet));

        StateTransitionFacet stateTransitionFacet = new StateTransitionFacet();
        console.log("StateTransitionFacet deployed at:", address(stateTransitionFacet));

        SwapFacet swapFacet = new SwapFacet();
        console.log("SwapFacet deployed at:", address(swapFacet));

        SettingsFacet settingsFacet = new SettingsFacet();
        console.log("SettingsFacet deployed at:", address(settingsFacet));

        ViewFacet viewFacet = new ViewFacet();
        console.log("ViewFacet deployed at:", address(viewFacet));

        ERC20Facet erc20Facet = new ERC20Facet();
        console.log("ERC20Facet deployed at:", address(erc20Facet));

        console.log("");

        // ========================================
        // 2. Deploy Diamond Factory
        // ========================================
        console.log("--- Deploying Diamond Factory ---");

        address[10] memory facets = [
            address(diamondCutFacet),
            address(diamondLoupeFacet),
            address(ownershipFacet),
            address(initFacet),
            address(depositWithdrawFacet),
            address(stateTransitionFacet),
            address(swapFacet),
            address(settingsFacet),
            address(viewFacet),
            address(erc20Facet)
        ];

        MidcurveHedgeVaultDiamondFactory factory = new MidcurveHedgeVaultDiamondFactory(
            NFPM,
            augustus,
            facets
        );
        console.log("MidcurveHedgeVaultDiamondFactory deployed at:", address(factory));

        vm.stopBroadcast();

        console.log("");
        console.log("========================================");
        console.log("=== Deployment Summary ===");
        console.log("========================================");
        console.log("");
        console.log("--- Diamond Facets ---");
        console.log("DiamondCutFacet:", address(diamondCutFacet));
        console.log("DiamondLoupeFacet:", address(diamondLoupeFacet));
        console.log("OwnershipFacet:", address(ownershipFacet));
        console.log("InitFacet:", address(initFacet));
        console.log("DepositWithdrawFacet:", address(depositWithdrawFacet));
        console.log("StateTransitionFacet:", address(stateTransitionFacet));
        console.log("SwapFacet:", address(swapFacet));
        console.log("SettingsFacet:", address(settingsFacet));
        console.log("ViewFacet:", address(viewFacet));
        console.log("ERC20Facet:", address(erc20Facet));
        console.log("");
        console.log("--- Factory ---");
        console.log("MidcurveHedgeVaultDiamondFactory deployed at:", address(factory));
        console.log("");
        console.log("========================================");
        console.log("To create a new hedge vault diamond:");
        console.log("  factory.createDiamond(positionId, operator, name, symbol)");
        console.log("========================================");
    }
}
