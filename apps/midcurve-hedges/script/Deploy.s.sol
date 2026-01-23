// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {UniswapV3PositionCloser} from "../contracts/UniswapV3PositionCloser.sol";

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
 * @title DeployScript
 * @notice Deployment script for all shared contracts including Diamond factory and facets
 * @dev Usage:
 *   With Ledger:
 *     forge script script/Deploy.s.sol --rpc-url <chain> --broadcast --ledger
 *
 *   With private key:
 *     forge script script/Deploy.s.sol --rpc-url <chain> --broadcast --private-key $DEPLOYER_PRIVATE_KEY
 *
 * Supported chains: mainnet, arbitrum, base, optimism, polygon
 */
contract DeployScript is Script {
    // Uniswap V3 NonfungiblePositionManager addresses per chain
    mapping(uint256 => address) public positionManagers;

    // Paraswap AugustusRegistry addresses per chain
    mapping(uint256 => address) public augustusRegistries;

    function setUp() public {
        // Ethereum, Arbitrum, Optimism, Polygon use the same NFPM address
        positionManagers[1] = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;
        positionManagers[42161] = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;
        positionManagers[10] = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;
        positionManagers[137] = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;

        // Base uses a different NFPM address
        positionManagers[8453] = 0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1;

        // Paraswap AugustusRegistry addresses
        augustusRegistries[1] = 0xa68bEA62Dc4034A689AA0F58A76681433caCa663;       // Ethereum
        augustusRegistries[42161] = 0xdC6E2b14260F972ad4e5a31c68294Fba7E720701;   // Arbitrum
        augustusRegistries[8453] = 0x7E31B336F9E8bA52ba3c4ac861b033Ba90900bb3;    // Base
        augustusRegistries[10] = 0x6e7bE86000dF697facF4396efD2aE2C322165dC3;      // Optimism
        augustusRegistries[137] = 0xca35a4866747Ff7A604EF7a2A7F246bb870f3ca1;     // Polygon
    }

    function run() public {
        uint256 chainId = block.chainid;
        address nfpm = positionManagers[chainId];
        address augustusRegistry = augustusRegistries[chainId];
        require(nfpm != address(0), "Unsupported chain: no NFPM");
        require(augustusRegistry != address(0), "Unsupported chain: no AugustusRegistry");

        console.log("========================================");
        console.log("=== Full Deployment ===");
        console.log("========================================");
        console.log("Chain ID:", chainId);
        console.log("NFPM Address:", nfpm);
        console.log("AugustusRegistry:", augustusRegistry);
        console.log("");

        vm.startBroadcast();

        // ========================================
        // 1. Deploy Position Closer
        // ========================================
        console.log("--- Deploying Position Closer ---");
        UniswapV3PositionCloser closer = new UniswapV3PositionCloser(nfpm, augustusRegistry);
        console.log("UniswapV3PositionCloser deployed at:", address(closer));
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
            nfpm,
            augustusRegistry,
            facets
        );
        console.log("MidcurveHedgeVaultDiamondFactory deployed at:", address(factory));

        vm.stopBroadcast();

        console.log("");
        console.log("========================================");
        console.log("=== Deployment Summary ===");
        console.log("========================================");
        console.log("");
        console.log("--- Shared Contracts ---");
        console.log("UniswapV3PositionCloser:", address(closer));
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
        console.log("=== Next Steps ===");
        console.log("========================================");
        console.log("1. Update config files with deployed addresses");
        console.log("");
        console.log("2. Verify contracts on block explorer:");
        console.log("   forge verify-contract --chain-id %s <address> <contract>", chainId);
        console.log("");
        console.log("3. To create a new hedge vault diamond:");
        console.log("   factory.createDiamond(positionId, operator, name, symbol)");
        console.log("========================================");
    }
}
