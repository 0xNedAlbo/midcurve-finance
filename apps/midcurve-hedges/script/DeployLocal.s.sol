// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {UniswapV3PositionCloser} from "../contracts/UniswapV3PositionCloser.sol";
import {MockUSD} from "../contracts/MockUSD.sol";
import {MockAugustus} from "../contracts/mocks/MockAugustus.sol";
import {MockAugustusRegistry} from "../contracts/mocks/MockAugustusRegistry.sol";

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
 * @title DeployLocalScript
 * @notice Deploys all contracts for local Anvil fork including Diamond factory and facets
 * @dev Usage:
 *   pnpm local:deploy
 *
 * This uses the Foundry default account #0 which is pre-funded with ETH.
 * The MockAugustus contract is used instead of real Paraswap since Paraswap API
 * cannot price custom tokens like mockUSD.
 */
contract DeployLocalScript is Script {
    // Mainnet NFPM address (available in fork)
    address constant NFPM = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;

    function run() public {
        console.log("=== Local Fork Deployment ===");
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

        // Deploy UniswapV3PositionCloser with mock registry
        UniswapV3PositionCloser closer = new UniswapV3PositionCloser(NFPM, address(mockRegistry));
        console.log("PositionCloser deployed at:", address(closer));

        console.log("");

        // ========================================
        // 2. Deploy Diamond Facets
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
        // 3. Deploy Diamond Factory
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
            address(mockRegistry),
            facets
        );
        console.log("MidcurveHedgeVaultDiamondFactory deployed at:", address(factory));

        vm.stopBroadcast();

        console.log("");
        console.log("========================================");
        console.log("=== Deployment Summary ===");
        console.log("========================================");
        console.log("");
        console.log("--- Mock Infrastructure ---");
        console.log("MockUSD:", address(mockUSD));
        console.log("MockAugustus:", address(mockAugustus));
        console.log("MockAugustusRegistry:", address(mockRegistry));
        console.log("PositionCloser:", address(closer));
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
        console.log("MidcurveHedgeVaultDiamondFactory:", address(factory));
        console.log("");
        console.log("========================================");
        console.log("To create a new hedge vault diamond:");
        console.log("  factory.createDiamond(positionId, operator, name, symbol)");
        console.log("========================================");
    }
}
